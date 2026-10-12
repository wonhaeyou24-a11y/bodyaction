// 캐릭터 시스템 테스트: node test/character.test.js
import { CHARACTERS, DEFAULT_CHARACTER_ID, cleanCharacterId, characterById, loadCharacterId, saveCharacterId, skeletonFromBody, skeletonToPx, skeletonRetarget } from "../character.js";
import { anglesOf, skeletonFromAngles } from "../poses.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; };

t("캐릭터 6종(시안 사람 3 + 여우·로봇·마법사), id/이름 중복 없음", () => {
  ok(CHARACTERS.length === 6, "개수");
  ok(new Set(CHARACTERS.map((c) => c.id)).size === 6 && new Set(CHARACTERS.map((c) => c.name)).size === 6, "중복");
  ok(CHARACTERS.filter((c) => c.art).map((c) => c.id).join() === "scout,neon,fire", "시안 캐릭터");
  ok(["human", "animal", "robot", "fantasy"].every((k) => CHARACTERS.some((c) => c.kind === k)), "종류");
  ok(CHARACTERS.every((c) => c.name && c.title && c.desc && /^#[0-9a-f]{6}$/i.test(c.color)), "필드");
});
t("이상한 값은 기본 캐릭터로", () => {
  for (const v of [null, undefined, "", "hacker", 7, {}, "__proto__", "HARU"]) ok(cleanCharacterId(v) === DEFAULT_CHARACTER_ID, String(v));
  ok(cleanCharacterId("luna") === "luna" && cleanCharacterId("fire") === "fire", "정상값"); ok(characterById("bolt").kind === "robot", "조회");
});
t("저장/불러오기: 저장한 캐릭터가 돌아오고, 깨진 값·저장소 오류도 안전", () => {
  const s = mem();
  ok(loadCharacterId(s, "k") === DEFAULT_CHARACTER_ID, "처음엔 기본");
  ok(saveCharacterId(s, "k", "tori") === "tori" && loadCharacterId(s, "k") === "tori", "저장");
  s.setItem("k", "<script>"); ok(loadCharacterId(s, "k") === DEFAULT_CHARACTER_ID, "깨진 값");
  ok(saveCharacterId(s, "k", "evil") === DEFAULT_CHARACTER_ID, "나쁜 값 저장 시 기본");
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  ok(loadCharacterId(bad, "k") === DEFAULT_CHARACTER_ID && saveCharacterId(bad, "k", "bolt") === "bolt", "저장소 오류");
  ok(loadCharacterId(null, "k") === DEFAULT_CHARACTER_ID, "저장소 없음");
});
t("프로필마다 따로 저장(키가 다르면 서로 영향 없음)", () => {
  const s = mem(); saveCharacterId(s, "character_v1", "tori"); saveCharacterId(s, "p2:character_v1", "luna");
  ok(loadCharacterId(s, "character_v1") === "tori" && loadCharacterId(s, "p2:character_v1") === "luna", "섞임");
});

// ---- 뼈대 ----
const body = (over = {}) => {
  const b = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
  const set = (i, x, y, v = 0.9) => (b[i] = { x, y, v });
  set(0, 400, 120); set(11, 340, 200); set(12, 460, 200); set(13, 320, 290); set(14, 480, 290); set(15, 310, 370); set(16, 490, 370);
  set(23, 360, 400); set(24, 440, 400); set(25, 355, 520); set(26, 445, 520); set(27, 352, 640); set(28, 448, 640);
  for (const [i, v] of Object.entries(over)) b[i] = v === null ? { x: 0, y: 0, v: 0 } : v;
  return b;
};
t("전신이 보이면 모든 관절을 그대로 사용 (추정 없음)", () => {
  const sk = skeletonFromBody(body()); ok(sk, "null");
  ok(sk.est.hips === false && sk.est.legs === false && sk.est.arms === false && sk.est.head === false, "est");
  ok(Math.abs(sk.u - 200) < 1, "몸통 길이 " + sk.u); ok(sk.lw[0] === 310 && sk.ra[1] === 640, "좌표");
});
t("어깨가 안 보이면 null (캐릭터를 안 그림)", () => { ok(skeletonFromBody(body({ 11: null })) === null, "한쪽"); ok(skeletonFromBody(body({ 11: null, 12: null })) === null, "양쪽"); ok(skeletonFromBody(null) === null, "몸 없음"); });
t("다리가 안 보이면 엉덩이 아래로 곧게(차렷) 채움, 길이는 몸 비율", () => {
  const sk = skeletonFromBody(body({ 25: null, 26: null, 27: null, 28: null })); ok(sk.est.legs, "est");
  ok(sk.la[1] > sk.lh[1] + sk.u * 1.4 && Math.abs(sk.la[0] - sk.lh[0]) < 1, "차렷 다리");
});
t("엉덩이까지 안 보이면(상체만) 어깨너비로 몸통을 어림", () => {
  const sk = skeletonFromBody(body({ 23: null, 24: null, 25: null, 26: null, 27: null, 28: null })); ok(sk.est.hips && sk.est.legs, "est");
  ok(Math.abs(sk.u - 120 * 1.55) < 1 && sk.lh[1] > sk.ls[1], "엉덩이 어림");
});
t("팔이 안 보이면 어깨 아래로 늘어뜨림", () => {
  const sk = skeletonFromBody(body({ 13: null, 15: null })); ok(sk.est.arms && sk.lw[1] > sk.ls[1] + sk.u * 1.0, "팔 채움");
});
t("몸이 기울어도 채운 다리는 어깨선에 수직 방향", () => {
  const b = body({ 25: null, 26: null, 27: null, 28: null }); b[11] = { x: 340, y: 230, v: 0.9 }; b[12] = { x: 460, y: 170, v: 0.9 };    // 어깨선이 기울어짐
  const sk = skeletonFromBody(b); const dx = sk.la[0] - sk.lh[0], dy = sk.la[1] - sk.lh[1], sx = sk.rs[0] - sk.ls[0], sy = sk.rs[1] - sk.ls[1];
  ok(Math.abs(dx * sx + dy * sy) / (Math.hypot(dx, dy) * Math.hypot(sx, sy)) < 0.01, "수직 아님");
});
t("값이 NaN이거나 낮은 신뢰도의 점은 사용하지 않음", () => {
  const sk = skeletonFromBody(body({ 15: { x: NaN, y: 3, v: 0.9 }, 16: { x: 1, y: 1, v: 0.1 } })); ok(sk && sk.est.arms, "채움");
  ok(Number.isFinite(sk.lw[0]) && Number.isFinite(sk.rw[0]), "유한");
});
t("skeletonToPx: 각도 뼈대를 화면 크기로 옮김 (어깨 중앙=기준점, 몸통 길이=u)", () => {
  const a = skeletonFromAngles(anglesOf({ arms: [100, 100, 80, 80], legs: null })); const sk = skeletonToPx(a, 500, 300, 100);
  ok(Math.abs((sk.ls[0] + sk.rs[0]) / 2 - 500) < 1e-6 && Math.abs(sk.ls[1] - 300) < 1e-6, "어깨");
  ok(Math.abs(sk.lh[1] - 400) < 1e-6 && sk.u === 100 && sk.hipMid && sk.est, "엉덩이/필드");
});

t("skeletonRetarget: 엉덩이가 원하는 자리, 몸통 길이가 원하는 크기로, 자세(각도)는 그대로", () => {
  const sk = skeletonFromBody(body()); const r = skeletonRetarget(sk, [100, 300], 80);
  ok(Math.abs(r.hipMid[0] - 100) < 1e-9 && r.u === 80, "자리/크기");
  const mid = [(r.ls[0] + r.rs[0]) / 2, (r.ls[1] + r.rs[1]) / 2]; ok(Math.abs(Math.hypot(mid[0] - r.hipMid[0], mid[1] - r.hipMid[1]) - 80) < 1, "몸통 길이");
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]); ok(Math.abs(ang(sk.ls, sk.le) - ang(r.ls, r.le)) < 1e-9 && Math.abs(ang(sk.rk, sk.ra) - ang(r.rk, r.ra)) < 1e-9, "각도 유지");
  ok(skeletonRetarget(null, [0, 0], 10) === null && skeletonRetarget(sk, [0, 0], 0) === null, "잘못된 입력");
});
console.log(`캐릭터: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
