// 포즈 미믹 테스트 (Node):  node test/poses.test.js
// 핵심: ① 캐릭터가 보여 주는 자세를 그대로 따라 하면 반드시 인식 ② 서 있기만 하면/다른 자세를 취하면 절대 인식 안 됨
//       ③ 멀리/가까이 서도, 약간 기울어도, 인식 잡음이 있어도 인식 ④ 난이도가 올라갈수록 어려운 자세가 나옴
import assert from "node:assert/strict";
import { POSES, LIMBS, ARM_LIMBS, LEVELS, anglesOf, skeletonFromAngles, matchPose, hintFor, needsLegs, pickPose, levelFor, poseScore, lerpAngles, poseById, angDiff, limbAngle, torsoLength } from "../poses.js";

const tests = [];
const test = (n, f) => tests.push([n, f]);
let seed = 2026;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** 자세(각도)로부터 카메라가 보는 것 같은 33점 몸을 만들어요 (크기·위치·기울기·잡음·가려짐 조절 가능) */
function bodyFrom(anglesObj, { scale = 220, ox = 640, oy = 200, rot = 0, noiseDeg = 0, noisePx = 0, hide = [], vis = 0.95 } = {}) {
  if (noiseDeg) {            // 마디 각도에 잡음을 넣고 그 각도로 몸을 다시 만들어요
    const a2 = { ...anglesObj };
    for (const k of LIMBS) a2[k] += (rnd() - 0.5) * 2 * noiseDeg;
    return bodyFrom(a2, { scale, ox, oy, rot, noisePx, hide, vis });
  }
  const sk = skeletonFromAngles(anglesObj);
  const jitter = () => (rnd() - 0.5) * 2 * noisePx;
  const c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180);
  const P = ([x, y]) => ({ x: ox + (x * c - y * s) * scale + jitter(), y: oy + (x * s + y * c) * scale + jitter(), v: vis });
  const b = Array.from({ length: 33 }, () => ({ x: ox, y: oy, v: 0.99 }));
  const map = { 0: sk.head, 11: sk.ls, 12: sk.rs, 13: sk.le, 14: sk.re, 15: sk.lw, 16: sk.rw, 23: sk.lh, 24: sk.rh, 25: sk.lk, 26: sk.rk, 27: sk.la, 28: sk.ra };
  for (const [i, p] of Object.entries(map)) b[i] = P(p);
  for (const i of hide) b[i] = { ...b[i], v: 0.05 };
  return b;
}
const HIDE_LEGS = [23, 24, 25, 26, 27, 28];
const NEUTRAL = { LU: 100, LF: 100, RU: 80, RF: 80, LT: 96, LS: 96, RT: 84, RS: 84, drop: 0 };
const bodyOf = (pose, o) => bodyFrom(anglesOf(pose), { ...o, hide: pose.legs || pose.extra ? [] : HIDE_LEGS });
const need = (p) => (p.legs || p.extra ? LIMBS : ARM_LIMBS).filter((l) => !p.free.includes(l));

test("자세가 충분히 많고 레벨 1~5가 모두 있음", () => {
  assert.ok(POSES.length >= 30, `자세 ${POSES.length}개`);
  for (let l = 1; l <= 5; l++) assert.ok(POSES.filter((p) => p.level === l).length >= 4, `레벨 ${l} 자세가 부족해요`);
  assert.equal(new Set(POSES.map((p) => p.id)).size, POSES.length, "id 중복");
  assert.equal(new Set(POSES.map((p) => p.name)).size, POSES.length, "이름 중복");
});
test("① 캐릭터가 보여 주는 자세를 그대로 따라 하면 모든 자세가 인식됨 (자기 레벨 기준)", () => {
  for (const p of POSES) {
    const m = matchPose(p, p.level, bodyOf(p));
    assert.equal(m.matched, true, `${p.id}(${p.name}) 인식 실패: ${JSON.stringify(m.perLimb)}`);
    assert.ok(m.score > 0.95, `${p.id} 일치율 ${m.score}`);
  }
});
test("② 그냥 서 있기만 하면(차렷) 어떤 자세도 인식되지 않음", () => {
  for (const p of POSES) for (const hide of [HIDE_LEGS, []]) {
    assert.equal(matchPose(p, p.level, bodyFrom(NEUTRAL, { hide })).matched, false, `${p.id}(${p.name})가 차렷에 인식돼요`);
  }
});
test("② 다른 자세를 취하면 인식되지 않음 (혼동 검사: 요구가 더 적은 자세로 인식되는 경우만 허용)", () => {
  const bad = [];
  for (const a of POSES) for (const b of POSES) {
    if (a.id === b.id) continue;
    if (!matchPose(b, b.level, bodyOf(a)).matched) continue;
    // b가 a보다 덜 엄격한 경우: 요구하는 마디가 더 적거나, 같지만 b에는 앉기/무릎 같은 추가 동작 조건이 없는 경우
    const subset = need(b).every((l) => need(a).includes(l)) && (need(b).length < need(a).length || (!b.extra && !!a.extra));
    if (!subset) bad.push(`${a.id} → ${b.id}`);
  }
  assert.deepEqual(bad, [], "서로 헷갈리는 자세가 있어요: " + bad.join(", "));
});
test("③ 가까이/멀리 서도(크기 80~560), 위치가 달라도 인식됨", () => {
  for (const p of POSES) for (const scale of [80, 160, 330, 560]) for (const [ox, oy] of [[300, 100], [900, 260]]) {
    assert.equal(matchPose(p, p.level, bodyOf(p, { scale, ox, oy })).matched, true, `${p.id} scale=${scale}`);
  }
});
test("③ 인식 잡음(관절 ±3px, 각도 ±7°)과 몸이 ±6° 기울어도 가장 어려운 레벨에서 인식됨 (97% 이상)", () => {
  const fails = [];
  for (const p of POSES) for (let k = 0; k < 6; k++) {
    if (!matchPose(p, 5, bodyOf(p, { noisePx: 3, noiseDeg: 7, rot: (rnd() - 0.5) * 12 })).matched) fails.push(p.id);
  }
  assert.ok(fails.length <= POSES.length * 6 * 0.03, `잡음에서 인식 실패 ${fails.length}번: ${[...new Set(fails)].join(",")}`);
});
test("레벨이 오를수록 허용 오차가 줄어듦 (같은 어긋남이 낮은 레벨에선 통과, 높은 레벨에선 실패)", () => {
  const p = poseById("tPose");
  const body = bodyFrom({ ...anglesOf(p), LU: 180 - 34, RU: 34 }, { hide: HIDE_LEGS });      // 위팔 34° 어긋남
  assert.equal(matchPose(p, 1, body).matched, true);
  assert.equal(matchPose(p, 5, body).matched, false);
  for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].tol < LEVELS[i - 1].tol && LEVELS[i].hold >= LEVELS[i - 1].hold && LEVELS[i].time <= LEVELS[i - 1].time);
});
test("다리가 안 보여도 팔 자세는 인식되고, 다리가 필요한 자세는 인식되지 않으며 안내가 나옴", () => {
  const arm = poseById("armsUp"), leg = poseById("star");
  assert.equal(matchPose(arm, 1, bodyOf(arm)).matched, true);
  assert.equal(needsLegs(arm), false); assert.equal(needsLegs(leg), true);
  const hidden = bodyFrom(anglesOf(leg), { hide: HIDE_LEGS });
  const m = matchPose(leg, 3, hidden);
  assert.equal(m.matched, false);
  assert.ok(m.missing.length > 0);
  assert.match(hintFor(leg, 3, hidden), /뒤로|발끝/);
});
test("팔이 가려지면 인식되지 않고 안내가 나옴", () => {
  const p = poseById("tPose");
  const b = bodyFrom(anglesOf(p), { hide: [15, 16, 13, 14, ...HIDE_LEGS] });
  assert.equal(matchPose(p, 1, b).matched, false);
  assert.match(hintFor(p, 1, b), /팔/);
});
test("틀린 곳을 알려 줌: 방향이 맞음", () => {
  const p = poseById("tPose");
  const lowL = bodyFrom({ ...anglesOf(p), LU: 135, LF: 135 }, { hide: HIDE_LEGS });         // 왼팔이 아래로 처짐
  assert.match(hintFor(p, 3, lowL), /왼.*(올려요|뻗어요)/);
  const highR = bodyFrom({ ...anglesOf(p), RU: -50, RF: -50 }, { hide: HIDE_LEGS });        // 오른팔이 너무 위
  assert.match(hintFor(p, 3, highR), /오른.*(내려요)/);
  assert.equal(hintFor(p, 3, bodyOf(p)), null, "맞았으면 안내 없음");
});
test("앉기/무릎 올리기는 각도 대신 동작으로 판정: 서 있으면 실패, 맞는 동작이면 성공", () => {
  const squat = poseById("squatT"), knee = poseById("kneeUp"), kneeR = poseById("kneeUp_m");
  assert.equal(matchPose(squat, 3, bodyFrom({ ...anglesOf(squat), LT: 96, LS: 96, RT: 84, RS: 84 })).matched, false, "서서는 스쿼트 아님");
  assert.equal(matchPose(squat, 3, bodyOf(squat)).matched, true);
  assert.equal(matchPose(knee, 3, bodyOf(kneeR)).matched, false, "오른쪽 무릎을 올리면 왼쪽 무릎 자세가 아님");
  assert.equal(matchPose(kneeR, 3, bodyOf(knee)).matched, false);
  assert.match(hintFor(squat, 3, bodyFrom(NEUTRAL)), /앉|무릎/);
});
test("좌우 대칭 자세는 서로 거울상이고, 거울상끼리는 헷갈리지 않음", () => {
  for (const p of POSES.filter((x) => x.mirrorOf)) {
    const orig = poseById(p.mirrorOf);
    assert.notEqual(orig, null);
    assert.equal(matchPose(orig, orig.level, bodyOf(p)).matched, false, `${orig.id} vs ${p.id}`);
    assert.equal(matchPose(p, p.level, bodyOf(orig)).matched, false, `${p.id} vs ${orig.id}`);
  }
});
test("난이도가 올라갈수록 어려운 자세가 나옴 (레벨별 평균 자세 레벨이 증가)", () => {
  seed = 99;
  const avg = [];
  for (let level = 1; level <= 5; level++) {
    let sum = 0, last = null;
    for (let i = 0; i < 400; i++) { const p = pickPose(level, last, rnd); assert.ok(p.level <= level); assert.notEqual(p.id, last); sum += p.level; last = p.id; }
    avg.push(sum / 400);
  }
  for (let i = 1; i < avg.length; i++) assert.ok(avg[i] > avg[i - 1], `레벨 ${i + 1} 평균 ${avg[i]} <= ${avg[i - 1]}`);
  assert.equal(avg[0], 1, "레벨 1에서는 레벨 1 자세만");
});
test("바로 앞 자세와 그 거울상은 연달아 나오지 않음", () => {
  seed = 5;
  for (let i = 0; i < 500; i++) { const a = pickPose(5, "leftUp", rnd); assert.ok(a.id !== "leftUp" && a.id !== "leftUp_m"); }
});
test("3번 성공할 때마다 레벨이 오르고 5가 최대", () => {
  assert.deepEqual([0, 2, 3, 5, 6, 9, 12, 15, 40].map(levelFor), [1, 1, 2, 2, 3, 4, 5, 5, 5]);
});
test("점수: 레벨·속도·연속 성공일수록 높음 (한 자세 3~11점)", () => {
  assert.ok(poseScore(5, 6, 3) > poseScore(1, 0, 1));
  const lo = poseScore(1, 0, 1), hi = poseScore(5, 9, 5);
  assert.ok(lo >= 3 && hi <= 11, `${lo}~${hi}`);
});
test("중간 자세 보간: 처음/끝이 정확하고 가장 짧은 방향으로 회전", () => {
  const a = anglesOf(poseById("tPose")), b = anglesOf(poseById("armsUp"));
  const m0 = lerpAngles(a, b, 0), m1 = lerpAngles(a, b, 1), mid = lerpAngles({ ...a, LU: 170 }, { ...a, LU: -170 }, 0.5);
  for (const k of LIMBS) { assert.ok(angDiff(m0[k], a[k]) < 1e-9); assert.ok(angDiff(m1[k], b[k]) < 1e-9); }
  assert.ok(angDiff(mid.LU, 180) < 1e-6, "170°와 -170° 사이는 180° (반대로 돌지 않음)");
});
test("마디 각도/몸 크기 재기", () => {
  const b = bodyFrom(NEUTRAL, { scale: 300 });
  assert.ok(Math.abs(limbAngle(b, "LU") - 100) < 1e-6);
  assert.ok(Math.abs(torsoLength(b) - 300) < 1e-6);
  assert.equal(limbAngle(bodyFrom(NEUTRAL, { hide: [13] }), "LU"), null);
});

let failed = 0;
for (const [n, f] of tests) { try { f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", e.message.split("\n")[0].slice(0, 500)); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
