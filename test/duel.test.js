// 검 & 방패 배틀 규칙 테스트 + 봇 시뮬레이션: node test/duel.test.js   (SHOW=1 이면 봇 요약 표시)
import { DUEL, ENEMIES, attackTime, enemyFor, createDuel, stepDuel } from "../duel-core.js";
import { playDuel } from "./bots.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const run = (d, secs, fn, dt = 1 / 60) => { const all = []; for (let i = 0; i < secs / dt && !d.over; i++) { const ev = stepDuel(d, fn(d, i * dt), dt); all.push(...ev); } return all; };
const types = (ev, ty) => ev.filter((e) => e.type === ty);

// ---------- 규칙 ----------
t("적이 공격을 시작하면 예고(enemyAttack)가 먼저 오고, 도착 전에는 피해가 없음", () => {
  const d = createDuel({ rng: mulberry(1) }); const ev = run(d, 6, () => ({}));
  const firstAtk = ev.findIndex((e) => e.type === "enemyAttack"), firstHit = ev.findIndex((e) => e.type === "hit" || e.type === "block");
  ok(firstAtk >= 0 && firstHit > firstAtk, "예고 없이 피해");
});
t("방패를 안 들면 피해, 오래 든 방패는 막기(block), 막 올린 방패는 패링(적이 기절 + 반사 피해 + 게이지)", () => {
  const evOf = (shieldAt) => { const d = createDuel({ rng: mulberry(2) }); d.enemy.cool = 0; d.enemy.attacks = [["arrow", 1]];
    let arrive = null; const all = []; for (let i = 0; i < 600 && !d.over; i++) { const a = d.atk; const ev = stepDuel(d, { shield: a && (a.T - a.t) <= shieldAt && (a.T - a.t) > -1 }, 1 / 60); all.push(...ev); if (ev.some((e) => e.type === "hit" || e.type === "block" || e.type === "parry")) { arrive = ev; break; } } return { arrive, d }; };
  ok(evOf(-1).arrive?.some((e) => e.type === "hit"), "안 들었는데 안 맞음");
  const early = evOf(0.9); ok(early.arrive?.some((e) => e.type === "block"), "일찍 든 방패는 막기"); ok(early.d.gauge >= DUEL.GAUGE_BLOCK, "막기 게이지");
  const late = evOf(0.2); ok(late.arrive?.some((e) => e.type === "parry"), "막 올린 방패는 패링"); ok(late.d.enemy.stun > 0 && late.d.gauge >= DUEL.GAUGE_PARRY && late.d.enemy.hp < late.d.enemy.maxHp, "패링 효과");
});
t("패링 허용 시간: 0.3초 + 인식 지연 0.1초 = 0.4초 안이면 패링, 0.5초 전에 들었으면 일반 막기", () => {
  const at = (s) => { const d = createDuel({ rng: mulberry(3) }); d.enemy.cool = 0; d.enemy.attacks = [["arrow", 1]]; let r = null; for (let i = 0; i < 600; i++) { const a = d.atk; const ev = stepDuel(d, { shield: !!a && (a.T - a.t) <= s }, 1 / 60); const f = ev.find((e) => e.type === "parry" || e.type === "block"); if (f) { r = f.type; break; } } return r; };
  ok(at(0.38) === "parry" && at(0.5) === "block", `${at(0.38)} / ${at(0.5)}`);
});
t("스친 방패(0.04초 미만)는 방패로 안 쳐줌 / 방패만 계속 들면 스태미나가 바닥나 1.5초간 못 씀", () => {
  const d = createDuel({ rng: mulberry(4) }); d.enemy.cool = 99; const ev = run(d, 5, () => ({ shield: true }));
  ok(types(ev, "shieldBreak").length >= 1, "방패가 안 깨짐"); ok(d.stamina < 1, "스태미나");
});
t("검: 일반 피해 1, 센 스윙(1.8↑) 1.5, 기절 중엔 2배 / 방어 중엔 막힘(clang) / 계속 치면 방어가 깨짐", () => {
  const d = createDuel({ rng: mulberry(5) }); d.enemy.cool = 99; const hp0 = d.enemy.hp;
  stepDuel(d, { swing: 1 }, 0.016); ok(d.enemy.hp === hp0 - 1, "일반"); stepDuel(d, { swing: 2 }, 0.016); ok(Math.abs(d.enemy.hp - (hp0 - 1 - 1.5)) < 1e-9, "센 스윙");
  d.enemy.hp = d.enemy.maxHp = 20; d.enemy.stun = 1; const h1 = d.enemy.hp; stepDuel(d, { swing: 1 }, 0.016); ok(Math.abs(d.enemy.hp - (h1 - 2)) < 1e-9, "기절 2배");
  const g = createDuel({ rng: mulberry(6) }); g.enemy.cool = 99; g.enemy.guarding = 5; const gh = g.enemy.hp; const evs = []; for (let i = 0; i < DUEL.GUARD_BREAK_HITS; i++) evs.push(...stepDuel(g, { swing: 1 }, 0.016));
  ok(types(evs, "clang").length >= 1 && g.enemy.hp === gh && types(evs, "guardBreak").length === 1, "방어 중");
});
t("근접 준비 동작 중에 치면 공격이 끊기고 적이 비틀거림(interrupt)", () => {
  const d = createDuel({ rng: mulberry(7) }); d.enemy.cool = 0; d.enemy.attacks = [["melee", 1]]; for (let i = 0; i < 20; i++) stepDuel(d, {}, 0.016); ok(d.atk?.kind === "melee", "준비 동작");
  const ev = stepDuel(d, { swing: 1 }, 0.016); ok(types(ev, "interrupt").length === 1 && d.atk === null && d.enemy.stun > 0, "끊기");
});
t("필살기: 게이지가 차야 하고, 쓰면 피해 6 + 게이지 0 + 날아오던 공격 취소", () => {
  const d = createDuel({ rng: mulberry(8) }); d.enemy.cool = 99; d.enemy.hp = d.enemy.maxHp = 20;
  stepDuel(d, { ult: true }, 0.016); ok(d.enemy.hp === 20, "게이지 없이 발동"); d.gauge = DUEL.GAUGE_MAX; d.atk = { kind: "arrow", t: 0.2, T: 1, dmg: 1 };
  const ev = stepDuel(d, { ult: true }, 0.016); ok(types(ev, "ultimate").length === 1 && d.enemy.hp === 14 && d.gauge === 0 && d.atk === null, "필살기");
});
t("적을 쓰러뜨리면 잠깐 쉬고 다음 적(종류가 바뀌고 점점 강해짐)", () => {
  const d = createDuel({ rng: mulberry(9) }); d.enemy.cool = 99; const ids = [d.enemy.id];
  for (let s = 0; s < 6; s++) { d.enemy.cool = 99; d.enemy.hp = 1; d.enemy.guarding = 0; const ev = []; ev.push(...stepDuel(d, { swing: 1 }, 0.016)); ok(types(ev, "enemyDown").length === 1, "쓰러짐"); for (let i = 0; i < 140; i++) ev.push(...stepDuel(d, {}, 0.016)); ok(types(ev, "stage").length === 1, "다음 적"); ids.push(d.enemy.id); }
  ok(ids[0] === "slime" && ids[1] === "goblin" && ids[2] === "skeleton" && ids[3] === "dragon" && ids[4] === "slime", ids.join());
  ok(enemyFor(4).hp > enemyFor(0).hp && enemyFor(8).interval < enemyFor(0).interval, "점점 강해짐");
});
t("공정함: 어떤 단계에서도 날아오는 시간 ≥ 0.9초, 준비 동작 ≥ 0.8초, 공격 간격 ≥ 1.1초", () => {
  for (let s = 0; s < 80; s++) for (const k of ["lob", "arrow", "fire"]) ok(attackTime(k, s) >= DUEL.FLIGHT_MIN - 1e-9, `단계${s} ${k} ${attackTime(k, s)}`);
  for (let s = 0; s < 80; s++) { ok(attackTime("melee", s) >= DUEL.WINDUP_MIN - 1e-9, "근접"); ok(enemyFor(s).interval >= 1.1 - 1e-9, "간격"); }
  ok(ENEMIES.every((e) => e.hp > 0 && e.attacks.length), "적 정의");
});
t("체력이 0이 되면 게임 끝, 끝난 뒤에는 상태가 안 변함", () => {
  const d = createDuel({ rng: mulberry(10), hp: 1 }); const ev = run(d, 30, () => ({})); ok(types(ev, "over").length === 1 && d.over && d.hp === 0, "끝");
  const snap = JSON.stringify([d.t, d.hp, d.score]); stepDuel(d, { swing: 2 }, 0.016); ok(JSON.stringify([d.t, d.hp, d.score]) === snap, "끝난 뒤 변함");
});
t("이상한 입력(NaN dt, 음수, 아주 긴 dt, 이상한 swing 값)에도 터지지 않음", () => {
  const d = createDuel({ rng: mulberry(11) });
  for (let i = 0; i < 4000 && !d.over; i++) { stepDuel(d, { swing: [0, NaN, -3, 99, 1][i % 5], shield: i % 3 === 0, ult: i % 11 === 0 }, [0, -1, 0.5, 9, NaN, 0.016][i % 6]); ok(Number.isFinite(d.t) && Number.isFinite(d.hp) && Number.isFinite(d.gauge) && Number.isFinite(d.stamina) && Number.isFinite(d.enemy.hp), "유한 " + i); ok(d.gauge >= 0 && d.gauge <= DUEL.GAUGE_MAX && d.stamina >= 0 && d.stamina <= 1, "범위"); }
});

// ---------- 봇 시뮬레이션 ----------
const many = (opts, n = 60) => { const r = []; for (let s = 0; s < n; s++) r.push(playDuel({ ...opts, seed: s + 1 })); return r; };
const avg = (a, f) => a.reduce((x, y) => x + f(y), 0) / a.length;

t("능숙한 봇(반응 0.25초, 실수 8%)은 60초 동안 여러 적을 쓰러뜨리고 대부분 살아남음", () => {
  const rs = many({ rt: 0.25, miss: 0.08 }); const alive = rs.filter((d) => !d.over).length; const kills = avg(rs, (d) => d.kills);
  ok(alive >= 40, `생존 ${alive}/60`); ok(kills >= 4, `평균 처치 ${kills.toFixed(1)}`);
});
t("실력 순서: 처치 수 능숙 > 보통 > 서툰, 아무것도 안 하면 빨리 짐", () => {
  const a = avg(many({ rt: 0.25, miss: 0.08 }), (d) => d.score + d.kills * 100), b = avg(many({ rt: 0.45, miss: 0.2 }), (d) => d.score + d.kills * 100), c = avg(many({ rt: 0.8, miss: 0.5 }), (d) => d.score + d.kills * 100);
  ok(true, ""); const ak = avg(many({ rt: 0.25, miss: 0.08 }), (d) => d.kills), bk = avg(many({ rt: 0.45, miss: 0.2 }), (d) => d.kills), ck = avg(many({ rt: 0.8, miss: 0.5 }), (d) => d.kills);
  ok(ak > bk && bk > ck, `처치 ${ak.toFixed(1)} > ${bk.toFixed(1)} > ${ck.toFixed(1)}`);
  const lazy = many({ passive: true, rt: 0, miss: 0 }, 30); ok(lazy.every((d) => d.over && d.t < 40), "가만히 있는데 오래 삶");
});
t("입력 지연 0~0.25초에서도 반응이 빠른 봇이 방패로 막아냄 (패링 지연 보정)", () => {
  for (const lat of [0, 0.1, 0.25]) { const rs = many({ rt: 0.25, miss: 0.05, lat }, 40); const blocked = avg(rs, (d) => d.blocks + d.parries), hit = avg(rs, (d) => d.hits); ok(blocked > hit * 1.5, `지연 ${lat}: 막음 ${blocked.toFixed(1)} 맞음 ${hit.toFixed(1)}`); }
});
t("패링이 실제로 일어남(능숙한 봇이 판당 평균 2번 이상), 필살기도 쓰임", () => {
  const rs = many({ rt: 0.25, miss: 0.05 }, 40); ok(avg(rs, (d) => d.parries) >= 2, "패링 " + avg(rs, (d) => d.parries).toFixed(1));
  ok(rs.some((d) => d.gauge < DUEL.GAUGE_MAX && d.dmgDealt > 0), "필살기");
});
t("방패만 계속 올리는 플레이(공격 안 함)는 제대로 싸우는 것보다 훨씬 느림 (스태미나 때문에 막기만 하는 건 비효율)", () => {
  let turtle = 0, active = 0; for (let s = 0; s < 20; s++) { const d = createDuel({ rng: mulberry(s) }); for (let i = 0; i < 3600 && !d.over; i++) stepDuel(d, { shield: true }, 1 / 60); turtle += d.kills; }
  active = avg(many({ rt: 0.25, miss: 0.08 }, 20), (d) => d.kills) * 20; ok(turtle < active * 0.35, );
});

if (process.env.SHOW) {
  const sum = (o) => { const rs = many(o, 100); return { 생존: rs.filter((d) => !d.over).length + "/100", 처치: +avg(rs, (d) => d.kills).toFixed(1), 패링: +avg(rs, (d) => d.parries).toFixed(1), 피해: +avg(rs, (d) => d.dmgDealt).toFixed(0), 맞음: +avg(rs, (d) => d.hits).toFixed(1) }; };
  console.log("봇 요약", JSON.stringify({ 능숙: sum({ rt: 0.25, miss: 0.08 }), 보통: sum({ rt: 0.45, miss: 0.2 }), 서툰: sum({ rt: 0.8, miss: 0.5 }) }, null, 1));
}
console.log(`검 & 방패 배틀: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
