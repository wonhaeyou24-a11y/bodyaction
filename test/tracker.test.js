// 위치 추적기 테스트 (Node):  node test/tracker.test.js
// 핵심: 인식 결과가 들쭉날쭉한 간격으로 와도 화면에 그려지는 위치가 튀지 않아야 해요.
import assert from "node:assert/strict";
import { AlphaBeta } from "../tracker.js";

const tests = [];
const test = (n, f) => tests.push([n, f]);

// 결정적 난수 (테스트가 매번 같게)
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** 손이 실제로 움직이는 경로 (px) */
const truth = (t) => ({ x: 640 + Math.sin(t / 380) * 420, y: 360 + Math.cos(t / 520) * 220 });

/**
 * 시뮬레이션: 카메라 프레임마다 손을 봄(약 30fps), 인식은 불규칙하게 끝남(결과 도착 지연 40~110ms),
 * 화면은 60fps로 그림. 그려진 점의 프레임 간 이동량(튐)과 실제 위치와의 오차(지연)를 잼.
 */
function simulate(makeDrawer) {
  seed = 12345;
  const draw = makeDrawer();
  const results = [];                      // { arrive, t(촬영 시각), x, y }
  for (let t = 0; t < 4000; t += 33) {
    const p = truth(t);
    results.push({ arrive: t + 40 + rnd() * 70, t, x: p.x + (rnd() - 0.5) * 4, y: p.y + (rnd() - 0.5) * 4 });   // 카메라 잡음 ±2px
  }
  results.sort((a, b) => a.arrive - b.arrive);
  let i = 0, prev = null;
  const jumps = [], errs = [];
  for (let now = 500; now < 4000; now += 16.7) {
    while (i < results.length && results[i].arrive <= now) { draw.onResult(results[i]); i++; }
    const q = draw.at(now);
    if (prev) jumps.push(Math.hypot(q.x - prev.x, q.y - prev.y));
    const tr = truth(now);
    errs.push(Math.hypot(q.x - tr.x, q.y - tr.y));
    prev = q;
  }
  const sorted = [...jumps].sort((a, b) => a - b);
  return {
    maxJump: sorted[sorted.length - 1],
    p95Jump: sorted[Math.floor(sorted.length * 0.95)],
    // 손이 가만히 있는 게 아니라 계속 움직이는 경로라서, "실제 이동량 대비 얼마나 더 튀는지"가 중요해요
    meanErr: errs.reduce((a, b) => a + b, 0) / errs.length,
    meanJump: jumps.reduce((a, b) => a + b, 0) / jumps.length,
  };
}

// 예전 방식: 결과가 오면 그 위치로 뚝 이동 + 그 사이엔 마지막 속도로 관성 이동
const oldWay = () => {
  let x = 0, y = 0, vx = 0, vy = 0, lastT = null, lastNow = null, ex = 0, ey = 0;
  return {
    onResult(r) {
      if (lastT != null) { const k = 33 / Math.max(16, r.t - lastT); vx = (r.x - ex0) * k * 0.75 + vx * 0.25; vy = (r.y - ey0) * k * 0.75 + vy * 0.25; }
      ex0 = r.x; ey0 = r.y; x = r.x + vx * 0.8; y = r.y + vy * 0.8; lastT = r.t; lastNow = null;
    },
    at(now) {
      if (lastNow != null) { x += vx * ((now - lastNow) / 33) * 0.94; y += vy * ((now - lastNow) / 33) * 0.94; }
      lastNow = now; return { x, y };
    },
  };
};
let ex0 = 0, ey0 = 0;

const newWay = () => {
  const tr = new AlphaBeta();
  return { onResult(r) { tr.update(r.x, r.y, r.t); }, at: (now) => tr.at(now) };
};

test("새 추적기는 예전 방식보다 훨씬 덜 튐(프레임 간 최대 이동량)", () => {
  const a = simulate(oldWay), b = simulate(newWay);
  console.log(`      예전: 최대 튐 ${a.maxJump.toFixed(1)}px, 95% ${a.p95Jump.toFixed(1)}px | 새: 최대 튐 ${b.maxJump.toFixed(1)}px, 95% ${b.p95Jump.toFixed(1)}px | 평균오차 예전 ${a.meanErr.toFixed(1)} / 새 ${b.meanErr.toFixed(1)}`);
  assert.ok(b.maxJump < a.maxJump * 0.6, `튐이 충분히 줄지 않았어요: ${b.maxJump} vs ${a.maxJump}`);
  assert.ok(b.maxJump < 30, "한 프레임에 30px 넘게 튀면 안 돼요");
});
test("새 추적기는 실제 위치와도 가까움(지연이 크지 않음)", () => {
  const a = simulate(oldWay), b = simulate(newWay);
  // 오차의 대부분은 카메라+인식 지연(40~110ms) 자체라서 0이 될 수는 없어요. 예전 방식보다 나빠지지만 않으면 돼요.
  assert.ok(b.meanErr <= a.meanErr, `오차가 커졌어요: ${b.meanErr} vs ${a.meanErr}`);
});
test("가만히 있는 손은 카메라 잡음에도 거의 안 움직임", () => {
  seed = 777;
  const tr = new AlphaBeta();
  const pts = [];
  for (let t = 0; t < 3000; t += 33) { tr.update(500 + (rnd() - 0.5) * 6, 300 + (rnd() - 0.5) * 6, t); if (t > 600) pts.push(tr.at(t + 60)); }
  const xs = pts.map((p) => p.x), spread = Math.max(...xs) - Math.min(...xs);
  assert.ok(spread < 5, `가만히 있는데 ${spread.toFixed(1)}px 흔들려요`);
});
test("가만히 있다가 속도가 0으로 판정되면 예측으로 떠다니지 않음", () => {
  const tr = new AlphaBeta();
  for (let t = 0; t < 600; t += 33) tr.update(100 + t * 0.5, 200, t);      // 움직이다가
  for (let t = 600; t < 1500; t += 33) tr.update(400, 200, t);              // 멈춤
  const late = tr.at(1500 + 100);
  assert.ok(Math.abs(late.x - 400) < 6, `멈췄는데 ${late.x.toFixed(1)}`);
});
test("손이 사라지면 마지막 결과 이후 130ms까지만 예측하고 그 뒤로는 제자리", () => {
  const tr = new AlphaBeta();
  for (let t = 0; t < 600; t += 33) tr.update(100 + t, 200, t);            // 빠르게 움직임 (1px/ms)
  const a = tr.at(600 + 130), b = tr.at(600 + 5000);
  assert.ok(Math.abs(a.x - b.x) < 0.01, "130ms 이후엔 더 날아가지 않아야 해요");
});
test("갑자기 먼 곳에서 나타나면(다른 손/재인식) 바로 따라감", () => {
  const tr = new AlphaBeta();
  for (let t = 0; t < 300; t += 33) tr.update(100, 100, t);
  tr.update(1000, 600, 330);
  const p = tr.at(330);
  assert.ok(Math.abs(p.x - 1000) < 1 && Math.abs(p.y - 600) < 1);
});
test("같은/이전 시각의 결과나 reset 후 첫 결과도 안전", () => {
  const tr = new AlphaBeta();
  tr.update(10, 10, 100); tr.update(500, 500, 100); tr.update(500, 500, 50);   // 무시되어야 함
  assert.ok(Math.abs(tr.at(100).x - 10) < 1);
  tr.reset(); tr.update(300, 300, 1000);
  assert.deepEqual([tr.at(1000).x, tr.at(1000).y], [300, 300]);
});


// ---- 다른 게임이 쓰는 기준이 나빠지지 않았는지 (과일 닌자/쿵푸/풍선은 "프레임당 이동량"으로 휘두름을 판단해요) ----
function swipeProfile(makeDrawer, speedPxPerMs) {
  seed = 999;
  const draw = makeDrawer();
  const results = [];
  for (let t = 0; t < 1500; t += 33) {
    const x = 200 + Math.max(0, Math.min(500, (t - 400) * speedPxPerMs));              // 400ms부터 쭉 휘두름(500px 이동)
    results.push({ arrive: t + 40 + rnd() * 70, t, x: x + (rnd() - 0.5) * 4, y: 300 + (rnd() - 0.5) * 4 });
  }
  results.sort((a, b) => a.arrive - b.arrive);
  let i = 0, prev = null; const steps = [];
  for (let now = 100; now < 1500; now += 16.7) {
    while (i < results.length && results[i].arrive <= now) { draw.onResult(results[i]); i++; }
    const q = draw.at(now);
    if (prev) steps.push(Math.hypot(q.x - prev.x, q.y - prev.y));
    prev = q;
  }
  const first = steps.findIndex((s) => s > 10);                                          // 닌자/풍선이 "휘둘렀다"고 보는 기준(프레임당 10px)
  return { peak: Math.max(...steps), framesOver10: steps.filter((s) => s > 10).length, reachedAt: first };
}
test("휘두름: 빠른 손(1.2px/ms)의 최고 속도와 기준(10px/프레임) 이상 유지 프레임 수가 예전 이상", () => {
  const a = swipeProfile(oldWay, 1.2), b = swipeProfile(newWay, 1.2);
  console.log(`      최고속도 예전 ${a.peak.toFixed(1)} / 새 ${b.peak.toFixed(1)} px/프레임, 10px 넘는 프레임 예전 ${a.framesOver10} / 새 ${b.framesOver10}`);
  // 예전 최고 속도(250px)는 위치가 뚝 튄 가짜 값이에요. 진짜 손 속도는 1.2px/ms x 16.7ms = 프레임당 20px.
  const real = 1.2 * 16.7;
  assert.ok(b.peak >= real * 0.8 && b.peak <= real * 2.2, `최고 속도 ${b.peak.toFixed(1)} (실제 ${real.toFixed(1)} 근처여야 해요)`);
  assert.ok(b.framesOver10 >= a.framesOver10 * 0.8, "휘두름으로 인식될 프레임이 예전보다 크게 줄면 안 돼요");
});
test("휘두름: 중간 속도(0.7px/ms ≒ 초당 700px)도 기준을 넘음", () => {
  const b = swipeProfile(newWay, 0.7);
  assert.ok(b.framesOver10 >= 3, `0.7px/ms 휘두름이 ${b.framesOver10}프레임만 인식돼요`);
});
test("휘두름 반응이 예전보다 늦어지지 않음 (처음 10px 넘는 순간)", () => {
  const a = swipeProfile(oldWay, 1.0), b = swipeProfile(newWay, 1.0);
  console.log(`      처음 감지된 프레임 번호 예전 ${a.reachedAt} / 새 ${b.reachedAt}`);
  assert.ok(b.reachedAt <= a.reachedAt + 2, "반응이 2프레임(약 33ms) 넘게 늦어지면 안 돼요");
});

let failed = 0;
for (const [n, f] of tests) { try { f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", e.message); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
