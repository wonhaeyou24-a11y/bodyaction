// ⚡ 비동기 AI 엔진 - 화면(메인 스레드) 쪽
// 카메라에 "새 프레임"이 들어올 때만(requestVideoFrameCallback) 영상을 작업자로 넘기고, 결과를 받아 둬요.
//  - 인식은 작업자에서 돌아서 게임 화면을 멈추지 않아요 (예전엔 인식하는 30~80ms 동안 화면이 멈췄어요).
//  - 한 번에 한 장만 보내요(밀림 방지). 작업자가 바쁘면 그 프레임은 건너뛰고 다음 새 프레임을 보내요.
//  - 같은 카메라 프레임을 두 번 인식하지 않아요.
// 게임 쪽은 take(kind)로 "새로 도착한 결과"만 꺼내 쓰고, 새 결과가 없으면 기존 외삽(관성 예측)으로 이어가요.

// ⚡ 속도 자동 선택: 어떤 컴퓨터는 GPU로 인식하면 오히려 느려요(이번 사용자: 손 인식 1번에 133ms → 초당 10번 → 손이 끊기고 늦음).
// 처음 24번의 인식 시간을 재서 70ms보다 느리면 CPU로 바꿔 24번 더 재 보고, CPU가 25% 이상 빠르면 CPU를 쓰고 아니면 GPU로 되돌려요.
// 결과는 이 기기에 기억해서(다음부터는 재지 않고 바로 빠른 쪽으로 시작) 주소에 ?retune 을 붙이면 다시 재요. 모델과 결과(정확도)는 같아요.
const TUNE_N = 24, TUNE_WARM = 3, TUNE_SLOW = (typeof location !== "undefined" && location.search.includes("tune")) ? 0 : 70;
const prefKey = (kind) => "kk_delegate_" + kind;
const readPref = (kind) => { try { return (typeof location !== "undefined" && location.search.includes("retune")) ? null : localStorage.getItem(prefKey(kind)); } catch { return null; } };
const writePref = (kind, v) => { try { localStorage.setItem(prefKey(kind), v); } catch { /* 무시 */ } };

export function createVisionClient({ video }) {
  let worker = null, broken = false;
  let active = null;              // 지금 인식할 종류: "hand" | "pose" | null(멈춤)
  let busy = false, busySince = 0;
  let lastFrameTime = -1;
  const state = {
    hand: { ready: false, latest: null, fresh: false, delegate: null },
    pose: { ready: false, latest: null, fresh: false, delegate: null },
  };
  const waiters = { hand: [], pose: [] };
  const stats = { inferMs: 0, latencyMs: 0, results: 0, startedAt: 0 };
  const initArgs = {};            // kind -> ensure()에 받은 모델/옵션 (자동 선택에서 다시 만들 때 써요)
  const tune = { hand: { phase: "wait", n: 0, sum: 0, gpuAvg: 0, cpuAvg: 0 }, pose: { phase: "wait", n: 0, sum: 0, gpuAvg: 0, cpuAvg: 0 } };
  function tuneResult(kind, inferMs) {
    const t = tune[kind];
    if (!inferMs || t.phase === "done" || t.phase === "switching" || t.phase === "wait") return;
    if (++t.skip <= TUNE_WARM) return;                        // 처음 몇 번은 준비운동이라 제외
    t.n++; t.sum += inferMs;
    if (t.n < TUNE_N) return;
    const avg = t.sum / t.n; t.n = 0; t.sum = 0;
    if (t.phase === "gpu") {
      t.gpuAvg = avg;
      if (avg <= TUNE_SLOW || !initArgs[kind]) { t.phase = "done"; writePref(kind, "GPU"); return; }
      t.phase = "switching"; t.skip = 0;
      worker?.postMessage({ type: "init", kind, ...initArgs[kind], cpu: true, replace: true });
    } else if (t.phase === "cpu") {
      t.cpuAvg = avg;
      if (t.cpuAvg < t.gpuAvg * 0.75) { t.phase = "done"; writePref(kind, "CPU"); console.info(`[속도 자동 선택] ${kind}: CPU ${t.cpuAvg.toFixed(0)}ms < GPU ${t.gpuAvg.toFixed(0)}ms → CPU 사용`); }
      else { t.phase = "switching"; t.skip = 0; t.back = true; worker?.postMessage({ type: "init", kind, ...initArgs[kind], cpu: false, replace: true }); console.info(`[속도 자동 선택] ${kind}: CPU ${t.cpuAvg.toFixed(0)}ms 이 GPU ${t.gpuAvg.toFixed(0)}ms 보다 빠르지 않아 GPU로 되돌려요`); }
    }
  }

  function getWorker() {
    if (broken) return null;
    if (!worker) {
      try {
        worker = new Worker(new URL("./vision-worker.js?v=20261018_0500", import.meta.url));   // 일반(classic) 작업자
        worker.onmessage = onMessage;
        worker.onerror = (e) => { console.warn("AI 작업자 오류 - 예전 방식으로 전환:", e.message); fail("작업자 오류"); };
      } catch (e) { console.warn("AI 작업자를 만들 수 없어요:", e); broken = true; return null; }
    }
    return worker;
  }

  function fail(msg) {
    broken = true;
    try { worker?.terminate(); } catch { /* 무시 */ }
    worker = null; busy = false;
    for (const k of ["hand", "pose"]) { state[k].ready = false; waiters[k].splice(0).forEach((w) => w.resolve(false)); }
  }

  let errStreak = 0;
  function onMessage(e) {
    const m = e.data;
    if (m.type === "ready") {
      state[m.kind].ready = true; state[m.kind].delegate = m.delegate;
      const t = tune[m.kind];
      if (m.replaced) { t.skip = 0; t.n = 0; t.sum = 0; if (t.back) { t.phase = "done"; t.back = false; writePref(m.kind, "GPU"); } else if (t.phase === "switching") t.phase = "cpu"; }   // CPU로 바꾼 뒤 측정 시작 / GPU로 되돌렸으면 끝
      else if (t.phase === "wait") { t.skip = 0; t.phase = m.delegate === "GPU" && readPref(m.kind) !== "GPU" ? "gpu" : "done"; }                      // 이미 재 본 기기(기억해 둠)나 CPU로 시작했으면 재지 않아요
      waiters[m.kind].splice(0).forEach((w) => w.resolve(true));
    } else if (m.type === "error") {
      console.warn(`AI 작업자 모델 준비 실패(${m.kind}):`, m.msg);
      waiters[m.kind].splice(0).forEach((w) => w.resolve(false));
    } else if (m.type === "result") {
      busy = false;
      // 인식이 끝난 순간, 그 사이에 새 카메라 프레임이 이미 와 있으면 다음 프레임을 기다리지 않고 바로 보내요 (예전엔 최대 16ms를 놀았어요)
      if (frameSeq > sentSeq) queueMicrotask(() => send(latestCapture));
      if (m.error) {
        errStreak++;
        if (errStreak >= 4) {
          console.warn("AI 작업자 연속 오류 발생 -> 메인 스레드 모드로 자동 복구 전환");
          fail("작업자 연속 오류");
        }
      } else {
        errStreak = 0;
        const s = state[m.kind];
        s.latest = { ts: m.ts, result: { landmarks: m.landmarks || [] }, inferMs: m.inferMs || 0 };
        tuneResult(m.kind, m.inferMs);
        s.fresh = true;
        stats.results++;
        if (m.inferMs) stats.inferMs = stats.inferMs ? stats.inferMs * 0.85 + m.inferMs * 0.15 : m.inferMs;
        stats.latencyMs = stats.latencyMs ? stats.latencyMs * 0.85 + (performance.now() - m.ts) * 0.15 : performance.now() - m.ts;
      }
    }
  }

  /** 작업자에서 모델 준비. 성공하면 true, 안 되면 false (그때는 예전 방식을 쓰면 돼요) */
  function ensure(kind, { model, options = {}, cpu = false, timeoutMs = 45000 } = {}) {
    initArgs[kind] = { model, options };
    if (readPref(kind) === "CPU") cpu = true;                // 이 기기에서 CPU가 더 빨랐다고 기억해 둔 경우
    if (state[kind].ready) return Promise.resolve(true);
    const w = getWorker();
    if (!w) return Promise.resolve(false);
    return new Promise((resolve) => {
      const entry = { resolve };
      waiters[kind].push(entry);
      const t = setTimeout(() => { const i = waiters[kind].indexOf(entry); if (i >= 0) waiters[kind].splice(i, 1); resolve(false); }, timeoutMs);
      entry.resolve = (v) => { clearTimeout(t); resolve(v); };
      w.postMessage({ type: "init", kind, model, options, cpu });
    });
  }

  // ---------- 새 카메라 프레임마다 보내기 ----------
  let lastRvfc = 0, lastTs = 0, frameSeq = 0, sentSeq = 0, latestCapture = 0;   // frameSeq: 지금까지 카메라가 보낸 새 프레임 수 / sentSeq: 그중 마지막으로 인식에 보낸 프레임
  /**
   * 이 영상이 카메라에서 "실제로 찍힌 시각". 영상을 작업자에 보내는 시각(찍힌 뒤 카메라·전송 지연만큼 늦음)이 아니라
   * 찍힌 시각으로 표시해야, 추적기가 그 지연만큼 앞을 예측해서 화면 속 손이 진짜 손을 늦지 않게 따라가요.
   * 브라우저가 알려 주지 않으면(또는 값이 이상하면) 예전처럼 지금 시각을 써요.
   */
  function captureStamp(meta) {
    const now = performance.now(), c = meta && (meta.captureTime ?? meta.receiveTime);
    return typeof c === "number" && now - c >= 0 && now - c < 400 ? c : now;
  }
  function pump() {
    // 1순위: 카메라에 새 프레임이 그려질 때마다 알림 (requestVideoFrameCallback)
    if (typeof video.requestVideoFrameCallback === "function") {
      const onFrame = (now, meta) => { lastRvfc = performance.now(); frameSeq++; latestCapture = captureStamp(meta); send(latestCapture); video.requestVideoFrameCallback(onFrame); };
      video.requestVideoFrameCallback(onFrame);
    }
    // 보조: 알림이 0.1초 넘게 안 오면(지원 안 함/브라우저가 멈춤) 영상 시간이 바뀌었는지 직접 확인
    setInterval(() => {
      if (performance.now() - lastRvfc > 100 && video.currentTime !== lastFrameTime) { lastFrameTime = video.currentTime; send(); }
    }, 16);
  }
  async function send(captureTs = null) {
    if (!active || !worker || !state[active].ready || video.readyState < 2) return;
    if (busy) {
      // 응답이 없으면 강제 잠금 해제 — 단, 느린 PC(인식 1회가 오래 걸림)에서는 기다려 줘요 (그렇지 않으면 작업자에 일이 쌓여 지연이 커져요)
      if (performance.now() - busySince < Math.max(350, 4 * (stats.inferMs || 0))) return;
    }
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
    busy = true; busySince = performance.now(); sentSeq = frameSeq;
    const kind = active, ts = (lastTs = Math.max(captureTs ?? performance.now(), lastTs + 0.01));
    try {
      const bitmap = await createImageBitmap(video);
      worker.postMessage({ type: "detect", kind, ts, bitmap }, [bitmap]);
    } catch (e) {
      busy = false;
    }
  }
  pump();

  return {
    ensure,
    /** 인식할 종류를 정함 ("hand" | "pose" | null). null이면 영상을 보내지 않아요 */
    setActive(kind) {
      if (kind !== active) { active = kind; if (kind) { state[kind].fresh = false; stats.startedAt = performance.now(); } }
    },
    /** 작업자로 인식 중인지 */
    ready(kind) { return !broken && state[kind].ready; },
    /** 새로 도착한 결과만 꺼냄 (없으면 null) */
    take(kind) { const s = state[kind]; if (!s.fresh) return null; s.fresh = false; return s.latest; },
    /** 마지막 결과 보기 (꺼내지 않음) */
    peek(kind) { return state[kind].latest; },
    get stats() { return { ...stats, delegate: state[active]?.delegate ?? null, broken }; },
  };
}
