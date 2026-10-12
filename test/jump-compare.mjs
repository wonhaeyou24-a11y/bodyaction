// 예전 판정과 새 판정을 "실제와 비슷한 신호(AI 20Hz → 추적기 → 60fps)"로 비교하는 진단 도구:  node test/jump-compare.mjs
import { AlphaBeta } from "../tracker.js";
import * as NEW from "../jump.js";

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };

// ---- 예전 판정 (복사) ----
function mkOld() { return { base: null, prevY: null, prevVUp: 0, prevJump: false, lastJumpTime: 0, lastDuckTime: 0 }; }
function old(st, b, dt, now) {
  let jump = false, duck = false, y = null, tl = 120;
  const bv = (i, m) => b[i] && b[i].v >= m; const hasSh = bv(11, .25) && bv(12, .25), hasHip = bv(23, .25) && bv(24, .25);
  if (hasSh && hasHip) { const shY = (b[11].y + b[12].y) / 2, hipY = (b[23].y + b[24].y) / 2; y = (shY + hipY) / 2; tl = Math.max(40, hipY - shY); } else if (hasSh) { y = (b[11].y + b[12].y) / 2; tl = 100; }
  if (y === null) return { jump, duck };
  if (st.base == null) st.base = y; if (st.prevY == null) st.prevY = y;
  const dy = y - st.base; if (dy >= -tl * .05 && dy <= tl * .10) st.base += dy * Math.min(1, dt * 1.5);
  if (dy > tl * .15) { duck = true; st.lastDuckTime = now; }
  const sd = Math.max(dt, .008), vUp = (st.prevY - y) / sd, aUp = (vUp - (st.prevVUp || 0)) / sd; st.prevY = y; st.prevVUp = vUp;
  const rec = (now - st.lastDuckTime < 280) || (dy >= -tl * .03);
  const up = (!rec && (aUp > 750 && vUp > 35)) || (!rec && (vUp > tl * .85 || vUp > 110)) || (dy < -tl * .09 && (now - st.lastDuckTime > 200));
  if (up && !st.prevJump && now - st.lastJumpTime > 340) { jump = true; st.lastJumpTime = now; } st.prevJump = up; return { jump, duck };
}

const TL = 200, FPS = 60;
const jumpAt = (t0, h, d) => (tt) => { const u = (tt - t0) / d; return u > 0 && u < 1 ? -4 * h * u * (1 - u) : 0; };

/** engine: "old" | "new" | {sample, step, state} ; scenario: yAt(t) */
function run(engine, seconds, yAt, { noise = 2, aiHz = 20, hipFlicker = false, shVis = 0.9, rng = mulberry(3) } = {}) {
  const trk = [11, 12, 23, 24].map(() => new AlphaBeta(BODY_AB));
  const st = engine === "old" ? mkOld() : NEW.newJumpState();
  let jumps = [], aiNext = 0;
  const lastMeas = {};
  for (let i = 0; i < seconds * FPS; i++) {
    const tt = i / FPS, now = 1000 + tt * 1000;
    if (tt >= aiNext) {                              // AI 결과 도착(간격도 약간 들쭉날쭉)
      aiNext = tt + (1 / aiHz) * (0.7 + rng() * 0.6);
      const y = 300 + yAt(tt - 0.04);                // 카메라/AI 지연 40ms
      const pts = [[340, y], [460, y], [360, y + TL], [440, y + TL]];
      pts.forEach(([x, yy], k) => trk[k].update(x + (rng() - 0.5) * noise, yy + (rng() - 0.5) * 2 * noise, now));
    }
    const hipVis = hipFlicker ? (Math.floor(tt * 7) % 2 === 0 ? 0.9 : 0.1) : 0.9;
    const b = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    [11, 12, 23, 24].forEach((idx, k) => { const p = trk[k].ready ? trk[k].at(now) : { x: 0, y: 0 }; b[idx] = { x: p.x, y: p.y, v: idx < 20 ? shVis : hipVis }; });
    const dt = 1 / FPS;
    const r = engine === "old" ? old(st, b, dt, now) : NEW.stepJump(st, NEW.jumpSample(b), dt, now);
    if (r.jump) jumps.push(tt);
  }
  return jumps;
}

const report = (name, f) => console.log(name.padEnd(34), "old:", f("old"), " new:", f("new"));
console.log("=== 진짜 점프 인식(10번 중 몇 번) ===");
for (const [h, d] of [[0.10, 0.35], [0.15, 0.4], [0.2, 0.4], [0.3, 0.5], [0.45, 0.55]]) {
  report(`점프 높이 ${Math.round(h * 100)}% ${d}s`, (e) => { let ok = 0; for (let s = 0; s < 10; s++) { const j = run(e, 4, jumpAt(2, h * TL, d), { rng: mulberry(10 + s) }); if (j.filter((t) => t > 1.9 && t < 2.6).length >= 1) ok++; } return ok + "/10"; });
}
console.log("=== 가만히/흔들기/물러서기 중 오인식(회) ===");
report("서 있기 30초", (e) => run(e, 30, () => 0).length);
report("흔들기 30초", (e) => run(e, 30, (tt) => 6 * Math.sin(tt * 2 * Math.PI * 0.3) + 4 * Math.sin(tt * 2 * Math.PI)).length);
report("뒤로 물러서기", (e) => run(e, 12, (tt) => -Math.min(tt, 5) / 5 * 0.35 * TL).length);
report("골반 깜박임 20초", (e) => run(e, 20, () => 0, { hipFlicker: true }).length);
report("걷기(0.9Hz ±4%)", (e) => run(e, 20, (tt) => 0.04 * TL * Math.sin(tt * 2 * Math.PI * 0.9)).length);
report("제자리 걷기(1.8Hz ±6%)", (e) => run(e, 20, (tt) => 0.06 * TL * Math.sin(tt * 2 * Math.PI * 1.8)).length);
console.log("=== 어깨 신뢰도가 낮은 환경(0.35) 점프 인식 ===");
report("높이 25% 어깨v=0.35", (e) => { let ok = 0; for (let s = 0; s < 10; s++) { const j = run(e, 4, jumpAt(2, 0.25 * TL, 0.45), { shVis: 0.35, rng: mulberry(40 + s) }); if (j.filter((t) => t > 1.9 && t < 2.6).length >= 1) ok++; } return ok + "/10"; });
report("제자리 걷기 현실적(1.8Hz ±3%)", (e) => run(e, 20, (tt) => 0.03 * TL * Math.sin(tt * 2 * Math.PI * 1.8)).length);
report("가볍게 몸 튕기기(1.2Hz ±4%)", (e) => run(e, 20, (tt) => 0.04 * TL * Math.sin(tt * 2 * Math.PI * 1.2)).length);
