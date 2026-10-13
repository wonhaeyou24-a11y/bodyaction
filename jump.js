// 점프/앉기 판정 (러너 게임용). 화면(DOM)을 모르는 순수 로직이라 Node로 테스트해요 (node test/jump.test.js).
//
// 예전 방식은 "어깨와 골반의 가운데 높이"를 쓰고 기준선(서 있는 높이)을 아주 좁은 범위에서만 따라가게 해서,
//  ① 골반이 보였다 안 보였다 하면 기준 높이가 갑자기 반 토막 튀어서 "점프"로 오인하고
//  ② 아주 작은 흔들림(가속도 750px/s², 속도 35px/s)만으로도 점프가 되고
//  ③ 몸을 조금 일으키거나 뒤로 물러서서 기준선이 어긋나면 "위로 9%"만으로 점프가 됐어요.
// 이제는: 어깨 높이만 쓰고(골반 유무와 상관없이 같은 값), 기준선은 천천히 움직이는 변화를 따라가고,
// 점프는 "몸통 길이 기준으로 충분히 빠르고(속도) + 충분히 올라가고(높이) + 연속 두 프레임 이어질 때"만 인정해요.

const SH_MIN_V = 0.25;                  // 어깨 가시성 기준 완화 (어두운 조명/먼 거리에서도 안정 인식)
const HIP_MIN_V = 0.4;
const JUMP_V = 0.45;                    // 점프 속도: 몸통 길이/초
const JUMP_RISE = 0.08;                 // 최근 0.4초 안에 가장 낮았던 곳에서 몸통 길이의 8% 이상 올라가야
const DUCK_ON = 0.14, DUCK_OFF = 0.10;  // 숙이기 기준
const COOLDOWN_MS = 340, STAND_UP_BLOCK_MS = 250, HIST_MS = 400;

/** 몸 점(33개)에서 판정에 쓸 값 {y, tl}을 뽑아요. 못 구하면 null. y=어깨 중심 높이, tl=몸통 길이(없으면 null) */
export function jumpSample(b) {
  if (!b) return null;
  const ok = (i, m) => b[i] && b[i].v >= m && Number.isFinite(b[i].y);
  if (ok(11, SH_MIN_V) && ok(12, SH_MIN_V)) {
    const shY = (b[11].y + b[12].y) / 2;
    const tl = ok(23, HIP_MIN_V) && ok(24, HIP_MIN_V) ? Math.max(40, (b[23].y + b[24].y) / 2 - shY) : null;
    const sw = Math.hypot(b[11].x - b[12].x, b[11].y - b[12].y);
    return { y: shY, tl, swTl: Math.max(40, sw * 1.35) };
  }
  if (ok(0, 0.5)) {
    // 머리/얼굴만 보일 때: 양쪽 귀(7, 8) 거리로 거리 적응형 어깨 너비 및 기준 높이 환산
    const headW = ok(7, 0.35) && ok(8, 0.35) ? Math.hypot(b[7].x - b[8].x, b[7].y - b[8].y) : 55;
    const estSw = Math.max(45, headW * 2.3);
    return { y: b[0].y + estSw * 0.45, tl: null, swTl: estSw * 1.35 };
  }
  return null;
}

export function newJumpState() {
  return { base: null, tl: 0, hist: [], lastDuck: -1e9, lastJump: -1e9, prevY: null, vUp: 0, upFrames: 0, ducking: false, prevUp: false };
}

/**
 * @param s 상태  @param sm {y, tl, swTl}  @param dt 프레임 간격(초)  @param now 현재 시각(ms)
 * @returns {{jump:boolean, duck:boolean}}
 */
export function stepJump(s, sm, dt, now) {
  // 몸통 길이: 골반이 보일 때만 천천히 갱신, 안 보이면 마지막 값(없으면 어깨너비로 추정)을 그대로 써요 → 골반이 깜박여도 기준이 안 튐
  if (sm.tl) s.tl = s.tl ? s.tl + (sm.tl - s.tl) * 0.1 : sm.tl;
  else if (!s.tl) s.tl = sm.swTl || 120;
  const tl = s.tl, y = sm.y;
  if (s.base == null) s.base = y;
  if (s.prevY == null) s.prevY = y;
  const safeDt = Math.max(dt, 0.008);

  const raw = (s.prevY - y) / safeDt;                                  // 위로 올라가는 속도(px/s)
  s.vUp += (raw - s.vUp) * Math.min(1, safeDt * 20);
  s.prevY = y;

  s.hist.push({ t: now, y });
  while (s.hist.length && now - s.hist[0].t > HIST_MS) s.hist.shift();

  const dy = y - s.base;                                              // +면 기준보다 아래(숙임)
  // 기준선: 거의 안 움직일 때, 숙이거나 공중에 있지 않으면 천천히 따라가요 (뒤로 물러서거나 몸을 펴는 느린 변화에 적응)
  if (Math.abs(s.vUp) < 0.35 * tl && dy < DUCK_OFF * tl && dy > -0.3 * tl) s.base += dy * Math.min(1, safeDt * 0.8);

  if (s.ducking ? dy > DUCK_OFF * tl : dy > DUCK_ON * tl) { s.ducking = true; s.lastDuck = now; } else s.ducking = false;

  let low = y; for (const h of s.hist) if (h.y > low) low = h.y;
  const rise = low - y;                                               // 최근 0.4초 중 가장 낮은 곳에서 올라온 높이
  const up = !s.ducking && now - s.lastDuck > STAND_UP_BLOCK_MS && s.vUp > JUMP_V * tl && rise > JUMP_RISE * tl;   // 웅크렸다 일어서는 동작(0.25초)은 점프가 아니에요
  s.upFrames = up ? s.upFrames + 1 : 0;                               // 한 프레임 튐은 무시: 연속 2프레임 이어져야 해요
  const fire = s.upFrames >= 2 && !s.prevUp && now - s.lastJump > COOLDOWN_MS;
  if (fire) s.lastJump = now;
  s.prevUp = s.upFrames >= 2;
  return { jump: fire, duck: s.ducking };
}
