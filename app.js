/* app.js — 색의 노래: 사진 → 노래 (첫 화면 · 결과 · 받은 노래)
   흐름: 픽셀 → 특징(song/analyze) → 곡 설정값(song/compose.toSeed) → 음표(compose, 방식 D) → 소리(song/render)
   사진은 메모리에만 둔다. 서버·저장·외부 요청 없음. */
'use strict';
const A = LabAnalyze, C = LabCompose, R = LabRender, L = LabSeedLink, S = LabSamples;
const SAMPLES = ['노을', '숲', '야경'];
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const cur = { seed: null, cols: null, pic: null, name: '', auto: false };   // 지금 사진의 곡(새로고침하면 사라짐)
const audio = { ctx: null, playing: null, raf: 0 };

/* ---------- 사진 → 픽셀 (축소 방법은 lab 과 같게: 긴 변 512 → 분석 크기. 바꾸면 같은 사진의 곡이 달라짐) ---------- */
const fit = (w, h, max) => { const k = Math.min(1, max / Math.max(w, h)); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; };
function canvasOf(src, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h); return c; }
function pixelsOf(src, sw, sh) {
  const t = A.targetSize(sw, sh);
  let step = src;
  if (Math.max(sw, sh) > 512) { const m = fit(sw, sh, 512); step = canvasOf(src, m.w, m.h); }
  const c = document.createElement('canvas'); c.width = t.w; c.height = t.h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(step, 0, 0, t.w, t.h);
  const d = x.getImageData(0, 0, t.w, t.h);
  return { data: d.data, width: t.w, height: t.h };
}
function sampleCanvas(kind, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(S.makeImage(kind, 0, w, h).data, w, h), 0, 0);
  return c;
}
function setSong(pixels, pic, name) {
  const f = A.analyze(pixels);
  Object.assign(cur, { seed: C.toSeed(f), cols: f.layout.columns.map(c => c.hex), pic, name, auto: true });
  Router.go('/song');
}
function loadFile(file, say) {
  if (!file) return;
  if (file.type && !/^image\//.test(file.type)) return say('그림 파일이 아니에요. 사진을 골라 주세요.');
  say('사진을 읽는 중…');
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    try {
      const w = img.naturalWidth, h = img.naturalHeight, v = fit(w, h, 1280);
      setSong(pixelsOf(img, w, h), canvasOf(img, v.w, v.h), '내 사진');
    } catch (e) { console.error(e); say('사진을 분석하지 못했어요. 다른 사진으로 해 보세요.'); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); say('이 사진 형식은 열 수 없어요. 화면을 캡처해서 넣거나 아래 예시로 들어 보세요.'); };
  img.src = url;
}
// 예시는 생성기가 만든 128×96 픽셀을 그대로 분석(브라우저 축소를 거치지 않아 테스트와 같은 곡)
const loadSample = kind => setSong(S.makeImage(kind), sampleCanvas(kind, 384, 288), '예시 그림 · ' + kind);

/* ---------- 소리 장치: 버튼을 누른 그 순간에 켜야 아이폰·자동 재생 차단을 넘음 ---------- */
function ensureCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audio.ctx) { try { audio.ctx = new AC(); } catch (e) { return null; } }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 없는 브라우저 */ }
  if (audio.ctx.state !== 'running' && audio.ctx.resume) { const p = audio.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  return audio.ctx;
}

/* ---------- 곡 이름·요약 (같은 설정값 = 같은 이름, 난수 없음) ---------- */
const FRONT = { maj: ['포근한', '환한', '반짝이는'], min: ['짙은', '잔잔한', '서늘한'] };   // 음역 −1·0·+1
const BACK = { 72: '자장가', 84: '오후', 96: '산책', 108: '발걸음', 120: '춤' };
const titleOf = s => (s.gray ? '고요한' : FRONT[s.mode][s.register + 1]) + ' ' + BACK[s.bpm];
const LEAD_KO = { piano: '피아노', bell: '종소리', pluck: '줄 소리' };
function summaryOf(song) {
  const lv = C.BPM.indexOf(song.bpm);
  return [C.NOTE_KO[song.key] + (song.mode === 'maj' ? ' 장조' : ' 단조'), lv <= 1 ? '느리게' : lv === 2 ? '걷는 빠르기' : '빠르게', LEAD_KO[song.lead] || song.lead].join(' · ');
}
const lightHex = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 > 0.55; };

/* 받은 노래: 사진 대신 색 악보(16칸, 멜로디 높이만큼 올라간 막대) */
function scoreCanvas(seed, cols) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 400;
  const x = c.getContext('2d');
  x.fillStyle = '#1b1726'; x.fillRect(0, 0, 640, 400);
  cols.forEach((col, k) => {
    const hgt = 70 + seed.melody[k] * 38;
    x.fillStyle = col; x.beginPath();
    if (x.roundRect) x.roundRect(k * 40 + 5, 380 - hgt, 30, hgt, 8); else x.rect(k * 40 + 5, 380 - hgt, 30, hgt);
    x.fill();
  });
  return c;
}

/* ---------- 첫 화면 ---------- */
Router.on('/', root => {
  const view = h(`
    <section class="home split s73 center">
      <div class="stack">
        <h1>내 사진은<br>어떤 노래일까?</h1>
        <p class="muted">사진을 넣으면 색과 분위기를 읽어 20초 남짓한 노래로 들려줘요. 같은 사진은 언제나 같은 노래예요.</p>
        <label class="btn primary big block pick" id="pick">📷 사진 고르기<input type="file" accept="image/*" id="file"></label>
        <p class="small muted dropnote">사진을 이 창에 끌어다 놓거나 Ctrl+V로 붙여넣어도 돼요.</p>
        <p id="msg" class="small msg" role="status"></p>
        <div>
          <p class="small muted">사진이 없으면 예시로 들어 보세요</p>
          <div class="samples">${SAMPLES.map(k => `<button class="sample" type="button" data-k="${k}"><span class="thumb"></span><b>${k}</b></button>`).join('')}</div>
        </div>
        <p class="small muted">🔒 사진은 이 기기 안에서만 읽어요. 어디에도 올리지 않아요.</p>
      </div>
      <div class="card how">
        <h3>이렇게 노래가 돼요</h3>
        <ol>
          <li><b>분위기</b>(밝기·선명함) → 음계와 빠르기</li>
          <li><b>왼쪽에서 오른쪽</b>으로 읽은 밝기 흐름 → 멜로디</li>
          <li><b>따뜻하고 차가운 색</b> → 악기 소리</li>
        </ol>
      </div>
    </section>`);
  root.append(view);
  const say = t => { $('#msg', view).textContent = t; };
  $$('.sample', view).forEach(b => {
    $('.thumb', b).append(sampleCanvas(b.dataset.k, 192, 144));
    b.onclick = () => { ensureCtx(); loadSample(b.dataset.k); };
  });
  $('#pick', view).addEventListener('click', ensureCtx);
  $('#file', view).onchange = e => { loadFile(e.target.files[0], say); e.target.value = ''; };
  const drag = e => { e.preventDefault(); view.classList.toggle('over', e.type === 'dragover'); };
  const drop = e => { e.preventDefault(); view.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { ensureCtx(); loadFile(f, say); } };
  const paste = e => { for (const it of (e.clipboardData && e.clipboardData.items) || []) if (/^image\//.test(it.type)) { ensureCtx(); loadFile(it.getAsFile(), say); break; } };
  addEventListener('dragover', drag); addEventListener('dragleave', drag); addEventListener('drop', drop); addEventListener('paste', paste);
  return () => { removeEventListener('dragover', drag); removeEventListener('dragleave', drag); removeEventListener('drop', drop); removeEventListener('paste', paste); };
});

/* ---------- 내 사진의 노래 / 받은 노래 ---------- */
Router.on('/song', (root, params) => {
  const code = params.get('s');
  let seed, cols, pic, recv = code != null;
  if (recv) {
    seed = L.decode(code);
    if (!seed) { toast('노래 링크가 깨졌어요. 사진으로 새로 만들어 보세요'); Router.go('/'); return; }
    cols = Array.from({ length: 16 }, (_, k) => '#' + seed.colors[k % seed.colors.length]);
    pic = scoreCanvas(seed, cols);
  } else {
    if (!cur.seed) { Router.go('/'); return; }
    ({ seed, cols, pic } = cur);
  }
  const song = C.compose(seed, 'D'), title = titleOf(seed);
  const link = location.href.split('#')[0] + '#/song?s=' + L.encode(seed);
  const why = C.explain(seed);
  const view = h(`
    <section class="song split s73">
      <div class="stack">
        ${recv ? '<p class="notice">🎁 누군가 사진으로 만든 노래예요. 사진은 오지 않고 색과 노래만 왔어요.</p>' : ''}
        <div class="stagewrap"><div class="stage"><div class="scanbar" hidden></div></div></div>
        <div class="strip" aria-hidden="true">${cols.map((c, k) => `<div style="background:${c}"><i style="bottom:${8 + seed.melody[k] * 10}%;background:${lightHex(c) ? '#111' : '#fff'}"></i></div>`).join('')}</div>
      </div>
      <div class="stack">
        <div>
          <p class="small muted">${recv ? '받은 노래' : esc(cur.name)}</p>
          <h1 class="songtitle">${esc(title)}</h1>
          <p class="muted">${esc(summaryOf(song))} · ${Math.round(song.seconds)}초</p>
        </div>
        <div class="playbar">
          <button class="btn primary big block" id="play" type="button">▶ 듣기</button>
          <p id="now" class="small now" aria-live="polite"></p>
        </div>
        ${IOS ? '<p class="small muted">소리가 안 들리면 옆면 무음 스위치를 확인해 주세요.</p>' : ''}
        <div class="card why">
          <h3>왜 이런 소리가 났을까</h3>
          <ol>${why.map(e => `<li>${e.color ? `<span class="sw" style="background:${e.color}"></span>` : ''}${esc(e.text)}</li>`).join('')}</ol>
          <details><summary>자세히</summary><ul class="small muted">${why.map(e => `<li>${esc(e.detail)}</li>`).join('')}</ul></details>
        </div>
        <div class="row share">
          <button class="btn primary grow" id="share" type="button">🔗 링크로 보내기</button>
          <button class="btn" id="copy" type="button">링크 복사</button>
        </div>
        <a class="btn ghost block" href="#/" id="again">${recv ? '📷 내 사진으로도 만들기' : '📷 다른 사진 넣기'}</a>
      </div>
    </section>`);
  $('.stage', view).prepend(pic);
  pic.setAttribute('role', 'img'); pic.setAttribute('aria-label', recv ? '받은 노래의 색 악보' : '고른 사진');
  root.append(view);

  const btn = $('#play', view), bar = $('.scanbar', view), now = $('#now', view), cells = $$('.strip > div', view);
  function stop(ended) {
    if (audio.playing) { audio.playing.stop(); audio.playing = null; }
    cancelAnimationFrame(audio.raf);
    bar.hidden = true; cells.forEach(d => d.classList.remove('on'));
    btn.textContent = '▶ 듣기';
    now.textContent = ended ? '♪ 끝! 다른 사진은 어떤 노래일까요?' : '';
    view.classList.toggle('ended', !!ended);
  }
  function play() {
    const ctx = ensureCtx();
    if (!ctx) { now.textContent = '이 브라우저는 소리 재생을 지원하지 않아요. 다른 브라우저로 열어 주세요.'; return; }
    stop();
    audio.playing = R.play(ctx, song);
    bar.hidden = false; btn.textContent = '■ 멈춤';
    tick();
  }
  function tick() {
    const p = audio.playing; if (!p) return;
    const t = audio.ctx.currentTime - p.t0;
    if (t >= song.seconds) return stop(true);
    const prog = clamp(t / song.scanSeconds, 0, 1), col = Math.min(15, Math.floor(prog * 16));
    bar.style.left = (prog * 93.75) + '%';     // 막대 폭 6.25% = 1칸. 위치는 곡 시각에서 매번 다시 계산
    cells.forEach((d, k) => d.classList.toggle('on', k === col && t < song.scanSeconds));
    const beat = t * song.bpm / 60;
    let e0 = null;
    for (const e of song.events) if (e.inst === 'lead' && e.t <= beat && beat < e.t + e.dur) e0 = e;
    now.textContent = audio.ctx.state !== 'running' ? '소리가 안 들리면 ▶를 한 번 더 눌러 주세요'
      : t < 0 ? '' : e0 ? `♪ ${col + 1}번째 칸 → "${C.NOTE_KO[e0.midi % 12]}"` : t >= song.scanSeconds ? '♪ 여운' : '♪';
    audio.raf = requestAnimationFrame(tick);
  }
  btn.onclick = () => (audio.playing ? stop() : play());
  $('#share', view).onclick = () => shareText('색의 노래', `사진으로 만든 노래 '${title}', 들어 볼래?`, link);
  $('#copy', view).onclick = () => copyText(link);

  const onKey = e => { if (e.code === 'Space' && !e.target.closest('input, textarea, select, button, a, summary')) { e.preventDefault(); btn.click(); } };
  const onVis = () => { if (document.hidden) stop(); };   // 다른 앱으로 가면 멈추고, 돌아와도 자동으로 다시 틀지 않음
  addEventListener('keydown', onKey); document.addEventListener('visibilitychange', onVis);
  if (!recv && cur.auto && audio.ctx && audio.ctx.state === 'running') play();
  cur.auto = false;
  return () => { stop(); removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); };
});

window.App = { cur, audio, titleOf, loadSample };   // 테스트용
Router.start($('#app'));
