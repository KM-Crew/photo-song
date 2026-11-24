// lab/seedlink.js — 곡 설정값(compose.js 의 toSeed 결과) ↔ 공유 링크용 짧은 글자열
// 형식 설명: docs/prep/BUILD_SPEC.md 5-3절. 쓰는 글자는 0-9, a-z, '-' 뿐이라 주소에 그대로 넣을 수 있다.
//   encode(seed)   → "1" + 머리 11자 + 멜로디 16자 + 세기 16자 + ("-" + 색 6자)×1~5   (51~79자)
//   decode(글자열) → 곡 설정값, 형식이 조금이라도 어긋나면 null (받은 링크는 믿지 않는다)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabSeedLink = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var BPM = [72, 84, 96, 108, 120];
  var LEADS = ['piano', 'bell', 'pluck'];
  var MODES = ['min', 'maj'];
  // 머리 11자의 순서와 허용 범위(낮은 값, 높은 값). 한 글자 = 36진수 한 자리
  var HEAD = [
    ['key', 0, 11], ['mode', 0, 1], ['bpm', 0, 4], ['register', 0, 2], ['rhythm', 0, 4], ['prog', 0, 2],
    ['lead', 0, 2], ['pad', 0, 1], ['dyn', 0, 2], ['peak', 4, 11], ['gray', 0, 1]
  ];
  var RE = /^1[0-9a-b]{11}[0-7]{16}[0-2]{16}(-[0-9a-f]{6}){1,5}$/;

  function isInt(v, lo, hi) { return typeof v === 'number' && v === Math.floor(v) && v >= lo && v <= hi; }

  // 설정값이 형식에 맞는지(부호화 전 확인, 복호화 뒤 확인에 같이 쓴다)
  function valid(s) {
    if (!s || s.v !== 1) return false;
    if (!isInt(s.key, 0, 11) || MODES.indexOf(s.mode) < 0 || BPM.indexOf(s.bpm) < 0 || !isInt(s.register, -1, 1)) return false;
    if (!isInt(s.rhythm, 0, 4) || !isInt(s.prog, 0, 2) || LEADS.indexOf(s.lead) < 0 || !isInt(s.pad, 0, 1)) return false;
    if (!isInt(s.dyn, 0, 2) || !isInt(s.peak, 4, 11) || !isInt(s.gray, 0, 1)) return false;
    if (!Array.isArray(s.melody) || s.melody.length !== 16 || !s.melody.every(function (v) { return isInt(v, 0, 7); })) return false;
    if (!Array.isArray(s.vel) || s.vel.length !== 16 || !s.vel.every(function (v) { return isInt(v, 0, 2); })) return false;
    if (!Array.isArray(s.colors) || s.colors.length < 1 || s.colors.length > 5) return false;
    return s.colors.every(function (c) { return typeof c === 'string' && /^[0-9a-f]{6}$/.test(c); });
  }

  function encode(seed) {
    if (!valid(seed)) return null;
    var n = { key: seed.key, mode: MODES.indexOf(seed.mode), bpm: BPM.indexOf(seed.bpm), register: seed.register + 1, rhythm: seed.rhythm,
      prog: seed.prog, lead: LEADS.indexOf(seed.lead), pad: seed.pad, dyn: seed.dyn, peak: seed.peak, gray: seed.gray };
    return '1' + HEAD.map(function (h) { return n[h[0]].toString(36); }).join('') + seed.melody.join('') + seed.vel.join('') + '-' + seed.colors.join('-');
  }

  function decode(str) {
    if (typeof str !== 'string' || str.length > 80 || !RE.test(str)) return null;
    var n = {}, i;
    for (i = 0; i < HEAD.length; i++) {
      var v = parseInt(str.charAt(1 + i), 36);
      if (!(v >= HEAD[i][1] && v <= HEAD[i][2])) return null;
      n[HEAD[i][0]] = v;
    }
    var digits = function (from) { var out = []; for (var k = 0; k < 16; k++) out.push(+str.charAt(from + k)); return out; };
    var seed = {
      v: 1, key: n.key, mode: MODES[n.mode], bpm: BPM[n.bpm], register: n.register - 1, rhythm: n.rhythm, prog: n.prog,
      lead: LEADS[n.lead], pad: n.pad, dyn: n.dyn, peak: n.peak, gray: n.gray,
      melody: digits(12), vel: digits(28), colors: str.slice(45).split('-')
    };
    return valid(seed) ? seed : null;
  }

  return { VERSION: 1, valid: valid, encode: encode, decode: decode };
});
