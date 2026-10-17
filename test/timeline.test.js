// "시간선 섞임" 방지 검사: node test/timeline.test.js
// 인식 결과의 시각(t0)은 이제 "카메라가 영상을 찍은 시각"이라서 지금 시계(performance.now)보다 카메라 지연(수십~수백 ms)만큼 옛날이에요.
// 그래서 "손/몸을 방금 봤는지"를 t0 로 재면, 카메라 지연이 긴 컴퓨터에서는 늘 "한참 전"으로 보여서 손을 계속 놓친 걸로 오판해요 (실제 사고: 손 게임이 안 되던 문제).
// → 지금 시계와 비교하는 값은 반드시 "결과가 도착한 시각"이어야 해요. 이 검사는 위험한 비교 모양이 코드에 다시 들어오면 알려 줘요.
import fs from "node:fs";

let failed = 0;
const src = fs.readFileSync(new URL("../main.js", import.meta.url), "utf8").split("\n");
const bad = [
  [/\bnow\s*-\s*(lastSeen|bodySeen|lastHandT0|lastPoseT0)\b/, "지금 시계에서 '찍힌 시각' 변수를 뺐어요 (도착 시각 lastSeenAt/bodySeenAt 을 쓰세요)"],
  [/performance\.now\(\)\s*-\s*\(?\s*(lastSeen|bodySeen|lastHandT0|lastPoseT0|lastPunch)\b(?!At)/, "performance.now() 에서 '찍힌 시각' 변수를 뺐어요 (도착 시각을 쓰세요)"],
];
src.forEach((line, i) => { if (/^\s*\/\//.test(line)) return; for (const [re, why] of bad) if (re.test(line)) { failed++; console.log(`  FAIL main.js:${i + 1} ${why}\n       ${line.trim().slice(0, 140)}`); } });
// 도착 시각 변수가 실제로 갱신되는지
for (const v of ["lastSeenAt", "bodySeenAt", "lastPunchAt"]) { const n = src.filter((l) => new RegExp("\\b" + v + "\\b").test(l)).length; if (n < 2) { failed++; console.log(`  FAIL ${v} 가 갱신/사용되지 않아요`); } }
console.log(failed ? `\n${failed}건 문제` : "  ok   지금 시계와 '찍힌 시각'을 섞어 비교하는 곳이 없음\n\n1/1 통과");
process.exit(failed ? 1 : 0);
