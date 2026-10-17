// 광선검 휘두름 판정 (화면/게임을 모르는 순수 규칙, node test/saber.test.js 로 시험).
//
// 예전 방식: "손목이 한 프레임에 7픽셀 넘게 움직이면 휘두름".  문제 세 가지
//   ① 프레임 속도가 달라지면 기준이 달라져요 (30fps에선 한 프레임에 두 배 움직여서 너무 쉽고, 144Hz 화면에선 너무 어려워요)
//   ② 카메라에서 멀리 선 사람(아이)은 같은 동작도 픽셀이 적게 움직여서 못 휘두른 걸로 보고, 가까이 선 사람은 가만히 있어도 걸려요
//   ③ 손목의 "화면 속 절대 속도"라서 점프하거나 몸을 기울이기만 해도 휘두른 것으로 봐요
// 지금 방식: 샌드백에서 검증한 "어깨 기준 손목 속도(어깨너비/초, armtrack.js)"를 써요. 거리·프레임 속도·몸 움직임에 상관없어요.
//   - 어깨너비의 ON배/초 이상으로 손목이 움직이면 "휘두르는 중"이에요.
//   - 휘두르는 중이 시작되는 순간 한 번 "휘두름 신호"가 나가고 (COOL_MS 동안은 다시 안 나가요)
//   - 베기 판정은 휘두르는 중이거나, 방금(GRACE_MS 안에) 휘둘렀으면 인정해요 (손이 큐브에 닿는 순간과 가장 빠른 순간이 몇 프레임 어긋나도 괜찮게)

export const SWING = { ON: 1.9, OFF: 1.1, COOL_MS: 110, GRACE_MS: 150 };

export function newSwingState() { return { active: false, lastOn: -1e9, lastAbove: -1e9 }; }

/**
 * @param s   손마다 하나씩 가지는 상태 (newSwingState)
 * @param vN  어깨 기준 손목의 3차원 속도 (어깨너비/초). 못 구하면 0
 * @param now 현재 시각(ms)
 * @returns {{swing:boolean, swinging:boolean}}  swing: 휘두름이 시작된 그 순간 true,  swinging: 지금 휘두르는 중이거나 방금 휘둘렀음
 */
export function stepSwing(s, vN, now) {
  let swing = false;
  if (vN > SWING.ON) {
    s.lastAbove = now;
    if (!s.active && now - s.lastOn > SWING.COOL_MS) { swing = true; s.lastOn = now; }
    s.active = true;
  } else if (vN < SWING.OFF) {
    s.active = false;
  }
  return { swing, swinging: s.active || now - s.lastAbove < SWING.GRACE_MS };
}
