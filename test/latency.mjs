// 모션이 "그림자처럼 늦는" 정도를 재는 도구:  node test/latency.mjs
// 진짜 손 움직임(truth)과 화면에 그려지는 위치(추적기 출력)가 얼마나 늦는지(ms)를, 카메라·인식 지연이 있는 현실적인 경로로 재요.
import { AlphaBeta } from "../tracker.js";
import { mulberry } from "./bots.js";

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** 손목의 진짜 위치: 0.6초마다 반대 방향으로 300px 쓸어 가는 베기(0.26초) */
const truth = (t) => { const k = Math.floor(t / 0.6), u = (t - k * 0.6) / 0.26, a = k % 2 ? 300 : 0, b = k % 2 ? 0 : 300; return a + (b - a) * ease(u); };

/** 한 번 돌려서 lag(ms), 오차(px), 떨림(px)을 돌려줘요 */
export function measure({ cfg, aiHz = 30, camMs = 45, inferMs = 25, stamp = "send", leadMs = 0, noise = 2.5, seed = 1, fps = 60, T = 8 }) {
  const rng = mulberry(seed), g = () => (rng() + rng() + rng() - 1.5) * 2;
  const trk = new AlphaBeta(cfg);
  const frames = [];                                         // 카메라가 찍은 순간들
  for (let t = 0; t < T; t += (1 / aiHz) * (0.8 + rng() * 0.4)) frames.push(t);
  let fi = 0; const out = [];
  for (let i = 0; i < T * fps; i++) {
    const tt = i / fps, now = tt * 1000;
    // 도착한 결과를 먹여요: 찍힌 시각 + 카메라 지연 + 인식 지연 이후에 도착
    while (fi < frames.length && frames[fi] + (camMs + inferMs) / 1000 <= tt) {
      const tc = frames[fi++];                               // 실제로 찍힌 시각 (초)
      const stampMs = stamp === "capture" ? tc * 1000 : (tc * 1000 + camMs);   // send: 영상을 작업자에 보낸 시각 = 찍힌 뒤 카메라 지연만큼 늦음
      trk.update(truth(tc) + g() * noise, 0, stampMs);
    }
    if (trk.ready) out.push({ t: tt, y: trk.at(now + leadMs).x });
  }
  // lag: 출력이 "몇 ms 전의 진짜 위치"와 가장 잘 맞는지 (움직이는 구간만)
  const moving = out.filter((o) => { const v = Math.abs(truth(o.t + 0.01) - truth(o.t - 0.01)); return v > 4; });
  let best = [0, Infinity];
  for (let s = -40; s <= 200; s += 2) { let e = 0; for (const o of moving) e += Math.abs(o.y - truth(o.t - s / 1000)); e /= moving.length; if (e < best[1]) best = [s, e]; }
  const errNow = moving.reduce((a, o) => a + Math.abs(o.y - truth(o.t)), 0) / moving.length;
  // 떨림: 가만히 있을 때 출력의 프레임 간 변화
  const rng2 = mulberry(seed + 99), g2 = () => (rng2() + rng2() + rng2() - 1.5) * 2, trk2 = new AlphaBeta(cfg);
  let fj = 0, last = null, cnt = 0, fr2 = [];
  for (let t = 0; t < 6; t += 1 / aiHz) fr2.push(t);
  let k2 = 0;
  for (let i = 0; i < 6 * fps; i++) { const tt = i / fps; while (k2 < fr2.length && fr2[k2] <= tt) { trk2.update(100 + g2() * noise, 0, fr2[k2++] * 1000); } if (trk2.ready) { const y = trk2.at(tt * 1000 + leadMs).x; if (last != null) { fj += Math.abs(y - last); cnt++; } last = y; } }
  // 방향 바뀔 때 튀어나감(overshoot): 끝점(300 또는 0)을 넘어간 최대 px
  let over = 0; for (const o of out) { over = Math.max(over, o.y - 300, -o.y); }
  return { lag: best[0], errNow, jitter: fj / cnt, over };
}

if (process.argv[1] && process.argv[1].endsWith("latency.mjs")) {
  const BODY = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };
  const rows = [["지금(영상 보낸 시각 기준)", { cfg: BODY, stamp: "send" }], ["찍힌 시각 기준", { cfg: BODY, stamp: "capture" }]];
  for (const [name, o] of rows) { const r = measure(o); console.log(name.padEnd(28), `늦음 ${r.lag}ms  평균오차 ${r.errNow.toFixed(1)}px  떨림 ${r.jitter.toFixed(2)}px  끝점 넘침 ${r.over.toFixed(0)}px`); }
}
