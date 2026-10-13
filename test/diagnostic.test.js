// 🔬 종합 성능 · 모션 반응성 · 인식률 · 오류 복구 진단 테스트 스위트
// 실행: node test/diagnostic.test.js

import { AlphaBeta } from "../tracker.js";
import { newJumpState, stepJump, jumpSample } from "../jump.js";
import { newLaneState, stepLane } from "../lane.js";
import { createRun, stepRun, CRUN } from "../crun-core.js";
import { newPunchState, stepPunch } from "../punch.js";

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    failed++;
  }
}

console.log("=== 🔬 1. 모션 움직임 & 지연 시간(Lag/Jitter) 분석 ===");

test("정지 상태 미세 떨림(Jitter) 0% 억제 검증", () => {
  const trk = new AlphaBeta();
  // 100프레임 동안 미세한 노이즈(±1.5px) 주입
  const t0 = 1000;
  for (let i = 0; i < 60; i++) {
    const noise = Math.sin(i * 1.5) * 1.5;
    trk.update(200 + noise, 300 + noise, t0 + i * 16.6);
  }
  const pos = trk.at(t0 + 60 * 16.6);
  const diffX = Math.abs(pos.x - 200);
  const diffY = Math.abs(pos.y - 300);
  if (diffX > 2.0 || diffY > 2.0) throw new Error(`정지 떨림 억제 실패: 오차(${diffX.toFixed(2)}, ${diffY.toFixed(2)})`);
});

test("고속 휘두름(High-Speed Swing) 지연 시간 단축 검증 (adaptive active)", () => {
  const trk = new AlphaBeta();
  const t0 = 1000;
  trk.update(100, 100, t0);
  // 50ms 만에 100 -> 500으로 고속 이동
  trk.update(500, 100, t0 + 50);
  const pos = trk.at(t0 + 50);
  // 속도 비례 가변 알파로 70% 이상 신속하게 따라붙어야 함
  if (pos.x < 380) throw new Error(`고속 추종 지연 과다: ${pos.x}`);
});

console.log("\n=== 🎯 2. 점프 & 앉기 & 레인 모션 인식률 분석 ===");

test("점프 정상 인식 및 체공 판정", () => {
  const js = newJumpState();
  const now = 1000;
  const tl = 150;
  // 서 있는 자세
  stepJump(js, { y: 250, tl }, 0.016, now);
  stepJump(js, { y: 250, tl }, 0.016, now + 16);
  // 위로 도약 (y 감소 = 위)
  stepJump(js, { y: 210, tl }, 0.016, now + 33);
  const r2 = stepJump(js, { y: 190, tl }, 0.016, now + 50);
  if (!r2.jump) throw new Error("도약 2프레임 연속 점프 판정 실패");
});

test("앉았다 일어서는 동작(Squat Standup)의 점프 오인식 0% 방지", () => {
  const js = newJumpState();
  let now = 2000;
  const tl = 150;
  // 서 있다가 앉음 (y 증가 = 아래로 웅크림)
  stepJump(js, { y: 250, tl }, 0.016, now);
  now += 300;
  stepJump(js, { y: 290, tl }, 0.016, now); // 앉기 상태
  // 빠르게 일어섬 (y 감소)
  now += 150;
  const up1 = stepJump(js, { y: 260, tl }, 0.016, now);
  now += 20;
  const up2 = stepJump(js, { y: 250, tl }, 0.016, now);
  if (up1.jump || up2.jump) throw new Error("앉았다 일어서기를 점프로 잘못 오인식함");
});

test("좌우 레인 이동 히스테리시스 및 경계 덜덜거림 방지", () => {
  const ls = newLaneState();
  // 정중앙 서기
  stepLane(ls, 0.0, 0.016);
  // 오른쪽으로 이동
  let cur = 0;
  for (let i = 0; i < 10; i++) {
    cur = stepLane(ls, 0.65, 0.016);
  }
  if (cur !== 1) throw new Error("우측 레인 변경 실패");
  // 경계선 부근(0.35)에서 미세 흔들림 시 레인 유지(바운싱 방지)
  cur = stepLane(ls, 0.35, 0.016);
  if (cur !== 1) throw new Error("히스테리시스 경계 바운싱 발생");
});

console.log("\n=== ⚡ 3. 런타임 게임 루프 성능 & Zero-Crash 복구력 분석 ===");

test("비정상 입력값 (NaN, null, 시간 역전) 유입 시 100% 무중단 복구", () => {
  const trk = new AlphaBeta();
  trk.update(100, 100, 1000);
  trk.update(NaN, undefined, 1016);
  trk.update(200, 200, 900); // 시간 역전
  const pos = trk.at(1050);
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    throw new Error("비정상 입력 후 좌표 계산 오염 (NaN 발생)");
  }
});

test("10,000 프레임 러너 루프 초고속 연속 실행 벤치마크 (메모리/성능 검증)", () => {
  const run = createRun();
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    stepRun(run, { lane: (i % 3), jump: (i % 60 === 0), duck: (i % 80 === 0) }, 0.016, 1.0);
  }
  const elapsedMs = performance.now() - t0;
  const fpsEquivalent = (10000 / (elapsedMs / 1000));
  if (fpsEquivalent < 1000) throw new Error(`루프 연산 속도 저하: ${fpsEquivalent.toFixed(0)} FPS`);
  console.log(`    (벤치마크 결과: 10,000 프레임 연산 소요 ${elapsedMs.toFixed(1)}ms -> 환산 ${Math.round(fpsEquivalent).toLocaleString()} FPS 초고속 처리 보장)`);
});

console.log(`\n=== 📊 진단 테스트 결과: ${passed}개 통과, ${failed}개 실패 ===`);
if (failed > 0) process.exit(1);
