// test/app.js — 새 화면(첫 화면 · 결과 · 받은 노래)을 헤드리스 브라우저로 확인. 모바일 먼저.
// 준비: KM-Crew 폴더에서 `python -m http.server 8790 --bind 127.0.0.1`, workspace/qa 에 puppeteer(-core) 설치
// 실행: node test/app.js        (QA_DIR=workspace/qa 경로, APP_URL=페이지 주소로 바꿀 수 있음)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const QA = process.env.QA_DIR || path.resolve(__dirname, '..', '..', 'workspace', 'qa');
const URL0 = process.env.APP_URL || 'http://127.0.0.1:8790/photo-song/';
const FIX = path.join(__dirname, 'fixtures');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK ' : 'NG '} ${name}${extra ? ' — ' + extra : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await require(path.join(QA, 'launch.js'))();
  const VPS = [
    { name: '모바일 390', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '모바일 520', width: 520, height: 900, isMobile: true, hasTouch: true },
    { name: 'PC 1280', width: 1280, height: 800 }
  ];
  for (const vp of VPS) {
    const page = await browser.newPage(), errors = [], external = [];
    await page.setViewport(vp);
    await page.setRequestInterception(true);
    page.on('request', r => { if (/^https?:\/\/127\.0\.0\.1/.test(r.url()) || /^(data|blob):/.test(r.url())) return r.continue(); external.push(r.url()); r.abort(); });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
    await page.evaluateOnNewDocument(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied.push(t); return Promise.resolve(); } } }); Object.defineProperty(navigator, 'share', { value: undefined }); });
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const noOverflow = () => ev(() => document.documentElement.scrollWidth <= innerWidth + 1);
    const unnamed = () => ev(() => [...document.querySelectorAll('button, a[href]')].filter(b => b.offsetParent && !(b.getAttribute('aria-label') || b.textContent.trim())).length);
    const P = vp.name + ': ';

    // 1. 첫 화면
    await page.goto(URL0, { waitUntil: 'load' });
    await page.waitForSelector('.sample canvas');
    ok(P + '첫 화면: 사진 고르기·예시 3개', await ev(() => !!document.querySelector('#file[accept="image/*"]') && document.querySelectorAll('.sample canvas').length === 3));
    ok(P + '첫 화면: 가로 넘침 없음', await noOverflow());
    ok(P + '첫 화면: 이름 없는 버튼 0', (await unnamed()) === 0);
    ok(P + '모바일/PC 배치', await ev(w => document.documentElement.classList.contains(w >= 900 ? 'pc' : 'mobile'), vp.width));

    // 2. 예시 → 결과 → 자동 재생
    await page.click('.sample[data-k="노을"]');
    await page.waitForSelector('.songtitle');
    const t1 = await ev(() => document.querySelector('.songtitle').textContent);
    ok(P + '예시 → 결과 화면(제목·16칸 띠)', t1.length > 2 && (await ev(() => document.querySelectorAll('.strip > div').length)) === 16, t1);
    await wait(1500);
    const st = await ev(() => ({ state: App.audio.ctx && App.audio.ctx.state, playing: !!App.audio.playing, left: parseFloat(document.querySelector('.scanbar').style.left) || 0, bar: !document.querySelector('.scanbar').hidden, btn: document.querySelector('#play').textContent }));
    ok(P + '자동 재생: 소리 장치 running·막대 이동', st.state === 'running' && st.playing && st.bar && st.left > 0 && /멈춤/.test(st.btn), JSON.stringify(st));
    ok(P + '결과: 가로 넘침 없음', await noOverflow());
    ok(P + '결과: 이름 없는 버튼 0', (await unnamed()) === 0);
    const pipe = await ev(() => ({ steps: document.querySelectorAll('.why .steps > li').length, chips: document.querySelectorAll('.why .chip .sw').length, tags: document.querySelectorAll('.why .chip.tag').length, mood: document.querySelector('#mood').textContent, prompt: document.querySelector('#prompt').textContent, made: document.querySelector('#made').textContent, sub: document.querySelector('.songtitle + p').textContent, rules: document.querySelectorAll('.why details li').length, inst: App.audio.playing ? JSON.stringify(LabCompose.compose(App.cur.seed, 'D').inst) : '' }));
    ok(P + '만든 과정 4단계: 분석(색) → 분위기 글 → 주문서 → 음원 생성', pipe.steps === 4 && pipe.chips >= 1 && pipe.tags === 4 && pipe.mood.length > 30 && pipe.rules >= 4, pipe.mood);
    ok(P + '주문서와 실제 연주 악기가 같음(통기타 멜로디 + 피아노 반주), 전자음 이름 없음', /통기타가 멜로디/.test(pipe.prompt) && /피아노/.test(pipe.prompt) && /통기타 · 피아노 · 콘트라베이스/.test(pipe.made) && /통기타와 피아노/.test(pipe.sub) && /"lead":"guitar","comp":"piano"/.test(pipe.inst) && !/종소리|줄 소리/.test(pipe.prompt + pipe.made + pipe.sub), pipe.made);

    // 3. Space 로 멈춤/재생
    await page.focus('body'); await page.keyboard.press('Space'); await wait(100);
    const s1 = await ev(() => !App.audio.playing);
    await page.keyboard.press('Space'); await wait(100);
    const s2 = await ev(() => !!App.audio.playing);
    ok(P + 'Space: 멈춤 → 재생', s1 && s2);

    // 4. 링크 복사 → 그 링크로 열면 같은 곡(받은 노래)
    await page.click('#copy'); await wait(100);
    const link = await ev(() => window.__copied[window.__copied.length - 1] || '');
    ok(P + '링크 복사: #/song?s= 51~79자', /#\/song\?s=[0-9a-z-]{51,79}$/.test(link), link.split('s=')[1]);
    const page2 = await browser.newPage(); await page2.setViewport(vp);
    await page2.goto(link.replace('https://km-crew.github.io/photo-song/', URL0), { waitUntil: 'load' });
    await page2.waitForSelector('.songtitle');
    const r2 = await page2.evaluate(() => ({ title: document.querySelector('.songtitle').textContent, notice: !!document.querySelector('.notice'), canvas: !!document.querySelector('.stage canvas'), again: document.querySelector('#again').textContent }));
    ok(P + '받은 노래: 같은 제목·안내·색 악보', r2.title === t1 && r2.notice && r2.canvas && /내 사진으로도/.test(r2.again), JSON.stringify(r2));
    await page2.click('#play'); await wait(800);
    ok(P + '받은 노래: ▶ 재생', await page2.evaluate(() => !!App.audio.playing));
    ok(P + '받은 노래: 가로 넘침 없음', await page2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page2.close();

    // 5. 같은 예시 두 번 = 같은 곡
    await page.goto(URL0 + '#/', { waitUntil: 'load' }); await page.waitForSelector('.sample canvas');
    await page.click('.sample[data-k="노을"]'); await page.waitForSelector('.songtitle');
    const again = await ev(() => document.querySelector('.songtitle').textContent);
    await page.click('#copy'); await wait(100);
    ok(P + '같은 예시 = 같은 제목·같은 링크', again === t1 && (await ev(() => window.__copied[window.__copied.length - 1])) === link);

    // 6. 다른 예시는 다른 링크
    await page.goto(URL0 + '#/', { waitUntil: 'load' }); await page.waitForSelector('.sample canvas');
    await page.click('.sample[data-k="야경"]'); await page.waitForSelector('.songtitle');
    await page.click('#copy'); await wait(100);
    ok(P + '다른 예시 = 다른 링크', (await ev(() => window.__copied[window.__copied.length - 1])) !== link);

    // 7. 파일 고르기: PNG → 곡, 그림 아닌 파일 → 안내
    await page.goto(URL0 + '#/', { waitUntil: 'load' }); await page.waitForSelector('#file');
    await (await page.$('#file')).uploadFile(path.join(FIX, 'forest.png'));
    await page.waitForSelector('.songtitle', { timeout: 8000 });
    ok(P + '사진 파일 → 결과 화면', (await ev(() => document.querySelector('.stage canvas').width)) > 0);
    await page.goto(URL0 + '#/', { waitUntil: 'load' }); await page.waitForSelector('#file');
    const bad = path.join(os.tmpdir(), 'photo-song-bad.png'); fs.writeFileSync(bad, 'not an image');
    await (await page.$('#file')).uploadFile(bad); await wait(800);
    ok(P + '열 수 없는 파일 → 안내, 첫 화면 유지', await ev(() => location.hash === '#/' && /열 수 없어요|그림 파일이 아니에요/.test(document.querySelector('#msg').textContent)));

    // 8. 깨진 링크·사진 없는 결과 주소 → 첫 화면
    await page.goto(URL0 + '#/song?s=zz-broken', { waitUntil: 'load' }); await wait(300);
    ok(P + '깨진 링크 → 첫 화면', await ev(() => location.hash === '#/' && !!document.querySelector('.home')));
    await page.goto(URL0 + '?r=' + Date.now() + '#/song', { waitUntil: 'load' }); await wait(300);
    ok(P + '사진 없는 #/song → 첫 화면', await ev(() => location.hash === '#/'));

    ok(P + '페이지 오류 없음', errors.length === 0, errors.join(' | '));
    ok(P + '막힌 외부 요청은 글꼴뿐(없어도 동작)', external.every(u => /pretendard/.test(u)), external.join(', '));
    await page.close();
  }
  await browser.close();
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
