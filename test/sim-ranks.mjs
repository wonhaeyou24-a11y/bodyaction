// 등급 기준 계산: 실력별 가짜 플레이어를 60초씩 많이 돌려서 점수 평균을 구해요  (node test/sim-ranks.mjs)
// 실력 5단계 = 처음 해봄 / 보통 / 잘함 / 아주 잘함 / 거의 완벽  →  [B, A, S, S+, SSS] 기준 점수
import { playCrun, playDuel } from "./bots.js";
const N = 300;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const LV = [{ rt: 0.8, miss: 0.5, hz: 0.6 }, { rt: 0.45, miss: 0.2, hz: 0.9 }, { rt: 0.35, miss: 0.12, hz: 1.1 }, { rt: 0.25, miss: 0.07, hz: 1.3 }, { rt: 0.15, miss: 0.02, hz: 1.5 }];
const crun = LV.map((o) => Math.round(mean(Array.from({ length: N }, (_, s) => playCrun({ ...o, seed: s + 1, secs: 60 }).sc))));
const duel = LV.map((o) => Math.round(mean(Array.from({ length: N }, (_, s) => playDuel({ ...o, seed: s + 1, secs: 60, swingHz: o.hz }).sc))));
console.log(JSON.stringify({ crun, duel }));
