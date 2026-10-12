// 캐릭터 게임 "입력 파이프라인" 시뮬레이션: node test/charpipeline.test.js
// 사람 몸 움직임(기울이기·점프·웅크리기·검 휘두르기·방패 올리기)을 합성해서, 실제와 같은 경로
//   AI 결과(약 20Hz, 잡음, 40ms 지연, 가끔 놓침) → 알파-베타 추적기 → jump.js / lane.js / armtrack.js+punch.js → 게임 규칙(crun-core / duel-core)
// 로 흘려 보내고, 여러 방향(거리·속도·잡음·몸 사라짐·프레임레이트)에서 문제가 없는지 확인해요.
import { AlphaBeta } from "../tracker.js";
import { jumpSample, newJumpState, stepJump } from "../jump.js";
import { newLaneState, stepLane } from "../lane.js";
import { ArmVel } from "../armtrack.js";
import { newPunchState, stepPunchN } from "../punch.js";
import { skeletonFromBody } from "../character.js";
import { CRUN, createRun, stepRun } from "../crun-core.js";
import { DUEL, createDuel, stepDuel } from "../duel-core.js";
import { mulberry } from "./bots.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };

/** 가상의 사람: 시간 tt에서의 "진짜" 몸 (화면 px). U=몸통 길이, 스크립트가 만드는 값들(lean, jumpH, crouch, rightArm, leftUp)을 반영 */
class Human {
  constructor({ U = 200, cx = 640, cy = 360 } = {}) { this.U = U; this.cx = cx; this.cy = cy; this.a = { lean: () => 0, jump: () => 0, crouch: () => 0, swing: () => 0, shield: () => 0 }; }
  at(tt) {
    const { U } = this, a = this.a, lean = a.lean(tt) * U * 0.67, up = a.jump(tt) * U, cr = a.crouch(tt) * U * 0.45;     // lean은 어깨너비(0.67U) 단위
    const sw = 0.67 * U, sx = this.cx + lean, sy = this.cy - up + cr, hy = sy + U - cr * 0.4;
    const P = {};
    P[11] = [sx - sw / 2, sy]; P[12] = [sx + sw / 2, sy]; P[23] = [sx - sw * 0.3, hy]; P[24] = [sx + sw * 0.3, hy];
    P[0] = [sx, sy - U * 0.5 + cr * 0.2];
    P[13] = [P[11][0] - sw * 0.1, sy + U * 0.55]; P[15] = [P[11][0] - sw * 0.12, sy + U * 1.05 - a.shield(tt) * U * 0.95];                    // 왼손: shield 0→1 이면 어깨 높이까지 올림
    const sg = a.swing(tt);                                                                                                                  // 오른손: sg 0→1→0 이면 휘두름(앞으로 뻗음)
    P[14] = [P[12][0] + sw * 0.1 + sg * sw * 0.2, sy + U * 0.55 - sg * U * 0.2]; P[16] = [P[12][0] + sw * 0.12 + sg * sw * 0.5, sy + U * 1.05 - sg * U * 0.7];
    const zr = -sg * U * 0.9;                                                                                                                // 깊이(z): 앞으로 뻗으면 카메라 쪽(+px 환산)
    P[25] = [P[23][0], hy + U * 0.85 + cr * 0.4]; P[26] = [P[24][0], hy + U * 0.85 + cr * 0.4]; P[27] = [P[23][0], hy + U * 1.65 + cr * 0.2]; P[28] = [P[24][0], hy + U * 1.65 + cr * 0.2];
    return { P, zr };
  }
}
/** 입력 파이프라인: Human → AI(잡음/지연/놓침) → 추적기 → 입력 {lane, jump, duck, swing, shield, ult} */
class Pipeline {
  constructor(human, { aiHz = 20, noise = 2.5, zNoise = 18, drop = 0, seed = 1, lat = 0.04 } = {}) {
    Object.assign(this, { human, aiHz, noise, zNoise, drop, lat }); this.rng = mulberry(seed); this.aiNext = 0; this.trk = {}; this.arm = new ArmVel(); this.js = newJumpState(); this.ls = newLaneState(); this.fsm = newPunchState();
    this.lost = 0; this.have = false; this.sUp = false;
  }
  step(tt, dt) {
    const now = 1000 + tt * 1000, rng = this.rng, H = this.human;
    if (tt >= this.aiNext) {
      this.aiNext = tt + (1 / this.aiHz) * (0.7 + rng() * 0.6);
      if (this.lost > 0 || rng() < this.drop) { if (this.lost <= 0) this.lost = 0.4 + rng() * 0.4; }
      if (this.lost > 0) { this.lost -= 1 / this.aiHz; if (this.lost > 0) return this.idleInput(); }
      const { P, zr } = H.at(tt - this.lat), g = () => (rng() + rng() + rng() - 1.5) * 2;
      for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { (this.trk[i] ??= new AlphaBeta(BODY_AB)).update(P[i][0] + g() * this.noise, P[i][1] + g() * this.noise, now); }
      const sw = Math.hypot(P[11][0] - P[12][0], P[11][1] - P[12][1]);
      this.arm.update(now, P[16][0] - P[12][0] + g() * this.noise, P[16][1] - P[12][1] + g() * this.noise, zr + g() * this.zNoise, sw); this.have = true;
    }
    if (!this.have) return this.idleInput();
    const b = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    for (const i of Object.keys(this.trk)) { const p = this.trk[i].at(now); b[i] = { x: p.x, y: p.y, v: 0.9 }; }
    const sk = skeletonFromBody(b); if (!sk) return this.idleInput();
    const sw = Math.hypot(sk.rs[0] - sk.ls[0], sk.rs[1] - sk.ls[1]);
    const vx = ((this.trk[11].vx + this.trk[12].vx) / 2) * 1000 / sw;        // 어깨 중심 가로 속도(어깨너비/초)
    const lane = stepLane(this.ls, ((sk.ls[0] + sk.rs[0]) / 2) / sw, dt, vx) + 1;
    const sm = jumpSample(b), jr = sm ? stepJump(this.js, sm, dt, now) : { jump: false, duck: false };
    const hit = stepPunchN(this.fsm, this.arm.vN(now), dt, undefined, this.arm.dir(now));
    const dyL = (sk.lw[1] - sk.ls[1]) / sk.u; this.sUp = this.sUp ? dyL < 0.6 : dyL < 0.32;
    return { lane, jump: jr.jump, duck: jr.duck, swing: hit.strike ? hit.intensity : 0, shield: this.sUp };
  }
  idleInput() { return { lane: this.ls.lane + 1, jump: false, duck: false, swing: 0, shield: false }; }
}

// ---------- 러너: 사람 움직임으로 장애물 피하기 ----------
/** 똑똑한 사람 흉내: 앞 장애물을 보고 반응 시간 뒤에 몸을 움직임. 반환: 맞은 횟수, 잡음 */
function runnerSession({ seed, U = 200, aiHz = 20, noise = 2.5, drop = 0, rt = 0.3, secs = 60, ideal = false }) {
  const rng = mulberry(seed), run = createRun({ rng: mulberry(seed + 9) }), human = new Human({ U }), pipe = new Pipeline(human, { aiHz, noise, seed: seed + 3, drop });
  const A = { lean: 0, leanFrom: 0, leanT0: -9, jumpT0: -9, jumpH: 0, duckUntil: -9, duckT0: -9 };
  human.a.lean = (tt) => A.leanFrom + (A.lean - A.leanFrom) * ease((tt - A.leanT0) / 0.3);
  human.a.jump = (tt) => { const u = (tt - A.jumpT0) / 0.5; return u > 0 && u < 1 ? 4 * A.jumpH * u * (1 - u) : 0; };
  human.a.crouch = (tt) => (tt < A.duckUntil ? ease((tt - A.duckT0) / 0.25) : Math.max(0, 1 - ease((tt - A.duckUntil) / 0.3)) * (tt < A.duckUntil + 0.3 ? 1 : 0));
  const dt = 1 / 60; let cur = 1, plan = null, reactAt = 0, jumps = 0, falsePos = 0;
  for (let i = 0; i < secs * 60 && !run.over; i++) {
    const tt = run.t;
    if (!ideal) {
      // 사람은 앞을 미리 봐요: 지금 지나가는 줄(C)을 먼저 해결하고, 가능하면 그다음 줄(N)에도 맞는 길로 미리 옮겨 둬요
      const live = run.obs.filter((o) => !o.done && o.d > -0.5).sort((a, b) => a.d - b.d);
      const groups = []; for (const o of live) { const g = groups[groups.length - 1]; if (g && o.d - g[0].d < 0.6) g.push(o); else groups.push([o]); }
      const C = groups[0], N = groups[1];
      if (C) {
        const respOf = (g) => { const r = ["free", "free", "free"]; for (const o of g) r[o.lane] = o.type === "low" ? "jump" : o.type === "high" ? "slide" : "none"; return r; };
        const rc = respOf(C), rn = N ? respOf(N) : null, taC = C[0].d / run.speed;
        const okC = [0, 1, 2].filter((l) => rc[l] !== "none"), okBoth = rn ? okC.filter((l) => rn[l] !== "none") : okC;
        const cost = (l) => Math.abs(l - cur) + (rc[l] === "free" ? 0 : 1);         // 가능하면 장애물 없는 길 (넘거나 숙이는 것보다 편해서)
        const pool = okBoth.length ? okBoth : okC; const want = pool.length ? pool.reduce((b, l) => (cost(l) < cost(b) ? l : b), pool[0]) : cur;
        if (taC < 0.35 && rc[cur] === "none") { /* 이미 늦음 */ }
        else if (want !== cur) { if (plan?.to !== want) plan = { to: want, at: tt + rt * (0.8 + rng() * 0.5) }; if (tt >= plan.at && !(taC > -0.05 && taC < 0.3 && rc[want] === "none")) { cur = want; plan = null; A.leanFrom = A.lean; A.lean = (cur - 1) * 0.9; A.leanT0 = tt; } }
        else plan = null;
        if (rc[cur] === "jump" && taC < 0.46 && !C[0].jumped) { C.forEach((o) => (o.jumped = true)); A.jumpT0 = tt; A.jumpH = 0.34; jumps++; }
        if (rc[cur] === "slide" && taC < 0.5 && !C[0].slid) { C.forEach((o) => (o.slid = true)); A.duckT0 = tt; A.duckUntil = tt + taC + 0.2; }
      }
    }
    const inp = ideal ? { lane: 1, jump: false, duck: false } : pipe.step(tt, dt);
    stepRun(run, { lane: inp.lane, jump: inp.jump, duck: inp.duck }, dt);
  }
  return { run, jumps, over: run.over };
}
const many = (fn, opts, n = 30) => Array.from({ length: n }, (_, s) => fn({ ...opts, seed: s + 1 }));
const sumHits = (rs) => rs.reduce((a, r) => a + r.run.hits, 0) / rs.length;

t("러너: 사람 움직임이 파이프라인을 거쳐도 평균 맞은 횟수가 적음 (60초, 몸통 200px, 반응 0.3초) — 30판 평균 ≤ 0.6번, 생존 28판 이상", () => {
  const rs = many(runnerSession, { rt: 0.3 }); const h = sumHits(rs); const alive = rs.filter((r) => !r.over).length; ok(h <= 0.6 && alive >= 28, `평균 ${h.toFixed(2)} 생존 ${alive}/30`);
});
t("러너: 카메라와의 거리가 달라도(몸통 120~320px) 비슷한 성능 (가까운 것 ≤ 먼 것 + 1.5번)", () => {
  const near = sumHits(many(runnerSession, { rt: 0.3, U: 320 }, 24)), far = sumHits(many(runnerSession, { rt: 0.3, U: 120, noise: 1.5 }, 24)); ok(near <= far + 1 && far <= near + 1 && far <= 1.2, `가까움 ${near.toFixed(2)} / 멂 ${far.toFixed(2)}`);
});
t("러너: AI가 느린 PC(초당 12회)·잡음 큼(5px)·몸이 가끔 사라짐(20초에 한 번, 0.5초)에서도 70% 이상 완주 (30판)", () => {
  const rs = many(runnerSession, { rt: 0.3, aiHz: 12, noise: 5, drop: 0.004 }, 30); const alive = rs.filter((r) => !r.over).length; ok(alive >= 21, `생존 ${alive}/30`);
});
t("러너: 가만히 서 있는 사람은 점프/길 바꾸기가 한 번도 오인식되지 않음 (60초 ×10판)", () => {
  for (let s = 0; s < 10; s++) {
    const h = new Human({}), p = new Pipeline(h, { seed: s + 1, noise: 3, drop: 0.01 }); let jumps = 0, lanes = new Set(), ducks = 0;
    for (let i = 0; i < 3600; i++) { const r = p.step(i / 60, 1 / 60); if (r.jump) jumps++; if (r.duck) ducks++; lanes.add(r.lane); }
    ok(jumps === 0 && ducks === 0 && lanes.size === 1, `판${s}: 점프 ${jumps} 웅크림 ${ducks} 길 ${[...lanes]}`);
  }
});
t("러너: 몸이 사라졌다 돌아와도 갑자기 점프/길 바꾸기가 튀지 않음", () => {
  const h = new Human({}), p = new Pipeline(h, { seed: 5, drop: 0.05, noise: 2 }); let bad = 0;
  for (let i = 0; i < 3600; i++) { const r = p.step(i / 60, 1 / 60); if (r.jump || r.lane !== 1) bad++; } ok(bad === 0, "튄 횟수 " + bad);
});

// ---------- 검 & 방패: 사람 움직임으로 싸우기 ----------
function duelSession({ seed, U = 200, aiHz = 20, noise = 2.5, zNoise = 18, rt = 0.3, hz = 1.0, secs = 60, shieldLead = 0.3 }) {
  const rng = mulberry(seed), d = createDuel({ rng: mulberry(seed + 9) }), human = new Human({ U }), pipe = new Pipeline(human, { aiHz, noise, zNoise, seed: seed + 3 });
  const A = { swingT0: -9, shieldOn: false, shieldT0: -9, shieldOff: -9 };
  human.a.swing = (tt) => { const u = (tt - A.swingT0) / 0.38; return u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 0.8 : 0; };      // 0.38초에 뻗었다 돌아옴
  human.a.shield = (tt) => (tt >= A.shieldT0 && tt < A.shieldOff ? ease((tt - A.shieldT0) / 0.22) : tt >= A.shieldOff ? Math.max(0, 1 - ease((tt - A.shieldOff) / 0.25)) : 0);
  const dt = 1 / 60; let nextSwing = 1, swingsMade = 0, swingsSeen = 0, shieldsMade = 0, shieldsSeen = 0, up = false;
  for (let i = 0; i < secs * 60 && !d.over; i++) {
    const tt = d.t, a = d.atk;
    if (a && !a.seen) { a.seen = true; a.react = tt + rt * (0.8 + rng() * 0.5); }
    if (a && !a.done && tt >= a.react && a.T - a.t <= shieldLead + 0.22 + (rng() - 0.5) * 0.1) { a.done = true; A.shieldT0 = tt; A.shieldOff = tt + (a.T - a.t) + 0.4; shieldsMade++; }
    if (tt >= nextSwing && (!a || a.kind !== "arrow" || a.T - a.t > 0.5)) { A.swingT0 = tt; nextSwing = tt + 1 / hz * (0.8 + rng() * 0.4); swingsMade++; }
    const inp = pipe.step(tt, dt);
    if (inp.swing > 0) swingsSeen++; if (inp.shield && !up) shieldsSeen++; up = inp.shield;
    stepDuel(d, { swing: inp.swing, shield: inp.shield, ult: false }, dt);
  }
  return { d, swingsMade, swingsSeen, shieldsMade, shieldsSeen };
}
const avg = (a, f) => a.reduce((x, y) => x + f(y), 0) / a.length;
t("검: 사람이 휘두른 팔을 85% 이상 인식하고(실제 휘두름 대비), 헛인식은 15% 이하 (30판)", () => {
  const rs = many(duelSession, {}, 30); const made = avg(rs, (r) => r.swingsMade), seen = avg(rs, (r) => r.swingsSeen); ok(seen >= made * 0.85 && seen <= made * 1.15, `휘두름 ${made.toFixed(1)} / 인식 ${seen.toFixed(1)}`);
});
t("방패: 왼손 올리기를 90% 이상 인식 (30판)", () => {
  const rs = many(duelSession, {}, 30); const made = avg(rs, (r) => r.shieldsMade), seen = avg(rs, (r) => r.shieldsSeen); ok(seen >= made * 0.9, `올림 ${made.toFixed(1)} / 인식 ${seen.toFixed(1)}`);
});
t("배틀: 사람 움직임으로 막고(막기+패링) 휘둘러서 2마리 이상 쓰러뜨리고 대부분 살아남음 (60초, 30판)", () => {
  const rs = many(duelSession, { hz: 1.0 }, 30); const kills = avg(rs, (r) => r.d.kills), alive = rs.filter((r) => !r.d.over).length, blocked = avg(rs, (r) => r.d.blocks + r.d.parries), hit = avg(rs, (r) => r.d.hits);
  ok(kills >= 2 && alive >= 20 && blocked > hit, `처치 ${kills.toFixed(1)} 생존 ${alive}/30 막음 ${blocked.toFixed(1)} 맞음 ${hit.toFixed(1)}`);
});
t("배틀: 거리(몸통 120~320px)·AI 속도(12Hz)·깊이 잡음(40px)이 달라도 인식이 무너지지 않음", () => {
  for (const o of [{ U: 120 }, { U: 320 }, { aiHz: 12 }, { zNoise: 40 }]) { const rs = many(duelSession, o, 16); const made = avg(rs, (r) => r.swingsMade), seen = avg(rs, (r) => r.swingsSeen); ok(seen >= made * 0.7 && seen <= made * 1.3, `${JSON.stringify(o)}: ${made.toFixed(1)} / ${seen.toFixed(1)}`); }
});
t("배틀: 가만히 서 있으면 검/방패 헛인식이 없음 (60초 ×10판)", () => {
  for (let s = 0; s < 10; s++) { const h = new Human({}), p = new Pipeline(h, { seed: s + 1, noise: 3, zNoise: 25 }); let sw = 0, sh = 0; for (let i = 0; i < 3600; i++) { const r = p.step(i / 60, 1 / 60); if (r.swing) sw++; if (r.shield) sh++; } ok(sw === 0 && sh === 0, `판${s}: 검 ${sw} 방패 ${sh}`); }
});
t("배틀: 늦게 반응하는 사람(반응 0.5초)도 방패로 막기 ≥ 맞기", () => {
  const rs = many(duelSession, { rt: 0.5 }, 24); const blocked = avg(rs, (r) => r.d.blocks + r.d.parries), hit = avg(rs, (r) => r.d.hits); ok(blocked >= hit, `막음 ${blocked.toFixed(1)} 맞음 ${hit.toFixed(1)}`);
});

console.log(`캐릭터 게임 입력 파이프라인: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
