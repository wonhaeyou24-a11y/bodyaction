// ⚡ 비동기 AI 엔진 - 작업자(Web Worker) 쪽
// MediaPipe 손/몸 인식을 화면(메인 스레드)과 따로 돌려서, 인식하는 동안에도 게임 화면이 멈추지 않게 해요.
//
// 주의: MediaPipe는 내부에서 importScripts()를 쓰기 때문에 "모듈 작업자"에서는 동작하지 않아요.
//       그래서 일반(classic) 작업자로 만들고, 라이브러리는 동적 import()로 불러와요.
//
// 메시지
//   받음  { type: "init",   kind: "hand"|"pose", model, options, cpu }
//         { type: "detect", kind, ts, bitmap }            (bitmap은 ImageBitmap, 소유권이 넘어옴)
//   보냄  { type: "ready",  kind, delegate }  |  { type: "error", kind, msg }
//         { type: "result", kind, ts, landmarks, inferMs }
const BUNDLE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

let lib = null, fileset = null;
const tasks = {};      // kind -> landmarker
const lastTs = {};     // kind -> 마지막으로 넣은 시각 (MediaPipe는 시각이 계속 커져야 해요)

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "init") {
    try {
      if (tasks[m.kind] && !m.replace) { self.postMessage({ type: "ready", kind: m.kind, delegate: tasks[m.kind].__delegate }); return; }
      lib ??= await import(BUNDLE);
      fileset ??= await lib.FilesetResolver.forVisionTasks(WASM);
      const Cls = m.kind === "pose" ? lib.PoseLandmarker : lib.HandLandmarker;
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: m.model, delegate }, runningMode: "VIDEO", ...m.options });
      let delegate = m.cpu ? "CPU" : "GPU", task;
      try { task = await Cls.createFromOptions(fileset, opts(delegate)); }
      catch { delegate = "CPU"; task = await Cls.createFromOptions(fileset, opts("CPU")); }   // GPU가 안 되면 CPU로
      task.__delegate = delegate;
      const old = tasks[m.kind];
      tasks[m.kind] = task;                    // replace(속도 자동 선택으로 GPU↔CPU 바꿀 때): 새 모델로 바꾼 뒤 옛 모델은 닫아요
      lastTs[m.kind] = 0;
      if (old && m.replace) { try { old.close(); } catch { /* 무시 */ } }
      self.postMessage({ type: "ready", kind: m.kind, delegate, replaced: !!m.replace });
    } catch (err) {
      self.postMessage({ type: "error", kind: m.kind, msg: String(err?.message || err) });
    }
    return;
  }

  if (m.type === "setOptions") {
    try {
      const task = tasks[m.kind];
      if (task?.setOptions) {
        task.setOptions(m.options);
      }
    } catch (err) {
      console.warn("setOptions 실패:", err);
    }
    return;
  }

  if (m.type === "detect") {
    const task = tasks[m.kind];
    try {
      if (!task) throw new Error("모델이 아직 준비되지 않았어요");
      const ts = Math.max(m.ts, (lastTs[m.kind] || 0) + 1);
      lastTs[m.kind] = ts;
      const t0 = performance.now();
      const r = task.detectForVideo(m.imageData ?? m.bitmap, ts);
      self.postMessage({ type: "result", kind: m.kind, ts: m.ts, landmarks: r.landmarks, handednesses: r.handednesses, inferMs: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: "result", kind: m.kind, ts: m.ts, landmarks: null, error: String(err?.message || err) });
    } finally {
      m.bitmap?.close?.();
    }
  }
};
