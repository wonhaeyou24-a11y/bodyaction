// 녹화 파일을 지금 게임의 판정으로 다시 돌려서 채점해요:  node test/replay.mjs 녹화파일.json   (파일을 안 주면 가짜 사람으로 연습 실행)
import fs from "node:fs";
import { replay, evaluate, analyzeHand } from "../replay.js";
import { makeSynthRecording } from "./synth-recording.mjs";

const file = process.argv[2];
const rec = file ? JSON.parse(fs.readFileSync(file, "utf8")) : makeSynthRecording();
console.log(file ? `녹화: ${file}` : "녹화: (가짜 사람)", ` 길이 ${(rec.durationMs / 1000).toFixed(1)}초, 인식 결과 ${rec.results.length}번 (${(rec.results.length / (rec.durationMs / 1000)).toFixed(1)}Hz)`);
if (rec.meta?.kind === "hand" || (rec.handResults?.length && !rec.results?.length)) {
  const h = analyzeHand(rec), NAME = { setup: "준비", hold: "가만히", slow: "천천히", fast: "빠르게", circle: "원 그리기", two: "두 손", hide: "손 내리기", show: "손 올리기", fist: "주먹", done: "끝", other: "기타" };
  if (rec.meta?.stats) console.log("인식 상태:", JSON.stringify(rec.meta.stats));
  if (h.ai) console.log(`AI 인식: 초당 ${h.ai.rate.toFixed(1)}번 · 결과 간격 중간 ${h.ai.gapP50}ms / 느린 10% ${h.ai.gapP90}ms / 최대 ${h.ai.gapMax}ms · 손이 안 잡힌 결과 ${(h.ai.noHand * 100).toFixed(0)}%`);
  console.log("\n구간별 화면 속 손 (실제로 그려진 위치)");
  for (const [k, v] of Object.entries(h.segs)) { if (v.frames < 5) continue; console.log(`  ${NAME[k] ?? k}`.padEnd(14), `프레임 ${String(v.frames).padStart(4)} · 순간이동 ${v.tele}번 · 굳었다 튀기 ${v.stalls || 0}번${v.stalls ? `(평균 ${Math.round(v.stallMs / v.stalls)}ms)` : ""} · 최고속도 ${Math.round(v.maxSpeed)}px/초 · 손 없음 ${(v.lost / v.frames * 100).toFixed(0)}%`); }
  console.log("\n순간이동(한 프레임에 200px 넘게 이동):", h.teleports.length ? h.teleports.slice(0, 12).map((x) => `${x.t.toFixed(1)}초 ${x.px}px(${NAME[x.seg] ?? x.seg})`).join(", ") : "없음 ✅");
  process.exit(0);
}
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
