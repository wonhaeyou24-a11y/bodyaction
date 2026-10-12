// 커스튬 흔들림(스프링 관성): 모자·망토·날개·손에 든 무기가 몸의 움직임보다 살짝 늦게 따라오며 출렁여요.
// 그림 코드와 분리된 순수 계산이라 Node에서 테스트할 수 있어요 (test/costume.test.js).
// 사람(내 몸/상대 몸)마다 따로 CostumeMotion 하나씩 써요 — 상태가 섞이지 않게.
//
// 원리: 몸의 이동 속도(몸통 길이/초)를 걸러서 "목표 기울기"로 바꾸고, 스프링-댐퍼가 그 목표를 늦게 따라가요.
// 각도 자체를 스프링으로 쫓지 않고 "추가 기울기"만 계산하므로 ±180° 경계에서 튀는 일이 없어요.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 스프링-댐퍼 하나. k 복원력, c 감쇠. 시간을 잘게 쪼개 계산해서 프레임이 늦어져도 안 터져요. */
export class Spring {
  constructor(k, c, max) { this.k = k; this.c = c; this.max = max; this.x = 0; this.v = 0; }
  step(dt, target) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    if (this.x > this.max) { this.x = this.max; if (this.v > 0) this.v = 0; }
    else if (this.x < -this.max) { this.x = -this.max; if (this.v < 0) this.v = 0; }
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}

const SMOOTH = 18;          // 속도 필터 (클수록 빨리 반응). 약 55ms 평균
const V_MAX = 6;            // 몸통 길이/초 — 이보다 빠른 값은 잘라요 (추적 튐 방지)
const MAX_GAP = 0.25;       // 이 시간(초) 넘게 비면 새로 시작 (몸이 잠깐 사라졌다 돌아온 경우)

export class CostumeMotion {
  constructor() {
    this.head = { rot: 0, dy: 0 };      // 모자: 기울기(rad), 위아래 출렁임(몸통 길이 비율)
    this.back = { rot: 0 };             // 망토·날개: 기울기(rad)
    this.hands = [{ rot: 0 }, { rot: 0 }];
    this._hs = new Spring(150, 11, 0.45); this._hy = new Spring(170, 12, 0.14);
    this._bs = new Spring(70, 6.5, 0.7);
    this._ws = [new Spring(130, 11, 0.7), new Spring(130, 11, 0.7)];
    this.reset();
  }
  reset() {
    this._t = null; this._m = null; this._h = [null, null];
    this._v = { x: 0, y: 0 }; this._hv = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    this._hs.reset(); this._hy.reset(); this._bs.reset(); this._ws[0].reset(); this._ws[1].reset();
    this.head.rot = 0; this.head.dy = 0; this.back.rot = 0; this.hands[0].rot = 0; this.hands[1].rot = 0;
  }
  /**
   * @param nowMs 현재 시각(ms)
   * @param mid 어깨 중심 {x,y}  @param unit 몸통 길이(px)  @param wrists [왼손목, 오른손목] ({x,y} 또는 null)
   */
  update(nowMs, mid, unit, wrists) {
    const t = nowMs / 1000;
    if (this._t === null || t - this._t > MAX_GAP || !(unit > 1)) {
      this.reset(); this._t = t; this._m = { x: mid.x, y: mid.y };
      for (let i = 0; i < 2; i++) this._h[i] = wrists && wrists[i] ? { x: wrists[i].x, y: wrists[i].y } : null;
      return this;
    }
    const dt = clamp(t - this._t, 0.001, 0.05); this._t = t;
    const a = Math.min(1, dt * SMOOTH);
    const vel = (cur, prev, out) => {
      out.x += (clamp((cur.x - prev.x) / dt / unit, -V_MAX, V_MAX) - out.x) * a;
      out.y += (clamp((cur.y - prev.y) / dt / unit, -V_MAX, V_MAX) - out.y) * a;
    };
    vel(mid, this._m, this._v); this._m.x = mid.x; this._m.y = mid.y;

    this.head.rot = this._hs.step(dt, clamp(-this._v.x * 0.12, -0.45, 0.45));       // 모자: 오른쪽으로 가면 윗부분이 왼쪽으로 처져요
    this.head.dy = this._hy.step(dt, clamp(this._v.y * 0.04, -0.14, 0.14));          // 점프/숙임에 모자가 살짝 눌려요
    this.back.rot = this._bs.step(dt, clamp(this._v.x * 0.22, -0.7, 0.7));           // 망토·날개: 아랫부분이 반대쪽으로 날려요
    for (let i = 0; i < 2; i++) {
      const w = wrists && wrists[i], p = this._h[i];
      if (w && p) { vel(w, p, this._hv[i]); p.x = w.x; p.y = w.y; }
      else { this._hv[i].x *= 0.8; this._hv[i].y *= 0.8; if (w) this._h[i] = { x: w.x, y: w.y }; else this._h[i] = null; }
      this.hands[i].rot = this._ws[i].step(dt, clamp(-this._hv[i].x * 0.06, -0.7, 0.7));   // 손에 든 무기: 끝이 늦게 따라와요
    }
    return this;
  }
}
