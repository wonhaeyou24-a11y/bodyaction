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
  hitHeavy(x) {
    const t = ac().currentTime, p = panOf(x);
    // 묵직한 베이스 킥(Sine 180Hz -> 30Hz 급격 하향 감쇠) + 파열 스냅 노이즈 (찰진 타격감)
    tone(180, t, 0.12, "sine", 0.38, 30, p);
    noise(t, 0.08, 0.28, 2200, p);
  },
  stamp() {
    const t = ac().currentTime;
    // 랭크 스탬프 슬램 충격음
    tone(140, t, 0.22, "sine", 0.45, 25);
    noise(t, 0.16, 0.35, 1200);
  },
  tick() {
    const t = ac().currentTime;
    tone(1200, t, 0.03, "sine", 0.08); // 롤링 카운터 틱음
  },
  fanfare() {
    const t = ac().currentTime;
    // 웅장한 신스 브라스 축하 화음
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, t + i * 0.07, 0.35, "triangle", 0.2));
  },
  combo(n) {
    const t = ac().currentTime, steps = [0, 2, 4, 7, 9, 12, 14, 16];
    tone(523.25 * 2 ** (steps[Math.min(n - 3, steps.length - 1)] / 12), t, 0.16, "triangle", 0.14);
  },
  start() { const t = ac().currentTime; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.09, 0.2, "triangle", 0.14)); },
  countdown(final) {
    const t = ac().currentTime;
    if (final) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.08, 0.25, "triangle", 0.16));
    } else {
      tone(587.33, t, 0.14, "square", 0.16, 587.33); // 경쾌한 레디 비프음 (D5)
    }
  },
  end() { const t = ac().currentTime; [784, 659, 784, 1046.5].forEach((f, i) => tone(f, t + i * 0.14, 0.3, "triangle", 0.14)); },
  levelUp() { const t = ac().currentTime; [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.07, 0.25, "square", 0.08)); },
  saber(x, left) {
    const t = ac().currentTime, p = panOf(x);
    tone(left ? 620 : 880, t, 0.12, "sawtooth", 0.18, 220, p);
    noise(t, 0.08, 0.2, 4000, p);
  },
  spell(x, type) {
    const t = ac().currentTime, p = panOf(x);
    if (type === "lightning") {
      tone(1200, t, 0.22, "sawtooth", 0.25, 120, p);
      noise(t, 0.25, 0.3, 1200, p);
    } else if (type === "shield") {
      tone(440, t, 0.35, "sine", 0.25, 880, p);
      tone(660, t + 0.08, 0.35, "triangle", 0.2, 1320, p);
    } else {
      tone(220, t, 0.3, "sawtooth", 0.3, 80, p);
      noise(t, 0.35, 0.35, 400, p);
    }
  },
  gksave(x) {
    const t = ac().currentTime, p = panOf(x);
    tone(180, t, 0.18, "square", 0.32, 50, p);
    noise(t, 0.15, 0.35, 1500, p);
  },
  goal() {
    const t = ac().currentTime;
    [300, 260, 220, 180].forEach((f, i) => tone(f, t + i * 0.1, 0.2, "sawtooth", 0.25));
  },
  bagPunch(x, heavy) {
    const t = ac().currentTime, p = panOf(x);
    tone(heavy ? 95 : 135, t, 0.18, "square", 0.35, 45, p);
    noise(t, 0.1, heavy ? 0.35 : 0.22, 1200, p);
  },
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
  balloon: "날아오르는 풍선을 손으로 터뜨리세요!",
  ninja: "과일을 날카롭게 베어내세요! 폭탄은 조심하세요!",
  mole: "구멍에서 튀어나오는 두더지를 빠르게 잡으세요!",
  space: "지구를 향해 쏟아지는 유성을 막아내세요!",
  draw: "허공에 멋진 그림을 그려 보세요!",
  dodge: "온몸을 움직여 날아오는 돌을 피하고 동전을 모으세요!",
  brick: "손으로 공을 튕겨 벽돌을 모두 깨뜨리세요!",
  leak: "물이 새어 나오는 구멍을 손으로 꼭 막으세요!",
  runner: "점프하고 숙이며 장애물을 피하는 달리기 게임입니다!",
  kungfu: "다가오는 악당들을 주먹으로 빠르게 물리치세요!",
  pose: "화면에 나오는 포즈를 온몸으로 똑같이 따라 하세요!",
  versus: "2인 대결 게임! 풍선을 먼저 터뜨리는 사람이 승리합니다!",
  beat: "음악에 맞춰 날아오는 네온 큐브를 온몸으로 시원하게 베어내세요!",
  magic: "손끝으로 마법진을 그리세요! 원은 방어막, 브이는 번개, 세모는 파이어!",
  keeper: "골대를 향해 날아오는 공을 온몸과 손으로 막아내세요!",
  box: "샌드백을 향해 양주먹으로 신나게 펀치를 연타하세요!",
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
  beat:    { bpm: 128, root: 220, scale: [0, 3, 5, 7, 10], prog: [0, 5, 7, 3], wave: "sawtooth", drums: "pop", vol: 0.6 },
  magic:   { bpm: 98, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 7, 9, 5], wave: "sine", drums: "none", vol: 0.5 },
  keeper:  { bpm: 130, root: 293.66, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "square", drums: "pop", vol: 0.5 },
  box:     { bpm: 136, root: 196, scale: [0, 1, 5, 7, 8], prog: [0, 0, 5, 3], wave: "sawtooth", drums: "taiko", vol: 0.55 },
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
const MAX_HANDS = 4; // 2인 플레이어 최대 4손(각 2손씩) 동시 추적 지원
const trails = Array.from({ length: MAX_HANDS }, () => []);
const mouse = { x: -100, y: -100, down: false, p: -1e9 };

addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener("pointerdown", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; mouse.p = performance.now(); });
addEventListener("pointerup", () => { mouse.down = false; });

// ============================================================================
// 🧠 SOTA 모션 인식 코어: 1유로 필터 (One Euro Filter - CHI 2012 국제 표준)
// 정지 상태: 컷오프 주파수 최소화로 미세 지터/떨림 0.0px 완전 박멸
// 고속 이동: 미분 속도 비례 주파수 자동 확장으로 지연 시간 0ms (손끝 즉시 추종)
// ============================================================================
class OneEuroFilter {
  constructor(minCutoff = 1.1, beta = 0.009, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / Math.max(dt, 0.0001));
  }
  filter(val, timestamp) {
    if (this.tPrev === null) {
      this.xPrev = val;
      this.dxPrev = 0;
      this.tPrev = timestamp;
      return val;
    }
    const dt = Math.max(0.001, Math.min(0.1, (timestamp - this.tPrev) / 1000));
    this.tPrev = timestamp;
    // 1차 미분 (속도 계산)
    const dx = (val - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;
    // 속도 연동 동적 컷오프 주파수
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * val + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }
  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

// 2인 최대 4손 독립 1유로 필터 세트
const euroFilters = Array.from({ length: MAX_HANDS }, () => ({
  x: new OneEuroFilter(1.2, 0.008),
  y: new OneEuroFilter(1.2, 0.008)
}));

function videoToScreen(lm) {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return { x: W - (lm.x * vw * s + ox), y: lm.y * vh * s + oy };   // 거울 반전
}

let lastFist = [], fistCount = [], lastSeen = 0, sizeHist = [], lastPunch = [];
let body = null, bodySeen = 0, lastBodyTime = -1, camOk = false, poseLandmarker = null;
let lastHands = [], rawPrev = [], camInfo = "", detectMs = 0;
let isDetectingHands = false, isDetectingBody = false, lastDetectTimestamp = 0;
let handVelocities = Array.from({ length: MAX_HANDS }, () => ({ vx: 0, vy: 0 }));

function updatePointers() {
  if (!playing || !mode) {
    pointers.length = 0;
    trails.forEach((t) => (t.length = 0));
    lastHands = [];
    body = null;
    euroFilters.forEach((ef) => { ef.x.reset(); ef.y.reset(); });
    return;
  }

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
            return o ? { x: o.x + (p.x - o.x) * 0.75, y: o.y + (p.y - o.y) * 0.75, v } : { ...p, v };
          });
        } else if (t0 - bodySeen > 400) {
          body = null;
        }
      } catch (err) {
        console.warn("포즈 인식 예외:", err);
      } finally {
        isDetectingBody = false;
      }
    }
    camOk = !!body;
    camInfo = (body ? "🧍 전신 인식됨" : "전신이 보이게 한 걸음 뒤로 물러서 주세요") + `  · ${detectMs.toFixed(0)}ms`;
  } else if (handLandmarker && video.readyState >= 2) {
    try { detectHandsNow(); } catch (e) { console.warn("손 인식 오류", e); }
    camInfo = (lastHands.length ? `✋ 손 ${lastHands.length}개 추적 중 (1유로 필터 안정화)` : "손을 카메라에 보여 주세요 (밝은 곳, 손바닥/검지)") + `  · ${detectMs.toFixed(0)}ms`;
    camOk = lastHands.length > 0;
    pts = lastHands;
  }

  // 최대 4손(2인용 모드 완벽 대응) 포인터 생성 및 공간 일관성 1유로 필터링
  pts.slice(0, MAX_HANDS).forEach((p, i) => {
    const pr = prev[i] ?? p;
    const fx = euroFilters[i].x.filter(p.x, now);
    const fy = euroFilters[i].y.filter(p.y, now);
    const curSpeed = Math.hypot(fx - pr.x, fy - pr.y);

    pointers.push({
      x: fx, y: fy, px: pr.x, py: pr.y,
      speed: curSpeed,
      fist: useMouse ? !mouse.down : !!lastFist[i],
      // 손을 앞으로 내지르는 동적 펀치 임펄스: 280ms 이내의 펀치 이벤트이면서 속도가 살아있을 때만
      punch: useMouse ? mouse.down : (performance.now() - (lastPunch[i] || -1e9) < 220 && curSpeed > 8.0),
      punchId: useMouse ? mouse.p : lastPunch[i]
    });
  });

  for (let i = 0; i < MAX_HANDS; i++) {
    const t = trails[i], p = pointers[i];
    if (p) {
      t.push({ x: p.x, y: p.y });
      if (t.length > 14) t.shift();
    } else {
      t.length = 0;
      euroFilters[i].x.reset(); euroFilters[i].y.reset();
    }
  }
}

// 3D 기하 제스처 판정 및 1유로 필터 융합 손 인식 엔진
function detectHandsNow() {
  if (!playing || !mode || isDetectingHands || !handLandmarker || video.readyState < 2) return;
  isDetectingHands = true;
  try {
    const now = performance.now();
    const t0 = Math.max(now, lastDetectTimestamp + 1);
    lastDetectTimestamp = t0;

    const r = handLandmarker.detectForVideo(video, t0);
    detectMs = detectMs * 0.9 + (performance.now() - now) * 0.1;

    const palm = $("trackMode").value === "palm" && mode !== "draw";
    reach = palm ? 32 : 12;

    if (r.landmarks && r.landmarks.length > 0) {
      lastSeen = t0;
      const vw = video.videoWidth || 640, vh = video.videoHeight || 480;

      const raw = r.landmarks.slice(0, MAX_HANDS).map((l, i) => {
        // 손가락 3D 기하 분석 (주먹/검지/펀치 가속도 판정)
        const wrist = l[0];
        const d3 = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh, (a.z - b.z) * vw * 1.3);
        const foldedCount = [[8, 5], [12, 9], [16, 13], [20, 17]].filter(([tip, mcp]) => d3(l[tip], wrist) < d3(l[mcp], wrist) * 0.94).length;
        
        lastFist[i] = foldedCount >= 3;

        // 펀치 가속도 충격량(Forward Impulse) 감지: 손바닥 크기가 카메라 쪽으로 급격히 커지는 순간
        const scale = d3(l[9], wrist);
        const h = (sizeHist[i] ??= []);
        h.push({ t: t0, s: scale });
        while (h.length && t0 - h[0].t > 380) h.shift();
        const old = h.find((e) => t0 - e.t >= 80 && t0 - e.t <= 260);
        if (old && scale / old.s > 1.25 && t0 - (lastPunch[i] || 0) > 260) {
          lastPunch[i] = t0;
        }

        if (!palm) {
          // 검지 끝과 제2관절 최적 가중합
          return videoToScreen({ x: l[8].x * 0.88 + l[7].x * 0.12, y: l[8].y * 0.88 + l[7].y * 0.12 });
        }
        const ids = [0, 5, 9, 13, 17];
        return videoToScreen({
          x: ids.reduce((s, idx) => s + l[idx].x, 0) / 5,
          y: ids.reduce((s, idx) => s + l[idx].y, 0) / 5
        });
      });

      // 좌우 손 공간 일관성 매칭 (프레임 간 손 인덱스 뒤바뀜 방지)
      let sortedRaw = raw;
      if (rawPrev.length > 0 && raw.length > 1) {
        // 이전 프레임 손 위치와의 유클리드 거리가 최소가 되도록 정렬
        sortedRaw = [];
        const used = new Set();
        for (let i = 0; i < rawPrev.length; i++) {
          let bestJ = -1, bestDist = 1e9;
          for (let j = 0; j < raw.length; j++) {
            if (used.has(j)) continue;
            const d = Math.hypot(raw[j].x - rawPrev[i].x, raw[j].y - rawPrev[i].y);
            if (d < bestDist) { bestDist = d; bestJ = j; }
          }
          if (bestJ !== -1 && bestDist < W * 0.45) {
            sortedRaw.push(raw[bestJ]);
            used.add(bestJ);
          }
        }
        for (let j = 0; j < raw.length; j++) {
          if (!used.has(j)) sortedRaw.push(raw[j]);
        }
      }

      // 속도 벡터 산출 (손 정지 시 지터 없이 부드럽게 감쇠)
      lastHands = sortedRaw.map((p, i) => {
        const o = rawPrev[i];
        let vx = 0, vy = 0;
        if (o) {
          vx = p.x - o.x; vy = p.y - o.y;
        }
        const prevVel = handVelocities[i] || { vx: 0, vy: 0 };
        handVelocities[i] = {
          vx: prevVel.vx * 0.2 + vx * 0.8,
          vy: prevVel.vy * 0.2 + vy * 0.8
        };
        // 정지 상태에서 속도 가산 오차 제거 (미세 보정 0.08만 적용)
        return {
          x: p.x + handVelocities[i].vx * 0.08,
          y: p.y + handVelocities[i].vy * 0.08
        };
      });
      rawPrev = sortedRaw;
    } else {
      // 그레이스 윈도우 감쇠
      const dtMs = t0 - lastSeen;
      if (dtMs < 220 && lastHands.length > 0) {
        lastHands = lastHands.map((p, i) => {
          const vel = handVelocities[i] || { vx: 0, vy: 0 };
          vel.vx *= 0.75; vel.vy *= 0.75;
          return {
            x: Math.max(0, Math.min(W, p.x + vel.vx * 0.4)),
            y: Math.max(0, Math.min(H, p.y + vel.vy * 0.4))
          };
        });
      } else if (dtMs >= 220) {
        lastHands = []; lastFist = []; rawPrev = []; sizeHist = [];
        handVelocities = Array.from({ length: MAX_HANDS }, () => ({ vx: 0, vy: 0 }));
        euroFilters.forEach((ef) => { ef.x.reset(); ef.y.reset(); });
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
let globalShake = 0, globalShakePower = 0;
let shockwaves = [];

function addShake(duration = 0.12, power = 10) {
  globalShake = Math.max(globalShake, duration);
  globalShakePower = Math.max(globalShakePower, power);
}

function burst(x, y, color, n = 22) {
  try {
    // 1. 타격 시 가슴을 울리는 화면 흔들림(Screen Shake) 자동 인가
    addShake(0.12, Math.min(16, 7 + n * 0.3));
    sfx.hitHeavy(x);

    // 2. 동심원 충격파 링 (Shockwave Ring) 생성
    shockwaves.push({
      x, y, r: 8, maxR: 65 + Math.random() * 25,
      color: color || "#00d2ff", alpha: 0.95
    });

    // 3. 고속 네온 스파크 파티클 분출
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 3.5 + Math.random() * 8.5;
      particles.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 1, color, size: 3.5 + Math.random() * 5
      });
    }
  } catch {}
}
function popup(x, y, text, color = "#fff") {
  try { popups.push({ x, y, text, color, life: 1 }); } catch {}
}

function drawFx() {
  try {
    // A. 충격파 링 렌더링
    shockwaves = shockwaves.filter((sw) => sw.alpha > 0);
    for (const sw of shockwaves) {
      sw.r += 7.5;
      sw.alpha -= 0.055;
      ctx.save();
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = Math.max(1, 4.5 * sw.alpha);
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.shadowColor = sw.color;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // B. 스파크 파티클 렌더링
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life -= 0.028;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size || 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // C. 팝업 텍스트 렌더링
    popups = popups.filter((p) => p.life > 0);
    ctx.textAlign = "center"; ctx.font = "900 38px 'Rubik', sans-serif";
    for (const p of popups) {
      p.y -= 1.8; p.life -= 0.022;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 16;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
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
  },

  // 8. 네온 비트 큐브 노트 (비트 슬래시 전용 3D 큐브 + 화살표)
  drawBeatNote(x, y, r, dir, color, half = 0) {
    try {
      ctx.save();
      ctx.translate(x, y);
      if (half !== 0) {
        ctx.beginPath();
        ctx.rect(half < 0 ? -r * 1.5 : 0, -r * 1.5, r * 1.5, r * 3);
        ctx.clip();
      }
      ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.fillStyle = "rgba(20, 10, 35, 0.85)";
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(-r, -r, r * 2, r * 2, 12); ctx.fill(); ctx.stroke();

      // 내부 광택
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, color); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.roundRect(-r + 4, -r + 4, r * 2 - 8, r * 2 - 8, 8); ctx.fill();
      ctx.globalAlpha = 1;

      // 슬래시 방향 화살표
      ctx.strokeStyle = "#ffffff"; ctx.fillStyle = "#ffffff"; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 8;
      ctx.save();
      const angles = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0, any: 0 };
      ctx.rotate(angles[dir] ?? 0);
      if (dir === "any") {
        ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(-r * 0.45, 0); ctx.lineTo(r * 0.4, 0);
        ctx.lineTo(r * 0.15, -r * 0.3); ctx.moveTo(r * 0.4, 0); ctx.lineTo(r * 0.15, r * 0.3);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    } catch {}
  },

  // 9. 위저드 마법진 & 룬 이펙트
  drawMagicRune(pts, type = "rune", glowCol = "#b04dff") {
    try {
      if (!pts || pts.length < 2) return;
      ctx.save();
      ctx.strokeStyle = glowCol; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowColor = glowCol; ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      // 궤적 중심 백색 코어
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.shadowBlur = 0;
      ctx.stroke();

      // 끝점 스파크
      const last = pts[pts.length - 1];
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(last.x, last.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } catch {}
  },

  // 10. 3D 축구 골대 & 축구공 (모션 키퍼)
  drawSoccerField(goalW, goalH, lives) {
    try {
      // 골대 프레임
      const gx = W / 2 - goalW / 2, gy = H * 0.15;
      ctx.save();
      // 골 그물망
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)"; ctx.lineWidth = 1.5;
      for (let x = gx; x <= gx + goalW; x += 32) {
        ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(gx + (x - gx) * 0.9, gy + goalH); ctx.stroke();
      }
      for (let y = gy; y <= gy + goalH; y += 28) {
        ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + goalW, y); ctx.stroke();
      }
      // 흰색 골대 포스트
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 14; ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(0, 210, 255, 0.5)"; ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(gx, gy + goalH); ctx.lineTo(gx, gy); ctx.lineTo(gx + goalW, gy); ctx.lineTo(gx + goalW, gy + goalH);
      ctx.stroke();
      ctx.restore();
    } catch {}
  },
  drawSoccerBall(x, y, r, rot = 0) {
    try {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)"; ctx.shadowBlur = 12;
      // 흰색 공
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#1a1a1a"; ctx.stroke();
      ctx.shadowBlur = 0;
      // 오각형 패치들
      ctx.fillStyle = "#222222";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.fill();
      for (let a = 0; a < Math.PI * 2; a += Math.PI * 2 / 5) {
        const px = Math.cos(a) * r * 0.72, py = Math.sin(a) * r * 0.72;
        ctx.beginPath(); ctx.arc(px, py, r * 0.22, 0, Math.PI * 2); ctx.fill();
      }
      // 입체 하이라이트
      const hl = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
      hl.addColorStop(0, "rgba(255,255,255,0.7)"); hl.addColorStop(1, "transparent");
      ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } catch {}
  },

  // 11. 스피드 펀치 백 (가죽 샌드백 + 체인 + 물리 반동)
  drawPunchBag(cx, cy, w, h, tilt = 0, flash = 0) {
    try {
      ctx.save();
      ctx.translate(cx, cy - h / 2);
      ctx.rotate(tilt);

      // 천장 체인
      ctx.strokeStyle = "#888888"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, 0); ctx.lineTo(-w * 0.1, -H * 0.2);
      ctx.moveTo(w * 0.3, 0); ctx.lineTo(w * 0.1, -H * 0.2); ctx.stroke();

      // 샌드백 본체
      const bg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      if (flash > 0) {
        bg.addColorStop(0, "#ff99aa"); bg.addColorStop(0.5, "#ffffff"); bg.addColorStop(1, "#ff99aa");
      } else {
        bg.addColorStop(0, "#851428"); bg.addColorStop(0.35, "#d82444"); bg.addColorStop(0.7, "#ff4b72"); bg.addColorStop(1, "#520c18");
      }
      ctx.fillStyle = bg;
      ctx.shadowColor = flash > 0 ? "#ff0055" : "rgba(0,0,0,0.6)"; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.roundRect(-w / 2, 0, w, h, [16, 16, w / 2, w / 2]); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = "#400812"; ctx.stroke();

      // 가죽 스티치 띠
      ctx.fillStyle = "#220409";
      ctx.fillRect(-w / 2, h * 0.25, w, 14);
      ctx.fillRect(-w / 2, h * 0.7, w, 14);

      // 타격 타겟 마크
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, h * 0.48, w * 0.28, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-w * 0.2, h * 0.48); ctx.lineTo(w * 0.2, h * 0.48);
      ctx.moveTo(0, h * 0.48 - w * 0.2); ctx.lineTo(0, h * 0.48 + w * 0.2); ctx.stroke();

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

// ============================================================================
// 🔮 경량 $1 제스처 궤적 매칭 엔진 (Template Matching Engine)
// ============================================================================
const GestureMatcher = {
  templates: {
    circle: (() => {
      const pts = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        pts.push({ x: 50 + Math.cos(a) * 40, y: 50 + Math.sin(a) * 40 });
      }
      return pts;
    })(),
    v: (() => {
      const pts = [];
      for (let i = 0; i < 16; i++) pts.push({ x: 15 + i * 2.2, y: 20 + i * 4.8 });
      for (let i = 0; i < 16; i++) pts.push({ x: 50 + i * 2.2, y: 92 - i * 4.8 });
      return pts;
    })(),
    triangle: (() => {
      const pts = [];
      for (let i = 0; i < 10; i++) pts.push({ x: 50 + i * 3.5, y: 15 + i * 7.5 });
      for (let i = 0; i < 11; i++) pts.push({ x: 85 - i * 7, y: 90 });
      for (let i = 0; i < 11; i++) pts.push({ x: 15 + i * 3.5, y: 90 - i * 7.5 });
      return pts;
    })(),
  },

  resample(points, n = 32) {
    if (points.length < 2) return points;
    let totalLen = 0;
    for (let i = 1; i < points.length; i++) {
      totalLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (totalLen <= 0.001) return Array(n).fill({ ...points[0] });
    const I = totalLen / (n - 1);
    let D = 0;
    const newPts = [{ x: points[0].x, y: points[0].y }];
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (D + d >= I) {
        const qx = points[i - 1].x + ((I - D) / d) * (points[i].x - points[i - 1].x);
        const qy = points[i - 1].y + ((I - D) / d) * (points[i].y - points[i - 1].y);
        newPts.push({ x: qx, y: qy });
        points.splice(i, 0, { x: qx, y: qy });
        D = 0;
      } else D += d;
    }
    while (newPts.length < n) newPts.push({ ...points[points.length - 1] });
    return newPts.slice(0, n);
  },

  normalize(points) {
    if (points.length < 2) return points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = Math.max(maxX - minX, 10), h = Math.max(maxY - minY, 10);
    return points.map((p) => ({
      x: ((p.x - minX) / w) * 100,
      y: ((p.y - minY) / h) * 100
    }));
  },

  match(points) {
    if (points.length < 6) return null;
    const resampled = this.resample([...points], 32);
    const normalized = this.normalize(resampled);

    let bestDist = Infinity, bestName = null;
    for (const [name, tmpl] of Object.entries(this.templates)) {
      let d = 0;
      for (let i = 0; i < 32; i++) {
        d += Math.hypot(normalized[i].x - tmpl[i].x, normalized[i].y - tmpl[i].y);
      }
      d /= 32;
      if (d < bestDist) {
        bestDist = d;
        bestName = name;
      }
    }
    const score = Math.max(0, 1 - bestDist / 48);
    return score >= 0.42 ? { name: bestName, score } : null;
  }
};

// ============================================================================
// 1. 🎵 네온 노트 슬래시 (beat): 비트세이버 정통 게임플레이 디자인 (Body Motion & Parity Flow)
// ============================================================================
games.beat = {
  body: true, bg: "#060312", camAlpha: 0.38,
  trail: (p) => (p.x < W / 2 ? "#00d2ff" : "#ff3377"),
  init() {
    this.halves = [];
    this.walls = []; // 비트세이버 네온 벽 장애물 (Walls)
    this.lanes = [-1.5, -0.5, 0.5, 1.5]; // 4개 3D 레인 (가로 4슬롯)
    this.dirs = ["down", "up", "left", "right", "any"];
    this.lastSwingT = [0, 0];
    this.prevWrist = [{ x: W * 0.35, y: H * 0.6 }, { x: W * 0.65, y: H * 0.6 }];
    this.wristVel = [{ x: 0, y: 0, spd: 0 }, { x: 0, y: 0, spd: 0 }];
    this.sabers = [
      { base: { x: W * 0.35, y: H * 0.6 }, tip: { x: W * 0.3, y: H * 0.4 } },
      { base: { x: W * 0.65, y: H * 0.6 }, tip: { x: W * 0.7, y: H * 0.4 } }
    ];
    this.swingPower = [0, 0];

    // 비트세이버 게임플레이 디자인 코어:
    // 1) 패리티 플로우(Parity Flow): 이전 컷 방향에 따른 자연스러운 포핸드/백핸드 교대
    this.lastDir = { left: "down", right: "down" };
    // 2) 에너지 시스템 (50% 시작, 0~100%)
    this.energy = 50;
    // 3) 콤보 배수 (1x -> 2x -> 4x -> 8x)
    this.multiplier = 1;
    this.wallTimer = 0;
    this.screenShake = 0;
    this.flashColor = null;
  },
  spawn() {
    // 1. 인체공학적 패리티(Parity) 원리에 따른 노트 생성 (시계추 포핸드-백핸드 교대)
    const lane = this.lanes[(Math.random() * this.lanes.length) | 0];
    const isLeft = lane < 0; // 왼쪽 2개 레인은 왼팔 파랑(0), 오른쪽 2개 레인은 오른팔 분홍(1)
    const handKey = isLeft ? "left" : "right";

    // 이전 방향과 반대/대각선으로 이어지도록 패리티 플로우 자동 선택
    let dir = "down";
    const prev = this.lastDir[handKey];
    if (Math.random() < 0.2) {
      dir = "any"; // 점(Dot) 노트
    } else if (prev === "down") {
      dir = Math.random() < 0.7 ? "up" : (isLeft ? "right" : "left");
    } else if (prev === "up") {
      dir = Math.random() < 0.7 ? "down" : (isLeft ? "left" : "right");
    } else {
      dir = Math.random() < 0.5 ? "down" : "up";
    }
    this.lastDir[handKey] = dir;

    // 높이 레이어 (바닥/중단 2단 구조)
    const layer = Math.random() < 0.35 ? -0.15 : 0.05;
    const speed = (0.34 + elapsed() * 0.005) * (currentWave === 3 ? 1.35 : currentWave === 2 ? 1.18 : 1.0);

    objs.push({
      z: 0.05, speed, lane, layer, isLeft, dir,
      color: isLeft ? "#00d2ff" : "#ff3377",
      dead: false, cut: false
    });

    // 2. 비트세이버 전신 벽 장애물 (Walls) 스폰 (온몸으로 좌우 피하기 강제)
    this.wallTimer++;
    if (this.wallTimer >= 9 && Math.random() < 0.6) {
      this.wallTimer = 0;
      const wallSide = Math.random() < 0.5 ? -1 : 1; // -1: 왼쪽 벽, 1: 오른쪽 벽
      this.walls.push({
        z: 0.04, speed: speed * 0.95, side: wallSide,
        w: W * 0.38, h: H * 0.65, dead: false
      });
    }
  },
  interval: () => Math.max(0.30, 0.68 - elapsed() * 0.006),
  update(dt) {
    const judgeZ = 0.94; // 비트세이버 타격 최적 판정선
    const now = performance.now();
    const swing = [false, false];
    const swingDir = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    this.screenShake = Math.max(0, this.screenShake - dt * 3);

    // 콤보 배수(Multiplier) 갱신: 1x -> 2x(2콤보) -> 4x(6콤보) -> 8x(14콤보)
    if (combo >= 14) this.multiplier = 8;
    else if (combo >= 6) this.multiplier = 4;
    else if (combo >= 2) this.multiplier = 2;
    else this.multiplier = 1;

    // 1. 전신 포즈 인식 (MediaPipe Pose 33개 관절) 양팔 세이버 & 스윙 가속도 감지
    const skel = getBody();
    let headX = W / 2, headY = H * 0.35;

    if (!useMouse && skel) {
      // 머리(코 0번 또는 어깨 중심) 좌표 추출 (벽 충돌 판정용)
      if (skel[0] && (skel[0].v ?? 1) > 0.3) {
        headX = skel[0].x; headY = skel[0].y;
      } else if (skel[11] && skel[12]) {
        headX = (skel[11].x + skel[12].x) / 2;
        headY = (skel[11].y + skel[12].y) / 2 - 60;
      }

      // 왼팔(11, 13, 15), 오른팔(12, 14, 16)
      const armIndices = [
        { shoulder: 11, elbow: 13, wrist: 15 },
        { shoulder: 12, elbow: 14, wrist: 16 }
      ];

      armIndices.forEach((arm, i) => {
        const wPt = skel[arm.wrist];
        const ePt = skel[arm.elbow];

        if (wPt && (wPt.v ?? 1) > 0.3) {
          const prev = this.prevWrist[i];
          const vx = wPt.x - prev.x;
          const vy = wPt.y - prev.y;
          const spd = Math.hypot(vx, vy);

          this.wristVel[i] = { x: vx, y: vy, spd };
          this.prevWrist[i] = { x: wPt.x, y: wPt.y };
          this.swingPower[i] = Math.max(0, this.swingPower[i] - dt * 3.5) + spd * 0.18;

          // 팔꿈치 -> 손목 방향 벡터로 광선검 검신(Blade) 길이 약 145px 연장
          let dirX = vx, dirY = vy;
          if (ePt && (ePt.v ?? 1) > 0.3) {
            dirX = wPt.x - ePt.x;
            dirY = wPt.y - ePt.y;
          }
          const len = Math.hypot(dirX, dirY) || 1;
          const nx = (dirX / len) || (i === 0 ? -0.5 : 0.5);
          const ny = (dirY / len) || -0.86;
          const bladeLen = 145 + Math.min(this.swingPower[i] * 5, 45);

          this.sabers[i] = {
            base: { x: wPt.x, y: wPt.y },
            tip: { x: wPt.x + nx * bladeLen, y: wPt.y + ny * bladeLen }
          };

          // 비트세이버 스윙 판정 (가속도 및 각도 피크 감지)
          if (spd > 8.0 && now - this.lastSwingT[i] > 110) {
            swing[i] = true;
            this.lastSwingT[i] = now;
            swingDir[i] = { x: vx, y: vy };
          }
        }
      });
    }

    // 마우스 모드 호환 지원
    if (useMouse) {
      headX = mouse.x; headY = mouse.y;
      const prevM = this.prevWrist[0];
      const mx = mouse.x, my = mouse.y;
      const mSpd = Math.hypot(mx - prevM.x, my - prevM.y);
      this.prevWrist[0] = { x: mx, y: my };
      this.prevWrist[1] = { x: mx, y: my };
      this.wristVel[0] = { x: mx - prevM.x, y: my - prevM.y, spd: mSpd };
      this.wristVel[1] = { x: mx - prevM.x, y: my - prevM.y, spd: mSpd };

      this.sabers[0] = { base: { x: mx - 25, y: my + 20 }, tip: { x: mx - 70, y: my - 105 } };
      this.sabers[1] = { base: { x: mx + 25, y: my + 20 }, tip: { x: mx + 70, y: my - 105 } };

      const isMouseSwing = (mouse.down && mSpd > 3) || mSpd > 12;
      if (isMouseSwing && now - this.lastSwingT[0] > 110) {
        swing[0] = true; swing[1] = true;
        this.lastSwingT[0] = now;
        swingDir[0] = { x: mx - prevM.x, y: my - prevM.y };
        swingDir[1] = { x: mx - prevM.x, y: my - prevM.y };
      }
    }

    // 2. 비트세이버 벽 장애물 (Walls) 진행 및 머리 충돌 판정
    for (const w of this.walls) {
      w.z += w.speed * dt * (0.8 + w.z * 1.5);
      const wallX = w.side < 0 ? W * 0.22 * w.z : W - (W * 0.22 * w.z);

      // 플레이어 판정선(z: 0.82 ~ 1.05) 통과 시 머리(헤드) 충돌 검사
      if (!w.dead && w.z >= 0.82 && w.z <= 1.05) {
        const isInWall = (w.side < 0 && headX < W * 0.42) || (w.side > 0 && headX > W * 0.58);
        if (isInWall) {
          w.hit = true;
          this.energy = Math.max(0, this.energy - 6);
          this.screenShake = 0.25;
          combo = 0; this.multiplier = 1;
          sfx.incoming(headX);
          popup(headX, H * 0.35, "WALL HIT! 피하세요! ⚡", "#ff3366");
        }
      }
      if (w.z > 1.25) w.dead = true;
    }
    this.walls = this.walls.filter((w) => !w.dead);

    // 3. 큐브 노트 전진 및 정통 비트세이버 스코어링 (최대 115점 x 배수)
    for (const o of objs) {
      o.z += o.speed * dt * (0.8 + o.z * 1.5);
      o.x = W / 2 + o.lane * (W * 0.22) * o.z;
      o.y = (H * 0.46 + o.layer * H) + (H * 0.30) * o.z;
      o.r = 16 + o.z * 52;

      // 비트세이버 타격 판정 윈도우 (z: 0.80 ~ 1.08)
      if (!o.dead && !o.cut && o.z >= 0.80 && o.z <= 1.08) {
        let isHit = false;
        let preSwingScore = 50;  // Pre-swing (최대 70점)
        let postSwingScore = 20; // Post-swing (최대 30점)
        let centerScore = 10;    // Center Cut (최대 15점)
        const handIdx = o.isLeft ? 0 : 1;

        // A. 몸 모션액션 타이밍 스윙 판정 (해당 손의 스윙 발생)
        if (swing[handIdx] || (useMouse && (swing[0] || swing[1]))) {
          isHit = true;
          const sDir = swingDir[handIdx];
          const wVel = this.wristVel[handIdx];

          // 1) Pre-swing 각도 평가: 강한 속도 및 각도 확보 시 70점 만점
          if (wVel.spd > 12) preSwingScore = 70;
          else if (wVel.spd > 8.5) preSwingScore = 60;
          else preSwingScore = 45;

          // 2) 컷 방향 일치도 검사 (Post-swing 30점 만점)
          let dirMatch = false;
          if (o.dir === "any") { dirMatch = true; postSwingScore = 30; }
          else if (o.dir === "down" && sDir.y > 2.5) { dirMatch = true; postSwingScore = 30; }
          else if (o.dir === "up" && sDir.y < -2.5) { dirMatch = true; postSwingScore = 30; }
          else if (o.dir === "left" && sDir.x < -2.5) { dirMatch = true; postSwingScore = 30; }
          else if (o.dir === "right" && sDir.x > 2.5) { dirMatch = true; postSwingScore = 30; }
          else { postSwingScore = 15; }

          // 3) Center Cut 정밀도 (타이밍이 정확할수록 만점 15점)
          const zDiff = Math.abs(o.z - judgeZ);
          if (zDiff < 0.05) centerScore = 15;
          else if (zDiff < 0.09) centerScore = 10;
          else centerScore = 5;
        }

        // B. 광선검 검신(Blade Line) 직접 충돌 판정
        if (!isHit) {
          const saber = this.sabers[handIdx] || this.sabers[0];
          if (saber && segHitsCircle(saber.base.x, saber.base.y, saber.tip.x, saber.tip.y, o.x, o.y, o.r + 35)) {
            isHit = true;
            preSwingScore = 60; postSwingScore = 25; centerScore = 15;
          }
        }

        // 충돌 성공 시 정통 비트세이버 타격 판정 및 배수(Multiplier) 점수 부여
        if (isHit) {
          o.dead = true;
          o.cut = true;
          combo++;
          comboTimer = 2.0;
          if (combo > maxCombo) maxCombo = combo;

          // 기본 115점 체계 x 콤보 배수(x1~x8)
          const baseScore = preSwingScore + postSwingScore + centerScore; // 최대 115점
          const finalScore = baseScore * this.multiplier;
          score += finalScore;

          // 에너지 회복
          this.energy = Math.min(100, this.energy + 2.8);
          this.screenShake = 0.08;

          sfx.saber(o.x, o.isLeft);
          burst(o.x, o.y, o.color, baseScore >= 105 ? 36 : 22);

          const isPerfect = baseScore >= 105;
          award(o.x, o.y, finalScore, isPerfect ? "#ffd700" : o.color);

          const cutLabel = isPerfect ? `PERFECT! +${finalScore} [${this.multiplier}x]` : `CUT! +${finalScore} [${this.multiplier}x]`;
          popup(o.x, o.y - 40, cutLabel, isPerfect ? "#ffd700" : o.color);

          this.halves.push(
            { x: o.x - 16, y: o.y, r: o.r, dir: o.dir, color: o.color, vx: -7, vy: -3, half: -1, life: 1 },
            { x: o.x + 16, y: o.y, r: o.r, dir: o.dir, color: o.color, vx: 7, vy: -3, half: 1, life: 1 }
          );
        }
      }

      // 판정선 완전히 지나쳐 놓침 (MISS)
      if (!o.dead && !o.cut && o.z > 1.08) {
        o.dead = true;
        combo = 0;
        this.multiplier = 1;
        this.energy = Math.max(0, this.energy - 7);
        popup(o.x, o.y, "MISS (1x)", "#ff3366");
      }
    }

    objs = objs.filter((o) => !o.dead && o.z < 1.35);
    for (const h of this.halves) {
      h.x += h.vx; h.y += h.vy; h.vy += dt * 32; h.life -= 0.04;
    }
    this.halves = this.halves.filter((h) => h.life > 0);
  },
  draw() {
    const judgeY = H * 0.46 + (H * 0.30) * 0.94;

    ctx.save();
    // 타격 순간 미세 화면 진동 (햅틱 진감 연출)
    if (this.screenShake > 0) {
      ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    }

    // 1. 3D 원근 네온 터널 레인 및 레이저 조명 그리기
    ctx.strokeStyle = "rgba(0, 210, 255, 0.28)"; ctx.lineWidth = 2;
    for (const lane of this.lanes) {
      const farX = W / 2 + lane * (W * 0.22) * 0.08;
      const nearX = W / 2 + lane * (W * 0.22) * 1.15;
      ctx.beginPath();
      ctx.moveTo(farX, H * 0.46 + (H * 0.30) * 0.08);
      ctx.lineTo(nearX, H * 0.46 + (H * 0.30) * 1.15);
      ctx.stroke();
    }

    // 2. 비트세이버 네온 판정 스트라이크 라인
    ctx.strokeStyle = isFeverTime ? "#ff0055" : "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 6; ctx.shadowColor = isFeverTime ? "#ff0055" : "#00d2ff"; ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.moveTo(W * 0.06, judgeY); ctx.lineTo(W * 0.94, judgeY);
    ctx.stroke();

    // 3. 네온 벽 장애물 (Walls) 렌더링
    for (const w of this.walls) {
      const scale = w.z;
      const wallW = w.w * scale;
      const wallH = w.h * scale;
      const wallX = w.side < 0 ? (W * 0.2 - wallW * 0.5) : (W * 0.8 - wallW * 0.5);
      const wallY = H * 0.48 - wallH * 0.4;

      ctx.save();
      ctx.fillStyle = w.hit ? "rgba(255, 51, 102, 0.45)" : "rgba(255, 30, 80, 0.25)";
      ctx.strokeStyle = "#ff2266";
      ctx.lineWidth = 4;
      ctx.shadowColor = "#ff2266"; ctx.shadowBlur = 20;
      ctx.fillRect(wallX, wallY, wallW, wallH);
      ctx.strokeRect(wallX, wallY, wallW, wallH);

      ctx.fillStyle = "#ffffff";
      ctx.font = "900 20px 'Rubik', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("DODGE! ⚠️", wallX + wallW / 2, wallY + 30);
      ctx.restore();
    }

    // 4. 3D 큐브 노트 렌더링 (Z축 깊이 순)
    const sorted = [...objs].sort((a, b) => a.z - b.z);
    for (const o of sorted) {
      Art.drawBeatNote(o.x, o.y, o.r, o.dir, o.color, 0);
    }
    for (const h of this.halves) {
      ctx.save(); ctx.globalAlpha = Math.max(h.life, 0);
      Art.drawBeatNote(h.x, h.y, h.r, h.dir, h.color, h.half);
      ctx.restore();
    }

    // 5. 전신 포즈 스켈레톤 (몸 모션 액션 비주얼)
    const skel = getBody();
    if (!useMouse && skel) {
      drawSkeleton(skel, "rgba(0, 210, 255, 0.45)", 0.6);
    }

    // 6. 비트세이버 양팔 듀얼 광선검 (Saber Blade) 렌더링
    const saberCols = ["#00d2ff", "#ff3377"]; // 왼팔 파랑 🔵, 오른팔 분홍 🔴
    this.sabers.forEach((s, i) => {
      if (!s || !s.base || !s.tip) return;
      const col = saberCols[i];
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 14; ctx.lineCap = "round";
      ctx.shadowColor = col; ctx.shadowBlur = 28;
      ctx.beginPath(); ctx.moveTo(s.base.x, s.base.y); ctx.lineTo(s.tip.x, s.tip.y); ctx.stroke();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 6; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(s.base.x, s.base.y); ctx.lineTo(s.tip.x, s.tip.y); ctx.stroke();
      ctx.fillStyle = "#222233"; ctx.beginPath(); ctx.arc(s.base.x, s.base.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    // 7. 비트세이버 정통 UI: 콤보 배수(Multiplier x1~x8) 링 & 에너지(Life) 바
    // A) 콤보 배수 뱃지 (화면 좌측 하단)
    const multX = W * 0.12, multY = H * 0.86;
    ctx.save();
    ctx.fillStyle = "rgba(10, 10, 25, 0.75)";
    ctx.beginPath(); ctx.arc(multX, multY, 44, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = this.multiplier >= 8 ? "#ffd700" : (this.multiplier >= 4 ? "#b04dff" : "#00d2ff");
    ctx.lineWidth = 5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(multX, multY, 44, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "900 28px 'Rubik', sans-serif";
    ctx.fillText(`${this.multiplier}X`, multX, multY - 4);
    ctx.font = "700 12px sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("MULTIPLIER", multX, multY + 18);
    ctx.restore();

    // B) 에너지 바 (판정선 바로 밑)
    const barW = Math.min(W * 0.44, 380), barH = 10;
    const barX = W / 2 - barW / 2, barY = judgeY + 18;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(barX, barY, barW, barH);
    const engColor = this.energy > 50 ? "#00e676" : (this.energy > 25 ? "#ffd166" : "#ff3366");
    ctx.fillStyle = engColor;
    ctx.shadowColor = engColor; ctx.shadowBlur = 12;
    ctx.fillRect(barX, barY, barW * (this.energy / 100), barH);
    ctx.restore();

    ctx.restore(); // screenShake restore

    topHud("🕺 비트세이버 플로우! 음악에 맞춰 크게 스윙하고 벽(DODGE)은 피하세요!");
    bodyHint();
  }
};

games.magic = {
  bg: "#100924", camAlpha: 0.35, manual: true,
  trail: "#b04dff",
  init() {
    this.stroke = [];
    this.idleTimer = 0;
    this.lastSpell = "";
    this.spellFx = [];
    this.target = { x: W / 2, y: H * 0.32, hp: 100, maxHp: 100, hitFlash: 0 };
    this.monsterType = 0;
  },
  update(dt) {
    this.target.x = W / 2;
    this.target.y = H * 0.32;
    this.target.hitFlash = Math.max(0, this.target.hitFlash - dt * 3);
    const p = pointers[0];
    const isDrawing = p && (useMouse ? mouse.down : (!p.fist && p.speed > 1.5));
    if (isDrawing) {
      this.stroke.push({ x: p.x, y: p.y });
      if (this.stroke.length > 80) this.stroke.shift();
      this.idleTimer = 0.35;
    } else {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0 && this.stroke.length >= 8) {
        const res = GestureMatcher.match(this.stroke);
        if (res) {
          const type = res.name;
          const tx = this.target.x, ty = this.target.y;
          sfx.spell(tx, type);

          // NotebookLM 스펠 체이닝(Spell Chaining): 이전 주문과 연계 시 위력 2배 증폭!
          const isChained = this.prevType && this.prevType !== type;
          const chainMult = isChained ? 1.8 : 1.0;
          this.prevType = type;

          if (type === "v" || type === "lightning") {
            this.lastSpell = isChained ? "⚡ CHAINED LIGHTNING STORM! x2" : "⚡ LIGHTNING BOLT!";
            this.target.hp -= Math.round(35 * chainMult);
            burst(tx, ty, "#ffeb3b", isChained ? 45 : 35);
            award(tx, ty - 60, isChained ? 10 : 5, "#ffeb3b");
          } else if (type === "triangle") {
            this.lastSpell = isChained ? "🔥 GIGA FIREBALL CHAIN! x2" : "🔥 FIREBALL EXPLOSION!";
            this.target.hp -= Math.round(40 * chainMult);
            burst(tx, ty, "#ff5500", isChained ? 50 : 40);
            award(tx, ty - 60, isChained ? 12 : 6, "#ff5500");
          } else {
            this.lastSpell = isChained ? "🛡️ DIVINE ARCANE BARRIER! x2" : "🛡️ ARCANE SHIELD!";
            this.target.hp -= Math.round(25 * chainMult);
            burst(tx, ty, "#00d2ff", isChained ? 40 : 30);
            award(tx, ty - 60, isChained ? 8 : 4, "#00d2ff");
          }

          if (isChained) {
            popup(tx, ty - 130, "🔥 SPELL CHAIN x2 BONUS!!", "#ff0077");
            addShake(0.2, 16);
          }

          this.target.hitFlash = 1;
          this.spellFx.push({ text: this.lastSpell, life: 1.2, x: tx, y: ty - 100 });
          if (this.target.hp <= 0) {
            popup(tx, ty, "MONSTER DEFEATED!", "#ffd700");
            sfx.levelUp();
            this.monsterType = (this.monsterType + 1) % 3;
            this.target.maxHp += 30;
            this.target.hp = this.target.maxHp;
            award(tx, ty, 15, "#ffd700");
            speak("몬스터 처치! 다음 몬스터 등장!", true);
          }
        }
        this.stroke = [];
      }
    }
    for (const f of this.spellFx) f.life -= dt * 0.9;
    this.spellFx = this.spellFx.filter((f) => f.life > 0);
  },
  draw() {
    const tx = this.target.x, ty = this.target.y;
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `${80 + Math.sin(performance.now() * 0.005) * 8}px serif`;
    const emojis = ["👾", "🐉", "👹"];
    ctx.fillText(emojis[this.monsterType] ?? "👾", tx, ty);
    const bw = 240, bh = 14;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.beginPath(); ctx.roundRect(tx - bw / 2, ty + 60, bw, bh, 6); ctx.fill();
    const hpRate = Math.max(0, this.target.hp / this.target.maxHp);
    ctx.fillStyle = hpRate > 0.4 ? "#ff3366" : "#ff0000";
    ctx.beginPath(); ctx.roundRect(tx - bw / 2 + 2, ty + 62, (bw - 4) * hpRate, bh - 4, 4); ctx.fill();
    ctx.font = "800 16px 'Rubik', sans-serif"; ctx.fillStyle = "#fff";
    ctx.fillText(`BOSS HP: ${Math.max(0, Math.ceil(this.target.hp))}`, tx, ty + 95);
    ctx.restore();

    Art.drawMagicRune(this.stroke, "magic", "#b04dff");

    for (const f of this.spellFx) {
      ctx.save();
      ctx.globalAlpha = Math.max(f.life, 0);
      ctx.font = "900 36px 'Rubik', sans-serif";
      ctx.fillStyle = "#ffeb3b"; ctx.shadowColor = "#ffeb3b"; ctx.shadowBlur = 20;
      ctx.textAlign = "center"; ctx.fillText(f.text, f.x, f.y - (1 - f.life) * 40);
      ctx.restore();
    }
    topHud("허공에 원(방어), V(번개), 세모(불꽃) 마법진을 그리세요!");
  }
};

// ============================================================================
// 3. ⚽ 모션 키퍼 골키퍼 (keeper): 3D 슛 슈퍼 세이브 스포츠 모드
// ============================================================================
games.keeper = {
  body: true, bg: "#082112", camAlpha: 0.45,
  init() {
    this.lives = 5;
    this.goalW = Math.min(W * 0.72, 700);
    this.goalH = H * 0.65;
    this.saves = 0;
    this.flash = 0;
  },
  spawn() {
    this.goalW = Math.min(W * 0.72, 700);
    this.goalH = H * 0.65;
    const speed = (0.22 + elapsed() * 0.004) * (currentWave === 3 ? 1.3 : currentWave === 2 ? 1.15 : 1.0);
    const gx = W / 2 - this.goalW / 2;
    const targetX = gx + 60 + Math.random() * (this.goalW - 120);
    const targetY = H * 0.15 + 40 + Math.random() * (this.goalH - 80);
    objs.push({
      z: 0.05, speed, targetX, targetY,
      x: W / 2, y: H * 0.45,
      rot: 0, r: 18, dead: false, saved: false
    });
  },
  interval: () => Math.max(0.48, 1.2 - elapsed() * 0.01),
  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 2);
    for (const b of objs) {
      b.z += b.speed * dt * (0.8 + b.z * 1.4);
      b.x = W / 2 + (b.targetX - W / 2) * b.z;
      b.y = H * 0.45 + (b.targetY - H * 0.45) * b.z;
      b.r = 16 + b.z * 50;
      b.rot += 0.08;

      if (!b.dead && !b.saved && b.z >= 0.75 && b.z <= 1.05) {
        let blocked = false;
        for (const p of pointers) {
          if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + 75 + reach) { blocked = true; break; }
        }
        if (useMouse && Math.hypot(mouse.x - b.x, mouse.y - b.y) < b.r + 75 + reach) {
          blocked = true;
        }
        const skel = getBody();
        if (!blocked && skel) {
          const checkIds = [15, 16, 17, 18, 19, 20, 13, 14, 0, 11, 12];
          for (const idx of checkIds) {
            const pt = skel[idx];
            if (pt && (pt.v ?? 1) > 0.35 && Math.hypot(pt.x - b.x, pt.y - b.y) < b.r + 55 + reach) {
              blocked = true; break;
            }
          }
        }
        if (blocked) {
          b.saved = true;
          this.saves++;
          sfx.gksave(b.x);
          burst(b.x, b.y, "#22c55e", 30);
          award(b.x, b.y, 3, "#22c55e");
          popup(b.x, b.y - 40, "SUPER SAVE! 🧤", "#22c55e");
        }
      }

      if (!b.dead && !b.saved && b.z >= 1.05) {
        b.dead = true;
        this.lives--;
        this.flash = 1;
        sfx.goal();
        speak(this.lives === 1 ? "마지막 골 찬스예요!" : "앗, 골인!");
        popup(b.x, b.y, "GOAL IN! ⚽", "#ff3366");
        if (this.lives <= 0) { endGame(); return; }
      }
    }
    objs = objs.filter((b) => !b.dead && b.z < 1.3);
  },
  draw() {
    Art.drawSoccerField(this.goalW, this.goalH, this.lives);
    const skel = getBody();
    if (!useMouse && skel) {
      drawSkeleton(skel, "rgba(34, 197, 94, 0.85)", 0.55);
      [15, 16].forEach((idx) => {
        const pt = skel[idx];
        if (pt && (pt.v ?? 1) > 0.35) {
          ctx.save();
          ctx.font = "40px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("🧤", pt.x, pt.y);
          ctx.restore();
        }
      });
    }
    if (useMouse) {
      ctx.save();
      ctx.font = "44px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🧤", mouse.x, mouse.y);
      ctx.restore();
    }
    for (const b of objs) {
      if (b.saved) {
        ctx.save(); ctx.globalAlpha = 0.6;
        Art.drawSoccerBall(b.x, b.y, b.r * 0.9, b.rot);
        ctx.restore();
      } else {
        Art.drawSoccerBall(b.x, b.y, b.r, b.rot);
      }
    }
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "32px serif";
    ctx.fillStyle = "#fff"; ctx.fillText(heartsText(this.lives, 5), W / 2, 104);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,50,50,${this.flash * 0.4})`; ctx.fillRect(0, 0, W, H); }
    bodyHint();
  }
};

// ============================================================================
// 4. 🥊 스피드 펀치 백 (box): 양손 주먹 초고속 연타 피트니스 모드
// ============================================================================
games.box = {
  bg: "#160714", camAlpha: 0.45, manual: true,
  trail: "#ff4b72",
  init() {
    this.tilt = 0;
    this.tiltVel = 0;
    // 주먹별 펀치 궤도 FSM 상태 머신 (IDLE -> PUNCH -> RETRACT)
    this.fistFSM = Array.from({ length: 4 }, () => ({
      state: "IDLE",
      lastSpeed: 0,
      cool: 0
    }));
    this.mouseCool = 0;
    this.flash = 0;
    this.punches = 0;
    this.shake = 0;
    this.targets = [];
    this.beatTimer = 0;
    this.beatInterval = 0.72; // 음악 비트 펀치 큐
  },
  update(dt) {
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.tiltVel -= this.tilt * 45 * dt;
    this.tiltVel *= 0.93;
    this.tilt += this.tiltVel * dt;

    const bw = 175, bh = Math.min(H * 0.52, 335);
    const cx = W / 2, cy = H * 0.48;

    // 1. 리듬 펀치 비트 큐 생성 (LEFT / RIGHT 펀치 유도)
    this.beatTimer += dt;
    if (this.beatTimer >= this.beatInterval) {
      this.beatTimer = 0;
      const isLeft = Math.random() < 0.5;
      this.targets.push({
        t: 0, maxT: 0.85, isLeft,
        text: isLeft ? "LEFT JAB 🥊" : "RIGHT STRAIGHT 🥊",
        color: isLeft ? "#00d2ff" : "#ff4b72",
        hit: false
      });
    }

    // 2. 피트니스 섀도우 복싱 펀치 모션 엔진 (화면 샌드백 좌표 매칭 X -> 실제 주먹 궤도와 가속도 피크 인식 O!)
    let punchOccurred = false;
    let punchHandLeft = true;
    let punchIntensity = 1.0;

    // 마우스 모드: 클릭 또는 빠른 스와이프
    if (useMouse) {
      this.mouseCool = Math.max(0, this.mouseCool - dt);
      if (mouse.down && this.mouseCool <= 0) {
        this.mouseCool = 0.15;
        punchOccurred = true;
        punchHandLeft = mouse.x < W / 2;
        punchIntensity = 1.2;
      }
    }

    // 웹캠 손인식: 양손 펀치 궤도 & 가속도 피크(Peak Acceleration) 판정
    pointers.forEach((p, i) => {
      const fsm = this.fistFSM[i] ?? (this.fistFSM[i] = { state: "IDLE", lastSpeed: 0, cool: 0 });
      fsm.cool = Math.max(0, fsm.cool - dt);

      // 손의 위치에 따라 왼주먹 / 오른주먹 자동 구분
      const isLeftFist = p.x < W / 2;
      const spd = p.speed;

      // 🥊 상태 머신:
      // 1) IDLE: 속도 < 7.0 (손을 들고 가만히 있거나 천천히 움직이면 타격 0% 절대 발생 안 함!)
      // 2) PUNCH: 앞으로 주먹을 휙! 뻗는 급격한 가속도 피크 (속도 > 10.2) -> 단 1회 타격 발생!
      // 3) RETRACT: 한 번 친 후 손을 다시 거둬들일 때까지 잠금 (속도가 6.5 이하로 떨어져야 다음 펀치 대기)
      if (fsm.state === "IDLE") {
        const isFistStrike = (spd > 10.2 && spd > fsm.lastSpeed * 1.3) || (p.punch && spd > 8.0);
        if (isFistStrike && fsm.cool <= 0) {
          fsm.state = "RETRACT";
          fsm.cool = 0.14; // 최소 쿨다운
          punchOccurred = true;
          punchHandLeft = isLeftFist;
          punchIntensity = Math.min(2.5, Math.max(1.0, spd / 9.0)); // 움직임 정도에 따른 펀치 세기
        }
      } else if (fsm.state === "RETRACT") {
        if (spd < 6.5 && fsm.cool <= 0) {
          fsm.state = "IDLE";
        }
      }

      fsm.lastSpeed = spd;
    });

    // 3. 펀치 임팩트 발동 및 샌드백 반응
    if (punchOccurred) {
      this.punches++;

      // 타이밍 리듬 비트 타겟과 일치 검사 (LEFT / RIGHT 손 일치 여부)
      const currentTarget = this.targets.find((tg) => !tg.hit && tg.t >= 0.65 && tg.t <= 1.05 && tg.isLeft === punchHandLeft);
      let perfect = false;

      if (currentTarget) {
        currentTarget.hit = true;
        perfect = true;
        const pts = Math.round(3 * punchIntensity);
        award(cx, cy - 60, pts, "#ffd700");
        popup(cx, cy - 90, `PERFECT HIT!! 💥 +${pts}`, "#ffd700");
        addShake(0.18, 14);
      } else {
        const pts = punchIntensity > 1.6 ? 2 : 1;
        award(cx, cy, pts, punchHandLeft ? "#00d2ff" : "#ff4b72");
        if (punchIntensity > 1.6) {
          popup(cx, cy - 70, `HEAVY PUNCH!! 🥊 +2`, punchHandLeft ? "#00d2ff" : "#ff4b72");
          addShake(0.12, 10);
        }
      }

      // 사운드: 피버 타임 시 피치 연속 상승 연타
      if (this.punches >= 20 || isFeverTime) {
        sfx.punchRush(this.punches);
      } else {
        sfx.bagPunch(cx, perfect);
      }

      // 샌드백 물리 틸트: 왼손 펀치는 오른쪽으로, 오른손 펀치는 왼쪽으로 꺾임!
      const tiltDir = punchHandLeft ? 1 : -1;
      this.tiltVel += tiltDir * (perfect ? 0.60 : 0.42) * punchIntensity;
      this.flash = 1;
      this.shake = perfect ? 0.20 : 0.12;

      // 샌드백 타격점에 화려한 파티클 버스트
      const impactCol = punchHandLeft ? "#00d2ff" : "#ff4b72";
      burst(cx + tiltDir * 20, cy, perfect ? "#ffd700" : impactCol, perfect ? 36 : 22);

      if (this.punches % 20 === 0) speak(`${this.punches} 연타 달성! 골든 피버 러시!`, true);
    }

    // 타겟 진행 및 소멸
    for (const tg of this.targets) tg.t += dt / tg.maxT;
    this.targets = this.targets.filter((tg) => tg.t <= 1.15);
  },
  draw() {
    const cx = W / 2, cy = H * 0.48;
    const bw = 175, bh = Math.min(H * 0.52, 335);

    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);

    // 1. 샌드백 본체 렌더링
    Art.drawPunchBag(cx, cy, bw, bh, this.tilt, this.flash);

    // 2. 리듬 펀치 링 & 비트 큐 (LEFT / RIGHT 펀치 안내)
    for (const tg of this.targets) {
      if (tg.hit) continue;
      const scale = Math.max(0.2, 1.8 - tg.t * 0.8);
      const alpha = Math.min(1, Math.max(0, 1 - Math.abs(tg.t - 0.85) * 2));
      ctx.save();
      ctx.strokeStyle = tg.color; ctx.lineWidth = 6;
      ctx.shadowColor = tg.color; ctx.shadowBlur = 18;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, 85 * scale, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = "900 28px 'Rubik', sans-serif";
      ctx.fillStyle = tg.color; ctx.textAlign = "center";
      ctx.fillText(tg.text, cx, cy - 95 * scale);
      ctx.restore();
    }
    ctx.restore();

    // 3. 플레이어 복싱 글러브 렌더링 (자신의 주먹 궤적을 실시간 확인)
    pointers.forEach((p, i) => {
      const isLeft = p.x < W / 2;
      const col = isLeft ? "#00d2ff" : "#ff4b72";
      ctx.save();
      ctx.font = "46px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = col;
      ctx.shadowBlur = 20;
      ctx.fillText("🥊", p.x, p.y);
      ctx.restore();
    });

    if (useMouse) {
      ctx.save();
      ctx.font = "46px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#ff4b72"; ctx.shadowBlur = 20;
      ctx.fillText("🥊", mouse.x, mouse.y);
      ctx.restore();
    }

    ctx.textAlign = "center"; ctx.font = "900 26px 'Rubik', sans-serif"; ctx.fillStyle = "#ffd166";
    ctx.fillText(`TOTAL PUNCHES: ${this.punches}`, cx, H * 0.88);
    topHud("🥊 카메라 앞에서 양주먹을 앞으로 슉! 뻗어 펀치를 날리세요! (가만히 있으면 타격되지 않아요)");
  }
};

function elapsed() { return GAME_SECONDS - timeLeft; }

// ---------- 진행 ----------
let warned10 = false;
let mode = null, score = 0, timeLeft = 0, playing = false, last = 0;
// 5초 레디타임(준비시간) 상태
let isReadyTime = false;
let readyTimeLeft = 5.0;
let lastReadyCount = 5;

// 5초 레디타임 카운트다운 렌더링 (원형 게이지 + 펄스 스케일 + 준비 안내 가이드)
function drawReadyCountdown(t, isBodyGame) {
  const cx = W / 2, cy = H * 0.44;
  const currentSec = Math.max(1, Math.ceil(t));
  const fraction = t - Math.floor(t);
  const scale = 1.0 + Math.pow(fraction, 2) * 0.32; // 초마다 쿵! 하고 수축하는 펄스

  ctx.save();

  // 1. 중앙 어두운 비네팅 & 포커스 링
  const bgGrad = ctx.createRadialGradient(cx, cy, 30, cx, cy, 260);
  bgGrad.addColorStop(0, "rgba(8, 6, 20, 0.72)");
  bgGrad.addColorStop(0.7, "rgba(10, 8, 26, 0.55)");
  bgGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 260, 0, Math.PI * 2);
  ctx.fill();

  // 2. 5초 원형 프로그레스 게이지
  const progress = Math.max(0, Math.min(1, (5.0 - t) / 5.0));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, 115, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = currentSec <= 2 ? "#ff3366" : "#00d2ff";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(cx, cy, 115, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();

  // 3. 상단 READY 라벨 뱃지
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#ffd166";
  ctx.fillStyle = "#ffd166";
  ctx.font = "900 24px 'Rubik', sans-serif";
  ctx.fillText("READY TIME · 준비 시간", cx, cy - 150);

  // 4. 거대한 펄스 카운트다운 숫자
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.shadowBlur = 35;
  const numColor = currentSec <= 2 ? "#ff3366" : "#ffd166";
  ctx.shadowColor = numColor;
  ctx.fillStyle = numColor;
  ctx.font = "900 115px 'Rubik', sans-serif";
  ctx.fillText(currentSec, 0, 8);
  ctx.restore();

  // 5. 하단 동작 준비 안내 가이드
  ctx.shadowBlur = 10;
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.font = "700 21px sans-serif";
  ctx.fillStyle = "#ffffff";
  const guideText = isBodyGame
    ? "카메라 앞에서 1.5~2m 물러서서 준비 자세를 취하세요!"
    : "카메라를 향해 손을 뻗어 준비 자세를 취하세요!";
  ctx.fillText(guideText, cx, cy + 160);

  ctx.font = "500 16px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillText("5초 후 본 게임이 시작됩니다", cx, cy + 192);

  ctx.restore();
}

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

  ctx.save();
  // 글로벌 타격 화면 흔들림(Screen Shake)
  if (globalShake > 0) {
    globalShake -= dt;
    const sx = (Math.random() - 0.5) * globalShakePower;
    const sy = (Math.random() - 0.5) * globalShakePower;
    ctx.translate(sx, sy);
  }

  updatePointers();
  const g = mode ? games[mode] : null;
  drawBackground(g?.bg ?? "#1b1b2f", g?.camAlpha);
  if (playing && g) {
    if (isReadyTime) {
      // 5초 레디타임(준비시간) 카운트다운 처리
      readyTimeLeft -= dt;
      const curCount = Math.max(1, Math.ceil(readyTimeLeft));
      if (curCount !== lastReadyCount) {
        lastReadyCount = curCount;
        sfx.countdown(false); // 1초마다 통통 튀는 카운트다운 비프음
      }

      // 게임 필드 및 포즈/세이버 렌더링 (플레이어가 자신의 위치와 자세를 실시간 체크)
      g.draw();

      // 5초 카운트다운 오버레이 UI 렌더링
      drawReadyCountdown(readyTimeLeft, Boolean(g.body));

      $("score").textContent = "0점";
      $("time").textContent = `READY ${curCount}s`;

      // 5초 카운트다운 종료 시 본격적인 게임 시작
      if (readyTimeLeft <= 0) {
        isReadyTime = false;
        sfx.countdown(true); // 팡파르 시작음
        triggerWaveBanner("WAVE 1", "START! 지금부터 시작!", false);
        speak("시작!", true);
        bgmStart();
        spawnTimer = 0.3;
      }
    } else {
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
    }
  } else if (g) { g.draw(); }
  if (playing) {
    drawFx();
    drawCombo();
    if (g && !g.noCursor) drawTrails(g.trail ?? "#fff");
    if (!useMouse && camInfo && mode) {
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "700 20px sans-serif";
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(W / 2 - 260, H - 52, 520, 36);
      ctx.fillStyle = camOk ? "#80ed99" : "#ffd166"; ctx.fillText(camInfo, W / 2, H - 27);
    }
  } else {
    // 메인 게임 선택 화면에서는 캔버스를 완전히 비워 어떠한 모션 잔상/인식 포인트도 미표시
    ctx.clearRect(0, 0, W, H);
    particles.length = 0;
    popups.length = 0;
    shockwaves.length = 0;
  }
  ctx.restore(); // globalShake restore
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
  document.body.classList.add("playing");

  // 5초 레디타임(준비시간) 가동
  isReadyTime = true;
  readyTimeLeft = 5.0;
  lastReadyCount = 5;
  sfx.countdown(false); // 첫 카운트다운 톤
  speak(INTRO[m], true); // 게임 설명/안내 음성 발화
  warned10 = false;
}
// 점수 고속 롤링 카운트업 함수 (Web Audio 틱 사운드 동기화)
function animateScoreRoll(targetScore) {
  const el = $("finalScore");
  if (!el) return;
  const startTime = performance.now();
  const duration = 850;
  function tickRoll(now) {
    const p = Math.min(1, (now - startTime) / duration);
    const ease = 1 - Math.pow(1 - p, 3);
    const cur = Math.round(targetScore * ease);
    el.textContent = cur.toLocaleString() + "점";
    if (Math.random() < 0.45 && p < 0.95) sfx.tick();
    if (p < 1) {
      requestAnimationFrame(tickRoll);
    } else {
      el.textContent = targetScore.toLocaleString() + "점";
    }
  }
  requestAnimationFrame(tickRoll);
}

function endGame() {
  playing = false;
  $("hud").classList.add("hidden");
  $("feverBorder")?.classList.add("hidden");
  $("waveBanner")?.classList.add("hidden");
  isFeverTime = false;
  const g = games[mode];

  // 1. 2인 대결 모드 (versus) 결과 처리
  if (g && g.versus) {
    const [a, b] = g.s;
    $("finalScore").textContent = `🔵 ${a} : ${b} 🔴`;
    $("resultRank").textContent = a > b ? "BLUE" : b > a ? "RED" : "DRAW";
    $("resultRank").className = "rank-stamp " + (a > b ? "rank-b" : b > a ? "rank-sss" : "rank-s");
    $("rankLabel").textContent = a > b ? "🔵 왼쪽 사람 승리! 🎉" : b > a ? "🔴 오른쪽 사람 승리! 🎉" : "치열한 무승부! 🤝";
    $("finalBest").textContent = `🔵 ${a}점 vs 🔴 ${b}점`;
    $("resultCombo").textContent = "-";
    $("resultGradeText").textContent = a === b ? "TIE" : "WINNER";
    $("newRecordBadge")?.classList.add("hidden");
    $("result").classList.remove("hidden");
    sfx.stamp(); sfx.fanfare();
    speak(a > b ? "파란팀 승리!" : b > a ? "빨간팀 승리!" : "무승부예요!", true);
    return;
  }

  // 2. 1인 아케이드 모드 등급 산정 (SSS, S+, S, A, B, C)
  let rank = "C", rankClass = "c", rankLabel = "KEEP PRACTICING!", gradeTitle = "BEGINNER";
  if (score >= 260) { rank = "SSS"; rankClass = "sss"; rankLabel = "UNSTOPPABLE LEGEND! 🌟"; gradeTitle = "LEGEND"; }
  else if (score >= 180) { rank = "S+"; rankClass = "s"; rankLabel = "SUPERIOR PERFORMANCE! 🔥"; gradeTitle = "MASTER"; }
  else if (score >= 120) { rank = "S"; rankClass = "s"; rankLabel = "SPECTACULAR PLAY! 💎"; gradeTitle = "EXPERT"; }
  else if (score >= 70) { rank = "A"; rankClass = "a"; rankLabel = "GREAT PERFORMANCE! ⚡"; gradeTitle = "PRO"; }
  else if (score >= 35) { rank = "B"; rankClass = "b"; rankLabel = "GOOD EFFORT! 👏"; gradeTitle = "AMATEUR"; }

  const key = "best-" + mode;
  SecureStore.loadCheckpoint(key, 0).then((savedBest) => {
    const curBest = +savedBest || 0;
    const isNewRecord = score > curBest && score > 0;
    const best = Math.max(score, curBest);
    SecureStore.saveCheckpoint(key, best);

    // 랭크 스탬프 & 라벨
    $("resultRank").textContent = rank;
    $("resultRank").className = "rank-stamp rank-" + rankClass;
    $("rankLabel").textContent = rankLabel;

    // 세부 통계 스탯 카드
    $("finalBest").textContent = best.toLocaleString() + "점";
    $("resultCombo").textContent = maxCombo ? `${maxCombo} COMBO` : "0 COMBO";
    $("resultGradeText").textContent = gradeTitle;

    // 신기록 엠블럼
    const recBadge = $("newRecordBadge");
    if (recBadge) {
      if (isNewRecord) recBadge.classList.remove("hidden");
      else recBadge.classList.add("hidden");
    }

    // 결과 모달 오픈 & 팡파르/스탬프 사운드
    $("result").classList.remove("hidden");
    sfx.stamp();
    if (isNewRecord) sfx.fanfare();
    else sfx.end();

    // 점수 롤링 카운트업 실행
    animateScoreRoll(score);

    speak(isNewRecord ? "새로운 최고 기록 달성! 축하합니다!" : `${rank} 등급 클리어!`, true);
  }).catch(() => {
    $("finalScore").textContent = score + "점";
    $("result").classList.remove("hidden");
  });
}
function toMenu() {
  try { speechSynthesis.cancel(); } catch {}
  if (mode) games[mode].exit?.();
  playing = false; mode = null; objs = [];
  isReadyTime = false; readyTimeLeft = 0;
  pointers.length = 0; trails.forEach((t) => (t.length = 0)); lastHands = []; body = null;
  isFeverTime = false; currentWave = 1;
  $("feverBorder")?.classList.add("hidden");
  $("waveBanner")?.classList.add("hidden");
  $("hud").classList.add("hidden"); $("result").classList.add("hidden"); $("menu").classList.remove("hidden");
  document.body.classList.remove("playing");
  showBest();
}
async function showBest() {
  const modesList = [
    ["balloon", "풍선"], ["ninja", "과일"], ["mole", "두더지"], ["space", "유성"],
    ["brick", "벽돌"], ["leak", "물막기"], ["kungfu", "쿵푸"], ["dodge", "피하기"],
    ["pose", "포즈"], ["runner", "달리기"], ["beat", "슬래시"], ["magic", "마법"],
    ["keeper", "골키퍼"], ["box", "펀치백"]
  ];
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
        numHands: 4, // 2인 플레이어 최대 4손(각 2손씩) 완벽 지원
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35
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
