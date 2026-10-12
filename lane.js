// 좌우 이동(레인) 판정: 몸을 옆으로 기울이거나 옆으로 한 걸음 옮기면 왼쪽/가운데/오른쪽 길로 바뀌어요. (node test/lane.test.js)
//
// 입력: 몸 중심의 가로 위치를 "어깨너비"로 나눈 값 xN (가까이/멀리 서도, 아이도 같은 기준). 카메라 쪽 화면 기준: 음수 = 화면 왼쪽.
// 원리: 가운데 기준점은 서 있는 동안 천천히 따라가요(제자리에서 조금씩 밀려도 적응). 기준에서 ENTER 이상 벗어나면 옆 길, EXIT 안으로
// 돌아오면 가운데 (들어가고 나오는 기준이 달라서 경계에서 덜덜거리지 않음). 한두 프레임 튄 값은 DWELL 동안 이어질 때만 인정해요.

export const LANE = { ENTER: 0.5, EXIT: 0.28, DWELL: 0.07, FOLLOW: 0.35, MAXN: 3.0, LEAD: 0.13, LEAD_MIN_V: 0.45, LEAD_MAX: 0.3 };

export function newLaneState() { return { lane: 0, center: null, cand: 0, hold: 0, d: 0 }; }

/**
 * @param s   상태 (newLaneState)
 * @param xN  몸 중심 x / 어깨너비 (몸이 안 보이면 null/undefined → 직전 길 유지)
 * @param dt  지난 시간(초)
 * @param vN  몸 중심의 움직이는 속도(어깨너비/초, 선택). 빠르게 움직이는 중이면 조금 앞(LEAD초 뒤)의 위치로 판단해서 반응이 빨라져요 (AI 속도가 느린 PC에서 도움)
 * @returns   현재 길: -1(왼쪽) 0(가운데) 1(오른쪽)
 */
export function stepLane(s, xN, dt, vN = 0) {
  if (!Number.isFinite(xN)) return s.lane;
  if (s.center == null) s.center = xN;
  const lead = Number.isFinite(vN) && Math.abs(vN) > LANE.LEAD_MIN_V ? Math.max(-LANE.LEAD_MAX, Math.min(LANE.LEAD_MAX, vN * LANE.LEAD)) : 0;
  const d = Math.max(-LANE.MAXN, Math.min(LANE.MAXN, xN + lead - s.center)); s.d = d;
  // 가운데에 있고 크게 안 움직였을 때만 기준을 천천히 맞춰요 (옆 길에 오래 서 있어도 기준이 끌려오지 않게)
  if (s.lane === 0 && Math.abs(d) < LANE.ENTER * 0.7) s.center += (xN - s.center) * Math.min(1, dt * LANE.FOLLOW);
  // 목표 길 (들어가는 문턱 / 나오는 문턱을 다르게)
  let want = s.lane;
  if (s.lane === 0) want = d <= -LANE.ENTER ? -1 : d >= LANE.ENTER ? 1 : 0;
  else if (s.lane === -1) want = d > -LANE.EXIT ? (d >= LANE.ENTER ? 1 : 0) : -1;
  else want = d < LANE.EXIT ? (d <= -LANE.ENTER ? -1 : 0) : 1;
  if (want === s.lane) { s.cand = want; s.hold = 0; return s.lane; }
  if (want !== s.cand) { s.cand = want; s.hold = 0; }
  s.hold += dt;
  if (s.hold >= LANE.DWELL) { s.lane = want; s.hold = 0; }
  return s.lane;
}
