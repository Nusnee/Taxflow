'use strict';
/**
 * qr.js — ตัวสร้าง QR Code แบบ pure JS (ไม่มี dependency)
 * byte mode, EC level M, เลือก version อัตโนมัติ (1–6, พอสำหรับลิงก์ตรวจสอบ)
 * อ้างอิงอัลกอริทึมมาตรฐาน QR (ISO/IEC 18004)
 */
const EXP = new Array(256), LOG = new Array(256);
(function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 256; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]);

// generator polynomial (index 0 = leading coefficient = 1)
function rsGenPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const p = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { p[j] ^= gmul(poly[j], EXP[i]); p[j + 1] ^= poly[j]; }
    poly = p;
  }
  return poly.reverse();
}
function rsEncode(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const res = data.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
  }
  return res.slice(data.length);
}

// version 1–6, EC level M: { ec cw per block, blocks: [[numBlocks, dataCw], ...] }
const VER = {
  1: { ec: 10, g: [[1, 16]] }, 2: { ec: 16, g: [[1, 28]] }, 3: { ec: 26, g: [[1, 44]] },
  4: { ec: 18, g: [[2, 32]] }, 5: { ec: 24, g: [[2, 43]] }, 6: { ec: 16, g: [[4, 27]] },
};
const dataCapacity = (v) => VER[v].g.reduce((s, [n, d]) => s + n * d, 0);

function chooseVersion(len) {
  for (let v = 1; v <= 6; v++) {
    const need = 4 + 8 + len * 8; // mode + 8-bit char count + data
    if (need <= dataCapacity(v) * 8) return v;
  }
  throw new Error('ข้อมูลยาวเกินไปสำหรับ QR');
}

function buildData(text) {
  const bytes = Array.from(Buffer.from(text, 'utf8'));
  const v = chooseVersion(bytes.length);
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(bytes.length, 8); bytes.forEach((b) => push(b, 8)); push(0, 4);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) dataCw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const total = dataCapacity(v), pad = [0xec, 0x11];
  let pi = 0; while (dataCw.length < total) dataCw.push(pad[pi++ % 2]);

  const cfg = VER[v], blocks = [];
  let idx = 0;
  cfg.g.forEach(([n, d]) => { for (let i = 0; i < n; i++) { const dcw = dataCw.slice(idx, idx + d); idx += d; blocks.push({ data: dcw, ec: rsEncode(dcw, cfg.ec) }); } });
  const maxData = Math.max(...blocks.map((b) => b.data.length)), out = [];
  for (let i = 0; i < maxData; i++) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
  for (let i = 0; i < cfg.ec; i++) blocks.forEach((b) => out.push(b.ec[i]));
  return { version: v, codewords: out };
}

function makeMatrix(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  function finder(r, c) {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const rr = r + i, cc = c + j; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
      m[rr][cc] = on ? 1 : 0;
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0 ? 1 : 0; m[i][6] = i % 2 === 0 ? 1 : 0; }
  m[size - 8][8] = 1; // dark module

  const centers = { 2: [18], 3: [22], 4: [26], 5: [30], 6: [34] };
  if (centers[version]) { const c = centers[version][0]; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const b = Math.max(Math.abs(i), Math.abs(j)) === 2 || (i === 0 && j === 0); m[c + i][c + j] = b ? 1 : 0; } }

  // reserve format-info modules (จะใส่ค่าจริงภายหลัง) เพื่อให้ placeData ข้าม
  const reserve = (r, c) => { if (m[r][c] === null) m[r][c] = 2; };
  for (let i = 0; i <= 5; i++) reserve(8, i);
  reserve(8, 7); reserve(8, 8); reserve(7, 8);
  for (let i = 9; i < 15; i++) reserve(14 - i, 8);
  for (let i = 0; i < 8; i++) reserve(size - 1 - i, 8);
  for (let i = 8; i < 15; i++) reserve(8, size - 15 + i);
  return m;
}

function placeData(m, codewords) {
  const size = m.length, bits = [];
  codewords.forEach((cw) => { for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1); });
  let bi = 0, upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = upward ? size - 1 - k : k;
      for (let c2 = 0; c2 < 2; c2++) {
        const cc = col - c2;
        if (m[row][cc] !== null) continue;
        let bit = bi < bits.length ? bits[bi++] : 0;
        if ((row + cc) % 2 === 0) bit ^= 1; // mask 0
        m[row][cc] = bit;
      }
    }
    upward = !upward;
  }
}

function placeFormat(m) {
  const size = m.length;
  const fmt = 0x5412; // EC level M, mask 0 (พร้อม BCH + mask pattern)
  const bit = (i) => (fmt >> i) & 1;
  for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
  m[8][7] = bit(6); m[8][8] = bit(7); m[7][8] = bit(8);
  for (let i = 9; i < 15; i++) m[14 - i][8] = bit(i);
  for (let i = 0; i < 8; i++) m[size - 1 - i][8] = bit(i);
  for (let i = 8; i < 15; i++) m[8][size - 15 + i] = bit(i);
}

function generate(text) {
  const { version, codewords } = buildData(text);
  const m = makeMatrix(version);
  placeData(m, codewords);
  placeFormat(m);
  return m.map((row) => row.map((v) => (v === 1 ? 1 : 0)));
}

function toSVG(text, opts = {}) {
  const m = generate(text), size = m.length;
  const scale = opts.scale || 4, quiet = opts.quiet ?? 4;
  const dim = (size + quiet * 2) * scale, fg = opts.fg || '#1a1a1a';
  let rects = '';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) rects += `<rect x="${(c + quiet) * scale}" y="${(r + quiet) * scale}" width="${scale}" height="${scale}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="${fg}">${rects}</g></svg>`;
}

module.exports = { generate, toSVG };
