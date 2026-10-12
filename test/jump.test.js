// 러너 점프/앉기 판정 테스트: node test/jump.test.js
// 핵심: ① 가만히/흔들/숨쉬기/뒤로 물러서기/골반이 깜박여도 점프로 오인하지 않음 ② 진짜 점프(작은 뜀박질 포함)는 반드시 인식
import { jumpSample, newJumpState, stepJump } from "../jump.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const TL = 200;                                  // 몸통 길이(px)
const FPS = 60, DT = 1 / FPS;

/** 어깨 높이 y(t)를 흘려서 점프/앉기 이벤트를 모아요 */
function run(seconds, yAt, { noise = 0, hipAt = () => true, rng = mulberry(1) } = {}) {
  const s = newJumpState(); const jumps = [], ducks = []; let duckFrames = 0;
  for (let i = 0; i < seconds * FPS; i++) {
    const tt = i / FPS, y = 300 + yAt(tt) + (rng() - 0.5) * 2 * noise;
    const b = Array.from({ length: 33 }, () => ({ x: 400, y, v: 1 }));
    b[11] = { x: 340, y, v: 1 }; b[12] = { x: 460, y, v: 1 };
    const hip = hipAt(tt); b[23] = { x: 360, y: y + TL, v: hip ? 1 : 0.1 }; b[24] = { x: 440, y: y + TL, v: hip ? 1 : 0.1 };
    const r = stepJump(s, jumpSample(b), DT, 1000 + tt * 1000);
    if (r.jump) jumps.push(tt); if (r.duck) duckFrames++;
  }
  return { jumps, duckFrames };
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

/** 점프: 시작 t0, 높이 h(px), 공중 시간 d(초). 위로 올라가면 y가 줄어요 */
const jumpAt = (t0, h, d) => (tt) => { const u = (tt - t0) / d; return u > 0 && u < 1 ? -4 * h * u * (1 - u) : 0; };
const sum = (...f) => (tt) => f.reduce((a, g) => a + g(tt), 0);

t("가만히 서 있기(잡음 ±1.5px) 30초: 점프/앉기 없음", () => {
  const r = run(30, () => 0, { noise: 1.5 }); ok(r.jumps.length === 0, "jumps=" + r.jumps.length); ok(r.duckFrames === 0, "duck");
});
t("숨쉬기/몸 흔들기(진폭 3%, 0.3Hz·1Hz): 점프 없음", () => {
  const r = run(30, (tt) => 6 * Math.sin(tt * 2 * Math.PI * 0.3) + 4 * Math.sin(tt * 2 * Math.PI * 1), { noise: 1 }); ok(r.jumps.length === 0, "jumps=" + r.jumps.length);
});
t("뒤로 물러서기(5초 동안 몸통 길이의 35% 위로 천천히 이동): 점프 없음", () => {
  const r = run(12, (tt) => -Math.min(tt, 5) / 5 * 0.35 * TL, { noise: 1.5 }); ok(r.jumps.length === 0, "jumps=" + r.jumps.length);
});
t("카메라 쪽으로 다가오기(5초 동안 25% 아래로): 점프/앉기 없음", () => {
  const r = run(12, (tt) => Math.min(tt, 5) / 5 * 0.25 * TL, { noise: 1.5 }); ok(r.jumps.length === 0 && r.duckFrames < 5, `jumps=${r.jumps.length} duck=${r.duckFrames}`);
});
t("몸 앞뒤로 기울이기(1초에 8% 숙였다 올라옴): 점프 없음", () => {
  const r = run(10, (tt) => 0.08 * TL * Math.sin(tt * Math.PI) ** 2 * (tt < 1 ? 1 : 0), { noise: 1 }); ok(r.jumps.length === 0, "jumps=" + r.jumps.length);
});
t("골반이 보였다 안 보였다 반복해도 점프 없음 (예전 오인식의 원인)", () => {
  const r = run(20, () => 0, { noise: 1.5, hipAt: (tt) => Math.floor(tt * 7) % 2 === 0 }); ok(r.jumps.length === 0, "jumps=" + r.jumps.length);
});
t("인식이 한 프레임 튀어도(+몸통 길이 12%) 점프 아님", () => {
  const r = run(5, (tt) => (Math.abs(tt - 2) < 0.5 / FPS ? -0.12 * TL : 0)); ok(r.jumps.length === 0, "jumps=" + r.jumps.length);
});
t("진짜 점프(몸통 40% 높이, 0.5초)는 인식, 떠오른 직후에 발동", () => {
  const r = run(4, jumpAt(2, 0.4 * TL, 0.5), { noise: 1 }); ok(r.jumps.length === 1, "jumps=" + r.jumps.length); ok(r.jumps[0] > 2 && r.jumps[0] < 2.25, "t=" + r.jumps[0]);
});
t("작은 뜀박질(몸통 22%, 0.4초)도 인식", () => {
  const r = run(4, jumpAt(2, 0.22 * TL, 0.4), { noise: 1 }); ok(r.jumps.length === 1, "jumps=" + r.jumps.length);
});
t("웅크렸다 뛰는 점프(8% 숙였다가 35% 점프)도 인식", () => {
  const f = sum((tt) => (tt > 1.7 && tt < 2 ? 0.08 * TL * Math.sin(((tt - 1.7) / 0.3) * Math.PI) : 0), jumpAt(2, 0.35 * TL, 0.5));
  const r = run(4, f, { noise: 1 }); ok(r.jumps.length === 1, "jumps=" + r.jumps.length);
});
t("앉기는 앉기로만 인식하고, 일어설 때는 점프가 아님", () => {
  const f = (tt) => (tt < 1 ? 0 : tt < 1.3 ? ((tt - 1) / 0.3) * 0.3 * TL : tt < 2.5 ? 0.3 * TL : tt < 2.9 ? (1 - (tt - 2.5) / 0.4) * 0.3 * TL : 0);
  const r = run(5, f, { noise: 1 }); ok(r.duckFrames > 60, "duck=" + r.duckFrames); ok(r.jumps.length === 0, "jumps=" + r.jumps.length);
});
t("1초 간격 연속 점프 3번 → 3번", () => {
  const r = run(6, sum(jumpAt(1, 0.35 * TL, 0.5), jumpAt(2.2, 0.35 * TL, 0.5), jumpAt(3.4, 0.35 * TL, 0.5)), { noise: 1 }); ok(r.jumps.length === 3, "jumps=" + r.jumps.length);
});
t("점프 후 몸이 조금 앞으로 쏠려도(기준 8% 이동) 다음 점프 인식", () => {
  const r = run(6, sum(jumpAt(1, 0.35 * TL, 0.5), (tt) => (tt > 1.6 ? 0.08 * TL : 0), jumpAt(3, 0.35 * TL, 0.5)), { noise: 1 }); ok(r.jumps.length === 2, "jumps=" + r.jumps.length);
});
t("몸이 가까워져 몸통이 커져도(몸통 길이 +30%) 점프 인식 유지", () => {
  const s = newJumpState(); let n = 0;
  for (let i = 0; i < 5 * FPS; i++) {
    const tt = i / FPS, big = 1.3, y = 300 + jumpAt(2.5, 0.4 * TL * big, 0.5)(tt);
    const b = Array.from({ length: 33 }, () => ({ x: 400, y, v: 1 }));
    b[11] = { x: 330, y, v: 1 }; b[12] = { x: 470, y, v: 1 }; b[23] = { x: 360, y: y + TL * big, v: 1 }; b[24] = { x: 440, y: y + TL * big, v: 1 };
    if (stepJump(s, jumpSample(b), DT, 1000 + tt * 1000).jump) n++;
  }
  ok(n === 1, "n=" + n);
});
t("몸이 안 보이면(샘플 없음) null", () => { ok(jumpSample(null) === null && jumpSample(Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))) === null, "null 아님"); });
t("프레임 간격이 들쭉날쭉(20~60fps)해도 점프 인식, 가만히면 오인식 없음", () => {
  const rng = mulberry(7); const s = newJumpState(); let now = 1000, tt = 0, jumps = 0, still = 0;
  while (tt < 8) {
    const dt = 1 / (20 + rng() * 40); tt += dt; now += dt * 1000;
    const y = 300 + jumpAt(5, 0.35 * TL, 0.5)(tt) + (rng() - 0.5) * 3;
    const b = Array.from({ length: 33 }, () => ({ x: 400, y, v: 1 }));
    b[11] = { x: 340, y, v: 1 }; b[12] = { x: 460, y, v: 1 }; b[23] = { x: 360, y: y + TL, v: 1 }; b[24] = { x: 440, y: y + TL, v: 1 };
    if (stepJump(s, jumpSample(b), dt, now).jump) { if (tt < 5) still++; else jumps++; }
  }
  ok(still === 0 && jumps === 1, `still=${still} jumps=${jumps}`);
});

console.log(`점프 판정: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
