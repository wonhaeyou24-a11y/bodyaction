// 몸 움직임 녹화 (개발·진단용). 화면 영상은 저장하지 않고, 관절 좌표(숫자)만 저장해요.
//
// 왜 필요한가: 지금까지 시험은 "가짜 몸 동작"으로만 했어요. 가짜는 현실보다 쉽게 나와서, 실제로 해 보면 헷갈리는 일이 생겨요.
//   → 실제로 몸을 움직여 녹화해 두면, 판정을 고칠 때마다 그 녹화로 다시 시험할 수 있어요 (node test/replay.mjs 녹화파일.json).
//
// 사용법: 몸 인식이 켜진 화면(몸 게임을 하는 중이거나 커스튬 룸)에서 F8 → 화면 안내대로 약 90초 동안 움직이면
//         녹화 파일(kk-rec-날짜.json)이 내려받아져요. (F8을 다시 누르면 중간에 멈추고 저장)

/** 기록하는 관절 번호 (코, 양쪽 귀, 어깨, 팔꿈치, 손목, 엉덩이, 무릎, 발목) */
export const JOINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const r = (v, n) => { const k = 10 ** n; return Math.round(v * k) / k; };

/** 안내 순서: 종류별 몇 번씩 시킬지 정해 둬요. 각 칸의 [start, end] 초 안에 해당 동작이 나와야 "맞게 인식"으로 세요. */
export function buildScript() {
  const s = []; let t = 0;
  const add = (type, dur, say) => { s.push({ type, start: t, end: t + dur, say }); t += dur; };
  add("setup", 5, "준비! 전신이 보이게 서 주세요");
  add("still", 8, "가만히 서 있어요");
  for (let i = 0; i < 5; i++) add("jump", 3.2, "점프!");
  for (let i = 0; i < 5; i++) add("duck", 3.4, "앉았다가 일어나요!");
  for (let i = 0; i < 3; i++) add("left", 3.4, "화면에서 왼쪽으로 몸을 기울여요!");
  for (let i = 0; i < 3; i++) add("right", 3.4, "화면에서 오른쪽으로 몸을 기울여요!");
  for (let i = 0; i < 4; i++) add("punch", 2.6, "오른손 펀치!");
  for (let i = 0; i < 4; i++) add("punch", 2.6, "왼손 펀치!");
  add("walk", 8, "제자리 걷기");
  add("still", 5, "가만히 서 있어요");
  add("done", 2, "끝! 저장했어요");
  return s;
}

/** 손 게임용 안내 순서: 손을 카메라에 보여 주고 천천히/빠르게/원 그리기/양손/손 숨겼다 보이기/주먹 쥐기 */
export function buildHandScript() {
  const s = []; let t = 0;
  const add = (type, dur, say) => { s.push({ type, start: t, end: t + dur, say }); t += dur; };
  add("setup", 5, "준비! 한 손을 카메라에 보여 주세요");
  add("hold", 6, "손을 든 채로 가만히");
  add("slow", 8, "손을 왼쪽↔오른쪽으로 천천히 움직여요");
  add("fast", 8, "손을 왼쪽↔오른쪽으로 빠르게 휘저어요");
  add("circle", 6, "손으로 크게 원을 그려요");
  add("two", 8, "두 손을 모두 보여 주고 움직여요");
  for (let i = 0; i < 3; i++) { add("hide", 2.5, "손을 화면 밖으로 내려요"); add("show", 2.5, "손을 다시 올려요"); }
  add("fist", 6, "주먹을 쥐었다 폈다 해요");
  add("done", 2, "끝! 저장했어요");
  return s;
}

/** 손 랜드마크에서 저장할 점 번호: 손목, 검지 시작·끝, 가운데손가락 시작, 약지·새끼 시작 */
export const HAND_POINTS = [0, 5, 8, 9, 13, 17];

export class Recorder {
  constructor() { this.on = false; this.rec = null; this.start0 = 0; }
  /** @param meta 화면·카메라 크기 등 (좌표를 화면 픽셀로 바꾸는 데 필요)  @param script 안내 순서(없으면 자유 녹화) */
  start(meta, script = null) {
    this.start0 = performance.now();
    this.rec = { version: 1, app: "kinetic-kaboom", startedAt: new Date().toISOString(), meta: { ...meta }, script, joints: JOINTS, results: [], marks: [], handResults: [], frames: [] };
    this.on = true;
  }
  now() { return performance.now() - this.start0; }
  /** 새 인식 결과 한 번(약 20Hz): 시각 tMs(performance.now 기준), 랜드마크 33개 */
  result(tMs, lm) {
    if (!this.on || !lm) return;
    const row = [Math.round(tMs - this.start0)];
    for (const j of JOINTS) { const p = lm[j]; row.push(p ? [r(p.x, 4), r(p.y, 4), r(p.z ?? 0, 3), r(p.visibility ?? 1, 2)] : null); }
    this.rec.results.push(row);
  }
  /** 손 인식 결과 한 번: hands = 손마다 랜드마크 21개 → 핵심 6점만 [x,y] 저장 */
  handResult(tMs, hands, inferMs = 0) {
    if (!this.on || !hands) return;
    this.rec.handResults.push([Math.round(tMs - this.start0), hands.map((h) => HAND_POINTS.map((i) => [r(h[i].x, 4), r(h[i].y, 4)])), Math.round(inferMs)]);   // 3번째 값: 이 인식 1번에 걸린 시간(ms)
  }
  /** 화면에 실제로 그려진 손 위치(추적기를 거친 값) 한 프레임: 순간이동·끊김을 직접 볼 수 있어요 */
  frame(tMs, ptrs) {
    if (!this.on) return;
    this.rec.frames.push([Math.round(tMs - this.start0), ptrs.map((p) => [p.slot ?? 0, Math.round(p.x), Math.round(p.y)])]);
  }
  /** 사건 표시: 몸이 사라짐("lost"), 안내 칸 시작 등 */
  mark(type, extra = {}) { if (this.on) this.rec.marks.push({ t: Math.round(this.now()), type, ...extra }); }
  /** 끝내고 녹화 데이터를 돌려줘요 */
  stop() { this.on = false; const rec = this.rec; if (rec) rec.durationMs = Math.round(this.now()); return rec; }
}

/** 브라우저에서 파일로 내려받기 */
export function downloadRecording(rec, name) {
  const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
