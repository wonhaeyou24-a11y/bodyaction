// 커스튬 흔들림(스프링 관성) 테스트: node test/costume.test.js
import { Spring, CostumeMotion } from "../costume-physics.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const run = (m, frames, posAt, wristAt = () => [null, null], fps = 60, unit = 200) => {
  const out = [];
  for (let i = 0; i < frames; i++) { m.update(1000 + (i * 1000) / fps, posAt(i / fps), unit, wristAt(i / fps)); out.push({ h: m.head.rot, b: m.back.rot, hy: m.head.dy, w0: m.hands[0].rot }); }
  return out;
};

t("스프링: 목표 0이면 0으로 수렴", () => {
  const s = new Spring(100, 10, 1); s.x = 0.5;
  for (let i = 0; i < 300; i++) s.step(1 / 60, 0);
  ok(Math.abs(s.x) < 0.001, "x=" + s.x);
});
t("스프링: 큰 dt(프레임 멈춤)에도 안 터짐", () => {
  const s = new Spring(160, 11, 0.5);
  for (const dt of [0.05, 0.05, 0.001, 0.05]) { s.step(dt, 0.4); ok(Number.isFinite(s.x) && Math.abs(s.x) <= 0.5 + 1e-9, "x=" + s.x); }
});
t("가만히 있으면 흔들림 0", () => {
  const m = new CostumeMotion(); const r = run(m, 120, () => ({ x: 400, y: 300 }));
  ok(r.every((v) => Math.abs(v.h) < 1e-6 && Math.abs(v.b) < 1e-6 && Math.abs(v.hy) < 1e-6), "움직임이 생김");
});
t("오른쪽으로 달리면 모자는 왼쪽, 망토는 반대 방향으로 기울어요", () => {
  const m = new CostumeMotion(); const r = run(m, 40, (s) => ({ x: 400 + s * 400, y: 300 }));
  const last = r[r.length - 1];
  ok(last.h < -0.05, "모자 기울기 " + last.h); ok(last.b > 0.1, "망토 기울기 " + last.b);
});
t("몸이 멈추면 출렁이다가 가라앉음 (0.05~0.3초 시차)", () => {
  const m = new CostumeMotion();
  const r = run(m, 240, (s) => ({ x: s < 1 ? 400 + s * 400 : 800, y: 300 }));
  ok(Math.abs(r[239].b) < 0.01, "가라앉지 않음 " + r[239].b);
  // 멈춘 직후(1초) 바로 0이 아님: 관성이 남아 있어요
  ok(Math.abs(r[66].b) > 0.01, "관성 없음 " + r[66].b);
});
t("흔들림 크기 제한 (아무리 빨라도 ±0.7rad)", () => {
  const m = new CostumeMotion(); const r = run(m, 60, (s) => ({ x: 400 + s * 5000, y: 300 }));
  ok(r.every((v) => Math.abs(v.b) <= 0.7 + 1e-9 && Math.abs(v.h) <= 0.45 + 1e-9), "한계 초과");
});
t("추적이 튀어도(순간이동) 흔들림이 폭주하지 않음", () => {
  const m = new CostumeMotion(); const r = run(m, 90, (s) => ({ x: s === 0.5 ? 1500 : 400, y: 300 }));
  ok(r.every((v) => Number.isFinite(v.b) && Math.abs(v.b) <= 0.7 + 1e-9), "폭주");
  ok(Math.abs(r[89].b) < 0.02, "복귀 못 함 " + r[89].b);
});
t("몸이 한동안 사라졌다 나타나면 새로 시작(순간이동 속도 없음)", () => {
  const m = new CostumeMotion();
  m.update(1000, { x: 100, y: 100 }, 200, [null, null]);
  m.update(1016, { x: 100, y: 100 }, 200, [null, null]);
  m.update(5000, { x: 900, y: 500 }, 200, [null, null]);
  ok(m.back.rot === 0 && m.head.rot === 0, "리셋 안 됨");
});
t("점프하면(위로 이동) 모자가 위아래로 출렁임", () => {
  const m = new CostumeMotion(); const r = run(m, 30, (s) => ({ x: 400, y: 300 - s * 600 }));
  ok(Math.max(...r.map((v) => Math.abs(v.hy))) > 0.03, "출렁임 없음");
});
t("손목 속도가 무기 기울기로: 오른쪽으로 휘두르면 끝이 왼쪽으로 늦게 따라와요", () => {
  const m = new CostumeMotion();
  const r = run(m, 30, () => ({ x: 400, y: 300 }), (s) => [{ x: 300 + s * 800, y: 400 }, null]);
  ok(r[29].w0 < -0.1, "w0=" + r[29].w0);
});
t("사람마다 상태가 독립", () => {
  const a = new CostumeMotion(), b = new CostumeMotion();
  run(a, 30, (s) => ({ x: 400 + s * 400, y: 300 }));
  const rb = run(b, 30, () => ({ x: 400, y: 300 }));
  ok(Math.abs(rb[29].b) < 1e-9, "섞임");
});
t("NaN/없는 손목에도 안전", () => {
  const m = new CostumeMotion();
  for (let i = 0; i < 20; i++) { m.update(1000 + i * 16, { x: 400, y: 300 }, 200, [null, { x: NaN, y: 3 }]); }
  ok(Number.isFinite(m.back.rot) && Number.isFinite(m.hands[0].rot), "유한하지 않음");
});

console.log(`커스튬 흔들림: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
