// 모든 단독 테스트를 한 번에 실행:  node test/run-all.js
// 게임을 고칠 때마다 돌려서 "예전보다 나빠진 곳이 없는지" 확인하세요. 하나라도 실패하면 종료 코드 1.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = [
  ["test/tracker.test.js", "손/관절 위치 추적(튐·지연·휘두름 속도)"],
  ["test/punch.test.js", "샌드백 펀치 판정(헛펀치·연타)"],
  ["test/poses.test.js", "포즈 미믹(인식·혼동·난이도)"],
  ["test/costume.test.js", "커스튬 흔들림(스프링 관성)"],
  ["test/jump.test.js", "러너 점프/앉기 판정(오인식 방지)"],
  ["test/armpunch.test.js", "샌드백 펀치·발차기 판정(몸 인식)"],
  ["test/character.test.js", "캐릭터 선택·저장·뼈대"],
  ["test/lane.test.js", "좌우 이동(길 바꾸기) 판정"],
  ["test/crun.test.js", "캐릭터 러너 규칙·공정함·봇 시뮬레이션"],
  ["test/duel.test.js", "검&방패 배틀 규칙·패링·봇 시뮬레이션"],
  ["test/charpipeline.test.js", "캐릭터 게임 입력 파이프라인 시뮬레이션"],
  ["test/smooth.test.js", "손이 끊기고 순간이동하는 정도(AI가 느릴 때)"],
  ["test/latency.test.js", "손이 그림자처럼 늦는 정도(카메라·인식 지연 보정)"],
  ["test/slash.test.js", "비트세이버식 슬래시(방향·쓸고 지나감·박자·막 휘두르기 방지)"],
  ["test/saber.test.js", "광선검 휘두름 판정(거리·프레임 속도·오인식)"],
  ["test/sw.test.js", "오프라인 저장(서비스 워커)"],
  ["test/replay.test.js", "몸 움직임 녹화·재생·채점 도구"],
  ["test/profiles.test.js", "가족 프로필"],
  ["test/guide.test.js", "카메라 세팅 판정"],
  ["online/test/room.test.js", "온라인 대결 방 규칙"],
  ["online/test/remote.test.js", "원격 연결(메시지 보관·중복 방지)"],
  ["online/test/qr.test.js", "초대 QR 코드 만들기(표준값·다시 읽기)"],
  ["online/test/crypto.test.js", "온라인 E2EE 암호화(AES-256-GCM)"],
  ["test/diagnostic.test.js", "종합 진단(속도·모션·인식·복구)"],
];
let failed = 0;
for (const [file, name] of suites) {
  const r = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop();
  const ok = r.status === 0;
  if (!ok) { failed++; console.log((r.stdout || "") + (r.stderr || "")); }
  console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(28)} ${last}`);
}
console.log(failed ? `\n${failed}개 묶음이 실패했어요` : "\n모두 통과");
process.exit(failed ? 1 : 0);
