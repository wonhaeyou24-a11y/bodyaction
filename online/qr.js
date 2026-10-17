// QR 코드 만들기 (바이트 모드 · 오류정정 L · 버전 1~6 → 한글 없이 최대 134글자). 서버·외부 도구 없이 이 파일만으로 돌아가요.
// 휴대폰 카메라로 비추면 초대 링크가 바로 열리게 하려고 써요. (node online/test/qr.test.js)

// ---------- 오류 정정(Reed–Solomon) ----------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function generator(deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) { const n = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], EXP[i]); } g = n; }
  return g;
}
export function rsEncode(data, ecLen) {
  const g = generator(ecLen), res = new Array(ecLen).fill(0);
  for (const b of data) { const f = b ^ res[0]; res.shift(); res.push(0); if (f) for (let i = 0; i < ecLen; i++) res[i] ^= mul(g[i + 1], f); }
  return res;
}

// 버전별: 블록 수, 블록당 데이터 코드워드, 블록당 오류정정 코드워드 (오류정정 수준 L)
const VERSIONS = { 1: [1, 19, 7], 2: [1, 34, 10], 3: [1, 55, 15], 4: [1, 80, 20], 5: [1, 108, 26], 6: [2, 68, 18] };
export const MAX_BYTES = 134;

/** 서식 정보 15비트 (오류정정 수준 L = 01, 마스크 번호 0~7) */
export function formatBits(mask) {
  const data = (1 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0,
];

/** 데이터 코드워드(+오류정정)를 순서대로 섞은 전체 코드워드 */
export function buildCodewords(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 0;
  for (let v = 1; v <= 6; v++) { const [nb, dpb] = VERSIONS[v]; if (4 + 8 + 8 * bytes.length <= nb * dpb * 8) { ver = v; break; } }
  if (!ver) throw new Error("QR로 만들기에는 주소가 너무 길어요");
  const [nb, dpb, epb] = VERSIONS[ver], cap = nb * dpb * 8;
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(bytes.length, 8); bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let p = 0; data.length < nb * dpb; p++) data.push(p % 2 ? 0x11 : 0xec);
  const blocks = [], ecs = [];
  for (let b = 0; b < nb; b++) { const d = data.slice(b * dpb, (b + 1) * dpb); blocks.push(d); ecs.push(rsEncode(d, epb)); }
  const out = [];
  for (let i = 0; i < dpb; i++) for (const b of blocks) out.push(b[i]);
  for (let i = 0; i < epb; i++) for (const e of ecs) out.push(e[i]);
  return { ver, codewords: out, data, nb, dpb, epb };
}

/** QR 모양 만들기. 반환: { size, get(row, col) → true=검정, mask } */
export function makeQr(text) {
  const { ver, codewords } = buildCodewords(text);
  const size = 17 + 4 * ver;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };            // x = 가로(열), y = 세로(행)
  // 찾기 무늬 3개 + 흰 테두리, 타이밍 줄
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); setFn(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (let i = 0; i < size; i++) { if (!fn[6][i]) setFn(i, 6, i % 2 === 0); if (!fn[i][6]) setFn(6, i, i % 2 === 0); }
  if (ver >= 2) { const p = size - 7; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(p + dx, p + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  // 서식 정보 자리(나중에 채움) + 항상 검은 칸
  const drawFormat = (mask) => {
    const bits = formatBits(mask), bit = (i) => ((bits >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  // 데이터 놓기: 오른쪽 아래에서 두 칸 폭으로 지그재그
  const bits = []; for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let k = 0, up = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) { const x = col - c; if (!fn[row][x]) { mod[row][x] = k < bits.length ? bits[k] === 1 : false; k++; } }
    }
    up = !up;
  }
  // 마스크 8가지 중 가장 읽기 좋은 것 고르기
  const applyMask = (m) => { for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && MASKS[m](r, c)) mod[r][c] = !mod[r][c]; };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const s = penalty(mod, size); if (s < bestScore) { bestScore = s; best = m; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return { size, version: ver, mask: best, get: (r, c) => mod[r][c] };
}

function penalty(m, n) {
  let p = 0;
  const line = (get) => {                                      // 한 줄에서: 같은 색이 5개 이상 이어지면, 찾기 무늬와 닮은 모양이면 벌점
    let run = 1, s = 0;
    for (let i = 1; i < n; i++) { if (get(i) === get(i - 1)) run++; else { if (run >= 5) s += 3 + (run - 5); run = 1; } }
    if (run >= 5) s += 3 + (run - 5);
    const str = Array.from({ length: n }, (_, i) => (get(i) ? "1" : "0")).join("");
    for (const pat of ["00001011101", "10111010000"]) { let at = str.indexOf(pat); while (at !== -1) { s += 40; at = str.indexOf(pat, at + 1); } }
    return s;
  };
  for (let i = 0; i < n; i++) { p += line((j) => m[i][j]); p += line((j) => m[j][i]); }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
  let dark = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
  p += 10 * (Math.ceil(Math.abs((dark * 100) / (n * n) - 50) / 5) - 1 < 0 ? 0 : Math.ceil(Math.abs((dark * 100) / (n * n) - 50) / 5) - 1);
  return p;
}

/** 캔버스에 그리기 (바깥 여백 4칸 포함, 흰 바탕에 검정) */
export function drawQr(canvas, text, px = 220) {
  const qr = makeQr(text), quiet = 4, cells = qr.size + quiet * 2, s = Math.floor(px / cells) || 1, dim = s * cells;
  canvas.width = dim; canvas.height = dim;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = "#000";
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.get(r, c)) ctx.fillRect((c + quiet) * s, (r + quiet) * s, s, s);
  return qr;
}
