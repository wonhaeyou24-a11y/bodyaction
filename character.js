// 캐릭터 시스템 (화면을 모르는 순수 로직 — node test/character.test.js 로 시험).
//  - 캐릭터 목록 / 선택한 캐릭터 저장·불러오기
//  - 내 몸(포즈 33점)을 "캐릭터를 그릴 수 있는 뼈대"로 바꾸기 (팔·다리가 안 보이면 자연스러운 기본 자세로 채움)
// 그림은 character-art.js, 선택 화면은 main.js. 판정(점수·충돌)은 항상 "내 몸 인식 좌표"로 하고, 캐릭터는 그림일 뿐이에요.

export const CHARACTERS = [
  // 새 시안(Stitch) 3종: 이미지를 관절 부품으로 잘라 움직여요 (character-puppet.js, 도구 tools/rig_character.py)
  { id: "scout", kind: "human", art: true, name: "탐이", title: "씩씩한 탐험가", color: "#ff9a3c",
    desc: "주머니 가득 조끼와 팔 보호대! 어디든 신나게 탐험해요." },
  { id: "neon", kind: "human", art: true, name: "네온", title: "네온 댄서", color: "#25d6ff",
    desc: "반짝이는 네온 라인 운동복으로 리듬을 타는 크루예요." },
  { id: "fire", kind: "human", art: true, name: "불꽃이", title: "용감한 소방대원", color: "#ff4a2a",
    desc: "반사띠 소방복에 튼튼한 팔 장비! 위험할수록 더 용감해져요." },
  // 코드로 그린 귀여운 캐릭터 (character-art.js)
  { id: "tori", kind: "animal", name: "토리", title: "날쌘 꼬마 여우", color: "#ff9a3c",
    desc: "복슬복슬 꼬리가 자랑인 장난꾸러기 여우예요." },
  { id: "bolt", kind: "robot", name: "볼트", title: "반짝 로봇", color: "#6fa8ff",
    desc: "가슴에 불이 반짝! 힘이 넘치는 친절한 로봇이에요." },
  { id: "luna", kind: "fantasy", name: "루나", title: "별빛 마법사", color: "#8a5cff",
    desc: "별 모자와 망토가 멋진 꼬마 마법사예요." },
];
export const DEFAULT_CHARACTER_ID = CHARACTERS[0].id;
const byId = new Map(CHARACTERS.map((c) => [c.id, c]));

export const characterById = (id) => byId.get(id) ?? null;
/** 이상한 값이 들어와도 항상 쓸 수 있는 캐릭터 id로 */
export const cleanCharacterId = (id) => (typeof id === "string" && byId.has(id) ? id : DEFAULT_CHARACTER_ID);

/** 저장소(localStorage 같은 getItem/setItem)에서 선택한 캐릭터를 읽어요. 없거나 깨졌으면 기본 캐릭터 */
export function loadCharacterId(storage, key) {
  try { return cleanCharacterId(storage?.getItem(key)); } catch { return DEFAULT_CHARACTER_ID; }
}
export function saveCharacterId(storage, key, id) {
  const v = cleanCharacterId(id);
  try { storage?.setItem(key, v); } catch { /* 저장 못 해도 이번 접속에서는 그대로 써요 */ }
  return v;
}

// ---------- 뼈대 ----------
// 몸 비율(어깨 중앙~엉덩이 중앙 = 1). 팔다리 길이가 안 보일 때 채우는 값. (poses.js의 BODY와 같은 비율)
const R = { shoulder: 0.34, hip: 0.2, upperArm: 0.6, foreArm: 0.55, thigh: 0.85, shin: 0.82, headY: -0.52 };
const ok = (b, i, m = 0.35) => !!b && !!b[i] && (b[i].v ?? 1) >= m && Number.isFinite(b[i].x) && Number.isFinite(b[i].y);
const P = (b, i) => [b[i].x, b[i].y];

/**
 * 내 몸(포즈 랜드마크, 화면 좌표)에서 캐릭터 뼈대를 만들어요. 어깨가 안 보이면 null.
 * 반환: { u(몸통 길이 px), head, neck, ls, rs, le, re, lw, rw, lh, rh, lk, rk, la, ra, est:{...} }  — 점은 [x, y]
 * est: 어떤 부분을 추정(보이지 않아 채움)했는지 (그림에서 다리가 안 보일 때 차렷으로 그리는 등에 써요)
 */
export function skeletonFromBody(b) {
  if (!ok(b, 11) || !ok(b, 12)) return null;
  const ls = P(b, 11), rs = P(b, 12);
  const sw = Math.hypot(ls[0] - rs[0], ls[1] - rs[1]);
  if (!(sw > 8)) return null;
  const mid = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2];
  const est = { hips: false, legs: false, arms: false, head: false };

  // 엉덩이: 안 보이면 어깨 아래로 어림 (몸통 길이 ≈ 어깨너비 × 1.55)
  let lh, rh, u;
  if (ok(b, 23) && ok(b, 24)) {
    lh = P(b, 23); rh = P(b, 24);
    u = Math.hypot((lh[0] + rh[0]) / 2 - mid[0], (lh[1] + rh[1]) / 2 - mid[1]);
    if (!(u > sw * 0.6)) u = sw * 1.55;       // 엉덩이가 어깨와 겹쳐 보이는 이상한 값
  } else { est.hips = true; u = sw * 1.55; }
  // 몸이 기울어도 "아래 방향"은 어깨선에 수직으로
  const ang = Math.atan2(rs[1] - ls[1], rs[0] - ls[0]);
  const down = [-Math.sin(ang), Math.cos(ang)], side = [Math.cos(ang), Math.sin(ang)];
  if (est.hips || !(lh && rh)) {
    const hc = [mid[0] + down[0] * u, mid[1] + down[1] * u];
    lh = [hc[0] - side[0] * u * R.hip, hc[1] - side[1] * u * R.hip];
    rh = [hc[0] + side[0] * u * R.hip, hc[1] + side[1] * u * R.hip];
  }
  const hipMid = [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2];

  // 팔: 팔꿈치/손목이 안 보이면 어깨에서 아래로 늘어뜨림
  const arm = (s, ei, wi) => {
    if (ok(b, ei) && ok(b, wi)) return [P(b, ei), P(b, wi)];
    est.arms = true;
    const e = [s[0] + down[0] * u * R.upperArm, s[1] + down[1] * u * R.upperArm];
    return [e, [e[0] + down[0] * u * R.foreArm, e[1] + down[1] * u * R.foreArm]];
  };
  const [le, lw] = arm(ls, 13, 15), [re, rw] = arm(rs, 14, 16);

  // 다리: 무릎/발목이 안 보이면 엉덩이에서 아래로 곧게 (차렷)
  const leg = (h, ki, ai) => {
    if (ok(b, ki) && ok(b, ai)) return [P(b, ki), P(b, ai)];
    est.legs = true;
    const k = [h[0] + down[0] * u * R.thigh, h[1] + down[1] * u * R.thigh];
    return [k, [k[0] + down[0] * u * R.shin, k[1] + down[1] * u * R.shin]];
  };
  const [lk, la] = leg(lh, 25, 27), [rk, ra] = leg(rh, 26, 28);

  // 머리: 코가 보이면 코 위치, 아니면 목 위
  let head;
  if (ok(b, 0, 0.3)) head = P(b, 0);
  else { est.head = true; head = [mid[0] - down[0] * u * 0.52, mid[1] - down[1] * u * 0.52]; }
  const neck = [mid[0] - down[0] * u * 0.05, mid[1] - down[1] * u * 0.05];
  return { u, head, neck, ls, rs, le, re, lw, rw, lh, rh, lk, rk, la, ra, hipMid, est };
}

/** poses.js의 skeletonFromAngles(몸통 길이=1 단위)를 화면 픽셀 뼈대로 바꿔요 (선택 화면 미리보기 등). 가운데 x, 어깨 y, 몸통 길이 u(px) */
export function skeletonToPx(sk, ox, oy, u) {
  const f = (p) => [ox + p[0] * u, oy + p[1] * u];
  const out = { u, est: { hips: false, legs: false, arms: false, head: false } };
  for (const k of ["head", "neck", "ls", "rs", "le", "re", "lw", "rw", "lh", "rh", "lk", "rk", "la", "ra"]) out[k] = f(sk[k]);
  out.hipMid = f([(sk.lh[0] + sk.rh[0]) / 2, (sk.lh[1] + sk.rh[1]) / 2]);
  return out;
}

/**
 * 게임 안에서 캐릭터를 원하는 자리·크기로 옮겨 그리기: 뼈대 전체를 "엉덩이 중심 = hip, 몸통 길이 = u"가 되도록 옮기고 키워요.
 * (내 몸의 위치/카메라와의 거리와 상관없이 캐릭터는 게임이 정한 자리에 같은 크기로 서고, 자세(각도)만 내 움직임을 따라 해요)
 */
export function skeletonRetarget(sk, hip, u) {
  if (!sk || !(sk.u > 0) || !(u > 0)) return null;
  const k = u / sk.u, c = sk.hipMid, f = (p) => [hip[0] + (p[0] - c[0]) * k, hip[1] + (p[1] - c[1]) * k];
  const out = { u, est: sk.est, hipMid: [hip[0], hip[1]] };
  for (const key of ["head", "neck", "ls", "rs", "le", "re", "lw", "rw", "lh", "rh", "lk", "rk", "la", "ra"]) out[key] = f(sk[key]);
  return out;
}
