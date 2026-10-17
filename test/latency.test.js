// "그림자처럼 늦는" 정도 시험: node test/latency.test.js
// 카메라·인식 지연이 있는 현실적인 경로에서 화면 속 손이 진짜 손보다 몇 ms 늦는지 재고, 광선검용 "빠른 팔" 설정이 기본 설정보다 확실히 덜 늦는지 확인해요.
import { FAST_ARM_AB } from "../tracker.js";
import { measure } from "./latency.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const BODY = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };
const avg = (o) => { const r = [1, 2, 3, 4].map((seed) => measure({ ...o, seed })); const m = (k) => r.reduce((a, x) => a + x[k], 0) / r.length; return { lag: m("lag"), err: m("errNow"), jit: m("jitter"), over: m("over") }; };
const report = process.argv.includes("--report");
const show = (name, r) => report && console.log(name.padEnd(46), `늦음 ${r.lag.toFixed(0).padStart(3)}ms · 평균오차 ${r.err.toFixed(0).padStart(3)}px · 가만히 떨림 ${r.jit.toFixed(2)}px`);

const cur = avg({ cfg: BODY, stamp: "send" }), cap = avg({ cfg: BODY, stamp: "capture" }), fast = avg({ cfg: FAST_ARM_AB, stamp: "capture" });
show("예전(기본 설정 + 영상 보낸 시각)", cur); show("찍힌 시각만 적용", cap); show("지금(빠른 팔 + 찍힌 시각)", fast);

t("찍힌 시각으로 표시하면 같은 설정에서도 덜 늦음", () => ok(cap.lag < cur.lag && cap.err < cur.err, `${cur.lag}→${cap.lag}`));
t("빠른 팔 설정: 늦음 60ms 이하, 예전의 60% 이하", () => ok(fast.lag <= 60 && fast.lag <= cur.lag * 0.6, `예전 ${cur.lag.toFixed(0)}ms → ${fast.lag.toFixed(0)}ms`));
t("빠른 팔 설정: 평균 위치 오차가 예전의 65% 이하", () => ok(fast.err <= cur.err * 0.65, `예전 ${cur.err.toFixed(0)}px → ${fast.err.toFixed(0)}px`));
t("빠른 팔 설정: 가만히 있을 때 떨림이 1px 이하 (몸이 덜덜거리지 않음)", () => ok(fast.jit <= 1.0, `${fast.jit.toFixed(2)}px`));
for (const [aiHz, camMs, inferMs] of [[20, 60, 40], [30, 45, 25], [60, 35, 15], [15, 80, 60]]) {
  t(`여러 환경(AI ${aiHz}회/초, 카메라 지연 ${camMs}ms, 인식 ${inferMs}ms)에서도 예전보다 덜 늦음`, () => { const a = avg({ cfg: BODY, stamp: "send", aiHz, camMs, inferMs }), b = avg({ cfg: FAST_ARM_AB, stamp: "capture", aiHz, camMs, inferMs }); show(`  환경 ${aiHz}Hz/${camMs}+${inferMs}ms`, b); ok(b.lag < a.lag - 15 && b.err < a.err, `${a.lag.toFixed(0)}→${b.lag.toFixed(0)}ms`); });
}
t("방향이 바뀔 때 끝점을 넘어가는 정도가 예전보다 나빠지지 않음 (+25px 이내)", () => ok(fast.over <= cur.over + 25, `${cur.over.toFixed(0)}→${fast.over.toFixed(0)}px`));

console.log(`\n${pass}/${pass + fail} 통과` + (report ? `   (늦음 ${cur.lag.toFixed(0)}ms → ${fast.lag.toFixed(0)}ms)` : ""));
process.exit(fail ? 1 : 0);
