// QR 코드 만들기 시험: node online/test/qr.test.js
// 표준 예제값(오류정정, 서식 정보)과 맞는지 확인하고, 만든 QR을 따로 짠 "읽기" 코드로 다시 읽어서 원래 글자가 나오는지 확인해요.
import assert from "node:assert/strict";
import { makeQr, buildCodewords, rsEncode, formatBits, MAX_BYTES } from "../qr.js";

const tests = [], test = (n, f) => tests.push([n, f]);
const bin15 = (v) => v.toString(2).padStart(15, "0");

test("오류정정 코드: 표준 예제('HELLO WORLD', 버전1-M, 10개)와 같음", () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});
test("서식 정보 8가지: 표준 표(오류정정 L)와 모두 같음", () => {
  const std = ["111011111000100", "111001011110011", "111110110101010", "111100010011101", "110011000101111", "110001100011000", "110110001000001", "110100101110110"];
  std.forEach((v, m) => assert.equal(bin15(formatBits(m)), v, `마스크 ${m}`));
});

// ----- 따로 짠 읽기 코드 (만드는 코드와 같은 함수를 쓰지 않고 칸 종류를 다시 계산해요) -----
function isFunction(n, ver, r, c) {
  if (r < 9 && c < 9) return true;                                  // 왼쪽 위 찾기 무늬 + 서식
  if (r < 9 && c >= n - 8) return true;                              // 오른쪽 위
  if (r >= n - 8 && c < 9) return true;                              // 왼쪽 아래 (서식 칸과 검은 칸 포함)
  if (r === 6 || c === 6) return true;                               // 타이밍 줄
  if (ver >= 2 && Math.abs(r - (n - 7)) <= 2 && Math.abs(c - (n - 7)) <= 2) return true;   // 정렬 무늬
  if (r === 8 && c >= n - 8) return true;                            // 서식(오른쪽)
  return false;
}
const TABLE = { 1: [1, 19, 7], 2: [1, 34, 10], 3: [1, 55, 15], 4: [1, 80, 20], 5: [1, 108, 26], 6: [2, 68, 18] };
const MASK = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0];
function decode(qr) {
  const n = qr.size, g = (r, c) => (qr.get(r, c) ? 1 : 0), ver = (n - 17) / 4;
  // 서식 정보 두 군데 읽기
  const a = [], b = [];
  for (let i = 0; i <= 5; i++) a[i] = g(i, 8); a[6] = g(7, 8); a[7] = g(8, 8); a[8] = g(8, 7); for (let i = 9; i < 15; i++) a[i] = g(8, 14 - i);
  for (let i = 0; i < 8; i++) b[i] = g(8, n - 1 - i); for (let i = 8; i < 15; i++) b[i] = g(n - 15 + i, 8);
  const va = a.reduce((s, x, i) => s | (x << i), 0), vb = b.reduce((s, x, i) => s | (x << i), 0);
  assert.equal(va, vb, "서식 정보 두 군데가 달라요");
  let rem = va ^ 0x5412; for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  assert.equal(rem, 0, "서식 정보 검사 실패");
  const ec = ((va ^ 0x5412) >> 13) & 3, mask = ((va ^ 0x5412) >> 10) & 7;
  assert.equal(ec, 1, "오류정정 수준이 L이어야 해요");
  // 데이터 읽기
  const bits = []; let up = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < n; i++) { const row = up ? n - 1 - i : i; for (let k = 0; k < 2; k++) { const c = col - k; if (!isFunction(n, ver, row, c)) bits.push(g(row, c) ^ (MASK[mask](row, c) ? 1 : 0)); } }
    up = !up;
  }
  const cw = []; for (let i = 0; i + 8 <= bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const [nb, dpb, epb] = TABLE[ver];
  assert.equal(cw.length, nb * (dpb + epb), "코드워드 개수");
  const dataBlocks = Array.from({ length: nb }, () => []), ecBlocks = Array.from({ length: nb }, () => []);
  let p = 0; for (let i = 0; i < dpb; i++) for (let k = 0; k < nb; k++) dataBlocks[k].push(cw[p++]);
  for (let i = 0; i < epb; i++) for (let k = 0; k < nb; k++) ecBlocks[k].push(cw[p++]);
  for (let k = 0; k < nb; k++) assert.deepEqual(rsEncode(dataBlocks[k], epb), ecBlocks[k], `블록 ${k} 오류정정이 안 맞아요`);
  const flat = dataBlocks.flat(), bs = flat.map((x) => x.toString(2).padStart(8, "0")).join("");
  assert.equal(bs.slice(0, 4), "0100", "바이트 모드");
  const len = parseInt(bs.slice(4, 12), 2), out = [];
  for (let i = 0; i < len; i++) out.push(parseInt(bs.slice(12 + 8 * i, 20 + 8 * i), 2));
  return new TextDecoder().decode(Uint8Array.from(out));
}
function checkPatterns(qr) {
  const n = qr.size, g = (r, c) => qr.get(r, c);
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) for (let dr = 0; dr < 7; dr++) for (let dc = 0; dc < 7; dc++) {
    const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3)); assert.equal(g(r0 + dr, c0 + dc), d !== 2, `찾기 무늬 (${r0},${c0})`);
  }
  for (let i = 8; i < n - 8; i++) { assert.equal(g(6, i), i % 2 === 0, "가로 타이밍"); assert.equal(g(i, 6), i % 2 === 0, "세로 타이밍"); }
  assert.equal(g(n - 8, 8), true, "항상 검은 칸");
}

const SAMPLES = ["A", "KABOOM-A7X9K2", "https://example.com/?room=KABOOM-ABC234", "https://wonhaeyou24-a11y.github.io/bodyaction/index.html?room=KABOOM-ABC234", "한글도 돼요 😀", "x".repeat(MAX_BYTES), "y".repeat(60), "z".repeat(107)];
for (const text of SAMPLES) test(`만든 QR을 다시 읽으면 원래 글자가 나옴 — ${text.length}글자 (${new TextEncoder().encode(text).length}바이트)`, () => {
  const qr = makeQr(text); checkPatterns(qr); assert.equal(decode(qr), text);
});
test("너무 긴 주소는 안내하고 멈춤 (134바이트 초과)", () => assert.throws(() => makeQr("x".repeat(MAX_BYTES + 1)), /너무 길어요/));
test("글자가 길수록 버전(크기)이 커짐", () => { assert.equal(makeQr("A").version, 1); assert.ok(makeQr("x".repeat(100)).version >= 5); assert.ok(makeQr("x".repeat(134)).version === 6); });
test("같은 글자는 항상 같은 QR", () => { const a = makeQr("hello world"), b = makeQr("hello world"); for (let r = 0; r < a.size; r++) for (let c = 0; c < a.size; c++) assert.equal(a.get(r, c), b.get(r, c)); });

let failed = 0;
for (const [n, f] of tests) { try { f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", String(e.message).split("\n")[0]); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
