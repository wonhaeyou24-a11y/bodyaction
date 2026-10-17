// ⚡ 비동기 AI 엔진 - 화면(메인 스레드) 쪽
// 카메라에 "새 프레임"이 들어올 때만(requestVideoFrameCallback) 영상을 작업자로 넘기고, 결과를 받아 둬요.
//  - 인식은 작업자에서 돌아서 게임 화면을 멈추지 않아요 (예전엔 인식하는 30~80ms 동안 화면이 멈췄어요).
//  - 한 번에 한 장만 보내요(밀림 방지). 작업자가 바쁘면 그 프레임은 건너뛰고 다음 새 프레임을 보내요.
//  - 같은 카메라 프레임을 두 번 인식하지 않아요.
// 게임 쪽은 take(kind)로 "새로 도착한 결과"만 꺼내 쓰고, 새 결과가 없으면 기존 외삽(관성 예측)으로 이어가요.

// ⚡ 속도 자동 선택: 컴퓨터마다 가장 빠른 인식 방법이 달라요 (이번 사용자: 손 인식 1번에 133ms → 초당 10번 → 손이 늦고 끊김).
// 처음 14번의 인식 시간을 재서 70ms보다 느리면, 아래 후보를 차례로 14번씩 재 보고 가장 빠른 것을 골라요(기준보다 20% 이상 빠를 때만 바꿔요).
//   후보: ① GPU·원본 크기(기준)  ② GPU·절반 크기  ③ CPU·절반 크기  ④ GPU·절반 크기·픽셀 복사 방식  ⑤ CPU·절반 크기·픽셀 복사 방식
//   (영상을 줄여서 보내면 변환 시간이 줄어요. '픽셀 복사 방식'은 GPU 그림(ImageBitmap) 대신 일반 메모리 픽셀(ImageData)로 보내서, 일부 컴퓨터에서 GPU↔작업자 사이 복사가 느린 걸 피해요)
//   가장 빠른 것과 15% 이내로 비슷하면 더 큰 크기·GPU·그림(ImageBitmap) 방식(더 정확하고 단순한 쪽)을 골라요.
// 모델과 인식 방식은 같아서 결과(정확도)는 거의 같아요. 결과는 이 기기에 기억해서 다음부터는 재지 않고 바로 그 방법으로 시작하고,
// 주소에 ?retune 을 붙이면 다시 재요. (시험용 ?tune 은 70ms 기준 없이 무조건 재 봐요)
const TUNE_N = 14, TUNE_WARM = 2, TUNE_SLOW = (typeof location !== "undefined" && location.search.includes("tune")) ? 0 : 70, TUNE_GAIN = 0.8;
const CONFIGS = [{ cpu: false, s: 1, p: "bitmap" }, { cpu: false, s: 0.5, p: "bitmap" }, { cpu: true, s: 0.5, p: "bitmap" }, { cpu: false, s: 0.5, p: "data" }, { cpu: true, s: 0.5, p: "data" }];
const prefKey = (kind) => "kk_tune_" + kind;
const readPref = (kind) => { try { if (typeof location !== "undefined" && location.search.includes("retune")) return null; const v = JSON.parse(localStorage.getItem(prefKey(kind)) || "null"); return v && typeof v.cpu === "boolean" && v.s > 0 && v.s <= 1 ? { cpu: v.cpu, s: v.s, p: v.p === "data" ? "data" : "bitmap" } : null; } catch { return null; } };
const writePref = (kind, c) => { try { localStorage.setItem(prefKey(kind), JSON.stringify({ cpu: c.cpu, s: c.s, p: c.p })); } catch { /* 무시 */ } };

export function createVisionClient({ video }) {
  let worker = null, broken = false;
  let active = null;              // 지금 인식할 종류: "hand" | "pose" | null(멈춤)
  let busy = false, busySince = 0, grab = null, grabCtx = null;   // grab: 픽셀 복사 방식용 작은 캔버스
  let lastFrameTime = -1;
  const state = {
    hand: { ready: false, latest: null, fresh: false, delegate: null },
    pose: { ready: false, latest: null, fresh: false, delegate: null },
  };
  const waiters = { hand: [], pose: [] };
  const stats = { inferMs: 0, latencyMs: 0, results: 0, startedAt: 0 };
  const initArgs = {};            // kind -> ensure()에 받은 모델/옵션 (자동 선택에서 다시 만들 때 써요)
  const scale = { hand: 1, pose: 1 };          // 영상을 작업자에 보낼 때 줄이는 비율 (1 = 원본)
  const path = { hand: "bitmap", pose: "bitmap" };   // 보내는 방식: bitmap(GPU 그림) | data(일반 메모리 픽셀)
  const cur = { hand: { cpu: false, s: 1, p: "bitmap" }, pose: { cpu: false, s: 1, p: "bitmap" } };   // 지금 쓰는 방법
  const tune = { hand: { phase: "wait", i: 0, n: 0, sum: 0, avgs: [], skip: 0 }, pose: { phase: "wait", i: 0, n: 0, sum: 0, avgs: [], skip: 0 } };
  function applyConfig(kind, c) {              // 방법 바꾸기: 크기는 바로, CPU/GPU는 모델을 다시 만들어요(잠깐 걸려요)
    const needInit = c.cpu !== cur[kind].cpu;
    cur[kind] = { ...c }; scale[kind] = c.s; path[kind] = c.p;
    if (needInit && worker && initArgs[kind]) { tune[kind].switching = true; worker.postMessage({ type: "init", kind, ...initArgs[kind], cpu: c.cpu, replace: true }); }
  }
  function tuneResult(kind, inferMs) {
    const t = tune[kind];
    if (!inferMs || t.phase !== "measure" || t.switching) return;
    if (++t.skip <= TUNE_WARM) return;                        // 처음 몇 번은 준비운동이라 제외
    t.n++; t.sum += inferMs;
    if (t.n < TUNE_N) return;
    t.avgs[t.i] = t.sum / t.n; t.n = 0; t.sum = 0; t.skip = 0;
    if (t.i === 0 && (t.avgs[0] <= TUNE_SLOW || !initArgs[kind])) { t.phase = "done"; writePref(kind, CONFIGS[0]); return; }   // 충분히 빠르면 그대로
    if (t.i + 1 < CONFIGS.length) { t.i++; applyConfig(kind, CONFIGS[t.i]); return; }                                          // 다음 후보 재 보기
    // 모두 쟀어요: 가장 빠른 것을 고르되, 기준보다 20% 이상 빠를 때만 바꿔요
    let best = 0; t.avgs.forEach((v, k) => { if (v < t.avgs[best]) best = k; });
    if (!(t.avgs[best] <= t.avgs[0] * TUNE_GAIN)) best = 0;
    else {                                                                                      // 비슷하게(15% 이내) 빠르면 더 큰 크기 → GPU → 그림(bitmap) 순으로 단순하고 정확한 쪽
      const fastest = t.avgs[best], rank = (c) => c.s * 100 + (c.cpu ? 0 : 10) + (c.p === "bitmap" ? 1 : 0);
      let pick = best; t.avgs.forEach((v, k) => { if (v <= fastest * 1.15 && rank(CONFIGS[k]) > rank(CONFIGS[pick])) pick = k; }); best = pick;
    }
    t.phase = "done"; writePref(kind, CONFIGS[best]);
    console.info(`[속도 자동 선택] ${kind}: ` + t.avgs.map((v, k) => `${k + 1}번(${CONFIGS[k].cpu ? "CPU" : "GPU"}·${CONFIGS[k].s}배·${CONFIGS[k].p === "data" ? "픽셀" : "그림"}) ${v.toFixed(0)}ms`).join(" / ") + ` → ${best + 1}번 사용`);
    if (best !== t.i) applyConfig(kind, CONFIGS[best]);
  }

  function getWorker() {
    if (broken) return null;
    if (!worker) {
      try {
        worker = new Worker(new URL("./vision-worker.js?v=20261018_0710", import.meta.url));   // 일반(classic) 작업자
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
      if (m.replaced) { t.switching = false; t.skip = 0; t.n = 0; t.sum = 0; }                        // CPU/GPU 바꾼 뒤: 새 방법으로 다시 재기 시작
      else if (t.phase === "wait") {
        const pref = readPref(m.kind);
        cur[m.kind] = { cpu: m.delegate === "CPU", s: scale[m.kind], p: path[m.kind] };
        t.skip = 0; t.i = 0;
        t.phase = pref || m.delegate !== "GPU" ? "done" : "measure";                                  // 이미 재 본 기기(기억해 둠)이거나 처음부터 CPU면 재지 않아요
      }
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
    const pref = readPref(kind);
    if (pref) { if (pref.cpu) cpu = true; scale[kind] = pref.s; path[kind] = pref.p; }       // 이 기기에서 재 둔 가장 빠른 방법으로 시작
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
      const sc = scale[kind], vw = video.videoWidth, vh = video.videoHeight, w = Math.max(64, Math.round(vw * sc)), h = Math.max(64, Math.round(vh * sc));
      if (path[kind] === "data") {
        // 일반 메모리 픽셀(ImageData)로 보내기: 작은 캔버스에 영상을 그려 픽셀을 읽어요 (GPU 그림 객체를 작업자로 넘길 때 생기는 느린 복사를 피해요)
        if (!grab || grab.width !== w || grab.height !== h) { grab = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }); grabCtx = grab.getContext("2d", { willReadFrequently: true }); }
        grabCtx.drawImage(video, 0, 0, w, h);
        const imageData = grabCtx.getImageData(0, 0, w, h);
        worker.postMessage({ type: "detect", kind, ts, imageData }, [imageData.data.buffer]);
        return;
      }
      const bitmap = sc < 1 ? await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: "low" }) : await createImageBitmap(video);
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
    get stats() { return { ...stats, delegate: state[active]?.delegate ?? null, scale: active ? scale[active] : 1, path: active ? path[active] : "bitmap", tuning: active ? tune[active].phase === "measure" : false, tune: Object.fromEntries(["hand", "pose"].map((k) => [k, { phase: tune[k].phase, avgs: tune[k].avgs.map((v) => Math.round(v)), cur: cur[k] }])), broken }; },
  };
}
