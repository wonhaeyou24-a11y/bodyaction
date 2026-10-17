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
  MIN_V: 2.6,          // 이 속도(어깨너비/초) 이상으로 휘둘러야 "벤 것" (그냥 손을 옮기거나 스치는 건 안 베어져요)
  FULL_V: 6.5,         // 이 속도면 힘 점수 만점
  WINDOW: 0.22,        // 박자 시각에서 앞뒤로 이 시간(초) 안에 베어야 해요
  PAD: 12,             // 칼날이 큐브 반지름보다 이만큼(px) 더 가까이 지나가면 닿은 것으로 봐요
  DIR_FULL: 40, DIR_OK: 90, DIR_BAD: 120,   // 방향 오차(도): 이 안이면 방향 만점 / 이 넘으면 방향 점수 0 / 이 넘으면 "잘못 벰" (너그럽게: 대충 그쪽으로 지나가면 돼요)
  PEAK_MS: 140,        // 휘두른 속도는 최근 이 시간(ms) 동안의 최고 속도로 봐요 (인식이 느리면 속도가 듬성듬성 갱신되기 때문)
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
const MIX = { 1: { dot: 0.65, diag: 0, side: 0 }, 2: { dot: 0.45, diag: 0.15, side: 0.05 }, 3: { dot: 0.3, diag: 0.2, side: 0.08 } };

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

// ---------- 곡 분석 기반 큐브 배치 (곡마다 항상 같은 "맵"이 나와서, 익히면 더 잘하게 돼요) ----------
// 곡 분석(tools/music_map.py)에서 박자마다 뽑아 둔 특징으로 배치를 정해요:
//   s 소리 세기(강한 박자) → 점이 아닌 화살표, 바깥쪽 줄, 센 박자에서는 양손 동시 큐브
//   p 소리 높낮이        → 높은 소리는 위에서 아래로 내려 베기, 낮은 소리는 아래에서 위로 올려 베기 (멜로디가 오르내리면 팔도 같이 오르내려요)
//   e 구간 에너지        → 잔잔한 구간은 점(●)과 세로 베기 위주, 클라이막스는 대각선·가로 베기와 폭탄 없음
//   반복(같은 리듬이 또 나오면 같은 배치를 다시)  → 곡의 리듬을 몸이 기억해요
//   손이 닿을 수 있는 거리만(같은 손의 연속 큐브는 너무 멀리 떨어지지 않게), 손은 번갈아·위↔아래 왕복(흐름)
const PX = { lanes: [1280 * 0.18, 1280 * 0.38, 1280 * 0.62, 1280 * 0.82], rows: [720 * 0.28, 720 * 0.52, 720 * 0.74] };
export const MAX_HAND_SPEED = 1500;   // 같은 손이 이어서 베는 큐브 사이를 오가는 데 필요한 속도 상한(px/s)

function rng32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hashSeed(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * @param times  박자 시각(초) 목록
 * @param feats  [[s, p, e], ...]  박자마다 소리 세기·높낮이·구간 에너지 (0~1)
 * @returns {{hand:0|1, dir:number|null, lane:number, row:number, bomb?:boolean}[][]}  박자마다 큐브 1~2개
 */
export function buildMap(times, feats, seed = 1) {
  const rng = rng32(seed), out = [];
  const st = { lastDir: [null, null], lastT: [-9, -9], lastRow: [1, 1], lastLane: [1, 2], lastHand: 1, memory: new Map() };
  const posOf = (lane, row) => [PX.lanes[lane], PX.rows[row]];
  for (let i = 0; i < times.length; i++) {
    const t = times[i], [s, p, e] = feats[i] ?? [0.5, 0.5, 0.5], gap = i ? t - times[i - 1] : 9, gap2 = i > 1 ? times[i - 1] - times[i - 2] : 9;
    const ramp = Math.min(1, t / 45);                                 // 곡 시작부터 45초에 걸쳐 점점 어려워져요
    // 폭탄: 잔잔하고 약한 박자에서 가끔, 한 곡에 여러 개 정도
    if (i % 11 === 7 && e < 0.5 && s < 0.55 && gap > 0.8) { out.push([{ hand: st.lastHand, dir: null, lane: 1 + (i % 2), row: 1, bomb: true }]); continue; }
    // 1) 손: 번갈아. 한참 쉬었다 시작하는 새 구절은 낮은 소리면 왼손, 높은 소리면 오른손
    let hand = 1 - st.lastHand;
    if (gap > 1.4) hand = p < 0.5 ? 0 : 1;
    // 2) 방향: 같은 손은 위↔아래 왕복. 손이 쉴 시간이 있으면(0.9초 이상) 소리 높낮이를 따라가요
    const prev = st.lastDir[hand], pv = vertOf(prev), since = t - st.lastT[hand];
    const pitchV = p > 0.6 ? 0 : p < 0.4 ? 1 : null;
    let wantV = pv == null ? (pitchV ?? (rng() < 0.5 ? 0 : 1)) : (since < 0.9 ? 1 - pv : (pitchV ?? 1 - pv));
    const dotP = (e < 0.35 ? 0.75 : e < 0.7 ? 0.5 : 0.3) * (s > 0.92 ? 0.5 : 1) * (1 - 0.35 * ramp * (e > 0.5 ? 1 : 0)), diagP = e > 0.6 ? 0.2 * ramp : 0, sideP = e > 0.8 ? 0.08 * ramp : 0;   // 점(●)이 절반 이상: 화살표는 센 박자·클라이막스에 위주로, 대각선·가로는 드물게
    const r = rng();
    let dir;
    if (r < dotP) dir = null;
    else if (r < dotP + sideP && (prev == null || prev <= 1 || prev >= 4)) dir = hand === 0 ? 2 : 3;
    else if (r < dotP + sideP + diagP) dir = diagOf(wantV, hand);
    else dir = wantV;
    // 3) 줄·칸: 아래로 베는 큐브는 위쪽에, 올려 베는 큐브는 아래쪽에 (팔이 끊김 없이 이어져요)
    let row = dir === 0 || dir === 4 || dir === 5 ? (rng() < 0.75 ? 0 : 1) : dir === 1 || dir === 6 || dir === 7 ? (rng() < 0.75 ? 2 : 1) : dir == null ? (p > 0.66 ? 0 : p < 0.33 ? 2 : 1) : 1;
    const outer = rng() < (s > 0.8 ? 0.5 : 0.25) || dir === 2 || dir === 3 ? 1 : 0;
    let lane = hand === 0 ? (outer ? 0 : 1) : (outer ? 3 : 2);
    // 4) 반복: 같은 리듬(앞 두 간격)이 비슷한 높낮이로 다시 나오면 앞에서 쓴 배치를 그대로 (방향 흐름이 맞을 때만)
    const key = `${Math.round(gap * 8)}|${Math.round(gap2 * 8)}|${p > 0.66 ? "h" : p < 0.33 ? "l" : "m"}|${hand}`;
    const mem = st.memory.get(key);
    if (mem && rng() < 0.7 && (mem.dir == null || vertOf(mem.dir) == null || vertOf(mem.dir) === wantV || prev == null)) { dir = mem.dir; row = mem.row; lane = mem.lane; }
    // 5) 손이 닿을 수 있는지: 같은 손의 앞 큐브에서 너무 빨리 멀리 가야 하면 그 자리 근처에 둬요
    const [x0, y0] = posOf(st.lastLane[hand], st.lastRow[hand]);
    let [x1, y1] = posOf(lane, row);
    if (since > 0 && Math.hypot(x1 - x0, y1 - y0) / Math.max(0.05, since) > MAX_HAND_SPEED) { lane = st.lastLane[hand]; row = Math.max(0, Math.min(2, st.lastRow[hand] + (dir != null && (dir === 0 || dir === 4 || dir === 5) ? -1 : dir != null && (dir === 1 || dir === 6 || dir === 7) ? 1 : 0))); [x1, y1] = posOf(lane, row); }
    const note = { hand, dir, lane, row };
    const group = [note];
    // 6) 센 박자(그리고 앞에서 시간이 있으면)에는 양손 동시 큐브: 같은 방향으로 함께 베어요
    const other = 1 - hand;
    const otherFlowOk = st.lastDir[other] == null || vertOf(st.lastDir[other]) == null || vertOf(dir) == null || vertOf(st.lastDir[other]) !== vertOf(dir) || t - st.lastT[other] >= 0.9;   // 다른 손도 위↔아래 왕복이 깨지지 않을 때만
    if (s > 0.9 && gap > 0.55 && t - st.lastT[other] > 0.5 && dir != null && e > 0.3 && otherFlowOk && i - (st.lastDouble ?? -9) >= 4) {
      st.lastDouble = i;
      const olane = other === 0 ? (dir === 2 || dir === 3 ? 0 : 1) : (dir === 2 || dir === 3 ? 3 : 2);
      group.push({ hand: other, dir, lane: olane, row });
      st.lastDir[other] = dir; st.lastT[other] = t; st.lastRow[other] = row; st.lastLane[other] = olane;
    }
    if (dir != null) st.lastDir[hand] = dir;
    st.lastT[hand] = t; st.lastRow[hand] = row; st.lastLane[hand] = lane; st.lastHand = hand;
    st.memory.set(key, { dir, row, lane });
    out.push(group);
  }
  return out;
}
