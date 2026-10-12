// 스피드 샌드백 펀치 판정 (화면/게임을 모르는 순수 규칙, node test/punch.test.js 로 시험).
//
// 예전 방식: "화면 한 프레임에 6.5픽셀 넘게 움직이면 펀치" → 카메라 잡음/위치 튐 한 번에도 펀치가 나왔고,
//            프레임 수와 화면 크기에 따라 기준이 달라졌어요.
// 지금 방식: 초당 이동 속도(px/s)를 화면 크기(작은 쪽 변)로 나눠서 판단해요.
//   - 1초에 화면 높이의 1.15배 이상(HI)을 2프레임 이상 연속으로 달려야 펀치  (한 번 튀는 건 무시)
//   - 펀치 뒤 0.2초는 다시 못 쳐요 (초당 최대 5번)
//   - 주먹을 거두어 속도가 0.5배(LO) 밑으로 떨어지거나 0.3초가 지나야 다음 펀치를 준비해요
//   - 카메라 쪽으로 쭉 내지르는 동작(punchFlag: 손이 커짐)은 더 낮은 속도(LO)에서도 인정해요

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function newPunchState() { return { state: "IDLE", cool: 0, retractT: 0, fast: 0 }; }

/**
 * @param f          손마다 하나씩 가지는 상태 (newPunchState)
 * @param vps        손의 초당 이동 속도 (px/s)
 * @param punchFlag  "앞으로 내지르기"가 감지된 순간인지
 * @param dt         지난 시간(초)
 * @param unit       화면 크기 기준값 (보통 min(가로, 세로))
 * @returns {{strike:boolean, intensity:number}}  intensity: 1(보통) ~ 2.5(아주 센 펀치)
 */
export function stepPunch(f, vps, punchFlag, dt, unit) {
  f.cool = Math.max(0, f.cool - dt);
  f.retractT = Math.max(0, f.retractT - dt);
  const HI = unit * 1.15, LO = unit * 0.5;
  if (f.state === "IDLE") {
    f.fast = vps > HI ? f.fast + 1 : 0;
    if ((f.fast >= 2 || (punchFlag && vps > LO)) && f.cool <= 0) {
      f.fast = 0; f.state = "RETRACT"; f.cool = 0.2; f.retractT = 0.3;
      return { strike: true, intensity: clamp(vps / HI, 1, 2.5) };
    }
  } else if (f.retractT <= 0 || (f.cool <= 0 && vps < LO)) {
    f.state = "IDLE"; f.fast = 0;
  }
  return { strike: false, intensity: 1 };
}
