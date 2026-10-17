// 비트세이버식 슬래시 규칙 (화면/게임을 모르는 순수 코드, node test/slash.test.js 로 시험).
//
// 예전 방식의 문제: "광선검이 큐브 근처에 닿고(반지름+36px+손 길이 설정+스윙 보정 → 사실상 큐브 주변 100px 넓이) + 손이 조금만 빨라도" 벤 것으로 쳐서,
//   박자에 맞춰 큐브를 "지나가며" 베는 게 아니라 그냥 아무 데나 휘둘러도 큐브가 잘렸어요. 베는 방향도 상관없었고요.
// 비트세이버가 하는 방식(여기서 따라 한 것):
//   ① 큐브마다 "베는 방향 화살표"가 있어요 (점(●)이면 아무 방향). 화살표 방향으로 칼이 지나가야 제대로 베어져요.
//   ② 칼날이 큐브를 "스치고 지나가야" 베어져요: 이전 프레임과 지금 프레임 사이에 칼날이 쓸고 간 면(sweep)이 큐브에 닿는지 봐요.
//   ③ 충분히 빠르게 휘둘러야 하고(어깨너비/초), 점수는 휘두른 힘·중심에서 얼마나 가까운가·방향이 얼마나 맞는가(+이 게임은 박자 맞춤)로 매겨요. 최대 115점.
//   ④ 반대 방향으로 베면 "잘못 벰(BAD CUT)": 점수 없이 콤보가 끊겨요.
//   ⑤ 큐브는 박자(오른손/왼손 번갈아 · 위→아래 다음엔 아래→위)로 이어지도록 배치돼서, 몸이 자연스럽게 춤추듯 휘둘러져요.

export const SLASH = {
  MIN_V: 2.2,          // 이 속도(어깨너비/초) 이상으로 휘둘러야 "벤 것" (그냥 손을 옮기거나 스치는 건 안 베어져요)
  FULL_V: 6.5,         // 이 속도면 힘 점수 만점
  WINDOW: 0.22,        // 박자 시각에서 앞뒤로 이 시간(초) 안에 베어야 해요
  PAD: 12,             // 칼날이 큐브 반지름보다 이만큼(px) 더 가까이 지나가면 닿은 것으로 봐요
  DIR_FULL: 30, DIR_OK: 75, DIR_BAD: 105,   // 방향 오차(도): 이 안이면 만점 / 감점 시작 / 이 넘으면 "잘못 벰"
  TIP_MS: 110,         // 칼끝이 어느 쪽으로 움직였는지 볼 때 거슬러 올라가는 시간
};

/** 베는 방향 8가지: 0 아래 1 위 2 왼쪽 3 오른쪽 4 왼쪽아래 5 오른쪽아래 6 왼쪽위 7 오른쪽위 (화면 기준, y는 아래가 +) */
const S = Math.SQRT1_2;
export const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0], [-S, S], [S, S], [-S, -S], [S, -S]];
const OPPOSITE = [1, 0, 3, 2, 7, 6, 5, 4];
export const oppositeDir = (d) => OPPOSITE[d];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 점 (cx,cy)에서 선분 (a→b)까지의 가장 가까운 거리 */
export function segDist(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(ax + t * dx - cx, ay + t * dy - cy);
}

/**
 * 칼날이 이전 프레임(prev)에서 지금(cur)까지 움직이며 쓸고 간 곳이 원(cx,cy,r)에 닿았는지.
 * prev/cur: {bx,by,tx,ty} (칼자루 · 칼끝). prev가 없으면 지금 모양만 봐요.
 * @returns {{hit:boolean, dist:number}}  dist: 쓸고 간 동안 칼날과 원 중심 사이 가장 가까운 거리(px)
 */
export function sweepBlade(prev, cur, cx, cy, r, pad = SLASH.PAD) {
  let best = Infinity;
  const steps = prev ? 5 : 1;
  for (let i = 0; i < steps; i++) {
    const u = steps === 1 ? 1 : i / (steps - 1);
    const bx = prev ? prev.bx + (cur.bx - prev.bx) * u : cur.bx, by = prev ? prev.by + (cur.by - prev.by) * u : cur.by;
    const tx = prev ? prev.tx + (cur.tx - prev.tx) * u : cur.tx, ty = prev ? prev.ty + (cur.ty - prev.ty) * u : cur.ty;
    best = Math.min(best, segDist(bx, by, tx, ty, cx, cy));
  }
  return { hit: best <= r + pad, dist: best };
}

/** 칼끝 기록(hist: [{t,x,y}], 오래된 것부터)으로 "지금 칼이 움직이는 방향"(길이 1) — 거의 안 움직였으면 null */
export function tipDirection(hist, now) {
  if (!hist || hist.length < 2) return null;
  const cur = hist[hist.length - 1];
  let old = null;
  for (let i = hist.length - 2; i >= 0; i--) { if (now - hist[i].t >= 40) { old = hist[i]; break; } if (now - hist[i].t > SLASH.TIP_MS) break; old = hist[i]; }
  if (!old) return null;
  const dx = cur.x - old.x, dy = cur.y - old.y, l = Math.hypot(dx, dy);
  return l < 14 ? null : [dx / l, dy / l];
}

export const angleDeg = (u, v) => (Math.acos(clamp(u[0] * v[0] + u[1] * v[1], -1, 1)) * 180) / Math.PI;

/**
 * 한 번 벤 것을 채점해요.
 * @param c  {dir: 0~7|null, r}   큐브
 * @param m  {dist, swingN, tipDir, dtMs}   dist: 중심까지 거리(px), swingN: 휘두른 속도(어깨너비/초), tipDir: 칼 움직임 방향(없으면 null), dtMs: 박자와의 시간 차(ms, 절댓값)
 * @returns {{cut:boolean, bad:boolean, total:number, parts:object, angle:number|null}}
 */
export function judgeCut(c, m) {
  if (!(m.swingN >= SLASH.MIN_V)) return { cut: false, bad: false, total: 0, parts: null, angle: null };
  let angle = null;
  if (c.dir != null) angle = m.tipDir ? angleDeg(DIRS[c.dir], m.tipDir) : 60;      // 방향을 못 구하면 "조금 어긋남" 정도로 봐요
  if (angle != null && angle > SLASH.DIR_BAD) return { cut: true, bad: true, total: 0, parts: null, angle };
  const speed = 15 + 35 * clamp((m.swingN - SLASH.MIN_V) / (SLASH.FULL_V - SLASH.MIN_V), 0, 1);
  const acc = 15 * clamp(1 - m.dist / (c.r * 0.9), 0, 1);
  const dir = angle == null ? 20 : 20 * clamp(1 - (angle - SLASH.DIR_FULL) / (SLASH.DIR_OK - SLASH.DIR_FULL), 0, 1);
  const timing = m.dtMs <= 60 ? 30 : m.dtMs <= 110 ? 22 : m.dtMs <= 160 ? 14 : 8;
  const parts = { speed: Math.round(speed), acc: Math.round(acc), dir: Math.round(dir), timing };
  return { cut: true, bad: false, total: parts.speed + parts.acc + parts.dir + parts.timing, parts, angle };
}

// ---------- 큐브 배치 (박자에 맞춰 춤추듯 이어지는 흐름) ----------
export function newFlow() { return { lastDir: [null, null], lastHand: 1, lastT: -9, n: 0 }; }

/** 단계(1~3)별 비율: 점(●, 아무 방향) / 대각선 / 좌우 */
const MIX = { 1: { dot: 0.45, diag: 0, side: 0 }, 2: { dot: 0.25, diag: 0.3, side: 0.1 }, 3: { dot: 0.12, diag: 0.35, side: 0.15 } };

const vertOf = (d) => (d === 0 || d === 4 || d === 5 ? 0 : d === 1 || d === 6 || d === 7 ? 1 : null);   // 0 아래로 베기 계열, 1 위로 베기 계열
const diagOf = (vertical, hand) => (vertical === 0 ? (hand === 0 ? 5 : 4) : (hand === 0 ? 7 : 6));       // 몸 안쪽으로 향하는 대각선

function pickDir(flow, hand, wave, rng) {
  const mix = MIX[wave] ?? MIX[1], prev = flow.lastDir[hand];
  if (rng() < mix.dot) return null;
  if (prev == null) return rng() < 0.6 ? 0 : 1;                       // 처음엔 위→아래로 시작하는 게 자연스러워요
  const r = rng(), pv = vertOf(prev);
  if (pv == null) return r < 0.5 ? OPPOSITE[prev] : (rng() < 0.5 ? 0 : 1);   // 옆으로 베었으면 반대 옆이나 위/아래로
  const nv = 1 - pv;                                                    // 아래로 벴으면 다음은 위로, 위로 벴으면 다음은 아래로 (팔이 왕복하며 이어져요)
  if (r < mix.diag) return diagOf(nv, hand);
  if (r < mix.diag + mix.side) return hand === 0 ? 2 : 3;
  return nv;
}

/**
 * 박자 하나에 나올 큐브들을 정해요.
 * @returns {{hand:0|1, dir:number|null, lane:0|1|2|3, row:0|1|2}[]}  hand 0=왼손(청록) 1=오른손(분홍), lane 0~3(왼쪽→오른쪽), row 0=위 1=가운데 2=아래
 */
export function nextNotes(flow, rng, wave, hitTime) {
  const out = [];
  const make = (hand) => {
    const dir = pickDir(flow, hand, wave, rng);
    // 위에서 시작해 아래로 베는 큐브는 위쪽에, 아래에서 올려 베는 큐브는 아래쪽에 두면 팔이 끊김 없이 이어져요
    let row = 1;
    if (dir === 0 || dir === 4 || dir === 5) row = rng() < 0.7 ? 0 : 1;
    else if (dir === 1 || dir === 6 || dir === 7) row = rng() < 0.7 ? 2 : 1;
    else if (dir == null) row = Math.floor(rng() * 3);
    const lane = hand === 0 ? (rng() < 0.72 ? 1 : 0) : (rng() < 0.72 ? 2 : 3);
    if (dir != null) flow.lastDir[hand] = dir;                       // 점(●)이 나와도 앞서 베던 방향 흐름은 이어져요
    return { hand, dir, lane, row };
  };
  const hand = 1 - flow.lastHand;
  out.push(make(hand));
  flow.lastHand = hand;
  // 쉬었다 나오는 큐브(앞과 간격이 길 때)는 가끔 양손 동시 큐브
  if (hitTime - flow.lastT > 0.95 && rng() < 0.12 * wave) out.push(make(1 - hand));
  flow.lastT = hitTime; flow.n++;
  return out;
}
