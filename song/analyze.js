// lab/analyze.js — 픽셀 배열 → 사진 특징(JSON). DOM 을 쓰지 않는 순수 함수(브라우저·node 공용).
// 형식은 docs/prep/02-image-analysis.md 6절. 모든 소수는 3자리로 반올림한다.
// 사용: LabAnalyze.analyze({ data: Uint8ClampedArray(RGBA), width, height })
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabAnalyze = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var MAX_SIDE = 128;      // 분석 크기: 긴 변 128 고정(P2 결론)
  var MIN_SHORT = 16;      // 길쭉한 사진: 짧은 변 최소 16(그때 긴 변은 최대 512)
  var MAX_LONG = 512;
  var COLS = 16;           // 세로줄 칸 수
  var EDGE_T = 80;         // 소벨 세기 기준(0~1020 중)
  var GRAY_T = 0.08;       // 평균 채도가 이보다 낮으면 흑백
  var DARK_T = 0.15;       // 밝기 95% 지점이 이보다 낮으면 아주 어두움

  var r3 = function (v) { return Math.round(v * 1000) / 1000; };
  var hex2 = function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); };
  var toHex = function (r, g, b) { return '#' + hex2(r) + hex2(g) + hex2(b); };

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d > 1e-9) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h: Math.round(h) % 360, s: r3(Math.min(1, s)), l: r3(l) };
  }

  // 분석용 축소 크기 계산(브라우저에서는 이 크기의 캔버스에 drawImage 한다)
  function targetSize(w, h) {
    var long = Math.max(w, h), short = Math.min(w, h);
    if (long <= MAX_SIDE) return { w: w, h: h };
    var k = MAX_SIDE / long;
    if (short * k < MIN_SHORT && short >= MIN_SHORT) k = Math.min(MIN_SHORT / short, MAX_LONG / long);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  // 큰 그림을 칸 평균으로 줄인다(결정적). 투명 픽셀(알파 < 128)은 평균에서 뺀다.
  function shrink(img) {
    var w = img.width, h = img.height, d = img.data, t = targetSize(w, h);
    if (t.w === w && t.h === h) return img;
    var out = new Uint8ClampedArray(t.w * t.h * 4);
    for (var ty = 0; ty < t.h; ty++) {
      var y0 = Math.floor(ty * h / t.h), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * h / t.h));
      for (var tx = 0; tx < t.w; tx++) {
        var x0 = Math.floor(tx * w / t.w), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * w / t.w));
        var sr = 0, sg = 0, sb = 0, n = 0, all = 0;
        for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
          var i = (y * w + x) * 4; all++;
          if (d[i + 3] < 128) continue;
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
        }
        var o = (ty * t.w + tx) * 4;
        if (n * 2 >= all && n) { out[o] = Math.round(sr / n); out[o + 1] = Math.round(sg / n); out[o + 2] = Math.round(sb / n); out[o + 3] = 255; }
      }
    }
    return { data: out, width: t.w, height: t.h };
  }

  // 대표색: 4비트 칸 묶기 + 서로 먼 색 고르기(지금 app.js 방식) + 비율(share)
  function palette(d, k) {
    var n = new Uint32Array(4096), sr = new Float64Array(4096), sg = new Float64Array(4096), sb = new Float64Array(4096);
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      var key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
      n[key]++; sr[key] += d[i]; sg[key] += d[i + 1]; sb[key] += d[i + 2];
    }
    var cand = [];
    for (var q = 0; q < 4096; q++) if (n[q]) {
      var c = [sr[q] / n[q], sg[q] / n[q], sb[q] / n[q]], mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
      cand.push({ key: q, c: c, score: n[q] * (0.35 + (mx ? (mx - mn) / mx : 0)) });
    }
    cand.sort(function (a, b) { return b.score - a.score || a.key - b.key; });
    var far = function (x, list, gap) { for (var j = 0; j < list.length; j++) if (Math.hypot(x.c[0] - list[j].c[0], x.c[1] - list[j].c[1], x.c[2] - list[j].c[2]) <= gap) return false; return true; };
    var picked = [], gaps = [70, 48, 30];
    for (var g = 0; g < gaps.length; g++) {
      picked = [];
      for (var m = 0; m < cand.length && picked.length < k; m++) if (far(cand[m], picked, gaps[g])) picked.push(cand[m]);
      if (picked.length >= Math.min(k, 3)) break;
    }
    if (!picked.length) return [];
    // 비율: 픽셀마다 가장 가까운 대표색에 한 표
    var cnt = new Array(picked.length).fill(0), total = 0;
    for (var p = 0; p < d.length; p += 4) {
      if (d[p + 3] < 128) continue;
      var bj = 0, bd = Infinity;
      for (var j = 0; j < picked.length; j++) { var dr = d[p] - picked[j].c[0], dg = d[p + 1] - picked[j].c[1], db = d[p + 2] - picked[j].c[2], dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; bj = j; } }
      cnt[bj]++; total++;
    }
    var out = picked.map(function (x, j) {
      var hsl = rgbToHsl(x.c[0], x.c[1], x.c[2]);
      return { hex: toHex(x.c[0], x.c[1], x.c[2]), share: r3(cnt[j] / total), h: hsl.h, s: hsl.s, l: hsl.l };
    }).filter(function (x) { return x.share > 0; });
    out.sort(function (a, b) { return b.share - a.share || a.h - b.h || (a.hex < b.hex ? -1 : 1); });
    return out;
  }

  function compositeOnWhite(img) {
    var d = img.data, out = new Uint8ClampedArray(d.length);
    for (var i = 0; i < d.length; i += 4) {
      var a = d[i + 3] / 255;
      out[i] = d[i] * a + 255 * (1 - a); out[i + 1] = d[i + 1] * a + 255 * (1 - a); out[i + 2] = d[i + 2] * a + 255 * (1 - a); out[i + 3] = 255;
    }
    return { data: out, width: img.width, height: img.height };
  }

  function analyze(input) {
    if (!input || !input.data || !(input.width > 0) || !(input.height > 0)) throw new Error('analyze: { data, width, height } 가 필요합니다');
    var img = shrink(input), mostlyTransparent = false;
    var opaque = 0, i;
    for (i = 3; i < img.data.length; i += 4) if (img.data[i] >= 128) opaque++;
    if (opaque < img.width * img.height * 0.02) { img = compositeOnWhite(img); mostlyTransparent = true; }
    var d = img.data, w = img.width, h = img.height;

    // 한 번 훑기: 밝기·채도·따뜻함·색 풍부함 + 세로줄 + 3×3 칸
    var hist = new Uint32Array(256), n = 0, sL = 0, sL2 = 0, sS = 0, sW = 0, sRG = 0, sYB = 0, sRG2 = 0, sYB2 = 0, mr = 0, mg = 0, mb = 0;
    var L = new Float32Array(w * h), ok = new Uint8Array(w * h);
    var cols = [], grid = [], x, y, p;
    for (i = 0; i < COLS; i++) cols.push({ r: 0, g: 0, b: 0, n: 0, l: 0, up: 0, s: 0 });
    for (i = 0; i < 9; i++) grid.push([0, 0, 0, 0]);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x; i = p * 4;
      if (d[i + 3] < 128) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2], l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
      L[p] = l; ok[p] = 1; n++; hist[l | 0]++; sL += l; sL2 += l * l; sS += s; sW += (r - b) / 255; mr += r; mg += g; mb += b;
      var rg = r - g, yb = 0.5 * (r + g) - b; sRG += rg; sYB += yb; sRG2 += rg * rg; sYB2 += yb * yb;
      var c = cols[Math.min(COLS - 1, Math.floor(x * COLS / w))];
      c.r += r; c.g += g; c.b += b; c.n++; c.l += l; c.up += l * (1 - (y + 0.5) / h); c.s += s;
      var gc = grid[Math.min(2, Math.floor(y * 3 / h)) * 3 + Math.min(2, Math.floor(x * 3 / w))];
      gc[0] += r; gc[1] += g; gc[2] += b; gc[3]++;
    }
    var mean = sL / n, sd = Math.sqrt(Math.max(0, sL2 / n - mean * mean));
    var pct = function (q) { var a = 0; for (var v = 0; v < 256; v++) { a += hist[v]; if (a >= q * n) return v; } return 255; };
    var mrg = sRG / n, myb = sYB / n;
    var colorfulness = Math.sqrt(Math.max(0, sRG2 / n - mrg * mrg) + Math.max(0, sYB2 / n - myb * myb)) + 0.3 * Math.hypot(mrg, myb);
    mr /= n; mg /= n; mb /= n;

    // 가장자리(소벨). 3×3 이 안 되면 0
    var strong = 0, esum = 0, ecnt = 0;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      p = y * w + x; if (!ok[p]) continue;
      var gx = -L[p - w - 1] - 2 * L[p - 1] - L[p + w - 1] + L[p - w + 1] + 2 * L[p + 1] + L[p + w + 1];
      var gy = -L[p - w - 1] - 2 * L[p - w] - L[p - w + 1] + L[p + w - 1] + 2 * L[p + w] + L[p + w + 1];
      var m = Math.hypot(gx, gy); esum += m; if (m > EDGE_T) strong++; ecnt++;
    }

    // 눈에 띄는 곳: 전체 평균색과 다른 정도의 무게중심
    var fx = 0, fy = 0, fw = 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x; if (!ok[p]) continue; i = p * 4;
      var sal = Math.hypot(d[i] - mr, d[i + 1] - mg, d[i + 2] - mb); fx += sal * (x + 0.5); fy += sal * (y + 0.5); fw += sal;
    }

    // 세로줄: 빈 칸은 가장 가까운 칸 값으로 채운다(같은 거리면 왼쪽)
    var colOut = cols.map(function (c) {
      if (!c.n) return null;
      return { hex: toHex(c.r / c.n, c.g / c.n, c.b / c.n), l: r3(c.l / c.n / 255), s: r3(c.s / c.n), lift: r3(c.l > 0 ? c.up / c.l : 0.5) };
    });
    for (i = 0; i < COLS; i++) if (!colOut[i]) {
      for (var k = 1; k < COLS; k++) {
        if (i - k >= 0 && cols[i - k].n) { colOut[i] = colOut[i - k]; break; }
        if (i + k < COLS && cols[i + k].n) { colOut[i] = colOut[i + k]; break; }
      }
    }
    colOut = colOut.map(function (c) { return { hex: c.hex, l: c.l, s: c.s, lift: c.lift }; });
    var gridOut = grid.map(function (c, j) {
      if (c[3]) return toHex(c[0] / c[3], c[1] / c[3], c[2] / c[3]);
      return colOut[Math.min(COLS - 1, Math.floor(((j % 3) + 0.5) / 3 * COLS))].hex;
    });

    var tone = {
      brightness: r3(mean / 255), p5: r3(pct(0.05) / 255), p95: r3(pct(0.95) / 255), contrast: r3(sd / 255),
      saturation: r3(sS / n), warmth: r3(sW / n), colorfulness: r3(colorfulness)
    };
    var texture = { edgeDensity: r3(ecnt ? strong / ecnt : 0), edgeMean: r3(ecnt ? esum / ecnt / 1020 : 0) };
    return {
      v: VERSION,
      size: { w: w, h: h, pixels: n },
      palette: palette(d, 5),
      tone: tone,
      texture: texture,
      layout: { columns: colOut, grid: gridOut, focus: { x: r3(fw ? fx / fw / w : 0.5), y: r3(fw ? fy / fw / h : 0.5) } },
      flags: {
        grayscale: tone.saturation < GRAY_T,
        veryDark: tone.p95 < DARK_T,
        flat: tone.contrast < 0.02 && texture.edgeDensity === 0,
        mostlyTransparent: mostlyTransparent
      }
    };
  }

  return { VERSION: VERSION, MAX_SIDE: MAX_SIDE, COLS: COLS, analyze: analyze, shrink: shrink, targetSize: targetSize, rgbToHsl: rgbToHsl };
});
