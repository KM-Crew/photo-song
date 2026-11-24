// lab/samples/make.js — 시험 그림 14장을 코드로 그린다(남의 사진 없음, 결정적).
// 브라우저: LabSamples.makeImage('노을') → { data, width, height }
// node: `node lab/samples/make.js` 를 실행하면 이 폴더에 PNG 14장을 다시 만든다(384×288).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabSamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KINDS = ['단색 파랑', '단색 빨강', '가로 그라데이션', '노을', '숲', '야경', '흑백', '잡음', '세로 줄무늬', '바둑판', '파스텔', '색 덩어리', '설경', '네온'];
  var FILES = ['01-flat-blue', '02-flat-red', '03-gradient', '04-sunset', '05-forest', '06-night', '07-gray', '08-noise', '09-stripes', '10-checker', '11-pastel', '12-blobs', '13-snow', '14-neon'];
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // 무늬는 128×96 기준 좌표(gx, gy)로 그려서 크기가 달라도 같은 그림이 된다
  function makeImage(kind, noiseSeed, w, h) {
    w = w || 128; h = h || 96;
    var d = new Uint8ClampedArray(w * h * 4), idx = KINDS.indexOf(kind), r = rng(11 + idx), i, k;
    var stars = [], blobs = [], cell = [];
    for (i = 0; i < 40; i++) stars.push([Math.floor(r() * 128), Math.floor(r() * 96 * 0.6)]);
    for (i = 0; i < 7; i++) blobs.push({ x: r() * 128, y: r() * 96, rad: 10 + r() * 22, c: [r() * 255, r() * 255, r() * 255] });
    for (i = 0; i < 128 * 96; i++) cell.push([r(), r(), r()]);   // 칸마다 고정된 무작위 값(숲·잡음용)
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var gx = Math.min(127, Math.floor(x * 128 / w)), gy = Math.min(95, Math.floor(y * 96 / h)), t = gy / 96, u = gx / 128, n = cell[gy * 128 + gx], c;
      switch (kind) {
        case '단색 파랑': c = [40, 90, 200]; break;
        case '단색 빨강': c = [210, 50, 40]; break;
        case '가로 그라데이션': c = [30 + 200 * u, 80 + 60 * u, 220 - 180 * u]; break;
        case '노을': c = [250 - 130 * t, 150 - 110 * t + 30 * Math.sin(u * 6), 80 + 50 * t]; break;
        case '숲': c = t < 0.2 ? [150, 200, 230] : [30 + 50 * n[0], 90 + 90 * n[0] + 30 * Math.sin(u * 20), 30 + 40 * n[0]]; break;
        case '야경': c = (t > 0.6 && gx % 9 < 3 && gy % 7 < 3) ? [240, 200, 90] : [8 + 10 * t, 10 + 14 * t, 30 + 30 * t]; break;
        case '흑백': { var v = 40 + 180 * (0.5 + 0.5 * Math.sin(u * 9 + t * 5)); c = [v, v, v]; break; }
        case '잡음': c = [n[0] * 255, n[1] * 255, n[2] * 255]; break;
        case '세로 줄무늬': c = [[230, 60, 60], [250, 220, 70], [60, 160, 90], [60, 90, 210]][Math.floor(u * 16) % 4]; break;
        case '바둑판': c = ((gx >> 3) + (gy >> 3)) % 2 ? [245, 245, 245] : [20, 20, 20]; break;
        case '파스텔': c = [235 - 30 * u, 205 + 25 * t, 225 - 20 * t]; break;
        case '설경': c = t < 0.45 ? [205 + 20 * t, 222 + 20 * t, 245] : [240 - 12 * Math.sin(u * 5 + t * 3), 244 - 8 * Math.sin(u * 5 + t * 3), 250]; if (t > 0.3 && t < 0.5 && Math.abs(((u * 6) % 1) - 0.5) < (t - 0.3) * 1.2) c = [60, 90, 80]; break;
        case '네온': c = [14, 8, 30]; if (Math.abs(((u + t * 0.5) * 5) % 1 - 0.5) < 0.09) c = [255, 40, 190]; if (Math.abs(((u - t * 0.4 + 1) * 4) % 1 - 0.5) < 0.07) c = [30, 230, 255]; break;
        default: c = [240, 235, 225]; for (k = 0; k < blobs.length; k++) if (Math.hypot(gx - blobs[k].x, gy - blobs[k].y) < blobs[k].rad) c = blobs[k].c;
      }
      i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    if (kind === '야경') for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var sx = Math.min(127, Math.floor(x * 128 / w)), sy = Math.min(95, Math.floor(y * 96 / h));
      for (k = 0; k < stars.length; k++) if (stars[k][0] === sx && stars[k][1] === sy) { i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 230; break; }
    }
    if (noiseSeed) { var q = rng(noiseSeed); for (i = 0; i < d.length; i += 4) for (k = 0; k < 3; k++) d[i + k] += Math.round((q() - 0.5) * 6); } // ±3: 브라우저마다 축소 결과가 조금 다른 상황 흉내
    return { data: d, width: w, height: h };
  }
  return { KINDS: KINDS, FILES: FILES, makeImage: makeImage, rng: rng };
});

/* node 로 직접 실행하면 PNG 를 만든다 */
if (typeof module === 'object' && typeof require === 'function' && require.main === module) {
  const fs = require('fs'), path = require('path'), zlib = require('zlib');
  const S = module.exports;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const png = img => {
    const { data, width: w, height: h } = img, raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = data[i]; raw[o + 1] = data[i + 1]; raw[o + 2] = data[i + 2]; }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  };
  S.KINDS.forEach((kind, i) => {
    const file = path.join(__dirname, S.FILES[i] + '.png'), buf = png(S.makeImage(kind, 0, 384, 288));
    fs.writeFileSync(file, buf); console.log(S.FILES[i] + '.png', kind, buf.length + '바이트');
  });
}
