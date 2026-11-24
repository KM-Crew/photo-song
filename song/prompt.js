// song/prompt.js — 사진 분석 값 → 분위기 글 → 음악 주문서(프롬프트). 난수·시각을 쓰지 않는다(같은 사진 = 같은 글).
// 흐름: ① 사진 분석(analyze → toSeed) → ② mood(seed) 분위기를 글로 → ③ prompt(seed) 그 글로 음악 주문서 → ④ compose(seed, 'D', 주문서.spec) 음원 생성
// 곡 설정값(seed)만으로 쓰므로 링크로 받은 노래에서도 같은 글이 나온다. 글은 모두 이 기기 안에서 만든다(외부 AI·서버 없음).
//   LabPrompt.colorName('e8a05a') → '주황'
//   LabPrompt.mood(seed)   → { colors: [{ hex, name }], tags: ['따뜻한', …], text, lines: [문장…] }
//   LabPrompt.prompt(seed) → { feel: ['포근한', '느긋한'], text, lines: [문장…], spec: 악기 구성, seconds }
//   LabPrompt.title(seed)  → '포근한 산책'
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./compose.js'));
  else root.LabPrompt = factory(root.LabCompose);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // 받침이 있으면 a, 없으면 b (예: 주황'이', 파랑'이', 보라'가')
  function josa(word, a, b) {
    var code = word.charCodeAt(word.length - 1);
    if (code < 0xac00 || code > 0xd7a3) return a;
    return (code - 0xac00) % 28 ? a : b;
  }
  var avg = function (arr, from, to) { var s = 0; for (var i = from; i < to; i++) s += arr[i]; return s / (to - from); };

  /* ---------- 색 이름 ---------- */
  var HUES = [[15, '빨강'], [45, '주황'], [70, '노랑'], [100, '연두'], [160, '초록'], [190, '청록'], [215, '하늘색'], [255, '파랑'], [285, '보라'], [335, '분홍'], [361, '빨강']];
  function colorName(hex) {
    var c = C.hexHsl(String(hex).replace('#', ''));
    if (c.l < 0.1) return '검정';
    if (c.s < 0.12) return c.l > 0.85 ? '흰색' : c.l < 0.35 ? '짙은 회색' : '회색';
    var name = '빨강';
    for (var i = 0; i < HUES.length; i++) if (c.h < HUES[i][0]) { name = HUES[i][1]; break; }
    if (name === '주황' && c.l < 0.38) return '갈색';
    if (name === '파랑' && c.l < 0.28) return '남색';
    return (c.l < 0.28 ? '짙은 ' : c.l > 0.78 ? '옅은 ' : '') + name;
  }
  var isCold = function (hex) { var c = C.hexHsl(hex); return c.s >= 0.12 && c.h >= 160 && c.h < 300; };

  /* ---------- ② 분위기를 글로 ---------- */
  function mood(seed) {
    var colors = seed.colors.map(function (hex) { return { hex: '#' + hex, name: colorName(hex) }; });
    var names = []; colors.forEach(function (c) { if (names.indexOf(c.name) < 0) names.push(c.name); });
    var r = seed.register + 1, quiet = seed.rhythm <= 1, busy = seed.rhythm >= 3;
    var temp = seed.gray ? '무채색' : seed.lead === 'pluck' ? '따뜻한' : seed.lead === 'piano' ? '온화한' : isCold(seed.colors[0]) ? '차가운' : '어둑한';
    var lines = [];
    if (seed.gray) lines.push('색이 거의 없는, 흑백에 가까운 사진이에요.');
    else if (names.length === 1) lines.push(names[0] + ' 한 가지 색이 화면을 채운 ' + temp + ' 색감의 사진이에요.');
    else lines.push(names[0] + josa(names[0], '이', '가') + ' 가장 넓게 깔려 있고 ' + names.slice(1, 3).join('·') + josa(names[Math.min(2, names.length - 1)], '이', '가') + ' 섞인 ' + temp + ' 색감의 사진이에요.');
    lines.push('전체적으로 ' + ['어둡고', '밝기는 중간이고', '밝고'][r] + ' ' + (seed.gray ? (seed.dyn === 2 ? '밝은 곳과 어두운 곳의 차이가 뚜렷해요.' : '명암이 부드럽게 이어져요.') : (seed.pad ? (r === 0 ? '그 안의 색은 또렷해요.' : '색이 선명해요.') : '색이 옅고 차분해요.')));
    lines.push(quiet ? '형태가 단순해서 고요한 느낌이에요.' : busy ? '선과 무늬가 많아 활기찬 느낌이에요.' : '선과 무늬가 적당히 있어 차분하게 흐르는 느낌이에요.');
    var m = seed.melody, left = avg(m, 0, 8), right = avg(m, 8, 16), mid = avg(m, 4, 12), edge = (avg(m, 0, 4) + avg(m, 12, 16)) / 2;
    lines.push(right - left >= 0.75 ? '빛은 오른쪽으로 갈수록 환해져요.' : left - right >= 0.75 ? '빛은 왼쪽에 모여 있고 오른쪽으로 갈수록 가라앉아요.'
      : mid - edge >= 0.75 ? '빛은 가운데에 모여 있어요.' : edge - mid >= 0.75 ? '빛은 양쪽 가장자리에 모여 있어요.' : '빛은 화면에 고르게 퍼져 있어요.');
    var tags = [temp, ['어두운', '은은한', '밝은'][r], seed.gray ? (seed.dyn === 2 ? '또렷한' : '부드러운') : (seed.pad ? '선명한' : '차분한'), quiet ? '고요한' : busy ? '활기찬' : '잔잔히 흐르는'];
    return { colors: colors, tags: tags, lines: lines, text: lines.join(' ') };
  }

  /* ---------- 곡 이름 (같은 설정값 = 같은 이름) ---------- */
  var FRONT = { maj: ['포근한', '환한', '반짝이는'], min: ['짙은', '잔잔한', '서늘한'] };   // 음역 −1·0·+1
  var BACK = { 72: '자장가', 84: '오후', 96: '산책', 108: '발걸음', 120: '춤' };
  var AND = { '포근한': '포근하고', '환한': '환하고', '반짝이는': '반짝이고', '짙은': '짙고', '잔잔한': '잔잔하고', '서늘한': '서늘하고', '고요한': '고요하고' };
  var feelOf = function (seed) { return seed.gray ? '고요한' : FRONT[seed.mode][seed.register + 1]; };
  function title(seed) { return feelOf(seed) + ' ' + BACK[seed.bpm]; }

  /* ---------- ③ 음악 주문서(프롬프트) ---------- */
  function prompt(seed) {
    var spec = C.arrange(seed), K = C.INST_KO, lv = C.BPM.indexOf(seed.bpm);
    var feel = [feelOf(seed), lv <= 1 ? '느긋한' : lv === 2 ? '담담한' : seed.mode === 'maj' ? '경쾌한' : '힘 있는'];   // 빠르기에서 고른다
    var seconds = Math.round(32 * 60 / seed.bpm + Math.min(2, 240 / seed.bpm));
    var lines = [
      AND[feel[0]] + ' ' + feel[1] + ' 분위기의 어쿠스틱 연주곡.',
      K[spec.lead] + '가 멜로디를 맡고, ' + K[spec.comp] + '가 ' + (spec.comp === 'guitar' ? '화음을 한 음씩 풀어서' : '화음으로') + ' 받쳐 줍니다.',
      '3번째 마디부터 ' + K[spec.bass] + '가 낮은 음을 짚' + (spec.hat ? '고, ' + K[spec.hat] + '가 잔잔하게 박자를 더합니다.' : '습니다.'),
      C.NOTE_KO[seed.key] + (seed.mode === 'maj' ? ' 장조' : ' 단조') + ', ' + seed.bpm + 'BPM(' + (lv <= 1 ? '느리게' : lv === 2 ? '걷는 빠르기' : '빠르게') + '), 8마디 · 약 ' + seconds + '초.',
      '멜로디는 사진을 왼쪽에서 오른쪽으로 읽은 빛의 높낮이를 따라가고, ' + (seed.peak + 1) + '번째 칸에서 가장 높이 올라갑니다.',
      '전자음 없이 줄과 건반의 울림만으로.'
    ];
    return { feel: feel, lines: lines, text: lines.join(' '), spec: spec, seconds: seconds };
  }

  return { colorName: colorName, mood: mood, prompt: prompt, title: title, josa: josa };
});
