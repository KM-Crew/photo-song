// song/render.js — 음표 이벤트 → 악기 소리(Web Audio), OfflineAudioContext 로 굽기, WAV 만들기.
// 녹음 파일 없이 계산으로 악기 소리를 만든다. 전자음(톱니파·사인파 발진기)은 쓰지 않는다.
//   통기타·하프·콘트라베이스: 줄 모델(잡음으로 튕긴 줄이 지연선을 돌며 잦아드는 방식, Karplus–Strong 확장형)
//   피아노: 배음마다 따로 잦아드는 합성(줄 굳기 때문에 살짝 높아지는 배음, 두 줄의 미세한 어긋남, 해머 소리)
//   셰이커: 걸러 낸 잡음
// 같은 음은 언제나 같은 소리(잡음 씨앗 고정). 음 하나는 한 번만 계산해 소리 장치(ctx)마다 보관한다.
// 호환 규칙(color-melody docs/prep/04-compat.md 7절): webkit 접두어 받기, cancelAndHoldAtTime 금지, 굽기는 oncomplete + Promise 둘 다.
//   LabRender.play(ctx, song)            → { t0, end, stop() }   ctx 는 버튼 클릭 안에서 만들거나 resume 한 것
//   LabRender.warm(ctx, song)            → 미리 계산(재생 버튼을 누르기 전에 불러 두면 첫 재생이 빨라짐)
//   LabRender.renderOffline(song)        → Promise<AudioBuffer> (모노 44100Hz)
//   LabRender.synthNote(inst, midi, velB, sr) → Float32Array   순수 함수, node 에서도 동작
//   LabRender.wavBytes(Float32Array, sr) → Uint8Array (16비트 모노 WAV) — 순수 함수
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var freq = function (midi) { return 440 * Math.pow(2, (midi - 69) / 12); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  function lcg(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /* ---------- 악기 음 만들기(순수 계산) ---------- */
  // 줄 악기 설정. t60: 기준 음(ref)에서 소리가 1/1000 로 줄어드는 시간(초), half: 이만큼 높아지면 절반
  // damp: 줄의 먹먹함(0~0.5, 클수록 높은 배음이 빨리 사라짐), pos: 튕기는 자리(줄 길이 대비), cut: 튕김의 밝기(Hz, 여리게·보통·세게)
  var STRING = {
    guitar: { t60: 2.6, ref: 52, half: 30, tMin: 0.9, tMax: 3.0, damp: 0.5, slope: 0.008, pos: 0.18, cut: [1700, 2800, 4400], max: 2.2, seed: 101 },
    harp:   { t60: 3.4, ref: 60, half: 28, tMin: 1.2, tMax: 4.0, damp: 0.42, slope: 0.008, pos: 0.42, cut: [800, 1300, 1900], max: 2.6, seed: 202 },
    bass:   { t60: 1.5, ref: 40, half: 40, tMin: 1.0, tMax: 1.8, damp: 0.5, slope: 0, pos: 0.27, cut: [380, 520, 700], max: 1.5, seed: 303 }
  };
  var pianoT60 = function (midi) { return clamp(7 * Math.pow(2, -(midi - 40) / 16), 1.0, 8); };

  function noteSeconds(inst, midi) {
    if (inst === 'piano') return Math.min(2.4, pianoT60(midi) * 0.9);
    var P = STRING[inst] || STRING.guitar;
    return Math.min(P.max, clamp(P.t60 * Math.pow(2, -(midi - P.ref) / P.half), P.tMin, P.tMax) * 0.85);
  }

  // 한 번 지나가는 저역 통과(1극)를 두 번. wrap 이면 끝과 처음이 이어진 것으로 본다(지연선용)
  function soften(a, fc, sr, wrap) {
    var k = 1 - Math.exp(-2 * Math.PI * fc / sr), n = a.length, y, i, pass;
    for (pass = 0; pass < 2; pass++) {
      y = 0;
      if (wrap) for (i = 0; i < n; i++) y += k * (a[i] - y);
      for (i = 0; i < n; i++) { y += k * (a[i] - y); a[i] = y; }
    }
  }

  function finishNote(out, sr) {
    var n = out.length, peak = 0, i, fin = Math.min(n, Math.floor(sr * 0.001)), fout = Math.min(n, Math.floor(sr * 0.04));
    for (i = 0; i < fin; i++) out[i] *= i / fin;                 // 첫 1ms: 딸깍 소리 방지
    for (i = 0; i < fout; i++) out[n - 1 - i] *= i / fout;       // 끝 40ms: 잘린 자리 정리
    for (i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > peak) peak = a; }
    var g = peak > 1e-9 ? 0.9 / peak : 0;
    for (i = 0; i < n; i++) out[i] *= g;                         // 가장 큰 값을 0.9 로 맞춤
    return out;
  }

  // 줄 모델: 잡음으로 채운 지연선(줄 한 바퀴)을 돌리며 저역 통과 + 감쇠. 미세 조율은 전역 통과 필터로 맞춘다
  function stringNote(out, sr, midi, velB, P) {
    var f0 = freq(midi), w0 = 2 * Math.PI * f0 / sr;
    var S = clamp(P.damp - (midi - 48) * P.slope, 0.08, 0.5);
    var t60 = clamp(P.t60 * Math.pow(2, -(midi - P.ref) / P.half), P.tMin, P.tMax);
    var gl = Math.sqrt((1 - S) * (1 - S) + S * S + 2 * S * (1 - S) * Math.cos(w0));      // 루프 필터가 기음에서 깎는 양
    var rho = Math.min(0.99995, Math.pow(10, -3 / (f0 * t60)) / gl);
    var dl = Math.atan2(S * Math.sin(w0), (1 - S) + S * Math.cos(w0)) / w0;               // 루프 필터 지연(샘플)
    var D = sr / f0 - dl, N = Math.max(2, Math.floor(D - 0.2)), d = D - N;
    var C = Math.sin((1 - d) * w0 / 2) / Math.sin((1 + d) * w0 / 2);                       // 나머지 지연 d 를 만드는 전역 통과 계수
    var line = new Float64Array(N), r = lcg(P.seed * 1000 + midi), i;
    for (i = 0; i < N; i++) line[i] = r() * 2 - 1;
    soften(line, P.cut[velB] * Math.pow(f0 / 196, 0.3), sr, true);                         // 튕김의 밝기(세게 칠수록 밝게)
    var pick = Math.max(1, Math.round(P.pos * N)), ex = new Float64Array(N), mean = 0;
    for (i = 0; i < N; i++) { ex[i] = line[i] - line[(i - pick + N) % N]; mean += ex[i]; } // 튕기는 자리에 따라 빠지는 배음
    mean /= N;
    for (i = 0; i < N; i++) line[i] = ex[i] - mean;
    var idx = 0, px = 0, ax = 0, ay = 0, n = out.length;
    for (i = 0; i < n; i++) {
      var x = line[idx], lp = rho * ((1 - S) * x + S * px); px = x;
      var y = C * lp + ax - C * ay; ax = lp; ay = y;
      line[idx] = y; if (++idx === N) idx = 0;
      out[i] = x;
    }
    return finishNote(out, sr);
  }

  // 피아노: 배음마다 감쇠 공명기 하나(y[n] = 2r·cos(w)·y[n-1] − r²·y[n-2]). 낮은 배음은 살짝 어긋난 두 줄
  function pianoNote(out, sr, midi, velB) {
    var f0 = freq(midi), n = out.length, B = clamp(3.5e-4 * Math.pow(2, (midi - 60) / 9), 1e-4, 6e-3);
    var t1 = pianoT60(midi), p = [1.9, 1.5, 1.2][velB], kc = [9, 14, 22][velB] * clamp(Math.pow(2, -(midi - 60) / 24), 0.4, 1.6);
    var top = Math.min(0.45 * sr, 9000), sum = 0, i;
    var add = function (f, amp, t60) {
      var w = 2 * Math.PI * f / sr, r = Math.pow(10, -3 / (t60 * sr)), c = 2 * r * Math.cos(w), r2 = r * r;
      var y0 = 0, y1 = amp * r * Math.sin(w), m = Math.min(n, Math.ceil(t60 * sr)), y;
      if (m > 1) out[1] += y1;
      for (var j = 2; j < m; j++) { y = c * y1 - r2 * y0; out[j] += y; y0 = y1; y1 = y; }
    };
    for (var k = 1; k <= 24; k++) {
      var fk = k * f0 * Math.sqrt(1 + B * k * k); if (fk > top) break;
      var a = Math.abs(Math.sin(Math.PI * k / 8.3)) / Math.pow(k, p) * Math.exp(-k / kc);   // 해머가 치는 자리 + 세기에 따른 밝기
      if (a < 1e-4) continue;
      var t60 = t1 / (1 + 0.22 * (k - 1));
      sum += a;
      if (k <= 8) { add(fk * 1.00046, a * 0.6, t60); add(fk * 0.99954, a * 0.4, t60 * 0.92); } // ±0.8센트
      else add(fk, a, t60);
    }
    var tn = Math.min(n, Math.floor(sr * 0.04)), th = new Float64Array(tn), r = lcg(404000 + midi);
    for (i = 0; i < tn; i++) th[i] = (r() * 2 - 1) * Math.exp(-i / (0.006 * sr));          // 해머가 닿는 둔탁한 소리
    soften(th, 900, sr, false);
    for (i = 0; i < tn; i++) out[i] += th[i] * sum * 0.5 * (1 + velB);
    return finishNote(out, sr);
  }

  // inst: 'guitar' | 'harp' | 'bass' | 'piano', velB: 0 여리게 · 1 보통 · 2 세게
  function synthInto(out, sr, inst, midi, velB) {
    velB = clamp(velB | 0, 0, 2);
    return inst === 'piano' ? pianoNote(out, sr, midi, velB) : stringNote(out, sr, midi, velB, STRING[inst] || STRING.guitar);
  }
  function synthNote(inst, midi, velB, sr) {
    sr = sr || 44100;
    return synthInto(new Float32Array(Math.ceil(noteSeconds(inst, midi) * sr)), sr, inst, midi, velB);
  }
  var velBucket = function (vel) { return vel < 0.4 ? 0 : vel < 0.58 ? 1 : 2; };

  /* ---------- 소리 장치마다 음 보관 ---------- */
  var store = typeof WeakMap !== 'undefined' ? new WeakMap() : null, MAX_NOTES = 90;
  function noteBuffer(ctx, inst, midi, velB) {
    var box = store && store.get(ctx);
    if (!box) { box = { map: {}, count: 0 }; if (store) store.set(ctx, box); }
    var key = inst + ':' + midi + ':' + velB, buf = box.map[key];
    if (buf) return buf;
    if (box.count >= MAX_NOTES) { box.map = {}; box.count = 0; }     // 오래 쓰면 비우고 다시(메모리 한도)
    buf = ctx.createBuffer(1, Math.ceil(noteSeconds(inst, midi) * ctx.sampleRate), ctx.sampleRate);
    synthInto(buf.getChannelData(0), ctx.sampleRate, inst, midi, velB);
    box.map[key] = buf; box.count++;
    return buf;
  }

  // 잡음 버퍼(셰이커·잔향용). 고정 씨앗이라 매번 같은 잡음. cut 을 주면 부드럽게 거른다
  function noiseBuffer(ctx, seconds, decay, seed, cut) {
    var n = Math.max(1, Math.floor(ctx.sampleRate * seconds)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0), r = lcg(seed), i;
    for (i = 0; i < n; i++) d[i] = (r() * 2 - 1) * (decay ? Math.pow(1 - i / n, decay) : 1);
    if (cut) { soften(d, cut, ctx.sampleRate, false); var pk = 0; for (i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); if (pk) for (i = 0; i < n; i++) d[i] /= pk; }
    return buf;
  }

  /* ---------- 곡 예약 ---------- */
  // 옛 곡(악기 구성이 없는 방식 A·B)과 옛 이름(pad, 종소리 등)도 받는다
  var LEGACY_LEAD = { piano: 'piano', bell: 'harp', pluck: 'guitar' };
  function instOf(song, e) {
    var name = song.inst ? song.inst[e.inst] : null;
    if (name) return name;
    return e.inst === 'lead' ? (LEGACY_LEAD[song.lead] || 'piano') : e.inst === 'bass' ? 'bass' : e.inst === 'spark' ? 'harp' : e.inst === 'hat' ? 'shaker' : 'piano';
  }
  // level: 음량, acc: 반주일 때 곱하는 값(멜로디보다 작게), ring: 음표 길이 뒤에 더 울리는 시간(초, −1 이면 끝까지), rel: 사라지는 시간
  var MIX = {
    guitar: { level: 0.85, acc: 0.7, ring: 0.5, rel: 0.15, roll: 0.022 },
    piano:  { level: 0.6, acc: 0.55, ring: 0.4, rel: 0.3, roll: 0.012 },
    harp:   { level: 0.65, acc: 0.6, ring: -1, rel: 0.2, roll: 0.03 },
    bass:   { level: 0.62, acc: 1, ring: 0.06, rel: 0.12, roll: 0 }
  };
  function biquad(ctx, type, f, gain, q) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (gain != null) b.gain.value = gain; if (q != null) b.Q.value = q; return b; }
  // 악기별 통로: 울림통 느낌을 내는 간단한 음색 보정
  function makeBus(ctx, name, dest) {
    var chain = name === 'guitar' ? [biquad(ctx, 'peaking', 110, 3, 1.2), biquad(ctx, 'peaking', 240, 2.5, 1.5), biquad(ctx, 'highshelf', 5000, -3)]
      : name === 'piano' ? [biquad(ctx, 'lowshelf', 180, 2), biquad(ctx, 'highshelf', 6000, -2)]
      : name === 'harp' ? [biquad(ctx, 'highshelf', 4500, -4)]
      : name === 'bass' ? [biquad(ctx, 'peaking', 90, 3, 1), biquad(ctx, 'lowpass', 1400, null, 0.5)]
      : name === 'shaker' ? [biquad(ctx, 'bandpass', 6000, null, 0.8)] : [];
    var input = ctx.createGain(), last = input;
    chain.forEach(function (n) { last.connect(n); last = n; });
    last.connect(dest);
    return input;
  }

  // 곡 전체를 ctx 시계의 t0 부터 예약한다. 돌려주는 stop() 은 남은 소리를 바로 끊는다.
  function schedule(ctx, song, t0, opts) {
    opts = opts || {};
    var spb = 60 / song.bpm, live = [], buses = {};
    var master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    master.gain.value = 0.95; comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    if (opts.reverb !== false) {                     // 방 울림: 직접 만든 감쇠 잡음(녹음된 임펄스 파일 없음)
      var conv = ctx.createConvolver(), wet = ctx.createGain(); conv.buffer = noiseBuffer(ctx, 1.4, 3, 7, 5000); wet.gain.value = 0.16;
      master.connect(conv); conv.connect(wet); wet.connect(comp);
    }
    var bus = function (name) { return buses[name] || (buses[name] = makeBus(ctx, name, master)); };
    var shake = null, lastKey = '', inChord = 0;
    song.events.forEach(function (e) {
      var name = instOf(song, e), t = t0 + e.t * spb, len = e.dur * spb, g = ctx.createGain(), s = ctx.createBufferSource();
      if (name === 'shaker') {                       // 걸러 낸 잡음을 부드럽게 올렸다 내림
        s.buffer = shake || (shake = noiseBuffer(ctx, 0.14, 0, 3));
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(e.vel * 0.55, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        s.connect(g); g.connect(bus('shaker')); s.start(t); s.stop(t + 0.13); live.push(s);
        return;
      }
      var M = MIX[name] || MIX.piano, buf = noteBuffer(ctx, name, e.midi, velBucket(e.vel)), accomp = e.inst === 'comp' || e.inst === 'pad';
      var key = e.inst + '@' + e.t; inChord = key === lastKey ? inChord + 1 : 0; lastKey = key;
      if (accomp) t += inChord * M.roll;             // 화음은 낮은 음부터 살짝 굴려서(손으로 치듯)
      var hold = M.ring < 0 || accomp ? buf.duration : Math.min(buf.duration, len + M.ring), level = e.vel * M.level * (accomp ? M.acc : 1);
      g.gain.setValueAtTime(level, t);
      if (hold < buf.duration) { g.gain.setValueAtTime(level, t + hold); g.gain.linearRampToValueAtTime(0, t + hold + M.rel); }
      s.buffer = buf; s.connect(g); g.connect(bus(name)); s.start(t); s.stop(t + Math.min(buf.duration, hold + M.rel) + 0.02); live.push(s);
    });
    return {
      t0: t0, end: t0 + song.seconds, voices: live.length,
      stop: function () {
        try { master.gain.setValueAtTime(0, ctx.currentTime); master.disconnect(); } catch (err) { /* 이미 끊김 */ }
        live.forEach(function (n) { try { n.stop(0); } catch (err) { /* 이미 멈춤 */ } });
      }
    };
  }

  // 이 곡에 필요한 음을 미리 계산해 둔다(돌려주는 값: 계산해 둔 음의 수)
  function warm(ctx, song) {
    var n = 0;
    song.events.forEach(function (e) { var name = instOf(song, e); if (name !== 'shaker') { noteBuffer(ctx, name, e.midi, velBucket(e.vel)); n++; } });
    return n;
  }

  function play(ctx, song, opts) { warm(ctx, song); return schedule(ctx, song, ctx.currentTime + 0.08, opts); }

  function renderOffline(song, sampleRate, opts) {
    var OAC = (typeof self !== 'undefined' && (self.OfflineAudioContext || self.webkitOfflineAudioContext));
    if (!OAC) return Promise.reject(new Error('이 브라우저는 소리를 파일로 구울 수 없어요'));
    sampleRate = sampleRate || 44100;
    var ctx = new OAC(1, Math.ceil(song.seconds * sampleRate), sampleRate);
    schedule(ctx, song, 0, opts);
    return new Promise(function (resolve, reject) {
      var done = false, finish = function (buf) { if (!done && buf) { done = true; resolve(buf); } };
      ctx.oncomplete = function (ev) { finish(ev.renderedBuffer); };
      try { var p = ctx.startRendering(); if (p && p.then) p.then(finish, reject); } catch (err) { reject(err); }
    });
  }

  function wavBytes(samples, sampleRate) {
    var n = samples.length, out = new Uint8Array(44 + n * 2), v = new DataView(out.buffer);
    var str = function (o, s) { for (var i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
    return out;
  }
  // 구운 소리 점검용: 최대 진폭, 평균 세기(RMS), 구간별 RMS
  function measure(samples, parts) {
    var peak = 0, sum = 0, i, seg = [], per = Math.floor(samples.length / (parts || 1)) || 1;
    for (i = 0; i < samples.length; i++) { var a = Math.abs(samples[i]); if (a > peak) peak = a; sum += a * a; }
    for (var p = 0; p < (parts || 1); p++) { var s = 0; for (i = p * per; i < (p + 1) * per && i < samples.length; i++) s += samples[i] * samples[i]; seg.push(Math.sqrt(s / per)); }
    return { peak: peak, rms: Math.sqrt(sum / (samples.length || 1)), parts: seg };
  }

  return { play: play, schedule: schedule, warm: warm, renderOffline: renderOffline, synthNote: synthNote, noteSeconds: noteSeconds, velBucket: velBucket, instOf: instOf,
    INSTRUMENTS: ['guitar', 'piano', 'harp', 'bass'], wavBytes: wavBytes, measure: measure, freq: freq };
});
