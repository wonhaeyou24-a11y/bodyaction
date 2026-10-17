// 녹화한 몸 움직임을 게임과 똑같은 처리(추적기 → 점프/앉기/기울이기/펀치 판정)로 다시 돌려서, 어떤 동작이 언제 인식됐는지 알려 줘요.
// 화면을 모르는 순수 코드라서 Node에서 돌려요:  node test/replay.mjs 녹화파일.json
import { AlphaBeta } from "./tracker.js";
import { ArmVel } from "./armtrack.js";
import { jumpSample, newJumpState, stepJump } from "./jump.js";
import { newLaneState, stepLane } from "./lane.js";
import { newPunchState, stepPunchN } from "./punch.js";

const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };   // main.js 와 같은 값
const ARM_JOINTS = [[16, 12], [15, 11]], LEG_JOINTS = [[27, 23], [28, 24]];

/** 영상 좌표(0~1) → 화면 픽셀 (main.js videoToScreen 과 같은 계산) */
function toScreen(m, lm) {
  const s = Math.max(m.W / m.vw, m.H / m.vh);
  const ox = (m.W - m.vw * s) / 2, oy = (m.H - m.vh * s) / 2;
  const rawX = lm.x * m.vw * s + ox;
  return { x: m.mirror ? m.W - rawX : rawX, y: lm.y * m.vh * s + oy };
}

/**
 * 녹화를 60fps 화면 프레임으로 다시 돌려요.
 * @returns {{events: {t:number, type:string, hand?:number}[], frames:number}}  t: 녹화 시작부터의 초
 */
export function replay(rec, { fps = 60 } = {}) {
  const m = rec.meta, J = rec.joints;
  const tracks = Array.from({ length: 33 }, () => new AlphaBeta(BODY_AB)), vis = new Array(33).fill(0);
  const armVel = [new ArmVel(), new ArmVel()], legVel = [new ArmVel(), new ArmVel()];
  const js = newJumpState(), ls = newLaneState();
  const fists = [newPunchState(), newPunchState()];
  const events = [];
  const res = rec.results;
  if (!res.length) return { events, frames: 0 };
  const zScale = Math.abs(toScreen(m, { x: 1, y: 0 }).x - toScreen(m, { x: 0, y: 0 }).x);
  const lmOf = (row) => { const lm = new Array(33).fill(null); J.forEach((j, k) => { const p = row[k + 1]; if (p) lm[j] = { x: p[0], y: p[1], z: p[2], visibility: p[3] }; }); return lm; };
  const seen = new Array(33).fill(false);
  let ri = 0, lastResT = -1e9, duckPrev = false, lanePrev = 0, frames = 0;
  const dt = 1 / fps, endMs = (rec.durationMs ?? res[res.length - 1][0]) + 200;
  for (let tMs = res[0][0]; tMs <= endMs; tMs += 1000 / fps) {
    frames++;
    while (ri < res.length && res[ri][0] <= tMs) {                          // 이 프레임까지 도착한 인식 결과를 먹여요 (main.js 의 인식 결과 처리와 같은 순서)
      const row = res[ri++], t0 = row[0], lm = lmOf(row);
      lastResT = t0;
      // 팔·다리 속도 (feedArmVel)
      const ok = (i) => lm[i] && (lm[i].visibility ?? 1) >= 0.3;
      const feed = (trk, [j, base]) => {
        if (!ok(j) || !ok(base)) return;
        const a = toScreen(m, lm[j]), b = toScreen(m, lm[base]);
        const sw = ok(11) && ok(12) ? Math.hypot(toScreen(m, lm[11]).x - toScreen(m, lm[12]).x, toScreen(m, lm[11]).y - toScreen(m, lm[12]).y) : 0;
        if (!(sw > 20)) return;
        trk.update(t0, a.x - b.x, a.y - b.y, ((lm[j].z ?? 0) - (lm[base].z ?? 0)) * zScale, sw);
      };
      ARM_JOINTS.forEach((jb, i) => feed(armVel[i], jb)); LEG_JOINTS.forEach((jb, i) => feed(legVel[i], jb));
      for (let i = 0; i < 33; i++) if (lm[i]) { const p = toScreen(m, lm[i]); tracks[i].update(p.x, p.y, t0); vis[i] = lm[i].visibility ?? 1; seen[i] = true; }
    }
    if (tMs - lastResT > 700) continue;                                     // 몸이 사라진 동안은 판정 없음 (main.js 도 700ms 뒤 몸을 지워요)
    const body = Array.from({ length: 33 }, (_, i) => (seen[i] && tracks[i].ready ? { ...tracks[i].at(tMs), v: vis[i] } : { x: 0, y: 0, v: 0 }));
    const t = tMs / 1000;
    // 점프·앉기 (jump.js)
    const sm = jumpSample(body);
    if (sm) {
      const r = stepJump(js, sm, dt, tMs);
      if (r.jump) events.push({ t, type: "jump" });
      if (r.duck !== duckPrev) { events.push({ t, type: r.duck ? "duckOn" : "duckOff" }); duckPrev = r.duck; }
    }
    // 좌우 기울이기 (lane.js, 러너 게임과 같은 입력)
    if (body[11].v > 0.3 && body[12].v > 0.3) {
      const sw = Math.hypot(body[12].x - body[11].x, body[12].y - body[11].y) || 80;
      const vx = ((tracks[11].vx ?? 0) + (tracks[12].vx ?? 0)) / 2 * 1000 / sw;
      const lane = stepLane(ls, ((body[11].x + body[12].x) / 2) / sw, dt, vx);
      if (lane !== lanePrev) { events.push({ t, type: lane < 0 ? "laneL" : lane > 0 ? "laneR" : "laneC" }); lanePrev = lane; }
    }
    // 펀치·발차기 (armtrack.js + punch.js, 샌드백과 같은 입력). 팔 속도는 인식 결과가 올 때만 갱신되고 프레임마다 읽어요
    for (let i = 0; i < 2; i++) {
      const h = stepPunchN(fists[i], armVel[i].vN(tMs), dt, undefined, armVel[i].dir(tMs));
      if (h.strike) events.push({ t, type: "punch", hand: i });
    }
  }
  return { events, frames };
}

// ---------- 채점 ----------
const WANT = { jump: ["jump"], duck: ["duckOn"], left: ["laneL"], right: ["laneR"], punch: ["punch"] };
const BAD_IN = {           // 이 안내 칸 안에서 나오면 안 되는 사건 (오인식)
  still: ["jump", "duckOn", "laneL", "laneR", "punch"],
  walk: ["jump", "duckOn", "laneL", "laneR", "punch"],
  setup: [],
  jump: ["laneL", "laneR", "punch"],            // 점프하다가 몸이 옆으로 가거나 펀치로 보이면 안 돼요 (웅크림→앉기는 허용)
  duck: ["jump", "laneL", "laneR", "punch"],    // 일어서면서 점프로 오인하면 안 돼요
  left: ["jump", "duckOn", "laneR", "punch"],
  right: ["jump", "duckOn", "laneL", "punch"],
  punch: ["jump", "duckOn", "laneL", "laneR"],
};

/** 안내 순서(rec.script)가 있는 녹화를 채점해요: 동작별 인식률, 반응 시간, 오인식 */
export function evaluate(rec, events) {
  const script = rec.script;
  if (!script) return null;
  const per = {}, falses = [];
  const used = new Set();
  for (const seg of script) {
    const want = WANT[seg.type];
    const inWin = events.map((e, idx) => ({ e, idx })).filter(({ e }) => e.t >= seg.start && e.t <= seg.end + 0.3);
    per[seg.type] ??= { total: 0, hit: 0, lat: [], miss: [] };
    if (want) {
      per[seg.type].total++;
      const hit = inWin.find(({ e }) => want.includes(e.type));
      if (hit) { per[seg.type].hit++; per[seg.type].lat.push(hit.e.t - seg.start); used.add(hit.idx); } else per[seg.type].miss.push(seg.start);
    }
    for (const { e, idx } of inWin) if ((BAD_IN[seg.type] || []).includes(e.type) && !used.has(idx)) falses.push({ t: e.t, type: e.type, during: seg.type, segStart: seg.start });
  }
  const falseByDuring = {};
  for (const f of falses) { const k = `${f.during}:${f.type}`; falseByDuring[k] = (falseByDuring[k] || 0) + 1; }
  return { per, falses, falseByDuring };
}
