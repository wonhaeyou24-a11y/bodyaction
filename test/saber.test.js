// 광선검 휘두름 판정 시험: node test/saber.test.js   (비교표를 보려면 --report)
// 가상의 사람이 (거리·휘두르는 속도·프레임 속도를 바꿔 가며) 베거나, 가만히 서 있거나 점프·걷기·기울이기를 할 때
// 실제와 같은 경로(AI 20Hz, 잡음, 지연 → 추적기 → 판정)로 "예전 판정(old)"과 "새 판정(new)"이 휘두름을 얼마나 잘 알아보고, 엉뚱한 때 오인하는지 비교해요.
import { AlphaBeta } from "../tracker.js";
import { ArmVel } from "../armtrack.js";
import { newSwingState, stepSwing } from "../swing.js";
import { mulberry } from "./bots.js";

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };

/** 사람: U=몸통 길이(px). slashes=[{t0, D}] 오른손으로 위에서 아래로 베기, bodyMove(tt)→{dx,dy} 몸 전체 움직임 */
function human(U, slashes, bodyMove = () => ({ dx: 0, dy: 0 })) {
  const sw = 0.67 * U;
  return (tt) => {
    const m = bodyMove(tt), sx = 640 + m.dx, sy = 300 + m.dy;
    let f = 0, g = 0, slashing = false;
    for (const s of slashes) { const u = (tt - s.t0) / s.D; if (u > 0 && u < 1) { f = Math.sin(Math.PI * u) ** 0.7; g = ease(u); slashing = true; } }   // g: 위(0) → 아래(1)
    const wx = sx + sw / 2 + sw * 0.6 - g * sw * 1.3, wy = sy - 0.5 * U + g * 1.4 * U, rest = [sx + sw / 2 + sw * 0.12, sy + 1.05 * U];
    const w = slashing ? [wx, wy] : rest;
    return { P: { 11: [sx - sw / 2, sy], 12: [sx + sw / 2, sy], 16: w }, z: -f * U * 0.3, sw };
  };
}

/** 한 번 돌려서 판정별 휘두름 신호 시각들을 돌려줘요 (old: 프레임당 7px, new: 어깨 기준 속도) */
function run(H, { secs, fps = 60, aiHz = 20, noise = 2.5, seed = 1, lat = 0.04 }) {
  const rng = mulberry(seed), g = () => (rng() + rng() + rng() - 1.5) * 2;
  const trk = { 12: new AlphaBeta(BODY_AB), 16: new AlphaBeta(BODY_AB), 11: new AlphaBeta(BODY_AB) }, av = new ArmVel(), ss = newSwingState();
  const out = { old: [], oldHold: 0, neu: [], neuHold: 0 }; let aiNext = 0, prev = null, lastOld = -1e9;
  for (let i = 0; i < secs * fps; i++) {
    const tt = i / fps, now = 1000 + tt * 1000, dt = 1 / fps;
    if (tt >= aiNext) {
      aiNext = tt + (1 / aiHz) * (0.7 + rng() * 0.6);
      const { P, z, sw } = H(tt - lat);
      for (const k of [11, 12, 16]) trk[k].update(P[k][0] + g() * noise, P[k][1] + g() * noise, now);
      av.update(now, P[16][0] - P[12][0] + g() * noise, P[16][1] - P[12][1] + g() * noise, z + g() * 18, sw);
    }
    if (!trk[16].ready) continue;
    const w = trk[16].at(now);
    if (prev) {
      const spd = Math.hypot(w.x - prev.x, w.y - prev.y);                       // 예전: 한 프레임 이동 px
      if (spd > 7.0 && now - lastOld > 110) { out.old.push(tt); lastOld = now; }
      if (spd > 6.0) out.oldHold++;
    }
    prev = { x: w.x, y: w.y };
    const r = stepSwing(ss, av.vN(now), now);
    if (r.swing) out.neu.push(tt);
    if (r.swinging) out.neuHold++;
  }
  return out;
}

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const report = process.argv.includes("--report");
const slashList = (D) => Array.from({ length: 12 }, (_, i) => ({ t0: 1 + i * 1.5, D }));
const recall = (U, D, fps, seed = 1) => {
  const sl = slashList(D), o = run(human(U, sl), { secs: 20, fps, seed }); let a = 0, b = 0;
  for (const s of sl) { if (o.old.some((x) => x >= s.t0 && x <= s.t0 + s.D + 0.2)) a++; if (o.neu.some((x) => x >= s.t0 && x <= s.t0 + s.D + 0.2)) b++; }
  return { old: a / sl.length, neu: b / sl.length };
};

// 1) 베기 인식 (거리 U 120=멀리/아이, 200=보통, 320=가까이) × 속도 D(초) × 프레임 속도
const cases = [];
for (const U of [100, 120, 200, 320]) for (const D of [0.18, 0.3, 0.5, 0.8]) for (const fps of [30, 60]) cases.push({ U, D, fps });
let sumOld = 0, sumNew = 0, worst = 1;
for (const c of cases) {
  const r = recall(c.U, c.D, c.fps); sumOld += r.old; sumNew += r.neu; worst = Math.min(worst, r.neu);
  if (report) console.log(`U=${String(c.U).padStart(3)} 베는시간 ${c.D}s ${c.fps}fps  old ${(r.old * 100).toFixed(0).padStart(3)}%  new ${(r.neu * 100).toFixed(0).padStart(3)}%`);
}
t("새 판정: 모든 거리·속도·프레임에서 베기를 거의 다 인식 (평균 95% 이상, 최악 75% 이상)", () => {
  ok(sumNew / cases.length >= 0.95, `평균 ${(sumNew / cases.length * 100).toFixed(0)}%`); ok(worst >= 0.75, `최악 ${(worst * 100).toFixed(0)}%`);
});
t("새 판정이 예전 판정보다 같거나 낫다 (평균)", () => ok(sumNew >= sumOld - 0.01, `old ${sumOld.toFixed(2)} new ${sumNew.toFixed(2)}`));

// 2) 오인식: 베지 않고 몸만 움직일 때 (30초 동안 휘두름 신호 횟수)
const idle = {
  "가만히 서 있기": () => () => ({ dx: 0, dy: 0 }),
  "점프 반복 (1.5초마다 0.3U)": (U) => (tt) => { const u = (tt % 1.5) / 0.5; return { dx: 0, dy: u < 1 ? -4 * 0.3 * U * u * (1 - u) : 0 }; },
  "제자리 걷기 (1.8Hz ±4%)": (U) => (tt) => ({ dx: 0.01 * U * Math.sin(tt * 2 * Math.PI * 0.9), dy: 0.04 * U * Math.sin(tt * 2 * Math.PI * 1.8) }),
  "좌우 기울이기 (0.5Hz ±0.6어깨)": (U) => (tt) => ({ dx: 0.6 * 0.67 * U * Math.sin(tt * 2 * Math.PI * 0.5), dy: 0 }),
  "앉았다 일어나기": (U) => (tt) => { const p = tt % 3; return { dx: 0, dy: p < 0.3 ? 0.45 * U * ease(p / 0.3) : p < 1.3 ? 0.45 * U : p < 1.6 ? 0.45 * U * (1 - ease((p - 1.3) / 0.3)) : 0 }; },
};
const falseTotals = { old: 0, neu: 0 };
for (const [name, mk] of Object.entries(idle)) {
  for (const U of [120, 320]) {
    const o = run(human(U, [], mk(U)), { secs: 30, seed: 5 });
    falseTotals.old += o.old.length; falseTotals.neu += o.neu.length;
    if (report) console.log(`${name.padEnd(28)} U=${U}  휘두름 오인: old ${String(o.old.length).padStart(3)}번  new ${String(o.neu.length).padStart(3)}번   (베기 판정이 열려 있던 시간: old ${(o.oldHold / 60).toFixed(1)}s new ${(o.neuHold / 60).toFixed(1)}s)`);
    t(`새 판정: ${name} (U=${U}) 에서 휘두름으로 오인하지 않음`, () => ok(o.neu.length <= 1 && o.neuHold / 60 < 2, `오인 ${o.neu.length}번, 열린 시간 ${(o.neuHold / 60).toFixed(1)}s`));
  }
}
t("프레임 속도가 달라도(30/60/120fps) 같은 베기를 똑같이 인식", () => { const r = [30, 60, 120].map((f) => recall(200, 0.3, f).neu); ok(Math.max(...r) - Math.min(...r) <= 0.09, JSON.stringify(r)); });
t("멀리 선 아이(U=100)가 천천히(0.5초) 베어도 인식", () => { const r = recall(100, 0.5, 60); ok(r.neu >= 0.83, `new ${r.neu}`); });
t("신호는 베기 한 번당 한 번 (연속으로 여러 번 울리지 않음)", () => { const sl = slashList(0.3), o = run(human(200, sl), { secs: 20 }); ok(o.neu.length <= sl.length * 1.3, `${o.neu.length}번/${sl.length}번`); });

console.log(`\n${pass}/${pass + fail} 통과` + (report ? `   (오인 합계 old ${falseTotals.old} → new ${falseTotals.neu})` : ""));
process.exit(fail ? 1 : 0);
