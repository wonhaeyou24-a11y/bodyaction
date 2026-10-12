// 캐릭터 러너 규칙 테스트 + 봇 시뮬레이션: node test/crun.test.js   (SHOW=1 이면 봇 요약 표시)
// 봇 = 반응 시간·실수·입력 지연이 있는 "가짜 플레이어". 규칙이 공정한지(피할 방법 항상 존재), 난이도가 오르는지, 이상한 입력에도 안 터지는지 확인해요.
import { CRUN, V0, difficulty, makeRow, responses, neededGap, createRun, stepRun } from "../crun-core.js";
import { playCrun } from "./bots.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

// ---------- 규칙 ----------
t("점프 물리: 체공 시간 0.64초(지연 보정 0.1초 제외 후 0.54초), 정점 약 1.0, 낮은 장애물(0.38) 위에 머무는 시간이 충분(≥0.4초)", () => {
  const r = createRun({ rng: mulberry(1) }); r.obs = []; r.nextRowAt = 1e9;
  stepRun(r, { lane: 1, jump: true }, 0.016); let air = 0, top = 0, above = 0;
  for (let i = 0; i < 200 && r.air; i++) { stepRun(r, { lane: 1 }, 0.01); air += 0.01; top = Math.max(top, r.y); if (r.y >= CRUN.LOW_H) above += 0.01; }
  ok(Math.abs(air + 0.016 - (CRUN.JUMP_AIR - CRUN.JUMP_LAG)) < 0.06, "체공 " + air);   // 인식 지연만큼 앞당겨 시작하므로 남은 체공 시간 ok(top > 0.85 && top < 1.2, "정점 " + top); ok(above >= 0.4, "높이 유지 " + above);
});
t("점프 인식 지연 보정: 점프가 감지된 순간 이미 위로 올라가 있음", () => {
  const r = createRun({ rng: mulberry(1) }); r.nextRowAt = 1e9; stepRun(r, { lane: 1, jump: true }, 0.016); ok(r.y > 0.4, "y=" + r.y);
});
t("낮은 장애물: 점프하면 통과, 안 하면 맞음", () => {
  const mk = () => { const r = createRun({ rng: mulberry(2) }); r.nextRowAt = 1e9; r.obs = [{ type: "low", lane: 1, d: 6, done: false }]; return r; };
  const a = mk(); let hit = false;
  for (let i = 0; i < 400; i++) { const d = a.obs[0]?.d ?? -9; stepRun(a, { lane: 1, jump: d < a.speed * 0.3 && d > 0 && !a.air }, 0.016).forEach((e) => { if (e.type === "hit") hit = true; }); }
  ok(!hit, "점프했는데 맞음");
  const b = mk(); let hit2 = false; for (let i = 0; i < 400; i++) stepRun(b, { lane: 1 }, 0.016).forEach((e) => { if (e.type === "hit") hit2 = true; });
  ok(hit2, "안 했는데 안 맞음");
});
t("높은 장애물: 웅크리면 통과, 서 있으면 맞음 / 벽: 같은 길이면 맞고 다른 길이면 통과", () => {
  const run = (type, lane, input) => { const r = createRun({ rng: mulberry(3) }); r.nextRowAt = 1e9; r.obs = [{ type, lane: 1, d: 6, done: false }]; let h = false; for (let i = 0; i < 400; i++) stepRun(r, { ...input, lane }, 0.016).forEach((e) => { if (e.type === "hit") h = true; }); return h; };
  ok(run("high", 1, { duck: true }) === false && run("high", 1, {}) === true, "high");
  ok(run("wall", 1, {}) === true && run("wall", 0, {}) === false, "wall");
});
t("맞으면 목숨 -1, 1.2초 무적(연속으로 안 맞음), 0이면 게임 끝", () => {
  const r = createRun({ rng: mulberry(4) }); r.nextRowAt = 1e9; r.obs = [{ type: "wall", lane: 1, d: 1, done: false }, { type: "wall", lane: 1, d: 3, done: false }];
  let hits = 0; for (let i = 0; i < 200; i++) stepRun(r, { lane: 1 }, 0.016).forEach((e) => { if (e.type === "hit") hits++; });
  ok(hits === 1 && r.lives === 2, `hits=${hits} lives=${r.lives}`);
  const q = createRun({ rng: mulberry(5), lives: 1 }); q.nextRowAt = 1e9; q.obs = [{ type: "wall", lane: 1, d: 1, done: false }];
  let over = false; for (let i = 0; i < 100; i++) stepRun(q, { lane: 1 }, 0.016).forEach((e) => { if (e.type === "over") over = true; }); ok(over && q.over, "게임 끝");
});
t("코인: 같은 길·비슷한 높이에서 먹힘", () => {
  const r = createRun({ rng: mulberry(6) }); r.nextRowAt = 1e9; r.coins = [{ lane: 1, d: 5, got: false, h: 0.25 }, { lane: 0, d: 5, got: false, h: 0.25 }];
  let n = 0; for (let i = 0; i < 300; i++) stepRun(r, { lane: 1 }, 0.016).forEach((e) => { if (e.type === "coin") n++; }); ok(n === 1, "coins " + n);
});

// ---------- 공정함 (줄 만들기) ----------
t("모든 줄에는 피할 방법이 있음 (난이도 0~1, 씨앗 400개)", () => {
  for (let s = 0; s < 400; s++) { const rng = mulberry(s); let prev = null; for (let k = 0; k < 60; k++) { const row = makeRow(k / 60, rng, prev); ok(responses(row).filter((x) => x !== "none").length >= 1, `씨앗${s} 줄${k}: 길이 모두 막힘`); ok(row.obs.length <= 3, "개수"); prev = row.resp; } }
});
t("줄 사이 간격 ≥ 필요한 이동·회복 시간 + 0.3초, 그리고 최소 간격", () => {
  for (let s = 0; s < 300; s++) { const rng = mulberry(1000 + s); let prev = null; for (let k = 0; k < 60; k++) { const d = k / 60, row = makeRow(d, rng, prev); if (prev) ok(row.gapSec >= neededGap(prev, row.resp) + 0.3 - 1e-9, `간격 부족 ${row.gapSec}`); ok(row.gapSec >= CRUN.GAP_MIN * 0.85 - 1e-9, "최소 간격 " + row.gapSec); prev = row.resp; } }
});
t("한 줄에 벽이 3개(전부 막힘) 나오지 않음", () => {
  for (let s = 0; s < 300; s++) { const rng = mulberry(5000 + s); for (let k = 0; k < 60; k++) ok(makeRow(k / 60, rng, null).obs.filter((o) => o.type === "wall").length <= 2, "벽 3개"); }
});
t("난이도가 오를수록 줄 간격이 줄고 섞인 줄이 늘어남", () => {
  const avg = (d) => { let g = 0, n = 0; for (let s = 0; s < 200; s++) { const rng = mulberry(s); let prev = null; for (let k = 0; k < 20; k++) { const r = makeRow(d, rng, prev); g += r.gapSec; n++; prev = r.resp; } } return g / n; };
  const mixed = (d) => { let m = 0, n = 0; for (let s = 0; s < 300; s++) { const rng = mulberry(s); for (let k = 0; k < 10; k++) { if (makeRow(d, rng, null).kind === "mixed") m++; n++; } } return m / n; };
  ok(avg(1) < avg(0), `간격 ${avg(0)} → ${avg(1)}`); ok(mixed(1) > mixed(0) * 2, `섞인 줄 ${mixed(0)} → ${mixed(1)}`);
});

// ---------- 봇 시뮬레이션 ----------
const med = (arr) => [...arr].sort((x, y) => x - y)[arr.length >> 1];
const many = (opts, n = 60) => { const rs = []; for (let s = 0; s < n; s++) rs.push(playCrun({ ...opts, seed: s + 1 })); return rs; };

t("완벽에 가까운 봇(반응 0.15초, 실수 2%)은 90초를 거의 다 살아남음 (60판 중 80% 이상)", () => {
  const rs = many({ rt: 0.15, miss: 0.02 }); const alive = rs.filter((r) => !r.over).length;
  ok(alive >= 50, `생존 ${alive}/60 (평균 맞은 횟수 ${(rs.reduce((a, r) => a + r.hits, 0) / 60).toFixed(2)})`);
});
t("실력 순서가 지켜짐: 달린 거리 완벽 > 보통 > 서툰, 보통 봇도 60초는 대부분 버팀", () => {
  const dist = (o) => med(many({ ...o, secs: 60 }, 80).map((r) => r.dist));
  const a = dist({ rt: 0.15, miss: 0.02 }), b = dist({ rt: 0.35, miss: 0.12 }), c = dist({ rt: 0.6, miss: 0.35 });
  ok(a > b && b > c, `거리 완벽 ${a.toFixed(0)} > 보통 ${b.toFixed(0)} > 서툰 ${c.toFixed(0)}`);
  const surv = many({ rt: 0.35, miss: 0.12, secs: 60 }, 80).filter((r) => !r.over).length; ok(surv >= 40, `보통 봇 60초 생존 ${surv}/80`);
});
t("아무것도 안 하면 곧 끝남(30초 이내), 무작위 입력도 오래 못 감", () => {
  const lazy = many({ lazy: true, rt: 0, miss: 0 }, 30); ok(lazy.every((r) => r.over && r.t < 30), "가만히 있는데 오래 삶 " + Math.max(...lazy.map((r) => r.t)));
  const rnd = many({ randomInput: true, rt: 0, miss: 0 }, 30); ok(rnd.filter((r) => !r.over).length <= 4, "무작위 입력이 너무 잘 삶");
});
t("입력 지연 0~0.2초(카메라가 느린 PC)에서도 완벽한 봇이 버팀 (지연 보정 효과)", () => {
  for (const lat of [0, 0.1, 0.2]) { const rs = many({ rt: 0.15, miss: 0.02, lat }, 40); const alive = rs.filter((r) => !r.over).length; ok(alive >= 32, `지연 ${lat}: 생존 ${alive}/40`); }
});
t("지연 보정이 실제로 도움이 됨: 지연 0.2초에서 보정 있음 ≤ 없음 (맞은 횟수)", () => {
  const withComp = many({ rt: 0.15, miss: 0.02, lat: 0.2 }, 40).reduce((a, r) => a + r.hits, 0);
  const saved = CRUN.JUMP_LAG; CRUN.JUMP_LAG = 0; const without = many({ rt: 0.15, miss: 0.02, lat: 0.2 }, 40).reduce((a, r) => a + r.hits, 0); CRUN.JUMP_LAG = saved;
  ok(withComp <= without, `보정 있음 ${withComp}, 없음 ${without}`);
});
t("속도가 시간에 따라 오르고 최대를 넘지 않음, 난이도 0~1", () => {
  const r = createRun({ rng: mulberry(9) }); r.nextRowAt = 1e9; for (let i = 0; i < 6000; i++) { stepRun(r, { lane: 1 }, 0.016); ok(r.speed <= CRUN.SPEED_MAX + 0.001 && r.speed >= CRUN.SPEED0 * 0.7, "속도 " + r.speed); }
  ok(difficulty(0) === 0 && difficulty(90) === 1 && difficulty(1000) === 1, "난이도");
});
t("이상한 입력(NaN, 음수/긴 dt, 범위 밖 길)에도 터지지 않고 값이 유한", () => {
  const r = createRun({ rng: mulberry(10) });
  for (let i = 0; i < 3000; i++) {
    const dt = [0, -1, 0.5, 5, NaN, 0.016][i % 6];
    stepRun(r, { lane: [NaN, -3, 9, 1, 0, 2][i % 6], jump: i % 7 === 0, duck: i % 5 === 0 }, Number.isFinite(dt) ? dt : 0.016);
    ok(Number.isFinite(r.y) && Number.isFinite(r.laneX) && Number.isFinite(r.speed) && Number.isFinite(r.dist), "유한하지 않음 " + i); ok(r.lane >= 0 && r.lane <= 2, "길 범위"); if (r.over) break;
  }
  ok(r.obs.length < 80, "장애물이 쌓임");
});

if (process.env.SHOW) {
  const sum = (o, n = 100) => { const rs = many(o, n); return { 거리중앙: Math.round(med(rs.map((r) => r.dist))), 점수중앙: Math.round(med(rs.map((r) => r.dist + r.passed * 3 + r.coinCount * 5))), 생존: rs.filter((r) => !r.over).length + "/" + n }; };
  console.log("봇 요약", JSON.stringify({ 완벽: sum({ rt: 0.15, miss: 0.02 }), 능숙: sum({ rt: 0.25, miss: 0.07 }), 보통: sum({ rt: 0.35, miss: 0.12 }), 서툰: sum({ rt: 0.6, miss: 0.35 }), 초보: sum({ rt: 0.8, miss: 0.5 }) }, null, 1));
}
console.log(`캐릭터 러너: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
