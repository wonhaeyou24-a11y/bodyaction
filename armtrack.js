// 팔 움직임 추적: "어깨에 대한 손목"의 3차원(화면 x·y + 깊이 z) 속도를 어깨너비 단위로 알려 줘요 (샌드백 펀치 판정용).
// 어깨 기준이라서 몸이 흔들리거나 걷고 한 걸음 물러서도 영향이 없고, 깊이(z)가 들어가서 카메라 쪽으로 뻗는 펀치도 보여요.
// z는 화면 좌표보다 훨씬 떨리므로 더 부드럽게(느리게) 따라가는 추적기를 따로 써요.
import { AlphaBeta } from "./tracker.js";

const XY_AB = { alpha: 0.6, beta: 0.2, tau: 40, maxPredictMs: 100, stillSpeed: 0.03, jumpPx: 500 };
const Z_AB = { alpha: 0.4, beta: 0.12, tau: 40, maxPredictMs: 100, stillSpeed: 0.05, jumpPx: 500 };
export const Z_WEIGHT = 0.7;            // 깊이 속도를 얼마나 믿을지 (잡음이 커서 낮춤)
const STALE_MS = 220;                   // 이만큼 결과가 안 오면 속도를 0으로 (손이 사라졌을 때 허공에서 계속 펀치가 나가지 않게)

export class ArmVel {
  constructor() { this.xy = new AlphaBeta(XY_AB); this.z = new AlphaBeta(Z_AB); this.sw = 100; this.t = -1e9; }
  reset() { this.xy.reset(); this.z.reset(); this.t = -1e9; }
  /** 새 인식 결과(시각 t ms): 어깨 대비 손목 위치(rx, ry: 화면 px, rz: z를 화면 px로 환산한 값), 어깨너비(px) */
  update(t, rx, ry, rz, swPx) {
    if (!(swPx > 20) || !Number.isFinite(rx + ry + rz)) return;
    this.sw = this.sw * 0.7 + swPx * 0.3;
    this.xy.update(rx, ry, t); this.z.update(rz, 0, t); this.t = t;
  }
  /** 지금의 3차원 속도 (어깨너비/초) */
  vN(nowMs) {
    if (nowMs - this.t > STALE_MS || !this.xy.ready) return 0;
    return Math.hypot(this.xy.vx, this.xy.vy, Z_WEIGHT * this.z.vx) * 1000 / this.sw;
  }
}
