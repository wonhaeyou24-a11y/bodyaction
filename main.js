import { FilesetResolver, HandLandmarker, PoseLandmarker }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const GAME_SECONDS = 60;

const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("stage"), ctx = canvas.getContext("2d");
let W = 0, H = 0;
function resize() {
  const d = Math.min(window.devicePixelRatio || 1, 1.5);   // 고해상도 화면에서 그리기 부담 줄이기(성능)
  W = innerWidth; H = innerHeight;
  canvas.width = W * d; canvas.height = H * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener("resize", resize); resize();

// ---------- 소리 (효과음 · 배경음악 · 음성) ----------
let actx, master, bgmBus, noiseBuf, soundOn = true, voiceOn = true;
function ac() {
  if (!actx) {
    actx = new AudioContext();
    master = actx.createGain();
    const comp = actx.createDynamicsCompressor();          // 소리가 겹쳐도 깨지지 않게
    master.connect(comp).connect(actx.destination);
    bgmBus = actx.createGain(); bgmBus.gain.value = 0.5; bgmBus.connect(master);
  }
  if (actx.state === "suspended") actx.resume();
  master.gain.value = soundOn ? 1 : 0;
  return actx;
}
// 소리가 나는 위치(화면 x)에 따라 좌우로 퍼지게 해서 입체감을 줌
function out(pan, bus) {
  const dst = bus ?? master;
  if (pan == null || !actx.createStereoPanner) return dst;
  const p = actx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dst); return p;
}
const panOf = (x) => (x / W) * 2 - 1;
function tone(freq, when, dur, type = "sine", vol = 0.15, endFreq, pan, bus) {
  try {
    ac();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, when);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, when + dur);
    g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g).connect(out(pan, bus)); o.start(when); o.stop(when + dur + 0.02);
  } catch {}
}
function noise(when, dur, vol, hp, pan, bus) {
  try {
    ac();
    noiseBuf ??= (() => { const b = actx.createBuffer(1, actx.sampleRate * 0.8, actx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    s.connect(f).connect(g).connect(out(pan, bus)); s.start(when); s.stop(when + dur);
  } catch {}
}
function beep(freq, dur = 0.12, type = "sine", vol = 0.15, pan) { try { tone(freq, ac().currentTime, dur, type, vol, undefined, pan); } catch {} }

// 효과음 모음: x(화면 가로 위치)를 주면 그쪽에서 소리가 남
const sfx = {
  pop(x, gold) {
    const t = ac().currentTime, p = panOf(x);
    noise(t, 0.08, 0.3, 1500, p); tone(gold ? 1200 : 700 + Math.random() * 250, t, 0.12, "triangle", 0.15, 200, p);
    if (gold) { tone(1568, t + 0.06, 0.2, "sine", 0.12, undefined, p); tone(2093, t + 0.12, 0.25, "sine", 0.1, undefined, p); }
  },
  slice(x) {
    const t = ac().currentTime, p = panOf(x);
    noise(t, 0.16, 0.28, 2500, p); tone(1300, t, 0.12, "sawtooth", 0.05, 300, p); tone(260, t + 0.04, 0.1, "square", 0.08, 100, p);
  },
  bomb(x) {
    const t = ac().currentTime, p = panOf(x);
    noise(t, 0.7, 0.5, 200, p); tone(120, t, 0.55, "sawtooth", 0.3, 35, p);
  },
  whack(x, bonus) {
    const t = ac().currentTime, p = panOf(x);
    tone(320, t, 0.12, "square", 0.12, 120, p); tone(bonus ? 900 : 520, t + 0.05, 0.15, "triangle", 0.15, undefined, p);
    if (bonus) tone(1175, t + 0.12, 0.2, "triangle", 0.12, undefined, p);
  },
  meteor(x, big) {
    const t = ac().currentTime, p = panOf(x);
    noise(t, 0.4, 0.35, 300, p); tone(big ? 90 : 140, t, 0.45, "sawtooth", 0.25, 40, p); tone(1000, t, 0.1, "square", 0.06, 300, p);
  },
  chip(x) { const t = ac().currentTime, p = panOf(x); tone(420, t, 0.08, "square", 0.08, undefined, p); noise(t, 0.05, 0.12, 3000, p); },
  incoming(x) { const t = ac().currentTime, p = panOf(x); noise(t, 0.6, 0.05, 900, p); tone(70, t, 0.8, "sine", 0.07, 170, p); },
  crash() { const t = ac().currentTime; noise(t, 0.8, 0.6, 150); tone(70, t, 0.6, "sawtooth", 0.35, 25); },
  combo(n) {
    const t = ac().currentTime, steps = [0, 2, 4, 7, 9, 12, 14, 16];
    tone(523.25 * 2 ** (steps[Math.min(n - 3, steps.length - 1)] / 12), t, 0.14, "triangle", 0.1);
  },
  start() { const t = ac().currentTime; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.09, 0.2, "triangle", 0.14)); },
  end() { const t = ac().currentTime; [784, 659, 784, 1046.5].forEach((f, i) => tone(f, t + i * 0.14, 0.3, "triangle", 0.14)); },
  levelUp() { const t = ac().currentTime; [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.07, 0.25, "square", 0.08)); },
};

// 음성 안내 (브라우저 내장 한국어 음성)
let lastVoice = 0;
function speak(text, force = false) {
  if (!voiceOn || !window.speechSynthesis) return;
  const n = performance.now();
  if (!force && n - lastVoice < 1200) return;
  lastVoice = n;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR"; u.rate = 1.1; u.pitch = 1.15; speechSynthesis.speak(u);
  } catch {}
}
const INTRO = {
  balloon: "풍선을 터뜨려라! 시작!", ninja: "과일을 베어라! 폭탄은 조심!", mole: "두더지를 잡아라! 시작!",
  space: "유성이 온다! 지구를 지켜라!", draw: "허공에 그림을 그려 보세요! 주먹을 쥐면 멈춰요!",
  dodge: "온몸으로 돌을 피하고 동전을 모아요!",
  brick: "공을 튕겨서 벽돌을 깨요!", leak: "물이 새요! 손으로 구멍을 막아요!", runner: "점프하고, 앉아서 장애물을 피해요!", kungfu: "다가오는 적을 주먹으로 쳐요!", pose: "화면의 자세를 따라 해 보세요!", versus: "대결 시작! 먼저 터뜨려라!",
};

// 배경음악: 게임마다 분위기가 다르고, 시간이 갈수록 점점 빨라짐
const BGM = {
  balloon: { bpm: 112, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "triangle", drums: "pop" },
  ninja:   { bpm: 124, root: 196, scale: [0, 1, 5, 7, 8], prog: [0, 0, 5, 3], wave: "square", drums: "taiko", vol: 0.55 },
  mole:    { bpm: 120, root: 329.63, scale: [0, 2, 4, 7, 9], prog: [0, 7, 5, 7], wave: "square", drums: "pop", vol: 0.5 },
  space:   { bpm: 92, root: 130.81, scale: [0, 3, 5, 7, 10], prog: [0, 0, 8, 5], wave: "sine", drums: "drone" },
  draw:    { bpm: 76, root: 196, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "sine", drums: "none", vol: 0.5 },
  dodge:   { bpm: 132, root: 220, scale: [0, 3, 5, 7, 10], prog: [0, 3, 5, 7], wave: "square", drums: "pop", vol: 0.45 },
  pose:    { bpm: 116, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 0], wave: "triangle", drums: "pop", vol: 0.55 },
  brick:   { bpm: 118, root: 293.66, scale: [0, 2, 4, 7, 9], prog: [0, 7, 5, 7], wave: "square", drums: "pop", vol: 0.45 },
  leak:    { bpm: 104, root: 246.94, scale: [0, 2, 4, 7, 9], prog: [0, 5, 3, 5], wave: "sine", drums: "pop", vol: 0.5 },
  runner:  { bpm: 138, root: 220, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "square", drums: "pop", vol: 0.45 },
  kungfu:  { bpm: 128, root: 196, scale: [0, 1, 5, 7, 8], prog: [0, 0, 5, 3], wave: "sawtooth", drums: "taiko", vol: 0.5 },
  versus:  { bpm: 130, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 7, 9, 5], wave: "sawtooth", drums: "pop", vol: 0.45 },
};
const ARP = [0, 2, 1, 3, 2, 4, 3, 1];
let bgmNext = 0, bgmStep = 0;
function bgmStart() { ac(); bgmNext = actx.currentTime + 0.15; bgmStep = 0; }
function bgmTick() {
  const c = BGM[mode];
  if (!c || !playing || !actx) return;
  while (bgmNext < actx.currentTime + 0.25) {
    const e = bgmStep++, s = e % 8, bar = (e / 8) | 0, ch = c.prog[bar % 4], t = bgmNext, v = c.vol ?? 0.7;
    const speed = 1 + Math.min(elapsed(), 60) * 0.003 + (timeLeft < 10 ? 0.08 : 0);
    bgmNext += 60 / (c.bpm * speed) / 2;
    const f = (semi, oct = 1) => c.root * oct * 2 ** ((semi + ch) / 12);
    if (s % 2 === 0) tone(f(0, 0.5), t, 0.25, "triangle", 0.16 * v, undefined, undefined, bgmBus);          // 베이스
    if ((c.drums !== "drone" || s % 4 === 0) && Math.random() < 0.75) {                                     // 멜로디(좌우로 번갈아)
      const idx = (ARP[s] + (bar % 2)) % c.scale.length;
      tone(f(c.scale[idx], 2), t, 0.2, c.wave, 0.07 * v, undefined, ((s % 4) - 1.5) / 3, bgmBus);
    }
    if (c.drums === "pop") {
      if (s % 4 === 0) tone(140, t, 0.16, "sine", 0.3 * v, 45, undefined, bgmBus);
      if (s === 2 || s === 6) noise(t, 0.1, 0.08 * v, 1800, undefined, bgmBus);
      noise(t, 0.03, 0.035 * v, 7000, ((s % 2) - 0.5) / 2, bgmBus);
    } else if (c.drums === "taiko") {
      if (s === 0 || s === 3 || s === 4 || s === 7) tone(100, t, 0.25, "sine", 0.4 * v, 40, undefined, bgmBus);
      if (s === 2 || s === 6) noise(t, 0.1, 0.1 * v, 1000, undefined, bgmBus);
    } else if (c.drums === "drone") {
      if (s === 0) { tone(f(0, 0.5), t, 1.8, "sawtooth", 0.05, undefined, -0.4, bgmBus); tone(f(0, 0.5) * 1.01, t, 1.8, "sawtooth", 0.05, undefined, 0.4, bgmBus); }
      if (s % 4 === 0) tone(80, t, 0.2, "sine", 0.15, 40, undefined, bgmBus);
    }
  }
}

// ---------- 입력 (손가락 끝 / 마우스) ----------
let useMouse = false;
let handLandmarker = null;
const pointers = [];            // 현재 프레임의 포인터: {x, y, px, py, speed}
const trails = [[], []];
const mouse = { x: -100, y: -100, down: false, p: -1e9 };

addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener("pointerdown", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; mouse.p = performance.now(); });
addEventListener("pointerup", () => { mouse.down = false; });

function videoToScreen(lm) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return { x: W - (lm.x * vw * s + ox), y: lm.y * vh * s + oy };   // 거울 반전
}

let lastFist = [], fistCount = [], lastSeen = 0, sizeHist = [], lastPunch = [];
let body = null, bodySeen = 0, lastBodyTime = -1, camOk = false, poseLandmarker = null;   // 몸(전신 포즈) 인식 결과
let lastHands = [], rawPrev = [], camInfo = "", detectMs = 0;
let isDetectingHands = false, isDetectingBody = false, lastDetectTimestamp = 0;
let handVelocities = [{ vx: 0, vy: 0 }, { vx: 0, vy: 0 }]; // 각 손의 속도 벡터 (관성 보외용)

function updatePointers() {
  const prev = pointers.map((p) => ({ x: p.x, y: p.y }));
  pointers.length = 0;
  let pts = [];
  const now = performance.now();

  if (useMouse) {
    pts = [{ x: mouse.x, y: mouse.y }];
  } else if (games[mode]?.body) {                      // 몸 게임: 전신 포즈 인식
    if (poseLandmarker && video.readyState >= 2 && !isDetectingBody) {
      isDetectingBody = true;
      try {
        const t0 = Math.max(now, lastDetectTimestamp + 1);
        lastDetectTimestamp = t0;
        const r = poseLandmarker.detectForVideo(video, t0);
        detectMs = detectMs * 0.9 + (performance.now() - now) * 0.1;
        if (r.landmarks && r.landmarks.length) {
          bodySeen = t0;
          body = r.landmarks[0].map((l, i) => {
            const p = videoToScreen(l), o = body?.[i], v = l.visibility ?? 1;
            return o ? { x: o.x + (p.x - o.x) * 0.72, y: o.y + (p.y - o.y) * 0.72, v } : { ...p, v };
          });
        } else if (t0 - bodySeen > 400) {
          body = null;
        }
      } catch (err) {
        console.warn("포즈 인식 처리 예외:", err);
      } finally {
        isDetectingBody = false;
      }
    }
    camOk = !!body;
    camInfo = (body ? "🧍 전신 인식됨" : "전신이 보이게 한 걸음 뒤로 물러서 주세요") + `  · ${detectMs.toFixed(0)}ms`;
  } else if (handLandmarker && video.readyState >= 2) {
    // rVFC 미지원 환경 대비 rAF 폴백 호출 (isDetectingHands 가드로 중복 방지)
    try { detectHandsNow(); } catch (e) { console.warn("손 인식 오류", e); }
    camInfo = (lastHands.length ? "✋ 초고속 손 추적 중" : "손을 카메라에 보여 주세요 (밝은 곳, 손바닥/검지)") + `  · ${detectMs.toFixed(0)}ms`;
    camOk = lastHands.length > 0;
    pts = lastHands;
  }

  pts.slice(0, 2).forEach((p, i) => {
    const pr = prev[i] ?? p;
    // 적응형 동적 스무딩: 빠르게 휘두르면 즉각 반영(k=0.95), 천천히 움직이면 떨림 제거(k=0.6)
    const dd = Math.hypot(p.x - pr.x, p.y - pr.y);
    const k = Math.min(0.96, Math.max(0.58, 0.58 + dd * 0.015));
    const x = pr.x + (p.x - pr.x) * k;
    const y = pr.y + (p.y - pr.y) * k;
    const curSpeed = Math.hypot(x - pr.x, y - pr.y);

    pointers.push({
      x, y, px: pr.x, py: pr.y,
      speed: curSpeed,
      fist: useMouse ? !mouse.down : !!lastFist[i],
      punch: performance.now() - (useMouse ? mouse.p : lastPunch[i] || -1e9) < 180,
      punchId: useMouse ? mouse.p : lastPunch[i]
    });
  });

  for (let i = 0; i < 2; i++) {
    const t = trails[i], p = pointers[i];
    if (p) {
      t.push({ x: p.x, y: p.y });
      if (t.length > 14) t.shift();
    } else {
      t.length = 0;
    }
  }
}

// 초고속 손 인식 실행: 비동기 락과 관성 보외법(Inertial Extrapolation)으로 프레임 드랍 완벽 방어
function detectHandsNow() {
  if (isDetectingHands || !handLandmarker || video.readyState < 2) return;
  isDetectingHands = true;
  try {
    const now = performance.now();
    const t0 = Math.max(now, lastDetectTimestamp + 1);
    lastDetectTimestamp = t0;

    const r = handLandmarker.detectForVideo(video, t0);
    detectMs = detectMs * 0.9 + (performance.now() - now) * 0.1;

    const palm = $("trackMode").value === "palm" && mode !== "draw";
    reach = palm ? 32 : 8;

    if (r.landmarks && r.landmarks.length > 0) {
      lastSeen = t0;
      const raw = r.landmarks.map((l) => {
        if (!palm) {
          // 검지 끝(8)을 기본으로 하되, 빠른 스윙 시 제2관절(7) 가중치로 떨림 감소
          const tx = l[8].x * 0.85 + l[7].x * 0.15;
          const ty = l[8].y * 0.85 + l[7].y * 0.15;
          return videoToScreen({ x: tx, y: ty });
        }
        const ids = [0, 5, 9, 13, 17];
        return videoToScreen({
          x: ids.reduce((s, i) => s + l[i].x, 0) / 5,
          y: ids.reduce((s, i) => s + l[i].y, 0) / 5
        });
      });

      // 펀치 판별: 카메라 방향 전진 모션 급가속 감지
      const vw = video.videoWidth, vh = video.videoHeight;
      r.landmarks.forEach((l, i) => {
        const s = Math.hypot((l[9].x - l[0].x) * vw, (l[9].y - l[0].y) * vh);
        const h = (sizeHist[i] ??= []);
        h.push({ t: t0, s });
        while (h.length && t0 - h[0].t > 380) h.shift();
        const old = h.find((e) => t0 - e.t >= 90 && t0 - e.t <= 280);
        if (old && s / old.s > 1.22 && t0 - (lastPunch[i] || 0) > 300) {
          lastPunch[i] = t0;
        }
      });

      // 주먹 판별
      lastFist = r.landmarks.map((l, i) => {
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 1.2);
        const allFolded = [[8, 5], [12, 9], [16, 13], [20, 17]].every(([t, m]) => d(l[t], l[0]) < d(l[m], l[0]) * 0.92);
        fistCount[i] = allFolded ? (fistCount[i] || 0) + 1 : 0;
        return fistCount[i] >= 4;
      });

      // 속도 벡터 계산 및 관성 보정 (Inertial Lead)
      lastHands = raw.map((p, i) => {
        const o = rawPrev[i];
        let vx = 0, vy = 0;
        if (o) {
          const rawVx = p.x - o.x;
          const rawVy = p.y - o.y;
          // 비정상적 순간이동 클램핑
          const dist = Math.hypot(rawVx, rawVy);
          const maxStep = W * 0.35;
          const scale = dist > maxStep ? maxStep / dist : 1;
          vx = rawVx * scale;
          vy = rawVy * scale;
        }
        handVelocities[i] = {
          vx: handVelocities[i].vx * 0.25 + vx * 0.75,
          vy: handVelocities[i].vy * 0.25 + vy * 0.75
        };
        // 체감 지연 0을 위한 예측 보외 위치 전진
        return {
          x: p.x + handVelocities[i].vx * 0.45,
          y: p.y + handVelocities[i].vy * 0.45
        };
      });
      rawPrev = raw;
    } else {
      // 💥 핵심 혁신: 손을 너무 빠르게 휘둘러 1~2프레임 미인식되더라도
      // 직전 관성 속도를 유지하여 자연스럽게 앞으로 진행시켜 끊김을 원천 방지!
      const dtMs = t0 - lastSeen;
      if (dtMs < 250 && lastHands.length > 0) {
        lastHands = lastHands.map((p, i) => {
          const vel = handVelocities[i] || { vx: 0, vy: 0 };
          vel.vx *= 0.82; // 관성 감쇠
          vel.vy *= 0.82;
          return {
            x: Math.max(0, Math.min(W, p.x + vel.vx * 0.5)),
            y: Math.max(0, Math.min(H, p.y + vel.vy * 0.5))
          };
        });
      } else if (dtMs >= 250) {
        lastHands = [];
        lastFist = [];
        fistCount = [];
        rawPrev = [];
        sizeHist = [];
        handVelocities = [{ vx: 0, vy: 0 }, { vx: 0, vy: 0 }];
      }
    }
  } catch (err) {
    console.warn("손 인식 파이프라인 예외 보호:", err);
  } finally {
    isDetectingHands = false;
  }
}

// ============================================================================
// 🔒 보안 계층: Web Crypto API 기반 AES-256-GCM 저장소 & 체크포인트 (Zero-Trust)
// ============================================================================
const SecureStore = {
  key: null,
  async init() {
    try {
      const raw = localStorage.getItem("__sec_seed__");
      let seed;
      if (raw) {
        seed = new Uint8Array(JSON.parse(raw));
      } else {
        seed = crypto.getRandomValues(new Uint8Array(32));
        localStorage.setItem("__sec_seed__", JSON.stringify(Array.from(seed)));
      }
      this.key = await crypto.subtle.importKey("raw", seed, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    } catch (e) {
      console.warn("보안 키 초기화 폴백:", e);
    }
  },
  async saveCheckpoint(key, data) {
    try {
      if (!this.key) await this.init();
      if (!this.key) { localStorage.setItem(key, JSON.stringify(data)); return; }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder().encode(JSON.stringify(data));
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, enc);
      const payload = { iv: Array.from(iv), cipher: Array.from(new Uint8Array(cipher)) };
      localStorage.setItem(`__enc_${key}`, JSON.stringify(payload));
    } catch (err) {
      try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
    }
  },
  async loadCheckpoint(key, defaultVal = null) {
    try {
      if (!this.key) await this.init();
      const raw = localStorage.getItem(`__enc_${key}`);
      if (!raw) {
        const plain = localStorage.getItem(key);
        return plain ? JSON.parse(plain) : defaultVal;
      }
      const { iv, cipher } = JSON.parse(raw);
      const dec = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        this.key,
        new Uint8Array(cipher)
      );
      return JSON.parse(new TextDecoder().decode(dec));
    } catch {
      return defaultVal;
    }
  }
};
SecureStore.init();

// ---------- 공통 효과 ----------
let particles = [], popups = [];
function burst(x, y, color, n = 14) {
  try {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 6;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color, size: 3 + Math.random() * 4 });
    }
  } catch {}
}
function popup(x, y, text, color = "#fff") {
  try { popups.push({ x, y, text, color, life: 1 }); } catch {}
}

function drawFx() {
  try {
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life -= 0.03;
      ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size || 5, 0, 7); ctx.fill();
    }
    popups = popups.filter((p) => p.life > 0);
    ctx.textAlign = "center"; ctx.font = "900 36px 'Rubik', sans-serif";
    for (const p of popups) {
      p.y -= 1.6; p.life -= 0.02;
      ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      ctx.fillText(p.text, p.x, p.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  } catch {}
}

function drawTrails(color) {
  try {
    const col = typeof color === "function" ? color : () => color;
    for (let i = 0; i < trails.length; i++) {
      const t = trails[i];
      for (let j = 1; j < t.length; j++) {
        const curCol = col(pointers[i] ?? t[j]);
        ctx.strokeStyle = curCol; ctx.globalAlpha = (j / t.length) * 0.85;
        ctx.lineWidth = 4 + (j / t.length) * 14; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(t[j - 1].x, t[j - 1].y); ctx.lineTo(t[j].x, t[j].y); ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    for (const p of pointers) {
      const curCol = col(p);
      // 포인터 중심 네온 링
      ctx.save();
      ctx.shadowColor = curCol; ctx.shadowBlur = 16;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 14 + reach * 0.5, 0, 7); ctx.fill();
      ctx.strokeStyle = curCol; ctx.lineWidth = 5; ctx.stroke();
      ctx.restore();
    }
  } catch {}
}

// 선분(a→b)과 원의 충돌: 빠른 휘두름 시 터널링 방지를 위해 속도 비례 스윕 반경 확장
let reach = 0;
function segHitsCircle(ax, ay, bx, by, cx, cy, r) {
  const sweep = Math.min(Math.hypot(bx - ax, by - ay) * 0.4, 45);
  r += reach + sweep;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx - cx, ay + t * dy - cy) <= r;
}

// ---------- 웨이브 / 스테이지 단계 시스템 ----------
let currentWave = 1;        // 1: WAVE 1, 2: WAVE 2, 3: FEVER
let isFeverTime = false;    // 피버 타임 여부 (점수 2배, 폭풍 스폰)
let waveBannerTimeout = null;

function triggerWaveBanner(text, sub, isFever = false) {
  try {
    const banner = $("waveBanner");
    const bannerText = $("waveBannerText");
    const bannerSub = $("waveBannerSub");
    const feverBorder = $("feverBorder");
    const stageWave = $("stageWave");
    if (!banner) return;

    bannerText.textContent = text;
    bannerSub.textContent = sub;
    banner.classList.remove("hidden", "fever-mode");
    if (isFever) {
      banner.classList.add("fever-mode");
      if (feverBorder) feverBorder.classList.remove("hidden");
      if (stageWave) {
        stageWave.textContent = "🔥 FEVER";
        stageWave.classList.add("fever");
      }
    } else {
      if (feverBorder) feverBorder.classList.add("hidden");
      if (stageWave) {
        stageWave.textContent = text;
        stageWave.classList.remove("fever");
      }
    }

    // 애니메이션 리셋 및 재실행
    banner.style.animation = "none";
    banner.offsetHeight; // reflow
    banner.style.animation = "";

    clearTimeout(waveBannerTimeout);
    waveBannerTimeout = setTimeout(() => {
      try { banner.classList.add("hidden"); } catch {}
    }, 1600);
  } catch {}
}

// ---------- 콤보 & 피버: 연속 타격 보너스 및 피버 2배 혜택 ----------
let combo = 0, comboTimer = 0, maxCombo = 0;
const COMBO_WINDOW = 1.05; // 빠른 액션 속에서도 콤보가 여유롭게 이어지도록 보정
function award(x, y, pts, color = "#fff") {
  combo = comboTimer > 0 ? combo + 1 : 1;
  comboTimer = COMBO_WINDOW; maxCombo = Math.max(maxCombo, combo);
  const bonus = combo >= 3 ? Math.min(combo - 2, 10) : 0;
  
  // 🔥 피버 타임일 때는 기본 획득 점수 2배!
  const multiplier = isFeverTime ? 2 : 1;
  const gained = (pts + bonus) * multiplier;
  score += gained;

  const popupText = isFeverTime ? `+${gained} FEVER!` : `+${gained}`;
  popup(x, y, popupText, isFeverTime ? "#ff0055" : (bonus ? "#fbb500" : color));

  if (combo >= 3) sfx.combo(combo);
  if (combo === 5) speak("5 콤보!");
  else if (combo === 10) speak("10 콤보! 대단해요!", true);
  else if (combo === 20) speak("20 콤보! 슈퍼스타!", true);
}
function drawCombo() {
  if (combo < 2 || comboTimer <= 0) return;
  const k = Math.min(comboTimer / COMBO_WINDOW, 1);
  ctx.save();
  ctx.globalAlpha = 0.5 + k * 0.5; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `900 ${46 + Math.min(combo, 15) * 3}px 'Rubik', sans-serif`;
  ctx.shadowColor = combo >= 5 ? "#ff5e92" : "#fbb500"; ctx.shadowBlur = 24;
  ctx.lineWidth = 8; ctx.strokeStyle = "rgba(20,6,43,.9)"; ctx.fillStyle = combo >= 5 ? "#ff5e92" : "#fbb500";
  const t = `⚡ ${combo} COMBO!`, y = H * 0.22;
  ctx.strokeText(t, W / 2, y); ctx.fillText(t, W / 2, y);
  ctx.shadowBlur = 0;
  // 남은 콤보 시간 바 (네온 캔디 프로그레스)
  ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.roundRect(W / 2 - 82, y + 32, 164, 10, 5); ctx.fill();
  ctx.fillStyle = combo >= 5 ? "#00d2ff" : "#fbb500";
  ctx.beginPath(); ctx.roundRect(W / 2 - 80, y + 34, 160 * k, 6, 3); ctx.fill();
  ctx.restore();
}

// ============================================================================
// 🎨 생동감 넘치는 캐릭터 & 그래픽 렌더러 모듈 (Art)
// ============================================================================
const Art = {
  // 1. 생동감 넘치는 캐릭터 풍선 (3D 젤리 쉐이딩 + 방긋 웃는 표정 + 왕관 + 끈)
  drawBalloon(x, y, r, color, gold) {
    try {
      const now = performance.now() * 0.003;
      // 흔들리는 끈과 매듭
      ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y + r);
      const wave = Math.sin(now + x) * 8;
      ctx.quadraticCurveTo(x + wave, y + r * 1.6, x + wave * 0.5, y + r * 2.3);
      ctx.stroke();

      // 리본 매듭
      ctx.fillStyle = gold ? "#ffd700" : color;
      ctx.beginPath();
      ctx.moveTo(x - 5, y + r + 4); ctx.lineTo(x + 5, y + r + 4); ctx.lineTo(x, y + r); ctx.closePath();
      ctx.fill();

      // 3D 젤리 풍선 구체 그라디언트
      const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r * 1.05);
      if (gold) {
        grad.addColorStop(0, "#fff8db"); grad.addColorStop(0.4, "#ffd700"); grad.addColorStop(1, "#c68a00");
      } else {
        grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.3, color); grad.addColorStop(1, "rgba(0,0,0,0.25)");
      }
      ctx.save();
      if (gold) { ctx.shadowColor = "rgba(255,215,0,0.6)"; ctx.shadowBlur = 14; }   // 일반 풍선은 그림자 생략(성능)
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.88, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // 상단 젤리 광택 하이라이트
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath();
      ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.22, r * 0.34, 0.45, 0, Math.PI * 2);
      ctx.fill();

      // 귀여운 캐릭터 얼굴 (깜빡이는 눈 + 핑크 볼터치 + 미소)
      const blink = Math.sin(now * 1.5 + x) > 0.94;
      const eyeOffX = r * 0.24, eyeY = y - r * 0.05, eyeR = r * 0.07;
      // 눈
      ctx.fillStyle = gold ? "#4a3500" : "#221439";
      if (blink) {
        ctx.lineWidth = 2.5; ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath(); ctx.arc(x - eyeOffX, eyeY, eyeR, Math.PI, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + eyeOffX, eyeY, eyeR, Math.PI, 0); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x - eyeOffX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + eyeOffX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
        // 눈동자 하이라이트
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x - eyeOffX - 1.5, eyeY - 1.5, eyeR * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + eyeOffX - 1.5, eyeY - 1.5, eyeR * 0.4, 0, Math.PI * 2); ctx.fill();
      }

      // 핑크 볼터치
      ctx.fillStyle = "rgba(255, 105, 180, 0.55)";
      ctx.beginPath(); ctx.arc(x - eyeOffX * 1.5, eyeY + r * 0.12, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + eyeOffX * 1.5, eyeY + r * 0.12, r * 0.1, 0, Math.PI * 2); ctx.fill();

      // 방긋 웃는 입
      ctx.strokeStyle = gold ? "#4a3500" : "#221439"; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(x, eyeY + r * 0.1, r * 0.14, 0.1, Math.PI - 0.1); ctx.stroke();

      // 황금 풍선 왕관 및 스파클
      if (gold) {
        ctx.fillStyle = "#ffde59"; ctx.strokeStyle = "#b37400"; ctx.lineWidth = 2;
        const cw = r * 0.45, ch = r * 0.32, cy = y - r * 0.95;
        ctx.beginPath();
        ctx.moveTo(x - cw, cy); ctx.lineTo(x - cw * 0.5, cy + ch * 0.4); ctx.lineTo(x, cy - ch * 0.2);
        ctx.lineTo(x + cw * 0.5, cy + ch * 0.4); ctx.lineTo(x + cw, cy);
        ctx.lineTo(x + cw * 0.7, cy + ch); ctx.lineTo(x - cw * 0.7, cy + ch);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    } catch {}
  },

  // 2. 신선한 과일 벡터 그래픽 (수박, 사과, 오렌지, 파인애플, 딸기, 폭탄)
  drawFruit(x, y, r, emoji, rot, half = 0) {
    try {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);

      if (half !== 0) {
        // 반으로 잘렸을 때 클리핑 및 살짝 벌어짐
        ctx.beginPath(); ctx.rect(half < 0 ? -r * 1.8 : 0, -r * 1.8, r * 1.8, r * 3.6); ctx.clip();
      }

      if (emoji === "🍉") {
        // 싱싱한 수박 (초록 껍질 + 선홍빛 과육 + 검은 씨앗)
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = "#1e7e34"; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = "#145223"; ctx.stroke();
        // 줄무늬
        ctx.strokeStyle = "#0b3d16"; ctx.lineWidth = 3.5;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
          ctx.beginPath(); ctx.arc(0, 0, r * 0.95, a, a + 0.35); ctx.stroke();
        }
        if (half !== 0) {
          // 단면 과육
          ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
          ctx.fillStyle = "#ff4d6d"; ctx.fill();
          // 씨앗
          ctx.fillStyle = "#1a1a1a";
          [-r * 0.35, 0, r * 0.35].forEach((sx) => {
            ctx.beginPath(); ctx.ellipse(sx, -r * 0.15, 3.5, 6, 0.2, 0, Math.PI * 2); ctx.fill();
          });
        }
      } else if (emoji === "🍊") {
        // 상큼한 오렌지 (주황 구형 + 광택 + 초록 잎사귀)
        const rg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
        rg.addColorStop(0, "#ffb703"); rg.addColorStop(1, "#fb8500");
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        // 잎사귀
        ctx.fillStyle = "#2ec4b6";
        ctx.beginPath(); ctx.ellipse(r * 0.2, -r * 0.85, r * 0.3, r * 0.15, -0.6, 0, Math.PI * 2); ctx.fill();
      } else if (emoji === "🍎") {
        // 윤기 나는 사과
        const rg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
        rg.addColorStop(0, "#ff6b8b"); rg.addColorStop(0.7, "#d90429"); rg.addColorStop(1, "#7f0019");
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        // 꼭지 & 잎
        ctx.strokeStyle = "#582f0e"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -r * 0.6); ctx.lineTo(3, -r * 1.05); ctx.stroke();
        ctx.fillStyle = "#70e000"; ctx.beginPath(); ctx.ellipse(r * 0.25, -r * 0.9, r * 0.25, r * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
      } else if (emoji === "💣") {
        // 불타는 심지의 다크 메탈릭 폭탄
        const rg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
        rg.addColorStop(0, "#4a5568"); rg.addColorStop(0.7, "#1a202c"); rg.addColorStop(1, "#0d1117");
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        // 폭탄 노즐 & 심지
        ctx.fillStyle = "#718096"; ctx.fillRect(-r * 0.2, -r * 1.1, r * 0.4, r * 0.25);
        ctx.strokeStyle = "#d69e2e"; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(0, -r * 1.1); ctx.quadraticCurveTo(r * 0.3, -r * 1.4, r * 0.45, -r * 1.35); ctx.stroke();
        // 타오르는 스파크 불꽃
        ctx.fillStyle = "#ff4d4d"; ctx.shadowColor = "#ff2a2a"; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(r * 0.45, -r * 1.35, 7 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffea00"; ctx.beginPath(); ctx.arc(r * 0.45, -r * 1.35, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // 해골 또는 경고 마크
        ctx.fillStyle = "#ff4d4d"; ctx.font = `900 ${r * 0.8}px 'Rubik', sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("☠️", 0, 0);
      } else {
        // 기본 과일 이모지 (고해상도 렌더링)
        ctx.font = `${r * 1.8}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(emoji, 0, 0);
      }
      ctx.restore();
    } catch {}
  },

  // 3. 입체적인 두더지 & 황금 토끼 마스코트 렌더러
  drawMole(cx, cy, r, age, life, hit, isRabbit) {
    try {
      const now = performance.now() * 0.003;
      // 흙 구멍 및 잔디 림
      ctx.save();
      // 흙 구멍 내부 그림자
      ctx.fillStyle = "rgba(10, 5, 2, 0.85)";
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.15, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      // 잔디 림 하이라이트
      ctx.strokeStyle = "#40916c"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, r * 1.18, r * 0.44, 0, 0.2, Math.PI - 0.2); ctx.stroke();

      // 클리핑: 구멍 밖으로만 머리가 나오도록
      ctx.beginPath(); ctx.rect(cx - r * 2, cy - r * 3.2, r * 4, r * 3.25); ctx.clip();

      const t = Math.min(age / 0.16, 1, (life - age) / 0.16);
      const my = cy - r * 0.95 * Math.max(t, 0) + r * 0.35;

      if (isRabbit) {
        // 🐰 보너스 황금 토끼 캐릭터
        // 긴 귀
        ctx.fillStyle = "#fff8e7"; ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(cx - r * 0.32, my - r * 0.75, r * 0.18, r * 0.48, -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx + r * 0.32, my - r * 0.75, r * 0.18, r * 0.48, 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // 핑크 안쪽 귀
        ctx.fillStyle = "#ffb0c9";
        ctx.beginPath(); ctx.ellipse(cx - r * 0.32, my - r * 0.75, r * 0.09, r * 0.32, -0.15, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + r * 0.32, my - r * 0.75, r * 0.09, r * 0.32, 0.15, 0, Math.PI * 2); ctx.fill();
        // 얼굴
        ctx.fillStyle = "#fffdf7";
        ctx.beginPath(); ctx.arc(cx, my, r * 0.65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        // 🐹 귀여운 두더지 캐릭터
        // 몸체 / 머리
        const rg = ctx.createRadialGradient(cx - r * 0.2, my - r * 0.2, r * 0.1, cx, my, r * 0.7);
        rg.addColorStop(0, "#d4a373"); rg.addColorStop(1, "#8d5b32");
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(cx, my, r * 0.65, 0, Math.PI * 2); ctx.fill();

        // 탐험가 안전모 모자 (노란 헬멧)
        ctx.fillStyle = "#ffd166"; ctx.strokeStyle = "#b38600"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cx, my - r * 0.45, r * 0.55, r * 0.32, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
        // 헬멧 림
        ctx.beginPath(); ctx.roundRect(cx - r * 0.65, my - r * 0.48, r * 1.3, r * 0.14, 4); ctx.fill(); ctx.stroke();
      }

      // 눈 / 표정
      if (hit) {
        // 맞았을 때: 뱅글뱅글 @ @ 회전 눈
        ctx.strokeStyle = "#d90429"; ctx.lineWidth = 3;
        [-r * 0.22, r * 0.22].forEach((ox) => {
          ctx.beginPath();
          for (let th = 0; th < Math.PI * 4; th += 0.3) {
            const rad = 2 + th * 2.2;
            const px = cx + ox + Math.cos(th + now * 8) * rad, py = my - r * 0.08 + Math.sin(th + now * 8) * rad;
            if (th === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        });
      } else {
        // 생생한 눈동자
        ctx.fillStyle = "#221439";
        ctx.beginPath(); ctx.arc(cx - r * 0.22, my - r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r * 0.22, my - r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(cx - r * 0.24, my - r * 0.11, r * 0.04, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r * 0.2, my - r * 0.11, r * 0.04, 0, Math.PI * 2); ctx.fill();
      }

      // 동그란 코와 수염
      ctx.fillStyle = isRabbit ? "#ff70a6" : "#4a2810";
      ctx.beginPath(); ctx.ellipse(cx, my + r * 0.1, r * 0.12, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();

      // 수염
      ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 2;
      [-1, 1].forEach((dir) => {
        ctx.beginPath(); ctx.moveTo(cx + dir * r * 0.2, my + r * 0.1); ctx.lineTo(cx + dir * r * 0.55, my + r * 0.05); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + dir * r * 0.2, my + r * 0.15); ctx.lineTo(cx + dir * r * 0.52, my + r * 0.25); ctx.stroke();
      });

      ctx.restore();
    } catch {}
  },

  // 4. 불타는 코즈믹 유성 렌더러
  drawMeteor(c, c0, r, o) {
    try {
      ctx.save();
      // 플라즈마 화염 꼬리
      const g = ctx.createLinearGradient(c0.x, c0.y, c.x, c.y);
      g.addColorStop(0, "rgba(255, 60, 0, 0)");
      g.addColorStop(0.5, "rgba(255, 140, 0, 0.45)");
      g.addColorStop(1, "rgba(255, 230, 0, 0.85)");
      ctx.strokeStyle = g; ctx.lineWidth = r * 1.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c.x, c.y); ctx.stroke();

      // 마그마 운석 핵
      ctx.translate(c.x, c.y); ctx.rotate(o.rot);
      const rg = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
      if (o.hitFlash > 0) {
        rg.addColorStop(0, "#ffffff"); rg.addColorStop(1, "#ff9a4d");
      } else {
        rg.addColorStop(0, o.big ? "#ff7b00" : "#ffb703");
        rg.addColorStop(0.6, o.big ? "#9d0208" : "#873200");
        rg.addColorStop(1, "#370617");
      }
      ctx.shadowColor = "#ff5400"; ctx.shadowBlur = 16;
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // 크레이터 분화구
      ctx.fillStyle = "rgba(40, 0, 10, 0.45)";
      for (let k = 0; k < 4; k++) {
        const a = o.seed * (k + 1), d = r * (0.2 + ((o.seed * (k + 3)) % 5) / 10);
        ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.13 + k * 0.04), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      // 체력 배지
      if (o.big) {
        ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.max(14, r * 0.45)}px 'Rubik', sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowColor = "#000"; ctx.shadowBlur = 6;
        ctx.fillText("x" + o.hp, c.x, c.y);
        ctx.shadowBlur = 0;
      }
    } catch {}
  },

  // 5. 쿵푸 파이터 캐릭터 렌더러 (닌자, 오니 도깨비, 폭탄)
  drawKungfuFighter(c, r, o) {
    try {
      ctx.save();
      ctx.translate(c.x, c.y);

      if (o.type === "ninja") {
        // 복면 닌자 캐릭터
        // 두건 머리
        ctx.fillStyle = "#1e1e2f";
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        // 붉은 머리띠
        ctx.fillStyle = "#e63946";
        ctx.beginPath(); ctx.roundRect(-r * 0.95, -r * 0.45, r * 1.9, r * 0.28, 4); ctx.fill();
        // 머리띠 꼬리 리본
        ctx.beginPath(); ctx.moveTo(r * 0.8, -r * 0.4); ctx.lineTo(r * 1.3, -r * 0.6); ctx.lineTo(r * 1.25, -r * 0.2); ctx.closePath(); ctx.fill();
        // 눈 주변 피부 영역
        ctx.fillStyle = "#ffd166";
        ctx.beginPath(); ctx.roundRect(-r * 0.75, -r * 0.15, r * 1.5, r * 0.35, 6); ctx.fill();
        // 날카로운 눈빛
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(-r * 0.35, 0, r * 0.12, r * 0.08, -0.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.35, 0, r * 0.12, r * 0.08, 0.2, 0, Math.PI * 2); ctx.fill();
        // 안광
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(-r * 0.33, -r * 0.03, r * 0.04, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.37, -r * 0.03, r * 0.04, 0, Math.PI * 2); ctx.fill();
      } else if (o.type === "oni") {
        // 도깨비 오니 캐릭터 (붉은 얼굴 + 황금 뿔 2개 + 송곳니)
        // 뿔
        ctx.fillStyle = "#ffd166"; ctx.strokeStyle = "#b38600"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.4); ctx.lineTo(-r * 0.75, -r * 1.15); ctx.lineTo(-r * 0.25, -r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.4); ctx.lineTo(r * 0.75, -r * 1.15); ctx.lineTo(r * 0.25, -r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        // 얼굴
        const rg = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
        rg.addColorStop(0, "#ff4d6d"); rg.addColorStop(1, "#a4133c");
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        // 부릅뜬 눈
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.1, r * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.1, r * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.1, r * 0.09, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.1, r * 0.09, 0, Math.PI * 2); ctx.fill();
        // 입과 송곳니
        ctx.fillStyle = "#590d22";
        ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 0.45, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        // 아래 위로 돋아난 송곳니
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.moveTo(-r * 0.22, r * 0.55); ctx.lineTo(-r * 0.16, r * 0.28); ctx.lineTo(-r * 0.1, r * 0.55); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(r * 0.1, r * 0.55); ctx.lineTo(r * 0.16, r * 0.28); ctx.lineTo(r * 0.22, r * 0.55); ctx.closePath(); ctx.fill();
      } else {
        // 폭탄
        this.drawFruit(0, 0, r, "💣", 0, 0);
      }

      // 위협적인 접근 경고 느낌표
      if (o.type !== "bomb" && o.z > 0.78) {
        ctx.fillStyle = "#ff0055"; ctx.font = `900 ${r * 0.9}px 'Rubik', sans-serif`;
        ctx.shadowColor = "#ff0055"; ctx.shadowBlur = 10;
        ctx.fillText("!", r * 0.9, -r * 0.8);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    } catch {}
  },

  // 6. 점핑 러너 캐릭터 (생동감 넘치는 캥거루/토끼 마스코트)
  drawRunnerMascot(cx, gy, jy, hs, duck, dist, inv) {
    try {
      const fy = gy - jy;
      const ch = duck ? hs * 0.58 : hs;
      const top = fy - ch;
      const ph = dist * 0.04;
      const air = jy > 0;

      ctx.save();
      ctx.globalAlpha = inv > 0 && ((inv * 10) | 0) % 2 ? 0.4 : 1;

      // 발밑 달리기 먼지 구름 파티클
      if (!air && Math.sin(ph * 2) > 0.4) {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.arc(cx - hs * 0.4, gy - 6, 6 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
      }

      // 머리 위치
      const headX = cx + (duck ? hs * 0.15 : 0);
      const headY = top + hs * 0.16;
      const headR = hs * 0.18;

      // 쫑긋한 귀 (달릴 때 뒤로 살랑거림)
      const earSwing = air ? 0.3 : Math.sin(ph) * 0.2;
      ctx.fillStyle = "#ffb0c9"; ctx.strokeStyle = "#e1037d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(headX - headR * 0.6, headY - headR * 1.3, headR * 0.35, headR * 0.85, -0.3 + earSwing, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(headX + headR * 0.4, headY - headR * 1.3, headR * 0.35, headR * 0.85, 0.2 + earSwing, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // 머리 구체 (귀여운 마스코트)
      ctx.fillStyle = "#ffd166"; ctx.strokeStyle = "#c68a00"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(headX, headY, headR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // 바이저 / 헤어밴드
      ctx.fillStyle = "#00d2ff";
      ctx.beginPath(); ctx.roundRect(headX - headR * 0.95, headY - headR * 0.4, headR * 1.9, headR * 0.4, 4); ctx.fill();

      // 반짝이는 눈
      ctx.fillStyle = "#221439";
      ctx.beginPath(); ctx.arc(headX + headR * 0.3, headY - headR * 0.15, headR * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(headX + headR * 0.35, headY - headR * 0.22, headR * 0.08, 0, Math.PI * 2); ctx.fill();

      // 볼터치
      ctx.fillStyle = "rgba(255, 93, 143, 0.65)";
      ctx.beginPath(); ctx.arc(headX + headR * 0.4, headY + headR * 0.25, headR * 0.2, 0, Math.PI * 2); ctx.fill();

      // 몸통 & 팔다리 애니메이션
      const hip = fy - (duck ? hs * 0.22 : hs * 0.45);
      const sw = air ? 0.35 : Math.sin(ph) * 0.8;

      // 몸통
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = hs * 0.1; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(headX, headY + headR * 0.6); ctx.lineTo(cx, hip); ctx.stroke();

      // 팔
      ctx.strokeStyle = "#fbb500"; ctx.lineWidth = hs * 0.08;
      ctx.beginPath(); ctx.moveTo(headX, headY + headR * 0.8); ctx.lineTo(headX + sw * hs * 0.35, headY + hs * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(headX, headY + headR * 0.8); ctx.lineTo(headX - sw * hs * 0.35, headY + hs * 0.3); ctx.stroke();

      // 다리
      ctx.strokeStyle = "#00d2ff"; ctx.lineWidth = hs * 0.09;
      ctx.beginPath(); ctx.moveTo(cx, hip); ctx.lineTo(cx + sw * hs * 0.35, fy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, hip); ctx.lineTo(cx - sw * hs * 0.35, fy - (air ? hs * 0.15 : 0)); ctx.stroke();

      ctx.restore();
    } catch {}
  },

  // 7. 네온 아케이드 벽돌 & 패들 & 에너지 볼
  drawBrickPaddle(px, py, pw, ball) {
    try {
      // 3D 네온 패들
      ctx.save();
      ctx.shadowColor = "#00d2ff"; ctx.shadowBlur = 18;
      const pg = ctx.createLinearGradient(px - pw / 2, py, px + pw / 2, py);
      pg.addColorStop(0, "#00d2ff"); pg.addColorStop(0.5, "#ffffff"); pg.addColorStop(1, "#00d2ff");
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.roundRect(px - pw / 2, py, pw, 18, 9); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#e1037d"; ctx.stroke();
      ctx.shadowBlur = 0;

      // 플라즈마 에너지 볼
      ctx.shadowColor = "#ffd166"; ctx.shadowBlur = 20;
      const bg = ctx.createRadialGradient(ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.1, ball.x, ball.y, ball.r);
      bg.addColorStop(0, "#ffffff"); bg.addColorStop(0.4, "#ffd166"); bg.addColorStop(1, "#ff6b4a");
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } catch {}
  }
};

// ---------- 게임들 ----------
const COLORS = ["#ff5d73", "#ffd166", "#4cc9f0", "#80ed99", "#c77dff", "#ff9a4d"];
let objs = [], spawnTimer = 0;
const games = {
  balloon: {
    bg: "#2a2a5a",
    spawn() {
      // 피버 타임 시 황금 풍선 출현율 대폭 증가(40%) 및 속도감 증가
      const isGold = isFeverTime ? (Math.random() < 0.42) : (currentWave === 2 ? Math.random() < 0.16 : Math.random() < 0.08);
      const r = 38 + Math.random() * 28;
      const speedBonus = currentWave === 3 ? 1.4 : currentWave === 2 ? 1.2 : 1.0;
      objs.push({
        x: r + Math.random() * (W - 2 * r),
        y: H + r,
        r,
        vy: -(1.6 + Math.random() * 2.2) * (H / 800) * speedBonus,
        color: isGold ? "#ffd700" : COLORS[(Math.random() * COLORS.length) | 0],
        gold: isGold
      });
    },
    interval: () => Math.max(0.24, (0.58 - elapsed() * 0.005)),
    update(dt) {
      for (const o of objs) o.y += o.vy * dt * 60 * (1 + elapsed() * 0.006);
      objs = objs.filter((o) => o.y > -o.r * 2);
      for (const p of pointers) for (const o of objs) {
        if (!o.dead && segHitsCircle(p.px, p.py, p.x, p.y, o.x, o.y, o.r + 12)) {
          o.dead = true;
          const pts = o.gold ? 5 : 1;
          burst(o.x, o.y, o.color, o.gold ? 24 : 14);
          award(o.x, o.y, pts, o.gold ? "#ffd700" : "#fff");
          sfx.pop(o.x, o.gold);
        }
      }
      objs = objs.filter((o) => !o.dead);
    },
    draw() {
      for (const o of objs) {
        Art.drawBalloon(o.x, o.y, o.r, o.color, o.gold);
      }
    },
    trail: "#ffffff",
  },

  ninja: {
    bg: "#16332c",
    FRUITS: ["🍉", "🍊", "🍎", "🍍", "🍓", "🍌"],
    spawn() {
      // 피버 타임에는 폭탄 0%, 과일 대량 연속 투척! 2단계는 과일 2개 동시 투척 확률 35%
      const spawnCount = isFeverTime ? 2 : (currentWave === 2 && Math.random() < 0.35 ? 2 : 1);
      for (let s = 0; s < spawnCount; s++) {
        const bomb = isFeverTime ? false : Math.random() < 0.16;
        const r = 44;
        const x = r + Math.random() * (W - 2 * r);
        const g = 0.35 * (H / 800);
        const vy = -Math.sqrt(2 * g * H * (0.55 + Math.random() * 0.3));
        objs.push({
          x, y: H + r, r,
          vx: ((W / 2 - x) / W) * 5 + (Math.random() - 0.5) * 2.5,
          vy, g, bomb,
          emoji: bomb ? "💣" : this.FRUITS[(Math.random() * this.FRUITS.length) | 0],
          rot: 0, vr: (Math.random() - 0.5) * 0.16
        });
      }
    },
    interval: () => Math.max(0.28, (0.75 - elapsed() * 0.007)),
    update(dt) {
      for (const o of objs) { o.x += o.vx * dt * 60; o.y += o.vy * dt * 60; o.vy += o.g * dt * 60; o.rot += o.vr; }
      for (const p of pointers) {
        // 빠른 베기 반응성 보장 (스피드 임계치 10으로 완화)
        if (p.speed < 10) continue;
        for (const o of objs) {
          if (o.dead || !segHitsCircle(p.px, p.py, p.x, p.y, o.x, o.y, o.r + 8)) continue;
          o.dead = true;
          if (o.bomb) {
            score = Math.max(0, score - 5); combo = 0;
            burst(o.x, o.y, "#ff3030", 28); popup(o.x, o.y, "-5", "#ff5d5d");
            sfx.bomb(o.x); speak("앗, 폭탄!");
          } else {
            burst(o.x, o.y, "#ff5d73", 22);
            award(o.x, o.y, 1);
            sfx.slice(o.x);
            halves.push({ ...o, half: -1 }, { ...o, half: 1 });
          }
        }
      }
      objs = objs.filter((o) => !o.dead && o.y < H + 200);
      for (const h of halves) {
        h.x += h.half * 3.5; h.y += h.vy * dt * 60; h.vy += h.g * dt * 60; h.rot += h.half * 0.14;
        h.life = (h.life ?? 1) - 0.016;
      }
      halves = halves.filter((h) => h.life > 0);
    },
    draw() {
      for (const o of objs) {
        Art.drawFruit(o.x, o.y, o.r, o.emoji, o.rot, 0);
      }
      for (const h of halves) {
        ctx.save(); ctx.globalAlpha = Math.max(h.life, 0);
        Art.drawFruit(h.x, h.y, h.r, h.emoji, h.rot, h.half);
        ctx.restore();
      }
    },
    trail: "#00d2ff",
  },
};
let halves = [];

// 🐹 두더지 잡기: 3x3 구멍에서 두더지가 올라옴. 웨이브별 스피드업 및 피버 보너스
function holeCenter(i) {
  const col = i % 3, row = (i / 3) | 0;
  return { x: W * (0.2 + col * 0.3), y: H * (0.34 + row * 0.26) };
}
games.mole = {
  bg: "#26183d",
  spawn() {
    const free = [...Array(9).keys()].filter((i) => !objs.some((o) => o.hole === i));
    if (!free.length) return;
    const rabbitChance = isFeverTime ? 0.45 : (currentWave === 2 ? 0.22 : 0.12);
    objs.push({
      hole: free[(Math.random() * free.length) | 0],
      age: 0,
      life: Math.max(0.65, (1.5 - elapsed() * 0.012) * (isFeverTime ? 0.75 : 1)),
      isRabbit: Math.random() < rabbitChance
    });
  },
  interval: () => Math.max(0.32, 0.85 - elapsed() * 0.008),
  update(dt) {
    const r = Math.min(W, H) * 0.09;
    for (const o of objs) {
      o.age += dt;
      if (o.hit) continue;
      const c = holeCenter(o.hole);
      for (const p of pointers) {
        if (segHitsCircle(p.px, p.py, p.x, p.y, c.x, c.y - r, r + 20)) {
          o.hit = true; o.age = o.life - 0.25;
          const bonus = o.isRabbit;
          burst(c.x, c.y - r, bonus ? "#fbb500" : "#ffb0c9", 22);
          award(c.x, c.y - r * 2, bonus ? 3 : 1);
          sfx.whack(c.x, bonus);
        }
      }
    }
    objs = objs.filter((o) => o.age < o.life);
  },
  draw() {
    const r = Math.min(W, H) * 0.09;
    for (let i = 0; i < 9; i++) {
      const c = holeCenter(i), o = objs.find((m) => m.hole === i);
      Art.drawMole(c.x, c.y, r, o ? o.age : 0, o ? o.life : 1, o ? o.hit : false, o ? o.isRabbit : false);
    }
  },
  trail: "#fbb500",
};

// ☄️ 유성 막기: 화면 한가운데(먼 곳)에서 우리 쪽으로 점점 커지며 날아옴. 부딪히면 방어막이 깨짐
let shield = 5, flash = 0, stars = null;
const SHIELD_MAX = 5;
games.space = {
  bg: "#04050f",
  camAlpha: 0.3,
  spawn() {
    const big = Math.random() < 0.18;
    objs.push({ z: 0.03, speed: (0.24 + elapsed() * 0.004) * (big ? 0.8 : 1), big, hp: big ? 2 : 1,
      tx: W * (-0.1 + Math.random() * 1.2), ty: H * (-0.05 + Math.random() * 1.1),
      base: big ? 1.35 : 0.9, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.06,
      seed: Math.random() * 100, hitFlash: 0 });
    sfx.incoming(objs[objs.length - 1].tx);
  },
  interval: () => Math.max(0.45, 1.1 - elapsed() * 0.01),
  pos(o) { return { x: W / 2 + (o.tx - W / 2) * o.z, y: H * 0.45 + (o.ty - H * 0.45) * o.z }; },
  size(o) { return Math.min(W, H) * 0.14 * o.base * (0.12 + o.z * 1.1); },
  update(dt) {
    flash = Math.max(0, flash - dt * 2);
    for (const o of objs) {
      o.z += o.speed * dt * (0.4 + o.z * 1.3);       // 가까워질수록 빨라 보임
      o.rot += o.vr; o.hitFlash = Math.max(0, o.hitFlash - dt * 4);
      const c = this.pos(o), r = this.size(o);
      for (const p of pointers) {
        if (o.dead || o.cool > 0) continue;
        if (segHitsCircle(p.px, p.py, p.x, p.y, c.x, c.y, r + 16)) {
          o.hp--; o.hitFlash = 1; o.cool = 0.3;
          if (o.hp <= 0) {
            o.dead = true; const pts = o.big ? 3 : 1;
            burst(c.x, c.y, "#ffb347", 22); burst(c.x, c.y, "#fff", 8);
            award(c.x, c.y - r, pts, "#ffd166"); sfx.meteor(c.x, o.big);
          } else { burst(c.x, c.y, "#ffb347", 8); sfx.chip(c.x); }
        }
      }
      if (o.cool > 0) o.cool -= dt;
      if (!o.dead && o.z >= 1) {                     // 우리에게 도달!
        o.dead = true; shield--; flash = 1; combo = 0; sfx.crash(); if (shield === 1) speak("방어막이 약해요!"); else if (shield > 1) speak("조심하세요!");
        popup(W / 2, H / 2, "쾅! 💥", "#ff5d5d");
        if (shield <= 0) endGame();
      }
    }
    objs = objs.filter((o) => !o.dead);
  },
  draw() {
    if (!stars) stars = Array.from({ length: 160 }, () => ({ a: Math.random() * 6.283, z: Math.random() }));
    ctx.fillStyle = "#fff";
    for (const s of stars) {
      s.z += 0.004 + s.z * 0.012; if (s.z > 1) { s.z = 0.01; s.a = Math.random() * 6.283; }
      const d = s.z * Math.hypot(W, H) * 0.6, d0 = d * 0.9;
      ctx.strokeStyle = `rgba(255,255,255,${0.2 + s.z * 0.8})`; ctx.lineWidth = 1 + s.z * 2;
      ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(s.a) * d0, H * 0.45 + Math.sin(s.a) * d0);
      ctx.lineTo(W / 2 + Math.cos(s.a) * d, H * 0.45 + Math.sin(s.a) * d); ctx.stroke();
    }
    for (const o of [...objs].sort((a, b) => a.z - b.z)) {
      const c = this.pos(o), r = this.size(o), c0 = this.pos({ ...o, z: o.z * 0.75 });
      Art.drawMeteor(c, c0, r, o);
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,50,50,${flash * 0.45})`; ctx.fillRect(0, 0, W, H); }
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "32px serif";
    ctx.fillText("🛡️".repeat(Math.max(shield, 0)) + "▫️".repeat(SHIELD_MAX - Math.max(shield, 0)), W / 2, 104);
  },
  trail: "#00d2ff",
};

// 🎨 허공에 그림 그리기: 손(또는 손가락)으로 공중에 빛줄기를 그려요. 주먹을 쥐면 펜이 멈춰요.
// 위쪽 메뉴(색·지우개·굵기·전체 지우기·저장)는 손을 0.6초 올려 두면 선택돼요.
const PEN_COLORS = ["rainbow", "#ff5d73", "#ffd166", "#80ed99", "#4cc9f0", "#c77dff", "#ffffff"];
const PEN_SIZES = [8, 16, 28];
games.draw = {
  bg: "#10131f", camAlpha: 0.45, manual: true, noTimer: true, noCursor: true,
  hud() { return ""; },
  scoreText() { return "🎨 그림 그리기"; },
  init() {
    this.layer = document.createElement("canvas"); this.layer.width = W; this.layer.height = H; this.lctx = this.layer.getContext("2d");
    this.color = "rainbow"; this.eraser = false; this.sizeI = 1; this.hue = 0; this.lastCol = "#fff";
    this.down = [false, false]; this.lastPt = [null, null]; this.upT = [99, 99]; this.dwell = {}; this.fired = {}; this.t = 0;
    this.items = [...PEN_COLORS.map((c) => ({ k: "color", c })), { k: "eraser" }, { k: "size" }, { k: "clear" }, { k: "save" }];
    ac();                                                         // 그릴 때 소리: 높이(y)=음, 좌우(x)=소리 방향
    const o = actx.createOscillator(), g = actx.createGain(), p = actx.createStereoPanner();
    o.type = "triangle"; g.gain.value = 0; o.connect(g).connect(p).connect(master); o.start();
    this.syn = { o, g, p };
  },
  exit() { try { this.syn.g.gain.value = 0; this.syn.o.stop(); } catch {} },
  rects() {
    const n = this.items.length, s = Math.min(64, (W - 24) / (n + 0.5)), gap = s * 0.1;
    return { s, gap, y: 76, x0: (W - (n * (s + gap) - gap)) / 2 };
  },
  pick(i) {
    const it = this.items[i], t = ac().currentTime;
    if (it.k === "color") { this.color = it.c; this.eraser = false; tone(880, t, 0.1, "triangle", 0.12); }
    else if (it.k === "eraser") { this.eraser = !this.eraser; tone(520, t, 0.1, "triangle", 0.12); }
    else if (it.k === "size") { this.sizeI = (this.sizeI + 1) % PEN_SIZES.length; tone(660, t, 0.1, "triangle", 0.12); }
    else if (it.k === "clear") { this.lctx.clearRect(0, 0, this.layer.width, this.layer.height); noise(t, 0.5, 0.25, 800); tone(300, t, 0.4, "sine", 0.15, 80); }
    else if (it.k === "save") this.save();
  },
  save() {
    const c = document.createElement("canvas"); c.width = this.layer.width; c.height = this.layer.height;
    const x = c.getContext("2d"); x.fillStyle = "#10131f"; x.fillRect(0, 0, c.width, c.height); x.drawImage(this.layer, 0, 0);
    c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "허공그림.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
    popup(W / 2, H * 0.3, "저장했어요! 💾", "#ffd166"); sfx.start(); speak("저장했어요!");
  },
  update(dt) {
    this.t += dt;
    if (this.layer.width !== W || this.layer.height !== H) {      // 창 크기가 바뀌면 그림 유지
      const old = this.layer; this.layer = document.createElement("canvas"); this.layer.width = W; this.layer.height = H;
      this.lctx = this.layer.getContext("2d"); this.lctx.drawImage(old, 0, 0, W, H);
    }
    const { s, gap, y, x0 } = this.rects(), uiBottom = y + s + 14;
    // 메뉴: 손을 올려 두면 선택
    this.items.forEach((_, i) => {
      const bx = x0 + i * (s + gap), m = 6 + reach * 0.3;
      const on = pointers.some((p) => p.x > bx - m && p.x < bx + s + m && p.y > y - m && p.y < y + s + m);
      if (on) { this.dwell[i] = (this.dwell[i] || 0) + dt; if (this.dwell[i] >= 0.6 && !this.fired[i]) { this.fired[i] = true; this.pick(i); } }
      else { this.dwell[i] = 0; this.fired[i] = false; }
    });
    // 그리기
    const size = PEN_SIZES[this.sizeI], c = this.lctx;
    pointers.forEach((p, i) => {
      const pen = !p.fist && p.y > uiBottom;                       // 주먹이거나 메뉴 위면 안 그림
      if (pen) {
        // 펜이 잠깐(0.2초) 떨어졌다 다시 닿으면 이전 점에서 이어 그림 → 순간 끊김 방지
        const lp = this.lastPt[i];
        const join = !this.down[i] && lp && this.upT[i] < 0.2 && Math.hypot(p.x - lp.x, p.y - lp.y) < Math.min(W, H) * 0.3;
        const from = this.down[i] ? { x: p.px, y: p.py } : join ? lp : { x: p.x, y: p.y };
        const speed = join ? Math.hypot(p.x - lp.x, p.y - lp.y) : p.speed;
        c.lineCap = "round"; c.lineJoin = "round";
        if (this.eraser) { c.globalCompositeOperation = "destination-out"; c.shadowBlur = 0; c.lineWidth = size * 2.5; c.strokeStyle = "#000"; }
        else {
          let col = this.color;
          if (col === "rainbow") { this.hue = (this.hue + speed * 0.5 + 0.5) % 360; col = `hsl(${this.hue}, 100%, 60%)`; }
          this.lastCol = col; c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = size * 1.2;
          c.lineWidth = size * (1.15 - Math.min(speed / 60, 0.5));
        }
        c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(p.x + 0.01, p.y); c.stroke();
        c.shadowBlur = 0; c.globalCompositeOperation = "source-over";
        if (!this.eraser && speed > 3 && Math.random() < 0.35) burst(p.x, p.y, this.lastCol, 2);
      }
      if (pen) { this.lastPt[i] = { x: p.x, y: p.y }; this.upT[i] = 0; } else this.upT[i] += dt;
      this.down[i] = pen;
    });
    for (let i = pointers.length; i < 2; i++) { this.down[i] = false; this.upT[i] += dt; }
    const now = actx.currentTime, k = pointers.findIndex((_, i) => this.down[i]), lead = pointers[k];
    if (lead) {
      const idx = Math.max(0, Math.min(9, Math.floor((1 - lead.y / H) * 10)));
      const semi = [0, 2, 4, 7, 9][idx % 5] + 12 * Math.floor(idx / 5);
      this.syn.o.frequency.setTargetAtTime(261.63 * 2 ** (semi / 12), now, 0.03);
      this.syn.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, panOf(lead.x))), now, 0.03);
      this.syn.g.gain.setTargetAtTime(this.eraser ? 0.02 : Math.min(0.14, 0.05 + lead.speed * 0.004), now, 0.05);
    } else this.syn.g.gain.setTargetAtTime(0, now, 0.08);
  },
  draw() {
    if (!this.layer) return;
    ctx.drawImage(this.layer, 0, 0, W, H);
    const { s, gap, y, x0 } = this.rects();
    this.items.forEach((it, i) => {
      const bx = x0 + i * (s + gap), cx = bx + s / 2, cy = y + s / 2;
      const sel = (it.k === "color" && !this.eraser && it.c === this.color) || (it.k === "eraser" && this.eraser);
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.roundRect(bx, y, s, s, 12); ctx.fill();
      ctx.lineWidth = sel ? 4 : 2; ctx.strokeStyle = sel ? "#ffd166" : "rgba(255,255,255,.35)"; ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${s * 0.55}px serif`; ctx.fillStyle = "#fff";
      if (it.k === "color") {
        if (it.c === "rainbow") ctx.fillText("🌈", cx, cy + 2);
        else { ctx.fillStyle = it.c; ctx.beginPath(); ctx.arc(cx, cy, s * 0.3, 0, 7); ctx.fill(); }
      } else if (it.k === "eraser") ctx.fillText("🧽", cx, cy + 2);
      else if (it.k === "size") { ctx.beginPath(); ctx.arc(cx, cy, PEN_SIZES[this.sizeI] * 0.6 + 3, 0, 7); ctx.fill(); }
      else if (it.k === "clear") ctx.fillText("🗑️", cx, cy + 2);
      else if (it.k === "save") ctx.fillText("💾", cx, cy + 2);
      const d = this.dwell[i] || 0;                                  // 선택 진행 표시
      if (d > 0 && !this.fired[i]) { ctx.strokeStyle = "#7df9ff"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, s * 0.46, -Math.PI / 2, -Math.PI / 2 + (d / 0.6) * Math.PI * 2); ctx.stroke(); }
    });
    // 펜 커서: 그리는 중이면 색 점, 주먹(펜 멈춤)이면 빈 동그라미
    pointers.forEach((p, i) => {
      const r = this.eraser ? PEN_SIZES[this.sizeI] * 1.25 : PEN_SIZES[this.sizeI] * 0.6 + 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
      if (this.down[i] && !this.eraser) { ctx.fillStyle = this.lastCol; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke(); }
      else { ctx.setLineDash([6, 6]); ctx.strokeStyle = this.eraser ? "#fff" : "rgba(255,255,255,.8)"; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]); }
    });
    if (this.t < 9) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 ${Math.max(13, Math.min(W * 0.03, H * 0.045))}px sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.fillStyle = "#ffd166";
      const t = "손가락으로 그려 보세요! ✊ 주먹을 쥐면 펜이 멈춰요";
      ctx.strokeText(t, W / 2, H * 0.3); ctx.fillText(t, W / 2, H * 0.3);
    }
  },
};

// ---------- 몸 게임 공통 도구 ----------
const BODY_LINES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
// 마우스 모드(테스트용): 마우스 x 위치에 가상의 몸이 서 있는 것처럼 만듦
function mockBody(x) {
  const b = Array.from({ length: 33 }, () => ({ x, y: H * 0.7, v: 1 }));
  const set = (i, dx, y) => (b[i] = { x: x + dx, y: H * y, v: 1 });
  set(0, 0, 0.5); set(11, -45, 0.58); set(12, 45, 0.58); set(13, -70, 0.68); set(14, 70, 0.68); set(15, -80, 0.78); set(16, 80, 0.78);
  set(23, -35, 0.78); set(24, 35, 0.78); set(25, -35, 0.9); set(26, 35, 0.9); set(27, -35, 0.98); set(28, 35, 0.98);
  return b;
}
const getBody = () => (useMouse ? mockBody(mouse.x || W / 2) : body);
const bv = (b, i, min = 0.5) => !!(b && b[i] && b[i].v >= min);
function drawSkeleton(b, color = "#7df9ff", alpha = 1) {
  if (!b) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.shadowColor = color; ctx.shadowBlur = 14;
  for (const [a, c] of BODY_LINES) if (bv(b, a, 0.3) && bv(b, c, 0.3)) { ctx.beginPath(); ctx.moveTo(b[a].x, b[a].y); ctx.lineTo(b[c].x, b[c].y); ctx.stroke(); }
  if (bv(b, 0, 0.3)) { const sw = bv(b, 11, 0.3) && bv(b, 12, 0.3) ? Math.abs(b[11].x - b[12].x) : 80; ctx.beginPath(); ctx.arc(b[0].x, b[0].y, Math.max(18, sw * 0.3), 0, 7); ctx.stroke(); }
  for (const i of [15, 16]) if (bv(b, i, 0.3)) { ctx.beginPath(); ctx.arc(b[i].x, b[i].y, 14, 0, 7); ctx.fill(); }   // 손목(손) 표시
  ctx.restore();
}
function bodyHint() {
  if (useMouse || getBody()) return;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 ${Math.max(16, Math.min(W * 0.04, H * 0.05))}px sans-serif`;
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.fillStyle = "#ffd166";
  const t = "🧍 한 걸음 뒤로! 머리부터 발까지 보이게 서 주세요";
  ctx.strokeText(t, W / 2, H * 0.45); ctx.fillText(t, W / 2, H * 0.45);
}

// 🏃 몸으로 피하기: 온몸을 움직여 돌은 피하고, 손으로 동전을 모아요. 하트 3개
games.dodge = {
  bg: "#0f2027", camAlpha: 0.85, body: true, noCursor: true, manual: true,
  init() { this.items = []; this.spawnT = 0.6; this.lives = 3; this.inv = 0; this.flash = 0; this.coins = 0; },
  result() { return ` · 동전 ${this.coins}개`; },
  update(dt) {
    const b = getBody(), e = elapsed();
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(0.3, 0.85 - e * 0.009) * (0.7 + Math.random() * 0.6);
      const coin = Math.random() < 0.35, r = coin ? 30 : 38 + Math.random() * 18;
      this.items.push({ x: r + Math.random() * (W - 2 * r), y: -r, r, vy: (230 + e * 4.5) * (H / 800) * (coin ? 0.8 : 1), coin, rot: 0 });
    }
    this.inv = Math.max(0, this.inv - dt); this.flash = Math.max(0, this.flash - dt * 2);
    const torso = [], hands = [];
    if (b) {
      for (const i of [0, 11, 12, 23, 24]) if (bv(b, i, 0.3)) torso.push(b[i]);
      if (bv(b, 11, 0.3) && bv(b, 12, 0.3)) torso.push({ x: (b[11].x + b[12].x) / 2, y: (b[11].y + b[12].y) / 2 });
      if (bv(b, 23, 0.3) && bv(b, 24, 0.3)) torso.push({ x: (b[23].x + b[24].x) / 2, y: (b[23].y + b[24].y) / 2 });
      for (const i of [15, 16]) if (bv(b, i, 0.3)) hands.push(b[i]);
    }
    for (const it of this.items) {
      it.y += it.vy * dt; it.rot += dt * 2.5;
      if (it.dead) continue;
      if (it.coin) {
        if ([...torso, ...hands].some((p) => Math.hypot(p.x - it.x, p.y - it.y) < it.r + 24)) {
          it.dead = true; this.coins++; award(it.x, it.y, 1, "#ffd166"); sfx.pop(it.x, true); burst(it.x, it.y, "#ffd166", 14);
        }
      } else if (this.inv <= 0 && torso.some((p) => Math.hypot(p.x - it.x, p.y - it.y) < it.r * 0.85 + 8)) {
        it.dead = true; this.lives--; this.inv = 1.5; this.flash = 1; combo = 0;
        burst(it.x, it.y, "#ff6b4a", 26); sfx.crash();
        if (this.lives === 1) speak("한 번 더 맞으면 끝이에요!"); else if (this.lives > 1) speak("앗, 조심!");
        if (this.lives <= 0) endGame();
      }
      if (!it.dead && it.y > H + it.r) { it.dead = true; if (!it.coin && b) { score += 1; popup(it.x, H - 60, "+1", "#9fe8ff"); } }
    }
    this.items = this.items.filter((it) => !it.dead);
  },
  draw() {
    if (!this.items) return;
    const b = getBody();
    for (const it of this.items) {
      ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rot); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${it.r * 2}px serif`;
      ctx.fillText(it.coin ? "🪙" : "🪨", 0, 0); ctx.restore();
    }
    drawSkeleton(b, this.inv > 0 ? "#ff6b4a" : "#7df9ff", this.inv > 0 && ((this.inv * 10) | 0) % 2 ? 0.35 : 1);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "32px serif";
    ctx.fillText("❤️".repeat(Math.max(this.lives, 0)) + "🖤".repeat(3 - Math.max(this.lives, 0)), W / 2, 104);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,50,50,${this.flash * 0.4})`; ctx.fillRect(0, 0, W, H); }
    bodyHint();
  },
};

// 🙆 포즈 따라하기: 화면에 나온 자세를 따라 해요. 0.7초 동안 유지하면 성공!
let keyPose = -1, keyPoseT = 0;
addEventListener("keydown", (e) => { if (/^[1-5]$/.test(e.key)) { keyPose = +e.key - 1; keyPoseT = performance.now(); } });
const POSES = [
  { name: "만세!", la: [-0.35, -1], ra: [0.35, -1] },
  { name: "양팔을 벌려요", la: [-1, 0], ra: [1, 0] },
  { name: "왼팔을 들어요", la: [-0.4, -1], ra: [0.25, 1] },
  { name: "오른팔을 들어요", la: [-0.25, 1], ra: [0.4, -1] },
  { name: "앉아요!", la: [-0.45, 0.9], ra: [0.45, 0.9], squat: true },
];
function poseTest(k, b) {
  const v = (...ids) => ids.every((i) => bv(b, i, 0.4));
  if (!v(0, 11, 12)) return false;
  const sw = Math.max(30, Math.abs(b[12].x - b[11].x)), nose = b[0], sL = b[11], sR = b[12];     // 화면 기준: 왼쪽 = 내 왼쪽(거울)
  switch (k) {
    case 0: return v(15, 16) && b[15].y < nose.y && b[16].y < nose.y;
    case 1: return v(15, 16) && Math.abs(b[15].y - sL.y) < 0.6 * sw && Math.abs(b[16].y - sR.y) < 0.6 * sw && b[15].x < sL.x - 0.9 * sw && b[16].x > sR.x + 0.9 * sw;
    case 2: return v(15, 16) && b[15].y < nose.y && b[16].y > sR.y + 0.4 * sw;
    case 3: return v(15, 16) && b[16].y < nose.y && b[15].y > sL.y + 0.4 * sw;
    case 4: return v(23, 24, 25, 26, 27, 28) && (b[25].y - b[23].y) + (b[26].y - b[24].y) < 0.62 * ((b[27].y - b[25].y) + (b[28].y - b[26].y));
  }
  return false;
}
function drawFigure(cx, cy, s, pose, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(4, s * 0.06); ctx.lineCap = "round";
  const sq = pose.squat ? s * 0.25 : 0, top = cy - s * 0.6 + sq, hip = cy + sq;
  ctx.beginPath(); ctx.arc(cx, top - s * 0.28, s * 0.15, 0, 7); ctx.stroke();                         // 머리
  ctx.beginPath(); ctx.moveTo(cx, top - s * 0.1); ctx.lineTo(cx, hip); ctx.stroke();                 // 몸통
  for (const [dir, sx] of [[pose.la, -1], [pose.ra, 1]]) {                                             // 팔
    const l = Math.hypot(dir[0], dir[1]), ax = cx + sx * s * 0.02, ay = top;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (dir[0] / l) * s * 0.55, ay + (dir[1] / l) * s * 0.55); ctx.stroke();
  }
  for (const sx of [-1, 1]) {                                                                         // 다리
    ctx.beginPath(); ctx.moveTo(cx, hip);
    if (pose.squat) { ctx.lineTo(cx + sx * s * 0.3, hip + s * 0.05); ctx.lineTo(cx + sx * s * 0.3, hip + s * 0.5); }
    else ctx.lineTo(cx + sx * s * 0.14, hip + s * 0.65);
    ctx.stroke();
  }
  ctx.restore();
}
games.pose = {
  bg: "#1f1147", camAlpha: 0.85, body: true, noCursor: true, manual: true,
  init() { this.idx = -1; this.hold = 0; this.done = 0; this.ok = false; this.next(); },
  result() { return ` · 성공 ${this.done}번`; },
  next() {
    let k; do { k = (Math.random() * POSES.length) | 0; } while (k === this.idx);
    this.idx = k; this.limit = Math.max(3.5, 6.5 - elapsed() * 0.04); this.left = this.limit; this.hold = 0;
    speak(POSES[k].name);
  },
  update(dt) {
    const b = getBody();
    this.ok = useMouse ? keyPose === this.idx && performance.now() - keyPoseT < 1500 : !!(b && poseTest(this.idx, b));
    this.left -= dt; this.hold = this.ok ? this.hold + dt : Math.max(0, this.hold - dt * 2);
    if (this.hold >= 0.7) {
      this.done++; award(W / 2, H * 0.5, 2 + Math.min(3, Math.floor(this.left)), "#80ed99");
      burst(W / 2, H * 0.5, "#80ed99", 30); burst(W / 2, H * 0.5, "#ffd166", 16); sfx.pop(W / 2, true);
      popup(W / 2, H * 0.4, ["좋아요! 👍", "잘했어요! 🎉", "멋져요! ✨"][(Math.random() * 3) | 0], "#ffd166");
      this.next();
    } else if (this.left <= 0) {
      combo = 0; popup(W / 2, H * 0.4, "아쉬워요 😅", "#ff9a9a"); sfx.chip(W / 2); this.next();
    }
  },
  draw() {
    if (this.idx < 0) return;
    const b = getBody(), p = POSES[this.idx], s = Math.min(W, H) * 0.3;
    drawSkeleton(b, this.ok ? "#80ed99" : "#7df9ff");
    // 목표 자세 안내판
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.roundRect(W / 2 - s * 0.75, 100, s * 1.5, s * 1.55, 18); ctx.fill();
    drawFigure(W / 2, 100 + s * 0.72, s * 0.68, p, this.ok ? "#80ed99" : "#fff");
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 ${Math.max(18, s * 0.17)}px sans-serif`; ctx.fillStyle = "#ffd166";
    ctx.fillText(p.name, W / 2, 100 + s * 1.4);
    const w = s * 1.3, x = W / 2 - w / 2, y = 100 + s * 1.65;                                           // 남은 시간 / 유지 진행
    ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(x, y, w, 10); ctx.fillStyle = "#ffd166"; ctx.fillRect(x, y, w * Math.max(this.left, 0) / this.limit, 10);
    ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(x, y + 16, w, 10); ctx.fillStyle = "#80ed99"; ctx.fillRect(x, y + 16, w * Math.min(this.hold / 0.7, 1), 10);
    if (useMouse) { ctx.fillStyle = "#fff"; ctx.font = "700 16px sans-serif"; ctx.fillText("(테스트: 키보드 1~5 = 포즈 선택)", W / 2, y + 48); }
    bodyHint();
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const heartsText = (n, max = 3) => "❤️".repeat(Math.max(n, 0)) + "🖤".repeat(max - Math.max(n, 0));
function topHud(text, yy = H * 0.3) {                     // 화면 위쪽 안내 문구 (처음 몇 초만)
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 ${Math.max(14, Math.min(W * 0.036, H * 0.045))}px sans-serif`;
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.fillStyle = "#ffd166";
  ctx.strokeText(text, W / 2, yy); ctx.fillText(text, W / 2, yy);
}

// 🧱 벽돌깨기: 손을 좌우로 움직여 판을 옮기고, 공을 튕겨 벽돌을 깨요. 공을 놓치면 하트가 줄어요
games.brick = {
  bg: "#14213d", camAlpha: 0.45, manual: true, noCursor: true,
  init() { this.level = 1; this.lives = 3; this.px = W / 2; this.t = 0; this.newLevel(); this.resetBall(); },
  newLevel() { this.rows = Math.min(7, 3 + this.level); this.cols = 8; this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(1)); this.left = this.rows * this.cols; },
  pw() { return clamp(W * 0.24, 110, 260); },
  py() { return H * 0.9; },
  speed() { return Math.min(W, H) * (0.75 + 0.07 * this.level); },
  rect(r, c) { const m = W * 0.04, bw = (W - 2 * m) / this.cols, bh = Math.min(H * 0.045, 34); return { x: m + c * bw + 2, y: H * 0.16 + r * (bh + 4), w: bw - 4, h: bh }; },
  resetBall() { this.ball = { x: this.px, y: this.py() - 14, r: Math.max(9, Math.min(W, H) * 0.02), vx: 0, vy: 0, stuck: true, t: 0 }; },
  update(dt) {
    this.t += dt;
    const p = pointers[0], pw = this.pw(), py = this.py(), b = this.ball;
    if (p) this.px += (p.x - this.px) * Math.min(1, dt * 20);
    this.px = clamp(this.px, pw / 2, W - pw / 2);
    if (b.stuck) {
      b.x = this.px; b.y = py - b.r - 2; b.t += dt;
      if (b.t > 1.2) { const a = (Math.random() - 0.5) * 0.9, sp = this.speed(); b.vx = sp * Math.sin(a); b.vy = -sp * Math.cos(a); b.stuck = false; }
      return;
    }
    const N = 4;
    for (let s = 0; s < N; s++) {
      b.x += b.vx * dt / N; b.y += b.vy * dt / N;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); } else if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
      if (b.vy > 0 && b.y + b.r >= py && b.y - b.r <= py + 16 && b.x >= this.px - pw / 2 - b.r && b.x <= this.px + pw / 2 + b.r) {   // 판에 맞음: 맞은 위치에 따라 각도가 달라짐
        const ang = clamp((b.x - this.px) / (pw / 2), -1, 1) * 1.0, sp = this.speed();
        b.vx = sp * Math.sin(ang); b.vy = -sp * Math.cos(ang); b.y = py - b.r;
        tone(300, ac().currentTime, 0.08, "square", 0.1, 200, panOf(b.x));
      }
      outer: for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        if (!this.grid[r][c]) continue;
        const k = this.rect(r, c), cx = clamp(b.x, k.x, k.x + k.w), cy = clamp(b.y, k.y, k.y + k.h), dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy >= b.r * b.r) continue;
        this.grid[r][c] = 0; this.left--;
        if (Math.abs(dx) > Math.abs(dy)) b.vx = -b.vx; else b.vy = -b.vy;
        const col = `hsl(${(r * 47 + 10) % 360} 85% 60%)`;
        award(k.x + k.w / 2, k.y, 1, col); burst(k.x + k.w / 2, k.y + k.h / 2, col, 10); sfx.pop(k.x + k.w / 2);
        break outer;
      }
    }
    if (b.y > H + b.r) {
      this.lives--; combo = 0; sfx.crash();
      if (this.lives <= 0) { endGame(); return; }
      speak("아쉬워요! 한 번 더!"); this.resetBall(); return;
    }
    if (this.left <= 0) {
      this.level++; score += 10; popup(W / 2, H * 0.45, "클리어! +10", "#ffd166"); speak("클리어! 다음 판!", true); sfx.levelUp();
      this.newLevel(); this.resetBall();
    }
  },
  draw() {
    if (!this.grid) return;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (!this.grid[r][c]) continue;
      const k = this.rect(r, c);
      const col = `hsl(${(r * 47 + 10) % 360} 85% 60%)`;
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(k.x, k.y, k.w, k.h, 6); ctx.fill();
      // 상단 젤리 하이라이트
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.roundRect(k.x + 2, k.y + 2, k.w - 4, k.h * 0.45, 4); ctx.fill();
    }
    const pw = this.pw(), py = this.py(), b = this.ball;
    Art.drawBrickPaddle(this.px, py, pw, b);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "32px serif"; ctx.fillStyle = "#fff"; ctx.fillText(heartsText(this.lives), W / 2, 104);
    if (this.t < 7) topHud("손을 좌우로 움직여 공을 튕겨요!", H * 0.6);
  },
};

// 💧 물 새는 곳 막기: 구멍이 생기면 손으로 가리고 잠깐 기다리면 막혀요. 물이 가득 차면 끝!
games.leak = {
  bg: "#0b3d5c", camAlpha: 0.5, manual: true,
  hr() { return Math.min(W, H) * 0.075; },
  init() { this.holes = []; this.water = 0.05; this.spawnT = 0.8; this.said = false; this.warned = false; this.lost = false; this.t = 0; this.total = 0; },
  result() { return this.lost ? " · 물이 가득 찼어요 🌊" : " · 끝까지 막았어요! 🎉"; },
  update(dt) {
    const e = elapsed(), r = this.hr(); this.t += dt;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(1.1, 2.8 - e * 0.028);
      if (this.holes.length < Math.min(6, 2 + Math.floor(e / 12))) {
        const h = { x: r * 1.5 + Math.random() * (W - 3 * r), y: H * 0.2 + Math.random() * H * 0.62, prog: 0, cover: false, spray: 0 };
        this.holes.push(h);
        const t = ac().currentTime; noise(t, 0.35, 0.2, 1800, panOf(h.x)); tone(180, t, 0.25, "sine", 0.15, 90, panOf(h.x));
        if (!this.said) { this.said = true; speak("구멍이 생겼어요! 손으로 막아요!"); }
      }
    }
    let leaking = 0;
    for (const h of this.holes) {
      h.cover = pointers.some((p) => Math.hypot(p.x - h.x, p.y - h.y) < r + reach + 10);
      if (h.cover) h.prog += dt / 1.1; else { h.prog = Math.max(0, h.prog - dt / 4); leaking++; }
      h.spray -= dt; if (!h.cover && h.spray <= 0) { h.spray = 0.06; burst(h.x, h.y, "#9fdcff", 2); }
      if (h.prog >= 1) { h.done = true; this.total++; award(h.x, h.y, 1, "#9fdcff"); sfx.pop(h.x, true); burst(h.x, h.y, "#6ee7ff", 18); }
    }
    this.holes = this.holes.filter((h) => !h.done);
    this.water = clamp(this.water + (leaking * 0.011 * (1 + e * 0.008) - (leaking === 0 ? 0.025 : 0)) * dt, 0, 1);
    if (this.water > 0.6 && !this.warned) { this.warned = true; speak("물이 차오르고 있어요!"); }
    if (this.water < 0.4) this.warned = false;
    if (this.water >= 0.92) { this.lost = true; endGame(); }
  },
  draw() {
    if (!this.holes) return;
    const top = H * (1 - this.water), r = this.hr();
    ctx.save(); ctx.fillStyle = "rgba(40,150,255,.45)"; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, top);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, top + Math.sin(x * 0.02 + this.t * 3) * 6);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); ctx.restore();
    for (const h of this.holes) {
      ctx.fillStyle = "#050a10"; ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 3;
      for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.3; ctx.beginPath(); ctx.moveTo(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r); ctx.lineTo(h.x + Math.cos(a) * r * 1.5, h.y + Math.sin(a) * r * 1.5); ctx.stroke(); }
      ctx.strokeStyle = h.cover ? "#80ed99" : "#ff6b6b"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(h.x, h.y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(h.prog, 0.02)); ctx.stroke();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "800 22px sans-serif"; ctx.fillStyle = "#fff";
    ctx.fillText(`💧 물 높이 ${Math.round(this.water * 100)}%`, W / 2, 104);
    if (this.t < 7) topHud("구멍을 손으로 가리고 잠깐 기다려요!");
  },
};

// 🦘 점프 달리기: 몸을 위로 점프하면 돌을 넘고, 앉으면 위에서 오는 장애물 밑으로 지나가요 (몸 인식)
let rkJump = false, rkDuck = false;
addEventListener("keydown", (e) => { if (e.key === " " || e.key === "ArrowUp") rkJump = true; if (e.key === "ArrowDown" || e.key === "s") rkDuck = true; });
addEventListener("keyup", (e) => { if (e.key === "ArrowDown" || e.key === "s") rkDuck = false; });
addEventListener("pointerdown", () => { if (mode === "runner") rkJump = true; });
games.runner = {
  bg: "#1a1a2e", camAlpha: 0.45, body: true, noCursor: true, manual: true,
  hs() { return Math.min(W, H) * 0.16; },
  gy() { return H * 0.78; },
  cx() { return W * 0.22; },
  init() {
    this.t = 0; this.phase = useMouse ? "run" : "calib"; this.cal = 0; this.base = null; this.prevJump = false;
    this.lives = 3; this.inv = 0; this.flash = 0; this.obs = []; this.spawnT = 1; this.vy = 0; this.jy = 0; this.duck = false; rkJump = false; this.dist = 0;
  },
  sense(dt) {                              // 몸의 높이 변화로 점프/앉기를 알아냄 (키보드·클릭으로도 가능)
    let jump = rkJump, duck = rkDuck; rkJump = false;
    const b = getBody();
    if (!useMouse && b && [11, 12, 23, 24].every((i) => bv(b, i, 0.3))) {
      const shY = (b[11].y + b[12].y) / 2, hipY = (b[23].y + b[24].y) / 2, y = (shY + hipY) / 2, tl = Math.max(40, hipY - shY);
      if (this.base == null) this.base = y;
      const dy = y - this.base;
      this.base += dy * Math.min(1, dt * (Math.abs(dy) < tl * 0.15 ? 1.5 : 0.15));   // 서 있는 높이를 천천히 따라감
      const up = dy < -tl * 0.3;
      if (up && !this.prevJump) jump = true;
      this.prevJump = up;
      if (dy > tl * 0.3) duck = true;
      this.seen = true;
    } else this.seen = false;
    return { jump, duck };
  },
  update(dt) {
    this.t += dt;
    const { jump, duck } = this.sense(dt), e = elapsed(), hs = this.hs();
    if (this.phase === "calib") {            // 2초 동안 똑바로 서서 기준 높이를 잡음
      this.cal = this.seen ? this.cal + dt : 0;
      if (this.cal >= 2) { this.phase = "run"; speak("출발!", true); sfx.start(); }
      return;
    }
    const g = H * 3.2, v0 = Math.sqrt(2 * g * hs * 0.95);
    if (jump && this.jy <= 0) { this.vy = v0; tone(400, ac().currentTime, 0.18, "triangle", 0.12, 800); }
    this.jy += this.vy * dt; this.vy -= g * dt; if (this.jy <= 0) { this.jy = 0; this.vy = 0; }
    this.duck = duck && this.jy === 0;
    const v = W * 0.5 * (1 + e * 0.012); this.dist += v * dt;
    this.spawnT -= dt; this.inv = Math.max(0, this.inv - dt); this.flash = Math.max(0, this.flash - dt * 2);
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(0.9, 1.7 - e * 0.012) * (0.8 + Math.random() * 0.5);
      const r = Math.random(), x = W + 60;
      if (r < 0.4) this.obs.push({ type: "rock", x, w: hs * 0.5, h: hs * 0.45, y0: 0 });
      else if (r < 0.7) this.obs.push({ type: "bar", x, w: hs * 0.7, h: hs * 0.5, y0: hs * 0.65 });
      else { const hi = Math.random() < 0.4; for (let k = 0; k < 3; k++) this.obs.push({ type: "coin", x: x + k * hs * 0.55, w: hs * 0.3, h: hs * 0.3, y0: hi ? hs * 1.3 : hs * 0.2 }); }
    }
    const cx = this.cx(), cw = hs * 0.35, ch = this.duck ? hs * 0.55 : hs;
    for (const o of this.obs) {
      o.x -= v * dt;
      const overlapX = o.x < cx + cw * 0.4 && o.x + o.w > cx - cw * 0.4;
      const overlapY = o.y0 < this.jy + ch * 0.95 && o.y0 + o.h > this.jy + ch * 0.05;
      if (!o.dead && overlapX && overlapY) {
        if (o.type === "coin") { o.dead = true; award(o.x, this.gy() - o.y0 - o.h, 1, "#ffd166"); sfx.pop(o.x, true); }
        else if (this.inv <= 0) {
          o.dead = true; this.lives--; this.inv = 1.5; this.flash = 1; combo = 0; burst(cx, this.gy() - hs / 2, "#ff6b4a", 22); sfx.crash();
          if (this.lives === 1) speak("한 번 더 부딪히면 끝이에요!"); else if (this.lives > 1) speak("앗!");
          if (this.lives <= 0) { endGame(); return; }
        }
      }
      if (!o.dead && !o.counted && o.type !== "coin" && o.x + o.w < cx - cw * 0.4) { o.counted = true; award(cx, this.gy() - hs * 1.3, 1, "#9fe8ff"); }
    }
    this.obs = this.obs.filter((o) => !o.dead && o.x > -o.w - 80);
  },
  draw() {
    if (!this.obs) return;
    const hs = this.hs(), gy = this.gy(), cx = this.cx();
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, gy, W, H - gy);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.4)";
    for (let x = -(this.dist % 80); x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, gy + 24); ctx.lineTo(x + 40, gy + 24); ctx.stroke(); }
    for (const o of this.obs) {
      const y = gy - o.y0 - o.h;
      if (o.type === "coin") {
        ctx.font = `${o.w * 1.5}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🪙", o.x + o.w / 2, y + o.h / 2);
      } else {
        ctx.fillStyle = o.type === "rock" ? "#8d6e63" : "#c0392b"; ctx.beginPath(); ctx.roundRect(o.x, y, o.w, o.h, o.type === "rock" ? 14 : 8); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      }
    }
    // 생동감 넘치는 캥거루/토끼 러너 마스코트 아바타
    Art.drawRunnerMascot(cx, gy, this.jy, hs, this.duck, this.dist, this.inv);

    if (!useMouse) drawSkeleton(getBody(), "rgba(125,249,255,.8)", 0.5);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "32px serif"; ctx.fillStyle = "#fff"; ctx.fillText(heartsText(this.lives), W / 2, 104);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,50,50,${this.flash * 0.4})`; ctx.fillRect(0, 0, W, H); }
    if (this.phase === "calib") {
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${Math.max(20, Math.min(W * 0.06, H * 0.07))}px 'Rubik', sans-serif`; ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.fillStyle = "#ffd166";
      const t = this.seen ? `똑바로 서서 준비! ${Math.max(0, Math.ceil(2 - this.cal))}` : "전신이 보이게 서 주세요";
      ctx.strokeText(t, W / 2, H * 0.4); ctx.fillText(t, W / 2, H * 0.4);
    } else if (this.t < 10) topHud(useMouse ? "스페이스/클릭 = 점프, ↓ 키 = 앉기" : "점프하면 넘고, 앉으면 밑으로 지나가요!");
    bodyHint();
  },
};

// 🥊 쿵푸·펀치: 다가오는 적을 손으로 쳐서 물리쳐요. 💣은 치면 안 돼요!
games.kungfu = {
  bg: "#2b1b17", camAlpha: 0.5,
  init() { this.lives = 3; this.shake = 0; this.flash = 0; this.fx = []; this.t = 0; this.used = new Set(); },
  spawn() {
    const r = Math.random(), type = r < 0.6 ? "ninja" : r < 0.85 ? "oni" : "bomb";
    objs.push({ type, hp: type === "oni" ? 2 : 1, z: 0.05, speed: (0.2 + elapsed() * 0.004) * (type === "oni" ? 0.8 : 1), cool: 0,
      sx: W * (0.25 + 0.5 * Math.random()), sy: H * 0.4, ex: W * (0.1 + 0.8 * Math.random()), ey: H * (0.55 + 0.3 * Math.random()) });
  },
  interval: () => Math.max(0.5, 1.2 - elapsed() * 0.01),
  pos(o) { return { x: o.sx + (o.ex - o.sx) * o.z, y: o.sy + (o.ey - o.sy) * o.z }; },
  size(o) { return Math.min(W, H) * 0.12 * (0.15 + o.z * 1.1) * (o.type === "oni" ? 1.2 : 1); },
  update(dt) {
    this.t += dt; this.shake = Math.max(0, this.shake - dt); this.flash = Math.max(0, this.flash - dt * 2);
    this.fx = this.fx.filter((f) => (f.t -= dt) > 0);
    for (const o of objs) {
      o.z += o.speed * dt * (0.5 + o.z * 1.2); o.cool -= dt;
      const c = this.pos(o), r = this.size(o);
      if (!o.dead && o.cool <= 0) for (const p of pointers) {
        const punch = p.punch && !this.used.has(p.punchId) && Math.hypot(p.x - c.x, p.y - c.y) < r * 1.3 + 30 + reach;
        if (!punch && !(p.speed >= 18 && segHitsCircle(p.px, p.py, p.x, p.y, c.x, c.y, r + 8))) continue;
        if (punch) this.used.add(p.punchId);
        if (o.type === "bomb") { o.dead = true; score = Math.max(0, score - 3); combo = 0; burst(c.x, c.y, "#ff3030", 24); popup(c.x, c.y, "-3", "#ff5d5d"); sfx.bomb(c.x); speak("앗, 폭탄!"); break; }
        o.hp--; o.cool = 0.25; this.fx.push({ x: c.x, y: c.y, t: 0.35 }); this.shake = 0.15;
        if (o.hp <= 0) { o.dead = true; award(c.x, c.y - r, o.type === "oni" ? 3 : 1, "#ffd166"); burst(c.x, c.y, "#ffb347", 18); sfx.whack(c.x, o.type === "oni"); sfx.slice(c.x); }
        else { burst(c.x, c.y, "#fff", 8); sfx.chip(c.x); }
        break;
      }
      if (!o.dead && o.z >= 1) {
        o.dead = true;
        if (o.type !== "bomb") {
          this.lives--; this.flash = 1; this.shake = 0.3; combo = 0; sfx.crash();
          if (this.lives === 1) speak("한 번 더 맞으면 끝이에요!"); else if (this.lives > 1) speak("앗, 맞았어요!");
          if (this.lives <= 0) { endGame(); return; }
        }
      }
    }
    objs = objs.filter((o) => !o.dead);
  },
  draw() {
    if (this.lives == null) return;
    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    for (const o of [...objs].sort((a, b) => a.z - b.z)) {
      const c = this.pos(o), r = this.size(o);
      Art.drawKungfuFighter(c, r, o);
    }
    for (const f of this.fx) {
      const k = 1 - f.t / 0.35; ctx.globalAlpha = 1 - k * 0.6; ctx.font = `${60 + k * 70}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("👊", f.x, f.y);
      ctx.font = `900 ${28 + k * 20}px 'Rubik', sans-serif`; ctx.fillStyle = "#ffd166";
      ctx.shadowColor = "#ff5e92"; ctx.shadowBlur = 14;
      ctx.fillText("POW!", f.x, f.y - 50 - k * 20); ctx.shadowBlur = 0; ctx.fillStyle = "#fff"; ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "32px serif"; ctx.fillStyle = "#fff"; ctx.fillText(heartsText(this.lives), W / 2, 104);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,50,50,${this.flash * 0.4})`; ctx.fillRect(0, 0, W, H); }
    if (this.t < 7) topHud(useMouse ? "적을 클릭해서 펀치!" : "적을 향해 주먹을 앞으로 쭉! 뻗어요");
  },
  trail: "#ffd166",
};

// 🤝 둘이서 대결 풍선: 왼쪽 사람(파랑) vs 오른쪽 사람(분홍). 같은 풍선을 먼저 터뜨리면 내 점수
games.versus = {
  ...games.balloon,
  bg: "#1f2a44", camAlpha: 0.6, versus: true,
  trail: (p) => (p.x < W / 2 ? "#4c8dff" : "#ff5d8f"),
  init() { this.s = [0, 0]; },
  scoreText() { return `🔵 ${this.s[0]} : ${this.s[1]} 🔴`; },
  update(dt) {
    for (const o of objs) o.y += o.vy * dt * 60 * (1 + elapsed() * 0.006);
    objs = objs.filter((o) => o.y > -o.r * 2);
    for (const p of pointers) for (const o of objs) {
      if (o.dead || !segHitsCircle(p.px, p.py, p.x, p.y, o.x, o.y, o.r + 10)) continue;
      o.dead = true; const side = p.x < W / 2 ? 0 : 1, pts = o.gold ? 3 : 1; this.s[side] += pts;
      burst(o.x, o.y, side ? "#ff5d8f" : "#4c8dff"); popup(o.x, o.y, "+" + pts, side ? "#ff9fbf" : "#9fc0ff");
      sfx.pop(o.x);
    }
    objs = objs.filter((o) => !o.dead);
  },
  draw() {
    ctx.fillStyle = "rgba(76,141,255,.10)"; ctx.fillRect(0, 0, W / 2, H);
    ctx.fillStyle = "rgba(255,93,143,.10)"; ctx.fillRect(W / 2, 0, W / 2, H);
    ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 3; ctx.setLineDash([14, 12]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);
    games.balloon.draw.call(this);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "900 64px sans-serif"; ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.fillText(this.s[0], W * 0.25, H - 80); ctx.fillText(this.s[1], W * 0.75, H - 80);
  },
};

const elapsed = () => GAME_SECONDS - timeLeft;

// ---------- 진행 ----------
let warned10 = false;
let mode = null, score = 0, timeLeft = 0, playing = false, last = 0;

function drawBackground(color, camAlpha = 0.85) {
  if (!mode) { ctx.clearRect(0, 0, W, H); return; }   // 메뉴에서는 캔버스를 투명하게 → 아케이드 허브 배경이 보임
  ctx.fillStyle = color; ctx.fillRect(0, 0, W, H);
  if (!useMouse && video.readyState >= 2) {
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(W / vw, H / vh);
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.globalAlpha = camAlpha;
    ctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
    ctx.restore(); ctx.globalAlpha = 1;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  updatePointers();
  const g = mode ? games[mode] : null;
  drawBackground(g?.bg ?? "#1b1b2f", g?.camAlpha);
  if (playing && g) {
    // 3단계 웨이브 전이 검사 (Wave 1: 60~40초, Wave 2: 40~20초, Fever: 20~0초)
    if (!g.noTimer) {
      if (timeLeft <= 20 && currentWave < 3) {
        currentWave = 3;
        isFeverTime = true;
        sfx.levelUp();
        triggerWaveBanner("🔥 FEVER TIME!", "점수 2배! 마구 터뜨려요!", true);
        speak("피버 타임! 점수 두 배!", true);
      } else if (timeLeft <= 40 && timeLeft > 20 && currentWave < 2) {
        currentWave = 2;
        sfx.levelUp();
        triggerWaveBanner("WAVE 2", "SPEED UP! 빨라집니다!", false);
        speak("2단계 시작! 더 빨라져요!");
      }
    }

    spawnTimer -= dt;
    if (!g.manual && spawnTimer <= 0) {
      // 단계별 스폰 가속: Wave 2는 1.3배, Fever Time은 약 1.8배 빠름
      const waveMult = currentWave === 3 ? 0.55 : currentWave === 2 ? 0.75 : 1.0;
      g.spawn();
      spawnTimer = g.interval() * waveMult * (0.6 + Math.random() * 0.8);
    }
    g.update(dt); g.draw(); bgmTick();
    comboTimer -= dt; if (comboTimer <= 0) combo = 0;
    if (!g.noTimer) timeLeft -= dt;
    if (playing) {                                   // update 안에서 게임이 끝났을 수 있음
      if (!g.noTimer && timeLeft <= 10 && !warned10) { warned10 = true; speak("10초 남았어요!"); }
      $("score").textContent = g.scoreText ? g.scoreText() : score + "점";
      $("time").textContent = g.hud ? g.hud() : Math.max(0, Math.ceil(timeLeft));
      if (timeLeft <= 0) endGame();
    }
  } else if (g) { g.draw(); }
  drawFx();
  if (playing) drawCombo();
  if (!g?.noCursor) drawTrails(g?.trail ?? "#fff");
  if (!useMouse && camInfo && mode) {
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "700 20px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(W / 2 - 260, H - 52, 520, 36);
    ctx.fillStyle = camOk ? "#80ed99" : "#ffd166"; ctx.fillText(camInfo, W / 2, H - 27);
  }
}

function startGame(m) {
  mode = m; score = 0; timeLeft = GAME_SECONDS; spawnTimer = 0.3;
  objs = []; halves = []; particles = []; popups = []; playing = true; body = null; shield = SHIELD_MAX; flash = 0;
  combo = 0; comboTimer = 0; maxCombo = 0;
  currentWave = 1; isFeverTime = false;
  games[m].init?.();
  $("menu").classList.add("hidden"); $("result").classList.add("hidden"); $("hud").classList.remove("hidden");
  $("feverBorder")?.classList.add("hidden");
  const stageWave = $("stageWave");
  if (stageWave) { stageWave.textContent = "WAVE 1"; stageWave.classList.remove("fever"); }
  triggerWaveBanner("WAVE 1", "START! 준비하세요!", false);
  document.body.classList.add("playing");
  sfx.start(); speak(INTRO[m], true); bgmStart(); warned10 = false;
}
function endGame() {
  playing = false; $("hud").classList.add("hidden");
  $("feverBorder")?.classList.add("hidden");
  $("waveBanner")?.classList.add("hidden");
  isFeverTime = false;
  const g = games[mode];
  if (g.versus) {                                  // 대결: 기록 없이 승패만 표시
    const [a, b] = g.s;
    $("finalScore").textContent = `🔵 ${a} : ${b} 🔴`;
    $("finalBest").textContent = a > b ? "🔵 왼쪽 사람 승리! 🎉" : b > a ? "🔴 오른쪽 사람 승리! 🎉" : "무승부 🤝";
    $("result").classList.remove("hidden"); sfx.end();
    speak(a > b ? "왼쪽이 이겼어요!" : b > a ? "오른쪽이 이겼어요!" : "무승부예요!", true);
    return;
  }
  const key = "best-" + mode;
  SecureStore.loadCheckpoint(key, 0).then((savedBest) => {
    const curBest = +savedBest || 0;
    const best = Math.max(score, curBest);
    const record = score > curBest;
    SecureStore.saveCheckpoint(key, best);
    $("finalScore").textContent = score + "점" + (mode === "space" ? (shield <= 0 ? " · 방어막이 부서졌어요 💥" : " · 지구를 지켰어요! 🌍") : "") + (g.result?.() ?? "");
    $("finalBest").textContent = (record ? "🏆 새 기록 달성!" : "최고 기록 " + best + "점") + (maxCombo ? ` · 최대 콤보 ${maxCombo}` : "");
    $("result").classList.remove("hidden");
    sfx.end();
    speak(mode === "space" ? (shield <= 0 ? "방어막이 깨졌어요!" : "지구를 지켰어요!") : record ? "새 기록이에요!" : "끝!", true);
  }).catch(() => {
    $("finalScore").textContent = score + "점";
    $("result").classList.remove("hidden");
  });
}
function toMenu() {
  try { speechSynthesis.cancel(); } catch {}
  if (mode) games[mode].exit?.();
  playing = false; mode = null; objs = [];
  isFeverTime = false; currentWave = 1;
  $("feverBorder")?.classList.add("hidden");
  $("waveBanner")?.classList.add("hidden");
  $("hud").classList.add("hidden"); $("result").classList.add("hidden"); $("menu").classList.remove("hidden");
  document.body.classList.remove("playing");
  showBest();
}
async function showBest() {
  const modesList = [["balloon", "풍선"], ["ninja", "과일"], ["mole", "두더지"], ["space", "유성"], ["brick", "벽돌"], ["leak", "물막기"], ["kungfu", "쿵푸"], ["dodge", "피하기"], ["pose", "포즈"], ["runner", "달리기"]];
  const items = await Promise.all(modesList.map(async ([m, n]) => {
    const val = await SecureStore.loadCheckpoint("best-" + m, 0);
    document.querySelectorAll(`[data-best="${m}"]`).forEach((e) => { e.textContent = (val || 0) + "점"; });   // 카드별 최고 기록
    return `${n} ${val || 0}`;
  }));
  $("best").textContent = "🏆 최고 기록 — " + items.join(" · ");
  const total = items.reduce((s, t) => s + (+t.split(" ").pop() || 0), 0);
  $("totalBest").textContent = total.toLocaleString();
}

let vision = null;
async function ensureVideo() {
  if (video.srcObject) return true;
  $("status").textContent = "카메라를 켜는 중… (처음엔 조금 걸려요)";
  try {
    // 해상도는 640x480, 프레임은 가능하면 60fps로 요청 (프레임이 많을수록 빠른 손동작도 놓치지 않음)
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, min: 30 }, facingMode: "user" } });
    await video.play();
    // 카메라 새 프레임이 도착하는 즉시 손 인식 (화면 그리기를 기다리지 않고 병렬 처리)
    if (video.requestVideoFrameCallback && !video.__rvfc) {
      video.__rvfc = true;
      const pump = () => {
        try {
          if (handLandmarker && !useMouse && !games[mode]?.body) {
            detectHandsNow();
          }
        } catch {}
        video.requestVideoFrameCallback(pump);
      };
      video.requestVideoFrameCallback(pump);
    }
    vision = await FilesetResolver.forVisionTasks(WASM);
    return true;
  } catch (e) {
    console.error(e);
    $("status").textContent = "카메라를 쓸 수 없어요. 허용했는지 확인하거나 아래 '마우스/터치' 를 체크하세요.";
    return false;
  }
}
async function makeLandmarker(Cls, modelAssetPath, extra) {
  // 기본은 GPU(초고속 가속). 주소 끝에 ?cpu 를 붙이면 CPU 모드 폴백
  const opts = (delegate) => ({ baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", ...extra });
  try { return await Cls.createFromOptions(vision, opts(location.search.includes("cpu") ? "CPU" : "GPU")); }
  catch { return await Cls.createFromOptions(vision, opts("CPU")); }
}
async function ensureModel(kind) {
  if (kind === "pose" ? poseLandmarker : handLandmarker) return true;
  $("status").textContent = kind === "pose" ? "몸 인식 준비 중… (처음엔 조금 걸려요)" : "손 인식 준비 중…";
  try {
    // 빠른 모션 블러 상황에서도 추적이 유지되도록 신뢰도 임계치 최적화 (0.25)
    if (kind === "pose") {
      poseLandmarker = await makeLandmarker(PoseLandmarker, POSE_MODEL, {
        numPoses: 1,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35
      });
    } else {
      handLandmarker = await makeLandmarker(HandLandmarker, MODEL, {
        numHands: 2,
        minHandDetectionConfidence: 0.25,
        minHandPresenceConfidence: 0.25,
        minTrackingConfidence: 0.25
      });
    }
    $("status").textContent = "";
    return true;
  } catch (e) {
    console.error(e);
    $("status").textContent = "인식 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.";
    return false;
  }
}

document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", async () => {
  useMouse = $("useMouse").checked;
  if (!useMouse) {
    if (!(await ensureVideo())) return;
    if (!(await ensureModel(games[b.dataset.mode].body ? "pose" : "hand"))) return;
  }
  startGame(b.dataset.mode);
}));
// 카드의 아무 곳이나 눌러도 게임 시작
document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", (e) => { if (!e.target.closest(".mode")) c.querySelector(".mode")?.click(); }));
$("again").onclick = () => startGame(mode);
$("toMenu").onclick = toMenu;
$("quit").onclick = toMenu;

// TV / 대화면 전체화면 토글 (iOS Safari & 데스크톱 크로스 브라우징)
function toggleFullscreen() {
  try {
    const doc = document;
    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!isFs) {
      const el = doc.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    }
  } catch (err) {
    console.warn("전체화면 전환 예외:", err);
  }
}
$("btnFsHub")?.addEventListener("click", toggleFullscreen);
$("btnFsHud")?.addEventListener("click", toggleFullscreen);

// iOS Safari 오디오 자동 잠금 해제 가드
const unlockAudio = () => {
  try { if (actx && actx.state === "suspended") actx.resume(); } catch {}
};
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("touchstart", unlockAudio, { once: true });

// 소리/음성 켜기·끄기 (기억해 둠)
for (const [id, set, key] of [["optSound", (v) => (soundOn = v), "sound"], ["optVoice", (v) => (voiceOn = v), "voice"]]) {
  const el = $(id), saved = localStorage.getItem(key);
  if (saved !== null) el.checked = saved === "1";
  set(el.checked);
  el.addEventListener("change", () => {
    set(el.checked); localStorage.setItem(key, el.checked ? "1" : "0");
    if (actx) master.gain.value = soundOn ? 1 : 0;
    if (!voiceOn) try { speechSynthesis.cancel(); } catch {}
  });
}
// 메뉴: 손놀이 / 몸놀이 탭 (마지막으로 본 탭을 기억)
const TAB_HINT = {
  hand: "카메라 앞에서 손으로 화면을 건드려 보세요. 영상은 이 기기 밖으로 나가지 않아요.",
  body: "머리부터 발끝까지 보이게 한두 걸음 뒤로 물러서 주세요. 영상은 이 기기 밖으로 나가지 않아요.",
};
function setTab(t) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".modes").forEach((m) => m.classList.toggle("hidden", m.dataset.cat !== t));
  $("tabHint").textContent = TAB_HINT[t];
  try { localStorage.setItem("tab", t); } catch {}
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
setTab((() => { try { return localStorage.getItem("tab") === "body" ? "body" : "hand"; } catch { return "hand"; } })());

showBest();
requestAnimationFrame((t) => { last = t; frame(t); });
