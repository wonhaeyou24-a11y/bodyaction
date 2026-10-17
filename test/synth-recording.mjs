// 안내 순서(buildScript)에 따라 "사람이 움직인 것처럼" 가짜 녹화를 만들어요 (녹화/재생 도구 시험용). 실제 녹화와 같은 파일 모양이에요.
import { buildScript, JOINTS } from "../recorder.js";

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export function makeSynthRecording({ seed = 1, react = 0.5, noise = 0.003, aiHz = 20, scale = 1 } = {}) {
  const rng = mulberry(seed), script = buildScript();
  const meta = { W: 1280, H: 720, vw: 640, vh: 480, mirror: true, fps: 60 };
  const dur = script[script.length - 1].end;
  // 동작 목록: 안내가 시작되고 react(+흔들림)초 뒤에 사람이 움직이기 시작
  const acts = [];
  for (const s of script) { const a = { ...s, t0: s.start + react * (0.7 + rng() * 0.6) }; if (s.type === "punch") a.hand = /오른손/.test(s.say) ? 16 : 15; acts.push(a); }
  const pose = (t) => {
    let dx = 0, dy = 0, wr = { 15: [0, 0, 0], 16: [0, 0, 0] };
    for (const a of acts) {
      const u = t - a.t0;
      if (a.type === "jump" && u > 0 && u < 0.5) dy -= 4 * 0.12 * scale * (u / 0.5) * (1 - u / 0.5);
      if (a.type === "duck") dy += 0.15 * scale * (ease(u / 0.3) - ease((u - 1.3) / 0.3));
      if (a.type === "left") dx += 0.12 * scale * (ease(u / 0.35) - ease((u - 1.4) / 0.4));
      if (a.type === "right") dx -= 0.12 * scale * (ease(u / 0.35) - ease((u - 1.4) / 0.4));
      if (a.type === "punch" && u > 0) { const f = u < 0.12 ? u / 0.12 : u < 0.22 ? 1 : Math.max(0, 1 - (u - 0.22) / 0.25); wr[a.hand] = [f, -f, -f]; }
      if (a.type === "walk" && u > -a.t0 + a.start) { const v = t - a.start; if (v > 0 && v < a.end - a.start) { dy += 0.012 * Math.sin(v * 2 * Math.PI * 1.8); dx += 0.008 * Math.sin(v * 2 * Math.PI * 0.9); } }
    }
    return { dx, dy, wr };
  };
  const results = []; let t = 0.05;
  while (t < dur) {
    const { dx, dy, wr } = pose(t), cx = 0.5 + dx, sy = 0.35 + dy, n = () => (rng() - 0.5) * 2 * noise;
    const P = {
      0: [cx, sy - 0.16, 0], 7: [cx + 0.03, sy - 0.16, 0], 8: [cx - 0.03, sy - 0.16, 0],
      11: [cx + 0.1, sy, 0], 12: [cx - 0.1, sy, 0], 13: [cx + 0.11, sy + 0.17, 0], 14: [cx - 0.11, sy + 0.17, 0],
      15: [cx + 0.11 + 0.22 * wr[15][0], sy + 0.33 - 0.28 * wr[15][0], wr[15][2] * 0.25], 16: [cx - 0.11 - 0.22 * wr[16][0], sy + 0.33 - 0.28 * wr[16][0], wr[16][2] * 0.25],
      23: [cx + 0.06, sy + 0.33, 0], 24: [cx - 0.06, sy + 0.33, 0], 25: [cx + 0.06, sy + 0.61, 0], 26: [cx - 0.06, sy + 0.61, 0], 27: [cx + 0.06, sy + 0.89, 0], 28: [cx - 0.06, sy + 0.89, 0],
    };
    const row = [Math.round(t * 1000)];
    for (const j of JOINTS) { const p = P[j]; row.push([+(p[0] + n()).toFixed(4), +(p[1] + n()).toFixed(4), +(p[2] + n() * 0.5).toFixed(3), 0.95]); }
    results.push(row);
    t += (1 / aiHz) * (0.7 + rng() * 0.6);
  }
  return { version: 1, app: "kinetic-kaboom", startedAt: "synthetic", meta, script, joints: JOINTS, results, marks: [], durationMs: Math.round(dur * 1000) };
}
