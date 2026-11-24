// lab/test/run.js — node 로 도는 자동 테스트(분석·작곡). 실행: node lab/test/run.js   (자세한 표: --verbose)
// 기준은 docs/prep/03-sonification.md 5절 "확인 방법" 칸과 docs/prep/04-compat.md 4절.
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'song', 'analyze.js'));
const C = require(path.join(__dirname, '..', 'song', 'compose.js'));
const S = require(path.join(__dirname, '..', 'song', 'samples.js'));
const R = require(path.join(__dirname, '..', 'song', 'render.js'));
const VERBOSE = process.argv.includes('--verbose');
let fail = 0;
const ok = (name, cond, extra = '') => { if (!cond) fail++; console.log(`${cond ? 'OK ' : 'NG '} ${name}${extra ? ' — ' + extra : ''}`); };
const J = JSON.stringify;

const imgs = S.KINDS.map(k => S.makeImage(k));
const feats = imgs.map(A.analyze), seeds = feats.map(C.toSeed);
const songs = {}; for (const m of C.METHODS) songs[m] = seeds.map(s => C.compose(s, m));

/* 1. 결정성 */
ok('분석: 같은 입력 2번 = 같은 결과(14장)', imgs.every((im, i) => J(A.analyze(im)) === J(feats[i])));
ok('분석: 새로 만든 같은 그림도 같은 결과', S.KINDS.every((k, i) => J(A.analyze(S.makeImage(k))) === J(feats[i])));
ok('설정값·작곡: 2번 = 같은 결과(3방식)', C.METHODS.every(m => seeds.every((s, i) => J(C.compose(C.toSeed(feats[i]), m)) === J(songs[m][i]))));
ok('설정값만으로 작곡(JSON 으로 옮겨도 같은 곡)', seeds.every((s, i) => J(C.compose(JSON.parse(J(s)), 'D')) === J(songs.D[i])));
const src = require('fs').readFileSync(path.join(__dirname, '..', 'song', 'compose.js'), 'utf8') + require('fs').readFileSync(path.join(__dirname, '..', 'song', 'analyze.js'), 'utf8');
ok('난수·시각을 쓰지 않음(Math.random, Date 없음)', !/Math\.random|Date\.now|new Date/.test(src));

/* 2. 분석 결과 형식 */
ok('형식: 팔레트 1~5색, 비율 합 ≈ 1, 큰 순', feats.every(f => f.palette.length >= 1 && f.palette.length <= 5 && Math.abs(f.palette.reduce((a, c) => a + c.share, 0) - 1) < 0.01 && f.palette.every((c, i, a) => !i || a[i - 1].share >= c.share)));
ok('형식: 세로줄 16칸, 3×3 칸 9개', feats.every(f => f.layout.columns.length === 16 && f.layout.grid.length === 9));
ok('형식: 소수 3자리 반올림', feats.every(f => Object.values(f.tone).concat(Object.values(f.texture)).every(v => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6)));
const flagOf = k => feats[S.KINDS.indexOf(k)].flags;
ok('flags: 흑백·바둑판 = grayscale, 단색 = flat, 야경 = veryDark 아님(불빛 있음)', flagOf('흑백').grayscale && flagOf('바둑판').grayscale && flagOf('단색 파랑').flat && flagOf('단색 빨강').flat && !flagOf('노을').grayscale && !flagOf('노을').flat);

/* 3. 음악 규칙 */
const pc = m => ((m % 12) + 12) % 12;
const pitched = s => s.events.filter(e => e.inst !== 'hat');
const inScale = s => pitched(s).every(e => C.SCALE[s.mode].includes(pc(e.midi - s.key)));
for (const m of C.METHODS) ok(`${m}: 음계 밖 음 없음`, songs[m].every(inScale));
ok('D: 멜로디는 5음계만', songs.D.every(s => s.events.filter(e => e.inst === 'lead').every(e => C.PENTA[s.mode].includes(pc(e.midi - s.key)))));
ok('D: 센박(1·3박) 멜로디 음은 그 마디 화음의 구성음', songs.D.every(s => {
  const chordPcs = bar => new Set(s.events.filter(e => e.inst === 'pad' && e.t === bar * 4).map(e => pc(e.midi)));
  return s.events.filter(e => e.inst === 'lead' && e.t % 2 === 0).every(e => chordPcs(Math.floor(e.t / 4)).has(pc(e.midi)));
}));
ok('D: 마지막 멜로디 음 = 으뜸음, 마지막 화음 = 으뜸화음', songs.D.every(s => {
  const lead = s.events.filter(e => e.inst === 'lead'), last = lead[lead.length - 1], bass = s.events.filter(e => e.inst === 'bass').pop();
  return pc(last.midi) === s.key && last.t === 28 && pc(bass.midi) === s.key;
}));
ok('D: 동시에 울리는 멜로디 음은 1개', songs.D.every(s => { const l = s.events.filter(e => e.inst === 'lead'); return l.every((e, i) => !i || l[i - 1].t + l[i - 1].dur <= e.t + 1e-9); }));
ok('D: 음역(멜로디 48~91, 베이스 36~48, 패드 43~67)', songs.D.every(s => s.events.every(e => e.inst === 'lead' ? e.midi >= 48 && e.midi <= 91 : e.inst === 'bass' ? e.midi >= 36 && e.midi <= 48 : e.inst === 'pad' ? e.midi >= 43 && e.midi <= 67 : true)));
ok('D: 도입 2마디에는 베이스 없음, 절정 칸은 3~6마디 안(4~11번째 칸)', songs.D.every(s => s.events.every(e => e.inst !== 'bass' || e.t >= 8)) && seeds.every(s => s.peak >= 4 && s.peak <= 11));
for (const m of C.METHODS) ok(`${m}: 길이 15~30초`, songs[m].every(s => s.seconds >= 15 && s.seconds < 30), [...new Set(songs[m].map(s => s.seconds))].sort((a, b) => a - b).join(', ') + '초');
ok('세기는 구간 값(소수 2자리)만', C.METHODS.every(m => songs[m].every(s => s.events.every(e => Math.abs(e.vel * 100 - Math.round(e.vel * 100)) < 1e-9 && e.vel > 0 && e.vel <= 1))));

/* 4. 서로 다른 그림은 다른 곡 (차이 지표: 03 문서 4-2절) */
const stat = {};
for (const m of C.METHODS) {
  const sig = songs[m].map(C.signature), dist = [];
  for (let i = 0; i < sig.length; i++) for (let j = i + 1; j < sig.length; j++) dist.push({ d: C.distance(sig[i], sig[j]), i, j });
  dist.sort((a, b) => a.d - b.d);
  stat[m] = { min: dist[0], med: dist[dist.length >> 1].d, near: dist.filter(x => x.d < 0.05).length, empty: songs[m].filter(s => !s.events.length).length, pairs: dist.length };
}
const sm = m => `최소 ${stat[m].min.d.toFixed(3)}(${S.KINDS[stat[m].min.i]}↔${S.KINDS[stat[m].min.j]}) / 중앙값 ${stat[m].med.toFixed(3)} / 거의 같은 쌍 ${stat[m].near}/${stat[m].pairs} / 빈 곡 ${stat[m].empty}장`;
ok('D: 그림 쌍 차이 최소 ≥ 0.10, 중앙값 ≥ 0.30, 거의 같은 쌍 0', stat.D.min.d >= 0.10 && stat.D.med >= 0.30 && stat.D.near === 0, sm('D'));
console.log('    (참고) B: ' + sm('B')); console.log('    (참고) A: ' + sm('A'));
ok('D·B: 모든 그림에서 음표 8개 이상(빈 곡 없음)', ['D', 'B'].every(m => songs[m].every(s => s.events.filter(e => e.inst === 'lead').length >= 8)));
const used = k => [...new Set(seeds.map(s => s[k]))].sort((a, b) => (a > b ? 1 : -1));
ok('D: 설정값이 고르게 쓰임(빠르기 4종 이상, 장·단조 둘 다, 악기 3종, 리듬 4단계 이상)', used('bpm').length >= 4 && used('mode').length === 2 && used('lead').length === 3 && used('rhythm').length >= 4,
  `빠르기 ${used('bpm')} / 조 ${used('key').length}종 / 리듬 ${used('rhythm')} / 진행 ${used('prog')} / 음역 ${used('register')} / 악기 ${used('lead')}`);

/* 5. 픽셀 ±3 잡음(브라우저마다 축소가 다른 상황 흉내) — 기준선 기록 */
const noisy = S.KINDS.map(k => C.toSeed(A.analyze(S.makeImage(k, 99))));
const notes = s => J([s.bpm, s.key, s.events.map(e => [e.t, e.midi, e.dur, e.inst])]);
const stable = m => noisy.filter((s, i) => notes(C.compose(s, m)) === notes(songs[m][i])).length;
const sameSeed = noisy.filter((s, i) => J(s) === J(seeds[i])).length;
ok('D: ±3 잡음에도 음높이·박자·빠르기가 같은 그림 ≥ 10/14', stable('D') >= 10, `D ${stable('D')}/14, B ${stable('B')}/14, A ${stable('A')}/14, 설정값 전체 일치 ${sameSeed}/14`);

/* 6. 극단 입력 */
const flat = (w, h, c, a = 255) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a; } return { data: d, width: w, height: h }; };
const extreme = { '1×1': flat(1, 1, [200, 30, 30]), '2×2': flat(2, 2, [10, 10, 10]), '검정 단색': flat(64, 64, [0, 0, 0]), '흰 단색': flat(64, 64, [255, 255, 255]), '전부 투명': flat(40, 30, [90, 200, 90], 0), '3×400 길쭉': S.makeImage('노을', 0, 3, 400), '2000×20 파노라마': S.makeImage('숲', 0, 2000, 20) };
for (const [name, im] of Object.entries(extreme)) {
  let err = '', info = '';
  try {
    const f = A.analyze(im), s = C.toSeed(f);
    for (const m of ['D', 'B']) { const song = C.compose(s, m); if (song.events.filter(e => e.inst === 'lead').length < 8 || !inScale(song) || !(song.seconds >= 15 && song.seconds < 30)) err = m + ' 곡이 규칙을 어김'; }
    C.compose(s, 'A'); C.explain(s);
    if (!f.palette.length || f.layout.columns.some(c => !c || Number.isNaN(c.l + c.s + c.lift))) err = '분석 값 누락';
    info = `${f.size.w}×${f.size.h}, 색 ${f.palette.length}개, ${s.mode} ${C.NOTE_EN[s.key]} ${s.bpm}BPM` + (f.flags.mostlyTransparent ? ', 투명→흰 배경' : '');
  } catch (e) { err = e.message; }
  ok(`극단 입력 ${name}: 오류 없이 곡이 나옴`, !err, err || info);
}
ok('잘못된 입력은 설명 있는 오류', (() => { try { A.analyze({}); return false; } catch (e) { return /필요/.test(e.message); } })());

/* 7. 4000×3000 + 분석 시간 */
const big = S.makeImage('색 덩어리', 0, 4000, 3000);
let t0 = process.hrtime.bigint(); const fb = A.analyze(big); const msBig = Number(process.hrtime.bigint() - t0) / 1e6;
ok('4000×3000: 오류 없음, 128×96 으로 줄여 분석', fb.size.w === 128 && fb.size.h === 96, `${msBig.toFixed(0)}ms(node 칸 평균 축소 포함)`);
const sb = C.toSeed(fb), s0 = seeds[S.KINDS.indexOf('색 덩어리')];
console.log(`    (참고) 4000×3000 을 줄인 것과 128×96 으로 바로 그린 것의 설정값: 조 ${sb.key === s0.key ? '같음' : '다름'}, 장단조 ${sb.mode === s0.mode ? '같음' : '다름'}, 빠르기 ${sb.bpm}/${s0.bpm}, 멜로디 칸 일치 ${sb.melody.filter((v, i) => v === s0.melody[i]).length}/16`);
const time = (fn, reps) => { fn(); const a = process.hrtime.bigint(); for (let i = 0; i < reps; i++) fn(); return Number(process.hrtime.bigint() - a) / 1e6 / reps; };
const im0 = imgs[S.KINDS.indexOf('숲')], msA = time(() => A.analyze(im0), 50), msC = time(() => C.compose(C.toSeed(feats[4]), 'D'), 200);
ok('분석 128×96 한 번 < 50ms, 작곡 < 5ms (node)', msA < 50 && msC < 5, `분석 ${msA.toFixed(2)}ms, 설정값+작곡 ${msC.toFixed(3)}ms`);

/* 8. 설명 문장 */
ok('설명: 그림마다 4~5문장, 흑백은 "색이 거의 없는" 문장', seeds.every(s => { const e = C.explain(s); return e.length >= 4 && e.length <= 5 && e.every(x => x.text && !/undefined/.test(x.text)); }) && /색이 거의 없는/.test(C.explain(seeds[S.KINDS.indexOf('흑백')])[0].text));
ok('설명: "과학적으로"·"공감각" 같은 표현 없음', seeds.every(s => !/과학|공감각|당신의 기분/.test(J(C.explain(s)))));

/* 9. WAV 만들기(순수 함수) */
const pcm = new Float32Array(44100); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 44100 * 2 * Math.PI * 440) * 0.5;
const wav = R.wavBytes(pcm, 44100), dv = new DataView(wav.buffer);
ok('WAV: 머리말 44바이트 + 16비트 모노', wav.length === 44 + 44100 * 2 && String.fromCharCode(...wav.slice(0, 4)) === 'RIFF' && dv.getUint16(22, true) === 1 && dv.getUint32(24, true) === 44100 && dv.getUint16(34, true) === 16 && dv.getUint32(40, true) === 88200);
ok('WAV: 넘치는 값은 잘라냄', (() => { const w = R.wavBytes(new Float32Array([2, -2, 0]), 8000), v = new DataView(w.buffer); return v.getInt16(44, true) === 32767 && v.getInt16(46, true) === -32767 && v.getInt16(48, true) === 0; })());

/* 10. 공유 링크용 글자열(seedlink.js) — 형식은 docs/prep/BUILD_SPEC.md 5-3절 */
const L = require(path.join(__dirname, '..', 'song', 'seedlink.js'));
const codes = seeds.map(L.encode);
ok('링크: 14장 모두 부호화되고 0-9a-z- 만 씀, 80자 이하', codes.every(c => typeof c === 'string' && /^[0-9a-z-]+$/.test(c) && c.length <= 80), `길이 ${Math.min(...codes.map(c => c.length))}~${Math.max(...codes.map(c => c.length))}자`);
ok('링크: 되돌리면 설정값이 완전히 같음(14장 + 극단 입력)', seeds.every((s, i) => J(L.decode(codes[i])) === J(s)) && [[1, 1], [2, 2], [3, 400], [2000, 20]].every(([w, h]) => { const s = C.toSeed(A.analyze({ data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h })); return J(L.decode(L.encode(s))) === J(s); }));
ok('링크: 되돌린 설정값으로 만든 곡 = 원래 곡(D)', seeds.every((s, i) => J(C.compose(L.decode(codes[i]), 'D')) === J(songs.D[i])));
const good = codes[3];
const bad = ['', 'abc', good.slice(0, -1), good + '0', '2' + good.slice(1), good.replace(/^1./, '1c'), good.slice(0, 12) + '8' + good.slice(13), good.slice(0, 28) + '3' + good.slice(29),
  good.slice(0, 10) + '3' + good.slice(11), good.toUpperCase(), good.split('-')[0], good + '-ffffff-ffffff-ffffff-ffffff-ffffff', good.replace('-', '%2D'), '<script>', null, 12, {}];
ok('링크: 깨지거나 손댄 글자열 17종은 모두 null(오류 없이)', bad.every(b => { try { return L.decode(b) === null; } catch (e) { return false; } }));
ok('링크: 틀린 설정값은 부호화하지 않음', [null, {}, Object.assign({}, seeds[0], { v: 2 }), Object.assign({}, seeds[0], { bpm: 100 }), Object.assign({}, seeds[0], { melody: [1, 2] }), Object.assign({}, seeds[0], { colors: ['zzzzzz'] })].every(s => L.encode(s) === null));
ok('링크: 되돌린 임의 글자열로도 곡 규칙이 지켜짐(음계 밖 음 0, 15~30초) — 200개', (() => {
  let st = 7; const r = n => { st = (st * 1664525 + 1013904223) >>> 0; return st % n; };
  for (let k = 0; k < 200; k++) {
    const code = '1' + r(12).toString(36) + r(2) + r(5) + r(3) + r(5) + r(3) + r(3) + r(2) + r(3) + (4 + r(8)).toString(36) + r(2) + Array.from({ length: 16 }, () => r(8)).join('') + Array.from({ length: 16 }, () => r(3)).join('') + '-' + Array.from({ length: 1 + r(5) }, () => ('00000' + r(16777216).toString(16)).slice(-6)).join('-');
    const s = L.decode(code); if (!s) return false;
    const song = C.compose(s, 'D'), root = C.rootMidi(s), sc = C.SCALE[s.mode].map(x => (root + x) % 12);
    if (song.seconds < 15 || song.seconds > 30 || !song.events.every(e => e.inst === 'hat' || sc.includes(((e.midi % 12) + 12) % 12))) return false;
  }
  return true;
})());

if (VERBOSE) {
  console.log('\n그림 | 밝기 채도 따뜻함 대비 가장자리 색수 | 조 빠르기 리듬 진행 음역 악기 | D 음표 수');
  feats.forEach((f, i) => { const s = seeds[i]; console.log(`${S.KINDS[i]} | ${f.tone.brightness} ${f.tone.saturation} ${f.tone.warmth} ${f.tone.contrast} ${f.texture.edgeDensity} ${f.palette.length} | ${C.NOTE_EN[s.key]}${s.mode} ${s.bpm} r${s.rhythm} p${s.prog} reg${s.register} ${s.lead} | ${songs.D[i].events.length} | 멜로디 ${s.melody.join('')}`); });
}
console.log(fail ? `\n실패 ${fail}건` : '\n전부 통과');
process.exit(fail ? 1 : 0);
