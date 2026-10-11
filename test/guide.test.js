// 카메라 세팅 안내의 판정 규칙 테스트 (Node):  node test/guide.test.js
import assert from "node:assert/strict";
import { judgeBrightness, judgeHand, judgeBody } from "../guide.js";

const tests = [];
const test = (n, f) => tests.push([n, f]);

// 몸 33점을 만들어 주는 도우미: 기본은 화면 가운데에 전신이 잘 보이는 상태
function body(over = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
  lm[0] = { x: 0.5, y: 0.15, visibility: 0.99 };                          // 코
  lm[11] = { x: 0.42, y: 0.3, visibility: 0.99 }; lm[12] = { x: 0.58, y: 0.3, visibility: 0.99 };
  lm[25] = { x: 0.44, y: 0.7, visibility: 0.99 }; lm[26] = { x: 0.56, y: 0.7, visibility: 0.99 };
  lm[27] = { x: 0.44, y: 0.92, visibility: 0.99 }; lm[28] = { x: 0.56, y: 0.92, visibility: 0.99 };
  for (const [i, v] of Object.entries(over)) lm[i] = { ...lm[i], ...v };
  return lm;
}
const hand = (size, n = 1) => Array.from({ length: n }, () => Array.from({ length: 21 }, (_, i) => (i === 9 ? { x: 0.5 + size, y: 0.5 } : { x: 0.5, y: 0.5 })));

test("밝기: 어두움/보통/너무 밝음 구분", () => {
  assert.equal(judgeBrightness(30).level, "bad");
  assert.equal(judgeBrightness(70).level, "warn");
  assert.equal(judgeBrightness(130).level, "ok");
  assert.equal(judgeBrightness(240).level, "warn");
  assert.equal(judgeBrightness(NaN).level, "none");
});
test("손: 안 보임 / 너무 멀음 / 너무 가까움 / 좋음", () => {
  assert.equal(judgeHand([]).level, "none");
  assert.equal(judgeHand(null).level, "none");
  assert.equal(judgeHand(hand(0.03)).level, "far");
  assert.equal(judgeHand(hand(0.5)).level, "close");
  assert.equal(judgeHand(hand(0.2)).level, "ok");
  assert.match(judgeHand(hand(0.2, 2)).text, /두 손/);
});
test("몸: 안 보임 / 발이 잘림 / 너무 멀음 / 전신 OK", () => {
  assert.equal(judgeBody(null).level, "none");
  assert.equal(judgeBody(body()).level, "ok");
  assert.equal(judgeBody(body({ 27: { y: 1.1 }, 28: { y: 1.1 } })).level, "partial", "발목이 화면 밖");
  assert.equal(judgeBody(body({ 27: { visibility: 0.1 } })).level, "partial", "발목이 안 보임");
  assert.equal(judgeBody(body({ 0: { visibility: 0.1 } })).level, "none", "얼굴이 안 보임");
  assert.equal(judgeBody(body({ 0: { y: 0.55 }, 27: { y: 0.9 }, 28: { y: 0.9 } })).level, "far", "사람이 너무 작음");
  assert.equal(judgeBody(body({ 11: { x: 1.0 } })).level, "none", "어깨가 화면 밖");
});
test("안내 문구는 모두 한국어로 비어 있지 않음", () => {
  for (const r of [judgeBrightness(10), judgeHand([]), judgeBody(null), judgeBody(body())]) assert.ok(r.text.length > 3);
});

let failed = 0;
for (const [n, f] of tests) { try { f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", e.message); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
