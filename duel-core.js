// ⚔️ 검 & 방패 패링 배틀 규칙 — 화면을 모르는 순수 로직 (node test/duel.test.js, 봇 시뮬레이션 포함).
// 오른손으로 휘두르면 검 공격, 왼손을 올리면 방패(막기/패링), 필살기 게이지가 차면 양손을 번쩍 들어 필살기.
//
// 공정함 장치:
//  1) 적의 공격은 항상 "예고"가 있어요: 화살/불꽃은 날아오는 시간(FLIGHT_MIN 0.9초 이상), 근접 공격은 준비 동작(WINDUP_MIN 0.8초 이상)
//  2) 방패 입력 지연 보정: 패링 허용 시간(PARRY_WINDOW 0.3초)에 인식 지연(0.1초)을 더해서 판정해요
//  3) 방패를 계속 들고만 있으면 체력(스태미나)이 줄어서 막기만 하는 게 불가능하고, 막아도 줄어요 (바닥나면 1.5초 동안 방패 못 씀)
//  4) 근접 준비 동작 중에 검으로 치면 적이 비틀거려요(공격 끊기) — 방패 말고도 대처할 방법이 있어요
export const DUEL = {
  PLAYER_HP: 5,
  FLIGHT_MIN: 0.9, WINDUP_MIN: 0.8,
  PARRY_WINDOW: 0.3, LAG: 0.1,                         // 방패를 든 지 0.3초(+지연 0.1) 안에 공격이 도착하면 패링
  SHIELD_MIN_UP: 0.04,                                  // 방패가 이 시간 이상 올라가 있어야 막힘 (스쳐 지나가는 손은 방패가 아니에요)
  STAM_DRAIN: 0.3, STAM_BLOCK: 0.14, STAM_REGEN: 0.35, STAM_BREAK: 1.5,
  GAUGE_HIT: 8, GAUGE_BLOCK: 12, GAUGE_PARRY: 26, GAUGE_MAX: 100, ULT_DMG: 6,
  STUN: 2.0, STUN_MUL: 2, GUARD_BREAK_HITS: 4,
  STAGE_PAUSE: 1.6,
};
// 적 종류 (HP는 단계가 올라가면 늘어나요)
export const ENEMIES = [
  { id: "slime", name: "말랑 슬라임", hp: 8, interval: 2.6, attacks: [["lob", 1]], guard: 0 },
  { id: "goblin", name: "화살 고블린", hp: 11, interval: 2.3, attacks: [["arrow", 3], ["melee", 2]], guard: 0 },
  { id: "skeleton", name: "방패 해골", hp: 14, interval: 2.2, attacks: [["arrow", 2], ["melee", 3]], guard: 0.35 },
  { id: "dragon", name: "불꽃 용 (보스)", hp: 24, interval: 2.0, attacks: [["fire", 3], ["arrow", 2], ["melee", 1]], guard: 0.2, boss: true },
];
const ATTACK = {                                         // 날아오는/준비 시간, 피해, 패링 가능 여부
  lob: { t: 1.5, dmg: 1 }, arrow: { t: 1.1, dmg: 1 }, fire: { t: 1.0, dmg: 2 }, melee: { t: 1.0, dmg: 1 },
};
export const attackTime = (kind, stage) => Math.max(kind === "melee" ? DUEL.WINDUP_MIN : DUEL.FLIGHT_MIN, ATTACK[kind].t * Math.pow(0.97, stage));

export function enemyFor(stage) {
  const base = ENEMIES[stage % ENEMIES.length], loop = Math.floor(stage / ENEMIES.length);
  return { ...base, stage, hp: Math.round(base.hp * (1 + 0.3 * loop)), maxHp: 0, interval: Math.max(1.1, base.interval * Math.pow(0.94, stage)) };
}

export function createDuel({ rng = Math.random, hp = DUEL.PLAYER_HP } = {}) {
  const d = { rng, t: 0, stage: 0, hp, maxHp: hp, gauge: 0, stamina: 1, broken: 0, shieldUp: false, raisedAt: -9, score: 0, kills: 0, parries: 0, blocks: 0, hits: 0, dmgDealt: 0,
    swings: 0, combo: 0, enemy: null, atk: null, pause: 0, over: false, events: [] };
  spawnEnemy(d); return d;
}
function spawnEnemy(d) {
  const e = enemyFor(d.stage); e.maxHp = e.hp; e.cool = 1.4; e.stun = 0; e.guarding = 0; e.guardHits = 0; e.dead = false; e.hurt = 0;
  d.enemy = e; d.atk = null;
}
const pickWeighted = (list, rng) => { let s = 0; for (const [, w] of list) s += w; let r = rng() * s; for (const [k, w] of list) { r -= w; if (r <= 0) return k; } return list[0][0]; };

/**
 * 한 프레임 진행
 * @param d     상태
 * @param input { swing: 0|강도(1~2.5) 이번 프레임에 검을 휘둘렀는지, shield: boolean 방패(왼손) 올라가 있음, ult: boolean 양손 번쩍 }
 * @param dt    지난 시간(초)
 * @returns 이벤트 배열
 */
export function stepDuel(d, input, dt) {
  const ev = d.events = [];
  if (d.over) return ev;
  dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0.016;
  d.t += dt;
  const e = d.enemy;

  // --- 방패: 올라간 시각 기록, 스태미나 ---
  const up = !!input.shield && d.broken <= 0;
  if (up && !d.shieldUp) d.raisedAt = d.t;
  d.shieldUp = up;
  d.broken = Math.max(0, d.broken - dt);
  if (d.shieldUp) { d.stamina = Math.max(0, d.stamina - DUEL.STAM_DRAIN * dt); if (d.stamina <= 0) { d.broken = DUEL.STAM_BREAK; d.shieldUp = false; ev.push({ type: "shieldBreak" }); } }
  else d.stamina = Math.min(1, d.stamina + DUEL.STAM_REGEN * dt);

  if (d.pause > 0) {                                      // 다음 적이 나오기 전 잠깐 쉼
    d.pause -= dt; if (d.pause <= 0) { d.stage++; spawnEnemy(d); ev.push({ type: "stage", stage: d.stage, enemy: d.enemy.id }); }
    return ev;
  }

  e.hurt = Math.max(0, e.hurt - dt);
  // --- 필살기 ---
  if (input.ult && d.gauge >= DUEL.GAUGE_MAX) {
    d.gauge = 0; d.atk = null; damage(d, DUEL.ULT_DMG, ev, "ult"); ev.push({ type: "ultimate" });
    e.stun = Math.max(e.stun, 1.2); e.guarding = 0;
  }
  // --- 검 ---
  if (input.swing > 0 && !e.dead) {
    d.swings++;
    if (e.guarding > 0) {
      e.guardHits++; ev.push({ type: "clang" });
      if (e.guardHits >= DUEL.GUARD_BREAK_HITS) { e.guarding = 0; e.stun = 1.0; ev.push({ type: "guardBreak" }); }   // 계속 치면 방어가 깨져요
    } else {
      const inter = d.atk && d.atk.kind === "melee";
      const mul = (e.stun > 0 ? DUEL.STUN_MUL : 1) * (input.swing >= 1.8 ? 1.5 : 1);
      if (inter) { d.atk = null; e.stun = Math.max(e.stun, 1.0); e.cool = Math.max(e.cool, 0.9); ev.push({ type: "interrupt" }); }
      damage(d, mul, ev, "swing");
      d.gauge = Math.min(DUEL.GAUGE_MAX, d.gauge + DUEL.GAUGE_HIT);
    }
  }
  if (e.dead) return ev;

  // --- 적 행동 ---
  e.stun = Math.max(0, e.stun - dt); e.guarding = Math.max(0, e.guarding - dt);
  if (e.stun <= 0 && !d.atk) {
    e.cool -= dt;
    if (e.cool <= 0) {
      if (e.guard > 0 && e.guarding <= 0 && d.rng() < e.guard) { e.guarding = 1.3; e.guardHits = 0; e.cool = 0.9; ev.push({ type: "guard" }); }
      else {
        const kind = pickWeighted(e.attacks, d.rng), T = attackTime(kind, e.stage);
        d.atk = { kind, t: 0, T, dmg: ATTACK[kind].dmg }; ev.push({ type: "enemyAttack", kind, T });
      }
    }
  }
  if (d.atk) {
    d.atk.t += dt;
    if (d.atk.t >= d.atk.T) {                             // 도착!
      const a = d.atk; d.atk = null; e.cool = e.interval * (0.85 + d.rng() * 0.3);
      const upFor = d.shieldUp ? d.t - d.raisedAt : -1;
      if (d.shieldUp && upFor >= DUEL.SHIELD_MIN_UP) {
        if (upFor <= DUEL.PARRY_WINDOW + DUEL.LAG) {      // 막 올린 방패 = 패링: 반사해서 적이 기절
          d.parries++; d.gauge = Math.min(DUEL.GAUGE_MAX, d.gauge + DUEL.GAUGE_PARRY); e.stun = DUEL.STUN; ev.push({ type: "parry", kind: a.kind });
          damage(d, 2, ev, "parry");
        } else { d.blocks++; d.gauge = Math.min(DUEL.GAUGE_MAX, d.gauge + DUEL.GAUGE_BLOCK); d.stamina = Math.max(0, d.stamina - DUEL.STAM_BLOCK); ev.push({ type: "block", kind: a.kind }); }
      } else {
        d.hp -= a.dmg; d.hits++; d.combo = 0; ev.push({ type: "hit", kind: a.kind, dmg: a.dmg });
        if (d.hp <= 0) { d.hp = 0; d.over = true; ev.push({ type: "over" }); }
      }
    }
  }
  return ev;
}

function damage(d, amount, ev, src) {
  const e = d.enemy; if (e.dead) return;
  e.hp -= amount; e.hurt = 0.25; d.dmgDealt += amount; if (src === "swing") d.combo++;
  ev.push({ type: "enemyHit", amount, src, hp: Math.max(0, e.hp) });
  if (e.hp <= 0) { e.hp = 0; e.dead = true; d.kills++; d.atk = null; d.pause = DUEL.STAGE_PAUSE; ev.push({ type: "enemyDown", stage: d.stage, boss: !!e.boss }); }
}

/** 점수 규칙: 검 맞히기(피해×2), 막기 2, 패링 10, 공격 끊기 5, 방어 깨기 4, 필살기 30, 적 쓰러뜨리기 20×(단계+1) */
export function eventScore(e, stage = 0) {
  switch (e.type) {
    case "enemyHit": return e.src === "swing" ? Math.round(e.amount * 2) : 0;
    case "block": return 2; case "parry": return 10; case "interrupt": return 5; case "guardBreak": return 4; case "ultimate": return 30;
    case "enemyDown": return 20 * (e.stage + 1);
    default: return 0;
  }
}
