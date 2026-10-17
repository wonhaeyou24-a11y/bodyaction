// 녹화 파일을 지금 게임의 판정으로 다시 돌려서 채점해요:  node test/replay.mjs 녹화파일.json   (파일을 안 주면 가짜 사람으로 연습 실행)
import fs from "node:fs";
import { replay, evaluate } from "../replay.js";
import { makeSynthRecording } from "./synth-recording.mjs";

const file = process.argv[2];
const rec = file ? JSON.parse(fs.readFileSync(file, "utf8")) : makeSynthRecording();
console.log(file ? `녹화: ${file}` : "녹화: (가짜 사람)", ` 길이 ${(rec.durationMs / 1000).toFixed(1)}초, 인식 결과 ${rec.results.length}번 (${(rec.results.length / (rec.durationMs / 1000)).toFixed(1)}Hz)`);
const { events } = replay(rec);
const count = {}; for (const e of events) count[e.type] = (count[e.type] || 0) + 1;
console.log("인식된 사건:", JSON.stringify(count));
const ev = evaluate(rec, events);
if (!ev) { console.log("(자유 녹화라서 채점은 없어요. 사건 목록:)"); for (const e of events) console.log(`  ${e.t.toFixed(2)}s ${e.type}`); process.exit(0); }
const NAME = { jump: "점프", duck: "앉기", left: "왼쪽 기울이기", right: "오른쪽 기울이기", punch: "펀치" };
console.log("\n동작별 인식률 (안내가 나온 뒤 그 칸 안에 인식됐는지)");
for (const [k, v] of Object.entries(ev.per)) if (NAME[k]) {
  const lat = v.lat.length ? `, 반응 평균 ${(v.lat.reduce((a, b) => a + b, 0) / v.lat.length).toFixed(2)}초` : "";
  console.log(`  ${NAME[k].padEnd(10)} ${v.hit}/${v.total}${lat}${v.miss.length ? `  (놓친 곳: ${v.miss.map((t) => t.toFixed(0) + "s").join(", ")})` : ""}`);
}
console.log("\n오인식 (엉뚱한 때 나온 것)");
const keys = Object.keys(ev.falseByDuring);
if (!keys.length) console.log("  없음 ✅"); else for (const k of keys) console.log(`  ${k.replace(":", " 중에 ").padEnd(24)} ${ev.falseByDuring[k]}번`);
