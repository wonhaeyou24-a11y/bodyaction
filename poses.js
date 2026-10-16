// 🙆 포즈 미믹: 자세 목록 + 자세 인식 규칙 (화면을 모르는 순수 로직이라 node test/poses.test.js 로 시험해요).
//
// 핵심 아이디어: 자세를 "팔다리 8개 마디의 방향(각도)"으로 정의해요.
//   - 캐릭터는 이 각도로 그려요  →  화면에 보이는 모습 = 인식하는 기준
//   - 인식은 내 몸의 마디 각도를 같은 방식으로 재서 비교해요  →  멀리/가까이 서도, 키가 달라도 똑같이 판정
//
// 각도: 화면 기준(거울처럼 보이는 화면). 0° = 오른쪽, 90° = 아래, 180° = 왼쪽, -90° = 위.
//       "왼쪽(L)" = 화면 왼쪽 = 내 왼팔/왼다리, "오른쪽(R)" = 내 오른팔/오른다리.
//
// 마디 이름: LU 왼팔(어깨→팔꿈치)  LF 왼쪽 아래팔(팔꿈치→손목)  RU/RF 오른쪽
//            LT 왼쪽 허벅지(엉덩이→무릎)  LS 왼쪽 종아리(무릎→발목)  RT/RS 오른쪽

export const LIMBS = ["LU", "LF", "RU", "RF", "LT", "LS", "RT", "RS"];
export const ARM_LIMBS = ["LU", "LF", "RU", "RF"];
export const LEG_LIMBS = ["LT", "LS", "RT", "RS"];
// 몸 인식 관절 번호(MediaPipe): 11/12 어깨, 13/14 팔꿈치, 15/16 손목, 23/24 엉덩이, 25/26 무릎, 27/28 발목
const SEG = { LU: [11, 13], LF: [13, 15], RU: [12, 14], RF: [14, 16], LT: [23, 25], LS: [25, 27], RT: [24, 26], RS: [26, 28] };
const VIS = 0.45;                       // 이 정도 이상 보여야 "보인다"고 봐요

/** 난이도 단계: 레벨이 오를수록 허용 오차가 줄고, 유지 시간은 늘고, 제한 시간은 줄어요 */
export const LEVELS = [
  { level: 1, tol: 38, hold: 0.60, time: 8.5, name: "워밍업" },
  { level: 2, tol: 33, hold: 0.70, time: 7.5, name: "쉬움" },
  { level: 3, tol: 29, hold: 0.80, time: 7.0, name: "보통" },
  { level: 4, tol: 26, hold: 0.90, time: 6.5, name: "어려움" },
  { level: 5, tol: 23, hold: 1.00, time: 6.0, name: "마스터" },
];
export const SEGMENT_EXTRA_TOL = 6;     // 아래팔/종아리는 인식이 조금 더 흔들려서 6°를 더 봐줘요
export const POSES_PER_LEVEL = 3;       // 3번 성공할 때마다 레벨 업

const wrap = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; };
const mirrorAngle = (a) => wrap(180 - a);
export const angDiff = (a, b) => Math.abs(wrap(a - b));
const NEUTRAL = { LU: 100, LF: 100, RU: 80, RF: 80, LT: 96, LS: 96, RT: 84, RS: 84 };   // 차렷

// ---------- 자세 목록 ----------
// arms = [LU, LF, RU, RF], legs = [LT, LS, RT, RS] 또는 null(다리는 상관없음/차렷으로 그림)
// free = 각도로 비교하지 않는 마디, extra = 각도로 못 재는 동작 규칙("squat" | "kneeL" | "kneeR")
const raw = [];
function def(id, level, name, arms, legs = null, opts = {}) { raw.push({ id, level, name, arms, legs, ...opts }); }
function defMirror(id, level, name, mirrorName, arms, legs = null, opts = {}) {
  def(id, level, name, arms, legs, opts);
  const m = {
    id: id + "_m", level, name: mirrorName, mirrorOf: id,
    arms: [mirrorAngle(arms[2]), mirrorAngle(arms[3]), mirrorAngle(arms[0]), mirrorAngle(arms[1])],
    legs: legs ? [mirrorAngle(legs[2]), mirrorAngle(legs[3]), mirrorAngle(legs[0]), mirrorAngle(legs[1])] : null, ...opts,
  };
  if (opts.extra === "kneeL") m.extra = "kneeR"; else if (opts.extra === "kneeR") m.extra = "kneeL";
  if (opts.free) m.free = opts.free.map((l) => (l[0] === "L" ? "R" + l[1] : "L" + l[1]));
  raw.push(m);
}
const TALL = [180, 180, 0, 0];                  // T자 팔
const Y_ARMS = [-137, -137, -43, -43];          // Y자 팔 (만세와 확실히 구분되게 더 벌림)
const UP_ARMS = [-97, -97, -83, -83];           // 만세 (거의 수직)
const WIDE = [112, 112, 68, 68];                // 다리 벌리기
const SQUAT_LEGS = [160, 90, 20, 90];           // 스쿼트 그림용(앉아서 무릎이 옆으로 벌어짐)

// 레벨 1: 팔만, 크게 (워밍업)
def("armsUp", 1, "만세!", UP_ARMS);
def("tPose", 1, "양팔을 쫙 벌려요!", TALL);
defMirror("leftUp", 1, "왼팔 번쩍!", "오른팔 번쩍!", [-95, -95, 80, 80]);
// 레벨 2: 팔만, 모양이 다양해짐
def("yPose", 2, "Y! 대각선으로 번쩍!", Y_ARMS);
defMirror("upAndOut", 2, "왼팔은 위로, 오른팔은 옆으로!", "오른팔은 위로, 왼팔은 옆으로!", [-95, -95, 0, 0]);
def("muscle", 2, "알통 자랑!", [180, -90, 0, -90]);
defMirror("diagonal", 2, "비행기처럼 쓱! (왼쪽 아래)", "비행기처럼 쓱! (오른쪽 아래)", [135, 135, -45, -45]);
def("akimbo", 2, "허리에 손!", [125, 50, 55, 130]);
def("clap", 2, "머리 위에서 짝!", [-80, -40, -100, -140]);
// 레벨 3: 다리까지 사용 (발끝까지 보이게 서야 해요)
def("wideT", 3, "다리도 쫙, 팔도 쫙!", TALL, WIDE);
def("star", 3, "별이 되어요!", Y_ARMS, WIDE);
def("squatT", 3, "앉아요! 팔은 옆으로", TALL, SQUAT_LEGS, { extra: "squat", free: LEG_LIMBS, drop: 0.3 });
defMirror("kneeUp", 3, "왼쪽 무릎 번쩍!", "오른쪽 무릎 번쩍!", TALL, [165, 95, 84, 84], { extra: "kneeL", free: ["LT", "LS"] });
defMirror("sideLeg", 3, "왼다리를 옆으로 쭉!", "오른다리를 옆으로 쭉!", TALL, [155, 155, 90, 90]);
// 레벨 4: 팔과 다리를 함께
defMirror("tree", 4, "나무 자세! (오른발 들기)", "나무 자세! (왼발 들기)", [-80, -40, -100, -140], [92, 92, 25, 150]);
defMirror("warrior", 4, "용사 자세!", "용사 자세! (반대쪽)", TALL, [152, 90, 45, 45]);
def("starSquat", 4, "별 스쿼트!", Y_ARMS, SQUAT_LEGS, { extra: "squat", free: LEG_LIMBS, drop: 0.3 });
defMirror("kneeArm", 4, "왼쪽 무릎 번쩍! 오른팔도 번쩍!", "오른쪽 무릎 번쩍! 왼팔도 번쩍!", [180, 180, -85, -85], [165, 95, 84, 84], { extra: "kneeL", free: ["LT", "LS"] });
// 레벨 5: 균형이 필요한 어려운 자세
defMirror("treeUp", 5, "나무 + 만세! (오른발 들기)", "나무 + 만세! (왼발 들기)", UP_ARMS, [92, 92, 25, 150]);
defMirror("crane", 5, "학 자세! (왼다리 들기)", "학 자세! (오른다리 들기)", Y_ARMS, [155, 155, 90, 90]);
defMirror("skater", 5, "스케이터!", "스케이터! (반대쪽)", [135, 135, -45, -45], [130, 90, 60, 60]);
defMirror("treeMuscle", 5, "나무 + 알통!", "나무 + 알통! (반대쪽)", [180, -90, 0, -90], [92, 92, 25, 150]);

// ---------- 웃기고 멋있는 자세 (춤·유행 포즈) ----------
// 레벨 2: 팔만
def("chicken", 2, "꼬꼬댁! 닭 날개 퍼덕!", [180, 90, 0, 90]);
def("tRex", 2, "어흥! 티라노 짧은 팔!", [100, -110, 80, -70]);
def("shrug", 2, "몰라요~ 어깨 으쓱!", [140, -55, 40, -125]);
defMirror("salute", 2, "충성! 오른손 경례!", "충성! 왼손 경례!", [100, 100, -20, -143]);
// 레벨 3
def("ymcaM", 3, "YMCA의 M!", [-140, -5, -40, -175]);
def("gorilla", 3, "우가우가! 고릴라 가슴 쿵쿵!", [160, 6, 20, 174]);
defMirror("robot", 3, "로봇 춤! 이집트 벽화 자세", "로봇 춤! (반대쪽)", [180, -90, 0, 90]);
defMirror("dab", 3, "딥(dab)! 왼팔 쭉~", "딥(dab)! 오른팔 쭉~", [-150, -150, -40, 160]);
def("hero", 3, "슈퍼히어로 등장! 허리에 손, 다리 쫙", [125, 50, 55, 130], WIDE);
// 레벨 4
def("chickenSquat", 4, "쪼그려 앉은 닭! 꼬꼬댁!", [180, 90, 0, 90], SQUAT_LEGS, { extra: "squat", free: LEG_LIMBS, drop: 0.3 });
def("sumo", 4, "스모 선수! 허리에 손, 낮게 앉아요", [125, 50, 55, 130], SQUAT_LEGS, { extra: "squat", free: LEG_LIMBS, drop: 0.3 });
def("xArms", 4, "엑스! 팔을 가슴에서 교차", [45, -58, 135, -122]);
// 레벨 5
defMirror("robotTree", 5, "로봇 나무! (오른발 들기)", "로봇 나무! (왼발 들기)", [180, -90, 0, 90], [92, 92, 25, 150]);
defMirror("dabCrane", 5, "딥 + 학 다리! (왼다리 들기)", "딥 + 학 다리! (오른다리 들기)", [-150, -150, -40, 160], [155, 155, 90, 90]);

export const POSES = raw.map((p, i) => ({ ...p, index: i, free: p.free ?? [] }));
const byId = new Map(POSES.map((p) => [p.id, p]));
export const poseById = (id) => byId.get(id) ?? null;

/** 자세를 그리기 위한 8개 각도(+ 몸을 얼마나 낮출지). 다리 정보가 없으면 차렷 */
export function anglesOf(pose) {
  const a = { ...NEUTRAL };
  ARM_LIMBS.forEach((k, i) => { a[k] = pose.arms[i]; });
  if (pose.legs) LEG_LIMBS.forEach((k, i) => { a[k] = pose.legs[i]; });
  a.drop = pose.drop ?? 0;
  return a;
}
/** 두 자세 사이를 부드럽게 이어 주는 중간 각도 (t: 0~1) */
export function lerpAngles(a, b, t) {
  const o = { drop: a.drop + (b.drop - a.drop) * t };
  for (const k of LIMBS) { const d = wrap(b[k] - a[k]); o[k] = wrap(a[k] + d * t); }
  return o;
}

// ---------- 몸 구조(그리기/시험용) ----------
// 어깨 중앙이 (0,0), 어깨~엉덩이 길이가 1. 아래로 갈수록 y가 커져요.
export const BODY = { shoulder: 0.34, hip: 0.2, upperArm: 0.6, foreArm: 0.55, thigh: 0.85, shin: 0.82, headR: 0.3, headY: -0.52 };
const vec = (deg, len) => [Math.cos((deg * Math.PI) / 180) * len, Math.sin((deg * Math.PI) / 180) * len];
const add = (p, v) => [p[0] + v[0], p[1] + v[1]];

/** 각도로부터 관절 위치를 계산 (캐릭터 그리기와 시험용 가짜 몸 만들기에 같이 써요) */
export function skeletonFromAngles(a) {
  const ls = [-BODY.shoulder, 0], rs = [BODY.shoulder, 0];
  const lh = [-BODY.hip, 1], rh = [BODY.hip, 1];
  const le = add(ls, vec(a.LU, BODY.upperArm)), lw = add(le, vec(a.LF, BODY.foreArm));
  const re = add(rs, vec(a.RU, BODY.upperArm)), rw = add(re, vec(a.RF, BODY.foreArm));
  const lk = add(lh, vec(a.LT, BODY.thigh)), la = add(lk, vec(a.LS, BODY.shin));
  const rk = add(rh, vec(a.RT, BODY.thigh)), ra = add(rk, vec(a.RS, BODY.shin));
  return { head: [0, BODY.headY], neck: [0, -0.05], ls, rs, le, re, lw, rw, lh, rh, lk, rk, la, ra };
}

// ---------- 내 몸 재기 ----------
const ok = (b, i) => !!b && !!b[i] && (b[i].v ?? 1) >= VIS;
export function limbAngle(b, limb) {
  const [i, j] = SEG[limb];
  if (!ok(b, i) || !ok(b, j)) return null;
  return (Math.atan2(b[j].y - b[i].y, b[j].x - b[i].x) * 180) / Math.PI;
}
/** 어깨 중앙~엉덩이 중앙 길이(몸 크기 기준). 엉덩이가 안 보이면 어깨 너비로 어림 */
export function torsoLength(b) {
  if (ok(b, 11) && ok(b, 12) && ok(b, 23) && ok(b, 24)) {
    return Math.hypot((b[11].x + b[12].x) / 2 - (b[23].x + b[24].x) / 2, (b[11].y + b[12].y) / 2 - (b[23].y + b[24].y) / 2);
  }
  if (ok(b, 11) && ok(b, 12)) return Math.hypot(b[11].x - b[12].x, b[11].y - b[12].y) * 1.55;
  return 0;
}

function requiredLimbs(pose) {
  const base = pose.legs || pose.extra ? LIMBS : ARM_LIMBS;       // 다리 자세가 아니면 다리는 안 봐요
  return base.filter((l) => !pose.free.includes(l));
}
export function needsLegs(pose) { return requiredLimbs(pose).some((l) => LEG_LIMBS.includes(l)) || !!pose.extra; }

/** 각도로 못 재는 동작(앉기, 무릎 올리기) 판정: 무릎이 엉덩이에서 얼마나 내려와 있는지(몸 크기 대비) */
function extraCheck(pose, b, u) {
  if (!pose.extra) return { ok: true, visible: true };
  if (![23, 24, 25, 26].every((i) => ok(b, i)) || u <= 0) return { ok: false, visible: false };
  const dropL = (b[25].y - b[23].y) / u, dropR = (b[26].y - b[24].y) / u;     // 서 있으면 약 0.85, 앉으면 0.3 이하
  if (pose.extra === "squat") return { ok: dropL < 0.5 && dropR < 0.5, visible: true, dropL, dropR };
  if (pose.extra === "kneeL") return { ok: dropL < 0.45 && dropR > 0.7, visible: true, dropL, dropR };
  if (pose.extra === "kneeR") return { ok: dropR < 0.45 && dropL > 0.7, visible: true, dropL, dropR };
  return { ok: true, visible: true };
}

/**
 * 내 몸이 자세와 맞는지 판정
 * @returns {{matched:boolean, score:number, perLimb:object, missing:string[], extra:object}}
 *   score: 0~1 (일치율, HUD에 퍼센트로 보여요)
 */
export function matchPose(pose, level, body) {
  const cfg = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))];
  const target = anglesOf(pose);
  const perLimb = {}, missing = [];
  let sum = 0, n = 0, allOk = true;
  for (const limb of requiredLimbs(pose)) {
    const m = limbAngle(body, limb);
    if (m === null) { missing.push(limb); perLimb[limb] = { visible: false, ok: false, diff: 180 }; allOk = false; sum += 0; n++; continue; }
    const tol = cfg.tol + (limb === "LF" || limb === "RF" || limb === "LS" || limb === "RS" ? SEGMENT_EXTRA_TOL : 0);
    const diff = angDiff(m, target[limb]);
    const good = diff <= tol;
    perLimb[limb] = { visible: true, ok: good, diff, tol, measured: m, target: target[limb] };
    if (!good) allOk = false;
    sum += Math.max(0, 1 - diff / (tol * 1.7)); n++;
  }
  const u = torsoLength(body);
  const extra = extraCheck(pose, body, u);
  if (pose.extra) { n++; sum += extra.ok ? 1 : 0; if (!extra.ok) allOk = false; if (!extra.visible) missing.push("LT"); }
  return { matched: allOk && missing.length === 0, score: n ? sum / n : 0, perLimb, missing, extra };
}

// ---------- 어디가 틀렸는지 알려 주기 ----------
const LIMB_NAME = { LU: "왼팔을", LF: "왼쪽 아래팔을", RU: "오른팔을", RF: "오른쪽 아래팔을", LT: "왼쪽 허벅지를", LS: "왼쪽 종아리를", RT: "오른쪽 허벅지를", RS: "오른쪽 종아리를" };
/** 가장 많이 틀린 곳을 한 줄로 알려 줘요. 맞았으면 null */
export function hintFor(pose, level, body) {
  const m = matchPose(pose, level, body);
  if (m.matched) return null;
  if (m.missing.length) {
    const legs = m.missing.some((l) => LEG_LIMBS.includes(l));
    return legs ? "발끝까지 보이게 한두 걸음 뒤로 가 주세요" : "팔이 잘 보이게 서 주세요";
  }
  if (pose.extra && !m.extra.ok) {
    if (pose.extra === "squat") return "무릎을 더 굽혀서 앉아요";
    return pose.extra === "kneeL" ? "왼쪽 무릎을 더 높이 올려요" : "오른쪽 무릎을 더 높이 올려요";
  }
  let worst = null;
  for (const [limb, r] of Object.entries(m.perLimb)) if (!r.ok && (!worst || r.diff / r.tol > worst.diff / worst.tol)) worst = { limb, ...r };
  if (!worst) return null;
  const t = vec(worst.target, 1), c = vec(worst.measured, 1), dx = t[0] - c[0], dy = t[1] - c[1];
  const dir = Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "위로 올려요" : "아래로 내려요") : (dx < 0 ? "왼쪽으로 뻗어요" : "오른쪽으로 뻗어요");
  return `${LIMB_NAME[worst.limb]} ${dir}`;
}

// ---------- 진행(난이도) ----------
export const levelFor = (done) => Math.min(LEVELS.length, 1 + Math.floor(done / POSES_PER_LEVEL));
export const levelConfig = (level) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))];

/** 이번 레벨에 맞는 자세 고르기: 지금 레벨 자세가 가장 많이 나오고, 지난 레벨 자세도 섞여요 (바로 앞 자세는 안 나옴) */
export function pickPose(level, lastId, rand = Math.random) {
  const pool = POSES.filter((p) => p.level <= level && p.id !== lastId && p.mirrorOf !== lastId && p.id !== (byId.get(lastId)?.mirrorOf));
  const w = (p) => (p.level === level ? 6 : p.level === level - 1 ? 3 : 1);
  let total = pool.reduce((s, p) => s + w(p), 0), r = rand() * total;
  for (const p of pool) { r -= w(p); if (r <= 0) return p; }
  return pool[pool.length - 1];
}

/** 성공 점수: 레벨이 높을수록, 빠를수록, 연속 성공일수록 더 많이 */
export function poseScore(level, timeLeft, streak) {
  return 2 + Math.ceil(level / 2) + Math.min(2, Math.floor(timeLeft / 3)) + Math.min(2, Math.max(0, streak - 1));
}
