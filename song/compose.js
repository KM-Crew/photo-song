// lab/compose.js — 사진 특징 → 곡 설정값(씨앗) → 음표 이벤트 목록. 난수·시각을 쓰지 않는다(결정적).
// 규칙의 근거는 docs/prep/03-sonification.md (1절 음악 규칙, 6-2절 대응표, 6-3절 설정값 형식, 7절 설명 문구).
//   toSeed(features)        분석 결과를 구간 값으로 바꾼 '곡 설정값'. 공유 링크에 담을 값.
//   compose(seed, method)   'D' 분위기+스캔(추천안) / 'B' 스캔만 / 'A' 팔레트→멜로디(지금 app.js 방식)
//   explain(seed)           "왜 이런 소리가 났는지" 문장 목록
// 음표 이벤트: { t: 시작(박), dur: 길이(박), midi, vel: 0~1, inst: 'lead'|'pad'|'bass'|'spark'|'hat' }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabCompose = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PENTA = { maj: [0, 2, 4, 7, 9], min: [0, 3, 5, 7, 10] };
  var SCALE = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] };
  // 화음 진행(음계 도수, 0=으뜸). 03 문서 1-2절 표의 순서 그대로
  var PROG = { maj: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 0]], min: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6]] };
  // 한 마디 8분음표 8칸 리듬 5단계(03 문서 1-3절)
  var RHYTHM = [[1, 0, 0, 0, 1, 0, 0, 0], [1, 0, 0, 0, 1, 0, 1, 0], [1, 0, 1, 0, 1, 0, 1, 0], [1, 0, 1, 1, 1, 0, 1, 0], [1, 1, 1, 0, 1, 1, 1, 0]];
  var BPM = [72, 84, 96, 108, 120];
  var KEY_BY_HUE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // 색상 30도마다 5도권 순서
  var LEADS = ['piano', 'bell', 'pluck'];
  var BARS = 8, BEATS = 4;
  var NOTE_KO = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];
  var NOTE_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // 구간 경계(초안, 시험 그림 14장으로 맞춘 값). 값 < 경계[0] 이면 0, ... 마지막 경계 이상이면 length
  var CUT = {
    valence: [0.2, 0.36, 0.52],          // 4구간. 2 이상이면 장조
    edge: [0.01, 0.05, 0.12, 0.25],      // 5구간 → 리듬 단계
    sat: [0.12, 0.3, 0.5, 0.7],          // 5구간
    bright: [0.3, 0.62],                 // 3구간 → 음역
    contrast: [0.08, 0.2],               // 3구간 → 셈여림 폭
    lift: [0.44, 0.48, 0.52, 0.56],      // 5구간
    colL: [0.25, 0.5, 0.75],             // 4구간
    colS: [0.2, 0.5],                    // 3구간 → 세기
    warm: [-0.06, 0.12]                  // 차가움 / 중간 / 따뜻함
  };
  function bin(v, cuts) { var k = 0; while (k < cuts.length && v >= cuts[k]) k++; return k; }
  function deg(scale, base, idx) { var n = scale.length, o = Math.floor(idx / n); return base + scale[idx - o * n] + 12 * o; }
  function fold(m, lo, hi) { while (m > hi) m -= 12; while (m < lo) m += 12; return m; }
  function hexHsl(hex) {
    var r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d > 1e-9) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    return { h: h, s: s, l: l };
  }

  /* ---------- 1단계: 분석 결과 → 곡 설정값 ---------- */
  function toSeed(f) {
    var t = f.tone, gray = !!f.flags.grayscale, cols = f.layout.columns;
    var valence = 0.69 * t.brightness + 0.22 * t.saturation + 0.1 * Math.max(0, t.warmth);
    var rhythm = f.flags.flat ? 0 : bin(f.texture.edgeDensity, CUT.edge);
    var satBin = bin(t.saturation, CUT.sat);
    var warm = bin(t.warmth, CUT.warm);
    var np = f.palette.length;
    var peak = 4, best = -1;
    for (var k = 4; k < 12; k++) { var sc = Math.round(cols[k].l * (0.2 + cols[k].s) * 50); if (sc > best) { best = sc; peak = k; } } // 3~6마디 안(4~11번째 칸)
    return {
      v: 1,
      key: gray ? 9 : KEY_BY_HUE[Math.floor(f.palette[0].h / 30) % 12],
      mode: gray ? 'min' : (bin(valence, CUT.valence) >= 2 ? 'maj' : 'min'),
      bpm: BPM[Math.round((rhythm + satBin) / 2)],
      register: bin(t.brightness, CUT.bright) - 1,
      rhythm: rhythm,
      prog: f.flags.flat || np <= 2 ? 2 : np <= 4 ? 0 : 1,
      lead: f.flags.veryDark ? 'bell' : ['bell', 'piano', 'pluck'][warm],
      pad: satBin >= 2 ? 1 : 0,
      dyn: bin(t.contrast, CUT.contrast),
      peak: peak,
      gray: gray ? 1 : 0,
      melody: cols.map(function (c) { return bin(c.lift, CUT.lift) + bin(c.l, CUT.colL); }),
      vel: cols.map(function (c) { return bin(c.s, CUT.colS); }),
      colors: f.palette.map(function (c) { return c.hex.replace('#', ''); })
    };
  }

  /* ---------- 2단계: 곡 설정값 → 음표 ---------- */
  function rootMidi(seed) { return 60 + (seed.key > 6 ? seed.key - 12 : seed.key); } // 으뜸음을 C4±6반음 안으로

  // D. 분위기로 틀(조·장단조·빠르기·화음·리듬·악기) + 좌→우 스캔 멜로디 + 도입–전개–마무리
  function composeD(seed) {
    var mode = seed.mode, scale = SCALE[mode], penta = PENTA[mode], prog = PROG[mode][seed.prog];
    var root = rootMidi(seed), leadBase = root + 12 * seed.register, ev = [], peakDone = false;
    var VEL = [0.42, 0.56, 0.7], intro = [0.9, 0.8, 0.7][seed.dyn];
    var chordAt = function (bar) {
      if (bar === BARS - 1) return 0;                       // 마지막 마디는 으뜸화음
      if (bar === BARS - 2) return prog[3] === 0 ? prog[2] : prog[3];
      return prog[bar % 4];
    };
    for (var bar = 0; bar < BARS; bar++) {
      var ch = chordAt(bar), t0 = bar * BEATS, last = bar === BARS - 1;
      var section = bar < 2 ? 'intro' : bar < 6 ? 'dev' : 'close', gain = section === 'intro' ? intro : section === 'dev' ? 1 : 0.85;
      var tones = [0, 2, 4].map(function (k) { return deg(scale, root - 12, ch + k); });
      var pcs = tones.map(function (m) { return ((m % 12) + 12) % 12; });
      tones.forEach(function (m) { ev.push({ t: t0, dur: BEATS, midi: fold(m, 43, 67), vel: section === 'dev' ? 0.3 : 0.24, inst: 'pad' }); });
      if (section !== 'intro') {                            // 베이스는 전개부터
        var b0 = fold(deg(scale, root - 24, ch), 36, 48);
        ev.push({ t: t0, dur: last || seed.rhythm === 0 ? BEATS : 2, midi: b0, vel: 0.55, inst: 'bass' });
        if (!last && seed.rhythm >= 1) ev.push({ t: t0 + 2, dur: 2, midi: seed.rhythm >= 3 ? fold(deg(scale, root - 24, ch + 4), 36, 48) : b0, vel: 0.45, inst: 'bass' });
      }
      if (last) { ev.push({ t: t0, dur: BEATS, midi: fold(leadBase, 48, 91), vel: 0.6, inst: 'lead' }); break; } // 으뜸음 하나를 길게
      var pat = RHYTHM[section === 'close' ? Math.max(0, seed.rhythm - 2) : seed.rhythm];
      for (var q = 0; q < 8; q++) {
        if (!pat[q]) continue;
        var col = bar * 2 + (q >> 2), nextCol = Math.min(15, col + 1), strong = q % 4 === 0;
        var dir = seed.melody[nextCol] > seed.melody[col] ? 1 : seed.melody[nextCol] < seed.melody[col] ? -1 : (col % 2 ? -1 : 1);
        var idx = seed.melody[col] + [0, 1, 2, 1][q % 4] * dir, m = deg(penta, leadBase, idx);
        if (strong) {                                       // 센박은 그 마디 화음의 구성음
          for (var k = 0; k < 5; k++) { var c = deg(penta, leadBase, idx - k); if (pcs.indexOf(((c % 12) + 12) % 12) >= 0) { m = c; break; } }
          if (!peakDone && section === 'dev' && col === seed.peak) { m += 12; peakDone = true; } // 절정: 한 옥타브 위 1번
        }
        var steps = 1; while (q + steps < 8 && !pat[q + steps] && steps < 4) steps++;
        ev.push({ t: t0 + q / 2, dur: steps / 2, midi: fold(m, 48, 91), vel: Math.round(VEL[seed.vel[col]] * gain * (strong ? 1 : 0.85) * 100) / 100, inst: 'lead' });
      }
      if (section === 'dev' && seed.pad === 1 && seed.lead !== 'bell') ev.push({ t: t0 + 3, dur: 1, midi: fold(tones[1] + 24, 72, 96), vel: 0.2, inst: 'spark' }); // 반짝임
      if (section !== 'intro' && seed.rhythm >= 3) for (var hq = 0; hq < 8; hq++) ev.push({ t: t0 + hq / 2, dur: 0.25, midi: 0, vel: hq % 2 ? 0.08 : 0.13, inst: 'hat' });
    }
    return finish('D', seed, seed.bpm, seed.key, mode, seed.lead, ev);
  }

  // B. 스캔만: C장조 5음계·96BPM 고정. 칸마다 2박, 두 음
  function composeB(seed) {
    var ev = [];
    for (var k = 0; k < 16; k++) {
      var a = seed.melody[k], b = Math.max(0, a + seed.vel[k] - 1), v = [0.45, 0.55, 0.65][seed.vel[k]];
      if (k === 15) { ev.push({ t: k * 2, dur: 2, midi: 60, vel: 0.6, inst: 'lead' }); break; }
      ev.push({ t: k * 2, dur: 1, midi: deg(PENTA.maj, 60, a), vel: v, inst: 'lead' });
      ev.push({ t: k * 2 + 1, dur: 1, midi: deg(PENTA.maj, 60, b), vel: Math.round((v - 0.08) * 100) / 100, inst: 'lead' });
    }
    return finish('B', seed, 96, 0, 'maj', 'piano', ev);
  }

  // A. 팔레트 → 멜로디(지금 app.js 규칙): C 5음계 고정, 색상 36도마다 한 음, 108BPM. 채도 낮은 색은 음이 없다
  function composeA(seed) {
    var ev = [], pal = seed.colors.map(hexHsl).filter(function (c) { return c.s >= 0.12; });
    for (var s = 0; s < 64 && pal.length; s++) {
      var c = pal[s % pal.length], oct = c.l < 0.3 ? -1 : c.l > 0.72 ? 1 : 0;
      ev.push({ t: s / 2, dur: 0.5, midi: deg(PENTA.maj, 60 + 12 * oct, Math.floor(c.h / 36) % 10), vel: [0.45, 0.6, 0.75][bin(c.s, [0.4, 0.7])], inst: 'lead' });
      if (s % 4 === 0) ev.push({ t: s / 2, dur: 2, midi: fold(deg(PENTA.maj, 36, Math.floor(pal[0].h / 36) % 10), 36, 48), vel: 0.45, inst: 'bass' });
    }
    return finish('A', seed, 108, 0, 'maj', 'piano', ev);
  }

  function finish(method, seed, bpm, key, mode, lead, ev) {
    ev.sort(function (a, b) { return a.t - b.t || (a.inst < b.inst ? -1 : a.inst > b.inst ? 1 : a.midi - b.midi); });
    var beats = BARS * BEATS, spb = 60 / bpm;
    return {
      method: method, bpm: bpm, key: key, mode: mode, lead: lead, pad: seed.pad, bars: BARS, beats: beats,
      scanSeconds: Math.round(beats * spb * 1000) / 1000,               // 재생 막대가 사진을 지나가는 시간
      seconds: Math.round((beats * spb + Math.min(2, BEATS * spb)) * 1000) / 1000, // 여운 포함 전체 길이
      events: ev
    };
  }

  function compose(seed, method) {
    if (method === 'A') return composeA(seed);
    if (method === 'B') return composeB(seed);
    return composeD(seed);
  }

  /* ---------- 설명 문장(구간 값에서 고른다) ---------- */
  function explain(seed) {
    var out = [];
    if (seed.gray) out.push({ k: 'mode', text: '색이 거의 없는 사진이라 밝고 어두움만으로 멜로디를 만들었어요', detail: '흑백 → 라 단조 고정' });
    else if (seed.mode === 'maj') out.push({ k: 'mode', text: '밝고 선명한 사진이라 환한 느낌의 음계를 골랐어요', detail: '장조' });
    else out.push({ k: 'mode', text: '어둡고 차분한 사진이라 잔잔한 느낌의 음계를 골랐어요', detail: '단조' });
    var lv = BPM.indexOf(seed.bpm);   // 음의 촘촘함은 리듬 단계에서, 빠르기 말은 실제 빠르기에서 고른다(둘이 어긋나지 않게)
    var pace = (seed.rhythm <= 1 ? '단순하고 고요한 사진이라 음을 듬성듬성 놓고 ' : seed.rhythm === 2 ? '적당히 짜임새 있는 사진이라 음을 알맞게 놓고 ' : '무늬와 선이 많은 사진이라 음을 촘촘하게 놓고 ')
      + (lv <= 1 ? '느리게 연주해요' : lv === 2 ? '걷는 빠르기로 연주해요' : '빠르게 연주해요');
    out.push({ k: 'pace', text: pace, detail: seed.bpm + 'BPM · 리듬 ' + seed.rhythm + '단계' });
    if (!seed.gray) out.push({ k: 'key', text: '가장 넓은 색이 이 곡의 중심음 \'' + NOTE_KO[seed.key] + '\'를 정했어요', color: '#' + seed.colors[0], detail: NOTE_EN[seed.key] + (seed.mode === 'maj' ? ' 장조' : ' 단조') });
    out.push({ k: 'scan', text: '사진을 왼쪽에서 오른쪽으로 읽었어요. 밝은 곳이 위에 있을수록 높은 음이 나요', detail: '세로줄 16칸 → 8마디' });
    out.push({ k: 'lead', text: { pluck: '따뜻한 색이 많아 통통 튀는 줄 소리로 연주해요', piano: '따뜻함과 차가움이 반반이라 피아노 느낌의 소리로 연주해요', bell: '차갑거나 어두운 색이 많아 맑은 종소리로 연주해요' }[seed.lead], detail: seed.lead });
    return out;
  }

  /* ---------- 테스트·비교용 지표(03 문서 4-2절 정의) ---------- */
  function signature(song) {
    var pc = new Array(12).fill(0), contour = new Array(64).fill(0);
    song.events.forEach(function (e) {
      if (e.inst === 'hat') return;
      pc[e.midi % 12] += e.dur;
      if (e.inst === 'lead') { var k = Math.round(e.t * 2); if (k < 64) contour[k] = Math.max(contour[k], e.midi); }
    });
    return { pc: pc, contour: contour, bpm: song.bpm };
  }
  // 0=같음, 1=전혀 다름: 0.3×음 구성 + 0.5×멜로디 윤곽 + 0.2×빠르기
  function distance(a, b) {
    var dot = 0, na = 0, nb = 0, i;
    for (i = 0; i < 12; i++) { dot += a.pc[i] * b.pc[i]; na += a.pc[i] * a.pc[i]; nb += b.pc[i] * b.pc[i]; }
    var dpc = na && nb ? 1 - dot / Math.sqrt(na * nb) : (na || nb ? 1 : 0), dc = 0;
    for (i = 0; i < 64; i++) dc += (!a.contour[i] !== !b.contour[i]) ? 1 : Math.min(12, Math.abs(a.contour[i] - b.contour[i])) / 12;
    return 0.3 * dpc + 0.5 * dc / 64 + 0.2 * Math.min(1, Math.abs(a.bpm - b.bpm) / 48);
  }

  return {
    METHODS: ['D', 'B', 'A'], METHOD_NAME: { D: '분위기 + 스캔', B: '스캔만', A: '팔레트(지금 방식)' },
    PENTA: PENTA, SCALE: SCALE, PROG: PROG, RHYTHM: RHYTHM, BPM: BPM, LEADS: LEADS, CUT: CUT, NOTE_KO: NOTE_KO, NOTE_EN: NOTE_EN,
    toSeed: toSeed, compose: compose, explain: explain, rootMidi: rootMidi, signature: signature, distance: distance
  };
});
