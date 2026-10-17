// 비트세이버식 슬래시 시험: node test/slash.test.js   (비교표를 보려면 --report)
// 가상의 사람이 실제와 같은 경로(AI 20Hz·잡음·지연 → 추적기 → 칼날 → 판정)로 큐브를 베거나, 아무 데나 휘두르거나, 반대로 베거나, 박자를 놓칠 때
// "예전 판정(old)"과 "새 판정(new)"이 어떻게 달라지는지 비교해요.
import assert from "node:assert/strict";
import { AlphaBeta } from "../tracker.js";
import { ArmVel } from "../armtrack.js";
import { SLASH, DIRS, newFlow, nextNotes, sweepBlade, tipDirection, judgeCut, oppositeDir } from "../slash.js";
import { mulberry } from "./bots.js";

const W = 1280, H = 720, APPROACH = 1.8, REACH = 35;
const LANES = [W * 0.18, W * 0.38, W * 0.62, W * 0.82], ROWS = [H * 0.28, H * 0.52, H * 0.74];
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// ---------- 예전 판정 (main.js 의 이전 코드를 그대로 옮김) ----------
function segHitsCircleOld(ax, ay, bx, by, cx, cy, r) {
  const sweep = Math.min(Math.hypot(bx - ax, by - ay) * 0.4, 45);
  r += REACH + sweep;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx - cx, ay + t * dy - cy) <= r;
}

/**
 * 한 판을 돌려서 큐브마다 old/new 가 벤 결과를 돌려줘요.
 * notes: [{T, hand, dir, lane, row}]  plan(note, i) → 사람의 동작 {type:"slash"|"none", dirIdx, lateral, dt, D}  또는 {type:"wave"}
 */
function simulate(notes, plan, { SW = 220, seed = 1, fps = 60, aiHz = 20, noise = 2.5, lat = 0.04, wave = null } = {}) {
  const rng = mulberry(seed), g = () => (rng() + rng() + rng() - 1.5) * 2;
  const shoulder = [[640 - SW / 2, 300], [640 + SW / 2, 300]];                       // 손 0=왼쪽(화면 왼쪽) 1=오른쪽
  const bladeDir = [[-0.3, -0.95], [0.3, -0.95]], BLADE = 170;
  // 사람의 손 경로: 각 손마다 "슬래시 구간"(칼 가운데가 큐브 중심을 지나가게) 목록
  const segs = [[], []];
  notes.forEach((n, i) => {
    const p = plan(n, i); if (!p || p.type !== "slash") return;
    const cx = LANES[n.lane], cy = ROWS[n.row], d = DIRS[p.dirIdx], D = p.D ?? 0.26, A = p.A ?? 150;
    const lat0 = p.lateral ?? 0, px = -d[1] * lat0, py = d[0] * lat0;                  // 옆으로 비껴 지나가는 정도(px)
    segs[n.hand].push({ t0: n.T + (p.dt ?? 0) - D / 2, D, from: [cx + px - d[0] * A, cy + py - d[1] * A], to: [cx + px + d[0] * A, cy + py + d[1] * A] });
  });
  if (wave) for (const h of [0, 1]) for (let t = 1; t < notes[notes.length - 1].T + 1; t += wave.every * (0.8 + rng() * 0.4)) {
    const a = rng() * Math.PI * 2, c = [W * (0.1 + 0.8 * rng()), H * (0.2 + 0.6 * rng())];
    segs[h].push({ t0: t, D: wave.D, from: [c[0] - Math.cos(a) * 150, c[1] - Math.sin(a) * 150], to: [c[0] + Math.cos(a) * 150, c[1] + Math.sin(a) * 150] });
  }
  const rest = [[W * 0.36, H * 0.95], [W * 0.64, H * 0.95]];
  for (const h of [0, 1]) segs[h].sort((x, y) => x.t0 - y.t0);
  // 손은 "슬래시 → 다음 슬래시 시작점"으로 끊김 없이 이어서 움직여요 (순간이동하면 시험이 가짜가 돼요)
  const midAt = (h, tt) => {
    const list = segs[h];
    let prevEnd = null, prevT = -1;
    for (let k = 0; k < list.length; k++) {
      const s = list[k], u = (tt - s.t0) / s.D;
      if (u >= 0 && u <= 1) { const e = ease(u); return [s.from[0] + (s.to[0] - s.from[0]) * e, s.from[1] + (s.to[1] - s.from[1]) * e]; }
      if (tt < s.t0) {                                                           // 다음 슬래시 전: 이전 끝점(또는 쉬는 자리)에서 이 시작점으로 이동
        const a0 = prevEnd ?? [rest[h][0] + bladeDir[h][0] * BLADE / 2, rest[h][1] + bladeDir[h][1] * BLADE / 2], t0 = prevEnd ? prevT : s.t0 - 2.5;
        const f = ease((tt - t0) / Math.max(0.05, s.t0 - 0.25 - t0)); return [a0[0] + (s.from[0] - a0[0]) * f, a0[1] + (s.from[1] - a0[1]) * f];   // 슬래시 시작 0.25초 전에는 시작 자리에 도착해서 기다려요
      }
      prevEnd = s.to; prevT = s.t0 + s.D;
    }
    const last = prevEnd ?? [rest[h][0] + bladeDir[h][0] * BLADE / 2, rest[h][1] + bladeDir[h][1] * BLADE / 2];
    const f = ease((tt - prevT) / 0.6), r0 = [rest[h][0] + bladeDir[h][0] * BLADE / 2, rest[h][1] + bladeDir[h][1] * BLADE / 2];
    return prevEnd ? [last[0] + (r0[0] - last[0]) * f, last[1] + (r0[1] - last[1]) * f] : r0;
  };
  const wristAt = (h, tt) => { const m = midAt(h, tt); return [m[0] - bladeDir[h][0] * BLADE / 2, m[1] - bladeDir[h][1] * BLADE / 2]; };   // 손목 = 칼 가운데에서 칼 방향 반대로 BLADE/2
  const trk = [new AlphaBeta(BODY_AB), new AlphaBeta(BODY_AB)], av = [new ArmVel(), new ArmVel()];
  const hist = [[], []], prevSab = [null, null], lastWrist = [null, null];
  const res = notes.map(() => ({ old: null, neu: null }));
  const oldCool = [-1e9, -1e9], oldSwingT = [-1e9, -1e9], newCool = [-1e9, -1e9];
  let aiNext = 0;
  const T_END = notes[notes.length - 1].T + 0.6;
  for (let i = 0; i < T_END * fps; i++) {
    const tt = i / fps, now = 1000 + tt * 1000, dt = 1 / fps;
    if (tt >= aiNext) {
      aiNext = tt + (1 / aiHz) * (0.7 + rng() * 0.6);
      for (const h of [0, 1]) {
        const w = wristAt(h, tt - lat);
        trk[h].update(w[0] + g() * noise, w[1] + g() * noise, now);
        av[h].update(now, w[0] - shoulder[h][0] + g() * noise, w[1] - shoulder[h][1] + g() * noise, g() * 18, SW);
      }
    }
    if (!trk[0].ready || !trk[1].ready) continue;
    const sab = [0, 1].map((h) => { const w = trk[h].at(now); return { bx: w.x, by: w.y, tx: w.x + bladeDir[h][0] * BLADE, ty: w.y + bladeDir[h][1] * BLADE }; });
    const spd = [0, 1].map((h) => { const w = trk[h].at(now), p = lastWrist[h] ?? w; return Math.hypot(w.x - p.x, w.y - p.y) / Math.max(0.25, dt * 60); });
    for (const h of [0, 1]) {
      hist[h].push({ t: now, x: sab[h].tx, y: sab[h].ty }); while (hist[h].length > 14 || (hist[h].length && now - hist[h][0].t > 220)) hist[h].shift();
      if (spd[h] > 7.0 && now - oldSwingT[h] > 110) oldSwingT[h] = now;
    }
    notes.forEach((n, k) => {
      const tr = n.T - tt;
      if (Math.abs(tr) > 0.3) return;
      const z = 1 - tr / APPROACH, r = Math.max(12, 16 + z * 52);
      const cx = W * 0.5 + (LANES[n.lane] - W * 0.5) * z, cy = H * 0.42 + (ROWS[n.row] - H * 0.42) * z, h = n.hand;
      // 예전
      if (res[k].old == null && z >= 0.8 && z <= 1.12 && Math.abs(tr) <= 0.16) {
        const s = sab[h], inPos = segHitsCircleOld(s.bx, s.by, s.tx, s.ty, cx, cy, r + 36) || Math.hypot(s.bx - cx, s.by - cy) < r + 42;
        const swinging = now - oldSwingT[h] < 17 || spd[h] > 6.0;
        if (inPos && swinging && now - oldCool[h] > 110) { res[k].old = { cut: true }; oldCool[h] = now; }
      }
      // 새 판정
      if (res[k].neu == null && Math.abs(tr) <= SLASH.WINDOW && z >= 0.6) {
        const sw = sweepBlade(prevSab[h], sab[h], cx, cy, r);
        if (sw.hit && now - newCool[h] > 90) {
          const j = judgeCut({ dir: n.dir, r }, { dist: sw.dist, swingN: av[h].vN(now), tipDir: tipDirection(hist[h], now), dtMs: Math.abs(tr) * 1000 });
          if (j.cut) { res[k].neu = j; newCool[h] = now; }
        }
      }
    });
    for (const h of [0, 1]) { prevSab[h] = sab[h]; const w = trk[h].at(now); lastWrist[h] = { x: w.x, y: w.y }; }
  }
  return res;
}

/** 박자(0.55초 간격 ± 흔들림)대로 큐브 N개를 흐름 규칙으로 배치 */
function makeNotes(n, seed = 1, wave = 2, gap = 0.5) {
  const rng = mulberry(seed), flow = newFlow(), out = []; let T = 2;
  for (let i = 0; i < n; i++) { T += gap + rng() * 0.25; for (const q of nextNotes(flow, rng, wave, T)) out.push({ T, ...q }); }
  return out;
}
const rate = (res, key, pred = () => true) => res.filter((r) => r[key] && r[key].cut && pred(r[key])).length / res.length;

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const report = process.argv.includes("--report");
const line = (name, o, n, extra = "") => { if (report) console.log(`${name.padEnd(38)} old ${(o * 100).toFixed(0).padStart(3)}%   new ${(n * 100).toFixed(0).padStart(3)}% ${extra}`); };

const avg = (f, seeds = [1, 2, 3, 4]) => { const acc = {}; for (const s of seeds) { const r = f(s); for (const k of Object.keys(r)) acc[k] = (acc[k] ?? 0) + r[k] / seeds.length; } return acc; };
const good = (j) => !j.bad;

// 1) 정확한 슬래시
const S1 = avg((s) => { const notes = makeNotes(40, s), r = simulate(notes, (n) => ({ type: "slash", dirIdx: n.dir ?? 0, lateral: (Math.random() - 0.5) * 0, dt: (mulberry(s * 7 + n.T * 100)() - 0.5) * 0.12 }), { seed: s }); return { o: rate(r, "old"), n: rate(r, "neu", good) }; });
line("① 정확한 슬래시(박자±60ms)", S1.o, S1.n);
t("새 판정: 방향대로 박자에 맞춰 베면 90% 이상 베어짐", () => ok(S1.n >= 0.9, `${(S1.n * 100).toFixed(0)}%`));

// 2) 작은 몸/천천히 베는 아이
const S2 = avg((s) => { const notes = makeNotes(40, s), r = simulate(notes, (n) => ({ type: "slash", dirIdx: n.dir ?? 0, dt: (mulberry(s * 11 + n.T * 100)() - 0.5) * 0.12, D: 0.5, A: 130 }), { seed: s, SW: 130 }); return { o: rate(r, "old"), n: rate(r, "neu", good) }; });
line("② 작은 몸+천천히(0.5초) 슬래시", S2.o, S2.n);
t("새 판정: 천천히 베는 아이도 80% 이상", () => ok(S2.n >= 0.8, `${(S2.n * 100).toFixed(0)}%`));

// 3) 아무 데나 막 휘두르기 (큐브와 상관없이 1초에 3번쯤)
const S3 = avg((s) => { const notes = makeNotes(40, s), r = simulate(notes, () => ({ type: "none" }), { seed: s, wave: { every: 0.33, D: 0.26 } }); return { o: rate(r, "old"), n: rate(r, "neu", good) }; });
line("③ 막 휘두르기(큐브와 상관없이)", S3.o, S3.n, " ← 낮을수록 좋아요");
t("막 휘둘러서 베어지는 큐브: 새 판정은 예전보다 훨씬 적고(절반 이하) 40% 미만", () => ok(S3.n < 0.4 && S3.n <= S3.o * 0.5, `old ${(S3.o * 100).toFixed(0)}% new ${(S3.n * 100).toFixed(0)}%`));

// 4) 반대 방향으로 베기 (화살표 있는 큐브만)
const S4 = avg((s) => { const notes = makeNotes(60, s, 3), r = simulate(notes, (n) => ({ type: "slash", dirIdx: n.dir == null ? 0 : oppositeDir(n.dir) }), { seed: s }); const idx = notes.map((n, i) => (n.dir != null ? i : -1)).filter((i) => i >= 0); const sel = idx.map((i) => r[i]); return { o: sel.filter((x) => x.old).length / sel.length, n: sel.filter((x) => x.neu && x.neu.cut && !x.neu.bad).length / sel.length, bad: sel.filter((x) => x.neu && x.neu.bad).length / sel.length }; });
line("④ 반대 방향으로 베기(화살표 큐브)", S4.o, S4.n, ` (잘못 벰으로 표시된 비율 ${(S4.bad * 100).toFixed(0)}%)`);
t("반대 방향으로 베면 대부분 '잘못 벰'으로 처리됨 (제대로 벤 것으로 세어지는 건 15% 미만)", () => ok(S4.n < 0.15 && S4.bad > 0.6, `good ${(S4.n * 100).toFixed(0)}% bad ${(S4.bad * 100).toFixed(0)}%`));

// 5) 박자가 많이 어긋남 (0.4초 늦게/일찍): 베어지면 안 돼요
const S5 = avg((s) => { const notes = makeNotes(40, s, 2, 1.4), late = simulate(notes, (n) => ({ type: "slash", dirIdx: n.dir ?? 0, dt: 0.4 }), { seed: s }), early = simulate(notes, (n) => ({ type: "slash", dirIdx: n.dir ?? 0, dt: -0.4 }), { seed: s }); const onBeat = (j) => !j.bad && j.parts.timing >= 14; return { o: (rate(late, "old") + rate(early, "old")) / 2, n: (rate(late, "neu", onBeat) + rate(early, "neu", onBeat)) / 2 }; });
line("⑤ 박자에서 0.4초 어긋남(박자 점수 받은 컷)", S5.o, S5.n, " ← 낮을수록 좋아요");
t("박자를 0.4초 놓치면 '박자 맞은 컷'으로 인정되지 않음 (10% 미만)", () => ok(S5.n < 0.1, `${(S5.n * 100).toFixed(0)}%`));

// 6) 큐브에서 많이 벗어난 베기 (옆으로 큐브 반지름의 2배쯤 비껴감)
const S6 = avg((s) => { const notes = makeNotes(40, s), r = simulate(notes, (n) => ({ type: "slash", dirIdx: n.dir ?? 0, lateral: 230 }), { seed: s }); return { o: rate(r, "old"), n: rate(r, "neu", good) }; });
line("⑥ 큐브에서 230px 비껴 베기", S6.o, S6.n, " ← 낮을수록 좋아요");
t("크게 빗나가게 베면 베어지지 않음 (새 판정 15% 미만)", () => ok(S6.n < 0.15, `${(S6.n * 100).toFixed(0)}%`));

// 7) 가만히 들고만 있기 (칼을 큐브 길목에 두고 흔들지 않음)
const S7 = avg((s) => { const notes = makeNotes(40, s), r = simulate(notes, () => ({ type: "none" }), { seed: s }); return { o: rate(r, "old"), n: rate(r, "neu") }; });
line("⑦ 가만히 들고만 있기", S7.o, S7.n);
t("가만히 있으면 베어지지 않음", () => ok(S7.n === 0, `${(S7.n * 100).toFixed(0)}%`));

// 8) 점수: 정확하고 빠를수록 높고 최대 115
t("점수는 최대 115점이고, 빠르고·방향 맞고·정확하고·박자 맞을수록 높음", () => {
  const best = judgeCut({ dir: 0, r: 60 }, { dist: 0, swingN: 9, tipDir: [0, 1], dtMs: 10 });
  assert.equal(best.total, 115);
  const slow = judgeCut({ dir: 0, r: 60 }, { dist: 20, swingN: 2, tipDir: [0.5, 0.87], dtMs: 150 });
  ok(slow.total < best.total - 30, `slow ${slow.total}`);
  ok(judgeCut({ dir: null, r: 60 }, { dist: 0, swingN: 9, tipDir: null, dtMs: 10 }).total === 115, "점(●)은 방향 점수 만점");
  ok(!judgeCut({ dir: 0, r: 60 }, { dist: 0, swingN: 1.0, tipDir: [0, 1], dtMs: 10 }).cut, "너무 느리면 안 베어짐");
  ok(judgeCut({ dir: 0, r: 60 }, { dist: 0, swingN: 5, tipDir: [0, -1], dtMs: 10 }).bad, "반대 방향은 잘못 벰");
});
// 9) 배치 흐름
t("큐브 배치: 손이 번갈아 나오고, 같은 손은 위↔아래로 왕복하며, 단계가 오를수록 화살표가 늘어남", () => {
  const rng = mulberry(5), flow = newFlow(), seq = [];
  for (let i = 0; i < 200; i++) seq.push(...nextNotes(flow, rng, 1, i * 0.6));
  let alt = 0, tot = 0; for (let i = 1; i < seq.length; i++) { if (seq[i].hand !== seq[i - 1].hand) alt++; tot++; }
  ok(alt / tot > 0.9, `교대 ${alt}/${tot}`);
  const last = [null, null]; let flip = 0, cmp = 0;
  for (const n of seq) { if (n.dir != null && last[n.hand] != null && n.dir <= 1 && last[n.hand] <= 1) { cmp++; if (n.dir !== last[n.hand]) flip++; } if (n.dir != null) last[n.hand] = n.dir; }
  ok(cmp > 20 && flip / cmp > 0.95, `위↔아래 왕복 ${flip}/${cmp}`);
  const dots = (wave) => { const r = mulberry(9), f = newFlow(); let d = 0, n = 0; for (let i = 0; i < 300; i++) for (const q of nextNotes(f, r, wave, i)) { n++; if (q.dir == null) d++; } return d / n; };
  ok(dots(1) > dots(2) && dots(2) > dots(3), `점 비율 ${dots(1).toFixed(2)} ${dots(2).toFixed(2)} ${dots(3).toFixed(2)}`);
});

console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
