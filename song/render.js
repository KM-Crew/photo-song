// lab/render.js — 음표 이벤트 → Web Audio 재생, OfflineAudioContext 로 굽기, WAV 만들기.
// 샘플 파일 없이 합성만 쓴다(악기 설계: docs/prep/03-sonification.md 1-5절. 수치는 초안 — 귀로 조정 필요).
// 호환 규칙(docs/prep/04-compat.md 7절): webkit 접두어 받기, cancelAndHoldAtTime 금지, 굽기는 oncomplete + Promise 둘 다.
//   LabRender.play(ctx, song)            → { t0, end, stop() }   ctx 는 버튼 클릭 안에서 만들거나 resume 한 것
//   LabRender.renderOffline(song)        → Promise<AudioBuffer> (모노 44100Hz)
//   LabRender.wavBytes(Float32Array, sr) → Uint8Array (16비트 모노 WAV) — 순수 함수, node 에서도 동작
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var freq = function (midi) { return 440 * Math.pow(2, (midi - 69) / 12); };
  function lcg(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // 잡음 버퍼(하이햇·잔향용). 고정 씨앗이라 매번 같은 잡음
  function noiseBuffer(ctx, seconds, decay, seed) {
    var n = Math.max(1, Math.floor(ctx.sampleRate * seconds)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0), r = lcg(seed);
    for (var i = 0; i < n; i++) d[i] = (r() * 2 - 1) * (decay ? Math.pow(1 - i / n, decay) : 1);
    return buf;
  }

  function osc(ctx, type, f, detune, t, stop, dest) {
    var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(stop); return o;
  }
  // 빠르게 올라가 지수로 줄어드는 음(피아노풍·벨·플럭·베이스 공통)
  function pluckEnv(ctx, t, peak, attack, decay, dest) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest); return g;
  }

  var VOICE = {
    piano: function (ctx, e, t, len, out, live) {     // 삼각파 + 한 옥타브 위 사인파
      var dec = Math.max(0.8, Math.min(1.5, len + 0.6)), g = pluckEnv(ctx, t, e.vel * 0.5, 0.005, dec, out), g2 = ctx.createGain(); g2.gain.value = 0.3; g2.connect(g);
      live.push(osc(ctx, 'triangle', freq(e.midi), 0, t, t + dec + 0.05, g), osc(ctx, 'sine', freq(e.midi) * 2, 0, t, t + dec + 0.05, g2));
    },
    bell: function (ctx, e, t, len, out, live) {      // 사인파 + 비정수 배음
      var dec = Math.max(1.5, Math.min(2.5, len + 1.2)), g = pluckEnv(ctx, t, e.vel * 0.45, 0.003, dec, out), g2 = pluckEnv(ctx, t, e.vel * 0.09, 0.003, dec * 0.4, out);
      live.push(osc(ctx, 'sine', freq(e.midi), 0, t, t + dec + 0.05, g), osc(ctx, 'sine', freq(e.midi) * 4.01, 0, t, t + dec * 0.4 + 0.05, g2));
    },
    pluck: function (ctx, e, t, len, out, live) {     // 톱니파 + 빨리 닫히는 저역 통과 필터
      var g = pluckEnv(ctx, t, e.vel * 0.4, 0.004, 0.45, out), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.08); f.connect(g);
      live.push(osc(ctx, 'sawtooth', freq(e.midi), 0, t, t + 0.55, f));
    },
    bass: function (ctx, e, t, len, out, live) {      // 사인파 + 삼각파
      var dec = Math.max(0.6, len), g = pluckEnv(ctx, t, e.vel * 0.6, 0.01, dec, out), g2 = ctx.createGain(); g2.gain.value = 0.3; g2.connect(g);
      live.push(osc(ctx, 'sine', freq(e.midi), 0, t, t + dec + 0.05, g), osc(ctx, 'triangle', freq(e.midi), 0, t, t + dec + 0.05, g2));
    },
    pad: function (ctx, e, t, len, out, live, song) { // 톱니파 2개(±6센트) + 저역 통과 필터, 느린 어택·릴리스
      var g = ctx.createGain(), f = ctx.createBiquadFilter(), a = Math.min(0.4, len / 2), rel = 1.0;
      f.type = 'lowpass'; f.frequency.value = song.pad ? 1800 : 900; f.Q.value = 0.5;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(e.vel * 0.22, t + a); g.gain.setValueAtTime(e.vel * 0.22, t + len); g.gain.linearRampToValueAtTime(0.0001, t + len + rel);
      f.connect(g); g.connect(out);
      live.push(osc(ctx, 'sawtooth', freq(e.midi), -6, t, t + len + rel + 0.05, f), osc(ctx, 'sawtooth', freq(e.midi), 6, t, t + len + rel + 0.05, f));
    },
    hat: function (ctx, e, t, len, out, live, song, shared) { // 흰 잡음 + 고역 통과 필터 40ms
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = pluckEnv(ctx, t, e.vel * 0.5, 0.001, 0.04, out);
      s.buffer = shared.hat; f.type = 'highpass'; f.frequency.value = 7000; s.connect(f); f.connect(g); s.start(t); s.stop(t + 0.06); live.push(s);
    }
  };

  // 곡 전체를 ctx 시계의 t0 부터 예약한다. 돌려주는 stop() 은 남은 소리를 바로 끊는다.
  function schedule(ctx, song, t0, opts) {
    opts = opts || {};
    var spb = 60 / song.bpm, live = [];
    var master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    master.gain.value = 0.8; comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    if (opts.reverb !== false) {                     // 잔향: 직접 만든 감쇠 잡음(녹음된 임펄스 파일 없음)
      var conv = ctx.createConvolver(), wet = ctx.createGain(); conv.buffer = noiseBuffer(ctx, 1.4, 3, 7); wet.gain.value = 0.12;
      master.connect(conv); conv.connect(wet); wet.connect(comp);
    }
    var shared = { hat: noiseBuffer(ctx, 0.08, 0, 3) };
    song.events.forEach(function (e) {
      var name = e.inst === 'lead' ? song.lead : e.inst === 'spark' ? 'bell' : e.inst;
      (VOICE[name] || VOICE.piano)(ctx, e, t0 + e.t * spb, e.dur * spb, master, live, song, shared);
    });
    return {
      t0: t0, end: t0 + song.seconds, voices: live.length,
      stop: function () {
        try { master.gain.setValueAtTime(0, ctx.currentTime); master.disconnect(); } catch (err) { /* 이미 끊김 */ }
        live.forEach(function (n) { try { n.stop(0); } catch (err) { /* 이미 멈춤 */ } });
      }
    };
  }

  function play(ctx, song, opts) { return schedule(ctx, song, ctx.currentTime + 0.08, opts); }

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

  return { play: play, schedule: schedule, renderOffline: renderOffline, wavBytes: wavBytes, measure: measure, freq: freq };
});
