// 샌드백 펀치 판정 테스트 (Node):  node test/punch.test.js
import assert from "node:assert/strict";
import { newPunchState, stepPunch } from "../punch.js";
import { AlphaBeta } from "../tracker.js";

const tests = [];
const test = (n, f) => tests.push([n, f]);
let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const UNIT = 720;   // 화면 높이

/** 손 경로를 (카메라 → 인식 → 추적기 → 속도) 파이프라인에 통과시켜 펀치가 몇 번 나오는지 셈 */
function countPunches(path, { noise = 2, seconds = 6, tracker = true } = {}) {
  seed = 4242;
  const tr = new AlphaBeta({ alpha: 0.5, beta: 0.18 });
  const f = newPunchState();
  const results = [];
  for (let t = 0; t < seconds * 1000; t += 33) {
    const p = path(t);
    results.push({ arrive: t + 40 + rnd() * 70, t, x: p.x + (rnd() - 0.5) * 2 * noise, y: p.y + (rnd() - 0.5) * 2 * noise });
  }
  results.sort((a, b) => a.arrive - b.arrive);
  let i = 0, prev = null, vps = 0, punches = 0;
  const times = [];
  for (let now = 300; now < seconds * 1000; now += 16.7) {
    while (i < results.length && results[i].arrive <= now) { tr.update(results[i].x, results[i].y, results[i].t); i++; }
    const q = tracker ? tr.at(now) : { x: results[Math.max(0, i - 1)].x, y: results[Math.max(0, i - 1)].y };
    if (prev) {
      const inst = tracker ? Math.hypot(q.vx, q.vy) * 1000 : Math.hypot(q.x - prev.x, q.y - prev.y) / 0.0167;   // 게임과 같은 방식: 추적기 속도
      vps = vps * 0.5 + inst * 0.5;
      const r = stepPunch(f, vps, false, 0.0167, UNIT);
      if (r.strike) { punches++; times.push(now); }
    }
    prev = q;
  }
  return { punches, times };
}

test("손을 가만히 들고 있으면(카메라 잡음/손떨림) 펀치가 하나도 안 나옴", () => {
  const r = countPunches(() => ({ x: 640, y: 360 }), { noise: 3 });
  assert.equal(r.punches, 0, `가만히 있는데 ${r.punches}번 나왔어요`);
});
test("조금만 움직이는 손(천천히 흔들기)에서도 펀치가 안 나옴", () => {
  const r = countPunches((t) => ({ x: 640 + Math.sin(t / 600) * 60, y: 360 + Math.cos(t / 700) * 40 }), { noise: 3 });
  assert.equal(r.punches, 0, `${r.punches}번 나왔어요`);
});
test("보통 속도로 팔을 크게 움직여도(걷기 정도) 펀치가 안 나옴", () => {
  const r = countPunches((t) => ({ x: 640 + Math.sin(t / 450) * 200, y: 360 }), { noise: 3 });
  assert.equal(r.punches, 0, `${r.punches}번 나왔어요`);
});
test("진짜 펀치(0.15초에 화면 높이의 40%쯤 쭉 뻗기)는 반드시 인식됨", () => {
  // 1초 주기로 한 번씩 빠르게 뻗었다가 천천히 거둠
  const punchPath = (t) => {
    const ph = (t % 1000) / 1000;
    const out = ph < 0.15 ? ph / 0.15 : Math.max(0, 1 - (ph - 0.15) / 0.6);       // 0.15초에 뻗고 0.6초에 거둠
    return { x: 640, y: 560 - out * 300 };                                          // 300px(화면 높이의 40%) 이동
  };
  const r = countPunches(punchPath, { noise: 2, seconds: 6 });
  assert.ok(r.punches >= 5 && r.punches <= 6, `6번 뻗었는데 ${r.punches}번 인식 (측정 시작 전 첫 펀치는 제외)`);
});
test("연타: 초당 최대 5번을 넘지 않음 (아주 빠르게 흔들어도)", () => {
  const r = countPunches((t) => ({ x: 640 + Math.sin(t / 45) * 260, y: 360 }), { noise: 2, seconds: 4 });
  assert.ok(r.punches <= 4 * 5 + 1, `4초에 ${r.punches}번`);
  for (let i = 1; i < r.times.length; i++) assert.ok(r.times[i] - r.times[i - 1] >= 190, "펀치 간격이 0.2초보다 짧아요");
});
test("예전 방식(프레임당 6.5픽셀)은 같은 입력에서 헛펀치가 났음(비교용)", () => {
  // 위치 튐이 있는 입력(결과가 올 때마다 위치를 뚝 바꿈)을 예전 기준으로 판정
  seed = 4242;
  let x = 640, falsePunches = 0, cool = 0;
  for (let t = 0; t < 6000; t += 16.7) {
    const prev = x;
    if (Math.floor(t / 50) !== Math.floor((t - 16.7) / 50)) x = 640 + (rnd() - 0.5) * 30;   // 50ms마다 ±15px 튐
    cool = Math.max(0, cool - 0.0167);
    if (Math.abs(x - prev) > 6.5 && cool <= 0) { falsePunches++; cool = 0.11; }
  }
  assert.ok(falsePunches > 10, `예전 방식 헛펀치 ${falsePunches}번 (많아야 비교가 의미 있어요)`);
});
test("화면 크기가 달라도 같은 기준(작은 화면에서도 큰 화면에서도 헛펀치 없음)", () => {
  for (const unit of [360, 720, 1440]) {
    const f = newPunchState();
    let strikes = 0;
    for (let k = 0; k < 600; k++) strikes += stepPunch(f, unit * 0.3 + (k % 7), false, 0.0167, unit).strike ? 1 : 0;
    assert.equal(strikes, 0, `unit=${unit}`);
  }
});
test("앞으로 내지르는 동작(punchFlag)은 낮은 속도에서도 인정되고 강도는 1~2.5", () => {
  const f = newPunchState();
  const r = stepPunch(f, UNIT * 0.6, true, 0.0167, UNIT);
  assert.equal(r.strike, true);
  assert.ok(r.intensity >= 1 && r.intensity <= 2.5);
  const g = newPunchState(); stepPunch(g, UNIT * 9, false, 0.0167, UNIT);
  assert.ok(stepPunch(g, UNIT * 9, false, 0.0167, UNIT).intensity <= 2.5);
});

let failed = 0;
for (const [n, f] of tests) { try { f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", e.message); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
