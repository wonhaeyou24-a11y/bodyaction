// 손이 "딱딱 끊기고 순간이동"하는 정도 시험: node test/smooth.test.js   (표를 보려면 --report)
// 실제 녹화에서 확인된 상황(AI 인식 초당 10~15번, 결과 간격 50~85ms)을 재현해서, 화면에 그려지는 손이 얼마나 끊기는지를 재요.
//   - 멈춤 비율: 주변은 계속 움직이는데 그 프레임만 거의 안 움직인 프레임의 비율 (딱딱 끊김)
//   - 순간이동: 한 프레임에 움직인 거리가 주변 프레임 평균의 2.2배를 넘은 프레임 비율 / 최대 몇 배까지 갔는지
import { AlphaBeta, FAST_ARM_AB } from "../tracker.js";
import { mulberry } from "./bots.js";

const HAND_AB = { alpha: 0.55, beta: 0.2, tau: 45, maxPredictMs: 45, stillSpeed: 0.05, jumpPx: 900 };    // main.js 손 게임 설정
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };  // main.js 몸 게임 설정
const truth = (t) => 250 * Math.sin(2 * Math.PI * 1.1 * t) + 90 * Math.sin(2 * Math.PI * 2.7 * t);        // 부드럽게 흔드는 손(px)

function run(cfg, { aiHz, camMs = 45, inferMs = 25, noise = 2.5, seed = 1, T = 10, fps = 60, jitterFrames = true }) {
  const rng = mulberry(seed), g = () => (rng() + rng() + rng() - 1.5) * 2, trk = new AlphaBeta(cfg);
  const caps = []; for (let t = 0; t < T; t += (1 / aiHz) * (0.8 + rng() * 0.4)) caps.push(t);
  // 결과는 화면 프레임(16.7ms) 단위로만 소비돼요 (실제 녹화에서 간격이 50/67/83ms로 16.7의 배수였어요)
  let fi = 0; const out = [];
  for (let i = 0; i < T * fps; i++) {
    const tt = i / fps, now = tt * 1000;
    while (fi < caps.length && caps[fi] + (camMs + inferMs) / 1000 <= tt) { const tc = caps[fi++]; trk.update(truth(tc) + g() * noise, 0, tc * 1000); }
    if (trk.ready) out.push({ t: tt, y: trk.at(now).x });
  }
  // 끊김: 주변 프레임들이 꽤 움직이는데(이웃 중앙값 2px/프레임 이상) 이 프레임만 거의 안 움직였거나(멈춤) 갑자기 크게 움직인(순간이동) 비율
  const steps = out.map((o, i) => (i ? Math.abs(o.y - out[i - 1].y) : 0));
  let region = 0, freeze = 0, jumpN = 0, maxJumpRatio = 0;
  for (let i = 6; i < steps.length - 6; i++) {
    const nb = steps.slice(i - 6, i + 7).filter((_, k) => k !== 6).sort((a, b) => a - b), med = nb[6];
    if (med < 2) continue;
    region++;
    if (steps[i] < med * 0.2) freeze++;
    if (steps[i] > med * 2.2) { jumpN++; maxJumpRatio = Math.max(maxJumpRatio, steps[i] / med); }
  }
  const stall = freeze / Math.max(1, region), jumpFrames = jumpN / Math.max(1, region), maxStep = maxJumpRatio, maxTruthStep = 1, mov = 1;
  // 늦음(ms)
  const moving = out.filter((o) => Math.abs(truth(o.t + 0.01) - truth(o.t - 0.01)) > 3);
  let best = [0, Infinity];
  for (let s = -40; s <= 260; s += 4) { let e = 0; for (const o of moving) e += Math.abs(o.y - truth(o.t - s / 1000)); e /= moving.length; if (e < best[1]) best = [s, e]; }
  return { stall, jump: maxStep, jumpFrames, lag: best[0], err: best[1] };
}
const avg = (cfg, o) => { const r = [1, 2, 3, 4].map((seed) => run(cfg, { ...o, seed })); const m = (k) => r.reduce((a, x) => a + x[k], 0) / r.length; return { stall: m("stall"), jump: m("jump"), jf: m("jumpFrames"), lag: m("lag"), err: m("err") }; };

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const report = process.argv.includes("--report");
const row = (name, r) => report && console.log(name.padEnd(40), `멈춤 ${(r.stall * 100).toFixed(0).padStart(3)}% · 순간이동 ${(r.jf * 100).toFixed(0).padStart(3)}%(최대 ${r.jump.toFixed(1)}배) · 오차 ${r.err.toFixed(0).padStart(3)}px · 늦음 ${r.lag.toFixed(0)}ms`);

for (const aiHz of [10, 15, 20, 30]) {
  const cur = avg(HAND_AB, { aiHz }), adp = avg({ ...HAND_AB, rateAdapt: true }, { aiHz });
  row(`손 게임 · AI ${aiHz}회/초 · 예전`, cur); row(`손 게임 · AI ${aiHz}회/초 · 간격 맞춤`, adp);
  if (aiHz <= 15) t(`손 게임 AI ${aiHz}회/초: 간격 맞춤이 순간이동(끊김)을 절반 이하로 줄이고, 늦음은 45ms 넘게 늘지 않음`, () => ok(adp.jf <= cur.jf * 0.5 + 0.005 && adp.lag <= cur.lag + 45 && adp.err <= cur.err * 1.35, `순간이동 ${(cur.jf * 100).toFixed(0)}→${(adp.jf * 100).toFixed(0)}% · 늦음 ${cur.lag.toFixed(0)}→${adp.lag.toFixed(0)}ms · 오차 ${cur.err.toFixed(0)}→${adp.err.toFixed(0)}px`));
  const b0 = avg(BODY_AB, { aiHz }), b1 = avg({ ...BODY_AB, rateAdapt: true }, { aiHz });
  row(`몸 게임 · AI ${aiHz}회/초 · 예전`, b0); row(`몸 게임 · AI ${aiHz}회/초 · 간격 맞춤`, b1);
}
t("AI가 빠를 때(30회/초)는 기본 설정과 똑같음 (간격 맞춤이 화면을 흐리게 하지 않음)", () => { const a = avg(HAND_AB, { aiHz: 30 }), b = avg({ ...HAND_AB, rateAdapt: true }, { aiHz: 30 }); ok(Math.abs(b.err - a.err) < 2 && Math.abs(b.lag - a.lag) < 2, `오차 ${a.err.toFixed(0)}→${b.err.toFixed(0)}`); });
t("보통 결과 간격이 짧을수록 예측 시간이 짧아짐 (간격 평균을 따라감)", () => {
  const fast = new AlphaBeta({ ...HAND_AB, rateAdapt: true }), slow = new AlphaBeta({ ...HAND_AB, rateAdapt: true });
  for (let i = 0; i < 20; i++) { fast.update(i, 0, i * 20); slow.update(i, 0, i * 90); }
  ok(fast.ema < 30 && slow.ema > 70, `${fast.ema.toFixed(0)} / ${slow.ema.toFixed(0)}`);
});

console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
