// 좌우 이동(레인) 판정 테스트: node test/lane.test.js  — 합성한 몸 흔들림/기울이기/스텝/떨림을 추적기(AI 20Hz+잡음)까지 거쳐서 확인
import { LANE, newLaneState, stepLane } from "../lane.js";
import { AlphaBeta } from "../tracker.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const SW = 150, FPS = 60;
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };

/** 몸 중심 x(어깨너비 단위, 0=가운데)의 움직임 xAt(t)을 AI 20Hz+잡음+추적기를 거쳐 판정에 넣어요. 길이 바뀐 시각들을 돌려줌 */
function run(seconds, xAt, { noise = 2.5, seed = 1, scale = 1 } = {}) {
  const rng = mulberry(seed), trk = new AlphaBeta(BODY_AB), s = newLaneState(); const changes = []; let aiNext = 0, last = 0;
  for (let i = 0; i < seconds * FPS; i++) {
    const tt = i / FPS, now = 1000 + tt * 1000;
    if (tt >= aiNext) { aiNext = tt + 0.05 * (0.7 + rng() * 0.6); trk.update(640 + xAt(tt - 0.04) * SW * scale + (rng() - 0.5) * 2 * noise, 400, now); }
    const x = trk.ready ? trk.at(now).x : 640;
    const lane = stepLane(s, (x - 640) / (SW * scale), 1 / FPS);
    if (lane !== last) { changes.push([tt, lane]); last = lane; }
  }
  return { changes, lane: s.lane };
}
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const moveTo = (t0, from, to, dur) => (tt) => from + (to - from) * ease((tt - t0) / dur);

t("가만히 서 있기(잡음) 30초: 길이 안 바뀜", () => { ok(run(30, () => 0).changes.length === 0, "바뀜"); });
t("숨쉬기·체중 이동(±0.15 어깨너비, 0.4Hz): 길이 안 바뀜", () => { ok(run(30, (tt) => 0.15 * Math.sin(tt * 2 * Math.PI * 0.4)).changes.length === 0, "바뀜"); });
t("옆으로 한 걸음(0.8 어깨너비, 0.3초)하면 그쪽 길로, 돌아오면 가운데로 (좌우 모두)", () => {
  for (const dir of [-1, 1]) { const r = run(6, (tt) => (tt < 1 ? 0 : tt < 3 ? moveTo(1, 0, 0.8 * dir, 0.3)(tt) : moveTo(3, 0.8 * dir, 0, 0.3)(tt))); ok(r.changes.length === 2 && r.changes[0][1] === dir && r.changes[1][1] === 0, JSON.stringify(r.changes)); ok(r.changes[0][0] < 1.5, "반응 늦음 " + r.changes[0][0]); }
});
t("몸을 옆으로 기울이기(0.55 어깨너비)도 인식, 작은 기울임(0.3)은 무시", () => {
  ok(run(5, (tt) => moveTo(1, 0, 0.6, 0.35)(tt)).changes[0]?.[1] === 1, "기울이기");
  ok(run(5, (tt) => moveTo(1, 0, 0.3, 0.35)(tt)).changes.length === 0, "작은 기울임");
});
t("경계(0.5)에서 덜덜 떨어도 길이 왔다 갔다 하지 않음 (히스테리시스: 3번 이하)", () => { const r = run(20, (tt) => 0.46 + 0.07 * Math.sin(tt * 2 * Math.PI * 3)); ok(r.changes.length <= 3, "바뀜 " + r.changes.length); });
t("한 프레임 튄 값(인식 오류)은 길을 바꾸지 못함", () => { ok(run(5, (tt) => (Math.abs(tt - 2) < 0.5 / FPS ? 1.2 : 0)).changes.length === 0, "바뀜"); });
t("천천히 한쪽으로 밀려도(5초 동안 0.6 어깨너비) 기준이 따라가서 길이 안 바뀜 (제자리 걷다 밀림)", () => { ok(run(12, (tt) => 0.6 * Math.min(1, tt / 5)).changes.length === 0, "바뀜"); });
t("카메라와 거리가 달라도(어깨너비 100~250px) 같은 동작이면 같은 결과", () => {
  for (const scale of [100 / SW, 1, 250 / SW]) { const r = run(5, (tt) => moveTo(1, 0, 0.8, 0.3)(tt), { scale }); ok(r.changes[0]?.[1] === 1, `크기 ${scale}`); }
});
t("몸이 안 보이면(NaN) 직전 길 유지, 이상한 값도 안전", () => {
  const s = newLaneState(); for (let i = 0; i < 30; i++) stepLane(s, 0, 1 / 60); for (let i = 0; i < 30; i++) stepLane(s, 0.9, 1 / 60); ok(s.lane === 1, "옆 길");
  for (const v of [NaN, undefined, null, Infinity]) stepLane(s, v, 1 / 60); ok(s.lane === 1, "유지"); stepLane(s, 1e9, 1 / 60); ok(Number.isFinite(s.d) && Math.abs(s.d) <= LANE.MAXN, "범위");
});
t("연속으로 빠르게 좌→우 전환(양쪽 한 걸음씩)해도 따라감", () => {
  const r = run(8, (tt) => (tt < 1 ? 0 : tt < 3 ? moveTo(1, 0, -0.8, 0.3)(tt) : tt < 5 ? moveTo(3, -0.8, 0.8, 0.5)(tt) : moveTo(5, 0.8, 0, 0.3)(tt)));
  ok(r.changes.map((c) => c[1]).join() === "-1,0,1,0" || r.changes.map((c) => c[1]).join() === "-1,1,0", "순서 " + JSON.stringify(r.changes));
});
console.log(`좌우 이동: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
