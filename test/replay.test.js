// 녹화·재생 도구 시험: 가짜 사람 녹화를 만들어 → 파일 모양이 맞고 → 다시 돌렸을 때 동작이 대부분 인식되는지 확인해요.
import assert from "node:assert/strict";
import { makeSynthRecording } from "./synth-recording.mjs";
import { replay, evaluate } from "../replay.js";
import { buildScript, JOINTS } from "../recorder.js";

const tests = [];
const test = (n, f) => tests.push([n, f]);

test("안내 순서에 모든 동작이 들어 있고 시간이 이어짐", () => {
  const s = buildScript();
  for (const t of ["setup", "still", "jump", "duck", "left", "right", "punch", "walk", "done"]) assert.ok(s.some((x) => x.type === t), t);
  for (let i = 1; i < s.length; i++) assert.equal(s[i].start, s[i - 1].end);
  assert.ok(s[s.length - 1].end > 60 && s[s.length - 1].end < 140);
});
test("녹화 파일 모양: 관절 15개 × [x,y,z,신뢰도], JSON으로 저장·복원 가능", () => {
  const rec = JSON.parse(JSON.stringify(makeSynthRecording({ seed: 7 })));
  assert.equal(rec.joints.length, JOINTS.length);
  const row = rec.results[10];
  assert.equal(row.length, JOINTS.length + 1);
  assert.ok(Number.isFinite(row[0]) && row[1].length === 4);
  assert.ok(rec.results.length / (rec.durationMs / 1000) > 15, "인식 결과가 초당 15번 이상");
});
test("재생: 점프·앉기·기울이기·펀치가 80% 이상 인식됨 (가짜 사람 4명, 반응 속도 다양)", () => {
  const tot = {};
  for (const [seed, react] of [[1, 0.4], [2, 0.6], [3, 0.5], [4, 0.8]]) {
    const rec = makeSynthRecording({ seed, react }), ev = evaluate(rec, replay(rec).events);
    for (const [k, v] of Object.entries(ev.per)) { tot[k] ??= { hit: 0, total: 0 }; tot[k].hit += v.hit; tot[k].total += v.total; }
  }
  for (const k of ["jump", "duck", "left", "right", "punch"]) assert.ok(tot[k].hit / tot[k].total >= 0.8, `${k} ${tot[k].hit}/${tot[k].total}`);
});
test("재생: 가만히 서 있거나 앉았다 일어설 때는 점프·펀치로 오인하지 않음", () => {
  for (const seed of [1, 2, 3, 4]) {
    const rec = makeSynthRecording({ seed }), ev = evaluate(rec, replay(rec).events);
    for (const k of Object.keys(ev.falseByDuring)) assert.ok(!/^(still|duck):/.test(k), `seed ${seed}: ${k}`);
  }
});
test("몸이 안 보이면 사건이 없음 (인식 결과가 끊긴 뒤 0.7초가 지나면)", () => {
  const rec = makeSynthRecording({ seed: 1 });
  rec.results = rec.results.filter((r) => r[0] < 6000);   // 6초 이후 결과 없음
  const { events } = replay(rec);
  assert.ok(events.every((e) => e.t < 7), "사라진 뒤에도 사건이 나왔어요");
});
test("가려진 관절(null)이 있어도 멈추지 않음", () => {
  const rec = makeSynthRecording({ seed: 2 });
  rec.results.forEach((r, i) => { if (i % 5 === 0) for (let k = 6; k <= 10; k++) r[k] = null; });
  assert.doesNotThrow(() => replay(rec));
});

let failed = 0;
for (const [n, f] of tests) { try { f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", e.message.split("\n")[0]); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
