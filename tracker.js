// 손/관절 위치 추적기 (알파-베타 필터).
//
// 문제: 카메라 인식 결과는 일정하지 않은 간격(예: 30ms, 90ms, 40ms…)으로 도착해요.
//       "결과가 오면 그 위치로 뚝 이동, 그 사이는 관성으로 이동"하면 결과가 올 때마다 위치가 튀어요.
// 해결: 위치와 속도를 함께 추정해요. 새 결과가 오면 "예측한 위치"와 비교해서 그 차이(오차)의 일부만 반영하고
//       (그래서 튀지 않음), 화면을 그릴 때마다 at(now)로 "지금 시각"의 위치를 계산해요
//       (그래서 인식 지연과 카메라 지연만큼 자연스럽게 앞서가고, 결과 간격이 달라져도 부드러움).
//
// 단위: 위치 px, 시간 ms, 속도 px/ms

export class AlphaBeta {
  /**
   * @param alpha  위치 보정 비율(0~1). 클수록 인식 결과를 빨리 따라가요(떨림도 더 따라감)
   * @param beta   속도 보정 비율. 클수록 속도 변화에 빨리 반응해요
   * @param maxPredictMs  마지막 결과 이후 이만큼까지만 앞을 예측해요 (손이 사라졌을 때 멀리 날아가지 않게)
   * @param jumpPx  오차가 이보다 크면 "다른 손/재인식"으로 보고 바로 따라가요
   * @param stillSpeed  이 속도(px/ms)보다 느리면 가만히 있는 것으로 보고 예측하지 않아요 (떨림 방지)
   * @param tau  새 결과가 와서 추정이 바뀌어도 그린 위치가 뚝 변하지 않게, 차이를 이 시간(ms) 동안 서서히 메워요
   */
  constructor({ alpha = 0.5, beta = 0.18, maxPredictMs = 130, jumpPx = 360, stillSpeed = 0.06, tau = 70, adaptive = true } = {}) {
    Object.assign(this, { alpha, beta, maxPredictMs, jumpPx, stillSpeed, tau, adaptive });
    this.reset();
  }

  reset() { this.ready = false; this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.t = 0; this.cx = 0; this.cy = 0; this.corrT = 0; this._last = null; this._lastNow = 0; }

  /** 시각 t(ms)에 (x, y)에서 손을 봤어요 */
  update(x, y, t) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return; // 🛡️ Zero-Trust: 비정상 좌표 유입 차단
    if (!this.ready) { this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.t = t; this.ready = true; this.cx = this.cy = 0; return; }
    const dt = t - this.t;
    if (dt <= 0) return;                                 // 같은/이전 시각의 결과는 무시
    const step = Math.min(dt, 200);                      // 오랜만에 온 결과가 속도를 망치지 않게
    const px = this.x + this.vx * step, py = this.y + this.vy * step;
    const rx = x - px, ry = y - py;
    if (Math.hypot(rx, ry) > this.jumpPx) {              // 큰 점프: 바로 따라가고 속도는 다시 시작
      this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.t = t; this.cx = this.cy = 0; this._last = null; return;
    }
    // ⚡ One Euro Filter 원리: 빠른 손 휘두름(0.2px/ms 이상) 시 지연 시간(Lag) 최소화
    const spd = Math.hypot(this.vx, this.vy);
    const effAlpha = this.adaptive && spd > 0.18
      ? Math.min(0.72, this.alpha + Math.min(0.18, (spd - 0.18) * 0.15))
      : this.alpha;
    this.x = px + effAlpha * rx;
    this.y = py + effAlpha * ry;
    const k = this.beta / Math.max(16, step);            // 결과가 너무 자주 와도 속도가 폭주하지 않게 최소 16ms
    this.vx += k * rx;
    this.vy += k * ry;
    this.t = t;
    // 연속성: 방금 그린 위치와 새 추정 위치의 차이를 보관했다가 tau 동안 서서히 줄여요 (뚝 튀지 않음)
    if (this._last) {
      const e = this._est(this._lastNow);
      this.cx = this._last.x - e.x; this.cy = this._last.y - e.y; this.corrT = this._lastNow;
    }
  }

  _est(now) {
    const dt = Math.max(0, Math.min(this.maxPredictMs, now - this.t));
    const still = Math.hypot(this.vx, this.vy) < this.stillSpeed;
    const f = still ? 0 : dt;
    return { x: this.x + this.vx * f, y: this.y + this.vy * f, vx: still ? 0 : this.vx, vy: still ? 0 : this.vy };
  }

  /** 지금 시각(now, ms)에 그릴 위치와 속도 (화면을 그릴 때마다 불러요) */
  at(now) {
    const e = this._est(now);
    const w = this.tau > 0 ? Math.exp(-Math.max(0, now - this.corrT) / this.tau) : 0;
    const out = { x: e.x + this.cx * w, y: e.y + this.cy * w, vx: e.vx, vy: e.vy };
    this._last = out; this._lastNow = now;
    return out;
  }
}
