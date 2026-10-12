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

// ---------------------------------------------------------------------------------------------
// 몸 인식(포즈) 기반 펀치 판정. 손 인식과 달리 "손이 커지는 것"을 못 보고, 정면에서 카메라 쪽으로 뻗는 펀치는 화면에서
// 거의 안 움직여 보여요 → 예전처럼 "화면 속도 828px/s(=화면 높이×1.15)"를 기준으로 하면 거의 인식이 안 돼요.
// 그래서 ① 어깨에 대한 손목의 움직임(몸이 흔들리거나 걸어도 영향 없음) ② 깊이(z)까지 합친 3차원 속도를
// ③ 어깨너비로 나눈 값(가까이/멀리 서도, 아이도 같은 기준)으로 판단해요. 단위: 어깨너비/초 (sw/s)
//   - 가만히 있기·숨쉬기·몸 기울이기 ≈ 0~1, 천천히 팔 올리기 ≈ 1~2.5, 잽/스트레이트 ≈ 4~9
export const PUNCH_N = { HI: 2.2, LO: 1.0, FRAMES: 2, COOL: 0.2, RETRACT: 0.3 };

export const KICK_N = { HI: 3.0, LO: 1.4, FRAMES: 2, COOL: 0.35, RETRACT: 0.4 };   // 발차기(발목 속도)용

/**
 * @param f   손(팔)마다 하나씩 가지는 상태 (newPunchState)
 * @param vN  어깨 기준 손목의 3차원 속도 (어깨너비/초)
 * @param dt  지난 시간(초)
 * @param cfg 기준값 (기본 PUNCH_N, 발차기는 KICK_N)
 * @returns {{strike:boolean, intensity:number}}  intensity 1(보통) ~ 2.5(아주 센 펀치)
 */
export const RETURN_STROKE = { WITHIN: 0.6, DOT: -0.2 };   // 휘두른 뒤 0.6초 안에 정반대 방향(내적 -0.2 미만)으로 빠르게 움직이면 "팔 거두기"로 봐요
export function stepPunchN(f, vN, dt, cfg = PUNCH_N, dir = null) {
  const { HI, LO, FRAMES, COOL, RETRACT } = cfg;
  f.cool = Math.max(0, f.cool - dt);
  f.retractT = Math.max(0, f.retractT - dt);
  f.since = (f.since ?? 99) + dt;
  if (f.state === "IDLE") {
    f.fast = vN > HI ? f.fast + 1 : 0;
    if (f.fast >= FRAMES && f.cool <= 0) {
      f.fast = 0; f.state = "RETRACT"; f.cool = COOL; f.retractT = RETRACT;
      // 방금 휘두른 것의 반대 방향이면 되돌리는 동작: 상태는 쉬게 하되 한 번으로 세지 않아요
      const back = dir && f.lastDir && f.since < RETURN_STROKE.WITHIN && (dir[0] * f.lastDir[0] + dir[1] * f.lastDir[1] + dir[2] * f.lastDir[2]) < RETURN_STROKE.DOT;
      if (back) { f.lastDir = null; f.since = 0; return { strike: false, intensity: 1, back: true }; }
      f.lastDir = dir ? dir.slice() : null; f.since = 0;
      return { strike: true, intensity: clamp(vN / HI, 1, 2.5) };
    }
  } else if (f.retractT <= 0 || (f.cool <= 0 && vN < LO)) {
    f.state = "IDLE"; f.fast = 0;
  }
  return { strike: false, intensity: 1 };
}
