// 🏃 캐릭터 러너(트랩 탈출) 게임 규칙 — 화면을 모르는 순수 로직 (node test/crun.test.js, 봇 시뮬레이션 포함).
// 캐릭터가 앞으로 계속 달리고, 앞에서 다가오는 함정을 3개의 길(왼쪽/가운데/오른쪽)에서 점프·슬라이딩·길 바꾸기로 통과해요.
//
// 공정함 장치(설계 원칙):
//  1) 모든 줄(row)은 반드시 "피할 방법"이 있어요 (빈 길, 점프로 넘기, 슬라이딩으로 통과 중 하나)
//  2) 줄 사이 간격은 사람이 반응하고 움직일 수 있는 시간 이상이에요 (길 하나 옮기기 0.3초, 점프 착지 0.7초, 일어서기 0.5초)
//  3) 점프 입력은 카메라/인식 지연(약 0.1초)만큼 앞당겨서 시작해요 (JUMP_LAG) — 몸이 이미 뜬 뒤에야 인식되기 때문
//  4) 맞으면 목숨 -1, 잠시 무적(1.2초) + 속도가 떨어져 연속으로 맞지 않아요
//
// 좌표: d = 앞으로 남은 거리(m). 플레이어는 d=0. 길: 0=왼쪽 1=가운데 2=오른쪽.
export const CRUN = {
  LANES: 3, D_MAX: 56, D_HIT: 0.55,                     // 이 안(앞뒤 0.55m)에 들어오면 부딪힘 판정
  SPEED0: 8.5, SPEED_MAX: 17.0, SPEED_GAIN: 0.09,       // 초기 속도 m/s, 최대, 초당 증가
  JUMP_AIR: 0.64, JUMP_LAG: 0.1, G: 19.0,               // 점프 체공 시간, 인식 지연 보정, 중력
  LOW_H: 0.38,                                          // 낮은 장애물 높이 (이 높이보다 높이 떠 있어야 넘음)
  LANE_TIME: 0.4, LAND_TIME: 0.8, STAND_TIME: 0.9,      // 길 하나 옮기기 / 점프 착지 / 슬라이딩에서 일어서기에 필요한 시간
  GAP_MIN: 1.0,                                         // 줄 사이 최소 간격(초)
  LIVES: 3, INV: 1.2, HIT_SLOW: 0.78, REGEN: 20,         // 맞지 않고 20초 달리면 목숨 1개 회복 (최대 3개)
};
export const V0 = (CRUN.G * CRUN.JUMP_AIR) / 2;          // 점프 초기 속도 (체공 시간이 JUMP_AIR가 되도록)

/** 난이도 0~1 (시간이 지날수록 올라감) */
export const difficulty = (t) => Math.min(1, t / 90);

// ---------- 줄(패턴) 만들기 ----------
// 한 길에서 할 수 있는 대응: "free"(그냥 지나감) "jump"(점프) "slide"(슬라이딩) "none"(벽: 길을 바꿔야 함)
const KIND_RESP = { low: "jump", high: "slide", wall: "none" };
export function responses(row) {                         // 줄에서 길마다 대응 방법
  const r = ["free", "free", "free"];
  for (const o of row.obs) r[o.lane] = KIND_RESP[o.type];
  return r;
}
const solvable = (resp) => resp.map((x, i) => (x !== "none" ? i : -1)).filter((i) => i >= 0);

/** 두 줄 사이에 필요한 최소 시간(초): 앞 줄에서 "끝난 뒤 있는 길/자세"에서 다음 줄의 가능한 길로 이동하는 시간 */
export function neededGap(prevResp, nextResp) {
  const A = solvable(prevResp), B = solvable(nextResp);
  let best = Infinity;
  for (const a of A) for (const b of B) {
    const move = Math.abs(a - b) * CRUN.LANE_TIME;
    const rec = prevResp[a] === "jump" ? CRUN.LAND_TIME : prevResp[a] === "slide" ? CRUN.STAND_TIME : 0;   // 점프/슬라이딩 직후에는 회복 시간이 필요
    best = Math.min(best, Math.max(move, rec));
  }
  return best;
}

export function makeRow(diff, rng, prevResp = null) {
  const kinds = ["hurdle", "gate", "walls", "mixed", "coins"];
  const w = [3, 1.6 + diff, 2 + diff * 1.5, 0.2 + diff * 2.4, 1.2];   // 높은 난이도일수록 섞인 줄이 늘어요
  for (let tries = 0; tries < 12; tries++) {
    let sum = 0; for (const x of w) sum += x;
    let r = rng() * sum, kind = kinds[0]; for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { kind = kinds[i]; break; } }
    const lanes = [0, 1, 2], pick = () => lanes.splice(Math.floor(rng() * lanes.length), 1)[0];
    const obs = []; let coins = null;
    if (kind === "hurdle") { const n = diff > 0.55 && rng() < 0.4 ? 3 : 1 + (rng() < 0.5 ? 1 : 0); for (let i = 0; i < n; i++) obs.push({ type: "low", lane: pick() }); }
    else if (kind === "gate") { const n = diff > 0.4 && rng() < 0.5 ? 3 : 2; for (let i = 0; i < n; i++) obs.push({ type: "high", lane: pick() }); }
    else if (kind === "walls") { const n = diff > 0.35 && rng() < 0.5 ? 2 : 1; for (let i = 0; i < n; i++) obs.push({ type: "wall", lane: pick() }); }
    else if (kind === "mixed") { obs.push({ type: "wall", lane: pick() }); obs.push({ type: rng() < 0.5 ? "low" : "high", lane: pick() }); }
    else { const l = Math.floor(rng() * 3); coins = { lane: l, n: 5 }; if (rng() < 0.5) obs.push({ type: "low", lane: l }); }   // 코인 줄: 낮은 장애물 위로 점프하며 먹기
    const row = { kind, obs, coins, resp: null };
    row.resp = responses(row);
    if (solvable(row.resp).length === 0) continue;       // 피할 방법이 없는 줄은 만들지 않음
    const need = prevResp ? neededGap(prevResp, row.resp) : 0;
    row.gapSec = Math.max(CRUN.GAP_MIN * (1.25 - diff * 0.3), need + 0.3);       // 어려울수록 촘촘하지만 필요한 시간은 항상 보장
    return row;
  }
  const row = { kind: "walls", obs: [{ type: "wall", lane: 0 }], coins: null };   // (거의 안 옴) 안전한 기본 줄
  row.resp = responses(row); row.gapSec = CRUN.GAP_MIN * 1.2; return row;
}

// ---------- 게임 상태 ----------
export function createRun({ rng = Math.random, lives = CRUN.LIVES } = {}) {
  return { t: 0, dist: 0, speed: CRUN.SPEED0, lane: 1, laneX: 1, y: 0, vy: 0, air: false, jt: 0, ducking: false, lives, inv: 0, slow: 0,
    obs: [], coins: [], rows: [], nextRowAt: 1.2, prevResp: null, rng, score: 0, passed: 0, coinCount: 0, hits: 0, jumps: 0, clean: 0, over: false, events: [] };
}

/**
 * 한 프레임 진행
 * @param run    상태
 * @param input  { lane: 0|1|2 (목표 길), jump: boolean(이번 프레임에 점프 감지), duck: boolean(웅크리고 있음) }
 * @param dt     지난 시간(초, 너무 길면 내부에서 잘라요)
 * @param speedMul  속도 배수(웨이브/피버)
 * @returns 이벤트 배열 [{type:"pass"|"coin"|"hit"|"jump"|"over"|"spawn", ...}]
 */
export function stepRun(run, input, dt, speedMul = 1) {
  const ev = run.events = [];
  if (run.over) return ev;
  dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0.016;
  run.t += dt;
  const diff = difficulty(run.t);
  run.speed = Math.min(CRUN.SPEED_MAX, (CRUN.SPEED0 + CRUN.SPEED_GAIN * run.t)) * speedMul * (1 - (run.slow > 0 ? 1 - CRUN.HIT_SLOW : 0));
  run.slow = Math.max(0, run.slow - dt); run.inv = Math.max(0, run.inv - dt);
  const move = run.speed * dt; run.dist += move;
  run.clean += dt; if (run.clean >= CRUN.REGEN && run.lives < CRUN.LIVES) { run.lives++; run.clean = 0; ev.push({ type: "life" }); }

  // 길: 목표 길로 부드럽게 이동 (논리상 길은 바로 바뀌고, 보이는 위치만 따라가요)
  const want = Number.isFinite(input.lane) ? Math.max(0, Math.min(2, Math.round(input.lane))) : run.lane; run.lane = want;      // 이상한 값은 무시
  run.laneX += Math.max(-1, Math.min(1, (want - run.laneX) * Math.min(1, dt * 14)));

  // 점프 (인식 지연만큼 앞당겨 시작) / 슬라이딩
  if (input.jump && !run.air && !run.ducking) {
    run.air = true; run.jt = CRUN.JUMP_LAG; run.jumps++;
    run.y = V0 * run.jt - 0.5 * CRUN.G * run.jt * run.jt; run.vy = V0 - CRUN.G * run.jt;
    ev.push({ type: "jump" });
  } else if (run.air) {
    run.jt += dt; run.vy -= CRUN.G * dt; run.y += run.vy * dt;
    if (run.y <= 0) { run.y = 0; run.vy = 0; run.air = false; }
  }
  run.ducking = !!input.duck && !run.air;

  // 줄 만들기: 앞쪽 끝(D_MAX)에서 간격 시간마다 새 줄
  while (run.t >= run.nextRowAt) {
    const row = makeRow(diff, run.rng, run.prevResp);
    for (const o of row.obs) run.obs.push({ type: o.type, lane: o.lane, d: CRUN.D_MAX, done: false });
    if (row.coins) for (let i = 0; i < row.coins.n; i++) run.coins.push({ lane: row.coins.lane, d: CRUN.D_MAX + i * 1.6, got: false, h: row.obs.some((o) => o.type === "low") ? 0.5 + 0.6 * Math.sin((i / (row.coins.n - 1)) * Math.PI) : 0.25 });
    run.prevResp = row.resp; run.rows.push(row.kind);
    run.nextRowAt += row.gapSec;
    ev.push({ type: "spawn", kind: row.kind });
  }

  // 다가오기 + 부딪힘
  for (const o of run.obs) {
    const before = o.d; o.d -= move;
    if (o.done) continue;
    if (o.d <= CRUN.D_HIT && o.d >= -CRUN.D_HIT && run.lane === o.lane) {          // 논리상 서 있는 길 기준 (길 바꾸기가 바로 반영돼서 반응이 빨라요)
      let hit = false;
      if (o.type === "wall") hit = true;
      else if (o.type === "low") hit = run.y < CRUN.LOW_H;
      else if (o.type === "high") hit = !run.ducking;
      if (hit && run.inv <= 0) { o.done = true; run.lives--; run.inv = CRUN.INV; run.slow = 1.2; run.hits++; run.clean = 0; ev.push({ type: "hit", obs: o.type, lane: o.lane }); if (run.lives <= 0) { run.over = true; ev.push({ type: "over" }); } }
      else if (hit) { /* 무적 중: 통과 */ }
    }
    if (!o.done && before > -CRUN.D_HIT && o.d < -CRUN.D_HIT) { o.done = true; run.passed++; ev.push({ type: "pass", obs: o.type, lane: o.lane }); }
  }
  for (const c of run.coins) {
    c.d -= move;
    if (!c.got && c.d <= 0.6 && c.d >= -0.6 && c.lane === run.lane && Math.abs(c.h - run.y) < 0.65) { c.got = true; run.coinCount++; ev.push({ type: "coin" }); }
  }
  run.obs = run.obs.filter((o) => o.d > -3); run.coins = run.coins.filter((c) => c.d > -3 && !c.got);
  return ev;
}

/** 점수 규칙: 장애물 통과(벽 2점, 점프/슬라이딩으로 넘기 3점), 코인 1점, 달린 거리 10m마다 1점 (거리 점수는 게임 쪽에서 계산) */
export function eventScore(e) { return e.type === "pass" ? (e.obs === "wall" ? 2 : 3) : e.type === "coin" ? 1 : 0; }
