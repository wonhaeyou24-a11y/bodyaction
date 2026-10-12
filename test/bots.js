// 가짜 플레이어(봇): 반응 시간·실수·입력 지연이 있는 사람 흉내. 규칙 테스트(공정함/난이도)와 등급 기준 계산에 같이 써요.
import { CRUN, createRun, stepRun, eventScore as crunScore } from "../crun-core.js";
import { DUEL, createDuel, stepDuel, eventScore as duelScore } from "../duel-core.js";
export function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

/** 규칙대로 반응하는 가짜 플레이어. rt: 반응 시간, miss: 실수 확률, lat: 입력 지연(초) */
export function playCrun({ seed, rt, miss, lat = 0.1, secs = 90, lazy = false, randomInput = false }) {
  const rng = mulberry(seed), r = createRun({ rng: mulberry(seed + 77) }); const dt = 1 / 60;
  let lane = 1, plan = null; const queue = []; let duckUntil = -1; const known = { lane: 1, duck: false };
  for (let i = 0; i < secs * 60 && !r.over; i++) {
    const now = r.t;
    if (!lazy && !randomInput) {
      const ahead = r.obs.filter((o) => !o.done && o.d > -CRUN.D_HIT).sort((a, b) => a.d - b.d);
      if (ahead.length) {
        const d0 = ahead[0].d, grp = ahead.filter((o) => o.d - d0 < 0.6), resp = ["free", "free", "free"];
        for (const o of grp) resp[o.lane] = o.type === "low" ? "jump" : o.type === "high" ? "slide" : "none";
        const ta = d0 / r.speed;
        if (!plan || Math.abs(plan.d0 - d0) > 1.5 || plan.rowKey !== grp.map((o) => o.type + o.lane).join()) {
          const okL = [0, 1, 2].filter((l) => resp[l] !== "none");
          const near = okL.reduce((b, l) => (Math.abs(l - lane) < Math.abs(b - lane) || (Math.abs(l - lane) === Math.abs(b - lane) && Math.abs(l - 1) < Math.abs(b - 1)) ? l : b), okL[0]);
          const want = resp[lane] === "none" ? near : lane;
          plan = { d0, rowKey: grp.map((o) => o.type + o.lane).join(), lane: want, act: resp[want], decideAt: now + rt * (0.8 + rng() * 0.5), mistake: rng() < miss, jumped: false, laned: false };
        }
        plan.d0 = d0;
        if (now >= plan.decideAt && !plan.mistake) {
          if (ta < 1.2 && lane !== plan.lane) { lane = plan.lane; queue.push({ at: now + lat, kind: "lane", v: lane }); }
          if (plan.act === "jump" && ta < 0.3 + (rng() - 0.5) * 0.05 && !plan.jumped) { plan.jumped = true; queue.push({ at: now + lat, kind: "jump" }); }
          if (plan.act === "slide" && ta < 0.42 && duckUntil < 0) { queue.push({ at: now + lat, kind: "duck", v: true }); duckUntil = now + ta + 0.5; }
        }
      }
      if (duckUntil > 0 && now > duckUntil) { queue.push({ at: now + lat, kind: "duck", v: false }); duckUntil = -1; }
    }
    if (randomInput && i % 20 === 0) { queue.push({ at: now, kind: "lane", v: Math.floor(rng() * 3) }); if (rng() < 0.3) queue.push({ at: now, kind: "jump" }); queue.push({ at: now, kind: "duck", v: rng() < 0.3 }); }
    let jump = false;
    while (queue.length && queue[0].at <= now) { const q = queue.shift(); if (q.kind === "lane") known.lane = q.v; else if (q.kind === "duck") known.duck = q.v; else jump = true; }
    for (const e of stepRun(r, { lane: known.lane, jump, duck: known.duck }, dt)) r.sc = (r.sc ?? 0) + crunScore(e);
  }
  return r;
}

/** rt: 반응 시간, miss: 방패/검 실수 확률, swingHz: 초당 휘두르는 횟수, lat: 입력 지연, ultSkill: 필살기를 쓰는지 */
export function playDuel({ seed, rt, miss, swingHz = 1.6, lat = 0.1, secs = 60, passive = false, ult = true }) {
  const rng = mulberry(seed), d = createDuel({ rng: mulberry(seed + 5) }); const dt = 1 / 60;
  let shield = false, shieldOff = -1, shieldOnAt = null, nextSwing = 0.8; const queue = [];
  const known = { shield: false };
  for (let i = 0; i < secs * 60 && !d.over; i++) {
    const now = d.t; let swing = 0, ultIn = false;
    if (!passive) {
      const a = d.atk;
      if (a && !a.seen) { a.seen = true; a.react = now + rt * (0.8 + rng() * 0.5); a.miss = rng() < miss; }
      if (a && !a.miss && !a.done && now >= a.react) {
        const left = a.T - a.t;
        const lead = (a.kind === "melee" ? 0.45 : 0.28) + 0.1;   // 도착 직전에 올리면 패링 (플레이어는 평소 지연 0.1초에 익숙해서 그만큼 미리 올려요)
        if (left <= lead + (rng() - 0.5) * (0.08 + rt * 0.5)) {   /* 서툰 사람일수록 타이밍이 흔들려요 */ a.done = true; queue.push({ at: now + lat, v: true }); shieldOff = now + left + 0.35; }
      }
      if (shieldOff > 0 && now > shieldOff) { queue.push({ at: now + lat, v: false }); shieldOff = -1; }
      if (now >= nextSwing && (!d.atk || d.atk.kind !== "arrow")) { if (rng() > miss * 0.5) swing = rng() < 0.2 ? 2 : 1; nextSwing = now + (1 / swingHz) * (0.7 + rng() * 0.6); }
      if (ult && d.gauge >= DUEL.GAUGE_MAX && rng() < 0.05) ultIn = true;
    }
    while (queue.length && queue[0].at <= now) known.shield = queue.shift().v;
    for (const e of stepDuel(d, { swing, shield: known.shield, ult: ultIn }, dt)) d.sc = (d.sc ?? 0) + duelScore(e, d.stage);
  }
  return d;
}
