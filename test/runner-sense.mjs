// 러너 점프/앉기 판정: 지금 게임이 쓰는 판정("game")과 jump.js 하나만 쓰는 판정("new")을 같은 현실적 신호(AI 20Hz→추적기→60fps)로 비교:  node test/runner-sense.mjs
import { AlphaBeta } from "../tracker.js";
import * as J from "../jump.js";
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };
// ---- 지금 게임(main.js games.runner.sense)의 판정 복사 ----
function mkGame() { return { base: null, prevY: null, prevVUp: 0, prevJump: false, lastJumpTime: 0, lastDuckTime: 0, lastStandUpTime: 0, isDuckingState: false, js: J.newJumpState() }; }
function game(s, b, dt, now) {
  let jump = false; const bv = (i, m) => b[i] && b[i].v >= m;
  const hasSh = bv(11, .18) && bv(12, .18), hasHip = bv(23, .18) && bv(24, .18); let y = null, tl = 120;
  if (hasSh) { y = (b[11].y + b[12].y) / 2; const sw = Math.hypot(b[11].x - b[12].x, b[11].y - b[12].y) || 80; tl = hasHip ? Math.max(45, (b[23].y + b[24].y) / 2 - y) : Math.max(45, sw * 1.35); }
  if (y == null) return { jump, duck: false };
  if (s.base == null) s.base = y; if (s.prevY == null) s.prevY = y;
  const dy = y - s.base, sd = Math.max(dt, .008), vUp = (s.prevY - y) / sd, aUp = (vUp - (s.prevVUp || 0)) / sd; s.prevY = y; s.prevVUp = vUp;
  if (dy >= -tl * .04 && dy <= tl * .12 && Math.abs(vUp) < tl * .35) s.base += dy * Math.min(1, dt * 1.2);
  const rising = vUp > tl * .35 || aUp > 400;
  if (s.isDuckingState) { if (dy <= tl * .12 || rising) { s.isDuckingState = false; s.lastStandUpTime = now; } } else if (dy > tl * .23 && !rising) { s.isDuckingState = true; s.lastDuckTime = now; }
  const ret = (now - s.lastDuckTime < 400) || (now - s.lastStandUpTime < 380), reached = dy < -tl * .035, blocked = ret && !reached;
  const r = J.stepJump(s.js, { y, tl, swTl: tl }, dt, now);
  const up = (r.jump && !blocked) || (!s.isDuckingState && !ret && aUp > 700 && vUp > tl * .38 && dy < tl * .02) || (!blocked && dy < -tl * .06 && vUp > 35);
  if (up && !s.prevJump && now - s.lastJumpTime > 300) { jump = true; s.lastJumpTime = now; s.isDuckingState = false; } s.prevJump = up;
  return { jump, duck: s.isDuckingState };
}
const TL = 200, FPS = 60;
const jumpAt = (t0, h, d) => (tt) => { const u = (tt - t0) / d; return u > 0 && u < 1 ? -4 * h * u * (1 - u) : 0; };
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const duckAt = (t0, depth, down, hold, up) => (tt) => depth * (ease((tt - t0) / down) - ease((tt - t0 - down - hold) / up));
function run(engine, seconds, yAt, { noise = 2, rng = mulberry(3) } = {}) {
  const trk = [11, 12, 23, 24].map(() => new AlphaBeta(BODY_AB)); const st = engine === "game" ? mkGame() : J.newJumpState();
  const jumps = [], duckT = []; let aiNext = 0;
  for (let i = 0; i < seconds * FPS; i++) {
    const tt = i / FPS, now = 1000 + tt * 1000;
    if (tt >= aiNext) { aiNext = tt + 0.05 * (0.7 + rng() * 0.6); const y = 300 + yAt(tt - 0.04); [[340, y], [460, y], [360, y + TL], [440, y + TL]].forEach(([x, yy], k) => trk[k].update(x + (rng() - 0.5) * noise, yy + (rng() - 0.5) * 2 * noise, now)); }
    const b = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 })); [11, 12, 23, 24].forEach((idx, k) => { const p = trk[k].ready ? trk[k].at(now) : { x: 0, y: 0 }; b[idx] = { x: p.x, y: p.y, v: 0.9 }; });
    const r = engine === "game" ? game(st, b, 1 / FPS, now) : J.stepJump(st, J.jumpSample(b), 1 / FPS, now);
    if (r.jump) jumps.push(tt); if (r.duck) duckT.push(tt);
  }
  return { jumps, duckT };
}
const both = (name, f) => console.log(name.padEnd(40), "game:", f("game"), " new:", f("new"));
const cnt = (e, h, d) => { let ok = 0; for (let s = 0; s < 12; s++) if (run(e, 4, jumpAt(2, h * TL, d), { rng: mulberry(10 + s) }).jumps.some((t) => t > 1.9 && t < 2.7)) ok++; return ok + "/12"; };
console.log("=== 진짜 점프 인식 ===");
for (const [h, d] of [[0.10, 0.35], [0.15, 0.4], [0.25, 0.45], [0.4, 0.55]]) both(`점프 ${Math.round(h * 100)}% ${d}s`, (e) => cnt(e, h, d));
console.log("=== 앉기 인식 (앉은 동안 중 앉기로 본 비율) ===");
for (const [dep, dn] of [[0.12, 0.3], [0.18, 0.3], [0.25, 0.3], [0.35, 0.3], [0.5, 0.25]]) both(`앉기 깊이 ${Math.round(dep * 100)}%`, (e) => { let ok = 0; for (let s = 0; s < 12; s++) { const r = run(e, 5, duckAt(2, dep * TL, dn, 0.8, 0.3), { rng: mulberry(50 + s) }); const inHold = r.duckT.filter((t) => t > 2.0 + dn + 0.15 && t < 2.0 + dn + 0.8).length; if (inHold > 0.6 * 0.65 * FPS * 0.8 / 1) ok++; } return ok + "/12 인식"; });
console.log("=== 앉았다 일어날 때 점프로 오인(12번 중) ===");
for (const dep of [0.25, 0.4]) both(`앉기 ${dep * 100}% 후 일어서기`, (e) => { let bad = 0; for (let s = 0; s < 12; s++) if (run(e, 6, duckAt(2, dep * TL, 0.3, 0.8, 0.3), { rng: mulberry(70 + s) }).jumps.length) bad++; return bad + "/12"; });
console.log("=== 점프 준비 웅크림(10~15%) 후 점프 → 앉기로 잘못 본 시간(초) ===");
both("웅크렸다 점프", (e) => { let sum = 0; for (let s = 0; s < 12; s++) { const f = (tt) => duckAt(1.6, 0.15 * TL, 0.2, 0.05, 0.1)(tt) + jumpAt(2, 0.3 * TL, 0.5)(tt); sum += run(e, 4, f, { rng: mulberry(90 + s) }).duckT.length / FPS; } return (sum / 12).toFixed(2); });
console.log("=== 가만히/흔들기/걷기 오인식 점프(회) ===");
both("서 있기 30초", (e) => run(e, 30, () => 0).jumps.length);
both("흔들기 30초", (e) => run(e, 30, (tt) => 6 * Math.sin(tt * 2 * Math.PI * 0.3) + 4 * Math.sin(tt * 2 * Math.PI)).jumps.length);
both("제자리 걷기 1.8Hz ±4%", (e) => run(e, 20, (tt) => 0.04 * TL * Math.sin(tt * 2 * Math.PI * 1.8)).jumps.length);
both("몸 좌우로 기울이기 (y 약간 출렁)", (e) => run(e, 20, (tt) => 0.05 * TL * Math.sin(tt * 2 * Math.PI * 0.7)).jumps.length);
