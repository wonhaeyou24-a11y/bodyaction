import { FilesetResolver, HandLandmarker, PoseLandmarker }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { bus } from "./online/bus.js";
import { mulberry32 } from "./online/rng.js";
import { initOnline } from "./online/ui.js";
import { ProfileStore } from "./profiles.js";
import { initSetupGuide } from "./guide.js";
import { createVisionClient } from "./vision-client.js";
import { AlphaBeta } from "./tracker.js";
import { newPunchState, stepPunch } from "./punch.js";
import { matchPose, hintFor, needsLegs, pickPose, levelFor, levelConfig, poseScore, anglesOf, lerpAngles, torsoLength } from "./poses.js";
import { drawMascot, drawGhost, drawUserLimbs, easeOutBack } from "./pose-art.js";
import { bakeToon } from "./costume-toon.js";
import { CostumeMotion } from "./costume-physics.js";

// 👨‍👩‍👧 가족 프로필 저장소(초기화 때 만들어요). 기록 이름(키)은 프로필마다 달라서 항상 recKey()를 거쳐요.
let profiles = null;
const recKey = (base, pid) => (profiles ? profiles.recKey(base, pid) : base);

// 게임 속 "난수". 혼자 할 때는 매번 다른 Math.random, 온라인 대결에서는 같은 시드로 같은 판(장애물/음표 배치)이 나오게 시드 난수를 써요.
// (스폰처럼 판의 내용을 정하는 곳에서만 rng()를 쓰고, 반짝이 같은 꾸밈 효과는 Math.random 그대로예요)
let rng = Math.random;
function seedGame(seed) { rng = Number.isInteger(seed) ? mulberry32(seed) : Math.random; }

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
// 한 판 시간(초). 주소에 ?seconds=8 처럼 붙이면 짧게 테스트할 수 있음 (60초보다 길게는 안 됨)
const GAME_SECONDS = Math.min(60, Math.max(5, Number(new URLSearchParams(location.search).get("seconds")) || 60));

const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("stage"), ctx = canvas.getContext("2d");
// ⚡ 비동기 AI 엔진: 손/몸 인식을 작업자(Web Worker)에서 돌려 게임 화면이 인식 때문에 멈추지 않게 해요.
// 주소에 ?noworker 를 붙이면 예전 방식(화면과 같은 곳에서 인식)으로 돌아가요. 작업자가 안 되면 자동으로 예전 방식.
const USE_WORKER = !location.search.includes("noworker");
const visionAI = createVisionClient({ video });
let W = 0, H = 0;
function resize() {
  const d = 1.0;   // 60 FPS 무지연 렌더링을 위해 캔버스 스케일 1.0 고정 (GPU 렌더링 부하 55% 절감)
  W = innerWidth; H = innerHeight;
  canvas.width = W * d; canvas.height = H * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener("resize", resize); resize();

// ---------- 소리 (효과음 · 배경음악 · 음성) ----------
// ---------- 소리 (효과음 · 배경음악 · 음성) ----------
let actx, master, bgmBus, noiseBuf, soundOn = true, voiceOn = true;

// ============================================================================
// ⚙️ Stitch 아케이드 플레이어 프로필 & 게임 환경 설정 시스템 (Player Settings Manager)
// ============================================================================
const PLAYER_SETTINGS_STORAGE_KEY = "kinetickaboom_player_profile_v1";

const DEFAULT_PLAYER_SETTINGS = {
  nickname: "P1 Leo",
  title: "PARTY LEADER",
  avatar: "assets/avatar.jpg",
  avatarId: "leo",
  level: 14,
  heightMode: "adult", // "adult" | "child"
  reach: 35, // 20 ~ 65 px
  mirror: true,
  skeleton: true,
  mouseMode: false,
  bgmVol: 80, // 0 ~ 100
  sfxVol: 90, // 0 ~ 100
  soundOn: true,
  voiceGuide: true
};

let playerSettings = { ...DEFAULT_PLAYER_SETTINGS };

// 🔒 Zero-Trust Validation & 안전한 설정 로드 함수
function loadPlayerSettings() {
  try {
    const raw = localStorage.getItem(PLAYER_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.nickname === "string") {
          playerSettings.nickname = parsed.nickname.replace(/[<>&"']/g, "").trim().slice(0, 14) || DEFAULT_PLAYER_SETTINGS.nickname;
        }
        if (typeof parsed.title === "string") {
          playerSettings.title = parsed.title.slice(0, 30);
        }
        if (typeof parsed.avatar === "string" && (parsed.avatar.startsWith("assets/") || parsed.avatar.startsWith("data:image/"))) {
          playerSettings.avatar = parsed.avatar === "assets/box.jpg" ? "assets/kungfu.jpg" : parsed.avatar;
          playerSettings.avatarId = parsed.avatarId || "leo";
        }
        if (["adult", "child"].includes(parsed.heightMode)) {
          playerSettings.heightMode = parsed.heightMode;
        }
        if (typeof parsed.reach === "number") {
          playerSettings.reach = Math.max(20, Math.min(65, parsed.reach));
        }
        if (typeof parsed.mirror === "boolean") playerSettings.mirror = parsed.mirror;
        if (typeof parsed.skeleton === "boolean") playerSettings.skeleton = parsed.skeleton;
        if (typeof parsed.mouseMode === "boolean") playerSettings.mouseMode = parsed.mouseMode;
        if (typeof parsed.bgmVol === "number") playerSettings.bgmVol = Math.max(0, Math.min(100, parsed.bgmVol));
        if (typeof parsed.sfxVol === "number") playerSettings.sfxVol = Math.max(0, Math.min(100, parsed.sfxVol));
        if (typeof parsed.soundOn === "boolean") playerSettings.soundOn = parsed.soundOn;
        if (typeof parsed.voiceGuide === "boolean") playerSettings.voiceGuide = parsed.voiceGuide;
      }
    }
  } catch (err) {
    console.warn("플레이어 설정 로드 실패, 기본값 사용:", err);
  }
  applyPlayerSettings();
}

function savePlayerSettings() {
  try {
    localStorage.setItem(PLAYER_SETTINGS_STORAGE_KEY, JSON.stringify(playerSettings));
  } catch (err) {
    console.warn("플레이어 설정 저장 실패:", err);
  }
  profiles?.update(profiles.activeId, { nickname: playerSettings.nickname, title: playerSettings.title, avatar: playerSettings.avatar, avatarId: playerSettings.avatarId });
  applyPlayerSettings();
}

function applyPlayerSettings() {
  // 1. 헤더 프로필 UI 업데이트
  const elAvatar = $("headerAvatarImg");
  const elName = $("headerPlayerName");
  const elTitle = $("headerPlayerTitle");
  if (elAvatar) elAvatar.src = playerSettings.avatar;
  if (elName) elName.textContent = playerSettings.nickname;
  if (elTitle) elTitle.textContent = playerSettings.title;

  // 2. 사운드 볼륨 & 플래그 동기화
  soundOn = playerSettings.soundOn;
  voiceOn = playerSettings.voiceGuide;
  if (master && master.gain) {
    master.gain.value = soundOn ? (playerSettings.sfxVol / 100) : 0;
  }
  if (bgmBus && bgmBus.gain) {
    bgmBus.gain.value = soundOn ? (playerSettings.bgmVol / 100) * 0.9 : 0;
  }
  if (bgmAudio) {
    bgmAudio.volume = soundOn ? (playerSettings.bgmVol / 100) * 0.95 : 0;
  }

  // 3. 마우스 조작 모드 동기화
  useMouse = playerSettings.mouseMode;
  const chkMouse = $("useMouse");
  if (chkMouse) chkMouse.checked = useMouse;
}

function ac() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    const comp = actx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-14, actx.currentTime);
    comp.knee.setValueAtTime(30, actx.currentTime);
    comp.ratio.setValueAtTime(5, actx.currentTime);
    comp.attack.setValueAtTime(0.003, actx.currentTime);
    comp.release.setValueAtTime(0.25, actx.currentTime);
    master.connect(comp).connect(actx.destination);
    bgmBus = actx.createGain();
    bgmBus.gain.value = soundOn ? (playerSettings.bgmVol / 100) * 0.9 : 0;
    bgmBus.connect(master);
  }
  if (actx.state === "suspended") actx.resume();
  master.gain.value = soundOn ? (playerSettings.sfxVol / 100) : 0;
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
  batSwing(x) {
    const t = ac().currentTime, p = panOf(x);
    // 바람을 가르는 날카로운 스윙 풍압음
    noise(t, 0.12, 0.28, 1900, p);
    tone(360, t, 0.11, "sawtooth", 0.10, 110, p);
  },
  homeRun(x) {
    const t = ac().currentTime, p = panOf(x);
    // '딱!' 하는 맑고 강력한 배트 스냅 타격음 + 폭발 저음
    tone(1900, t, 0.07, "triangle", 0.45, 420, p);
    tone(210, t, 0.28, "sine", 0.50, 32, p);
    noise(t, 0.16, 0.40, 1400, p);
    setTimeout(() => { try { sfx.fanfare(); } catch {} }, 120);
  },
  kungfuGuard(x) {
    const t = ac().currentTime, p = panOf(x);
    // '챙!' 하고 맑게 튕겨내는 금속/기공 가드 방어음
    tone(2400, t, 0.09, "sine", 0.45, 1200, p);
    tone(1600, t + 0.02, 0.12, "triangle", 0.35, 600, p);
    noise(t, 0.06, 0.25, 3200, p);
  },
  kungfuDragon(x) {
    const t = ac().currentTime, p = panOf(x);
    // 화염 용오름 포효 (저주파 럼블 + 라이징 신스)
    tone(85, t, 0.45, "sawtooth", 0.55, 380, p);
    tone(60, t + 0.05, 0.60, "sine", 0.60, 25, p);
    noise(t, 0.50, 0.45, 450, p);
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
    // 1. 묵직한 서브우퍼 베이스 임팩트 펀치 (가슴을 울리는 비트세이버 타격감, 175Hz -> 30Hz 하향)
    tone(left ? 175 : 155, t, 0.14, "sine", 0.46, 30, p);
    // 2. 찰진 일렉트릭 플라즈마 파열음 (화이트 노이즈 2600Hz + 고속 톱니파 슬라이스 사운드)
    tone(left ? 1100 : 900, t, 0.08, "sawtooth", 0.22, 260, p);
    noise(t, 0.09, 0.32, 2600, p);
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
  costumeEquip() {
    const t = ac().currentTime;
    tone(440, t, 0.06, "sine", 0.25, 880);
    tone(880, t + 0.05, 0.09, "triangle", 0.3, 1760);
    noise(t + 0.03, 0.05, 0.15, 2400);
  },
  costumeUnequip() {
    const t = ac().currentTime;
    tone(660, t, 0.06, "sine", 0.2, 330);
    tone(330, t + 0.05, 0.08, "triangle", 0.18, 165);
  },
  nanoSuitUp(phase = 1) {
    const t = ac().currentTime;
    const baseFreq = 220 * Math.pow(1.22, phase);
    tone(baseFreq, t, 0.14, "sawtooth", 0.28, baseFreq * 2.2);
    tone(baseFreq * 1.5, t + 0.04, 0.18, "triangle", 0.25);
    noise(t, 0.12, 0.22, 1800);
  },
  repulsorBeam(x) {
    const t = ac().currentTime, p = panOf(x || W / 2);
    tone(980, t, 0.24, "sine", 0.4, 180, p);
    tone(1480, t + 0.03, 0.22, "sawtooth", 0.35, 240, p);
    noise(t, 0.25, 0.3, 3200, p);
  },
  coinGain() {
    const t = ac().currentTime;
    tone(987.77, t, 0.08, "sine", 0.35, 1318.51);
    tone(1318.51, t + 0.07, 0.14, "triangle", 0.4);
  },
  coinSpend() {
    const t = ac().currentTime;
    tone(523.25, t, 0.08, "triangle", 0.3);
    tone(659.25, t + 0.06, 0.09, "sine", 0.35);
    tone(783.99, t + 0.12, 0.14, "sine", 0.4);
  },
};

// 음성 안내 (브라우저 내장 한국어 음성 - 크롬/엣지 GC 버그 원천 차단)
let lastVoice = 0;
let activeUtterance = null;
function speak(text, force = false) {
  if (!voiceOn || !window.speechSynthesis) return;
  const n = performance.now();
  if (!force && n - lastVoice < 1200) return;
  lastVoice = n;
  try {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    activeUtterance = u; // 🛡️ 전역 참조를 보관하여 가비지 컬렉션(GC) 도중단 끊김 원천 차단
    u.lang = "ko-KR"; u.rate = 1.1; u.pitch = 1.15;
    u.onend = () => { activeUtterance = null; };
    u.onerror = () => { activeUtterance = null; };
    speechSynthesis.speak(u);
  } catch (err) {
    console.warn("음성 안내 발화 오류(안전 무시):", err);
  }
}
const INTRO = {
  balloon: "날아오르는 풍선을 손으로 터뜨리세요!",
  ninja: "과일을 날카롭게 베어내세요! 폭탄은 조심하세요!",
  space: "지구를 향해 쏟아지는 유성을 막아내세요!",
  draw: "허공에 멋진 그림을 그려 보세요!",
  dodge: "온몸을 움직여 날아오는 돌을 피하고 동전을 모으세요!",
  brick: "손으로 공을 튕겨 벽돌을 모두 깨뜨리세요!",
  runner: "점프하고 숙이며 장애물을 피하는 달리기 게임입니다!",
  kungfu: "다가오는 악당들을 주먹으로 빠르게 물리치세요!",
  pose: "화면 캐릭터와 똑같은 자세를 따라 해요! 자세는 점점 어려워져요!",
  versus: "2인 대결 게임! 풍선을 먼저 터뜨리는 사람이 승리합니다!",
  beat: "음악에 맞춰 날아오는 네온 큐브를 온몸으로 시원하게 베어내세요!",
  keeper: "골대를 향해 날아오는 공을 온몸과 손으로 막아내세요!",
  box: "샌드백을 향해 양주먹으로 신나게 펀치를 연타하세요!",
  baseball: "타석에 서서 날아오는 공을 배트로 힘차게 휘둘러 홈런을 날리세요!",
};

// 배경음악: 게임마다 분위기가 다르고, 시간이 갈수록 점점 빨라짐
// 🎵 네온 노트 슬래시 전용 랜덤 멀티 사운드트랙 (시작할 때마다 다양한 비트와 리듬 제공)
// 배경음악: 게임마다 분위기가 다르고, 시간이 갈수록 점점 빨라짐
// 🎵 네온 노트 슬래시 전용 대중적인 명곡 & EDM 사운드트랙 라인업
// 배경음악: 게임마다 분위기가 다르고, 시간이 갈수록 점점 빨라짐
// 🎵 네온 노트 슬래시 전용 고음질 실제 실연 음원(MP3/OGG) & 대중 명곡 라인업
const BEAT_TRACKS = [
  {
    id: "radetzky",
    title: "🎺 라데츠키 행진곡 (Radetzky March)",
    genre: "USMC ORCHESTRA MARCH",
    bpm: 140,
    firstBeat: 1.52, // 🎵 1.52초에 첫 오케스트라 튜티 강박 시작!
    approachTime: 1.8, // 1.8초 동안 소실점에서 판정선으로 정확히 날아옴
    root: 293.66, // D4
    audioFile: "assets/music/radetzky.mp3", // 🎵 미국 해병대 군악대 실제 오케스트라 녹음 MP3!
    melody: [
      0, 2, 4, 5,   9, null, 9, null,   9, null, 9, null,   11, null, 7, null,
      7, null, 7, null,   5, null, 4, null,   2, null, 0, null,   0, 2, 4, 5,
      9, null, 9, null,   9, null, 9, null,   12, null, 11, null,   9, null, 7, null,
      5, null, 4, null,   2, null, 0, null,   -1, null, 0, null,   2, null, 4, null
    ],
    bassSeq: [0, 0, 7, 7, 0, 0, 7, 0],
    wave: "sawtooth",
    drums: "edm",
    vol: 0.90,
    noteSpeed: 1.12,
    tagColor: "#ffcc00"
  },
  {
    id: "virus",
    title: "⚡ 베토벤 바이러스 (Beethoven Virus)",
    genre: "PATHETIQUE PIANO ROCK",
    bpm: 152,
    firstBeat: 0.38, // 🎵 0.38초에 첫 피아노 타건 비트 시작!
    approachTime: 1.6,
    root: 261.63, // C4
    audioFile: "assets/music/virus.ogg", // 🎵 베토벤 비창 3악장 실제 피아노 실연 음원!
    melody: [
      7, 12, 14, 15,   14, 12, 11, 12,   14, null, 7, null,   11, 12, 14, null,
      12, 11, 8, 11,   12, null, 7, null,   12, 14, 15, 17,   15, 14, 12, null,
      7, 12, 14, 15,   14, 12, 11, 12,   14, null, 7, null,   11, 12, 14, null,
      12, 11, 8, 11,   12, null, 0, null,   3, 2, 0, 2,   0, null, null, null
    ],
    bassSeq: [0, 0, 7, 0, 0, 0, 7, 0],
    wave: "sawtooth",
    drums: "edm",
    vol: 0.92,
    noteSpeed: 1.25,
    tagColor: "#ff3366"
  },
  {
    id: "turkish",
    title: "⚜️ 터키 행진곡 (Turkish March Cyber)",
    genre: "MOZART PIANO DANCE",
    bpm: 138,
    firstBeat: 0.12, // 🎵 0.12초에 첫 음 시작!
    approachTime: 1.7,
    root: 220, // A3
    audioFile: "assets/music/turkish.ogg", // 🎵 모차르트 터키 행진곡 실제 피아노 실연 음원!
    melody: [
      2, 0, -1, 0,   3, null, null, null,   5, 3, 2, 3,   7, null, null, null,
      8, 7, 6, 7,   14, 12, 11, 12,   14, null, 14, null,   12, 11, 9, 7,
      2, 0, -1, 0,   3, null, null, null,   5, 3, 2, 3,   7, null, null, null,
      8, 7, 6, 7,   14, 12, 11, 12,   14, null, 11, null,   12, null, null, null
    ],
    bassSeq: [0, 0, 0, 0, 0, 0, 7, 0],
    wave: "square",
    drums: "edm",
    vol: 0.88,
    noteSpeed: 1.10,
    tagColor: "#00ffcc"
  },
  {
    id: "saints",
    title: "🥁 성자의 행진 (When the Saints)",
    genre: "BRASS BAND MARCH",
    bpm: 132,
    firstBeat: 0.64, // 🎵 0.64초에 첫 브라스 비트 시작!
    approachTime: 1.8,
    root: 261.63, // C4
    audioFile: "assets/music/saints.ogg", // 🎵 실제 브라스 밴드 연주 실연 음원!
    melody: [
      0, null, 4, null,   5, null, 7, null,   null, null, null, null,   null, null, null, null,
      0, null, 4, null,   5, null, 7, null,   null, null, null, null,   null, null, null, null,
      0, null, 4, null,   5, null, 7, null,   4, null, 0, null,   4, null, 2, null,
      null, null, null, null,   null, null, null, null,   null, null, null, null,   null, null, null, null
    ],
    bassSeq: [0, 0, 0, 0, 0, 0, 7, 0],
    wave: "triangle",
    drums: "edm",
    vol: 0.88,
    noteSpeed: 1.05,
    tagColor: "#ff9900"
  },
  {
    id: "canon",
    title: "✨ 캐논 변주곡 (Pachelbel's Canon)",
    genre: "STRINGS ORCHESTRA",
    bpm: 134,
    firstBeat: 0.60, // 🎵 0.60초에 첫 현악 소절 시작!
    approachTime: 1.8,
    root: 293.66, // D4
    audioFile: "assets/music/canon.ogg", // 🎵 실제 현악 오케스트라 실연 음원!
    melody: [
      9, null, 7, null,   5, null, 4, null,   2, null, 0, null,   2, null, 4, null,
      5, null, 4, null,   2, null, 0, null,   -1, null, -3, null,   -1, null, 0, null,
      2, 4, 5, 7,   9, 7, 5, 4,   2, 4, 5, 4,   2, 0, 2, 4,
      5, 4, 2, 0,   -1, 0, 2, 0,   -1, -3, -1, 0,   2, 0, 2, 4
    ],
    bassSeq: [0, -5, -3, -8, -7, -12, -7, -5],
    wave: "sawtooth",
    drums: "edm",
    vol: 0.88,
    noteSpeed: 1.06,
    tagColor: "#70a1ff"
  },
  {
    id: "overdrive",
    title: "⚡ Cyber Overdrive",
    genre: "CYBERPUNK EDM",
    bpm: 144,
    firstBeat: 0.30,
    approachTime: 1.7,
    root: 220,
    scale: [0, 3, 5, 7, 10],
    prog: [0, 5, 7, 3],
    wave: "sawtooth",
    drums: "edm",
    vol: 0.88,
    noteSpeed: 1.15,
    tagColor: "#00d2ff"
  },
  {
    id: "tokyo",
    title: "🌌 Neon Tokyo Drift",
    genre: "SYNTH HOUSE",
    bpm: 128,
    firstBeat: 0.30,
    approachTime: 1.8,
    root: 261.63,
    scale: [0, 2, 4, 7, 9],
    prog: [0, 7, 9, 5],
    wave: "square",
    drums: "edm",
    vol: 0.85,
    noteSpeed: 1.0,
    tagColor: "#ff3377"
  }
];
let lastBeatTrackIdx = -1;

const BGM = {
  balloon: { bpm: 112, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "triangle", drums: "pop", vol: 0.65 },
  ninja:   { bpm: 124, root: 196, scale: [0, 1, 5, 7, 8], prog: [0, 0, 5, 3], wave: "square", drums: "taiko", vol: 0.70 },
  space:   { bpm: 92, root: 130.81, scale: [0, 3, 5, 7, 10], prog: [0, 0, 8, 5], wave: "sine", drums: "drone", vol: 0.65 },
  draw:    { bpm: 76, root: 196, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "sine", drums: "none", vol: 0.5 },
  dodge:   { bpm: 132, root: 220, scale: [0, 3, 5, 7, 10], prog: [0, 3, 5, 7], wave: "square", drums: "pop", vol: 0.65 },
  pose:    { bpm: 116, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 0], wave: "triangle", drums: "pop", vol: 0.70 },
  brick:   { bpm: 118, root: 293.66, scale: [0, 2, 4, 7, 9], prog: [0, 7, 5, 7], wave: "square", drums: "pop", vol: 0.65 },
  runner:  { bpm: 138, root: 220, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "square", drums: "pop", vol: 0.65 },
  kungfu:  { bpm: 128, root: 196, scale: [0, 1, 5, 7, 8], prog: [0, 0, 5, 3], wave: "sawtooth", drums: "taiko", vol: 0.70 },
  versus:  { bpm: 130, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 7, 9, 5], wave: "sawtooth", drums: "pop", vol: 0.65 },
  beat:    { ...BEAT_TRACKS[0] },
  keeper:  { bpm: 130, root: 293.66, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 5], wave: "square", drums: "pop", vol: 0.65 },
  box:     { bpm: 136, root: 196, scale: [0, 1, 5, 7, 8], prog: [0, 0, 5, 3], wave: "sawtooth", drums: "taiko", vol: 0.70 },
  baseball:{ bpm: 128, root: 261.63, scale: [0, 2, 4, 7, 9], prog: [0, 5, 7, 0], wave: "sawtooth", drums: "pop", vol: 0.70 },
};
const ARP = [0, 2, 1, 3, 2, 4, 3, 1];
let bgmNext = 0, bgmStep = 0;

// 🎵 실제 고음질 MP3/오디오 음원 플레이어 시스템 (비트세이버급 사운드 퀄리티)
let bgmAudio = null;
function prepareRealTrackAudio(fileUrl, loop = true) {
  try {
    stopRealTrackAudio();
    if (!fileUrl) return;
    bgmAudio = new Audio(fileUrl);
    bgmAudio.loop = loop;
    bgmAudio.preload = "auto";
    bgmAudio.volume = soundOn ? 0.95 : 0;
    bgmAudio.addEventListener("error", (e) => {
      console.warn("오디오 파일 로드 에러 감지 -> 신스 엔진으로 즉각 폴백:", e);
      if (mode === "beat" && BGM.beat) BGM.beat.audioFile = null;
    });
  } catch (err) {
    console.warn("오디오 사전 로드 예외 -> 신스 폴백:", err);
    if (mode === "beat" && BGM.beat) BGM.beat.audioFile = null;
  }
}

function playRealTrackAudio(fileUrl, loop = true) {
  try {
    if (!bgmAudio || bgmAudio.src !== fileUrl) {
      prepareRealTrackAudio(fileUrl, loop);
    }
    if (!bgmAudio) return;
    bgmAudio.currentTime = 0;
    const p = bgmAudio.play();
    if (p && typeof p.catch === "function") {
      p.catch((e) => {
        console.warn("오디오 재생 정책/로딩 지연 -> 신스 자동 서포트:", e);
      });
    }
  } catch (err) {
    console.warn("실제 오디오 음원 재생 실패, 신스 폴백 가동:", err);
    if (mode === "beat" && BGM.beat) BGM.beat.audioFile = null;
  }
}

function stopRealTrackAudio() {
  if (bgmAudio) {
    try {
      bgmAudio.pause();
      bgmAudio.currentTime = 0;
    } catch {}
    bgmAudio = null;
  }
}

function bgmStart() {
  ac();
  bgmNext = actx.currentTime + 0.05;
  bgmStep = 0;
  const c = BGM[mode];
  if (c && c.audioFile) {
    // 🎵 beat 모드는 레디타임 5초 동안 미리 버퍼링을 완료하고 5초 종료 시 정확히 0.00초부터 웅장하게 재생!
    if (mode === "beat" && isReadyTime) {
      prepareRealTrackAudio(c.audioFile, true);
    } else {
      playRealTrackAudio(c.audioFile, true);
    }
  } else {
    stopRealTrackAudio();
  }
}

function bgmTick(isIntro = false) {
  const c = BGM[mode];
  if (!c || !playing || !actx) return;
  try {
    // 🛡️ 무한 루프 & 탭 전환 시차 원천 방어 (AudioContext 시간 드리프트 자동 재동기화)
    if (actx.currentTime - bgmNext > 0.8 || bgmNext < actx.currentTime - 0.8) {
      bgmNext = actx.currentTime;
    }
    let loopGuard = 0;
    while (bgmNext < actx.currentTime + 0.25 && ++loopGuard < 16) {
      const e = bgmStep++, s = e % 8, bar = (e / 8) | 0, ch = (c.prog ? c.prog[bar % (c.prog.length || 4)] : 0), t = bgmNext, v = (c.vol ?? 0.8) * (isIntro ? 0.75 : 1.0);
      const bpmSafe = Math.max(40, c.bpm || 120);
      const speed = Math.max(0.5, 1 + (isIntro ? 0 : Math.min(elapsed(), 60) * 0.003 + (timeLeft < 10 ? 0.08 : 0)));
      bgmNext += 60 / (bpmSafe * speed) / 2;
      const f = (semi, oct = 1) => c.root * oct * 2 ** ((semi + ch) / 12);

      // 1. 묵직한 서브 베이스라인 (실제 음원이 연주 중일 때는 과하지 않게 조화로운 저음 서포트)
      if (s % 2 === 0) {
        if (!c.audioFile) {
          if (c.bassSeq && c.bassSeq.length > 0) {
            const bassSemi = c.bassSeq[bar % c.bassSeq.length];
            tone(c.root * 0.5 * 2 ** (bassSemi / 12), t, 0.28, "triangle", 0.28 * v, undefined, undefined, bgmBus);
          } else {
            tone(f(0, 0.5), t, 0.28, "triangle", 0.26 * v, undefined, undefined, bgmBus);
          }
        }
      }

      // 2. 신스 리드 멜로디 (실제 오디오 음원이 없을 때만 신스 멜로디 연주, 있으면 실제 음원이 노래를 연주!)
      if (!c.audioFile && (!isIntro || (bar >= 1 && s % 4 === 0))) {
        if (c.melody && c.melody.length > 0) {
          const noteIdx = e % c.melody.length;
          const semi = c.melody[noteIdx];
          if (semi !== null && semi !== undefined) {
            tone(c.root * 2 ** (semi / 12), t, 0.20, c.wave || "sawtooth", 0.19 * v, undefined, ((s % 4) - 1.5) / 3, bgmBus);
          }
        } else if (c.scale && c.scale.length > 0) {
          if ((c.drums !== "drone" || s % 4 === 0) && Math.random() < 0.82) {
            const idx = (ARP[s] + (bar % 2)) % c.scale.length;
            tone(f(c.scale[idx], 2), t, 0.18, c.wave || "sawtooth", 0.14 * v, undefined, ((s % 4) - 1.5) / 3, bgmBus);
          }
        }
      }

      // 3. 비트 드럼 엔진 (4-on-the-floor EDM & POP)
      if (c.drums === "edm") {
        // 💥 강력한 4-on-the-floor 펀치 서브 킥 (정박 s=0, 2, 4, 6)
        if (s % 2 === 0) {
          tone(175, t, 0.18, "sine", 0.58 * v, 36, undefined, bgmBus);
          // 비트 플래시 시각적 펄스 연동 (정박 킥에 칼같이 점등!)
          if (mode === "beat" && games.beat) {
            games.beat.beatFlash = Math.max(games.beat.beatFlash || 0, isIntro ? 0.45 : 0.85);
          }
        }
        // 🎶 찰진 일렉트릭 스네어 & 클랩 (2, 4박자 정박 - s=2, 6)
        if (!isIntro && (s === 2 || s === 6)) {
          tone(210, t, 0.12, "sine", 0.32 * v, 80, undefined, bgmBus);
          noise(t, 0.13, 0.22 * v, 2400, undefined, bgmBus);
        }
        // ⚡ 오프비트 오픈 하이햇 (엇박 s=1, 3, 5, 7)
        if (s % 2 === 1) {
          noise(t, 0.07, 0.09 * v, 7500, ((s % 4) - 1.5) / 3, bgmBus);
        }
      } else if (c.drums === "pop") {
        if (s % 4 === 0) tone(145, t, 0.18, "sine", 0.42 * v, 42, undefined, bgmBus);
        if (s === 2 || s === 6) noise(t, 0.12, 0.14 * v, 2000, undefined, bgmBus);
        noise(t, 0.04, 0.05 * v, 7200, ((s % 2) - 0.5) / 2, bgmBus);
      } else if (c.drums === "taiko") {
        if (s === 0 || s === 3 || s === 4 || s === 7) tone(110, t, 0.25, "sine", 0.5 * v, 38, undefined, bgmBus);
        if (s === 2 || s === 6) noise(t, 0.12, 0.16 * v, 1100, undefined, bgmBus);
      } else if (c.drums === "drone") {
        if (s === 0) { tone(f(0, 0.5), t, 1.8, "sawtooth", 0.08, undefined, -0.4, bgmBus); tone(f(0, 0.5) * 1.01, t, 1.8, "sawtooth", 0.08, undefined, 0.4, bgmBus); }
        if (s % 4 === 0) tone(85, t, 0.2, "sine", 0.25, 38, undefined, bgmBus);
      }
    }
  } catch (err) {
    console.warn("bgmTick safe guard:", err);
  }
}

// ---------- 입력 (손가락 끝 / 마우스) ----------
let useMouse = false;
let handLandmarker = null;
const pointers = [];            // 현재 프레임의 포인터: {x, y, px, py, speed}
const MAX_HANDS = 2; // 1인 플레이어 2손 초고속 추적 최적화 (연산량 50% 절감 & 60 FPS 즉각 반응)
const trails = Array.from({ length: MAX_HANDS }, () => []);
const mouse = { x: -100, y: -100, down: false, p: -1e9 };

addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener("pointerdown", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; mouse.p = performance.now(); });
addEventListener("pointerup", () => { mouse.down = false; });

// ============================================================================
// 🧠 SOTA 모션 인식 코어: 1유로 필터 (One Euro Filter - CHI 2012 국제 표준)
// 정지 상태: 컷오프 주파수 최소화로 미세 지터/떨림 0.0px 완전 박멸
// 고속 이동: beta 0.075로 속도 비례 주파수 즉각 폭증 -> 지연 시간 0ms 실시간 추종!
// ============================================================================
class OneEuroFilter {
  constructor(minCutoff = 1.3, beta = 0.075, dCutoff = 1.0) {
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
    // 속도 연동 동적 컷오프 주파수 (beta 0.075로 고속 스윙 시 컷오프 대폭 상승하여 래그 제로)
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

// 2손 독립 1유로 필터 세트 (초고속 반응 튜닝)
const euroFilters = Array.from({ length: MAX_HANDS }, () => ({
  x: new OneEuroFilter(1.3, 0.075),
  y: new OneEuroFilter(1.3, 0.075)
}));

function videoToScreen(lm) {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  const rawX = lm.x * vw * s + ox;
  const isMirror = playerSettings ? playerSettings.mirror !== false : true;
  return { x: isMirror ? (W - rawX) : rawX, y: lm.y * vh * s + oy };
}

let lastFist = [], fistCount = [], lastSeen = 0, sizeHist = [], lastPunch = [];
let body = null, bodySeen = 0, lastBodyTime = -1, camOk = false, poseLandmarker = null;
let lastHands = [], rawPrev = [], camInfo = "", detectMs = 0;
let isDetectingHands = false, isDetectingBody = false, lastDetectTimestamp = 0;
let lastHandInferEndTime = 0, lastPoseInferEndTime = 0;
let handVelocities = Array.from({ length: MAX_HANDS }, () => ({ vx: 0, vy: 0 }));
let bodyVelocities = []; // (예전 방식 호환용)
// 📍 위치 추적기: 인식 결과가 들쭉날쭉한 간격으로 와도 손/관절이 튀지 않고 부드럽게 따라가게 해요 (tracker.js)
const handTracks = Array.from({ length: MAX_HANDS }, () => new AlphaBeta({ alpha: 0.5, beta: 0.18 }));
const BODY_AB = { alpha: 0.55, beta: 0.18, tau: 60, maxPredictMs: 120, stillSpeed: 0.04, jumpPx: 300 };
let bodyTracks = [], bodyVis = [], bodyHave = false;
const ptrVps = [];       // 손별 초당 이동 속도(px/s) - 프레임 수와 상관없는 속도 (펀치 판정용)
let lastHandsInferFresh = false; // 이번 프레임에서 새로 AI 추론이 되었는지 여부
let lastPointerUpdateTime = 0, lastHandT0 = 0, lastPoseT0 = 0;   // 결과 간격(속도 단위 보정용)

const workerStallMs = () => Math.max(1200, 6 * (visionAI.stats.inferMs || 0));
function updatePointers() {
  if ((!playing || !mode) && !isCostumeRoomOpen) {
    pointers.length = 0;
    trails.forEach((t) => (t.length = 0));
    lastHands = [];
    body = null;
    euroFilters.forEach((ef) => { ef.x.reset(); ef.y.reset(); });
    lastHandsInferFresh = false;
    bodyHave = false; bodyTracks.forEach((t) => t.reset()); handTracks.forEach((t) => t.reset()); ptrVps.length = 0;
    return;
  }

  const prev = pointers.map((p) => ({ x: p.x, y: p.y }));
  pointers.length = 0;
  let pts = [];
  const now = performance.now();
  const subDt = lastPointerUpdateTime > 0 ? Math.max(0.008, Math.min(0.033, (now - lastPointerUpdateTime) / 1000)) : 0.016;
  const frameDt = lastPointerUpdateTime > 0 ? Math.max(0.008, (now - lastPointerUpdateTime) / 1000) : 0.016;   // 실제 프레임 간격(초)
  lastPointerUpdateTime = now;

  // 비디오가 예기치 않게 멈췄을 때 자동 재생 복구 (Zero-Freeze Guard)
  if (!useMouse && video && video.srcObject && video.paused) {
    try { video.play(); } catch {}
  }

  if (useMouse) {
    pts = [{ x: mouse.x, y: mouse.y }];
  } else if ((mode && games[mode]?.body) || isCostumeRoomOpen) {                      // 몸 게임 또는 가상 피팅 룸: 전신 포즈 인식
    const poseWorker = visionAI.ready("pose");
    if ((poseLandmarker || poseWorker) && video.readyState >= 2 && !isDetectingBody) {
      const wr = poseWorker ? visionAI.take("pose") : null;
      // 🛡️ 작업자 멈춤 감지: 오래 새 결과가 없을 때만 메인 스레드 인식으로 폴백. 기준은 "인식 1회 시간"에 맞춰 늘어나요
      // (느린 PC에서 인식이 200ms+ 걸리는 건 정상이라, 그때마다 폴백하면 인식기가 둘이 돌아 오히려 더 끊겨요)
      const workerStalled = poseWorker && (now - lastPoseInferEndTime > workerStallMs());
      const shouldInfer = wr ? true : (poseWorker ? (workerStalled && !!poseLandmarker) : (now - lastPoseInferEndTime >= 38));

      // 워커가 지연되고 메인 모델이 없으면 비동기로 메인 모델도 대비 로드
      if (workerStalled && !poseLandmarker && !isDetectingBody) {
        ensureModel("pose").catch(() => {});
      }

      if (shouldInfer) {
        isDetectingBody = true;
        const inferStart = performance.now();
        try {
          const t0 = wr ? Math.max(wr.ts, lastDetectTimestamp + 1) : Math.max(now, lastDetectTimestamp + 1);
          lastDetectTimestamp = t0;
          const r = wr ? wr.result : (poseLandmarker ? poseLandmarker.detectForVideo(video, t0) : null);
          if (!wr) mainInfers++;
          detectMs = detectMs * 0.85 + (wr ? wr.inferMs : performance.now() - inferStart) * 0.15;
          const kP = 33 / Math.max(16, Math.min(150, t0 - (lastPoseT0 || t0 - 33)));
          lastPoseT0 = t0;
          if (r && r.landmarks && r.landmarks.length) {
            bodySeen = t0;
            r.landmarks[0].forEach((l, i) => {
              const p = videoToScreen(l);
              (bodyTracks[i] ??= new AlphaBeta(BODY_AB)).update(p.x, p.y, t0);
              bodyVis[i] = l.visibility ?? 1;
            });
            bodyTracks.length = r.landmarks[0].length;
            bodyHave = true;
          } else if (t0 - bodySeen > 600) {
            body = null; bodyVelocities = []; bodyHave = false; bodyTracks.forEach((t) => t.reset());
          }
        } catch (err) {
          console.warn("포즈 인식 예외 (자동 복구):", err);
        } finally {
          isDetectingBody = false;
          lastPoseInferEndTime = performance.now();
        }
      }
    }
    // 매 화면 프레임: 추적기로 "지금 시각"의 관절 위치를 만들어요 (인식 결과 사이에도 부드럽게 이어짐)
    if (bodyHave) {
      body = bodyTracks.map((tr, i) => ({ ...tr.at(now), v: bodyVis[i] ?? 1 }));
      // ⚡ 포즈 모드 및 피팅룸에서도 손목(15, 16)을 pointers로 추출하여 손/주먹 상호작용 지원
      if (body && body[15] && body[16]) {
        pts = [
          { x: body[16].x, y: body[16].y, vx: bodyTracks[16]?.vx, vy: bodyTracks[16]?.vy },
          { x: body[15].x, y: body[15].y, vx: bodyTracks[15]?.vx, vy: bodyTracks[15]?.vy }
        ];
      }
    }
    camOk = !!body;
    camInfo = (body ? "🧍 전신 인식됨" : "전신이 보이게 한 걸음 뒤로 물러서 주세요") + `  · ${detectMs.toFixed(0)}ms`;
  } else if ((handLandmarker || visionAI.ready("hand")) && video.readyState >= 2) {
    try { detectHandsNow(); } catch (e) { console.warn("손 인식 오류", e); }
    camInfo = (lastHands.length ? `✋ 손 ${lastHands.length}개 추적 중 (60FPS 연속 외삽)` : "손을 카메라에 보여 주세요 (밝은 곳, 손바닥/검지)") + `  · ${detectMs.toFixed(0)}ms`;
    camOk = lastHands.length > 0;

    // 매 화면 프레임: 추적기에서 "지금 시각"의 손 위치를 계산 (인식 결과 사이에도 튀지 않고 부드럽게 이어짐)
    pts = lastHands.map((p, i) => (handTracks[i].ready ? handTracks[i].at(now) : p));
    lastHandsInferFresh = false;
  }

  // 최대 2손(1인 최적화) 포인터 생성 및 공간 일관성 1유로 필터링
  pts.slice(0, MAX_HANDS).forEach((p, i) => {
    const pr = prev[i] ?? p;
    const fx = euroFilters[i].x.filter(p.x, now);
    const fy = euroFilters[i].y.filter(p.y, now);
    const curSpeed = Math.hypot(fx - pr.x, fy - pr.y);
    // 초당 이동 속도(px/s): 손은 추적기가 추정한 속도(결과가 올 때 생기는 위치 보정에 흔들리지 않음), 그 외(마우스 등)는 위치 변화로 계산
    const inst = p.vx !== undefined ? Math.hypot(p.vx, p.vy) * 1000 : curSpeed / frameDt;
    ptrVps[i] = ptrVps[i] === undefined ? 0 : ptrVps[i] * 0.5 + inst * 0.5;   // 한 프레임 튐은 반만 반영

    pointers.push({
      x: fx, y: fy, px: pr.x, py: pr.y,
      speed: curSpeed,
      vps: ptrVps[i],
      fist: useMouse ? !mouse.down : !!lastFist[i],
      // 손을 앞으로 내지르는 동적 펀치 임펄스: 280ms 이내의 펀치 이벤트이면서 속도가 살아있을 때만
      punch: useMouse ? mouse.down : (performance.now() - (lastPunch[i] || -1e9) < 240 && ptrVps[i] > Math.min(W, H) * 0.55),
      punchId: useMouse ? mouse.p : lastPunch[i]
    });
  });

  for (let i = 0; i < MAX_HANDS; i++) {
    const t = trails[i], p = pointers[i];
    if (p) {
      t.push({ x: p.x, y: p.y });
      if (t.length > 14) t.shift();
    } else {
      t.length = 0; ptrVps[i] = undefined;
      euroFilters[i].x.reset(); euroFilters[i].y.reset();
    }
  }
}

// 3D 기하 제스처 판정 및 렌더링 전용 숨통 시간 확보 손 인식 엔진
function detectHandsNow() {
  const handWorker = visionAI.ready("hand");
  if (!playing || !mode || isDetectingHands || (!handLandmarker && !handWorker) || video.readyState < 2) return;
  const now = performance.now();
  const wr = handWorker ? visionAI.take("hand") : null;
  const workerStalled = handWorker && (now - lastHandInferEndTime > workerStallMs());

  if (handWorker && !wr) {
    if (!workerStalled || !handLandmarker) return;
  } else if (!handWorker && now - lastHandInferEndTime < 35) {
    return;
  }

  isDetectingHands = true;
  const inferStart = performance.now();
  try {
    const t0 = wr ? Math.max(wr.ts, lastDetectTimestamp + 1) : Math.max(now, lastDetectTimestamp + 1);
    lastDetectTimestamp = t0;

    const r = wr ? wr.result : (handLandmarker ? handLandmarker.detectForVideo(video, t0) : null);
    if (!r) return;
    if (!wr) mainInfers++;
    detectMs = detectMs * 0.85 + (wr ? wr.inferMs : performance.now() - inferStart) * 0.15;

    const palm = ($("trackMode").value === "palm" || mode === "box") && mode !== "draw";
    const reachBonus = (playerSettings?.reach ? playerSettings.reach - 35 : 0);
    const childBonus = (playerSettings?.heightMode === "child" ? 14 : 0);
    reach = Math.max(10, (palm ? 32 : 12) + reachBonus + childBonus);

    if (r.landmarks && r.landmarks.length > 0) {
      lastSeen = t0;
      lastHandsInferFresh = true; // 이번 프레임에서 신선한 AI 데이터 수신됨
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

      // 📍 추적기에 "이 시각에 여기서 봤어요"를 알려 줘요. 화면 위치는 updatePointers에서 매 프레임 계산해요
      sortedRaw.forEach((p, i) => handTracks[i].update(p.x, p.y, t0));
      for (let i = sortedRaw.length; i < MAX_HANDS; i++) handTracks[i].reset();
      lastHands = sortedRaw.map((p) => ({ x: p.x, y: p.y }));
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
        handTracks.forEach((t) => t.reset());
        handVelocities = Array.from({ length: MAX_HANDS }, () => ({ vx: 0, vy: 0 }));
        euroFilters.forEach((ef) => { ef.x.reset(); ef.y.reset(); });
      }
    }
  } catch (err) {
    console.warn("손 인식 파이프라인 예외 보호:", err);
  } finally {
    isDetectingHands = false;
    lastHandInferEndTime = performance.now(); // 추론 종료 시점 기준 쿨다운 기록!
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

function addShake(duration = 0.08, power = 4) {
  globalShake = Math.max(globalShake, duration);
  globalShakePower = Math.min(5, Math.max(globalShakePower, power));
}

function burst(x, y, color, n = 22) {
  try {
    // 1. 화면 깜빡임/점등 없는 부드러운 타격 햅틱 진동 인가
    addShake(0.08, Math.min(5, 2.5 + n * 0.08));
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
// ============================================================================
// 🌟 Stitch 게임별 전용 Live In-Game Motion HUD 시스템 (Console Arcade Polish)
// ============================================================================
const GAME_HUD_META = {
  beat: {
    theme: "beat",
    badge: "EXPERT +",
    title: "NEON NOTE SLASH",
    sub: "132 BPM",
    guideIcon: "⚡",
    guideMain: "SLASH IN DIRECTION OF ARROWS!",
    guideSub: "화살표 방향으로 리듬에 맞춰 듀얼 세이버를 휘두르세요!",
    leftName: "LEFT SABER (CYAN)",
    rightName: "RIGHT SABER (MAGENTA)",
    leftUnit: "KM/H",
    rightUnit: "KM/H",
    leftDesc: "SMOOTH ARC • READY",
    rightDesc: "CRITICAL POWER • READY",
    odTitle: "⚡ HYPER OVERDRIVE FRENZY",
    getMetrics: (g) => [
      { label: "NOTES", val: score },
      { label: "STREAK", val: `${combo}x` },
      { label: "BPM", val: g?.currentTrack ? g.currentTrack.bpm : 132 }
    ]
  },
  runner: {
    theme: "runner",
    badge: "STAGE 08 • JUMP & SQUAT",
    title: "ASTRO JUMP RUNNER",
    sub: "HIGH SPEED SPRINT",
    guideIcon: "🏃",
    guideMain: "JUMP OVER HURDLES & SQUAT DUCK LOW!",
    guideSub: "점프로 장애물을 넘고 몸을 숙여 레이저를 피하세요!",
    leftName: "JUMP APEX HEIGHT",
    rightName: "RUNNING SPEED",
    leftUnit: "CM",
    rightUnit: "KM/H",
    leftDesc: "17-JOINTS OPTICAL ENGINE",
    rightDesc: "HIGH-SPEED BOOST",
    odTitle: "🚀 ASTRO HYPER DASH (초고속 무적 질주)",
    showHearts: true,
    getMetrics: (g) => [
      { label: "COINS", val: `${(score * 2)}★` },
      { label: "JUMPS", val: `${Math.floor(score / 4)}/35` },
      { label: "SPEED", val: `x${(1.0 + Math.min(1.5, score * 0.02)).toFixed(1)}` }
    ]
  },
  kungfu: {
    theme: "kungfu",
    badge: "GRANDMASTER DOJO 60 FPS",
    title: "KUNG FU MASTER COMBAT",
    sub: "MARTIAL ARTS DOJO",
    guideIcon: "🥋",
    guideMain: "STRIKE TARGETS & GUARD INCOMING ATTACKS!",
    guideSub: "주먹을 뻗어 적을 타격하고, 양손을 모아 철벽 가드로 방어하세요!",
    leftName: "CHI ENERGY",
    rightName: "STRIKE FORCE",
    leftUnit: "%",
    rightUnit: "PSI",
    leftDesc: "DRAGON GAUGE",
    rightDesc: "FIST ACCELERATION",
    odTitle: "🐉 DRAGON AWAKENING (용오름 각성 피버)",
    getMetrics: (g) => [
      { label: "KO", val: g?.koCount ?? score },
      { label: "CHI", val: `${Math.floor(g?.chi ?? Math.min(100, combo * 8))}%` },
      { label: "COMBO", val: `${combo}x` }
    ]
  },
  box: {
    theme: "kungfu",
    badge: "FITNESS PUNCH & KICK 60 FPS",
    title: "SPEED PUNCH & KICK BAG",
    sub: "FULL-BODY COMBAT TRAINING",
    guideIcon: "🥋",
    guideMain: "STRIKE WITH RAPID PUNCHES & POWERFUL KICKS!",
    guideSub: "양손 주먹 연타와 강력한 발차기(하이킥/파워킥)로 샌드백을 날려버리세요!",
    leftName: "FIST VELOCITY",
    rightName: "KICK POWER",
    leftUnit: "KM/H",
    rightUnit: "PSI",
    leftDesc: "RAPID JAB & HOOK",
    rightDesc: "HIGH & MIDDLE KICK",
    odTitle: "🥋 FULL-BODY COMBAT RUSH (전신 타격 러시)",
    getMetrics: (g) => [
      { label: "STRIKES", val: score },
      { label: "KICKS", val: g?.kicks ?? 0 },
      { label: "FORCE", val: `${Math.min(350, 120 + score * 3)}PSI` }
    ]
  },
  space: {
    theme: "space",
    badge: "PLANETARY DEFENSE",
    title: "COSMIC METEOR DEFENSE",
    sub: "EARTH SHIELD PROTOCOL",
    guideIcon: "🛡️",
    guideMain: "TOUCH & BLAST INCOMING METEORS!",
    guideSub: "지구로 날아오는 불타는 유성을 터뜨려 방어막을 지키세요!",
    leftName: "P1 DEFENSE SHIELD",
    rightName: "P2 PLASMA BEAM",
    leftUnit: "KW",
    rightUnit: "KW",
    leftDesc: "SHIELD MATRIX",
    rightDesc: "ENERGY BURST",
    odTitle: "🛡️ PLANETARY FORCEFIELD (전방위 펄스 방어막)",
    getMetrics: (g) => [
      { label: "SHIELD", val: `${Math.round((shield / SHIELD_MAX) * 100)}%` },
      { label: "METEORS", val: score },
      { label: "WAVE", val: `LV.${currentWave}` }
    ]
  },
  brick: {
    theme: "brick",
    badge: "CYBER RETRO 80s",
    title: "NEON BRICK BREAKER",
    sub: "OPTICAL PADDLE CONTROL",
    guideMain: "MOVE YOUR HAND TO DEFLECT THE BALL!",
    guideSub: "손으로 네온 패들을 좌우로 움직여 공을 튕겨내세요!",
    leftName: "PADDLE POSITION",
    rightName: "BALL VELOCITY",
    leftUnit: "%",
    rightUnit: "KM/H",
    leftDesc: "SMOOTH GLIDE",
    rightDesc: "ACTIVE BOUNCE",
    odTitle: "💥 MULTI-BALL CHAOS (멀티볼 대폭발)",
    showHearts: true,
    getMetrics: (g) => [
      { label: "BRICKS", val: score },
      { label: "PADDLE", val: "100%" },
      { label: "BALLS", val: "x1" }
    ]
  },
  keeper: {
    theme: "keeper",
    badge: "SUPER SAVE ARENA",
    title: "MOTION GOALKEEPER",
    sub: "3D PENALTY SHOT",
    guideIcon: "🧤",
    guideMain: "BLOCK PENALTY SHOTS WITH BODY & HANDS!",
    guideSub: "골대로 날아오는 슈팅을 온몸과 양손으로 슈퍼 세이브 하세요!",
    leftName: "LEFT GLOVE REACH",
    rightName: "RIGHT GLOVE REACH",
    leftUnit: "CM",
    rightUnit: "CM",
    leftDesc: "REFLEX SENSOR",
    rightDesc: "REFLEX SENSOR",
    odTitle: "🧤 SUPER DIVING MATRIX (철벽 수비 모드)",
    getMetrics: (g) => [
      { label: "SAVES", val: score },
      { label: "SAVE RATE", val: `${Math.min(100, 95 + combo)}%` },
      { label: "REACTION", val: "18ms" }
    ]
  },
  ninja: {
    theme: "ninja",
    badge: "CYBER KATANA DOJO",
    title: "FRUIT SPLASH NINJA",
    sub: "FAST BLADE SLASH",
    guideIcon: "🗡️",
    guideMain: "SWIPE FAST TO SLICE FLYING FRUITS!",
    guideSub: "화면 위로 솟구치는 과일을 빠르게 베어내세요! (폭탄 주의)",
    leftName: "BLADE SWIPE L",
    rightName: "BLADE SWIPE R",
    leftUnit: "KM/H",
    rightUnit: "KM/H",
    leftDesc: "KATANA CUT",
    rightDesc: "KATANA CUT",
    odTitle: "🗡️ SHADOW BLADE STORM (폭풍 연속 베기)",
    getMetrics: (g) => [
      { label: "FRUITS", val: score },
      { label: "SWIPES", val: `${combo}x` },
      { label: "SPLASH", val: "CRIT" }
    ]
  },
  pose: {
    theme: "runner",
    badge: "DANCE SYNCHRO 100%",
    title: "POSE MIMIC MASCOT",
    sub: "AEROBIC DANCE RHYTHM",
    guideIcon: "🙆",
    guideMain: "MATCH THE POSE OF COSMO MASCOT!",
    guideSub: "화면의 마스코트 동작을 거울처럼 똑같이 따라 하세요!",
    leftName: "BODY SYNC RATE",
    rightName: "FLEXIBILITY",
    leftUnit: "%",
    rightUnit: "%",
    leftDesc: "SKELETON MATCH",
    rightDesc: "PERFECT POSE",
    odTitle: "✨ FEVER FEVER DANCE TIME (슈퍼 댄스 피버)",
    getMetrics: (g) => [
      { label: "MATCH", val: `${g?.syncPct ?? 0}%` },
      { label: "POSES", val: g?.done ?? 0 },
      { label: "LEVEL", val: g?.level ?? 1 }
    ]
  },
  balloon: {
    theme: "beat",
    badge: "PARTY CARNIVAL",
    title: "BALLOON FRENZY",
    sub: "MULTI-TOUCH ARCADE",
    guideIcon: "🎈",
    guideMain: "TOUCH & POP ALL BALLOONS QUICKLY!",
    guideSub: "화면 위로 떠오르는 알록달록 풍선들을 팡팡 터뜨리세요!",
    leftName: "P1 POP SENSOR",
    rightName: "P2 POP SENSOR",
    leftUnit: "TOUCH",
    rightUnit: "TOUCH",
    leftDesc: "RAPID POP",
    rightDesc: "RAPID POP",
    odTitle: "🎈 GOLDEN BALLOON PARADE (황금 풍선 대행진)",
    getMetrics: (g) => [
      { label: "POPPED", val: score },
      { label: "STREAK", val: `${combo}x` },
      { label: "BURST", val: "MAX" }
    ]
  },
  baseball: {
    theme: "space",
    badge: "DUAL VIEWPORT & CUSTOM BATTER",
    title: "NEON SLAM BASEBALL",
    sub: "3D STADIUM & MOTION MIRROR",
    guideIcon: "⚾",
    guideMain: "SWING THE BAT & WATCH YOUR CUSTOM BATTER HIT!",
    guideSub: "좌측 타석의 커스튬 타자와 내 움직임이 100% 동기화! 온몸으로 시원하게 휘두르세요!",
    leftName: "BAT SPEED",
    rightName: "LAUNCH DISTANCE",
    leftUnit: "KM/H",
    rightUnit: "M",
    leftDesc: "ANGULAR VELOCITY",
    rightDesc: "PROJECTED FLIGHT",
    odTitle: "🚀 GRAND SLAM FEVER (만루 홈런 피버)",
    getMetrics: (g) => [
      { label: "HITS", val: g?.hits ?? 0 },
      { label: "HOMERUN", val: g?.homeRuns ?? 0 },
      { label: "LONGEST", val: `${g?.maxDist ?? 0}m` }
    ]
  }
};

let lastLeftSpeed = 0, lastRightSpeed = 0, lastHudTime = 0;
function updateLiveHud(force = false) {
  if (!playing || !mode) return;
  const now = performance.now();
  if (!force && now - lastHudTime < 75) return; // 75ms 쓰로틀링 (초당 ~13회 갱신으로 60 FPS 렌더링 및 MediaPipe 추론에 병목 완전 차단)
  lastHudTime = now;
  const g = games[mode];
  const meta = GAME_HUD_META[mode] || {
    theme: "beat",
    badge: "STAGE",
    title: mode.toUpperCase(),
    sub: "60 FPS",
    guideIcon: "⚡",
    guideMain: "PLAY WITH MOTION!",
    guideSub: "카메라 앞에서 손과 몸으로 플레이하세요!",
    leftName: "MOTION P1",
    rightName: "MOTION P2",
    leftUnit: "KM/H",
    rightUnit: "KM/H",
    leftDesc: "ACTIVE",
    rightDesc: "ACTIVE",
    odTitle: "⚡ HYPER OVERDRIVE",
    getMetrics: () => [{ label: "SCORE", val: score }, { label: "COMBO", val: combo }, { label: "STAGE", val: "1" }]
  };

  // 0. 게임별 맞춤 테마 적용 (data-theme)
  const hudEl = $("hud");
  if (hudEl && hudEl.dataset.theme !== (meta.theme || "beat")) {
    hudEl.dataset.theme = meta.theme || "beat";
  }

  // 1. 헤더 기본 정보
  const badgeEl = $("hudBadge");
  if (badgeEl) badgeEl.textContent = meta.badge;

  const titleEl = $("hudTitle");
  if (titleEl) {
    if (mode === "beat" && g?.currentTrack) {
      titleEl.textContent = g.currentTrack.title;
    } else {
      titleEl.textContent = meta.title;
    }
  }

  const subEl = $("hudSubDetail");
  if (subEl) {
    if (mode === "beat" && g?.currentTrack) {
      subEl.textContent = `${g.currentTrack.bpm} BPM`;
    } else {
      subEl.textContent = meta.sub;
    }
  }

  // 2. 스코어 네온 숫자
  const scoreEl = $("score");
  if (scoreEl) {
    const rawScore = g?.scoreText ? g.scoreText() : score.toLocaleString();
    scoreEl.textContent = rawScore;
  }

  // 3. Stitch 원형 멀티플라이어 SVG 게이지 & 콤보 스트릭
  const mult = g?.multiplier || (combo >= 14 ? 8 : (combo >= 6 ? 4 : (combo >= 2 ? 2 : 1)));
  const multValEl = $("hudMultVal");
  if (multValEl) multValEl.textContent = `x${mult}`;

  const multMaxEl = $("hudMultMax");
  if (multMaxEl) multMaxEl.textContent = mult >= 8 ? "MAX x8" : (mult >= 4 ? "OVER x4" : (mult >= 2 ? "BOOST x2" : "BASE"));

  // SVG 원 둘레: 2 * PI * 42 ~= 263.89
  const circumference = 264;
  let comboProgress = 0;
  if (mult >= 8) comboProgress = 1.0;
  else if (mult >= 4) comboProgress = Math.min(1, (combo - 6) / 8);
  else if (mult >= 2) comboProgress = Math.min(1, (combo - 2) / 4);
  else comboProgress = Math.min(1, combo / 2);

  const multCircle = $("multCircle");
  if (multCircle) {
    const offset = circumference - (comboProgress * circumference);
    multCircle.style.strokeDashoffset = offset.toString();
    multCircle.style.stroke = mult >= 8 ? "#ffd700" : (mult >= 4 ? "#e1037d" : "#00d2ff");
  }

  // 게임별 맞춤 스탯 티커 칩 업데이트
  if (meta.getMetrics) {
    try {
      const metrics = meta.getMetrics(g);
      if (metrics[0]) {
        const l1 = $("hudMetricLabel1"), v1 = $("hudMetricVal1");
        if (l1) l1.textContent = metrics[0].label;
        if (v1) v1.textContent = metrics[0].val;
      }
      if (metrics[1]) {
        const l2 = $("hudMetricLabel2"), v2 = $("hudMetricVal2");
        if (l2) l2.textContent = metrics[1].label;
        if (v2) v2.textContent = metrics[1].val;
      }
      if (metrics[2]) {
        const l3 = $("hudMetricLabel3"), v3 = $("hudMetricVal3");
        if (l3) l3.textContent = metrics[2].label;
        if (v3) v3.textContent = metrics[2].val;
      }
    } catch {}
  }

  // 콤보 스트릭 배지
  const streakBadge = $("hudStreakBadge");
  const streakText = $("hudStreakText");
  if (streakBadge && streakText) {
    if (combo >= 3) {
      streakBadge.classList.remove("hidden");
      streakText.textContent = `${combo} HIT STREAK! ${mult >= 8 ? "(FRENZY MAX)" : ""}`;
    } else {
      streakBadge.classList.add("hidden");
    }
  }

  // 4. 시간 표시
  const timeEl = $("time");
  if (timeEl) {
    if (isReadyTime) {
      timeEl.textContent = `0:0${Math.max(1, Math.ceil(readyTimeLeft))}`;
    } else {
      const s = Math.max(0, Math.ceil(timeLeft));
      timeEl.textContent = s >= 60 ? `1:${String(s - 60).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
    }
  }

  // 5. 라이프 에너지 바 & 하트 라이프
  let energyPct = 100;
  if (mode === "beat") {
    energyPct = Math.max(5, Math.min(100, Math.round(g?.energy ?? 100)));
  } else if (mode === "space") {
    energyPct = Math.round((shield / SHIELD_MAX) * 100);
  } else {
    energyPct = Math.min(100, Math.max(20, Math.round(70 + (combo * 2))));
  }
  const energyFill = $("hudEnergyFill");
  const energyPctEl = $("hudEnergyPct");
  if (energyFill) energyFill.style.width = `${energyPct}%`;
  if (energyPctEl) energyPctEl.textContent = `${energyPct}%`;

  // 하트 라이프 표시
  const heartsRow = $("hudHearts");
  if (heartsRow) {
    if (meta.showHearts) {
      heartsRow.classList.remove("hidden");
    } else {
      heartsRow.classList.add("hidden");
    }
  }

  // 6. 상단 가이드 배너
  const guideIcon = $("hudGuideIcon");
  const guideMain = $("hudGuideMain");
  const guideSub = $("hudGuideSub");
  if (guideIcon) guideIcon.textContent = meta.guideIcon || "⚡";
  if (guideMain) guideMain.textContent = meta.guideMain;
  if (guideSub) guideSub.textContent = meta.guideSub;

  // 7. 실시간 모션 스피드 / 텔레메트리
  let leftSpd = 0, rightSpd = 0;
  if (mode === "beat" && g?.wristVel) {
    leftSpd = Math.round((g.wristVel[0]?.spd || 0) * 3.6);
    rightSpd = Math.round((g.wristVel[1]?.spd || 0) * 3.6);
  } else if (mode === "runner") {
    // 러너: 점프 높이 (cm)와 달리기 속도
    const skel = getBody?.();
    let jumpCm = 0;
    if (skel && skel[0]) jumpCm = Math.max(0, Math.round((H * 0.5 - skel[0].y) * 0.45));
    leftSpd = Math.max(15, jumpCm);
    rightSpd = Math.round(18 + Math.min(24, score * 0.4));
  } else if (mode === "kungfu" || mode === "box") {
    // 쿵푸/복싱: 펀치 임팩트 PSI
    const p1 = pointers?.[0], p2 = pointers?.[1] || p1;
    leftSpd = Math.round((p1?.speed || 0) * 4.2);
    rightSpd = Math.round((p2?.speed || 0) * 4.2);
  } else if (pointers && pointers.length > 0) {
    const p1 = pointers[0];
    const p2 = pointers[1] || pointers[0];
    leftSpd = Math.round((p1.speed || 0) * 3.6);
    rightSpd = Math.round((p2.speed || 0) * 3.6);
  }
  lastLeftSpeed = Math.round(lastLeftSpeed * 0.7 + leftSpd * 0.3);
  lastRightSpeed = Math.round(lastRightSpeed * 0.7 + rightSpd * 0.3);

  const leftSpdEl = $("hudLeftSpeed");
  const rightSpdEl = $("hudRightSpeed");
  if (leftSpdEl) leftSpdEl.textContent = Math.max(12, lastLeftSpeed);
  if (rightSpdEl) rightSpdEl.textContent = Math.max(14, lastRightSpeed);

  const leftUnit = $("hudLeftUnit");
  const rightUnit = $("hudRightUnit");
  if (leftUnit) leftUnit.textContent = meta.leftUnit || "KM/H";
  if (rightUnit) rightUnit.textContent = meta.rightUnit || "KM/H";

  const leftLbl = $("hudLeftLabel");
  const rightLbl = $("hudRightLabel");
  if (leftLbl) leftLbl.textContent = meta.leftName;
  if (rightLbl) rightLbl.textContent = meta.rightName;

  // 8. 특수 필살기 하이퍼 오버드라이브 게이지
  const odTitle = $("hudOdTitle");
  if (odTitle) odTitle.textContent = meta.odTitle || "⚡ HYPER OVERDRIVE";

  const odFill = $("hudOdFill");
  const odStatus = $("hudOdStatus");
  if (odFill && odStatus) {
    if (isFeverTime) {
      odFill.style.width = "100%";
      odStatus.textContent = "🔥 HYPER ACTIVE!";
      odStatus.style.color = "#ff2a8d";
    } else {
      const chargePct = Math.min(100, Math.round((combo / 14) * 100));
      odFill.style.width = `${chargePct}%`;
      odStatus.textContent = chargePct >= 100 ? "100% READY!" : `${chargePct}% CHARGING`;
      odStatus.style.color = chargePct >= 100 ? "#22c55e" : "#ffd894";
    }
  }
}

// 캔버스 콤보 이펙트 (shadowBlur 제거로 60 FPS 무지연 성능 보장)
function drawCombo() {
  if (combo < 2 || comboTimer <= 0) return;
  const k = Math.min(comboTimer / COMBO_WINDOW, 1);
  ctx.save();
  ctx.globalAlpha = 0.5 + k * 0.5; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `900 ${44 + Math.min(combo, 12) * 2.5}px 'Rubik', sans-serif`;
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(20,6,43,.9)"; ctx.fillStyle = combo >= 5 ? "#ff5e92" : "#fbb500";
  const t = `⚡ ${combo} COMBO!`, y = H * 0.22;
  ctx.strokeText(t, W / 2, y); ctx.fillText(t, W / 2, y);

  // 남은 콤보 시간 바
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
      } else if (o.type === "dummy") {
        // 목인장 훈련 인형 (단단한 원목 기둥 + 네온 타겟 링)
        ctx.fillStyle = "#8b4513";
        ctx.beginPath(); ctx.roundRect(-r * 0.45, -r * 0.95, r * 0.9, r * 1.9, 12); ctx.fill();
        ctx.strokeStyle = "#d4a373"; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#a0522d";
        ctx.fillRect(-r * 1.1, -r * 0.35, r * 2.2, r * 0.22);
      } else if (o.type === "shuriken") {
        // 회전하는 4각 네온 수리검
        ctx.rotate(o.rot || 0);
        ctx.fillStyle = "#00d2ff";
        ctx.shadowColor = "#00d2ff"; ctx.shadowBlur = 15;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-r * 0.28, -r * 0.28);
          ctx.lineTo(0, -r * 1.1);
          ctx.lineTo(r * 0.28, -r * 0.28);
          ctx.closePath();
          ctx.fill();
          ctx.rotate(Math.PI / 2);
        }
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
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

  // 6. 점핑 러너 캐릭터 (Stitch 아케이드: 고품질 아스트로 사이버 러너 마스코트)
  drawRunnerMascot(cx, gy, jy, hs, duck, dist, inv, isFever = false, isBoosting = false) {
    try {
      const fy = gy - jy;
      const ch = duck ? hs * 0.52 : hs;
      const top = fy - ch;
      const ph = dist * 0.045;
      const air = jy > 0;

      ctx.save();
      // 피격 무적 깜빡임
      ctx.globalAlpha = inv > 0 && ((inv * 10) | 0) % 2 ? 0.35 : 1;

      // 1. 발밑 네온 질주 그림자 & 잔상 트레일
      ctx.save();
      const shadowW = (duck ? hs * 0.65 : hs * 0.45) * Math.max(0.3, 1 - jy / (hs * 1.5));
      const shadowH = hs * 0.12 * Math.max(0.3, 1 - jy / (hs * 1.5));
      ctx.fillStyle = isFever ? "rgba(255, 46, 147, 0.45)" : "rgba(0, 210, 255, 0.35)";
      ctx.beginPath();
      ctx.ellipse(cx, gy - 2, shadowW, shadowH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 2. 바닥 질주 마찰 스파크 / 먼지 구름 파티클
      if (!air) {
        if (duck) {
          // 슬라이딩 마찰 불꽃 스파크
          ctx.fillStyle = "#ffcc00";
          for (let i = 0; i < 3; i++) {
            ctx.fillRect(cx - hs * 0.3 - Math.random() * 20, gy - 4 - Math.random() * 8, 3, 3);
          }
        } else if (Math.sin(ph * 2) > 0.3) {
          // 질주 펄스 먼지
          ctx.fillStyle = "rgba(0, 210, 255, 0.3)";
          ctx.beginPath();
          ctx.arc(cx - hs * 0.35, gy - 5, 5 + Math.random() * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 3. 등 뒤 사이버 제트팩 & 플라즈마 부스터 불꽃
      const packX = cx - (duck ? hs * 0.25 : hs * 0.18);
      const packY = fy - (duck ? hs * 0.28 : hs * 0.55);
      const packW = hs * 0.14, packH = hs * 0.28;

      ctx.save();
      // 제트팩 본체 (메탈릭 다크 쉘)
      ctx.fillStyle = "#1e1035";
      ctx.strokeStyle = isFever ? "#ff2e93" : "#00d2ff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(packX - packW / 2, packY - packH / 2, packW, packH, 5);
      ctx.fill(); ctx.stroke();

      // 부스터 화염 (점프 중이거나 피버/부스트 상태일 때 맹렬히 분사)
      if (air || isFever || isBoosting) {
        const flameLen = air ? hs * (0.35 + Math.random() * 0.2) : hs * (0.2 + Math.random() * 0.1);
        const fg = ctx.createLinearGradient(packX, packY + packH / 2, packX - flameLen * 0.5, packY + packH / 2 + flameLen);
        fg.addColorStop(0, "#ffffff");
        fg.addColorStop(0.3, isFever ? "#ff0077" : "#00f0ff");
        fg.addColorStop(1, "rgba(255, 184, 0, 0)");

        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(packX - packW * 0.4, packY + packH * 0.4);
        ctx.lineTo(packX + packW * 0.4, packY + packH * 0.4);
        ctx.lineTo(packX - hs * 0.05, packY + packH * 0.4 + flameLen);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // 4. 캐릭터 중심 좌표 계산
      const charTilt = duck ? 0.35 : (air ? -0.15 : Math.sin(ph) * 0.08);
      const bodyCenterX = cx + (duck ? hs * 0.08 : 0);
      const bodyCenterY = fy - (duck ? hs * 0.26 : hs * 0.50);

      ctx.save();
      ctx.translate(bodyCenterX, bodyCenterY);
      ctx.rotate(charTilt);

      // 5. 우주 수트 몸통 (Chunky Rounded Space Suit)
      const suitW = hs * 0.28, suitH = hs * 0.34;
      const suitGrad = ctx.createLinearGradient(0, -suitH / 2, 0, suitH / 2);
      suitGrad.addColorStop(0, isFever ? "#ff69b4" : "#ffffff");
      suitGrad.addColorStop(1, isFever ? "#d81b60" : "#dbe4ff");

      ctx.fillStyle = suitGrad;
      ctx.strokeStyle = "#190b30";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.roundRect(-suitW / 2, -suitH / 2, suitW, suitH, suitW * 0.45);
      ctx.fill(); ctx.stroke();

      // 가슴의 네온 에너지 아크 코어
      ctx.fillStyle = isFever ? "#ffea00" : "#00d2ff";
      ctx.shadowColor = isFever ? "#ffea00" : "#00d2ff";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(suitW * 0.1, 0, suitW * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 6. 다리 & 사이버 하이탑 스니커즈 (역동적인 러닝 애니메이션)
      const legCycle = air ? 0 : Math.sin(ph);
      const legCycleCos = air ? 0 : Math.cos(ph);

      const drawLeg = (isFront) => {
        ctx.save();
        const legOffX = isFront ? suitW * 0.15 : -suitW * 0.15;
        const legAngle = duck ? (isFront ? 1.1 : 0.8) : (air ? (isFront ? -0.4 : 0.4) : (isFront ? legCycle * 0.8 : -legCycle * 0.8));
        
        ctx.translate(legOffX, suitH * 0.35);
        ctx.rotate(legAngle);

        // 허벅지/종아리 수트
        ctx.fillStyle = isFront ? "#a5e7ff" : "#6fb5ff";
        ctx.strokeStyle = "#190b30";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-hs * 0.05, 0, hs * 0.10, hs * 0.22, 6);
        ctx.fill(); ctx.stroke();

        // 네온 러닝 부츠
        ctx.fillStyle = isFront ? "#ff2e93" : "#e1037d";
        ctx.beginPath();
        ctx.roundRect(-hs * 0.06, hs * 0.16, hs * 0.15, hs * 0.10, 5);
        ctx.fill(); ctx.stroke();
        // 밑창 LED
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-hs * 0.05, hs * 0.24, hs * 0.13, 2.5);

        ctx.restore();
      };

      drawLeg(false); // 뒷다리
      drawLeg(true);  // 앞다리

      // 7. 팔 & 사이버 건틀릿
      const armAngle = duck ? 0.9 : (air ? -1.0 : -legCycle * 0.9);
      ctx.save();
      ctx.translate(suitW * 0.1, -suitH * 0.1);
      ctx.rotate(armAngle);
      ctx.fillStyle = "#ffd894";
      ctx.strokeStyle = "#190b30";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-hs * 0.04, 0, hs * 0.08, hs * 0.22, 5);
      ctx.fill(); ctx.stroke();
      // 글러브
      ctx.fillStyle = "#00d2ff";
      ctx.beginPath();
      ctx.arc(0, hs * 0.22, hs * 0.055, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();

      // 8. 머리 & 아스트로 바이저 헬멧
      const headRadius = hs * 0.22;
      const headCenterY = -suitH * 0.55;

      // 쫑긋한 토끼 귀 안테나 (바람과 질주 속도에 따라 뒤로 펄럭임)
      const earWiggle = air ? 0.35 : Math.sin(ph) * 0.15;
      [-headRadius * 0.45, headRadius * 0.25].forEach((ex, i) => {
        ctx.save();
        ctx.translate(ex, headCenterY - headRadius * 0.7);
        ctx.rotate((i === 0 ? -0.25 : 0.2) + earWiggle);
        // 귀 외곽
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#190b30";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, -headRadius * 0.75, headRadius * 0.26, headRadius * 0.75, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // 귀 내부 네온 핑크
        ctx.fillStyle = isFever ? "#ffea00" : "#ff2e93";
        ctx.beginPath();
        ctx.ellipse(0, -headRadius * 0.75, headRadius * 0.14, headRadius * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // 헬멧 구체
      const helmetGrad = ctx.createRadialGradient(-headRadius * 0.3, headCenterY - headRadius * 0.3, headRadius * 0.1, 0, headCenterY, headRadius);
      helmetGrad.addColorStop(0, "#ffffff");
      helmetGrad.addColorStop(0.7, "#e0e7ff");
      helmetGrad.addColorStop(1, "#a5b4fc");

      ctx.fillStyle = helmetGrad;
      ctx.strokeStyle = "#190b30";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, headCenterY, headRadius, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      // 9. 미래형 라운드 네온 바이저 (눈앞을 감싸는 유선형 글래스)
      const visorW = headRadius * 1.5, visorH = headRadius * 0.95;
      const visorGrad = ctx.createLinearGradient(0, headCenterY - visorH * 0.5, 0, headCenterY + visorH * 0.5);
      visorGrad.addColorStop(0, isFever ? "#ff0077" : "#00f0ff");
      visorGrad.addColorStop(1, isFever ? "#ffea00" : "#00566a");

      ctx.fillStyle = visorGrad;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-visorW * 0.3, headCenterY - visorH * 0.45, visorW, visorH, visorH * 0.45);
      ctx.fill(); ctx.stroke();

      // 바이저 내부 표정 디스플레이 (상황에 따라 역동적으로 변화!)
      ctx.fillStyle = "#ffffff";
      if (air) {
        // 점프 중: 기쁨의 눈 웃음 (^ ^)
        ctx.lineWidth = 3; ctx.strokeStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(visorW * 0.2, headCenterY - 2, 5, Math.PI, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(visorW * 0.5, headCenterY - 2, 5, Math.PI, 0); ctx.stroke();
      } else if (duck) {
        // 슬라이딩 중: 질주 눈빛 (> <)
        ctx.lineWidth = 3; ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(visorW * 0.15, headCenterY - 4); ctx.lineTo(visorW * 0.25, headCenterY); ctx.lineTo(visorW * 0.15, headCenterY + 4);
        ctx.moveTo(visorW * 0.45, headCenterY - 4); ctx.lineTo(visorW * 0.55, headCenterY); ctx.lineTo(visorW * 0.45, headCenterY + 4);
        ctx.stroke();
      } else {
        // 평소 달릴 때: 초롱초롱한 사이버 눈동자
        ctx.beginPath(); ctx.arc(visorW * 0.22, headCenterY - 2, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(visorW * 0.48, headCenterY - 2, 4.5, 0, Math.PI * 2); ctx.fill();
        // 하이라이트 광택
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(-visorW * 0.1, headCenterY - visorH * 0.35, visorW * 0.7, 3);
      }

      ctx.restore(); // charTilt restore
      ctx.restore(); // globalAlpha restore
    } catch (err) {
      console.warn("러너 마스코트 렌더 실패:", err);
    }
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

  // 8. 네온 비트 큐브 노트 (화살표 없는 자유 슬래시 3D 네온 크리스탈 큐브)
  // 8. 🎮 비트세이버 PSVR 스타일 3D 입체 네온 큐브 블록 (60FPS 초고속 최적화 렌더러)
  drawBeatNote(x, y, r, color, half = 0, rot = 0) {
    try {
      ctx.save();
      ctx.translate(x, y);
      if (rot !== 0) ctx.rotate(rot);

      // 절단 시 반쪽 분리 클리핑
      if (half !== 0) {
        ctx.beginPath();
        ctx.rect(half < 0 ? -r * 2.2 : 0, -r * 2.2, r * 2.2, r * 4.4);
        ctx.clip();
      }

      // 1. 3D 큐브 입체 원근 면 오프셋 (Bevel Offset)
      const bOff = r * 0.28;
      const mainW = r * 1.7, mainH = r * 1.7;
      const ox = -mainW / 2, oy = -mainH / 2 + bOff * 0.5;

      // A. [상단 입체면 (Top Face)]
      ctx.fillStyle = color === "#00d2ff" ? "rgba(77, 222, 255, 0.45)" : "rgba(255, 99, 160, 0.45)";
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + bOff, oy - bOff);
      ctx.lineTo(ox + mainW + bOff, oy - bOff);
      ctx.lineTo(ox + mainW, oy);
      ctx.closePath();
      ctx.fill();

      // B. [우측 입체면 (Right Face)]
      ctx.fillStyle = color === "#00d2ff" ? "rgba(0, 140, 200, 0.55)" : "rgba(180, 20, 80, 0.55)";
      ctx.beginPath();
      ctx.moveTo(ox + mainW, oy);
      ctx.lineTo(ox + mainW + bOff, oy - bOff);
      ctx.lineTo(ox + mainW + bOff, oy + mainH - bOff);
      ctx.lineTo(ox + mainW, oy + mainH);
      ctx.closePath();
      ctx.fill();

      // C. [전면부 메인 바디 (Front Face)] - 딥 다크 네온 하우징
      ctx.fillStyle = "rgba(14, 8, 28, 0.96)";
      ctx.beginPath();
      ctx.roundRect(ox, oy, mainW, mainH, Math.max(6, r * 0.16));
      ctx.fill();

      // D. [초고속 2-Pass 네온 외곽선] (shadowBlur 0ms 대체: 외곽 은은한 후광 + 본체 선)
      ctx.strokeStyle = color === "#00d2ff" ? "rgba(0, 210, 255, 0.35)" : "rgba(255, 51, 119, 0.35)";
      ctx.lineWidth = Math.max(6, r * 0.2);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2.5, r * 0.08);
      ctx.stroke();

      // E. [내부 화이트 림 라이트 (Fresnel Rim)]
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(ox + 3, oy + 3, mainW - 6, mainH - 6, Math.max(4, r * 0.12));
      ctx.stroke();

      // F. [중앙 크리스탈 코어 타깃]
      const cy = oy + mainH * 0.5;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, cy, r * 0.25, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, cy, r * 0.14, 0, Math.PI * 2);
      ctx.fill();

      // G. [중앙 타깃 십자 헤어]
      const chLen = r * 0.24;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-chLen, cy); ctx.lineTo(chLen, cy);
      ctx.moveTo(0, cy - chLen); ctx.lineTo(0, cy + chLen);
      ctx.stroke();

      // 절단면 플라즈마 라인
      if (half !== 0) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, oy - bOff);
        ctx.lineTo(0, oy + mainH);
        ctx.stroke();
      }

      ctx.restore();
    } catch {}
  },

  // 8-B. 네온 스파이크 폭탄 (뱅글뱅글 꼼수 방지용 - 칼을 대면 대폭발!)
  drawNeonBomb(x, y, r) {
    try {
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = "#ff2255"; ctx.shadowBlur = 20;
      ctx.fillStyle = "#1a050e"; ctx.strokeStyle = "#ff2255"; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // 외곽 8방향 스파이크 가시
      ctx.strokeStyle = "#ff0055"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r * 0.78, Math.sin(ang) * r * 0.78);
        ctx.lineTo(Math.cos(ang) * r * 1.35, Math.sin(ang) * r * 1.35);
        ctx.stroke();
      }

      // 중앙 위험 경고 해골/X 마크
      ctx.fillStyle = "#ffd166"; ctx.shadowColor = "#ffd166"; ctx.shadowBlur = 10;
      ctx.font = `900 ${Math.max(14, Math.round(r * 0.9))}px 'Rubik', sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("✕", 0, 1);
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

  // 11. 🌟 Stitch 프로급 3D 네온 메탈릭 스피드 샌드백 (체인 마운트 + 물리 텐션 + 홀로그램 타겟팅)
  drawPunchBag(cx, cy, w, h, tilt = 0, flash = 0) {
    try {
      ctx.save();
      ctx.translate(cx, cy - h / 2);
      ctx.rotate(tilt);

      // 1. 천장 상단 크롬 서스펜션 행거 & 체인
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath();
      // 좌측 체인
      ctx.moveTo(-w * 0.28, 4); ctx.lineTo(-w * 0.12, -H * 0.25);
      // 우측 체인
      ctx.moveTo(w * 0.28, 4); ctx.lineTo(w * 0.12, -H * 0.25);
      ctx.stroke();

      // 메탈 D링 조인트
      ctx.fillStyle = "#cbd5e1";
      ctx.beginPath(); ctx.arc(-w * 0.28, 4, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(w * 0.28, 4, 6, 0, Math.PI * 2); ctx.fill();

      // 2. 상단 카본 메탈 캡 (마운트 리드)
      ctx.fillStyle = "#1e293b";
      ctx.beginPath(); ctx.roundRect(-w * 0.38, 0, w * 0.76, 16, 6); ctx.fill();
      ctx.strokeStyle = "#475569"; ctx.lineWidth = 2; ctx.stroke();

      // 3. 샌드백 3D 실린더 바디 (Stitch 하이테크 다크 카본 & 메탈릭 티타늄)
      const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      if (flash > 0) {
        grad.addColorStop(0, "#00d2ff");
        grad.addColorStop(0.25, "#ffffff");
        grad.addColorStop(0.65, "#ffd700");
        grad.addColorStop(1, "#ff0077");
      } else {
        grad.addColorStop(0, "#0a0e17");
        grad.addColorStop(0.2, "#1e293b");
        grad.addColorStop(0.5, "#334155");
        grad.addColorStop(0.75, "#1e293b");
        grad.addColorStop(0.9, "#0f172a");
        grad.addColorStop(1, "#05070c");
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(-w / 2, 14, w, h - 14, [16, 16, w / 2, w / 2]);
      ctx.fill();

      // 수직 메탈릭 크롬 하이라이트 리본
      const hlGrad = ctx.createLinearGradient(-w * 0.15, 0, w * 0.1, 0);
      hlGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      hlGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.28)");
      hlGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = hlGrad;
      ctx.fillRect(-w * 0.15, 14, w * 0.25, h - 24);

      // 외곽 사이버 네온 림 스트로크
      ctx.strokeStyle = flash > 0 ? "#ffd700" : "rgba(0, 210, 255, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // 4. 네온 일렉트릭 LED 밴드 (상/중/하 사이버 림)
      const bandYList = [h * 0.20, h * 0.76];
      bandYList.forEach((by) => {
        ctx.fillStyle = "rgba(10, 15, 30, 0.95)";
        ctx.fillRect(-w / 2 + 2, by, w - 4, 14);
        // 네온 LED 스트립
        ctx.strokeStyle = flash > 0 ? "#ffffff" : "#ff0077";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-w / 2 + 4, by + 7); ctx.lineTo(w / 2 - 4, by + 7); ctx.stroke();
      });

      // 5. 중앙 홀로그램 사이버 아케이드 타겟팅 레티클 (Cyber Reticle)
      const targetY = h * 0.48;
      // 외곽 네온 링
      ctx.strokeStyle = flash > 0 ? "#ffd700" : "#00d2ff";
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(0, targetY, w * 0.30, 0, Math.PI * 2); ctx.stroke();

      // 내부 회전 감각의 세그먼트 가이드 링
      ctx.strokeStyle = flash > 0 ? "#ffffff" : "rgba(255, 0, 119, 0.75)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(0, targetY, w * 0.20, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      // 중심 정밀 십자선 & 펄스 닷
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w * 0.22, targetY); ctx.lineTo(w * 0.22, targetY);
      ctx.moveTo(0, targetY - w * 0.22); ctx.lineTo(0, targetY + w * 0.22);
      ctx.stroke();

      ctx.fillStyle = flash > 0 ? "#ffd700" : "#00d2ff";
      ctx.beginPath(); ctx.arc(0, targetY, 8, 0, Math.PI * 2); ctx.fill();

      // 6. 하이테크 브랜드 타이포그래피 (KINETIC SPEED BAG)
      ctx.fillStyle = "rgba(0, 210, 255, 0.9)";
      ctx.font = "900 11px 'Rubik', sans-serif";
      ctx.textAlign = "center";
      ctx.letterSpacing = "2px";
      ctx.fillText("CYBER SPEED BAG", 0, h * 0.33);

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
      try {
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
      } catch (err) {
        console.warn("Ninja update error:", err);
      }
    },
    draw() {
      try {
        for (const o of objs) {
          Art.drawFruit(o.x, o.y, o.r, o.emoji, o.rot, 0);
        }
        for (const h of halves) {
          ctx.save(); ctx.globalAlpha = Math.max(h.life, 0);
          Art.drawFruit(h.x, h.y, h.r, h.emoji, h.rot, h.half);
          ctx.restore();
        }
      } catch (err) {
        console.warn("Ninja draw error:", err);
      }
    },
    trail: "#00d2ff",
  },
};
let halves = [];

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
  if (!b || (playerSettings && playerSettings.skeleton === false)) return;
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
    try {
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
        for (const i of [0, 11, 12, 23, 24]) if (bv(b, i, 0.3) && b[i]) torso.push(b[i]);
        if (bv(b, 11, 0.3) && bv(b, 12, 0.3) && b[11] && b[12]) torso.push({ x: (b[11].x + b[12].x) / 2, y: (b[11].y + b[12].y) / 2 });
        if (bv(b, 23, 0.3) && bv(b, 24, 0.3) && b[23] && b[24]) torso.push({ x: (b[23].x + b[24].x) / 2, y: (b[23].y + b[24].y) / 2 });
        for (const i of [15, 16]) if (bv(b, i, 0.3) && b[i]) hands.push(b[i]);
      }
      for (const it of this.items) {
        it.y += it.vy * dt; it.rot += dt * 2.5;
        if (it.dead) continue;
        if (it.coin) {
          if ([...torso, ...hands].some((p) => p && Math.hypot(p.x - it.x, p.y - it.y) < it.r + 24)) {
            it.dead = true; this.coins++; award(it.x, it.y, 1, "#ffd166"); sfx.pop(it.x, true); burst(it.x, it.y, "#ffd166", 14);
          }
        } else if (this.inv <= 0 && torso.some((p) => p && Math.hypot(p.x - it.x, p.y - it.y) < it.r * 0.85 + 8)) {
          it.dead = true; this.lives--; this.inv = 1.5; this.flash = 1; combo = 0;
          burst(it.x, it.y, "#ff6b4a", 26); sfx.crash();
          if (this.lives === 1) speak("한 번 더 맞으면 끝이에요!"); else if (this.lives > 1) speak("앗, 조심!");
          if (this.lives <= 0) {
            endGame();
            return; // 🛡️ 사망 시 남은 루프 즉시 안전 탈출
          }
        }
        if (!it.dead && it.y > H + it.r) { it.dead = true; if (!it.coin && b) { score += 1; popup(it.x, H - 60, "+1", "#9fe8ff"); } }
      }
      this.items = this.items.filter((it) => !it.dead);
    } catch (err) {
      console.warn("Dodge update safe catch:", err);
    }
  },
  draw() {
    try {
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
    } catch (err) {
      console.warn("Dodge draw safe catch:", err);
    }
  },
};

// 🙆 포즈 미믹: 화면 캐릭터와 똑같은 자세를 따라 해요. 3번 성공할 때마다 레벨이 올라 자세가 어려워져요.
// 자세 목록/인식 규칙은 poses.js, 캐릭터 그림은 pose-art.js. 캐릭터는 인식에 쓰는 "팔다리 각도"로 그려서
// 보이는 자세 = 인식하는 자세예요. 내 몸 위에 목표 자세가 점선으로 겹쳐 보이고, 틀린 팔다리는 주황색으로 알려 줘요.
let poseMatchKey = 0;      // 마우스 모드(테스트): 스페이스/엔터/클릭 = 자세를 맞춘 것으로 침
addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") poseMatchKey = performance.now(); });
addEventListener("pointerdown", () => { if (mode === "pose" && useMouse) poseMatchKey = performance.now(); });
const POSE_PRAISE = ["좋아요! 👍", "잘했어요! 🎉", "멋져요! ✨", "완벽해요! 💯"];
games.pose = {
  bg: "#1f1147", camAlpha: 0.85, body: true, noCursor: true, manual: true,
  init() {
    this.level = 1; this.cfg = levelConfig(1); this.done = 0; this.streak = 0; this.lastId = null; this.pose = null;
    this.t = 0; this.trans = 1; this.happy = 0; this.ok = false; this.match = null; this.syncPct = 0; this.hint = null; this.hintT = 0; this.spoke = false;
    this.cur = anglesOf({ arms: [100, 100, 80, 80], legs: null }); this.from = this.cur; this.to = this.cur;
    this.next();
  },
  result() { return ` · 성공 ${this.done}번 · 레벨 ${this.level}`; },
  next() {
    const prevLevel = this.level;
    this.level = levelFor(this.done); this.cfg = levelConfig(this.level);
    this.pose = pickPose(this.level, this.lastId); this.lastId = this.pose.id;
    this.from = this.cur; this.to = anglesOf(this.pose); this.trans = 0;       // 캐릭터가 새 자세로 부드럽게 바뀜
    this.limit = this.cfg.time; this.left = this.limit; this.hold = 0; this.spoke = false; this.hint = null; this.hintT = 0.8;
    if (this.level > prevLevel) {
      triggerWaveBanner(`LEVEL ${this.level}`, `${this.cfg.name} · 더 어려운 자세가 나와요!`, false);
      sfx.levelUp(); speak(`레벨 ${this.level}! ${this.pose.name}`, true);
    } else speak(this.pose.name);
  },
  update(dt) {
    this.t += dt; this.happy = Math.max(0, this.happy - dt);
    this.trans = Math.min(1, this.trans + dt / 0.45);
    this.cur = lerpAngles(this.from, this.to, easeOutBack(this.trans));
    const body = getBody();
    let ok = false;
    if (useMouse) { ok = performance.now() - poseMatchKey < 1500; this.match = null; this.syncPct = ok ? 100 : 0; }
    else if (body) {
      this.match = matchPose(this.pose, this.level, body); ok = this.match.matched;
      this.syncPct = Math.round(this.syncPct * 0.6 + this.match.score * 100 * 0.4);       // 일치율(HUD): 부드럽게 변함
    } else { this.match = null; this.syncPct = 0; }
    this.ok = ok && this.trans >= 0.6;                  // 캐릭터가 자세를 바꾸는 중에는 판정하지 않음 (눈으로 확인할 시간)
    if (body || useMouse) this.left -= dt;              // 몸이 안 보이는 동안은 시간이 줄지 않아요
    this.hold = this.ok ? this.hold + dt : Math.max(0, this.hold - dt * 2);

    // 어디가 틀렸는지 안내 (0.4초마다 갱신). 시간이 절반 지났는데 가까워졌다면 음성으로도 한 번 알려 줌
    this.hintT -= dt;
    if (this.ok) this.hint = null;
    else if (this.hintT <= 0 && body && !useMouse) {
      this.hintT = 0.4; this.hint = hintFor(this.pose, this.level, body);
      if (this.hint && !this.spoke && this.left < this.limit * 0.5 && this.syncPct > 35) { this.spoke = true; speak(this.hint); }
    }

    if (this.hold >= this.cfg.hold) {
      this.done++; this.streak++;
      const pts = poseScore(this.level, this.left, this.streak);
      award(W / 2, H * 0.5, pts, "#80ed99");
      burst(W / 2, H * 0.5, "#80ed99", 30); burst(W / 2, H * 0.5, "#ffd166", 16); sfx.pop(W / 2, true);
      popup(W / 2, H * 0.4, this.streak >= 3 ? `${this.streak}연속! 🔥` : POSE_PRAISE[(Math.random() * POSE_PRAISE.length) | 0], "#ffd166");
      this.happy = 0.8; this.next();
    } else if (this.left <= 0) {
      this.streak = 0; combo = 0; popup(W / 2, H * 0.4, "아쉬워요 😅", "#ff9a9a"); sfx.chip(W / 2); this.next();
    }
  },
  draw() {
    if (!this.pose) return;
    const body = getBody(), legs = needsLegs(this.pose);
    // 1) 내 몸 위: 목표 자세 가이드(점선) + 마디별 맞음(초록)/틀림(주황)
    if (body && bv(body, 11, 0.45) && bv(body, 12, 0.45)) {
      const u = torsoLength(body);
      drawGhost(ctx, this.to, { x: (body[11].x + body[12].x) / 2, y: (body[11].y + body[12].y) / 2 }, u, { legs, alpha: this.level >= 4 ? 0.4 : 0.6 });
    }
    drawUserLimbs(ctx, body, this.match, this.pose, { needLegs: legs });

    // 2) 캐릭터 안내판 (넓은 화면은 왼쪽, 좁은 화면은 위쪽 가운데)
    const side = W >= 900, s = Math.min(side ? W * 0.26 : W * 0.5, H * 0.42);
    const pw = s * 1.3, ph = s * 1.5 + 118, px = side ? Math.max(pw / 2 + 16, W * 0.15) : W / 2, py = side ? Math.max(120, H * 0.17) : 92;
    ctx.save();
    ctx.fillStyle = "rgba(14,6,36,.78)"; ctx.strokeStyle = this.ok ? "#00e676" : "rgba(125,249,255,.55)"; ctx.lineWidth = this.ok ? 5 : 3;
    ctx.beginPath(); ctx.roundRect(px - pw / 2, py, pw, ph, 22); ctx.fill(); ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd166"; ctx.font = `900 ${Math.max(13, s * 0.075)}px sans-serif`;
    ctx.fillText(`LEVEL ${this.level} · ${this.cfg.name}  ${"★".repeat(this.level)}${"☆".repeat(5 - this.level)}`, px, py + 20);
    drawMascot(ctx, this.cur, { x: px, y: py + 34, h: s * 1.28 }, { t: this.t, mood: this.ok || this.happy > 0 ? "happy" : "normal" });
    // 자세 이름 (길면 글자 크기를 줄여서 안내판 안에 맞춤)
    let fs = Math.max(15, s * 0.1); ctx.font = `900 ${fs}px sans-serif`;
    while (ctx.measureText(this.pose.name).width > pw - 16 && fs > 11) { fs -= 1; ctx.font = `900 ${fs}px sans-serif`; }
    ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.fillStyle = "#fff";
    const ny = py + 34 + s * 1.28 + 20;
    ctx.strokeText(this.pose.name, px, ny); ctx.fillText(this.pose.name, px, ny);
    // 남은 시간(노랑) / 자세 유지(초록) 막대 + 일치율
    const bw = pw - 36, bx = px - bw / 2, by = ny + 18;
    ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.fillRect(bx, by, bw, 9); ctx.fillStyle = this.left < this.limit * 0.25 ? "#ff6b6b" : "#ffd166"; ctx.fillRect(bx, by, bw * Math.max(this.left, 0) / this.limit, 9);
    ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.fillRect(bx, by + 15, bw, 9); ctx.fillStyle = "#00e676"; ctx.fillRect(bx, by + 15, bw * Math.min(this.hold / this.cfg.hold, 1), 9);
    ctx.fillStyle = "#fff"; ctx.font = `800 ${Math.max(12, s * 0.07)}px sans-serif`; ctx.fillText(`일치 ${this.syncPct}%`, px, by + 42);
    ctx.restore();

    // 3) 어디를 고쳐야 하는지 한 줄 안내 (몸 근처 아래쪽 가운데)
    const msg = useMouse ? "(테스트: 스페이스/클릭 = 자세 맞추기)" : this.ok ? "좋아요! 그대로 유지!" : this.hint;
    if (msg) {
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${Math.max(18, Math.min(W * 0.034, 34))}px sans-serif`;
      ctx.lineWidth = 7; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.fillStyle = this.ok ? "#00e676" : "#ffd166";
      const mx = side ? Math.max(W * 0.58, px + pw / 2 + 200) : W / 2, my = H * 0.84;
      ctx.strokeText(msg, mx > W - 160 ? W / 2 : mx, my); ctx.fillText(msg, mx > W - 160 ? W / 2 : mx, my); ctx.restore();
    }
    bodyHint();
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const heartsText = (n, max = 3) => "";
function topHud() {
  // 화면 중앙을 가리는 캔버스 텍스트 전면 제거 -> Stitch DOM #hudGuideBanner로 일원화
  return;
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

// 🦘 점프 달리기: 몸을 위로 점프하면 돌을 넘고, 앉으면 위에서 오는 장애물 밑으로 지나가요 (몸 인식)
let rkJump = false, rkDuck = false;
addEventListener("keydown", (e) => { if (e.key === " " || e.key === "ArrowUp") rkJump = true; if (e.key === "ArrowDown" || e.key === "s") rkDuck = true; });
addEventListener("keyup", (e) => { if (e.key === "ArrowDown" || e.key === "s") rkDuck = false; });
addEventListener("pointerdown", () => { if (mode === "runner") rkJump = true; });
games.runner = {
  bg: "#100624", camAlpha: 0.40, body: true, noCursor: true, manual: true,
  hs() { return Math.min(W, H) * 0.16; },
  gy() { return H * 0.76; },
  cx() { return W * 0.22; },

  init() {
    this.t = 0;
    this.phase = useMouse ? "run" : "calib";
    this.cal = 0;
    this.base = null;
    this.prevJump = false;
    this.lives = 3;
    this.inv = 0;
    this.flash = 0;
    this.obs = [];
    this.spawnT = 1.0;
    this.vy = 0;
    this.jy = 0;
    this.duck = false;
    rkJump = false;
    this.dist = 0;
    this.prevY = null;
    this.prevVUp = 0;
    this.lastJumpTime = 0;
    this.lastDuckTime = 0;

    // 🚀 아스트로 점프 러너 전용 파워업 & 통계 시스템
    this.boostTimer = 0; // 하이퍼 대시 무적 부스터 시간
    this.jumpCount = 0;
    this.duckCount = 0;
    this.coinsCollected = 0;

    // 광속 스피드 라인 파티클 풀
    this.speedLines = [];
    for (let i = 0; i < 28; i++) {
      this.speedLines.push({
        x: Math.random() * W,
        y: H * (0.2 + Math.random() * 0.55),
        len: 60 + Math.random() * 120,
        spd: 900 + Math.random() * 700
      });
    }
  },

  sense(dt) { // NotebookLM 최적화: 가속도 피크 선제 점프 + 앉았다 일어설 때 점프 오인식 원천 차단 가드
    let jump = rkJump, duck = rkDuck; rkJump = false;
    const b = getBody();
    const now = performance.now();

    if (!useMouse && b) {
      // 1. 다중 키포인트 폴백 (전신/상체 완벽 트래킹)
      let y = null, tl = 120;
      const hasSh = bv(b, 11, 0.25) && bv(b, 12, 0.25);
      const hasHip = bv(b, 23, 0.25) && bv(b, 24, 0.25);

      if (hasSh && hasHip) {
        const shY = (b[11].y + b[12].y) / 2;
        const hipY = (b[23].y + b[24].y) / 2;
        y = (shY + hipY) / 2;
        tl = Math.max(40, hipY - shY);
      } else if (hasSh) {
        y = (b[11].y + b[12].y) / 2;
        tl = 100;
      } else if (b[0] && bv(b, 0, 0.3)) {
        y = b[0].y;
        tl = 80;
      }

      if (y !== null) {
        if (this.base == null) this.base = y;
        if (this.prevY == null) this.prevY = y;

        const dy = y - this.base;
        if (dy >= -tl * 0.05 && dy <= tl * 0.10) {
          this.base += dy * Math.min(1, dt * 1.5);
        }

        // 2. 앉기(Duck / Slide) 모션: 기준선보다 15% 이상 숙였을 때 즉시 발동
        const isCurrentlyDucking = dy > tl * 0.15;
        if (isCurrentlyDucking) {
          duck = true;
          this.lastDuckTime = now;
        }

        // 3. 수직 상승 속도 및 가속도 계산 (NotebookLM 도약 피크 엔진)
        const safeDt = Math.max(dt, 0.008);
        const vUp = (this.prevY - y) / safeDt;
        const aUp = (vUp - (this.prevVUp || 0)) / safeDt;
        this.prevY = y;
        this.prevVUp = vUp;

        // 앉았다가 일어서는 모션(Stand-up)은 점프로 튀지 않도록 차단
        const isRecoveringFromDuck = (now - this.lastDuckTime < 280) || (dy >= -tl * 0.03);

        const isThrustPeak = !isRecoveringFromDuck && (aUp > 750 && vUp > 35);
        const isVelocityPeak = !isRecoveringFromDuck && (vUp > (tl * 0.85) || vUp > 110);
        const isPositionLift = dy < -tl * 0.09 && (now - this.lastDuckTime > 200);

        const up = isThrustPeak || isVelocityPeak || isPositionLift;
        if (up && !this.prevJump && (now - this.lastJumpTime > 340)) {
          jump = true;
          this.lastJumpTime = now;
        }
        this.prevJump = up;
        this.seen = true;
      } else {
        this.seen = false;
      }
    } else {
      this.seen = false;
    }
    return { jump, duck };
  },

  update(dt) {
    try {
      this.t += dt;
      const { jump, duck } = this.sense(dt), e = elapsed(), hs = this.hs();

      if (this.phase === "calib") {
        this.cal = this.seen ? this.cal + dt : 0;
        if (this.cal >= 1.2) {
          this.phase = "run";
          speak("출발! 신나게 달려봐요!", true);
          sfx.start();
        }
        return;
      }

      // 부스터 타이머 갱신
      this.boostTimer = Math.max(0, this.boostTimer - dt);
      const isBoosting = this.boostTimer > 0;

      // 점프 물리
      const g = H * 3.4, v0 = Math.sqrt(2 * g * hs * 1.05);
      if (jump && this.jy <= 0) {
        this.vy = v0;
        this.jumpCount++;
        tone(480, ac().currentTime, 0.16, "triangle", 0.18, 950);
        burst(this.cx(), this.gy() - 8, "#00d2ff", 16);
        popup(this.cx(), this.gy() - hs * 0.8, "JUMP! 🦘", "#00d2ff");
      }
      this.jy += this.vy * dt;
      this.vy -= g * dt;
      if (this.jy <= 0) { this.jy = 0; this.vy = 0; }

      // 슬라이딩 앉기
      const wasDuck = this.duck;
      this.duck = duck && this.jy === 0;
      if (!wasDuck && this.duck) {
        this.duckCount++;
        tone(220, ac().currentTime, 0.12, "sine", 0.15, 140);
        popup(this.cx(), this.gy() - hs * 0.35, "SLIDE! ⚡", "#ffea00");
      }

      // 🚀 3단계 웨이브 & 부스터 연동 속도 계산
      const waveMult = currentWave === 3 ? 1.55 : (currentWave === 2 ? 1.25 : 1.0);
      const boostMult = isBoosting ? 1.50 : 1.0;
      const v = W * 0.46 * waveMult * boostMult * (1 + e * 0.008);
      this.dist += v * dt;

      this.spawnT -= dt;
      this.inv = Math.max(0, this.inv - dt);
      this.flash = Math.max(0, this.flash - dt * 2);

      // 🚀 스피드 라인 파티클 시뮬레이션
      for (const line of this.speedLines) {
        line.x -= line.spd * (isBoosting || currentWave === 3 ? 1.8 : 1.0) * dt;
        if (line.x < -line.len) {
          line.x = W + Math.random() * 80;
          line.y = H * (0.2 + Math.random() * 0.55);
        }
      }

      // 장애물 & 파워업 동적 스케줄링
      if (this.spawnT <= 0) {
        // 웨이브 단계가 높을수록 장애물 스폰 간격이 빨라짐
        const baseInterval = currentWave === 3 ? 1.0 : (currentWave === 2 ? 1.25 : 1.5);
        this.spawnT = Math.max(0.75, baseInterval - e * 0.01) * (0.85 + rng() * 0.4);
        const r = rng(), x = W + 70;

        if (r < 0.15 && !isBoosting) {
          // 🚀 [신규] 하이퍼 부스터 링 (점프로 통과 시 무적 질주 가속!)
          this.obs.push({ type: "ring", x, w: hs * 0.75, h: hs * 0.75, y0: hs * 0.45 });
        } else if (r < 0.45) {
          // [점프 허들] 네온 사이버 레이저 바리케이드
          this.obs.push({ type: "rock", x, w: hs * 0.52, h: hs * 0.44, y0: 0 });
        } else if (r < 0.75) {
          // [슬라이딩 장애물] 고공 사이버 드론 & 하향 레이저 빔
          this.obs.push({ type: "bar", x, w: hs * 0.72, h: hs * 0.52, y0: hs * 0.60 });
        } else {
          // [보너스] 3D 골든 스타 코인 3연속 트레일
          const hi = rng() < 0.45;
          for (let k = 0; k < 3; k++) {
            this.obs.push({
              type: "coin",
              x: x + k * hs * 0.55,
              w: hs * 0.32,
              h: hs * 0.32,
              y0: hi ? hs * 1.25 : hs * 0.22,
              coinRot: k * 0.4
            });
          }
        }
      }

      const cx = this.cx(), cw = hs * 0.35, ch = this.duck ? hs * 0.52 : hs;
      for (const o of this.obs) {
        o.x -= v * dt;
        if (o.type === "coin") o.coinRot = (o.coinRot || 0) + dt * 4;

        const overlapX = o.x < cx + cw * 0.42 && o.x + o.w > cx - cw * 0.42;
        const overlapY = o.y0 < this.jy + ch * 0.95 && o.y0 + o.h > this.jy + ch * 0.05;

        if (!o.dead && overlapX && overlapY) {
          if (o.type === "coin") {
            // 🪙 골든 스타 코인 획득
            o.dead = true;
            this.coinsCollected++;
            award(o.x, this.gy() - o.y0 - o.h, 2, "#ffd166");   // 콤보/피버 배수는 award()가 한 번만 처리
            burst(o.x, this.gy() - o.y0 - o.h, "#ffd166", 12);
            sfx.pop(o.x, true);
          } else if (o.type === "ring") {
            // 🚀 하이퍼 부스터 링 통과! (3.2초 무적 질주 모드 돌입)
            o.dead = true;
            this.boostTimer = 3.2;
            score += 15;
            sfx.levelUp();
            burst(cx, this.gy() - hs * 0.6, "#00f0ff", 35);
            popup(cx, this.gy() - hs * 1.1, "HYPER DASH!! 🚀 무적 질주!", "#00f0ff");
            speak("하이퍼 부스터 질주!", true);
          } else if (isBoosting) {
            // 💥 무적 부스터 상태로 장애물 돌파 박살!
            o.dead = true;
            score += 8;
            combo++;
            burst(o.x, this.gy() - o.y0 - o.h * 0.5, "#ff0077", 26);
            sfx.saber(o.x, true);
            popup(o.x, this.gy() - o.y0 - o.h, "SMASH! +8 💥", "#ffea00");
          } else if (this.inv <= 0) {
            // 앗! 장애물 충돌 피격
            o.dead = true;
            this.lives--;
            this.inv = 1.6;
            this.flash = 1;
            combo = 0;
            burst(cx, this.gy() - hs / 2, "#ff2a4b", 25);
            sfx.crash();
            if (this.lives === 1) speak("한 번 더 부딪히면 끝이에요! 조심해요!");
            else if (this.lives > 1) speak("앗, 조심해요!");
            if (this.lives <= 0) { endGame(); return; }
          }
        }

        // 점프/슬라이딩으로 장애물 회피 성공 채점
        if (!o.dead && !o.counted && o.type !== "coin" && o.type !== "ring" && o.x + o.w < cx - cw * 0.4) {
          o.counted = true;
          award(cx, this.gy() - hs * 1.3, 3, "#a5e7ff");        // 콤보/피버 배수는 award()가 한 번만 처리
          popup(cx, this.gy() - hs * 0.9, o.type === "rock" ? "JUMP CLEAR!" : "SLIDE CLEAR!", "#00d2ff");
        }
      }

      this.obs = this.obs.filter((o) => !o.dead && o.x > -o.w - 80);
    } catch (err) {
      console.warn("Runner update error:", err);
    }
  },

  draw() {
    try {
      if (!this.obs) return;
    const hs = this.hs(), gy = this.gy(), cx = this.cx();
    const isBoosting = this.boostTimer > 0;

    // 1. 네온 사이버 하이웨이 트랙 바닥 (Stitch 아케이드 3D 펄스 트랙)
    ctx.save();
    // 바닥 심도 그라데이션
    const trackGrad = ctx.createLinearGradient(0, gy, 0, H);
    trackGrad.addColorStop(0, isFeverTime ? "rgba(225, 3, 125, 0.45)" : "rgba(0, 210, 255, 0.35)");
    trackGrad.addColorStop(0.3, "#190b30");
    trackGrad.addColorStop(1, "#0c0618");
    ctx.fillStyle = trackGrad;
    ctx.fillRect(0, gy, W, H - gy);

    // 트랙 최상단 발광 LED 레일
    ctx.strokeStyle = isFeverTime ? "#ff2e93" : (isBoosting ? "#00f0ff" : "#a5e7ff");
    ctx.lineWidth = 4;
    ctx.shadowColor = isFeverTime ? "#ff2e93" : "#00d2ff";
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    ctx.shadowBlur = 0;

    // 고속 이동 네온 타일 격자 (질주감 부여)
    ctx.strokeStyle = isFeverTime ? "rgba(255, 46, 147, 0.35)" : "rgba(0, 210, 255, 0.25)";
    ctx.lineWidth = 2.5;
    const tileSpacing = 75;
    const tileOffset = -((this.dist * 1.6) % tileSpacing);
    for (let x = tileOffset; x < W + tileSpacing; x += tileSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x - 30, gy + 32);
      ctx.stroke();
    }
    // 하단 보조 LED 라인
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath(); ctx.moveTo(0, gy + 32); ctx.lineTo(W, gy + 32); ctx.stroke();
    ctx.restore();

    // 2. 피버 타임 & 부스터 광속 스피드 라인 (Speed Lines)
    if (isBoosting || currentWave === 3) {
      ctx.save();
      ctx.strokeStyle = isBoosting ? "rgba(0, 240, 255, 0.45)" : "rgba(255, 46, 147, 0.4)";
      ctx.lineWidth = 2;
      for (const line of this.speedLines) {
        ctx.beginPath();
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(line.x + line.len, line.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. 고품질 장애물 & 파워업 그래픽 렌더링 (명확한 액션 인지 디자인)
    for (const o of this.obs) {
      const y = gy - o.y0 - o.h;

      if (o.type === "coin") {
        // 🪙 3D 회전하는 홀로그램 골든 스타 코인
        ctx.save();
        const cx = o.x + o.w / 2, cy = y + o.h / 2;
        const rot = (o.coinRot || 0) + this.t * 3;
        ctx.translate(cx, cy);

        // 외곽 황금빛 아우라
        const aura = ctx.createRadialGradient(0, 0, 5, 0, 0, o.w * 0.9);
        aura.addColorStop(0, "rgba(255, 215, 0, 0.45)");
        aura.addColorStop(1, "rgba(255, 180, 0, 0)");
        ctx.fillStyle = aura;
        ctx.beginPath(); ctx.arc(0, 0, o.w * 0.9, 0, Math.PI * 2); ctx.fill();

        // 3D 회전 코인 본체
        ctx.scale(Math.cos(rot), 1);
        ctx.fillStyle = "#ffd166";
        ctx.strokeStyle = "#e59b00";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#ffd166"; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(0, 0, o.w * 0.48, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        // 코인 내부 스타 각인
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        const rOuter = o.w * 0.35, rInner = o.w * 0.16;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          const r = i % 2 === 0 ? rOuter : rInner;
          const px = Math.cos(a) * r, py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (o.type === "ring") {
        // 🚀 하이퍼 부스터 링 (에너지 가속 포털)
        ctx.save();
        const rx = o.x + o.w / 2, ry = y + o.h / 2;
        const pulse = 1.0 + Math.sin(this.t * 8) * 0.08;
        ctx.translate(rx, ry);
        ctx.scale(pulse, pulse);

        // 외곽 네온 글로우 링
        ctx.strokeStyle = "#00d2ff";
        ctx.shadowColor = "#00d2ff"; ctx.shadowBlur = 25;
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.ellipse(0, 0, o.w * 0.48, o.h * 0.52, 0, 0, Math.PI * 2); ctx.stroke();

        // 내부 고출력 화이트 코어 링
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3.5;
        ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.ellipse(0, 0, o.w * 0.36, o.h * 0.40, 0, 0, Math.PI * 2); ctx.stroke();

        // 회전하는 4점 가속 노즐
        ctx.fillStyle = "#ffd166";
        for (let i = 0; i < 4; i++) {
          const a = this.t * 4 + (i * Math.PI) / 2;
          const nx = Math.cos(a) * o.w * 0.48, ny = Math.sin(a) * o.h * 0.52;
          ctx.beginPath(); ctx.arc(nx, ny, 5, 0, Math.PI * 2); ctx.fill();
        }

        // 상단 부스터 안내 뱃지
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(0, 210, 255, 0.25)";
        ctx.strokeStyle = "#00d2ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(-48, -o.h * 0.68 - 14, 96, 26, 13); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 13px 'Rubik', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("🚀 BOOST!", 0, -o.h * 0.68);
        ctx.restore();
      } else if (o.type === "rock") {
        // ⚡ [점프 허들] 사이버 스파이크 바리케이드 & 플라즈마 펜스
        ctx.save();
        const bounce = Math.sin(this.t * 10) * 4;

        // 1. 바닥 위험 예고 스트라이프 (Hazard Warning Strip)
        ctx.save();
        ctx.fillStyle = "rgba(255, 170, 0, 0.35)";
        ctx.fillRect(o.x - 15, gy - 6, o.w + 30, 6);
        ctx.strokeStyle = "#ffaa00"; ctx.lineWidth = 2;
        ctx.strokeRect(o.x - 15, gy - 6, o.w + 30, 6);
        ctx.restore();

        // 2. 바리케이드 하단 베이스 블록 (경고 빗금 무늬)
        const baseH = o.h * 0.45;
        const baseY = gy - baseH;
        ctx.fillStyle = "#221439";
        ctx.strokeStyle = "#fbb500";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#fbb500"; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.roundRect(o.x, baseY, o.w, baseH, 6); ctx.fill(); ctx.stroke();

        // 빗금 경고 무늬 (Hazard Lines)
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = "rgba(251, 181, 0, 0.45)"; ctx.lineWidth = 5;
        for (let lx = o.x - baseH; lx < o.x + o.w + baseH; lx += 18) {
          ctx.beginPath(); ctx.moveTo(lx, gy); ctx.lineTo(lx + baseH, baseY); ctx.stroke();
        }
        ctx.restore();

        // 3. 상단 솟구치는 네온 플라즈마 스파이크 (3연속 침)
        const spikeCount = 3;
        const spikeW = o.w / spikeCount;
        for (let i = 0; i < spikeCount; i++) {
          const sx = o.x + i * spikeW;
          const grad = ctx.createLinearGradient(0, y, 0, baseY);
          grad.addColorStop(0, "#ffffff");
          grad.addColorStop(0.3, "#ff3366");
          grad.addColorStop(1, "#fbb500");
          ctx.fillStyle = grad;
          ctx.strokeStyle = "#ff0055"; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx + 3, baseY);
          ctx.lineTo(sx + spikeW / 2, y);
          ctx.lineTo(sx + spikeW - 3, baseY);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        }

        // 지글거리는 고전압 번개 아크
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
        ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(o.x + 8, y + 8);
        ctx.lineTo(o.x + o.w * 0.35, y + 2);
        ctx.lineTo(o.x + o.w * 0.65, y + 10);
        ctx.lineTo(o.x + o.w - 8, y + 4);
        ctx.stroke();

        // 4. 🔥 직관적 초대형 점프 액션 뱃지 (▲ 점프! JUMP)
        const badgeY = y - 30 + bounce;
        const badgeW = 110, badgeH = 30;
        const badgeX = o.x + o.w / 2 - badgeW / 2;

        ctx.shadowColor = "#fbb500"; ctx.shadowBlur = 20;
        ctx.fillStyle = "#1e1035";
        ctx.strokeStyle = "#fbb500"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 15); ctx.fill(); ctx.stroke();

        ctx.fillStyle = "#fbb500";
        ctx.shadowColor = "#fbb500"; ctx.shadowBlur = 8;
        ctx.font = "900 15px 'Rubik', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("▲ 점프! JUMP", o.x + o.w / 2, badgeY + badgeH / 2);
        ctx.restore();
      } else if (o.type === "bar") {
        // 🛸 [슬라이딩 허들] 고공 사이버 드론 & 플라즈마 레이저 커튼
        ctx.save();
        const droneH = o.h * 0.34;
        const droneY = y;
        const bounce = Math.sin(this.t * 8) * 3;

        // 1. 드론 좌/우 회전 터빈
        ctx.fillStyle = "#3c2e54";
        ctx.strokeStyle = "#e1037d"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(o.x - 8, droneY + 4, 12, droneH - 8, 4); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(o.x + o.w - 4, droneY + 4, 12, droneH - 8, 4); ctx.fill(); ctx.stroke();

        // 2. 드론 본체 (메탈릭 다크 쉘)
        ctx.fillStyle = "#14062b";
        ctx.strokeStyle = "#e1037d"; ctx.lineWidth = 3;
        ctx.shadowColor = "#e1037d"; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.roundRect(o.x, droneY, o.w, droneH, 8); ctx.fill(); ctx.stroke();

        // 드론 중앙 붉은 센서 코어 (펄스 점멸)
        ctx.fillStyle = "#ff0055"; ctx.shadowColor = "#ff0055"; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, droneY + droneH / 2, 7, 0, Math.PI * 2); ctx.fill();

        // 3. 빽빽한 전자기 플라즈마 레이저 커튼 (위에서 아래로 쏟아짐)
        const curtainTop = droneY + droneH;
        const curtainBottom = y + o.h;

        // 반투명 레이저 위험 필름
        const filmGrad = ctx.createLinearGradient(0, curtainTop, 0, curtainBottom);
        filmGrad.addColorStop(0, "rgba(225, 3, 125, 0.45)");
        filmGrad.addColorStop(1, "rgba(255, 0, 85, 0.15)");
        ctx.fillStyle = filmGrad;
        ctx.fillRect(o.x + 4, curtainTop, o.w - 8, curtainBottom - curtainTop);

        // 5줄의 고압 전자기 레이저 빔
        ctx.shadowColor = "#ff2e93"; ctx.shadowBlur = 12;
        ctx.strokeStyle = "#ff2e93"; ctx.lineWidth = 3.5;
        for (let i = 0; i < 5; i++) {
          const bx = o.x + 8 + i * ((o.w - 16) / 4);
          ctx.beginPath(); ctx.moveTo(bx, curtainTop); ctx.lineTo(bx, curtainBottom); ctx.stroke();
        }

        // 레이저 하단 지글거리는 불꽃 스파크
        ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 8;
        for (let i = 0; i < 5; i++) {
          const bx = o.x + 8 + i * ((o.w - 16) / 4);
          ctx.beginPath(); ctx.arc(bx, curtainBottom, 3, 0, Math.PI * 2); ctx.fill();
        }

        // 4. 하단 안전 통과 구역 표시 (SAFE SLIDE CLEARANCE)
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(0, 210, 255, 0.6)"; ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(o.x - 10, curtainBottom + 6); ctx.lineTo(o.x + o.w + 10, curtainBottom + 6); ctx.stroke();
        ctx.setLineDash([]);

        // 5. 🔥 직관적 초대형 슬라이딩 액션 뱃지 (▼ 숙여요! SLIDE)
        const badgeY = curtainBottom + 12 + bounce;
        const badgeW = 114, badgeH = 28;
        const badgeX = o.x + o.w / 2 - badgeW / 2;

        ctx.fillStyle = "#1e1035";
        ctx.strokeStyle = "#e1037d"; ctx.lineWidth = 2.5;
        ctx.shadowColor = "#e1037d"; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 14); ctx.fill(); ctx.stroke();

        ctx.fillStyle = "#ff2e93";
        ctx.shadowColor = "#ff2e93"; ctx.shadowBlur = 8;
        ctx.font = "900 15px 'Rubik', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("▼ 숙여요! SLIDE", o.x + o.w / 2, badgeY + badgeH / 2);
        ctx.restore();
      }
    }

    // 4. 고품질 아스트로 사이버 러너 마스코트 아바타 렌더링
    Art.drawRunnerMascot(cx, gy, this.jy, hs, this.duck, this.dist, this.inv, isFeverTime, isBoosting);

    // 5. 전신 포즈 인식 뼈대 렌더링
    if (!useMouse) drawSkeleton(getBody(), "rgba(0, 210, 255, 0.75)", 0.5);

    // 6. 상단 라이프 & 주행 거리 & 부스터 상태 표시
    ctx.save();
    // 하트 라이프
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "32px serif";
    ctx.fillText(heartsText(this.lives), W / 2, 98);

    // 주행 거리 네온 배지
    const distMeter = Math.floor(this.dist / 12);
    ctx.fillStyle = "rgba(25, 11, 48, 0.85)";
    ctx.strokeStyle = "rgba(0, 210, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(W * 0.05, 78, 140, 36, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#a5e7ff"; ctx.font = "900 13px 'Rubik', sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`🚀 ${distMeter} m`, W * 0.05 + 70, 96);

    // 부스터 가동 시 상단 네온 게이지 바
    if (isBoosting) {
      const bRatio = this.boostTimer / 3.2;
      ctx.fillStyle = "rgba(0, 240, 255, 0.2)";
      ctx.fillRect(W * 0.35, 120, W * 0.30, 8);
      ctx.fillStyle = "#00f0ff"; ctx.shadowColor = "#00f0ff"; ctx.shadowBlur = 10;
      ctx.fillRect(W * 0.35, 120, W * 0.30 * bRatio, 8);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // 피격 플래시
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 50, 50, ${this.flash * 0.38})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 7. 모션 인식 캘리브레이션 오버레이
    if (this.phase === "calib") {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `900 ${Math.max(20, Math.min(W * 0.055, H * 0.065))}px 'Rubik', sans-serif`;
      ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.fillStyle = "#ffd166";
      const t = this.seen ? `똑바로 서서 준비! ${Math.max(0, Math.ceil(2 - this.cal))}` : "전신이 보이게 카메라 앞에 서 주세요";
      ctx.strokeText(t, W / 2, H * 0.4); ctx.fillText(t, W / 2, H * 0.4);
    } else if (this.t < 8) {
      topHud(useMouse ? "스페이스/클릭 = 점프, ↓ 키 = 앉기 슬라이드!" : "몸을 위로 점프하면 넘고, 숙여 앉으면 지나가요!");
    }
    bodyHint();
    } catch (err) {
      console.warn("Runner draw error:", err);
    }
  },
};

// ============================================================================
// 🥋 쿵푸 마스터 대전 (KUNG FU MASTER COMBAT) - 3D 모션 무협 액션 엔진
// ============================================================================
games.kungfu = {
  bg: "#160714",
  camAlpha: 0.42,
  trail: "#ff5500",
  init() {
    this.lives = 3;
    this.shake = 0;
    this.flash = 0;
    this.fx = [];
    this.t = 0;
    this.used = new Set();
    this.chi = 0; // 기(氣) 게이지 0 ~ 100%
    this.koCount = 0;
    this.guardActive = false;
    this.guardTimer = 0;
    this.dragonMode = false;
    this.dragonTimer = 0;
    this.dojoLanterns = Array.from({ length: 6 }, (_, i) => ({
      x: W * (0.15 + i * 0.14),
      y: H * 0.18,
      phase: Math.random() * Math.PI * 2
    }));
  },
  spawn() {
    const waveMult = currentWave === 3 ? 1.3 : currentWave === 2 ? 1.15 : 1.0;
    const r = Math.random();
    // dummy: 목인장(3연타 훈련), ninja: 닌자, oni: 오니 거인, shuriken: 비도/수리검, bomb: 폭탄
    let type = "ninja";
    let hp = 1;

    if (isFeverTime || this.dragonMode) {
      type = r < 0.45 ? "dummy" : r < 0.85 ? "ninja" : "oni";
      hp = type === "oni" ? 2 : 1;
    } else {
      if (r < 0.35) { type = "ninja"; hp = 1; }
      else if (r < 0.58) { type = "dummy"; hp = 2; }
      else if (r < 0.78) { type = "shuriken"; hp = 1; }
      else if (r < 0.90) { type = "oni"; hp = 3; }
      else { type = "bomb"; hp = 1; }
    }

    const speed = (0.22 + elapsed() * 0.005) * waveMult * (type === "oni" ? 0.75 : type === "shuriken" ? 1.35 : 1.0);
    const sx = W * (0.25 + 0.5 * Math.random());
    const sy = H * 0.38;
    const ex = W * (0.12 + 0.76 * Math.random());
    const ey = H * (0.55 + 0.32 * Math.random());

    objs.push({
      type, hp, maxHp: hp, z: 0.05, speed, cool: 0,
      sx, sy, ex, ey, rot: 0, dead: false
    });
  },
  interval: () => Math.max(0.48, 1.15 - elapsed() * 0.01),
  pos(o) { return { x: o.sx + (o.ex - o.sx) * o.z, y: o.sy + (o.ey - o.sy) * o.z }; },
  size(o) {
    const base = Math.min(W, H) * 0.12 * (0.15 + o.z * 1.1);
    if (o.type === "oni") return base * 1.3;
    if (o.type === "shuriken") return base * 0.65;
    if (o.type === "dummy") return base * 1.15;
    return base;
  },
  update(dt) {
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt * 2);
    this.guardTimer = Math.max(0, this.guardTimer - dt);
    this.fx = this.fx.filter((f) => (f.t -= dt) > 0);

    // 1. 가드(Iron Guard) 모션 감지: 양손을 가슴 앞 중앙으로 모았을 때
    this.guardActive = false;
    if (useMouse) {
      if (mouse.down && mouse.x > W * 0.42 && mouse.x < W * 0.58 && mouse.y > H * 0.5) {
        this.guardActive = true;
      }
    } else if (pointers.length >= 2) {
      const p1 = pointers[0], p2 = pointers[1];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (dist < 155 && (p1.y + p2.y) / 2 > H * 0.35) {
        this.guardActive = true;
      }
    }

    // 2. 용오름 각성 피버(Dragon Mode) 관리
    if (this.dragonMode) {
      this.dragonTimer -= dt;
      if (this.dragonTimer <= 0) {
        this.dragonMode = false;
        this.chi = 0;
      }
    } else if (this.chi >= 100 || isFeverTime) {
      this.dragonMode = true;
      this.dragonTimer = 8.0;
      this.chi = 100;
      sfx.kungfuDragon(W / 2);
      popup(W / 2, H * 0.4, "🐉 DRAGON AWAKENING!! 점수 2배!", "#ff5500");
      triggerWaveBanner("🐉 DRAGON AWAKEN!", "기폭발 모드! 타격 점수 2배!", true);
      addShake(0.25, 12);
    }

    // 3. 적 오브젝트 3D 비행 및 타격/가드 판정
    for (const o of objs) {
      if (o.dead) continue;
      o.z += o.speed * dt * (0.5 + o.z * 1.25);
      o.cool -= dt;
      if (o.type === "shuriken") o.rot += dt * 18;

      const c = this.pos(o), r = this.size(o);

      // (A) 철벽 가드 판정: 적이 플레이어 타격 존에 도달했을 때 가드 중이면 방어
      if (this.guardActive && o.z >= 0.85 && o.z <= 1.05) {
        if (o.type === "shuriken" || o.type === "ninja" || o.type === "oni") {
          o.dead = true;
          sfx.kungfuGuard(c.x);
          burst(c.x, c.y, "#ffd166", 24);
          popup(c.x, c.y - 30, "GUARD SUCCESS! 🛡️", "#ffd166");
          award(c.x, c.y, 2, "#ffd166");
          this.chi = Math.min(100, this.chi + 12);
          addShake(0.08, 5);
          continue;
        }
      }

      // (B) 정권 찌르기 & 빠른 타격 판정
      if (!o.dead && o.cool <= 0) {
        for (const p of pointers) {
          const isFistPunch = p.punch && !this.used.has(p.punchId);
          const reachMod = this.dragonMode ? 45 : 0;
          const hitRadius = r * 1.35 + 32 + reach + reachMod;
          const inRange = Math.hypot(p.x - c.x, p.y - c.y) < hitRadius;
          const highSpeedSwipe = p.speed >= 15 && segHitsCircle(p.px, p.py, p.x, p.y, c.x, c.y, r + 10 + reachMod);

          if ((isFistPunch && inRange) || highSpeedSwipe) {
            if (isFistPunch) this.used.add(p.punchId);

            if (o.type === "bomb") {
              o.dead = true;
              score = Math.max(0, score - 3);
              combo = 0;
              burst(c.x, c.y, "#ff3030", 25);
              popup(c.x, c.y, "-3", "#ff5d5d");
              sfx.bomb(c.x);
              speak("앗, 폭탄!");
              break;
            }

            o.hp--;
            o.cool = 0.22;
            const ptsMultiplier = this.dragonMode ? 2 : 1;
            this.fx.push({ x: c.x, y: c.y, t: 0.38, type: o.type });
            this.shake = 0.16;

            if (o.hp <= 0) {
              o.dead = true;
              this.koCount++;
              const basePts = o.type === "oni" ? 4 : o.type === "dummy" ? 3 : 1;
              const pts = basePts * ptsMultiplier;
              award(c.x, c.y - r, pts, "#ffd166");
              burst(c.x, c.y, this.dragonMode ? "#ff5500" : "#ffb347", 22);
              sfx.whack(c.x, o.type === "oni");
              sfx.slice(c.x);

              this.chi = Math.min(100, this.chi + (o.type === "dummy" ? 22 : 14));
              if (o.type === "dummy") {
                popup(c.x, c.y - 45, "COMBO SMASH! 🥋", "#ff9f1c");
              }
            } else {
              burst(c.x, c.y, "#fff", 10);
              sfx.chip(c.x);
            }
            break;
          }
        }
      }

      // (C) 적이 플레이어를 타격(Z >= 1.0)
      if (!o.dead && o.z >= 1) {
        o.dead = true;
        if (o.type !== "bomb") {
          this.lives--;
          this.flash = 1;
          this.shake = 0.3;
          combo = 0;
          this.chi = Math.max(0, this.chi - 25);
          sfx.crash();
          if (this.lives === 1) speak("한 번 더 맞으면 끝이에요!");
          else if (this.lives > 1) speak("앗, 맞았어요!");
          if (this.lives <= 0) { endGame(); return; }
        }
      }
    }
    objs = objs.filter((o) => !o.dead);
  },
  draw() {
    if (this.lives == null) return;
    const cx = W / 2, cy = H * 0.48;

    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);

    // 1. 사이버 도장 배경 & 등불 렌더링
    this.dojoLanterns.forEach((lt, i) => {
      const sway = Math.sin(this.t * 2 + lt.phase) * 8;
      ctx.strokeStyle = "rgba(225, 3, 125, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lt.x, 0);
      ctx.lineTo(lt.x + sway, lt.y);
      ctx.stroke();

      ctx.fillStyle = this.dragonMode ? "#ff5500" : "#e1037d";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(lt.x + sway, lt.y, 14, 0, Math.PI * 2);
      ctx.fill();
    });

    // 도장 바닥 팔괘 원형 링
    ctx.strokeStyle = this.dragonMode ? "rgba(255, 85, 0, 0.35)" : "rgba(0, 210, 255, 0.25)";
    ctx.lineWidth = 3;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx, H * 0.65, Math.min(W, H) * 0.38, 0, Math.PI * 2);
    ctx.stroke();

    // 2. 3D 적 및 타겟 렌더링
    for (const o of [...objs].sort((a, b) => a.z - b.z)) {
      const c = this.pos(o), r = this.size(o);
      Art.drawKungfuFighter(c, r, o);
    }

    // 3. 타격 POW! / CRACK! 이펙트 렌더링
    for (const f of this.fx) {
      const k = 1 - f.t / 0.38;
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.font = `${60 + k * 70}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.dragonMode ? "🔥" : "👊", f.x, f.y);

      ctx.font = `900 ${28 + k * 22}px 'Rubik', sans-serif`;
      ctx.fillStyle = this.dragonMode ? "#ff5500" : "#ffd166";
      ctx.shadowColor = "#ff0055";
      ctx.shadowBlur = 16;
      const hitWord = f.type === "dummy" ? "SMASH!" : f.type === "oni" ? "CRACK!" : "POW!";
      ctx.fillText(hitWord, f.x, f.y - 50 - k * 20);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 1;
    }

    // 4. 철벽 가드(Iron Guard) 활성화 비주얼 쉴드
    if (this.guardActive) {
      ctx.save();
      const guardGrad = ctx.createRadialGradient(cx, H * 0.6, 20, cx, H * 0.6, 170);
      guardGrad.addColorStop(0, "rgba(255, 209, 102, 0.45)");
      guardGrad.addColorStop(0.7, "rgba(255, 150, 0, 0.25)");
      guardGrad.addColorStop(1, "rgba(255, 80, 0, 0)");
      ctx.fillStyle = guardGrad;
      ctx.beginPath();
      ctx.arc(cx, H * 0.6, 170, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 6;
      ctx.shadowColor = "#ffd166";
      ctx.shadowBlur = 25;
      ctx.stroke();

      ctx.font = "900 24px 'Rubik', sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText("🛡️ IRON GUARD ACTIVE", cx, H * 0.6);
      ctx.restore();
    }

    ctx.restore();

    // 5. 기(氣) 게이지 프로그레스 바 & 라이프
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "32px serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(heartsText(this.lives), W / 2, 100);

    // 기 게이지 (화면 상단 가로 바)
    const barW = Math.min(W * 0.45, 340);
    const barH = 14;
    const barX = W / 2 - barW / 2;
    const barY = 115;

    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.strokeRect(barX, barY, barW, barH);

    const chiGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    chiGrad.addColorStop(0, "#ffd166");
    chiGrad.addColorStop(1, "#ff5500");
    ctx.fillStyle = chiGrad;
    ctx.fillRect(barX + 2, barY + 2, (barW - 4) * (this.chi / 100), barH - 4);

    ctx.font = "900 12px 'Rubik', sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`CHI ENERGY ${Math.floor(this.chi)}%`, W / 2, barY + 28);
    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,50,50,${this.flash * 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (this.t < 7) {
      topHud(useMouse ? "적을 클릭해 펀치! 중앙 클릭으로 가드!" : "주먹을 앞으로 쭉! 뻗어 펀치! 양손 모으면 가드!");
    }
  }
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
// 1. 🎵 네온 노트 슬래시 (beat): 비트세이버 정통 게임플레이 디자인 (Body Motion & Parity Flow)
// ============================================================================
games.beat = {
  body: true, bg: "#060312", camAlpha: 0.38, manual: true, // 🎵 오디오 타임스탬프 100% 동기화 엔진 가동
  trail: (p) => (p.x < W / 2 ? "#00d2ff" : "#ff3377"),

  // 🎵 [Audio-Driven Clock] 실제 오디오의 현재 재생 시점을 유일한 단일 기준 시간으로 반환
  getSongTime() {
    if (bgmAudio && !bgmAudio.paused && !isNaN(bgmAudio.currentTime) && bgmAudio.currentTime > 0) {
      return bgmAudio.currentTime;
    }
    if (this.songStartTime > 0 && actx) {
      return Math.max(0, actx.currentTime - this.songStartTime);
    }
    return Math.max(0, elapsed());
  },

  init() {
    // 🎵 유저가 선택한 곡(또는 랜덤 셔플)으로 트랙 확정
    let track = null;
    if (this.chosenTrackId && this.chosenTrackId !== "random") {
      track = BEAT_TRACKS.find((t) => t.id === this.chosenTrackId);
    }
    if (!track) {
      let trackIdx = Math.floor(Math.random() * BEAT_TRACKS.length);
      if (trackIdx === lastBeatTrackIdx) trackIdx = (trackIdx + 1) % BEAT_TRACKS.length;
      lastBeatTrackIdx = trackIdx;
      track = BEAT_TRACKS[trackIdx];
    }
    this.currentTrack = track;
    BGM.beat = { ...this.currentTrack };

    // 곡 시작 네온 배너 알림
    setTimeout(() => {
      popup(W / 2, H * 0.36, `🎵 NOW PLAYING: ${this.currentTrack.title}`, this.currentTrack.tagColor);
      popup(W / 2, H * 0.43, `[${this.currentTrack.genre}]  ${this.currentTrack.bpm} BPM`, "#ffffff");
    }, 250);

    this.halves = [];
    this.walls = [];
    this.sparkRings = []; // 컷팅 충격파 팽창 링 (NotebookLM)
    this.saberTrails = [[], []]; // 듀얼 세이버 네온 잔상 리본 트레일 (PSVR)
    this.laserAngle = 0; // 소실점 회전 레이저 각도
    this.beatFlash = 0; // 비트 싱크 플래시 & 페이드 조명

    this.songStartTime = 0; // 게임 본편 시작 시각 (actx.currentTime)
    this.nextBeatIdx = 0; // 다음에 등장할 소절 박자 인덱스
    this.nextWallBeat = 16; // 벽 장애물 스폰 박자
    this.spawnCount = 0;
    this.lastParity = 0; // 0: 좌팔(Cyan), 1: 우팔(Magenta) 교대 리듬 플로우

    this.lastSwingT = [0, 0];
    this.lastCutT = [0, 0]; // 스윙 모멘텀 쿨다운
    this.prevWrist = [{ x: W * 0.35, y: H * 0.6 }, { x: W * 0.65, y: H * 0.6 }];
    this.wristVel = [{ x: 0, y: 0, spd: 0 }, { x: 0, y: 0, spd: 0 }];
    this.sabers = [
      { base: { x: W * 0.35, y: H * 0.6 }, tip: { x: W * 0.3, y: H * 0.4 } },
      { base: { x: W * 0.65, y: H * 0.6 }, tip: { x: W * 0.7, y: H * 0.4 } }
    ];
    this.swingPower = [0, 0];

    this.energy = 50;
    this.multiplier = 1;
    this.screenShake = 0;
    this.flashColor = null;
  },

  // 🎵 5초 레디타임(카운트다운) 종료 시점에 정확히 0.00초부터 오디오 및 비트 시퀀서 동기화 시작!
  onGameRealStart() {
    this.songStartTime = actx ? actx.currentTime : performance.now() / 1000;
    this.nextBeatIdx = 0;
    this.nextWallBeat = 16;
    objs = []; // 레디타임 잔여물 리셋
    if (bgmAudio && bgmAudio.paused) {
      try {
        const p = bgmAudio.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    }
  },

  // 🎵 [Audio-Driven Note Scheduler] 노래의 실제 오디오 시간(songTime)을 미리 읽어 정확한 박자에 노트 예약 스폰
  scheduleNotes(songTime) {
    if (isReadyTime) return; // 5초 카운트다운 동안에는 사전 생성 대기
    const track = this.currentTrack || BEAT_TRACKS[0];
    const bpm = track.bpm || 132;
    const beatSec = Math.max(0.1, 60 / bpm);
    const firstBeat = track.firstBeat ?? 0.40;
    const approachTime = track.approachTime ?? 1.8;
    const horizonTime = songTime + approachTime;

    // 🛡️ 시간 드리프트 및 음원 루프 자동 보정 (박자 인덱스 재동기화)
    const expectedIdx = Math.max(0, Math.floor((songTime - firstBeat) / beatSec));
    if (this.nextBeatIdx < expectedIdx - 3 || this.nextBeatIdx > expectedIdx + 16) {
      this.nextBeatIdx = Math.max(0, expectedIdx - 1);
    }

    // 큐브 배열이 너무 많이 쌓이지 않도록 안전 캡 유지
    if (objs.length > 28) {
      objs = objs.filter((o) => !o.dead && o.z < 1.25);
    }

    // 최대 16개 박자 앞까지 미래 노트 스케줄링 (무한루프 방지 Guard)
    let loopGuard = 0;
    while (loopGuard++ < 16) {
      // 🎵 노래의 실제 소절 박자 타임스탬프 (Beat Hit Timestamp)
      let hitTime = firstBeat + this.nextBeatIdx * beatSec;

      // 2단계 / 피버 모드에서는 음악의 드럼 리듬에 맞춘 8분음표/당김음 패턴 연동
      if (currentWave === 3) {
        // 피버: 8분음표 고속 리듬
        hitTime = firstBeat + this.nextBeatIdx * (beatSec * 0.5);
      } else if (currentWave === 2 && this.nextBeatIdx % 4 === 2) {
        // 2단계: 경쾌한 당김음 반박자
        hitTime = firstBeat + (this.nextBeatIdx - 0.5) * beatSec;
      }

      // 소실점 시야(approachTime) 바깥의 먼 미래 노트는 다음 프레임에 스폰
      if (hitTime > horizonTime) break;

      // 이미 플레이어 뒤로 지나간 과거 시간이 아니라면 스폰 큐에 등록!
      if (hitTime >= songTime - 0.12) {
        this.spawnNoteAt(hitTime, approachTime);
      }
      this.nextBeatIdx++;
    }

    // 🎵 네온 벽 장애물 (16비트 주기 온몸 좌우 피하기)
    if (this.nextBeatIdx >= this.nextWallBeat) {
      this.nextWallBeat += 16;
      const wallHitTime = firstBeat + this.nextWallBeat * beatSec;
      const wallSide = rng() < 0.5 ? -1 : 1;
      this.walls.push({
        hitTime: wallHitTime,
        approachTime: approachTime * 1.05,
        side: wallSide,
        w: W * 0.38,
        h: H * 0.65,
        dead: false,
        hit: false,
        z: 0.0
      });
    }
  },

  spawnNoteAt(hitTime, approachTime) {
    this.spawnCount++;

    // 1. 네온 스파이크 폭탄 (9개 큐브마다 1개 출현하여 리듬 긴장감 조성)
    const isBomb = this.spawnCount % 9 === 0 && rng() < 0.65;

    // 2. 비트세이버 정통 패리티 플로우: 왼손(0)과 오른손(1)이 교대로 춤추듯 슬래시
    this.lastParity = 1 - this.lastParity;
    const isLeft = this.lastParity === 0;

    // 가로 레인: 0(좌측외곽), 1(좌측센터), 2(우측센터), 3(우측외곽)
    const laneIdx = isLeft ? (rng() < 0.72 ? 1 : 0) : (rng() < 0.72 ? 2 : 3);
    const targetXList = [W * 0.18, W * 0.38, W * 0.62, W * 0.82];
    const targetX = targetXList[laneIdx];

    // 높이 레이어: 상단(머리 위) 30%, 중단(가슴/배) 40%, 하단(허리/아래) 30%
    const heightRand = rng();
    let targetY = H * 0.52; // 중단 기본
    if (heightRand < 0.30) {
      targetY = H * 0.28; // 상단 (만세하듯 위로 올려베기)
    } else if (heightRand > 0.70) {
      targetY = H * 0.74; // 하단 (시원하게 내려베기)
    }

    objs.push({
      hitTime, // 🎵 정확히 이 시점(노래의 박자 순간)에 플레이어 판정선(z=1.0)에 도달!
      approachTime,
      targetX,
      targetY,
      isLeft,
      color: isLeft ? "#00d2ff" : "#ff3377",
      isBomb,
      dead: false,
      cut: false,
      z: 0.0,
      x: W * 0.5,
      y: H * 0.42,
      r: 16
    });
  },

  update(dt) {
    try {
      const judgeZ = 1.0; // 정확히 플레이어 눈앞 판정선
    const now = performance.now();
    const swing = [false, false];
    this.screenShake = Math.max(0, this.screenShake - dt * 3);
    this.beatFlash = Math.max(0, this.beatFlash - dt * 2.8);
    this.laserAngle += dt * 0.95;

    // 🎵 1. 오디오 단일 기준 시간(songTime)을 기준으로 비트 스케줄러 가동
    const songTime = this.getSongTime();
    this.scheduleNotes(songTime);

    // 콤보 배수 계산
    if (combo >= 14) this.multiplier = 8;
    else if (combo >= 6) this.multiplier = 4;
    else if (combo >= 2) this.multiplier = 2;
    else this.multiplier = 1;

    // 전신 포즈 인식 (양팔 세이버 및 스윙 가속도 검출)
    const skel = getBody();
    let headX = W / 2, headY = H * 0.35;

    if (!useMouse && skel) {
      if (skel[0] && (skel[0].v ?? 1) > 0.3) {
        headX = skel[0].x; headY = skel[0].y;
      } else if (skel[11] && skel[12]) {
        headX = (skel[11].x + skel[12].x) / 2;
        headY = (skel[11].y + skel[12].y) / 2 - 60;
      }

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

          // 비트세이버 유효 스윙 가속도(spd > 7.0) 감지
          if (spd > 7.0 && now - this.lastSwingT[i] > 100) {
            swing[i] = true;
            this.lastSwingT[i] = now;
          }
        }
      });
    }

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

      const isMouseSwing = (mouse.down && mSpd > 3) || mSpd > 10;
      if (isMouseSwing && now - this.lastSwingT[0] > 100) {
        swing[0] = true; swing[1] = true;
        this.lastSwingT[0] = now;
      }
    }

    // [PSVR 비트세이버 세이버 리본 트레일 기록]
    [0, 1].forEach((i) => {
      const s = this.sabers[i];
      if (s && s.base && s.tip) {
        this.saberTrails[i].unshift({
          bx: s.base.x, by: s.base.y,
          tx: s.tip.x, ty: s.tip.y
        });
        if (this.saberTrails[i].length > 8) this.saberTrails[i].pop();
      }
    });

    // 2. 네온 벽 장애물 (Walls - 오디오 시간 기준 전진)
    for (const w of this.walls) {
      const timeRem = w.hitTime - songTime;
      w.z = 1.0 - (timeRem / w.approachTime);
      if (!w.dead && w.z >= 0.82 && w.z <= 1.05 && !w.hit) {
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

    // 🎵 3. 큐브 노트: 실제 노래 재생 시간(songTime)에 100% 종속되어 전진 & 칼박 판정!
    const originX = W * 0.5, originY = H * 0.42;
    for (const o of objs) {
      const timeRemaining = o.hitTime - songTime;
      // 🎵 노래 오디오 시간과 수학적으로 0.001초 오차 없이 100% 일치하는 Z 좌표!
      // timeRemaining === 0 (즉 음악에서 쿵! 소리가 울리는 순간) => o.z === 1.0 (정확히 판정선 통과)
      o.z = 1.0 - (timeRemaining / o.approachTime);
      o.x = originX + (o.targetX - originX) * o.z;
      o.y = originY + (o.targetY - originY) * o.z;
      o.r = Math.max(12, 16 + o.z * 52);

      // 판정선 윈도우: 오디오 시간 기준 ±160ms (0.16초) 또는 Z 위치 0.80 ~ 1.12
      const inTimeWindow = Math.abs(timeRemaining) <= 0.16;
      const inZWindow = o.z >= 0.80 && o.z <= 1.12;

      if (!o.dead && !o.cut && inZWindow && inTimeWindow) {
        const handIdx = o.isLeft ? 0 : 1;
        const saber = this.sabers[handIdx];

        // 1. [위치 일치] 광선검 검신 선분 또는 손목이 큐브 위치에 실제로 닿았는가?
        const isSaberTouch = Boolean(saber && saber.base && saber.tip && segHitsCircle(saber.base.x, saber.base.y, saber.tip.x, saber.tip.y, o.x, o.y, o.r + 36));
        const curWrist = (this.prevWrist && this.prevWrist[handIdx]) || { x: W * 0.5, y: H * 0.5 };
        const wristDist = Math.hypot(curWrist.x - o.x, curWrist.y - o.y);
        const isWristTouch = wristDist < (o.r + 42);

        let isInPosition = Boolean(isSaberTouch || isWristTouch);

        if (useMouse) {
          const mDist = Math.hypot(mouse.x - o.x, mouse.y - o.y);
          const mSaberTouch = Boolean((this.sabers && this.sabers[0] && segHitsCircle(this.sabers[0].base.x, this.sabers[0].base.y, this.sabers[0].tip.x, this.sabers[0].tip.y, o.x, o.y, o.r + 36)) ||
                              (this.sabers && this.sabers[1] && segHitsCircle(this.sabers[1].base.x, this.sabers[1].base.y, this.sabers[1].tip.x, this.sabers[1].tip.y, o.x, o.y, o.r + 36)));
          if (mDist < (o.r + 45) || mSaberTouch) isInPosition = true;
        }

        // 2. [스윙 액션] 가만히 대고 있는 것이 아닌, 실제로 칼을 휘두르는 가속도가 실렸는가?
        const wVel = (this.wristVel && this.wristVel[handIdx]) || { spd: 0 };
        const isSwinging = Boolean(swing[handIdx] || wVel.spd > 6.0 || (useMouse && (swing[0] || swing[1])));

        // 3. [모멘텀 쿨다운] 제자리 뱅글뱅글 비비기 방지
        const lastCut = (this.lastCutT && this.lastCutT[handIdx]) || 0;
        const isCooldownOk = (now - lastCut > 110);

        // [A] 네온 폭탄(Bomb) 판정: 폭탄을 치면 대폭발!
        if (o.isBomb) {
          if (isInPosition) {
            o.dead = true;
            this.energy = Math.max(0, this.energy - 12);
            this.screenShake = 0.35;
            this.beatFlash = 0.8;
            combo = 0; this.multiplier = 1;
            sfx.incoming(o.x);
            burst(o.x, o.y, "#ff0055", 35);
            popup(o.x, o.y, "BOMB HIT! 💥 -12", "#ff0055");
          }
        } else {
          // [B] 일반 비트 큐브: 광선검 터치 + 스윙 액션 + 쿨다운 만족 시 통쾌한 절단!
          if (isInPosition && isSwinging && isCooldownOk) {
            if (this.lastCutT) this.lastCutT[handIdx] = now;
            o.dead = true;
            o.cut = true;

            // 🎵 실제 음악 박자와의 시간 오차(밀리초)에 따른 정확도 채점!
            const diffMs = Math.abs(timeRemaining) * 1000;
            const timingScore = diffMs <= 60 ? 35 : (diffMs <= 110 ? 25 : 15);
            const speedScore = Math.min(65, Math.round(35 + (wVel.spd || 0) * 3.2));
            const centerScore = 15;
            const baseScore = speedScore + timingScore + centerScore;
            const finalScore = baseScore * this.multiplier;   // 점수는 아래 award()에서 한 번만 더해짐 (콤보도 award()가 올림)

            this.energy = Math.min(100, this.energy + 2.8);
            this.screenShake = 0.10;
            this.beatFlash = 1.0; // 비트 펄스 조명 즉시 점등!

            sfx.saber(o.x, o.isLeft);
            burst(o.x, o.y, o.color, baseScore >= 105 ? 40 : 26);

            // 컷팅 스파크 팽창 링 생성
            this.sparkRings.push({ x: o.x, y: o.y, r: o.r * 0.3, vr: o.r * 6.5, color: o.color, life: 1.0 });

            const isPerfect = diffMs <= 60;
            award(o.x, o.y, finalScore, isPerfect ? "#ffd700" : o.color);

            const cutLabel = isPerfect ? `PERFECT! +${finalScore} [${this.multiplier}x]` : `SLASH! +${finalScore} [${this.multiplier}x]`;
            popup(o.x, o.y - 40, cutLabel, isPerfect ? "#ffd700" : o.color);

            // 입체 회전 물리 파편 (Halves)
            this.halves.push(
              { x: o.x - 14, y: o.y, r: o.r, color: o.color, vx: -8, vy: -4, rot: 0, vRot: -0.25, half: -1, life: 1 },
              { x: o.x + 14, y: o.y, r: o.r, color: o.color, vx: 8, vy: -3, rot: 0, vRot: 0.22, half: 1, life: 1 }
            );
          }
        }
      }

      // 판정선 완전히 지나쳐 놓침 (MISS) - 음악 시간 기준 180ms 초과 시
      if (!o.dead && !o.cut && (timeRemaining < -0.18 || o.z > 1.15)) {
        o.dead = true;
        if (!o.isBomb) {
          combo = 0;
          this.multiplier = 1;
          this.energy = Math.max(0, this.energy - 7);
          popup(o.x, o.y, "MISS (1x)", "#ff3366");
        }
      }
    }

    objs = objs.filter((o) => !o.dead && o.z < 1.35);

    // 충격파 링 시뮬레이션
    if (this.sparkRings.length > 20) this.sparkRings = this.sparkRings.slice(-15);
    for (const ring of this.sparkRings) {
      ring.r += ring.vr * dt;
      ring.life -= dt * 2.5;
    }
    this.sparkRings = this.sparkRings.filter((r) => r.life > 0);

    // 쪼개진 큐브 반쪽 파편 물리 이동 & 회전
    if (this.halves.length > 25) this.halves = this.halves.slice(-20);
    for (const h of this.halves) {
      h.x += h.vx; h.y += h.vy; h.vy += dt * 32;
      h.rot += (h.vRot || 0) * dt * 45;
      h.life -= 0.04;
    }
    this.halves = this.halves.filter((h) => h.life > 0);
    } catch (err) {
      console.warn("Beat update error:", err);
    }
  },
  draw() {
    try {
      const originX = W * 0.5, originY = H * 0.42;

    ctx.save();
    if (this.screenShake > 0) {
      ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    }

    // 1. 비트 펄스 네온 타격 가이드 라인 (Stitch 3D 터널 위의 라이트닝 스트라이크 존)
    const flashAlpha = 0.45 + this.beatFlash * 0.4;
    ctx.strokeStyle = isFeverTime ? "#ff0055" : `rgba(0, 210, 255, ${flashAlpha})`;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(W * 0.08, H * 0.32); ctx.lineTo(W * 0.92, H * 0.32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.05, H * 0.54); ctx.lineTo(W * 0.95, H * 0.54); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.08, H * 0.74); ctx.lineTo(W * 0.92, H * 0.74); ctx.stroke();

    // 2. 네온 벽 장애물 (Walls) 렌더링
    for (const w of this.walls) {
      const scale = w.z;
      const wallW = w.w * scale, wallH = w.h * scale;
      const wallX = w.side < 0 ? (W * 0.2 - wallW * 0.5) : (W * 0.8 - wallW * 0.5);
      const wallY = H * 0.48 - wallH * 0.4;

      ctx.save();
      ctx.fillStyle = w.hit ? "rgba(255, 51, 102, 0.45)" : "rgba(255, 30, 80, 0.25)";
      ctx.strokeStyle = "#ff2266"; ctx.lineWidth = 4;
      ctx.fillRect(wallX, wallY, wallW, wallH);
      ctx.strokeRect(wallX, wallY, wallW, wallH);

      ctx.fillStyle = "#ffffff";
      ctx.font = "900 20px 'Rubik', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("DODGE! ⚠️", wallX + wallW / 2, wallY + 30);
      ctx.restore();
    }

    // 3. 3D 입체 큐브 및 네온 폭탄 렌더링 (Z축 깊이 순)
    const sorted = [...objs].sort((a, b) => a.z - b.z);
    for (const o of sorted) {
      if (o.isBomb) {
        Art.drawNeonBomb(o.x, o.y, o.r);
      } else {
        Art.drawBeatNote(o.x, o.y, o.r, o.color, 0);
      }
    }
    // 잘린 큐브 파편 렌더링
    for (const h of this.halves) {
      ctx.save(); ctx.globalAlpha = Math.max(h.life, 0);
      Art.drawBeatNote(h.x, h.y, h.r, h.color, h.half, h.rot || 0);
      ctx.restore();
    }

    // 4. 컷팅 충격파 팽창 링 FX (고속 가산 블렌딩)
    for (const ring of this.sparkRings) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ring.life);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(1.5, 4 * ring.life);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 5. 전신 포즈 스켈레톤
    const skel = getBody();
    if (!useMouse && skel) {
      drawSkeleton(skel, "rgba(0, 210, 255, 0.45)", 0.6);
    }

    // 6. 🌟 [PSVR 세이버 잔상 리본 트레일 (Saber Ribbon Trails)]
    const saberCols = ["#00d2ff", "#ff3377"];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    [0, 1].forEach((i) => {
      const trail = this.saberTrails[i];
      if (!trail || trail.length < 2) return;
      const col = saberCols[i];
      for (let k = 0; k < trail.length - 1; k++) {
        const p1 = trail[k], p2 = trail[k + 1];
        const alpha = (1 - k / trail.length) * 0.45;
        ctx.fillStyle = col;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(p1.bx, p1.by);
        ctx.lineTo(p1.tx, p1.ty);
        ctx.lineTo(p2.tx, p2.ty);
        ctx.lineTo(p2.bx, p2.by);
        ctx.closePath();
        ctx.fill();
      }
    });
    ctx.restore();

    // 7. 🌟 [PSVR 듀얼 라이트세이버 블레이드 렌더링 - 60FPS 고속 2-Pass 네온]
    this.sabers.forEach((s, i) => {
      if (!s || !s.base || !s.tip) return;
      const col = saberCols[i];
      ctx.save();

      // 손잡이 (Hilt)
      const dx = s.tip.x - s.base.x, dy = s.tip.y - s.base.y;
      const len = Math.hypot(dx, dy) || 1;
      const hiltLen = 22;
      const hx = s.base.x - (dx / len) * hiltLen, hy = s.base.y - (dy / len) * hiltLen;
      ctx.strokeStyle = "#3a4055"; ctx.lineWidth = 9; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(s.base.x, s.base.y); ctx.stroke();

      // 가드 이미터
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(s.base.x, s.base.y, 6, 0, Math.PI * 2); ctx.fill();

      // 초고속 2-Pass 플라즈마 블레이드 (shadowBlur 0ms 완전 대체)
      // 외곽 넓은 네온 글로우 빔
      ctx.strokeStyle = col === "#00d2ff" ? "rgba(0, 210, 255, 0.45)" : "rgba(255, 51, 119, 0.45)";
      ctx.lineWidth = 18; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(s.base.x, s.base.y); ctx.lineTo(s.tip.x, s.tip.y); ctx.stroke();

      // 중간 네온 메인 빔
      ctx.strokeStyle = col; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(s.base.x, s.base.y); ctx.lineTo(s.tip.x, s.tip.y); ctx.stroke();

      // 내부 고열 순백색 코어
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(s.base.x, s.base.y); ctx.lineTo(s.tip.x, s.tip.y); ctx.stroke();
      ctx.restore();
    });

    ctx.restore(); // screenShake restore
    bodyHint();
    } catch (err) {
      console.warn("Beat draw error:", err);
    }
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
// 4. 🥊 🥋 스피드 펀치 & 킥 복싱 백 (box): 양손 주먹 + 전신 발차기 온몸 타격 액션 모드
// ============================================================================
games.box = {
  body: true, // 🥋 온몸 게임 전환: 전신 관절(포즈 33개 관절) 추적 활성화
  bg: "#160714", camAlpha: 0.45, manual: true,
  trail: "#ff4b72",
  init() {
    this.tilt = 0;
    this.tiltVel = 0;
    // 주먹별 펀치 궤도 FSM 상태 머신 (IDLE -> PUNCH -> RETRACT)
    this.fistFSM = Array.from({ length: 4 }, () => newPunchState());
    // 양발 킥 전용 FSM 상태 머신 (0: 왼발, 1: 오른발)
    this.kickFSM = [newPunchState(), newPunchState()];
    this.prevAnkles = [
      { x: 0, y: 0, vy: 0, spd: 0 },
      { x: 0, y: 0, vy: 0, spd: 0 }
    ];
    this.recentKicks = []; // 발차기 타격 이펙트 링 목록
    this.mouseCool = 0;
    this.flash = 0;
    this.punches = 0;
    this.kicks = 0;
    this.shake = 0;
    this.targets = [];
    this.beatTimer = 0;
    this.beatInterval = 0.70; // 음악 비트 타격 큐
  },
  update(dt) {
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.tiltVel -= this.tilt * 45 * dt;
    this.tiltVel *= 0.93;
    this.tilt += this.tiltVel * dt;

    const bw = 175, bh = Math.min(H * 0.52, 335);
    const cx = W / 2, cy = H * 0.48;

    // 1. 리듬 타격 비트 큐 생성 (LEFT / RIGHT 펀치 & 킥 유도)
    this.beatTimer += dt;
    if (this.beatTimer >= this.beatInterval) {
      this.beatTimer = 0;
      const isLeft = Math.random() < 0.5;
      const isKickTarget = Math.random() < 0.35; // 35% 확률로 강력한 킥 타겟 등장!
      let targetText = "";
      if (isKickTarget) {
        targetText = isLeft ? "LEFT KICK! 🥋" : "RIGHT KICK! 🥋";
      } else {
        targetText = isLeft ? "LEFT JAB 🥊" : "RIGHT STRAIGHT 🥊";
      }
      this.targets.push({
        t: 0, maxT: 0.85, isLeft, isKick: isKickTarget,
        text: targetText,
        color: isKickTarget ? "#ffd700" : (isLeft ? "#00d2ff" : "#ff4b72"),
        hit: false
      });
    }

    // 2. 피트니스 섀도우 복싱 펀치 & 킥 모션 엔진
    let strikeOccurred = false;
    let strikeSideLeft = true;
    let strikeIntensity = 1.0;
    let isKickStrike = false;
    let kickLabel = "POWER KICK";
    let strikeX = cx, strikeY = cy;

    // 마우스 모드: 클릭 또는 빠른 스와이프 (우클릭 또는 하단 클릭 시 킥 시뮬레이션)
    if (useMouse) {
      this.mouseCool = Math.max(0, this.mouseCool - dt);
      if (mouse.down && this.mouseCool <= 0) {
        this.mouseCool = 0.15;
        strikeOccurred = true;
        strikeSideLeft = mouse.x < W / 2;
        const isMouseKick = mouse.y > H * 0.65;
        if (isMouseKick) {
          isKickStrike = true;
          kickLabel = mouse.y < H * 0.45 ? "HIGH KICK" : "POWER KICK";
          strikeIntensity = 2.0;
        } else {
          strikeIntensity = 1.2;
        }
        strikeX = mouse.x; strikeY = mouse.y;
      }
    }

    // 웹캠 손인식: 양손 펀치 궤도 & 가속도 피크(Peak Acceleration) 판정
    pointers.forEach((p, i) => {
      const fsm = this.fistFSM[i] ?? (this.fistFSM[i] = newPunchState());
      const isLeftFist = p.x < W / 2;
      const hit = stepPunch(fsm, p.vps ?? p.speed * 60, !!p.punch, dt, Math.min(W, H));
      if (hit.strike) {
        strikeOccurred = true;
        strikeSideLeft = isLeftFist;
        strikeIntensity = hit.intensity;
        isKickStrike = false;
        strikeX = p.x; strikeY = p.y;
      }
    });

    // 🥋 [핵심 추가] 웹캠 전신 포즈 인식: 양발 발차기(로우킥 / 미들킥 / 하이킥) 궤도 & 급상승 가속도 판정
    const skel = getBody();
    if (!useMouse && skel) {
      const legs = [
        { ankle: 27, knee: 25, heel: 29, foot: 31, isLeft: true },
        { ankle: 28, knee: 26, heel: 30, foot: 32, isLeft: false }
      ];

      legs.forEach((leg, idx) => {
        const ank = skel[leg.ankle];
        const knee = skel[leg.knee];
        const prev = this.prevAnkles[idx];

        if (ank && (ank.v ?? 1) > 0.22) {
          const dtClamped = Math.max(dt, 0.016);
          const vx = (ank.x - prev.x) / dtClamped;
          const vy = (ank.y - prev.y) / dtClamped;
          const kickSpd = Math.hypot(vx, vy);

          this.prevAnkles[idx] = { x: ank.x, y: ank.y, vy, spd: kickSpd };

          // 발차기 감지 조건:
          // 1) 발목이 순간적으로 강하게 솟구치거나 (vy < -280)
          // 2) 발목의 속도가 기준치 이상으로 폭발적일 때 (kickSpd > 380)
          // 3) 발의 위치가 무릎 위로 올라오거나 샌드백 반경 내에 진입
          const fsm = this.kickFSM[idx] ?? (this.kickFSM[idx] = newPunchState());
          const isKickingMotion = vy < -240 || kickSpd > 350;
          const kickHit = stepPunch(fsm, kickSpd, isKickingMotion, dt, Math.min(W, H));

          // 샌드백과의 근접성 및 모션 방향 검사
          const distToBag = Math.abs(ank.x - cx);
          const isNearBag = distToBag < bw * 1.3 && ank.y < (cy + bh * 0.65);

          if ((kickHit.strike || (isKickingMotion && isNearBag)) && fsm.state === "punch") {
            strikeOccurred = true;
            strikeSideLeft = leg.isLeft;
            isKickStrike = true;
            strikeX = ank.x; strikeY = ank.y;

            // 차올린 높이에 따라 하이킥 / 파워킥 세분화 판정
            if (ank.y < cy) {
              kickLabel = "HIGH KICK";
              strikeIntensity = Math.max(2.4, kickHit.intensity * 1.8);
            } else {
              kickLabel = "POWER KICK";
              strikeIntensity = Math.max(1.9, kickHit.intensity * 1.4);
            }

            // 시각적 발차기 잔상 등록
            this.recentKicks.push({
              x: ank.x, y: ank.y,
              t: 0.45,
              label: kickLabel,
              color: leg.isLeft ? "#00d2ff" : "#ff4b72"
            });
          }
        }
      });
    }

    // 3. 타격(펀치 or 킥) 임팩트 발동 및 샌드백 물리 반응
    if (strikeOccurred) {
      this.punches++;
      if (isKickStrike) this.kicks++;

      // 타이밍 리듬 비트 타겟과 일치 검사 (LEFT / RIGHT & 펀치/킥 일치 여부)
      const currentTarget = this.targets.find(
        (tg) => !tg.hit && tg.t >= 0.65 && tg.t <= 1.05 && tg.isLeft === strikeSideLeft
      );
      let perfect = false;

      if (currentTarget) {
        currentTarget.hit = true;
        perfect = true;
        const pts = Math.round(isKickStrike ? 4 * strikeIntensity : 3 * strikeIntensity);
        award(cx, cy - 60, pts, "#ffd700");
        const hitMsg = isKickStrike ? `PERFECT ${kickLabel}!! ⚡ +${pts}` : `PERFECT HIT!! 💥 +${pts}`;
        popup(cx, cy - 90, hitMsg, "#ffd700");
        addShake(isKickStrike ? 0.16 : 0.08, isKickStrike ? 9 : 5);
      } else {
        if (isKickStrike) {
          const pts = Math.round(2 * strikeIntensity);
          award(cx, cy - 30, pts, "#ffd166");
          popup(cx, cy - 75, `⚡ ${kickLabel}!! 🥋 +${pts}`, "#ffd166");
          addShake(0.12, 7);
        } else {
          const pts = strikeIntensity > 1.6 ? 2 : 1;
          award(cx, cy, pts, strikeSideLeft ? "#00d2ff" : "#ff4b72");
          if (strikeIntensity > 1.6) {
            popup(cx, cy - 70, `HEAVY PUNCH!! 🥊 +2`, strikeSideLeft ? "#00d2ff" : "#ff4b72");
            addShake(0.06, 4);
          }
        }
      }

      // 사운드: 발차기는 묵직한 중저음 베이스 타격음 동시 재생
      if (isKickStrike) {
        sfx.hitHeavy(cx);
        sfx.bagPunch(cx, perfect);
      } else if (this.punches >= 20 || isFeverTime) {
        sfx.punchRush(this.punches);
      } else {
        sfx.bagPunch(cx, perfect);
      }

      // 샌드백 물리 틸트: 발차기는 펀치 대비 1.7배 더 묵직하게 회전!
      const tiltDir = strikeSideLeft ? 1 : -1;
      const kickTiltMult = isKickStrike ? 1.7 : 1.0;
      this.tiltVel += tiltDir * (perfect ? 0.58 : 0.40) * strikeIntensity * kickTiltMult;
      if (this.flash < 0.3) this.flash = isKickStrike ? 0.95 : 0.8;
      this.shake = isKickStrike ? 0.14 : (perfect ? 0.12 : (strikeIntensity > 1.6 ? 0.08 : 0));

      // 샌드백 타격점에 화려한 파티클 버스트 (발차기는 대량의 황금 불꽃 버스트)
      const impactCol = isKickStrike ? "#ffd166" : (strikeSideLeft ? "#00d2ff" : "#ff4b72");
      burst(cx + tiltDir * 24, cy + (isKickStrike ? 40 : 0), perfect ? "#ffd700" : impactCol, isKickStrike ? 40 : (perfect ? 32 : 18));

      if (this.punches % 20 === 0) speak(`${this.punches} 타격 달성! 불타오르는 콤보 러시!`, true);
    }

    // 발차기 이펙트 링 갱신
    for (let i = this.recentKicks.length - 1; i >= 0; i--) {
      const rk = this.recentKicks[i];
      rk.t -= dt;
      if (rk.t <= 0) this.recentKicks.splice(i, 1);
    }

    // 타겟 진행 및 소멸
    for (const tg of this.targets) tg.t += dt / tg.maxT;
    this.targets = this.targets.filter((tg) => tg.t <= 1.15);
  },
  draw() {
    const cx = W / 2, cy = H * 0.48;
    const bw = 175, bh = Math.min(H * 0.52, 335);

    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);

    // 1. 샌드백 본체 렌더링
    Art.drawPunchBag(cx, cy, bw, bh, this.tilt, this.flash);

    // 2. 리듬 타격 링 & 비트 큐 (LEFT / RIGHT 펀치 & 킥 안내)
    for (const tg of this.targets) {
      if (tg.hit) continue;
      const scale = Math.max(0.2, 1.8 - tg.t * 0.8);
      const alpha = Math.min(1, Math.max(0, 1 - Math.abs(tg.t - 0.85) * 2));
      ctx.save();
      ctx.strokeStyle = tg.color;
      ctx.lineWidth = tg.isKick ? 8 : 6;
      ctx.shadowColor = tg.color;
      ctx.shadowBlur = tg.isKick ? 24 : 18;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, (tg.isKick ? 95 : 85) * scale, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = "900 28px 'Rubik', sans-serif";
      ctx.fillStyle = tg.color; ctx.textAlign = "center";
      ctx.fillText(tg.text, cx, cy - 95 * scale);
      ctx.restore();
    }
    ctx.restore();

    // 3. 발차기 타격 궤적 & 이펙트 링 렌더링
    this.recentKicks.forEach((rk) => {
      const alpha = Math.max(0, rk.t / 0.45);
      const rad = (1 - alpha) * 110 + 30;
      ctx.save();
      ctx.strokeStyle = rk.color;
      ctx.lineWidth = 6 * alpha;
      ctx.shadowColor = rk.color;
      ctx.shadowBlur = 20;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(rk.x, rk.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    // 4. 플레이어 복싱 글러브 렌더링 (자신의 주먹 궤적 실시간 확인)
    pointers.forEach((p, i) => {
      const isLeft = p.x < W / 2;
      ctx.save();
      ctx.font = "46px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🥊", p.x, p.y);
      ctx.restore();
    });

    // 5. 🥋 발목/발끝 킥 트래커 렌더링 (발의 실시간 위치 및 킥 마크 표시)
    const skel = getBody();
    if (!useMouse && skel) {
      [27, 28].forEach((ankIdx) => {
        const ank = skel[ankIdx];
        if (ank && (ank.v ?? 1) > 0.22) {
          const isLeft = ankIdx === 27;
          const col = isLeft ? "#00d2ff" : "#ff4b72";
          ctx.save();
          ctx.strokeStyle = col;
          ctx.lineWidth = 3.5;
          ctx.shadowColor = col;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(ank.x, ank.y, 24, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = "26px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("🥋", ank.x, ank.y);
          ctx.restore();
        }
      });
    }

    if (useMouse) {
      ctx.save();
      ctx.font = "46px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(mouse.y > H * 0.65 ? "🥋" : "🥊", mouse.x, mouse.y);
      ctx.restore();
    }
  }
};

// ============================================================================
// ============================================================================
// ⚾ 네온 슬램 야구 (NEON SLAM BASEBALL) - 듀얼 분할 화면 & 커스튬 타자 캐릭터 엔진
// ============================================================================
games.baseball = {
  body: true, // 🧍 온몸 피트니스 배팅 모드: 전신 포즈 인식 활성화
  bg: "#07111e",
  camAlpha: 0.35,
  trail: "#00d2ff",
  init() {
    this.hits = 0;
    this.homeRuns = 0;
    this.maxDist = 0;
    this.strikes = 0;
    this.batSpeed = 0;
    this.isSwinging = false;
    this.swingTimer = 0;
    this.batAngle = -0.6;
    this.flightBalls = []; // 홈런/안타로 장외로 날아가는 타구 목록
    this.flash = 0;
    this.stadiumCheer = 0;
    this.swingTrail = []; // 배트 스윙 궤적 네온 잔상

    // 듀얼 분할 기준 좌표: 화면 너비의 60%를 좌측 야구장, 40%를 우측 웹캠 모션 뷰로 분할
    this.fieldRatio = 0.60;
  },
  spawn() {
    const fieldW = Math.floor(W * this.fieldRatio);
    const waveMult = currentWave === 3 ? 1.35 : currentWave === 2 ? 1.15 : 1.0;
    const baseSpd = 0.30 + elapsed() * 0.005;
    const speed = baseSpd * waveMult;

    // 0: 직구(Fastball), 1: 슬라이더(Slider), 2: 커브(Curve), 3: 체인지업(Changeup), 4: 골든파이어볼(Fever)
    const pitchType = isFeverTime ? "fire" : ["fast", "curve", "slider", "change"][(Math.random() * 4) | 0];

    // 투구는 좌측 경기장의 중앙 마운드에서 홈플레이트로 날아옴
    const fieldCx = fieldW * 0.52;
    const moundX = fieldCx + (Math.random() - 0.5) * 26;
    const moundY = H * 0.40;
    const plateX = fieldCx + (Math.random() - 0.5) * 90;
    const plateY = H * 0.76 + (Math.random() - 0.5) * 45;

    objs.push({
      z: 0.05,
      speed,
      type: pitchType,
      moundX, moundY,
      plateX, plateY,
      x: moundX,
      y: moundY,
      r: 14,
      rot: 0,
      hit: false,
      dead: false,
      resolved: false
    });
  },
  interval: () => Math.max(0.75, 1.45 - elapsed() * 0.012),
  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 2);
    this.stadiumCheer = Math.max(0, this.stadiumCheer - dt);
    this.swingTimer = Math.max(0, this.swingTimer - dt);
    if (this.swingTimer <= 0) this.isSwinging = false;

    const fieldW = Math.floor(W * this.fieldRatio);
    const fieldCx = fieldW * 0.52;
    const plateX = fieldCx;
    const plateY = H * 0.76;

    // 1. 플레이어 모션 인식: 상체 & 양팔 배팅 폼 및 스윙 가속도 산출
    let curSpeed = 0;
    let swingImpulse = false;
    const skel = getBody();

    if (useMouse) {
      curSpeed = mouse.speed || (mouse.down ? 25 : 0);
      if (mouse.down && !this.isSwinging) {
        swingImpulse = true;
        this.isSwinging = true;
        this.swingTimer = 0.25;
        this.batSpeed = Math.floor(105 + Math.random() * 45);
      }
    } else if (skel && (skel[15] || skel[16])) {
      // 🧍 몸 게임 포즈 기반: 손목(15, 16) 및 팔꿈치(13, 14) 가속도 판정
      const leftWrist = skel[15], rightWrist = skel[16];
      let maxWristSpeed = 0;

      if (leftWrist && (leftWrist.v ?? 1) > 0.25) {
        const p0 = pointers.find((p) => p.x === leftWrist.x) || pointers[0];
        maxWristSpeed = Math.max(maxWristSpeed, p0?.vps ?? (p0?.speed ? p0.speed * 60 : 0));
      }
      if (rightWrist && (rightWrist.v ?? 1) > 0.25) {
        const p1 = pointers.find((p) => p.x === rightWrist.x) || pointers[1] || pointers[0];
        maxWristSpeed = Math.max(maxWristSpeed, p1?.vps ?? (p1?.speed ? p1.speed * 60 : 0));
      }

      curSpeed = maxWristSpeed || (pointers[0] ? pointers[0].speed * 45 : 0);

      // 손 이동 속도 피크 또는 스윙 제스처 감지 시 스윙 발동!
      const swingThreshold = 320.0;
      if (curSpeed > swingThreshold && !this.isSwinging) {
        swingImpulse = true;
        this.isSwinging = true;
        this.swingTimer = 0.26;
        this.batSpeed = Math.min(170, Math.floor(85 + (curSpeed / 500) * 85));
      }
    } else if (pointers.length > 0) {
      curSpeed = pointers[0].vps ?? (pointers[0].speed * 60);
      if (curSpeed > 280 && !this.isSwinging) {
        swingImpulse = true;
        this.isSwinging = true;
        this.swingTimer = 0.25;
        this.batSpeed = Math.min(160, Math.floor(80 + curSpeed * 0.18));
      }
    }

    if (swingImpulse) {
      sfx.batSwing(fieldCx);
      addShake(0.06, 5);
    }

    // 2. 날아오는 투구 3D 물리 업데이트 및 타격 판정
    const batHitX = plateX, batHitY = plateY - 12;
    const batReach = 90 + reach;

    for (const b of objs) {
      if (b.dead || b.hit) continue;

      let curveOffset = 0;
      if (b.type === "slider") curveOffset = Math.sin(b.z * Math.PI) * 55;
      else if (b.type === "curve") curveOffset = -Math.sin(b.z * Math.PI) * 55;
      else if (b.type === "change") curveOffset = Math.sin(b.z * Math.PI * 2) * 20;

      const spdFactor = b.type === "fast" ? 1.25 : b.type === "change" ? 0.85 : 1.0;
      b.z += b.speed * spdFactor * dt * (0.8 + b.z * 1.5);
      b.x = b.moundX + (b.plateX - b.moundX) * b.z + curveOffset;
      b.y = b.moundY + (b.plateY - b.moundY) * b.z;
      b.r = 10 + b.z * 46;
      b.rot += 0.15;

      // 타격 판정 존: b.z가 홈플레이트 부근(0.82 ~ 1.08)일 때
      if (!b.resolved && b.z >= 0.82 && b.z <= 1.08) {
        const dist = Math.hypot(b.x - batHitX, b.y - batHitY);

        if (this.isSwinging && dist < batReach + b.r) {
          b.hit = true;
          b.resolved = true;
          this.hits++;

          const timingAccuracy = 1 - Math.abs(b.z - 0.95) / 0.13;
          const centerAccuracy = 1 - Math.min(1, dist / (batReach + b.r));
          const hitPower = timingAccuracy * 0.6 + centerAccuracy * 0.4;

          if (hitPower > 0.60 || b.type === "fire") {
            // 🚀 PERFECT HOME RUN!!
            this.homeRuns++;
            const launchDist = Math.floor(130 + hitPower * 40 + (this.batSpeed - 80) * 0.38);
            this.maxDist = Math.max(this.maxDist, launchDist);
            const pts = b.type === "fire" ? 250 : 160;
            award(b.x, b.y, pts, "#00d2ff");
            sfx.homeRun(b.x);
            burst(b.x, b.y, "#00d2ff", 42);
            burst(b.x, b.y, "#ffd166", 28);
            popup(b.x, b.y - 70, `🚀 HOME RUN!! ${launchDist}m`, "#00d2ff");
            triggerWaveBanner("🚀 HOME RUN!", `${launchDist}M 장외 홈런!`, false);
            this.stadiumCheer = 1.3;
            this.flash = 1.0;
            addShake(0.24, 15);

            this.flightBalls.push({
              x: b.x, y: b.y,
              vx: (b.x - fieldCx) * 1.8 - 40,
              vy: -780 - hitPower * 260,
              r: b.r,
              color: "#00d2ff",
              dist: launchDist,
              t: 0
            });
          } else if (hitPower > 0.35) {
            // ⚡ GREAT HIT! (안타)
            const pts = 85;
            award(b.x, b.y, pts, "#ffd166");
            sfx.hitHeavy(b.x);
            burst(b.x, b.y, "#ffd166", 22);
            popup(b.x, b.y - 45, "GREAT HIT! ⚡", "#ffd166");
            addShake(0.10, 6);

            this.flightBalls.push({
              x: b.x, y: b.y,
              vx: (b.x - fieldCx) * 2.6 - 20,
              vy: -500,
              r: b.r * 0.8,
              color: "#ffd166",
              dist: Math.floor(75 + hitPower * 35),
              t: 0
            });
          } else {
            // ⚾ FOUL BALL (파울)
            award(b.x, b.y, 25, "#94a3b8");
            sfx.chip(b.x);
            popup(b.x, b.y - 35, "FOUL 💨", "#94a3b8");
          }
        }
      }

      if (!b.resolved && b.z > 1.08) {
        b.resolved = true;
        b.dead = true;
        this.strikes++;
        combo = 0;
        sfx.hitHeavy(b.x);
        popup(b.x, b.y, "STRIKE! ❌", "#ff4d5e");
      }
    }

    for (let i = this.flightBalls.length - 1; i >= 0; i--) {
      const fb = this.flightBalls[i];
      fb.t += dt;
      fb.x += fb.vx * dt;
      fb.y += fb.vy * dt;
      fb.vy += 800 * dt;
      fb.r = Math.max(4, fb.r * 0.985);
      if (fb.y > H + 50 || fb.t > 2.0) {
        this.flightBalls.splice(i, 1);
      }
    }
  },
  draw() {
    const fieldW = Math.floor(W * this.fieldRatio);
    const camW = W - fieldW;
    const camX = fieldW;

    // ========================================================================
    // 🏟️ [VIEWPORT 1] 좌측: 3D 야구 경기장 & 커스튬 장착 타자 캐릭터
    // ========================================================================
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, fieldW, H);
    ctx.clip(); // 좌측 화면으로 렌더링 영역 제한

    const cx = fieldW * 0.52, cy = H * 0.76;

    // 1. 경기장 그라운드 & 조명
    const stadiumBg = ctx.createLinearGradient(0, 0, 0, H);
    stadiumBg.addColorStop(0, "#06101e");
    stadiumBg.addColorStop(0.45, "#0b203a");
    stadiumBg.addColorStop(1, "#0d281e");
    ctx.fillStyle = stadiumBg;
    ctx.fillRect(0, 0, fieldW, H);

    // 외야 펜스 & 네온 라이트
    const fenceGrad = ctx.createLinearGradient(0, H * 0.22, 0, H * 0.50);
    fenceGrad.addColorStop(0, "rgba(0, 210, 255, 0.12)");
    fenceGrad.addColorStop(1, "rgba(7, 17, 30, 0)");
    ctx.fillStyle = fenceGrad;
    ctx.fillRect(0, H * 0.22, fieldW, H * 0.30);

    for (let i = 0; i < 6; i++) {
      const lx = fieldW * (0.12 + i * 0.15);
      const ly = H * 0.32;
      const col = i % 2 === 0 ? "#00d2ff" : "#ffd166";
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = this.stadiumCheer > 0 ? 30 : 12;
      ctx.beginPath();
      ctx.arc(lx, ly, this.stadiumCheer > 0 ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 야구장 내야 다이아몬드 라인
    ctx.strokeStyle = "rgba(0, 210, 255, 0.45)";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.40);
    ctx.lineTo(cx + fieldW * 0.32, H * 0.62);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - fieldW * 0.32, H * 0.62);
    ctx.closePath();
    ctx.stroke();

    // 1루, 2루, 3루 베이스
    const drawBase = (bx, by) => {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#00d2ff";
      ctx.shadowBlur = 10;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
    };
    drawBase(cx + fieldW * 0.32, H * 0.62);
    drawBase(cx - fieldW * 0.32, H * 0.62);
    drawBase(cx, H * 0.40);

    // 투수 마운드
    ctx.strokeStyle = "rgba(255, 209, 102, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.42, 34, 15, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 홈플레이트
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 20);
    ctx.lineTo(cx - 22, cy - 5);
    ctx.lineTo(cx - 22, cy - 18);
    ctx.lineTo(cx + 22, cy - 18);
    ctx.lineTo(cx + 22, cy - 5);
    ctx.closePath();
    ctx.fill();

    // 좌/우 타자 배터 박스
    ctx.strokeStyle = "rgba(0, 210, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 72, cy - 35, 38, 70); // 좌타석 (플레이어 타자 위치)
    ctx.strokeRect(cx + 34, cy - 35, 38, 70);

    // 스트라이크 존 가이드
    ctx.strokeStyle = "rgba(0, 210, 255, 0.28)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 50, cy - 125, 100, 95);

    // 2. 투구(야구공) 렌더링
    for (const b of objs) {
      if (b.dead || b.hit) continue;

      ctx.save();
      ctx.translate(b.x, b.y);

      const tailColor = b.type === "fire" ? "#ff4b72" : b.type === "slider" ? "#a855f7" : "#00d2ff";
      ctx.fillStyle = tailColor;
      ctx.shadowColor = tailColor;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 1.25, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ff3344";
      ctx.lineWidth = Math.max(1.5, b.r * 0.16);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(-b.r * 0.45, 0, b.r * 0.65, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.r * 0.45, 0, b.r * 0.65, Math.PI - 0.9, Math.PI + 0.9);
      ctx.stroke();

      ctx.restore();
    }

    // 3. 장외로 날아가는 타구(홈런/안타) 렌더링
    this.flightBalls.forEach((fb) => {
      ctx.save();
      ctx.fillStyle = fb.color;
      ctx.shadowColor = fb.color;
      ctx.shadowBlur = 25;
      ctx.beginPath();
      ctx.arc(fb.x, fb.y, fb.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // ========================================================================
    // 👤 [핵심 기능] 내 움직임에 의해 방망이를 휘두르는 타자 아바타 & 커스튬 100% 장착
    // ========================================================================
    const batterX = cx - 52;
    const batterY = cy;
    this.drawBatterWithCostumes(ctx, batterX, batterY);

    // 하단 스탯 텍스트 (좌측 뷰포트 내)
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 16px 'Rubik', sans-serif";
    ctx.fillStyle = "#00d2ff";
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 8;
    ctx.fillText(`⚡ BAT SPEED: ${this.batSpeed || 95} KM/H  |  LONGEST: ${this.maxDist}M  |  HOMERUNS: ${this.homeRuns}`, fieldW * 0.5, H - 28);
    ctx.restore();

    ctx.restore(); // 좌측 뷰포트 clip 해제

    // ========================================================================
    // 📹 [VIEWPORT 2] 우측: 내 웹캠 실시간 모션 인식 & 전신 스켈레톤 트래커
    // ========================================================================
    ctx.save();
    ctx.beginPath();
    ctx.rect(camX, 0, camW, H);
    ctx.clip(); // 우측 화면으로 렌더링 영역 제한

    // 1. 우측 룸 배경
    const rightBg = ctx.createLinearGradient(camX, 0, W, H);
    rightBg.addColorStop(0, "#0c081a");
    rightBg.addColorStop(1, "#15092a");
    ctx.fillStyle = rightBg;
    ctx.fillRect(camX, 0, camW, H);

    // 사이버 네온 그리드
    ctx.strokeStyle = "rgba(0, 210, 255, 0.12)";
    ctx.lineWidth = 1;
    for (let gy = 0; gy < H; gy += 45) {
      ctx.beginPath(); ctx.moveTo(camX, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
    for (let gx = camX; gx < W; gx += 45) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }

    // 2. 실시간 웹캠 비디오 피드 (우측 뷰포트에 거울 모드로 꽉 채움)
    if (!useMouse && video && video.readyState >= 2) {
      const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
      const s = Math.max(camW / vw, H / vh);
      ctx.save();
      // 우측 영역 기준 좌우 반전(미러)
      ctx.translate(camX + camW, 0);
      ctx.scale(-1, 1);
      ctx.globalAlpha = 0.45; // 선명하면서도 네온 UI와 매끄럽게 융합
      try {
        ctx.drawImage(video, (camW - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
      } catch {}
      ctx.restore();
    }

    // 3. 전신 스켈레톤 & 관절 렌더링 (우측 뷰포트 좌표계로 매핑)
    const bodySkel = getBody();
    if (!useMouse && bodySkel) {
      // 본체 스켈레톤의 원본 좌표(0~W, 0~H)를 우측 뷰포트(camX~W)로 리매핑하여 그리기
      this.drawRightMotionSkeleton(ctx, bodySkel, camX, camW);
    }

    // 4. 우측 뷰포트 상단 HUD 배지
    ctx.save();
    ctx.fillStyle = "rgba(12, 6, 24, 0.82)";
    ctx.strokeStyle = "rgba(0, 210, 255, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(camX + 16, 20, camW - 32, 54, 12);
    ctx.fill();
    ctx.stroke();

    // 펄스 녹색 닷
    ctx.fillStyle = "#22c55e";
    ctx.shadowColor = "#22c55e";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(camX + 38, 47, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "900 15px 'Rubik', sans-serif";
    ctx.fillStyle = "#00d2ff";
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 6;
    ctx.textAlign = "left";
    ctx.fillText("📹 MOTION TRACKER", camX + 54, 42);

    ctx.font = "700 12px 'Nunito Sans', sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.shadowBlur = 0;
    ctx.fillText("실시간 전신 배팅 폼 인식 중", camX + 54, 60);

    // 5. 하단 배팅 코칭 가이드
    ctx.fillStyle = "rgba(12, 6, 24, 0.85)";
    ctx.strokeStyle = "rgba(255, 209, 102, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(camX + 16, H - 76, camW - 32, 54, 12);
    ctx.fill();
    ctx.stroke();

    ctx.font = "900 14px 'Rubik', sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.textAlign = "center";
    ctx.fillText("⚾ 배팅 팁: 양손을 올리고 몸을 돌려 강하게 스윙하세요!", camX + camW / 2, H - 44);

    ctx.restore();

    ctx.restore(); // 우측 뷰포트 clip 해제

    // ========================================================================
    // ⚡ [DIVIDER] 중앙 네온 레이저 분할선
    // ========================================================================
    ctx.save();
    const beamGrad = ctx.createLinearGradient(fieldW, 0, fieldW, H);
    beamGrad.addColorStop(0, "rgba(0, 210, 255, 0.2)");
    beamGrad.addColorStop(0.5, "rgba(0, 210, 255, 0.95)");
    beamGrad.addColorStop(1, "rgba(225, 3, 125, 0.2)");
    ctx.strokeStyle = beamGrad;
    ctx.lineWidth = 4;
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(fieldW, 0);
    ctx.lineTo(fieldW, H);
    ctx.stroke();

    // 분할선 중앙 에너지 노드
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(fieldW, H * 0.5, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // 👤 타자 아바타 & 커스튬 100% 렌더링 함수
  drawBatterWithCostumes(ctx, bx, by) {
    const isSwinging = this.isSwinging;
    const swingProg = isSwinging ? Math.min(1, Math.max(0, 1 - this.swingTimer / 0.26)) : 0;

    // 배팅 회전 각도 및 신체 비틀림(Torso Twist)
    // 준비 자세: -35도 뒤로 와인드업 / 스윙 중: -60도에서 +65도까지 맹렬히 회전
    const swingAngle = isSwinging
      ? -Math.PI * 0.75 + swingProg * Math.PI * 1.25
      : -Math.PI * 0.28;
    const bodyTwist = isSwinging ? Math.sin(swingProg * Math.PI) * 0.45 : -0.15;

    ctx.save();
    ctx.translate(bx, by);

    // 타자 발밑 배터 박스 그림자
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(0, 24, 42, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // 1. 타자 기본 아바타 몸체 (스킨 & 네온 사이버 아틀레틱스)
    ctx.save();
    // 다리 & 발
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.roundRect(-22, 0, 14, 28, 5); // 왼다리
    ctx.roundRect(8, 0, 14, 28, 5);  // 오른다리
    ctx.fill();

    // 몸통/상체
    ctx.rotate(bodyTwist);
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.roundRect(-24, -46, 48, 50, 8);
    ctx.fill();

    // 머리
    ctx.fillStyle = "#ffd1a4"; // 살구색 피부
    ctx.beginPath();
    ctx.arc(0, -64, 18, 0, Math.PI * 2);
    ctx.fill();

    // 눈 (투수 쪽을 응시)
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(6, -65, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 양팔 & 배트 그립
    const armX = 14 + Math.cos(swingAngle) * 16;
    const armY = -34 + Math.sin(swingAngle) * 12;
    ctx.strokeStyle = "#ffd1a4";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-12, -38);
    ctx.lineTo(armX, armY);
    ctx.moveTo(12, -38);
    ctx.lineTo(armX, armY);
    ctx.stroke();

    ctx.restore(); // 몸통 로컬 회전 해제

    // 2. 👗 커스튬 파츠 100% 장착 렌더링 (플레이어가 장착한 모든 복장 연동)
    try {
      const scale = 0.85;

      // A. 오라 (Aura)
      if (equippedCostume.aura && COSTUME_ITEMS[equippedCostume.aura]) {
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.aura], { x: 0, y: -20, scale: scale * 1.3 });
      }

      // B. 등 / 날개 (Back)
      if (equippedCostume.back && COSTUME_ITEMS[equippedCostume.back]) {
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.back], { x: -8, y: -30, scale: scale * 0.95 });
      }

      // C. 하의 / 팬츠 (Legs)
      if (equippedCostume.legs && COSTUME_ITEMS[equippedCostume.legs]) {
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.legs], { x: 0, y: 10, scale, sx: 0.8, sy: 0.75 });
      }

      // D. 신발 / 스파이크 (Feet)
      if (equippedCostume.feet && COSTUME_ITEMS[equippedCostume.feet]) {
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.feet], { x: -15, y: 24, scale: scale * 0.75 });
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.feet], { x: 15, y: 24, scale: scale * 0.75 });
      }

      // E. 상의 / 유니폼 / 저지 (Body)
      if (equippedCostume.body && COSTUME_ITEMS[equippedCostume.body]) {
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.body], {
          x: 0, y: -24, scale, sx: 0.85, sy: 0.85, angle: bodyTwist
        });
      }

      // F. 머리 / 캡 / 헬멧 (Head)
      if (equippedCostume.head && COSTUME_ITEMS[equippedCostume.head]) {
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.head], {
          x: 0, y: -72, scale: scale * 0.95, angle: bodyTwist * 0.6
        });
      }

      // G. 얼굴 / 선글라스 / 마스크 (Face)
      if (equippedCostume.face && COSTUME_ITEMS[equippedCostume.face]) {
        drawCostumePiece(ctx, COSTUME_ITEMS[equippedCostume.face], {
          x: 4, y: -64, scale: scale * 0.8, angle: bodyTwist * 0.6
        });
      }
    } catch (err) {
      console.warn("Baseball costume render error:", err);
    }

    // 3. 🏏 야구 배트 렌더링 (커스튬 무기 or 사이버 골든 배트)
    ctx.save();
    const gripX = 16 + Math.cos(swingAngle) * 18;
    const gripY = -34 + Math.sin(swingAngle) * 14;
    ctx.translate(gripX, gripY);
    ctx.rotate(swingAngle);

    // 만약 커스튬 손/무기(예: bat_gold 등)가 장착되어 있으면 해당 파츠 렌더링
    if (equippedCostume.hand && COSTUME_ITEMS[equippedCostume.hand]) {
      const batItem = COSTUME_ITEMS[equippedCostume.hand];
      drawCostumePiece(ctx, batItem, { x: 45, y: 0, scale: 1.1, angle: Math.PI / 2 });
    } else {
      // 기본 크롬 & 네온 사이버 야구 배트
      const batLen = 115 + (reach > 0 ? reach * 0.6 : 0);
      const batGrad = ctx.createLinearGradient(0, 0, batLen, 0);
      batGrad.addColorStop(0, "#ffffff");
      batGrad.addColorStop(0.35, "#00d2ff");
      batGrad.addColorStop(1, "#ffd166");

      ctx.fillStyle = batGrad;
      ctx.shadowColor = "#00d2ff";
      ctx.shadowBlur = isSwinging ? 30 : 14;

      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(28, -4);
      ctx.lineTo(batLen - 12, -14);
      ctx.arc(batLen - 12, 0, 14, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(28, 4);
      ctx.lineTo(0, 4);
      ctx.closePath();
      ctx.fill();

      // 배트 노브
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(-3, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 4. 스윙 모션 블러 네온 아크
    if (isSwinging) {
      ctx.save();
      ctx.strokeStyle = "rgba(0, 210, 255, 0.85)";
      ctx.shadowColor = "#00d2ff";
      ctx.shadowBlur = 24;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(16, -34, 110, -Math.PI * 0.80, swingAngle);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); // 전체 타자 트랜스레이트 해제
  },

  // 📹 우측 뷰포트용 스켈레톤 및 관절 렌더링
  drawRightMotionSkeleton(ctx, skel, camX, camW) {
    if (!skel || !skel[0]) return;

    // 원본 좌표 x: 0~W -> 우측 뷰포트 camX ~ camX + camW 로 사상 (거울 반전 고려)
    const mapPt = (pt) => {
      if (!pt) return null;
      // 웹캠이 미러 반전되어 있으므로 좌표도 대칭 반전 매핑
      const normX = 1 - (pt.x / W);
      const mappedX = camX + normX * camW;
      return { x: mappedX, y: pt.y, v: pt.v ?? 1 };
    };

    const connections = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // 양팔
      [11, 23], [12, 24], [23, 24],                     // 몸통/골반
      [23, 25], [25, 27], [24, 26], [26, 28]           // 양다리
    ];

    ctx.save();
    ctx.strokeStyle = "rgba(0, 210, 255, 0.85)";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 12;

    connections.forEach(([i1, i2]) => {
      const p1 = mapPt(skel[i1]), p2 = mapPt(skel[i2]);
      if (p1 && p2 && p1.v > 0.25 && p2.v > 0.25) {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    });

    // 관절 노드 (머리, 어깨, 팔꿈치, 손목 등)
    [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((idx) => {
      const p = mapPt(skel[idx]);
      if (p && p.v > 0.25) {
        const isHand = idx === 15 || idx === 16;
        ctx.fillStyle = isHand ? "#ffd166" : "#ffffff";
        ctx.shadowColor = isHand ? "#ffd166" : "#00d2ff";
        ctx.shadowBlur = isHand ? 18 : 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, isHand ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();

        // 손목 위치에 배팅 조준 링 표시
        if (isHand) {
          ctx.strokeStyle = "#ffd166";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    });

    ctx.restore();
  }
};

function elapsed() { return GAME_SECONDS - timeLeft; }

// ---------- 진행 ----------
let warned10 = false, lastScoreEmit = 0;
let perfFrames = 0, perfT0 = 0, perfAi = 0, mainInfers = 0;   // HUD에 보여 줄 실제 성능 측정값
let mode = null, score = 0, timeLeft = 0, playing = false, last = 0;
// 5초 레디타임(준비시간) 상태
let isReadyTime = false;
let readyStartTime = 0;
let readyTimeLeft = 5.0;
let lastReadyCount = 5;
let lastWarmupParticle = 0;

// ⚡ 5초 레디타임 인터랙티브 몸풀기 카운트다운 (장착한 모든 커스튬을 입고 자유롭게 모션 동작 연습)
function drawReadyCountdown(t, isBodyGame) {
  const cx = W / 2, cy = H * 0.44;
  const currentSec = Math.max(1, Math.ceil(t));
  const fraction = t - Math.floor(t);
  const scale = 1.0 + Math.pow(fraction, 2) * 0.35; // 1초마다 쿵! 하고 수축하는 심장 박동 펄스

  ctx.save();

  // 1. 중앙 부드러운 네온 비네팅
  const bgGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 300);
  bgGrad.addColorStop(0, "rgba(20, 8, 45, 0.65)");
  bgGrad.addColorStop(0.7, "rgba(10, 6, 25, 0.45)");
  bgGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 300, 0, Math.PI * 2);
  ctx.fill();

  // 2. 5초 원형 프로그레스 네온 게이지
  const progress = Math.max(0, Math.min(1, (5.0 - t) / 5.0));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, 110, 0, Math.PI * 2);
  ctx.stroke();

  const numColor = currentSec <= 2 ? "#ff3366" : (currentSec <= 3 ? "#ffb800" : "#00d2ff");
  ctx.strokeStyle = numColor;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.shadowColor = numColor;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(cx, cy, 110, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();

  // 3. 중앙 대형 펄스 숫자
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.shadowBlur = 35;
  ctx.shadowColor = numColor;
  ctx.fillStyle = numColor;
  ctx.font = "900 110px 'Rubik', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(currentSec, 0, 6);
  ctx.restore();

  // 4. 상단 흥겨운 모션 안내 타이틀
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#ffb800";
  ctx.fillStyle = "#ffb800";
  ctx.font = "900 24px 'Rubik', sans-serif";
  ctx.fillText("🕺 READY! 신나게 몸을 풀어보세요!", cx, cy - 150);

  ctx.shadowBlur = 8;
  ctx.shadowColor = "#00d2ff";
  ctx.fillStyle = "#a5e7ff";
  ctx.font = "800 16px 'Rubik', sans-serif";
  ctx.fillText("카메라 앞에서 팔을 흔들거나 스트레칭해 보세요 ✨", cx, cy - 120);

  // 5. 모션 동작 감지 시 반짝이 파티클 인터랙션 (재미있는 몸풀기 피드백)
  const now = performance.now();
  if (now - lastWarmupParticle > 120) {
    lastWarmupParticle = now;
    pointers.forEach((p) => {
      if (p.speed > 8) {
        burst(p.x, p.y, ["#ffd700", "#00d2ff", "#ff0077", "#00ffaa"][(Math.random() * 4) | 0], 6);
      }
    });
  }

  // 6. 하단 본 게임 카운트다운 안내
  ctx.shadowBlur = 8;
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.font = "700 18px sans-serif";
  ctx.fillStyle = "#ffffff";
  const guideText = isBodyGame
    ? "멋진 커스튬을 입고 자유롭게 움직여 보세요!"
    : "손을 움직여 조준선과 반응성을 체크해 보세요!";
  ctx.fillText(guideText, cx, cy + 145);

  ctx.font = "600 15px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(`${currentSec}초 후 게임이 시작됩니다!`, cx, cy + 172);

  ctx.restore();
}

function drawBackground(color, camAlpha = 0.20) {
  if (!mode) { ctx.clearRect(0, 0, W, H); return; } // 메뉴에서는 투명 처리

  // 1. 깊이감 있는 딥 다크 사이버 아케이드 베이스 (#0c0618) - 시인성 및 게임 오브젝트 식별력 극대화
  ctx.fillStyle = "#0c0618";
  ctx.fillRect(-24, -24, W + 48, H + 48);

  // 2. 게임별 전용 아케이드 무대 그래픽 렌더링 (방 안 풍경 대신 게임 스테이지가 전면에 오도록 연출)
  ctx.save();
  if (mode === "box" || mode === "kungfu") {
    // 좌/우 듀얼 네온 스포트라이트 광원 (가벼운 단일 선형 광원 패스로 렌더링 부하 대폭 절감)
    const spotGrad = ctx.createLinearGradient(0, 0, W, H * 0.75);
    spotGrad.addColorStop(0, "rgba(0, 210, 255, 0.16)");
    spotGrad.addColorStop(0.5, "rgba(20, 6, 43, 0)");
    spotGrad.addColorStop(1, "rgba(225, 3, 125, 0.16)");
    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, W, H);

    // 복싱 링 코너 기둥 (Corner Posts)
    ctx.strokeStyle = "rgba(100, 116, 139, 0.6)"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(W * 0.08, H * 0.35); ctx.lineTo(W * 0.08, H * 0.88); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.92, H * 0.35); ctx.lineTo(W * 0.92, H * 0.88); ctx.stroke();

    // 복싱 링 네온 로프 (좌/우 3선 네온 로프)
    const ropeHeights = [H * 0.44, H * 0.58, H * 0.72];
    ropeHeights.forEach((ry, idx) => {
      ctx.strokeStyle = idx === 0 ? "rgba(0, 210, 255, 0.45)" : (idx === 1 ? "rgba(255, 215, 0, 0.4)" : "rgba(255, 42, 75, 0.45)");
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(W * 0.08, ry); ctx.lineTo(W * 0.38, ry + 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W * 0.92, ry); ctx.lineTo(W * 0.62, ry + 15); ctx.stroke();
    });

    // 바닥 복싱 링 매트 그리드 & 센터 서클
    const horizon = H * 0.72;
    ctx.strokeStyle = "rgba(0, 210, 255, 0.18)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const y = horizon + Math.pow(i / 4, 1.8) * (H - horizon);
      ctx.beginPath(); ctx.moveTo(W * 0.05, y); ctx.lineTo(W * 0.95, y); ctx.stroke();
    }
  } else if (mode === "beat") {
    // 🕺 비트세이버 소실점 레이저 터널
    const horizonY = H * 0.52;
    const cx = W / 2;
    ctx.strokeStyle = "rgba(0, 210, 255, 0.22)"; ctx.lineWidth = 2;
    for (let k = -4; k <= 4; k++) {
      ctx.beginPath(); ctx.moveTo(cx + k * 12, horizonY); ctx.lineTo(cx + k * (W * 0.14), H); ctx.stroke();
    }
  } else {
    // 기본 사이버 그리드 바닥
    const horizon = H * 0.70;
    ctx.strokeStyle = "rgba(0, 210, 255, 0.14)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const y = horizon + Math.pow(i / 4, 2) * (H - horizon);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }
  ctx.restore();

  // 3. 실시간 플레이어 웹캠 비디오 (방 안 잡동사니 노출 완전 차단 -> 은은한 네온 실루엣 0.12 알파로 아바타처럼 일체화)
  // (야구 모드는 우측 듀얼 뷰포트에서 전신 스켈레톤과 함께 독립 렌더링하므로 제외)
  if (!useMouse && video && video.readyState >= 2 && mode !== "baseball") {
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    const s = Math.max((W + 48) / vw, (H + 48) / vh);
    ctx.save();
    ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.globalAlpha = 0.12; // 방 가구와 벽지 노출을 차단하고 플레이어의 빠른 손놀림만 은은하게 비춤
    try {
      ctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
    } catch {}
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  // 📊 실제 성능을 1초마다 HUD에 표시: 화면 fps · 초당 AI 인식 횟수 · 인식 1회 시간 (예전엔 "60 FPS LOCKED" 고정 문구였어요)
  perfFrames++;
  if (now - perfT0 >= 1000) {
    const secs = (now - perfT0) / 1000, st = visionAI.stats, el = $("hudFpsText");
    const aiTotal = st.results + mainInfers;
    if (el && perfT0) el.textContent = `화면 ${Math.round(perfFrames / secs)}fps · AI ${Math.round((aiTotal - perfAi) / secs)}회/초 · ${Math.round(st.delegate ? st.inferMs : detectMs)}ms ${st.delegate ? "작업자 " + st.delegate : "메인"}`;
    perfFrames = 0; perfT0 = now; perfAi = aiTotal;
  } // 실제 시간과 게임 물리 시간 100% 동기화 (슬로우 모션 방지)

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
      try {
        // ⚡ 5초 레디타임(인터랙티브 모션 몸풀기) 실제 시간 100% 동기화
        const elapsedReady = readyStartTime > 0 ? (now - readyStartTime) / 1000 : 0;
        readyTimeLeft = Math.max(0, 5.0 - elapsedReady);
        const curCount = Math.max(1, Math.ceil(readyTimeLeft));
        if (curCount !== lastReadyCount) {
          lastReadyCount = curCount;
          sfx.countdown(false); // 1초마다 통통 튀는 카운트다운 비프음
        }

        // 게임 필드 및 포즈/세이버 렌더링 (플레이어가 자신의 위치와 자세를 실시간 체크)
        try { g.draw(); } catch (drawErr) { console.warn("Ready draw guard:", drawErr); }

        // 🎵 카운트다운 5초 동안 심장을 뛰게 하는 인트로 비트 재생
        try { bgmTick(true); } catch (bgmErr) { console.warn("Ready BGM guard:", bgmErr); }

        // 5초 카운트다운 오버레이 UI 렌더링
        try { drawReadyCountdown(readyTimeLeft, Boolean(g.body)); } catch (cdErr) { console.warn("Countdown UI guard:", cdErr); }

        try { updateLiveHud(); } catch {}

        // 5초 카운트다운 종료 시 본격적인 게임 시작
        if (readyTimeLeft <= 0) {
          isReadyTime = false;
          sfx.countdown(true); // 팡파르 시작음
          triggerWaveBanner("WAVE 1", "START! 지금부터 시작!", false);
          // 이전 음성이 끝나지 않았더라도 자연스럽게 이어지도록 비강제 발화
          speak("시작!", false);
          spawnTimer = 0.3;
          if (mode === "beat") {
            const c = BGM.beat;
            if (c && c.audioFile) {
              playRealTrackAudio(c.audioFile, true);
            }
          }
          try { g?.onGameRealStart?.(); } catch (startErr) { console.warn("onGameRealStart guard:", startErr); }
        }
      } catch (readyBlockErr) {
        console.warn("ReadyTime top-level guard:", readyBlockErr);
        if (readyTimeLeft <= 0.1) {
          isReadyTime = false;
        }
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
      try {
        g.update(dt);
      } catch (err) {
        console.error("Game update error in " + mode, err);
      }
      try {
        g.draw();
      } catch (err) {
        console.error("Game draw error in " + mode, err);
      }
      try {
        bgmTick();
      } catch (err) {
        console.error("bgmTick error in " + mode, err);
      }
      comboTimer -= dt; if (comboTimer <= 0) combo = 0;
      if (!g.noTimer) timeLeft -= dt;
      if (playing) {                                   // update 안에서 게임이 끝났을 수 있음
        if (!g.noTimer && timeLeft <= 10 && !warned10) { warned10 = true; speak("10초 남았어요!"); }
        updateLiveHud();
        if (now - lastScoreEmit > 250) { lastScoreEmit = now; bus.emit("game:score", { score, combo }); }   // 온라인 대결 점수 공유용
        if (timeLeft <= 0) endGame();
      }
    }
  } else if (g && playing) {
    try { g.draw(); } catch {}
  }
  if (playing) {
    try {
      drawFx();
      drawCombo();
      // 👗 모든 인게임 모드에서 장착된 커스튬 파츠(모자, 날개, 의상, 무기, 오라) 실시간 렌더링
      // (야구 모드는 좌측 타자 아바타 캐릭터가 커스튬을 100% 장착하고 출전하므로 중복 방지)
      if (mode !== "baseball") {
        drawEquippedCostumesOnBody(ctx, getBody(), pointers);
      }
      if (g && !g.noCursor && mode !== "baseball") drawTrails(g.trail ?? "#fff");
    } catch (fxErr) {
      console.warn("In-game FX draw error:", fxErr);
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

function startGame(m, opts = {}) {
  seedGame(opts.seed);                                                            // 온라인 대결이면 같은 시드 = 같은 판
  visionAI.setActive(useMouse ? null : (games[m].body ? "pose" : "hand"));          // ⚡ 이번 게임에 필요한 인식만 작업자에서 돌림
  if (m === "beat" && opts.trackId) games.beat.chosenTrackId = opts.trackId;      // 온라인: 방장이 고른 곡
  ac(); // 오디오 컨텍스트 즉시 활성화 (브라우저 유저 제스처 정책 준수)
  mode = m; score = 0; timeLeft = GAME_SECONDS; spawnTimer = 0.3;
  objs = []; halves = []; particles = []; popups = []; playing = true; body = null; shield = SHIELD_MAX; flash = 0;
  combo = 0; comboTimer = 0; maxCombo = 0;
  currentWave = 1; isFeverTime = false;
  games[m].init?.();
  bgmStart(); // 🎵 게임 시작 직후 5초 레디 동안 인트로 비트부터 흘러나오도록 가동
  $("menu").classList.add("hidden"); $("result").classList.add("hidden"); $("hud").classList.remove("hidden");
  $("feverBorder")?.classList.add("hidden");
  const stageWave = $("stageWave");
  if (stageWave) { stageWave.textContent = "WAVE 1"; stageWave.classList.remove("fever"); }
  document.body.classList.add("playing");

  // ⚡ 5초 레디타임(인터랙티브 모션 몸풀기) 가동
  isReadyTime = true;
  readyStartTime = performance.now();
  readyTimeLeft = 5.0;
  lastReadyCount = 5;
  sfx.countdown(false); // 첫 카운트다운 톤
  speak(INTRO[m], true); // 게임 설명/안내 음성 발화
  warned10 = false;
  updateLiveHud(true);
  bus.emit("game:start", { mode: m, online: !!opts.online, seed: opts.seed ?? null });
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

// 🏅 게임별 등급 기준 [B, A, S, S+, SSS] 이상이면 해당 등급 (그보다 낮으면 C)
// 게임마다 점수 크기가 크게 달라서(포즈 ~100점대, 풍선 ~수천 점, 비트 ~수만 점) 따로 정함.
// 기준은 "처음 해봄 / 보통 / 잘함 / 아주 잘함 / 거의 완벽" 플레이어를 점수 규칙대로 시뮬레이션해서 계산한 추정치예요.
// 실제로 해 보고 너무 쉽거나 어려우면 이 숫자만 고치면 됩니다.
const RANK_THRESHOLDS = {
  balloon: [780, 1400, 2000, 2400, 3000],
  ninja:   [1400, 2100, 2700, 3200, 3800],
  space:   [26, 68, 230, 560, 920],
  kungfu:  [13, 30, 81, 210, 470],
  brick:   [9, 25, 55, 110, 360],
  dodge:   [30, 54, 86, 110, 130],
  pose:    [21, 37, 60, 75, 105],       // 새 포즈 미믹(레벨 시스템) 점수 규칙으로 다시 계산
  runner:  [250, 450, 620, 700, 800],       // 점수 이중 계산 수정 후 다시 계산
  keeper:  [68, 210, 580, 980, 1400],
  box:     [640, 1300, 1800, 2200, 2800],
  beat:    [11000, 19000, 34000, 61000, 120000],   // 점수 이중 계산 수정 후 다시 계산
  baseball:[450, 900, 1500, 2200, 3200],
};
const RANK_DEFAULT = [35, 70, 120, 180, 260];   // 기준이 없는 게임용 기본값 (예전 기준)

// 🏅 게임별 점수 순위표 (1등~10등). 이번 점수를 넣고 정렬해서 저장하고, 몇 등인지 알려 줌
// prevBest: 이번 판 전의 최고 기록. 순위표가 아직 없을 때만 1등 후보로 옮겨 와요 (이미 이번 점수로 덮어쓴 값을 다시 읽으면 같은 점수가 두 번 들어가요)
async function recordTop10(modeId, sc, pid, prevBest = 0) {
  const key = recKey("top10-" + modeId, pid);
  let list = await SecureStore.loadCheckpoint(key, null);
  if (!Array.isArray(list)) {
    const oldBest = +prevBest || 0;                      // 예전 최고 기록은 순위표로 옮김
    list = oldBest > 0 ? [oldBest] : [];
  }
  list = list.map(Number).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => b - a).slice(0, 10);
  let myIdx = -1;
  if (sc > 0) {
    let i = list.findIndex((v) => v < sc);            // 같은 점수면 먼저 세운 기록이 위
    if (i < 0) i = list.length;
    list.splice(i, 0, sc);
    myIdx = i;
    if (list.length > 10) { list.length = 10; if (myIdx >= 10) myIdx = -1; }
    await SecureStore.saveCheckpoint(key, list);
  }
  return { list, myIdx };
}
function renderTop10(modeId, list, myIdx, names = null) {
  const wrap = $("resultTop10"), ol = $("top10List");
  if (!wrap || !ol) return;
  const name = document.querySelector(`.mode[data-mode="${modeId}"]`)?.closest(".card")?.querySelector("h3")?.textContent?.trim() || "";
  $("top10Game").textContent = name;
  const medals = ["🥇", "🥈", "🥉"];
  // 내 점수가 들어간 자리에서 "쾅!" 하고 박히고, 그 아래 순위들은 한 칸씩 밀려 내려오는 연출 (이름은 escapeHtml로 안전하게)
  ol.innerHTML = Array.from({ length: 10 }, (_, i) => {
    const v = list[i], me = i === myIdx;
    const cls = [me ? (i === 0 ? "me first" : "me") : "", myIdx >= 0 && i > myIdx ? "push" : "", v == null ? "empty" : ""].filter(Boolean).join(" ");
    const delay = myIdx >= 0 && i > myIdx ? ` style="animation-delay:${0.1 + (i - myIdx) * 0.05}s"` : "";
    const who = names && v != null ? `<span class="t10-name">${escapeHtml(names[i] ?? "")}</span>` : "";
    return `<li class="${cls}"${delay}><span class="t10-rank">${me && i === 0 ? "👑" : (medals[i] ?? i + 1)}</span>${who}<span class="t10-score">${v == null ? "-" : Number(v).toLocaleString() + "점"}</span>${me ? '<em class="t10-new">NEW</em>' : ""}</li>`;
  }).join("");
  // 1등이면 순위표 전체가 금빛으로 빛나고 색종이가 쏟아짐
  const conf = $("t10Confetti");
  wrap.classList.toggle("champion", myIdx === 0);
  if (conf) conf.innerHTML = myIdx === 0 ? Array.from({ length: 16 }, (_, k) => `<i style="left:${(k * 6.4 + (k % 3) * 2).toFixed(1)}%;animation-delay:${((k * 0.17) % 1.6).toFixed(2)}s">${["🎉", "✨", "🎊", "⭐"][k % 4]}</i>`).join("") : "";
  wrap.classList.remove("hidden");
}

// 👨‍👩‍👧 가족 전체 순위: 모든 프로필의 TOP 10을 합쳐서 다시 1~10등
let lastTop = null;
async function loadFamilyTop(modeId) {
  const all = [];
  for (const p of profiles?.list ?? []) {
    const l = await SecureStore.loadCheckpoint(recKey("top10-" + modeId, p.id), []);
    if (Array.isArray(l)) for (const v of l) { const n = Number(v); if (Number.isFinite(n) && n > 0) all.push({ score: n, name: p.nickname, pid: p.id }); }
  }
  all.sort((x, y) => y.score - x.score);                 // 같은 점수면 프로필 순서 유지
  return all.slice(0, 10);
}
async function showTop10Tab(which) {
  const t = lastTop;
  if (!t) return;
  const multi = (profiles?.list.length ?? 0) > 1;
  $("t10Tabs")?.classList.toggle("hidden", !multi);          // 프로필이 한 명뿐이면 탭을 숨김
  $("t10Mine")?.classList.toggle("active", which !== "family" || !multi);
  $("t10Family")?.classList.toggle("active", which === "family" && multi);
  if (which === "family" && multi) {
    const entries = await loadFamilyTop(t.modeId);
    if (lastTop !== t) return;                               // 기다리는 사이 다른 판이 끝났으면 무시
    const idx = t.score > 0 ? entries.findIndex((e) => e.pid === t.pid && e.score === t.score) : -1;
    renderTop10(t.modeId, entries.map((e) => e.score), idx, entries.map((e) => e.name));
  } else {
    renderTop10(t.modeId, t.mine.list, t.mine.myIdx);
  }
}

function endGame() {
  playing = false;
  bus.emit("game:end", { mode, score, maxCombo });
  visionAI.setActive(null);                            // 결과 화면에서는 인식을 쉬어요
  stopRealTrackAudio();
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
    $("resultTop10")?.classList.add("hidden");       // 2인 대결은 순위표 없음
    $("newRecordBadge")?.classList.add("hidden");
    $("result").classList.remove("hidden");
    sfx.stamp(); sfx.fanfare();
    speak(a > b ? "파란팀 승리!" : b > a ? "빨간팀 승리!" : "무승부예요!", true);
    return;
  }

  // 2. 1인 아케이드 모드 등급 산정 (SSS, S+, S, A, B, C)
  let rank = "C", rankClass = "c", rankLabel = "KEEP PRACTICING!", gradeTitle = "BEGINNER";
  const [tB, tA, tS, tSp, tSSS] = RANK_THRESHOLDS[mode] ?? RANK_DEFAULT;   // 게임마다 점수 크기가 달라서 게임별 기준 사용
  if (score >= tSSS) { rank = "SSS"; rankClass = "sss"; rankLabel = "UNSTOPPABLE LEGEND! 🌟"; gradeTitle = "LEGEND"; }
  else if (score >= tSp) { rank = "S+"; rankClass = "s"; rankLabel = "SUPERIOR PERFORMANCE! 🔥"; gradeTitle = "MASTER"; }
  else if (score >= tS) { rank = "S"; rankClass = "s"; rankLabel = "SPECTACULAR PLAY! 💎"; gradeTitle = "EXPERT"; }
  else if (score >= tA) { rank = "A"; rankClass = "a"; rankLabel = "GREAT PERFORMANCE! ⚡"; gradeTitle = "PRO"; }
  else if (score >= tB) { rank = "B"; rankClass = "b"; rankLabel = "GOOD EFFORT! 👏"; gradeTitle = "AMATEUR"; }

  const pid = profiles?.activeId, key = recKey("best-" + mode, pid), modeId = mode;
  SecureStore.loadCheckpoint(key, 0).then(async (savedBest) => {
    const curBest = +savedBest || 0;
    const isNewRecord = score > curBest && score > 0;
    const best = Math.max(score, curBest);
    SecureStore.saveCheckpoint(key, best);

    // 🏅 TOP 10 순위표 기록 & 표시 (이번 판이 몇 등인지 NEW 표시)
    const top = await recordTop10(modeId, score, pid, curBest);
    if (mode !== modeId) return;                     // 순위표 저장 중에 메뉴로 나갔으면 결과 화면은 띄우지 않음
    lastTop = { modeId, mine: top, pid, score };
    showTop10Tab("mine");

    // 🎁 1~3등 달성 시 해당 게임의 고유 커스튬 파츠 지급!
    if (top.myIdx >= 0 && top.myIdx <= 2) {
      checkAndAwardRankCostume(modeId, top.myIdx);
    } else {
      $("resultCostumeReward")?.classList.add("hidden");
    }

    // 순위 발표 음성: 숫자 차이 같은 설명 없이 짧고 임팩트 있게
    const placeSay = score <= 0 ? "다시 도전!" : top.myIdx === 0 ? "1등! 새로운 최고 기록!" : top.myIdx > 0 ? `${top.myIdx + 1}등!` : "아쉽게 순위권 밖!";

    // 랭크 스탬프 & 라벨
    $("resultRank").textContent = rank;
    $("resultRank").className = "rank-stamp rank-" + rankClass;
    $("rankLabel").textContent = rankLabel;

    // 세부 통계 스탯 카드
    $("finalBest").textContent = best.toLocaleString() + "점";
    $("resultCombo").textContent = maxCombo ? `${maxCombo} COMBO` : "0 COMBO";
    $("resultGradeText").textContent = gradeTitle;

    // 🪙 점수를 키네틱 코인으로 환산하여 즉시 지급!
    let gainedCoins = Math.floor(score * 1.5);
    if (maxCombo > 0) gainedCoins += Math.min(500, maxCombo * 10);
    if (top.myIdx === 0) gainedCoins += 1000;
    else if (top.myIdx === 1) gainedCoins += 500;
    else if (top.myIdx === 2) gainedCoins += 250;
    gainedCoins = Math.max(50, gainedCoins);

    const updatedCoins = await addPlayerCoins(gainedCoins);
    if ($("rcGainedCoins")) $("rcGainedCoins").textContent = `+${gainedCoins.toLocaleString()} 🪙`;
    if ($("rcTotalCoins")) $("rcTotalCoins").textContent = `(보유: ${updatedCoins.toLocaleString()} 🪙)`;
    updateCoinsDisplay(updatedCoins);

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

    speak(placeSay || (isNewRecord ? "새로운 최고 기록 달성! 축하합니다!" : `${rank} 등급 클리어!`), true);
  }).catch((err) => {
    console.error("결과 화면 표시 중 오류:", err);     // 조용히 삼키지 않고 원인을 남김
    $("finalScore").textContent = score + "점";
    $("result").classList.remove("hidden");
  });
}
function toMenu() {
  if (mode) bus.emit("game:quit", {});
  try { speechSynthesis.cancel(); } catch {}
  stopTrackPreview?.();
  closeBeatTrackSelector?.();
  if (mode) games[mode].exit?.();
  visionAI.setActive(null);
  scheduleCameraStop();
  playing = false; mode = null; objs = [];
  isReadyTime = false; readyTimeLeft = 0; readyStartTime = 0;
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
    ["balloon", "풍선"], ["ninja", "과일"], ["space", "유성"],
    ["brick", "벽돌"], ["kungfu", "쿵푸"], ["dodge", "피하기"],
    ["pose", "포즈"], ["runner", "달리기"], ["beat", "슬래시"],
    ["keeper", "골키퍼"], ["box", "펀치백"], ["baseball", "야구"]
  ];
  const items = await Promise.all(modesList.map(async ([m, n]) => {
    const val = await SecureStore.loadCheckpoint(recKey("best-" + m), 0);
    document.querySelectorAll(`[data-best="${m}"]`).forEach((e) => { e.textContent = (val || 0) + "점"; });   // 카드별 최고 기록
    return `${n} ${val || 0}`;
  }));
  $("best").textContent = "🏆 최고 기록 — " + items.join(" · ");
  const total = items.reduce((s, t) => s + (+t.split(" ").pop() || 0), 0);
  $("totalBest").textContent = total.toLocaleString();
}

let vision = null;
// 카메라 끄기 (웹캠 불이 계속 켜져 있지 않게). 다음 게임을 고르면 다시 켬
let camStopTimer = null;
function stopCamera() {
  clearTimeout(camStopTimer); camStopTimer = null;
  visionAI.setActive(null);
  try { video.srcObject?.getTracks().forEach((t) => t.stop()); } catch {}
  video.srcObject = null; lastBodyTime = -1;
}
// 메뉴로 나오면 바로 끄지 않고 1분 뒤에 꺼요: 바로 다음 판을 하면 카메라를 다시 켜고 밝기에 적응하는 지연이 없어요
function scheduleCameraStop(ms = 60000) {
  clearTimeout(camStopTimer);
  camStopTimer = setTimeout(() => { if (!playing) stopCamera(); }, ms);
}
document.addEventListener("visibilitychange", () => { if (document.hidden && !playing) stopCamera(); });   // 다른 탭/앱으로 가면 바로 끔
async function ensureVideo() {
  clearTimeout(camStopTimer); camStopTimer = null;
  const track = video.srcObject?.getVideoTracks?.()[0];
  if (track && track.readyState === "live") {
    if (video.paused) {
      try { await video.play(); } catch {}
    }
    return true;
  }
  // 카메라 트랙이 종료되었거나 없으면 기존 스트림 정리 후 재연결
  try { video.srcObject?.getTracks?.().forEach((t) => t.stop()); } catch {}
  video.srcObject = null;
  $("status").textContent = "카메라 연결 중… (처음엔 조금 걸려요)";
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, min: 30 }, facingMode: "user" }
    });
    await video.play();
    vision ??= await FilesetResolver.forVisionTasks(WASM);
    $("status").textContent = "";
    return true;
  } catch (e) {
    console.error("카메라 연결 실패:", e);
    $("status").textContent = "카메라를 쓸 수 없어요. 허용했는지 확인하거나 아래 '마우스/터치'를 체크하세요.";
    return false;
  }
}
async function makeLandmarker(Cls, modelAssetPath, extra) {
  // 기본은 GPU(초고속 가속). 주소 끝에 ?cpu 를 붙이면 CPU 모드 폴백
  const opts = (delegate) => ({ baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", ...extra });
  try { return await Cls.createFromOptions(vision, opts(location.search.includes("cpu") ? "CPU" : "GPU")); }
  catch { return await Cls.createFromOptions(vision, opts("CPU")); }
}
// 오인식(노이즈) 방지 및 빠른 스윙 추적력 극대화를 위한 고정밀 신뢰도 세팅
const POSE_OPTIONS = { numPoses: 1, minPoseDetectionConfidence: 0.38, minPosePresenceConfidence: 0.38, minTrackingConfidence: 0.40 };
const HAND_OPTIONS = { numHands: 2, minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.40 };   // 1인 2손 집중 추적
async function ensureModel(kind) {
  if (kind === "pose" ? poseLandmarker : handLandmarker) return true;
  if (visionAI.ready(kind)) return true;
  $("status").textContent = kind === "pose" ? "몸 인식 준비 중… (처음엔 조금 걸려요)" : "손 인식 준비 중…";
  try {
    // ⚡ 1순위: 작업자(Web Worker)에서 인식 → 화면이 멈추지 않음
    if (USE_WORKER && await visionAI.ensure(kind, { model: kind === "pose" ? POSE_MODEL : MODEL, options: kind === "pose" ? POSE_OPTIONS : HAND_OPTIONS, cpu: location.search.includes("cpu") })) {
      $("status").textContent = "";
      return true;
    }
    // 2순위(예전 방식): 화면과 같은 곳에서 인식
    if (kind === "pose") poseLandmarker = await makeLandmarker(PoseLandmarker, POSE_MODEL, POSE_OPTIONS);
    else handLandmarker = await makeLandmarker(HandLandmarker, MODEL, HAND_OPTIONS);
    $("status").textContent = "";
    return true;
  } catch (e) {
    console.error(e);
    $("status").textContent = "인식 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.";
    return false;
  }
}

// ============================================================================
// 🎵 펌프 잇 업 스타일 아케이드 뮤직 셀렉터 (Arcade Track Selector System)
// ============================================================================
let selectedBeatTrackId = "radetzky"; // 기본 선택곡: 라데츠키 행진곡
let previewStopTimer = null;
let isPreviewing = false;
let currentPreviewTrackId = null;
let previewAudio = null;

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function stopTrackPreview() {
  if (previewStopTimer) {
    clearTimeout(previewStopTimer);
    previewStopTimer = null;
  }
  if (previewAudio) {
    try { previewAudio.pause(); previewAudio.currentTime = 0; } catch {}
    previewAudio = null;
  }
  stopRealTrackAudio();
  isPreviewing = false;
  currentPreviewTrackId = null;
  document.querySelectorAll(".track-preview-btn").forEach((btn) => {
    btn.classList.remove("playing");
    btn.textContent = "▶ 미리듣기";
  });
}

function playTrackPreview(track) {
  try {
    ac();
    if (isPreviewing && currentPreviewTrackId === track.id) {
      stopTrackPreview();
      return;
    }
    stopTrackPreview();
    isPreviewing = true;
    currentPreviewTrackId = track.id;

    const activeBtn = $(`previewBtn_${track.id}`);
    if (activeBtn) {
      activeBtn.classList.add("playing");
      activeBtn.textContent = "⏹ 정지";
    }

    // 🎵 실제 고음질 MP3/오디오 실연 음원이 있으면 스튜디오 음질로 즉시 미리듣기 재생!
    if (track.audioFile) {
      previewAudio = new Audio(track.audioFile);
      previewAudio.volume = soundOn ? 0.95 : 0;
      previewAudio.play().catch((e) => console.warn("미리듣기 재생 권한:", e));
      previewStopTimer = setTimeout(() => {
        stopTrackPreview();
      }, 15000);
      return;
    }

    // 실제 오디오 파일이 없는 트랙은 8마디 신스 멜로디 시연
    const t0 = actx.currentTime + 0.05;
    const bpm = track.bpm || 132;
    const stepDur = 60 / bpm / 2;
    const totalSteps = 32;

    for (let step = 0; step < totalSteps; step++) {
      const t = t0 + step * stepDur;
      const s = step % 8;
      const v = (track.vol ?? 0.8) * 0.75;

      if (s % 2 === 0) tone(175, t, 0.16, "sine", 0.45 * v, 36, undefined, bgmBus);
      if (s === 2 || s === 6) {
        tone(210, t, 0.1, "sine", 0.25 * v, 80, undefined, bgmBus);
        noise(t, 0.11, 0.18 * v, 2400, undefined, bgmBus);
      }
      if (s % 2 === 1) noise(t, 0.06, 0.08 * v, 7500, undefined, bgmBus);

      if (track.melody && track.melody.length > 0) {
        const noteIdx = step % track.melody.length;
        const semi = track.melody[noteIdx];
        if (semi !== null && semi !== undefined) {
          tone(track.root * (2 ** (semi / 12)), t, 0.20, track.wave || "sawtooth", 0.18 * v, undefined, ((s % 4) - 1.5) / 3, bgmBus);
        }
      } else if (track.scale && track.scale.length > 0) {
        const idx = (ARP[s] + Math.floor(step / 8)) % track.scale.length;
        const f = track.root * 2 * (2 ** (track.scale[idx] / 12));
        tone(f, t, 0.18, track.wave || "sawtooth", 0.14 * v, undefined, undefined, bgmBus);
      }
    }

    previewStopTimer = setTimeout(() => {
      stopTrackPreview();
    }, totalSteps * stepDur * 1000 + 200);
  } catch (err) {
    console.warn("미리듣기 재생 오류:", err);
    stopTrackPreview();
  }
}

function updateBeatSelectedInfo(track) {
  const titleEl = $("beatSelectedTitle");
  const genreEl = $("beatSelectedGenre");
  const bpmEl = $("beatSelectedBpm");

  if (!track || track.id === "random") {
    if (titleEl) titleEl.textContent = "🎲 랜덤 셔플 플레이 (SHUFFLE)";
    if (genreEl) {
      genreEl.textContent = "ALL SONGS";
      genreEl.style.color = "#00d2ff";
      genreEl.style.borderColor = "#00d2ff";
    }
    if (bpmEl) bpmEl.textContent = "RANDOM BPM";
    return;
  }

  if (titleEl) titleEl.textContent = track.title;
  if (genreEl) {
    genreEl.textContent = track.genre;
    genreEl.style.color = track.tagColor || "#00d2ff";
    genreEl.style.borderColor = track.tagColor || "#00d2ff";
  }
  if (bpmEl) bpmEl.textContent = `${track.bpm} BPM`;
}

function openBeatTrackSelector() {
  const modal = $("beatTrackModal");
  const listEl = $("beatTrackList");
  if (!modal || !listEl) {
    startGame("beat");
    return;
  }

  // 트랙 목록 HTML 렌더링
  let html = `
    <!-- 🎲 랜덤 플레이 카드 -->
    <div class="beat-track-card ${selectedBeatTrackId === "random" ? "active" : ""}" data-track-id="random" style="border-left: 4px solid #a855f7;">
      <div class="track-card-top">
        <div class="track-card-badge-row">
          <span class="track-genre-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc;">SHUFFLE</span>
          <span style="font-size: 11px; color: #cbd5e1; font-weight: 700;">추천</span>
        </div>
        <div class="track-card-title">🎲 랜덤 셔플 플레이</div>
      </div>
      <div class="track-card-meta">
        <span class="track-bpm-tag" style="color: #c084fc;">⚡ 매판 다른 명곡 자동 재생</span>
      </div>
    </div>
  `;

  BEAT_TRACKS.forEach((track) => {
    const isAct = selectedBeatTrackId === track.id;
    const isRealAudio = Boolean(track.audioFile);
    html += `
      <div class="beat-track-card ${isAct ? "active" : ""}" data-track-id="${track.id}" style="border-left: 4px solid ${track.tagColor};">
        <div class="track-card-top">
          <div class="track-card-badge-row">
            <span class="track-genre-badge" style="background: ${track.tagColor}26; color: ${track.tagColor}; border: 1px solid ${track.tagColor}4d;">
              ${escapeHtml(track.genre)}
            </span>
            ${isRealAudio ? `<span style="font-size: 10px; font-weight: 800; color: #10b981; background: rgba(16, 185, 129, 0.15); padding: 2px 6px; border-radius: 6px;">🎧 실제 음원</span>` : ""}
          </div>
          <div class="track-card-title">${escapeHtml(track.title)}</div>
        </div>
        <div class="track-card-meta">
          <span class="track-bpm-tag">🎵 ${track.bpm} BPM</span>
          <button id="previewBtn_${track.id}" class="track-preview-btn" data-preview-id="${track.id}">
            ▶ 미리듣기
          </button>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  // 카드 클릭 이벤트
  listEl.querySelectorAll(".beat-track-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".track-preview-btn")) return;
      const tid = card.dataset.trackId;
      selectedBeatTrackId = tid;
      listEl.querySelectorAll(".beat-track-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      const track = BEAT_TRACKS.find((t) => t.id === tid);
      updateBeatSelectedInfo(track);
      sfx.tick?.();
    });
  });

  // 미리듣기 버튼 이벤트
  listEl.querySelectorAll(".track-preview-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tid = btn.dataset.previewId;
      const track = BEAT_TRACKS.find((t) => t.id === tid);
      if (track) playTrackPreview(track);
    });
  });

  const curTrack = BEAT_TRACKS.find((t) => t.id === selectedBeatTrackId);
  updateBeatSelectedInfo(curTrack);

  modal.classList.remove("hidden");
}

function closeBeatTrackSelector() {
  stopTrackPreview();
  $("beatTrackModal")?.classList.add("hidden");
}

// 모달 이벤트 바인딩
// 곡 선택을 취소하면 켜 둔 카메라도 끔 (시작할 때는 closeBeatTrackSelector만 호출하므로 카메라 유지)
$("beatModalClose")?.addEventListener("click", () => { closeBeatTrackSelector(); scheduleCameraStop(); });
$("beatModalCancel")?.addEventListener("click", () => { closeBeatTrackSelector(); scheduleCameraStop(); });
$("beatModalStart")?.addEventListener("click", () => {
  closeBeatTrackSelector();
  games.beat.chosenTrackId = selectedBeatTrackId;
  startGame("beat");
});

// 📂 내 컴퓨터의 실제 MP3 노래 불러오기 (비트세이버 커스텀 송 로더)
const customAudioInput = $("customAudioInput");
const btnCustomMusic = $("btnCustomMusic");
btnCustomMusic?.addEventListener("click", () => {
  customAudioInput?.click();
});
customAudioInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const blobUrl = URL.createObjectURL(file);
    const fileName = file.name.replace(/\.[^/.]+$/, "");
    const customTrack = {
      id: "custom_" + Date.now(),
      title: "🎵 " + fileName,
      genre: "CUSTOM USER MP3",
      bpm: 136,
      firstBeat: 0.30,
      approachTime: 1.7,
      root: 261.63,
      audioFile: blobUrl,
      drums: "edm",
      vol: 0.95,
      noteSpeed: 1.15,
      tagColor: "#ec4899"
    };
    BEAT_TRACKS.unshift(customTrack);
    selectedBeatTrackId = customTrack.id;
    openBeatTrackSelector();
    popup(W / 2, H * 0.45, `📂 내 노래 불러오기 완료: ${fileName}`, "#ec4899");
    speak("내 노래가 준비되었습니다! 시작 버튼을 눌러주세요!");
  } catch (err) {
    console.error("MP3 파일 로드 실패:", err);
    alert("오디오 파일을 불러오지 못했습니다.");
  }
});

// 게임 시작 (카메라/인식 준비 -> 시작). 메뉴 버튼과 온라인 대결이 같이 써요. 시작하지 못하면 false.
async function launchGame(modeName, opts = {}) {
  useMouse = $("useMouse").checked;
  if (!useMouse) {
    if (!(await ensureVideo())) return false;
    if (!(await ensureModel(games[modeName].body ? "pose" : "hand"))) return false;
  }
  if (modeName === "beat" && !opts.online) {
    // 🎵 네온 노트 슬래시는 펌프 스타일 아케이드 트랙 선택 모달 열기! (온라인 대결은 방장이 이미 곡을 골랐어요)
    openBeatTrackSelector();
    return true;
  }
  startGame(modeName, opts);
  return true;
}
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => launchGame(b.dataset.mode)));
// 카드의 아무 곳이나 눌러도 게임 시작
document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", (e) => { if (!e.target.closest(".mode")) c.querySelector(".mode")?.click(); }));
$("again").onclick = () => {
  if (bus.onlineActive) { bus.emit("online:rematch"); return; }   // 온라인 대결 중: 상대와 서로 눌러야 다시 시작 (재대결)
  startGame(mode);                                                // 혼자: 이전에 고른 곡 유지하여 즉시 재도전
};
$("toMenu").onclick = toMenu;
$("quit").onclick = toMenu;

// TV / 대화면 전체화면 토글 (iOS Safari, iPad, 스마트TV, 데스크톱 크로스 브라우징)
function isFullscreenActive() {
  const doc = document;
  return Boolean(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    doc.body.classList.contains("tv-fullscreen-mode")
  );
}

function updateFullscreenButtons() {
  const isFs = isFullscreenActive();
  const hubBtn = $("btnFsHub");
  const hudBtn = $("btnFsHud");

  [hubBtn, hudBtn].forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle("fs-active", isFs);
    const enterIcon = btn.querySelector(".fs-icon-enter");
    const exitIcon = btn.querySelector(".fs-icon-exit");
    if (enterIcon && exitIcon) {
      enterIcon.classList.toggle("hidden", isFs);
      exitIcon.classList.toggle("hidden", !isFs);
    }
  });

  if (hubBtn) {
    const textEl = hubBtn.querySelector(".fs-text");
    if (textEl) textEl.textContent = isFs ? "전체화면 해제" : "TV 전체화면";
    hubBtn.title = isFs ? "전체화면 해제" : "TV/대화면 전체화면";
  }
  if (hudBtn) {
    hudBtn.title = isFs ? "전체화면 해제" : "TV/대화면 전체화면";
  }
}

async function toggleFullscreen() {
  try { sfx.tick(); } catch {}
  const doc = document;
  const body = doc.body;
  const el = doc.documentElement;
  const isFs = isFullscreenActive();

  if (!isFs) {
    // 1) 어떤 기기(스마트TV, 태블릿, PC)에서도 즉각 100vw, 100vh 꽉 채우는 가상 전체화면 가동
    body.classList.add("tv-fullscreen-mode");

    // 2) 브라우저 네이티브 Fullscreen API 지원 시 동시 호출 (F11 효과)
    const reqFn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (reqFn) {
      try {
        const p = reqFn.call(el);
        if (p && p.catch) p.catch(() => {});
      } catch (err) {
        console.warn("Fullscreen API 제한 -> 가상 TV 모드로 동작:", err);
      }
    }
    popup(W / 2, H * 0.45, "📺 TV 전체화면 켜짐!", "#00d2ff");
  } else {
    // 해제: 가상 전체화면 해제
    body.classList.remove("tv-fullscreen-mode");

    // 네이티브 Fullscreen API 해제
    const exitFn = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
    if (exitFn && (doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement)) {
      try {
        const p = exitFn.call(doc);
        if (p && p.catch) p.catch(() => {});
      } catch {}
    }
    popup(W / 2, H * 0.45, "전체화면 해제됨", "#ffd166");
  }

  updateFullscreenButtons();
  // 캔버스 해상도 및 뷰포트 즉시 리사이징
  try { resize(); } catch {}
  setTimeout(() => { try { resize(); } catch {} }, 60);
  setTimeout(() => { try { resize(); } catch {} }, 200);
}

updateFullscreenButtons();
$("btnFsHub")?.addEventListener("click", toggleFullscreen);
$("btnFsHud")?.addEventListener("click", toggleFullscreen);

// ESC 키나 브라우저 제스처로 전체화면이 변경되었을 때 버튼 상태 자동 동기화
["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((evt) => {
  document.addEventListener(evt, () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      document.body.classList.remove("tv-fullscreen-mode");
    }
    updateFullscreenButtons();
    try { resize(); } catch {}
  });
});

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
// 메뉴: 전체 / 손놀이 / 몸놀이 탭 (마지막으로 본 탭을 기억)
const TAB_HINT = {
  all: "⭐ 13종의 모든 모션 액션 아케이드 파티 게임을 자유롭게 플레이하세요!",
  hand: "👋 손놀이: 카메라 앞에서 손으로 화면을 건드려 보세요. 영상은 이 기기 밖으로 나가지 않아요.",
  body: "🏃 몸놀이: 머리부터 발끝까지 보이게 한두 걸음 뒤로 물러서 주세요. 영상은 이 기기 밖으로 나가지 않아요.",
};
function setTab(t) {
  t = t || "all";
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".modes").forEach((m) => {
    if (t === "all") {
      m.classList.remove("hidden");
    } else {
      m.classList.toggle("hidden", m.dataset.cat !== t);
    }
  });
  $("tabHint").textContent = TAB_HINT[t] || TAB_HINT.all;
  try { localStorage.setItem("tab", t); } catch {}
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
setTab((() => { try { return localStorage.getItem("tab") || "all"; } catch { return "all"; } })());

// ============================================================================
// 🎮 플레이어 설정 모달 (Player Settings Modal) UI 컨트롤러 & 이벤트 바인딩
// ============================================================================
const RANDOM_ARCADE_NICKS = [
  "P1 Leo", "네온닌자 Leo", "비트슬래셔 Jin", "사이버워커 Sora", 
  "광속질주 Kai", "스타로드 Mina", "메가비트 Rex", "하이퍼점퍼 Luna", 
  "질주폭풍 Zack", "블레이즈 Aron", "스피드스타 Ryu", "펄스헌터 Yuna"
];

function setupPlayerSettingsModalUI() {
  const modal = $("playerSettingsModal");
  if (!modal) return;

  const btnProfile = $("btnPlayerProfile");
  const btnClose = $("settingsModalClose");
  const btnSave = $("btnSettingsSave");
  const btnReset = $("btnSettingsReset");
  const btnRandom = $("btnRandomNick");

  // 1. 모달 열기 & 현재 설정값으로 폼 동기화
  function openModal() {
    loadPlayerSettings(); // 저장된 최신 상태 동기화

    // 프로필 탭 동기화
    const nickInp = $("settingNickname");
    if (nickInp) nickInp.value = playerSettings.nickname || "P1 Leo";
    const titleSel = $("settingTitle");
    if (titleSel) titleSel.value = playerSettings.title || "PARTY LEADER";

    // 아바타 카드 활성화 상태 동기화
    document.querySelectorAll(".avatar-option-card").forEach((card) => {
      const isMatch = card.dataset.avatarId === playerSettings.avatarId;
      card.classList.toggle("active", isMatch);
    });

    // 신장/체격 라디오 동기화
    const isChild = playerSettings.heightMode === "child";
    const rAdult = document.querySelector('input[name="settingHeightMode"][value="adult"]');
    const rChild = document.querySelector('input[name="settingHeightMode"][value="child"]');
    if (rAdult) rAdult.checked = !isChild;
    if (rChild) rChild.checked = isChild;
    $("cardHeightAdult")?.classList.toggle("active", !isChild);
    $("cardHeightChild")?.classList.toggle("active", isChild);

    // 모션 슬라이더 & 체크박스 동기화
    const reachInp = $("settingReachSlider");
    if (reachInp) {
      reachInp.value = playerSettings.reach;
      if ($("settingReachVal")) $("settingReachVal").textContent = `${playerSettings.reach}px`;
    }
    const chkMirror = $("settingMirror");
    if (chkMirror) chkMirror.checked = playerSettings.mirror !== false;
    const chkSkel = $("settingSkeleton");
    if (chkSkel) chkSkel.checked = playerSettings.skeleton !== false;
    const chkMouse = $("settingMouseMode");
    if (chkMouse) chkMouse.checked = !!playerSettings.mouseMode;

    // 사운드 슬라이더 & 스위치 동기화
    const bgmInp = $("settingBgmSlider");
    if (bgmInp) {
      bgmInp.value = playerSettings.bgmVol;
      if ($("settingBgmVal")) $("settingBgmVal").textContent = `${playerSettings.bgmVol}%`;
    }
    const sfxInp = $("settingSfxSlider");
    if (sfxInp) {
      sfxInp.value = playerSettings.sfxVol;
      if ($("settingSfxVal")) $("settingSfxVal").textContent = `${playerSettings.sfxVol}%`;
    }
    const chkMaster = $("settingSoundOn");
    if (chkMaster) chkMaster.checked = playerSettings.soundOn !== false;
    const chkVoice = $("settingVoiceGuide");
    if (chkVoice) chkVoice.checked = playerSettings.voiceGuide !== false;

    // 기본 첫 탭(프로필) 활성화
    switchSettingsTab("profile");

    renderProfileUI();
    modal.classList.remove("hidden");
    try { tone(520, actx?.currentTime || 0, 0.05, "sine", 0.12); } catch {}
  }

  function closeModal() {
    modal.classList.add("hidden");
  }
  document.addEventListener("profile:changed", () => { if (!modal.classList.contains("hidden")) openModal(); });

  // 2. 탭 전환 핸들러
  function switchSettingsTab(tabName) {
    document.querySelectorAll(".settings-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.stab === tabName);
    });
    const paneMap = { profile: "stabProfile", motion: "stabMotion", sound: "stabSound" };
    Object.entries(paneMap).forEach(([k, paneId]) => {
      $(paneId)?.classList.toggle("hidden", k !== tabName);
    });
  }

  document.querySelectorAll(".settings-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchSettingsTab(btn.dataset.stab);
      try { tone(480, actx?.currentTime || 0, 0.03, "sine", 0.08); } catch {}
    });
  });

  // 3. 아바타 카드 선택 인터랙션
  document.querySelectorAll(".avatar-option-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".avatar-option-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      try { tone(620, actx?.currentTime || 0, 0.04, "triangle", 0.1); } catch {}
    });
  });

  // 4. 신장 라디오 카드 선택 인터랙션
  document.querySelectorAll('input[name="settingHeightMode"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const isAdult = e.target.value === "adult";
      $("cardHeightAdult")?.classList.toggle("active", isAdult);
      $("cardHeightChild")?.classList.toggle("active", !isAdult);
    });
  });

  // 5. 실시간 슬라이더 값 라벨 동기화
  $("settingReachSlider")?.addEventListener("input", (e) => {
    if ($("settingReachVal")) $("settingReachVal").textContent = `${e.target.value}px`;
  });
  $("settingBgmSlider")?.addEventListener("input", (e) => {
    if ($("settingBgmVal")) $("settingBgmVal").textContent = `${e.target.value}%`;
  });
  $("settingSfxSlider")?.addEventListener("input", (e) => {
    if ($("settingSfxVal")) $("settingSfxVal").textContent = `${e.target.value}%`;
  });

  // 6. 주사위 🎲 랜덤 닉네임 생성 버튼
  btnRandom?.addEventListener("click", () => {
    const nickInp = $("settingNickname");
    if (nickInp) {
      const rand = RANDOM_ARCADE_NICKS[Math.floor(Math.random() * RANDOM_ARCADE_NICKS.length)];
      nickInp.value = rand;
      try { tone(740, actx?.currentTime || 0, 0.05, "triangle", 0.14); } catch {}
    }
  });

  // 7. 설정 저장 및 실시간 적용
  btnSave?.addEventListener("click", () => {
    // 🔒 Zero-Trust Sanitization: 닉네임 XSS 방지
    const rawNick = $("settingNickname")?.value || DEFAULT_PLAYER_SETTINGS.nickname;
    playerSettings.nickname = rawNick.replace(/[<>&"']/g, "").trim().slice(0, 14) || DEFAULT_PLAYER_SETTINGS.nickname;
    playerSettings.title = $("settingTitle")?.value || DEFAULT_PLAYER_SETTINGS.title;

    // 선택된 아바타 추출
    const activeAvatarCard = document.querySelector(".avatar-option-card.active");
    if (activeAvatarCard) {
      playerSettings.avatar = activeAvatarCard.dataset.avatar || DEFAULT_PLAYER_SETTINGS.avatar;
      playerSettings.avatarId = activeAvatarCard.dataset.avatarId || DEFAULT_PLAYER_SETTINGS.avatarId;
    }

    // 신장/체격 모드 추출
    const selHeightRadio = document.querySelector('input[name="settingHeightMode"]:checked');
    playerSettings.heightMode = selHeightRadio?.value === "child" ? "child" : "adult";

    // 도달 범위 및 모션 설정 추출
    playerSettings.reach = Math.max(20, Math.min(65, parseInt($("settingReachSlider")?.value || 35, 10)));
    playerSettings.mirror = $("settingMirror")?.checked !== false;
    playerSettings.skeleton = $("settingSkeleton")?.checked !== false;
    playerSettings.mouseMode = !!$("settingMouseMode")?.checked;

    // 사운드 설정 추출
    playerSettings.bgmVol = Math.max(0, Math.min(100, parseInt($("settingBgmSlider")?.value || 80, 10)));
    playerSettings.sfxVol = Math.max(0, Math.min(100, parseInt($("settingSfxSlider")?.value || 90, 10)));
    playerSettings.soundOn = $("settingSoundOn")?.checked !== false;
    playerSettings.voiceGuide = $("settingVoiceGuide")?.checked !== false;

    // 로컬 스토리지 안전 저장 및 전역 엔진 적용
    savePlayerSettings();

    // 저장 완료 피드백 사운드
    try {
      tone(523, actx?.currentTime || 0, 0.06, "sine", 0.15);
      tone(659, (actx?.currentTime || 0) + 0.06, 0.08, "sine", 0.18);
      tone(784, (actx?.currentTime || 0) + 0.12, 0.14, "sine", 0.22);
    } catch {}

    closeModal();
  });

  // 8. 설정 초기화 버튼
  btnReset?.addEventListener("click", () => {
    playerSettings = { ...DEFAULT_PLAYER_SETTINGS };
    savePlayerSettings();
    openModal(); // 초기화된 값으로 모달 다시 동기화
    try { tone(400, actx?.currentTime || 0, 0.08, "sawtooth", 0.15); } catch {}
  });

  // 9. 모달 오픈 / 닫기 트리거 등록
  btnProfile?.addEventListener("click", openModal);
  btnClose?.addEventListener("click", closeModal);

  // 모달 바깥 딤 클릭 시 닫기
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // ESC 키로 닫기
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

// ---------- 👨‍👩‍👧 가족 프로필 전환 / 추가 / 삭제 ----------
function switchProfile(id) {
  if (!profiles || !profiles.setActive(id)) return false;
  const p = profiles.active;
  playerSettings.nickname = p.nickname; playerSettings.title = p.title; playerSettings.avatar = p.avatar; playerSettings.avatarId = p.avatarId;
  savePlayerSettings();                      // 헤더의 닉네임/아바타에 반영
  showBest();                                // 카드의 최고 기록도 이 사람 것으로
  renderProfileUI();
  document.dispatchEvent(new CustomEvent("profile:changed"));
  return true;
}
function addProfile() {
  const p = profiles?.add();
  if (!p) { popup(W / 2, H * 0.4, "프로필은 최대 6명까지예요", "#ffd166"); return; }
  switchProfile(p.id);
}
function deleteProfile(id) {
  if (!profiles || profiles.list.length <= 1) return;
  const name = profiles.get(id)?.nickname ?? "";
  if (!confirm(`'${name}' 프로필과 그 사람의 기록을 모두 지울까요?\n(되돌릴 수 없어요)`)) return;
  const next = profiles.remove(id);
  if (next) { switchProfile(next); showBest(); }
}
function renderProfileUI() {
  const chips = $("profileChips"), menu = $("profileMenuList");
  const multi = !!profiles;
  $("profileSection")?.classList.toggle("hidden", !multi);
  $("btnProfileSwitch")?.classList.toggle("hidden", !multi);
  if (!multi) return;
  const fill = (host, withDelete) => {
    if (!host) return;
    host.textContent = "";
    for (const p of profiles.list) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "profile-chip" + (p.id === profiles.activeId ? " active" : "");
      const img = document.createElement("img"); img.src = p.avatar; img.alt = ""; img.width = 28; img.height = 28;
      const nm = document.createElement("span"); nm.textContent = p.nickname;
      b.append(img, nm);
      b.addEventListener("click", () => { switchProfile(p.id); if (!withDelete) $("profileMenu")?.classList.add("hidden"); });
      host.append(b);
    }
  };
  fill(chips, true); fill(menu, false);
  const del = $("btnProfileDelete"); if (del) del.disabled = profiles.list.length <= 1;
  const add = $("btnProfileAdd"); if (add) add.disabled = profiles.list.length >= 6;
}
function setupProfileSwitcher() {
  $("btnProfileAdd")?.addEventListener("click", addProfile);
  $("btnProfileDelete")?.addEventListener("click", () => deleteProfile(profiles.activeId));
  $("btnProfileSwitch")?.addEventListener("click", (e) => { e.stopPropagation(); renderProfileUI(); $("profileMenu")?.classList.toggle("hidden"); });
  $("btnProfileMenuAdd")?.addEventListener("click", () => { $("profileMenu")?.classList.add("hidden"); addProfile(); });
  document.addEventListener("click", (e) => { if (!e.target.closest?.("#profileMenu, #btnProfileSwitch")) $("profileMenu")?.classList.add("hidden"); });
  $("t10Mine")?.addEventListener("click", () => showTop10Tab("mine"));
  $("t10Family")?.addEventListener("click", () => showTop10Tab("family"));
  renderProfileUI();
}

// 초기화 시점 실행
loadPlayerSettings();
// 처음이면 지금 닉네임/아바타로 첫 프로필(p1)을 만들고, 이후엔 마지막으로 쓴 프로필을 이어서 써요 (예전 기록은 p1이 그대로 이어받음)
try { profiles = new ProfileStore(localStorage, playerSettings); } catch { profiles = null; }
if (profiles) { const p = profiles.active; playerSettings.nickname = p.nickname; playerSettings.title = p.title; playerSettings.avatar = p.avatar; playerSettings.avatarId = p.avatarId; applyPlayerSettings(); }
setupPlayerSettingsModalUI();
setupProfileSwitcher();

// 📷 첫 실행 안내(카메라 세팅): 위치/밝기 안내와 손·몸이 잘 보이는지 확인. 카메라와 인식 모델은 여기서 빌려줘요.
const setupGuide = initSetupGuide({
  startCamera: async (kind) => (await ensureVideo()) && (await ensureModel(kind === "body" ? "pose" : "hand")),
  stopCamera,
  getStream: () => video.srcObject,
  detect: (kind) => {
    try {
      if (video.readyState < 2) return null;
      const k = kind === "body" ? "pose" : "hand";
      if (visionAI.ready(k)) {                                    // ⚡ 작업자 결과 보기 (화면 안 멈춤)
        visionAI.setActive(k);
        const r = visionAI.peek(k)?.result;
        return k === "pose" ? (r?.landmarks?.[0] ?? null) : (r?.landmarks ?? []);
      }
      if (kind === "body") return poseLandmarker?.detectForVideo(video, performance.now()).landmarks?.[0] ?? null;
      return handLandmarker?.detectForVideo(video, performance.now()).landmarks ?? [];
    } catch { return null; }
  },
});
if (setupGuide?.shouldAutoOpen() && !playerSettings.mouseMode) setTimeout(() => setupGuide.open(), 900);   // 처음 한 번만 자동으로 보여 줌

// 👥 온라인 대결(친구와 대결) 화면 연결. 이 한 줄을 지워도 혼자 하기는 그대로 동작해요.
initOnline({
  getProfile: () => ({ name: playerSettings.nickname, avatar: playerSettings.avatar }),
  launch: (m, opts) => launchGame(m, opts),
  getBeatTracks: () => BEAT_TRACKS.filter((t) => !String(t.id).startsWith("custom_")).map((t) => ({ id: t.id, title: t.title })),
});

// ============================================================================
// 👗 모션 캐릭터 커스튬 & 나노 슈트업 & 미러 아바타 버디 시스템 (Costume & Buddy Engine)
// ============================================================================

// 1. 전체 커스튬 아이템 카탈로그 (12개 게임 고유 1~3등 랭킹 독점 세트 + 기본 파츠)
const COSTUME_ITEMS = {
  // --- [기본 제공 공통 파츠] ---
  head_crown: {
    id: "head_crown", name: "네온 골든 크라운", slot: "head", tier: "common",
    icon: "👑", desc: "빛나는 황금 네온 왕관. 머리 위에서 부드럽게 떠올라요.",
    color: "#ffb800"
  },
  body_nano: {
    id: "body_nano", name: "나노 티타늄 체스트", slot: "body", tier: "common",
    icon: "🦺", desc: "아이언맨 스타일의 나노 아머 흉부 플레이트.",
    color: "#e1037d"
  },
  back_angel: {
    id: "back_angel", name: "네온 엔젤 윙", slot: "back", tier: "common",
    icon: "🪽", desc: "등 뒤에서 펄럭이는 빛나는 사이버 천사의 날개.",
    color: "#00d2ff"
  },
  hand_repulsor: {
    id: "hand_repulsor", name: "플라즈마 리펄서", slot: "hand", tier: "common", price: 45000,
    icon: "🦾", desc: "손바닥에서 고압 플라즈마 에너지를 뿜어내는 건틀렛.",
    color: "#00d2ff"
  },

  // --- [🤣 유쾌한 개그 & 단품 패션 아이템 컬렉션] ---
  face_mustache: {
    id: "face_mustache", name: "마리오 특대 콧수염", slot: "face", tier: "common", price: 45000,
    icon: "🥸", desc: "코 밑에 착! 달라붙는 풍성하고 유쾌한 신사의 콧수염.", color: "#8b5a2b"
  },
  face_clown_nose: {
    id: "face_clown_nose", name: "피에로 딸기코 & 미소", slot: "face", tier: "common", price: 38000,
    icon: "🤡", desc: "코끝에서 삑삑 소리가 날 것 같은 새빨간 피에로 루돌프 코.", color: "#ff2e4c"
  },
  face_thug_glasses: {
    id: "face_thug_glasses", name: "8비트 스웩 픽셀 선글라스", slot: "face", tier: "rare", price: 140000,
    icon: "😎", desc: "착용 즉시 힙스터로 변신하는 레트로 도트 선글라스.", color: "#ffffff"
  },
  head_poop: {
    id: "head_poop", name: "황금 또옹 모자", slot: "head", tier: "rare", price: 160000,
    icon: "💩", desc: "머리 위에서 찬란하게 소용돌이치는 황금빛 똥 모자! 인기 폭발!", color: "#ffd700"
  },
  head_chicken: {
    id: "head_chicken", name: "꼬꼬댁 닭벼슬 모자", slot: "head", tier: "common", price: 48000,
    icon: "🐔", desc: "움직일 때마다 닭벼슬이 팔랑팔랑 춤추는 유쾌한 치킨 모자.", color: "#ff3344"
  },
  head_chef: {
    id: "head_chef", name: "미슐랭 셰프 요리사 모자", slot: "head", tier: "common", price: 42000,
    icon: "👨‍🍳", desc: "머리 위로 길게 솟아오른 새하얀 마스터 요리사 모자.", color: "#ffffff"
  },
  head_frog: {
    id: "head_frog", name: "개구리 왕눈이 헤드", slot: "head", tier: "common", price: 50000,
    icon: "🐸", desc: "양쪽에 큼직한 왕눈이가 달린 귀여운 초록 개구리 모자.", color: "#22c55e"
  },
  head_cat_neon: {
    id: "head_cat_neon", name: "네온 캣 이어 헤드밴드", slot: "head", tier: "common", price: 46000,
    icon: "🐱", desc: "고양이 귀 모양으로 발광하는 귀여운 네온 헤어밴드. 움직일 때마다 깜빡여요.", color: "#ff2e93"
  },
  head_cowboy_cyber: {
    id: "head_cowboy_cyber", name: "사이버 카우보이 모자", slot: "head", tier: "common", price: 55000,
    icon: "🤠", desc: "홀로그램 챙이 빛나는 서부 개척자 스타일 카우보이햇.", color: "#ffb800"
  },
  hand_rubber_gloves: {
    id: "hand_rubber_gloves", name: "엄마의 핑크 고무장갑", slot: "hand", tier: "common", price: 35000,
    icon: "🧤", desc: "설거지하다 뛰어나온 듯한 강렬한 형광 핫핑크 고무장갑.", color: "#ff2e93"
  },
  hand_toy_hammer: {
    id: "hand_toy_hammer", name: "대왕 뿅망치", slot: "hand", tier: "rare", price: 150000,
    icon: "🔨", desc: "때릴 때마다 삑삑 소리가 날 것 같은 큼직한 노란 뿅망치.", color: "#ffb800"
  },
  hand_drumstick: {
    id: "hand_drumstick", name: "특대 바삭 크리스피 닭다리", slot: "hand", tier: "hero", price: 360000,
    icon: "🍗", desc: "무기로 휘두르기엔 너무 맛있어 보이는 바삭바삭 황금 닭다리.", color: "#d97706"
  },
  body_rainbow_tee: {
    id: "body_rainbow_tee", name: "무지개 삼선 쫄티", slot: "body", tier: "common", price: 55000,
    icon: "👕", desc: "신체 굴곡에 착 달라붙는 알록달록 레트로 무지개 티셔츠.", color: "#00d2ff"
  },
  body_hawaiian: {
    id: "body_hawaiian", name: "하와이안 꽃무늬 바캉스 셔츠", slot: "body", tier: "rare", price: 165000,
    icon: "🌺", desc: "시원한 야자수와 붉은 하이비스커스 꽃이 만발한 바캉스 셔츠.", color: "#f43f5e"
  },
  legs_boxer_shorts: {
    id: "legs_boxer_shorts", name: "빨간 땡땡이 사각팬티", slot: "legs", tier: "rare", price: 135000,
    icon: "🩲", desc: "흰 바탕에 강렬한 빨간 땡땡이 무늬가 수놓아진 개그 필수 팬티.", color: "#ef4444"
  },
  legs_disco_pants: {
    id: "legs_disco_pants", name: "반짝이 디스코 나팔바지", slot: "legs", tier: "hero", price: 380000,
    icon: "👖", desc: "무릎 아래로 활짝 퍼지는 70년대 복고풍 펄 반짝이 바지.", color: "#8b5cf6"
  },
  feet_slippers: {
    id: "feet_slippers", name: "동네 삼선 초록 슬리퍼", slot: "feet", tier: "common", price: 32000,
    icon: "🩴", desc: "한국인의 소울웨어! 동네 편의점 갈 때 필수인 삼선 슬리퍼.", color: "#10b981"
  },
  feet_duck_shoes: {
    id: "feet_duck_shoes", name: "꽥꽥 노랑 오리 슬리퍼", slot: "feet", tier: "rare", price: 130000,
    icon: "🦆", desc: "발을 내딛을 때마다 꽥꽥거리는 깜찍한 노란 아기오리 슬리퍼.", color: "#eab308"
  },
  back_pixel_wings: {
    id: "back_pixel_wings", name: "8비트 픽셀 날개", slot: "back", tier: "rare", price: 145000,
    icon: "👾", desc: "아케이드 감성 가득한 레트로 픽셀 도트 날개.", color: "#00ffcc"
  },
  aura_fireworks: {
    id: "aura_fireworks", name: "축제 네온 불꽃놀이 오라", slot: "aura", tier: "hero", price: 390000,
    icon: "🎆", desc: "움직일 때마다 사방으로 네온 불꽃이 팡팡 터지는 화려한 오라.", color: "#ffd700"
  },

  // --- [1. 야구 게임 (baseball)] ---
  bat_gold: {
    id: "bat_gold", name: "골든 슬러거 배트", slot: "hand", tier: "legend",
    icon: "⚡", desc: "1등 최고급 독점! 장외 홈런을 터뜨리는 전설의 골든 배트. 1등을 뺏기면 회수됩니다.",
    color: "#ffd700", game: "baseball"
  },
  cap_cyber: {
    id: "cap_cyber", name: "사이버 홈런 캡", slot: "head", tier: "hero",
    icon: "🧢", desc: "2등 중고급 독점! 레이저 바이저가 장착된 미래형 야구 모자.",
    color: "#00d2ff", game: "baseball"
  },
  jersey_neon: {
    id: "jersey_neon", name: "네온 베이스볼 저지", slot: "body", tier: "rare",
    icon: "👕", desc: "3등 보급형 독점! 네온 스트라이프가 숨 쉬듯 깜빡이는 야구 유니폼.",
    color: "#ff2e93", game: "baseball"
  },

  // --- [2. 쿵푸 대전 (kungfu)] ---
  aura_dragon: {
    id: "aura_dragon", name: "비룡 용오름 각성 오라", slot: "aura", tier: "legend",
    icon: "🐉", desc: "1등 최고급 독점! 전신을 휘감으며 회전하는 전설의 푸른 용오름 기운. 1등 상징 복장.",
    color: "#00d2ff", game: "kungfu"
  },
  robe_master: {
    id: "robe_master", name: "그랜드마스터 비룡 도복", slot: "body", tier: "hero",
    icon: "🥋", desc: "2등 중고급 독점! 황금 용의 문양이 수놓아진 붉은빛 쿵푸 마스터 도복.",
    color: "#ff4d5e", game: "kungfu"
  },
  gloves_tiger: {
    id: "gloves_tiger", name: "맹호 건틀렛", slot: "hand", tier: "rare",
    icon: "🐅", desc: "3등 보급형 독점! 호랑이의 발톱 모양 화염 이펙트를 뿜는 건틀렛.",
    color: "#ff8a3d", game: "kungfu"
  },

  // --- [3. 몸게임 러너 (runner)] ---
  back_jetpack: {
    id: "back_jetpack", name: "사이버 부스터 제트팩", slot: "back", tier: "legend",
    icon: "🚀", desc: "1등 최고급 독점! 등 뒤에서 고출력 플라즈마 화염을 분사하는 1등 전용 제트팩.",
    color: "#00d2ff", game: "runner"
  },
  helm_visor: {
    id: "helm_visor", name: "홀로그램 러너 바이저", slot: "head", tier: "hero",
    icon: "🥽", desc: "2등 중고급 독점! 장애물 궤적을 실시간으로 분석해주는 스마트 고글.",
    color: "#22c55e", game: "runner"
  },
  shoes_neon: {
    id: "shoes_neon", name: "하이퍼 펄스 스니커즈", slot: "aura", tier: "rare",
    icon: "👟", desc: "3등 보급형 독점! 발밑에서 번개 파티클이 터져 나오는 초고속 신발.",
    color: "#ffb800", game: "runner"
  },

  // --- [4. 비트 슬래시 (beat)] ---
  hand_sabers: {
    id: "hand_sabers", name: "듀얼 플라즈마 빔 세이버", slot: "hand", tier: "legend",
    icon: "⚔️", desc: "1등 최고급 독점! 1등 챔피언만 쥘 수 있는 시안 & 마젠타 쌍검 세이버.",
    color: "#ff0055", game: "beat"
  },
  head_phones: {
    id: "head_phones", name: "사이버 비트 헤드폰", slot: "head", tier: "hero",
    icon: "🎧", desc: "2등 중고급 독점! 음악 비트에 맞춰 양쪽 링이 펄스 발광하는 헤드셋.",
    color: "#a855f7", game: "beat"
  },
  back_cape: {
    id: "back_cape", name: "신스웨이브 네온 망토", slot: "back", tier: "rare",
    icon: "🧣", desc: "3등 보급형 독점! 움직일 때마다 빛나는 디지털 격자 잔상을 남기는 망토.",
    color: "#e1037d", game: "beat"
  },

  // --- [5. 복싱 펀치백 (box)] ---
  hand_firebox: {
    id: "hand_firebox", name: "불꽃 타이거 글러브", slot: "hand", tier: "legend",
    icon: "🔥", desc: "1등 최고급 독점! 펀치 때마다 대폭발 화염탄이 튀는 1등 챔피언 글러브.",
    color: "#ff3344", game: "box"
  },
  body_belt: {
    id: "body_belt", name: "챔피언 골든 벨트", slot: "body", tier: "hero",
    icon: "🥊", desc: "2등 중고급 독점! 허리에서 찬란한 황금빛 별들이 뿜어져 나오는 챔피언 벨트.",
    color: "#ffd700", game: "box"
  },
  head_guard: {
    id: "head_guard", name: "사이버 파이터 헤드기어", slot: "head", tier: "rare",
    icon: "⛑️", desc: "3등 보급형 독점! 충격을 흡수하는 강철 네온 가드 헬멧.",
    color: "#ff4b72", game: "box"
  },

  // --- [6. 과일 닌자 (ninja)] ---
  hand_katana: {
    id: "hand_katana", name: "그림자 닌자 카타나", slot: "hand", tier: "legend",
    icon: "🗡️", desc: "1등 최고급 독점! 허공을 베면 벚꽃과 검은 번개가 흩날리는 1등 닌자 명검.",
    color: "#8c7cff", game: "ninja"
  },
  head_foxmask: {
    id: "head_foxmask", name: "네온 여우 가면", slot: "head", tier: "hero",
    icon: "🦊", desc: "2등 중고급 독점! 붉은 요호의 불꽃 안광이 서린 전통 네온 가면.",
    color: "#ff5500", game: "ninja"
  },
  body_shinobi: {
    id: "body_shinobi", name: "시노비 닌자 도포", slot: "body", tier: "rare",
    icon: "🥷", desc: "3등 보급형 독점! 바람처럼 가볍고 은밀한 그림자 암살자 의상.",
    color: "#3b2d54", game: "ninja"
  },

  // --- [7. 우주 유성 (space)] ---
  hand_shield: {
    id: "hand_shield", name: "은하 플라즈마 실드", slot: "hand", tier: "legend",
    icon: "🛡️", desc: "1등 최고급 독점! 성운과 은하수를 축소해 놓은 1등 지구 수호 방패.",
    color: "#00d2ff", game: "space"
  },
  head_astro: {
    id: "head_astro", name: "우주 탐사대 헬멧", slot: "head", tier: "hero",
    icon: "👨‍🚀", desc: "2등 중고급 독점! 별빛이 반사되는 황금 바이저 우주비행사 헬멧.",
    color: "#ffd166", game: "space"
  },
  back_wings: {
    id: "back_wings", name: "스타더스트 코스믹 윙", slot: "back", tier: "rare",
    icon: "🪽", desc: "3등 보급형 독점! 은하수 먼지로 직조된 투명한 우주 나비 날개.",
    color: "#c26bff", game: "space"
  },

  // --- [8. 네온 벽돌깨기 (brick)] ---
  hand_laserpaddle: {
    id: "hand_laserpaddle", name: "네온 플라즈마 패들", slot: "hand", tier: "legend",
    icon: "🧱", desc: "1등 최고급 독점! 고압 레이저 빔을 뿜어 공을 초광속 반사하는 패들.",
    color: "#19e6c3", game: "brick"
  },
  helm_cyber: {
    id: "helm_cyber", name: "사이버 그리드 헬멧", slot: "head", tier: "hero",
    icon: "🤖", desc: "2등 중고급 독점! 벽돌 반사각을 예측하는 사이버 로봇 헬멧.",
    color: "#00d2ff", game: "brick"
  },
  aura_neonspark: {
    id: "aura_neonspark", name: "에너지 스파크 오라", slot: "aura", tier: "rare",
    icon: "⚡", desc: "3등 보급형 독점! 전신에서 정전기 네온 스파크가 튀는 오라.",
    color: "#ffd700", game: "brick"
  },

  // --- [9. 바위 피하기 (dodge)] ---
  back_propeller: {
    id: "back_propeller", name: "플라즈마 프로펠러 헬리팩", slot: "back", tier: "legend",
    icon: "🚁", desc: "1등 최고급 독점! 어떤 바위도 공중으로 뛰어넘는 1등 전용 부양 팩.",
    color: "#ff8a3d", game: "dodge"
  },
  helm_miner: {
    id: "helm_miner", name: "황금 탐험가 헬멧", slot: "head", tier: "hero",
    icon: "🪖", desc: "2등 중고급 독점! 어둠 속에서도 낙석을 비춰주는 고휘도 헤드랜턴.",
    color: "#ffd700", game: "dodge"
  },
  body_adventurer: {
    id: "body_adventurer", name: "사이버 탐험가 조끼", slot: "body", tier: "rare",
    icon: "🧭", desc: "3등 보급형 독점! 거친 협곡에서도 끄떡없는 하이테크 조끼.",
    color: "#ffb800", game: "dodge"
  },

  // --- [10. 포즈 미믹 (pose)] ---
  aura_starlight: {
    id: "aura_starlight", name: "슈퍼스타 스포트라이트 오라", slot: "aura", tier: "legend",
    icon: "🌟", desc: "1등 최고급 독점! 런웨이 무대처럼 전신을 비추는 황금 스포트라이트.",
    color: "#ffd700", game: "pose"
  },
  head_tiara: {
    id: "head_tiara", name: "크리스탈 댄싱 티아라", slot: "head", tier: "hero",
    icon: "👑", desc: "2등 중고급 독점! 우아하게 반짝이는 크리스탈 프리즘 티아라.",
    color: "#ffb0c9", game: "pose"
  },
  back_fairy: {
    id: "back_fairy", name: "프리즘 페어리 윙", slot: "back", tier: "rare",
    icon: "🧚", desc: "3등 보급형 독점! 춤출 때마다 무지개 별가루를 흩뿌리는 요정 날개.",
    color: "#a5e7ff", game: "pose"
  },

  // --- [11. 골키퍼 (keeper)] ---
  hand_goldenkeeper: {
    id: "hand_goldenkeeper", name: "골든 야신 슈퍼 글러브", slot: "hand", tier: "legend",
    icon: "🧤", desc: "1등 최고급 독점! 모든 슛을 무조건 자석처럼 빨아들이는 1등 황금 장갑.",
    color: "#ffd700", game: "keeper"
  },
  jersey_keeper: {
    id: "jersey_keeper", name: "사이버 골키퍼 유니폼", slot: "body", tier: "hero",
    icon: "⚽", desc: "2등 중고급 독점! 헥사곤 골대 네트 문양이 숨 쉬는 세이버 저지.",
    color: "#22c55e", game: "keeper"
  },
  head_cap: {
    id: "head_cap", name: "에메랄드 세이버 캡", slot: "head", tier: "rare",
    icon: "🧢", desc: "3등 보급형 독점! 눈부신 조명 속에서도 공을 놓치지 않는 모자.",
    color: "#00d2ff", game: "keeper"
  },

  // --- [12. 풍선 팡팡 (balloon)] ---
  back_balloonbundle: {
    id: "back_balloonbundle", name: "무지개 열기구 팩", slot: "back", tier: "legend",
    icon: "🎈", desc: "1등 최고급 독점! 등 뒤에서 영롱한 무지개 풍선 다발이 둥실 떠오릅니다.",
    color: "#ff3377", game: "balloon"
  },
  head_partyhat: {
    id: "head_partyhat", name: "네온 카니발 파티햇", slot: "head", tier: "hero",
    icon: "🥳", desc: "2등 중고급 독점! 끝에서 폭죽이 퐁퐁 튀는 페스티벌 고깔모자.",
    color: "#ffb800", game: "balloon"
  },
  hand_wand: {
    id: "hand_wand", name: "스타 매직 팝 완드", slot: "hand", tier: "rare",
    icon: "🪄", desc: "3등 보급형 독점! 휘두르면 별빛 방울이 터지는 마법 요술봉.",
    color: "#00d2ff", game: "balloon"
  }
};

// 2. 12개 게임 전체 1~3등 보상 매핑 테이블
const RANK_REWARDS = {
  baseball: ["bat_gold", "cap_cyber", "jersey_neon"],
  kungfu:   ["aura_dragon", "robe_master", "gloves_tiger"],
  runner:   ["back_jetpack", "helm_visor", "shoes_neon"],
  beat:     ["hand_sabers", "head_phones", "back_cape"],
  box:      ["hand_firebox", "body_belt", "head_guard"],
  ninja:    ["hand_katana", "head_foxmask", "body_shinobi"],
  space:    ["hand_shield", "head_astro", "back_wings"],
  brick:    ["hand_laserpaddle", "helm_cyber", "aura_neonspark"],
  dodge:    ["back_propeller", "helm_miner", "body_adventurer"],
  pose:     ["aura_starlight", "head_tiara", "back_fairy"],
  keeper:   ["hand_goldenkeeper", "jersey_keeper", "head_cap"],
  balloon:  ["back_balloonbundle", "head_partyhat", "hand_wand"]
};

// 3. 커스튬 인벤토리 & 장착 상태 (암호화 체크포인트 저장소 관리)
let costumeInventory = new Set(["head_crown", "body_nano", "back_angel", "hand_repulsor"]);
let equippedCostume = {
  head: "head_crown",
  face: null,       // 🥸 콧수염 / 안경
  body: "body_nano",
  legs: null,       // 🩳 바지 / 팬티
  feet: null,       // 🩴 삼선 슬리퍼 / 신발
  back: "back_angel",
  hand: "hand_repulsor",
  aura: null
};

// 👑 플레이어의 특정 게임 현재 순위 조회 (1, 2, 3등 또는 0: 미기록/순위밖)
async function getPlayerRankForGame(gameId) {
  if (!gameId) return 0;
  const pid = profiles?.activeId;
  const key = recKey("top10-" + gameId, pid);
  const list = await SecureStore.loadCheckpoint(key, []);
  if (!Array.isArray(list) || list.length === 0) return 0;
  const bestVal = +(await SecureStore.loadCheckpoint(recKey("best-" + gameId, pid), 0)) || 0;
  if (bestVal <= 0) return 0;
  const idx = list.indexOf(bestVal);
  return idx >= 0 ? idx + 1 : 0;
}

// 🔒 아이템 착용 자격 검사 (순위 기반 독점 / 강등 판정)
async function checkItemRankEligibility(item) {
  if (!item) return { eligible: false, rankReq: 0, currentRank: 0 };
  if (item.tier === "common") return { eligible: true, rankReq: 0, currentRank: 1 };

  const rank = await getPlayerRankForGame(item.game);
  let rankReq = 3;
  let eligible = false;
  if (item.tier === "legend") {
    rankReq = 1;
    eligible = (rank === 1);
  } else if (item.tier === "hero") {
    rankReq = 2;
    eligible = (rank === 1 || rank === 2);
  } else if (item.tier === "rare") {
    rankReq = 3;
    eligible = (rank >= 1 && rank <= 3);
  }
  return { eligible, rankReq, currentRank: rank };
}

// ⚠️ 순위 변동 시 자격 상실 파츠 자동 탈착 & 박탈 알림 (Auto-Strip Engine)
async function auditAndStripIneligibleCostumes() {
  let strippedCount = 0;
  for (const [slot, itemId] of Object.entries(equippedCostume)) {
    if (!itemId) continue;
    const item = COSTUME_ITEMS[itemId];
    if (!item || item.tier === "common") continue;

    const { eligible, rankReq, currentRank } = await checkItemRankEligibility(item);
    if (!eligible) {
      // 뺏김 발생!
      equippedCostume[slot] = null;
      strippedCount++;
      const tierText = item.tier === "legend" ? "1등 최고급" : item.tier === "hero" ? "2등 중고급" : "3등 보급형";
      popup(W / 2, H * 0.45, `👑 [${item.name}] 박탈됨! (${tierText} 전용 - 순위 밀림)`, "#ff3366");
      speak(`등수가 밀려 ${item.name}을(를) 뺏겼습니다! 다시 순위를 탈환하세요!`, true);
    }
  }
  if (strippedCount > 0) {
    saveCostumeData();
    renderCostumeShelf();
    renderEquippedSlotsUI();
    sfx.costumeUnequip();
    buddyEngine.say("주인님! 1등을 뺏겨서 최고급 옷이 반납되었어요! 다시 1등하러 가요!");
  }
}

// 🔒 암호화 인벤토리 로드 & 저장
async function loadCostumeData() {
  const pid = profiles?.activeId;
  const invKey = recKey("costume_inventory_v1", pid);
  const eqKey = recKey("costume_equipped_v1", pid);

  const savedInv = await SecureStore.loadCheckpoint(invKey, null);
  if (Array.isArray(savedInv)) {
    costumeInventory = new Set(savedInv);
  }
  // 기본 아이템 항상 보장
  ["head_crown", "body_nano", "back_angel", "hand_repulsor"].forEach((id) => costumeInventory.add(id));

  const savedEq = await SecureStore.loadCheckpoint(eqKey, null);
  if (savedEq && typeof savedEq === "object") {
    equippedCostume = { ...equippedCostume, ...savedEq };
  }

  // 로드 즉시 자격 검사 및 부적격 옷 회수
  await auditAndStripIneligibleCostumes();
  // 🪙 플레이어 코인 잔액 로드
  await loadPlayerCoins();
}

async function saveCostumeData() {
  const pid = profiles?.activeId;
  const invKey = recKey("costume_inventory_v1", pid);
  const eqKey = recKey("costume_equipped_v1", pid);

  await SecureStore.saveCheckpoint(invKey, Array.from(costumeInventory));
  await SecureStore.saveCheckpoint(eqKey, equippedCostume);
}

// 🪙 4. 플레이어 키네틱 코인 화폐 & 상점 가격 엔진
let playerCoins = 0;

function getItemPrice(item) {
  if (item && item.price) return item.price;
  switch (item?.tier) {
    case "legend": return 1000000; // 1등 최고급 (100만 코인! 끝판왕 목표)
    case "hero":   return 400000;  // 2등 중고급 (40만 코인! 베테랑)
    case "rare":   return 150000;  // 3등 보급형 (15만 코인! 중급 도전)
    case "common":
    default:       return 45000;   // 일반/단품 악세사리 (4만 5천 코인! 수십 판 플레이 필요)
  }
}

async function loadPlayerCoins() {
  const pid = profiles?.activeId;
  const key = recKey("player_coins_v1", pid);
  const saved = await SecureStore.loadCheckpoint(key, null);
  playerCoins = saved !== null ? +saved : 1500; // 스타트 지원금 1,500 코인
  updateCoinsDisplay(playerCoins);
  return playerCoins;
}

async function savePlayerCoins() {
  const pid = profiles?.activeId;
  const key = recKey("player_coins_v1", pid);
  await SecureStore.saveCheckpoint(key, playerCoins);
  updateCoinsDisplay(playerCoins);
}

async function addPlayerCoins(amount) {
  if (amount <= 0) return playerCoins;
  playerCoins += amount;
  await savePlayerCoins();
  sfx.coinGain();
  return playerCoins;
}

async function spendPlayerCoins(amount) {
  if (amount <= 0 || playerCoins < amount) return false;
  playerCoins -= amount;
  await savePlayerCoins();
  sfx.coinSpend();
  return true;
}

function updateCoinsDisplay(coins = playerCoins) {
  const text = coins.toLocaleString();
  if ($("headerPlayerCoins")) $("headerPlayerCoins").textContent = text;
  if ($("costumePlayerCoins")) $("costumePlayerCoins").textContent = text;
}

// 🎁 1~3등 달성 시 해당 게임의 고유 커스튬 파츠 지급 로직
function checkAndAwardRankCostume(modeId, rankIdx) {
  const rewardList = RANK_REWARDS[modeId];
  if (!rewardList || rankIdx < 0 || rankIdx > 2) {
    $("resultCostumeReward")?.classList.add("hidden");
    return;
  }
  const itemId = rewardList[rankIdx];
  const item = COSTUME_ITEMS[itemId];
  if (!item) return;

  const isNewlyUnlocked = !costumeInventory.has(itemId);
  costumeInventory.add(itemId);
  saveCostumeData();

  const medalLabels = ["🥇 1등 전설 파츠 획득!", "🥈 2등 영웅 파츠 획득!", "🥉 3등 희귀 파츠 획득!"];
  const slotLabels = { head: "머리 파츠", body: "상의 파츠", back: "날개/망토 파츠", hand: "무기 파츠", aura: "오라 파츠" };

  const rewardCard = $("resultCostumeReward");
  if (rewardCard) {
    $("rcRankBadge").textContent = medalLabels[rankIdx];
    $("rcItemIcon").textContent = item.icon;
    $("rcItemName").textContent = item.name;
    $("rcItemDesc").textContent = item.desc;
    $("rcItemSlot").textContent = slotLabels[item.slot] || "특수 장비";
    rewardCard.classList.remove("hidden");

    if (isNewlyUnlocked) {
      sfx.fanfare();
      speak(`${rankIdx + 1}등 보상으로 ${item.name}을 획득하셨습니다! 축하합니다!`, true);
    }
  }
}

// 4. 아이언맨 나노 슈트업 변신 엔진 (5단계 시차 조립 & 리펄서 빔)
const nanoSuitEngine = {
  charging: 0,       // 0 ~ 1.0 (가슴 앞 손 모으기 차징)
  active: false,      // 나노 슈트 착용 여부
  phase: 0,          // 1 ~ 5 단계 조립 시퀀스
  phaseTimer: 0,
  beamCharge: 0,     // 손바닥 펴기 리펄서 빔 발사
  lastBeamT: 0,

  update(dt, chestAnchor, pointers) {
    // ⚡ 인게임 성능 및 제스처 충돌 방지: 커스튬 피팅룸이 열려 있을 때만 차징 제스처 및 DOM 연산 작동
    if (!isCostumeRoomOpen) return;

    // A. 차징 제스처 감지: 두 손이 가슴(아크 리액터) 부근으로 모였는가?
    if (pointers.length >= 2 && chestAnchor) {
      const p1 = pointers[0], p2 = pointers[1];
      const dChest1 = Math.hypot(p1.x - chestAnchor.x, p1.y - chestAnchor.y);
      const dChest2 = Math.hypot(p2.x - chestAnchor.x, p2.y - chestAnchor.y);
      const dBetween = Math.hypot(p1.x - p2.x, p1.y - p2.y);

      const isHandsAtChest = dChest1 < 150 && dChest2 < 150 && dBetween < 180;
      if (isHandsAtChest) {
        this.charging = Math.min(1.0, this.charging + dt * 1.1);
        if (Math.random() < 0.25) sfx.nanoSuitUp(1);
        $("nanoChargeWrap")?.classList.remove("hidden");
        $("ncPercent").textContent = `${Math.round(this.charging * 100)}%`;
        $("ncBarFill").style.width = `${Math.round(this.charging * 100)}%`;
        $("ncStatusText").textContent = "NANO CHARGING...";
        $("ncHintText").textContent = this.charging >= 1.0 ? "⚡ 양팔을 활짝 벌려 나노 슈트업을 발동하세요!" : "가슴 앞에 두 손을 모아 에너지를 차징하세요!";
      } else if (this.charging >= 1.0 && dBetween > 360) {
        // B. 전개 제스처: 차징 완료 후 양팔을 활짝 벌림 -> 나노 변신 개시!
        this.startTransform();
      } else {
        this.charging = Math.max(0, this.charging - dt * 0.75);
        if (this.charging <= 0 && this.phase === 0) {
          $("nanoChargeWrap")?.classList.add("hidden");
        }
      }
    }

    // C. 5단계 시차 조립 시퀀스
    if (this.phase > 0 && this.phase <= 5) {
      this.phaseTimer += dt;
      if (this.phaseTimer >= 0.45) {
        this.phaseTimer = 0;
        this.phase++;
        sfx.nanoSuitUp(this.phase);
        if (this.phase > 5) {
          this.active = true;
          this.phase = 0; // ⚡ 0으로 리셋하여 1회 완료 후 무한 반복 폭주 완벽 차단!
          // ⚡ 나노 변신 완료 시 나노 슈트 풀세트 자동 착용!
          equippedCostume.body = "body_nano";
          equippedCostume.head = "head_crown";
          equippedCostume.hand = "hand_repulsor";
          equippedCostume.back = "back_angel";
          saveCostumeData();
          renderCostumeShelf();
          renderEquippedSlotsUI();
          sfx.fanfare();
          speak("나노 슈트업 완료! 리펄서 시스템 가동!", true);
          const px = chestAnchor ? chestAnchor.x : W / 2;
          const py = chestAnchor ? chestAnchor.y - 80 : H * 0.35;
          popup(px, py, "NANO SUIT-UP COMPLETE! ⚡", "#ff0055");
          addShake(0.18, 8);
          // 아바타 버디 반응
          buddyEngine.say("주인님 나노 슈트 합체 완료! 최고예요!");
          setTimeout(() => $("nanoChargeWrap")?.classList.add("hidden"), 1800);
        }
      }
    }

    // D. 리펄서 빔 발사: 나노 슈트 상태에서 손바닥을 활짝 펴면 손바닥에서 빔 발사!
    if (this.active && pointers.length > 0) {
      const now = performance.now();
      pointers.forEach((p) => {
        if (!p.fist && now - this.lastBeamT > 280) {
          this.lastBeamT = now;
          sfx.repulsorBeam(p.x);
          burst(p.x, p.y, "#00d2ff", 22);
          addShake(0.04, 3);
        }
      });
    }
  },

  startTransform() {
    if (this.phase > 0) return;
    this.charging = 0;
    this.phase = 1;
    this.phaseTimer = 0;
    sfx.nanoSuitUp(1);
    speak("나노 프로토콜 전개!", true);
    $("nanoChargeWrap")?.classList.remove("hidden");
    $("ncStatusText").textContent = "NANO SUIT-UP IN PROGRESS!";
    $("ncPercent").textContent = "DEPLOYING...";
    $("ncBarFill").style.width = "100%";
    $("ncHintText").textContent = "파츠가 실시간으로 신체에 결합 중입니다!";
  }
};

// 5. 나를 따라 움직이는 미니 버디 아바타 엔진 (사용자 요청으로 제거 완료 & no-op 안전화)
const buddyEngine = {
  init() {},
  say(text) {},
  updateAndDraw(dt, skel, pointers) {}
};


// 5-0. 아이템별 PNG 일러스트 (assets/costumes/<id>.png) — 있으면 PNG, 없으면 아래 벡터 그림으로 자동 대체
const costumeImgs = {};
function loadCostumeImages() {
  // assets/costumes/manifest.json 에 적힌 PNG만 불러와요 (없는 파일을 하나하나 찔러 보면 시작할 때 404가 50개 넘게 나요)
  const load = (ids) => {
    for (const id of ids) {
      if (!COSTUME_ITEMS[id] || !/^[a-z0-9_]+$/.test(id)) continue;   // 입력 검증: 안전한 ID만 경로로 사용 (경로 조작 차단)
      const im = new Image();
      im.decoding = "async";
      im.onload = () => { costumeImgs[id] = im; if (isCostumeRoomOpen) renderCostumeShelf(); };
      im.onerror = () => { /* PNG 없음: 벡터 대체 */ };
      im.src = `assets/costumes/${id}.png`;
    }
  };
  fetch("assets/costumes/manifest.json").then((r) => (r.ok ? r.json() : Promise.reject())).then((ids) => load(Array.isArray(ids) ? ids : [])).catch(() => load(Object.keys(COSTUME_ITEMS)));
}
const costumeImg = (id) => { const im = costumeImgs[id]; return im && im.naturalWidth > 0 ? im : null; };
const HAND_TALL = new Set(["hand_toy_hammer", "hand_drumstick", "bat_gold", "hand_sabers", "hand_katana", "hand_wand", "hand_laserpaddle"]);

/** PNG 한 장을 슬롯별 위치/크기 규칙으로 그림 (좌표는 drawCostumePiece 앵커 기준 로컬 단위) */
function drawCostumeImage(ctx, item, im) {
  const ar = im.naturalWidth / im.naturalHeight, id = item.id;
  let x, y, w, h;
  switch (item.slot) {
    case "head":  w = 84; h = w / ar; x = -w / 2; y = 8 - h; break;                       // 모자: 밑동이 이마에 걸치게
    case "face": {
      w = id === "face_clown_nose" ? 30 : (id === "face_mustache" ? 58 : 84); h = w / ar;
      const cy = id === "face_mustache" ? 8 : (id === "face_thug_glasses" ? -14 : -4);
      x = -w / 2; y = cy - h / 2; break;
    }
    case "body":  w = 98; h = 86; x = -w / 2; y = -20; break;                            // 몸통(앵커가 가로·세로 따로 늘어남)
    case "legs":  w = 92; h = 74; x = -w / 2; y = -4; break;
    case "feet":  w = 58; h = w / ar; x = -w / 2; y = 8 - h / 2; break;
    case "back":
      if (ar > 1.3) { w = 190; h = w / ar; x = -w / 2; y = 20 - h / 2; }                 // 날개
      else { w = 120; h = w / ar; x = -w / 2; y = 4; }                                  // 망토/제트팩/풍선
      break;
    case "aura":  w = 260; h = w / ar; x = -w / 2; y = -h / 2; ctx.globalAlpha = 0.9; break;
    case "hand":
    default:
      if (HAND_TALL.has(id)) { h = id === "hand_wand" ? 110 : 140; w = h * ar; x = -w / 2; y = 30 - h; }   // 손잡이가 손에, 끝이 위로
      else { w = id === "hand_shield" ? 84 : 66; h = w / ar; x = -w / 2; y = -h / 2; }
  }
  ctx.drawImage(im, x, y, w, h);
}

// 5-1. 전용 그림이 없는 아이템용 슬롯별 벡터 렌더러 (이모티콘 대체, 아이템 색상 반영)
function drawGenericCostume(ctx, item, col) {
  const slot = item.slot, id = item.id;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.fillStyle = col;
  const t = performance.now() * 0.004;

  // ---- 아이템 개별 디자인 ----
  switch (id) {
    case "face_mustache": {
      ctx.fillStyle = col; ctx.strokeStyle = "#2a160a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-10, -2, -30, 0, -40, 14); ctx.bezierCurveTo(-26, 24, -10, 18, 0, 15);
      ctx.bezierCurveTo(10, 18, 26, 24, 40, 14); ctx.bezierCurveTo(30, 0, 10, -2, 0, 8);
      ctx.fill(); ctx.stroke(); return;
    }
    case "face_clown_nose": {
      ctx.fillStyle = "#ff2e4c"; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(-5, -5, 4, 0, 7); ctx.fill(); return;
    }
    case "face_thug_glasses": {
      ctx.fillStyle = "#0b0b14"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(-42, -22, 36, 20, 3); ctx.roundRect(6, -22, 36, 20, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -16); ctx.lineTo(6, -16); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillRect(-36, -18, 8, 4); ctx.fillRect(12, -18, 8, 4); return;
    }
    case "head_poop": {
      ctx.fillStyle = "#ffd700"; ctx.strokeStyle = "#a86b00";
      [[0, 4, 36, 14], [0, -10, 26, 12], [0, -22, 15, 10]].forEach(([x, y, rx, ry]) => {
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); ctx.stroke();
      }); return;
    }
    case "head_chicken": {
      ctx.fillStyle = "#ff3344"; ctx.strokeStyle = "#fff";
      [[-16, 0, 13], [0, -10, 15], [16, 0, 13]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); });
      return;
    }
    case "head_chef": {
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#cfd6e4";
      [[-22, -14, 17], [0, -26, 21], [22, -14, 17]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); });
      ctx.beginPath(); ctx.roundRect(-30, -8, 60, 22, 4); ctx.fill(); ctx.stroke(); return;
    }
    case "head_frog": {
      [-24, 24].forEach((x) => {
        ctx.fillStyle = "#3ddc6a"; ctx.beginPath(); ctx.arc(x, -10, 17, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, -10, 10, 0, 7); ctx.fill();
        ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(x, -9, 5, 0, 7); ctx.fill();
      }); return;
    }
    case "head_cat_neon": {
      ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 20, 40, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      [-1, 1].forEach((s) => {
        ctx.fillStyle = col; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(s * 40, -4); ctx.lineTo(s * 34, -38); ctx.lineTo(s * 10, -18); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffb3d1"; ctx.beginPath(); ctx.moveTo(s * 33, -10); ctx.lineTo(s * 31, -28); ctx.lineTo(s * 18, -17); ctx.closePath(); ctx.fill();
      }); return;
    }
    case "hand_toy_hammer": {
      ctx.fillStyle = "#a8662b"; ctx.beginPath(); ctx.roundRect(-5, -40, 10, 66, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.roundRect(-30, -68, 60, 32, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ff4d6d"; ctx.fillRect(-30, -56, 60, 8); return;
    }
    case "hand_drumstick": {
      ctx.fillStyle = "#fff3d6"; ctx.beginPath(); ctx.roundRect(-4, -12, 8, 44, 3); ctx.fill(); ctx.stroke();
      [-6, 6].forEach((x) => { ctx.beginPath(); ctx.arc(x, 34, 6, 0, 7); ctx.fill(); ctx.stroke(); });
      ctx.fillStyle = "#d98030"; ctx.beginPath(); ctx.ellipse(0, -34, 22, 28, 0, 0, 7); ctx.fill(); ctx.stroke(); return;
    }
    case "hand_rubber_gloves": {
      ctx.fillStyle = "#ff7fb6"; ctx.beginPath(); ctx.roundRect(-18, -14, 36, 34, 12); ctx.fill(); ctx.stroke();
      [-14, -5, 4, 13].forEach((x, i) => { ctx.beginPath(); ctx.roundRect(x - 4, -36 - (i % 3 === 1 ? 6 : 0), 9, 26, 5); ctx.fill(); ctx.stroke(); });
      ctx.fillStyle = "#ffd1e6"; ctx.fillRect(-20, 18, 40, 10); return;
    }
    case "hand_katana": {
      ctx.strokeStyle = "#e9f2ff"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -92); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#222"; ctx.fillRect(-12, 4, 24, 5); ctx.fillStyle = "#7a1020"; ctx.fillRect(-4, 8, 8, 28); return;
    }
    case "hand_laserpaddle": {
      ctx.fillStyle = "rgba(0,210,255,.45)"; ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, -40, 30, 40, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 30); ctx.stroke(); return;
    }
    case "body_rainbow_tee": {
      ctx.save(); ctx.beginPath(); ctx.moveTo(-44, -18); ctx.lineTo(44, -18); ctx.lineTo(34, 52); ctx.lineTo(-34, 52); ctx.closePath(); ctx.clip();
      ["#ff3b5c", "#ff9f1c", "#ffe14d", "#38d996", "#3ba7ff", "#9b5cff"].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-50, -18 + i * 12, 100, 12); });
      ctx.restore(); ctx.beginPath(); ctx.moveTo(-44, -18); ctx.lineTo(44, -18); ctx.lineTo(34, 52); ctx.lineTo(-34, 52); ctx.closePath(); ctx.stroke(); return;
    }
    case "body_hawaiian": {
      ctx.fillStyle = "#1fb5a8"; ctx.beginPath(); ctx.moveTo(-44, -18); ctx.lineTo(44, -18); ctx.lineTo(34, 52); ctx.lineTo(-34, 52); ctx.closePath(); ctx.fill(); ctx.stroke();
      [[-22, 0], [18, 8], [-8, 30], [24, 36], [-26, 38]].forEach(([x, y]) => { ctx.fillStyle = "#ff5e8a"; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.fillStyle = "#ffe14d"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); });
      return;
    }
    case "body_belt": {
      ctx.fillStyle = "#1a1330"; ctx.fillRect(-40, 30, 80, 16); ctx.strokeRect(-40, 30, 80, 16);
      ctx.fillStyle = "#ffd700"; ctx.beginPath(); ctx.roundRect(-18, 26, 36, 24, 6); ctx.fill(); ctx.stroke(); return;
    }
    case "legs_boxer_shorts": {
      ctx.fillStyle = "#ff2e4c"; ctx.beginPath();
      ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.lineTo(46, 50); ctx.lineTo(6, 50); ctx.lineTo(0, 30); ctx.lineTo(-6, 50); ctx.lineTo(-46, 50); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; [[-26, 12], [-12, 30], [24, 14], [30, 36], [-34, 38]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); }); return;
    }
    case "legs_disco_pants": {
      const g = ctx.createLinearGradient(0, 0, 0, 80); g.addColorStop(0, col); g.addColorStop(1, "#7c5cff"); ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.lineTo(66, 82); ctx.lineTo(8, 82); ctx.lineTo(0, 30); ctx.lineTo(-8, 82); ctx.lineTo(-66, 82); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; for (let i = 0; i < 6; i++) { const a = Math.sin(t * 2 + i) * 0.5 + 0.5; ctx.globalAlpha = a; ctx.fillRect(-50 + i * 18, 14 + (i % 3) * 22, 4, 4); } ctx.globalAlpha = 1; return;
    }
    case "feet_slippers": {
      ctx.fillStyle = "#2fcf6a"; ctx.beginPath(); ctx.roundRect(-24, -6, 48, 22, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; [-8, 0, 8].forEach((x) => { ctx.beginPath(); ctx.moveTo(x - 4, -4); ctx.lineTo(x + 4, 14); ctx.stroke(); }); return;
    }
    case "feet_duck_shoes": {
      ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.ellipse(0, 4, 24, 14, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ff8a1f"; ctx.beginPath(); ctx.ellipse(18, 8, 14, 6, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(-4, -2, 3, 0, 7); ctx.fill(); return;
    }
    case "back_pixel_wings": {
      [-1, 1].forEach((s) => { for (let r = 0; r < 5; r++) for (let c = 0; c < 6 - r; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#ffffff" : col; ctx.fillRect(s > 0 ? 12 + c * 14 : -26 - c * 14, -8 + r * 14, 14, 14); } });
      return;
    }
    case "aura_fireworks": {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + t, r = 70 + 20 * Math.sin(t * 3 + i);
        ctx.fillStyle = ["#ff3b5c", "#ffe14d", "#3ba7ff", "#38d996"][i % 4]; ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.9, 5, 0, 7); ctx.fill();
      } return;
    }
  }

  // ---- 슬롯별 기본 디자인 (아이템 색상 사용) ----
  switch (slot) {
    case "head": {
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 4, 36, 30, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.ellipse(0, 4, 50, 8, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -16, 6, 0, 7); ctx.fill(); return;
    }
    case "face": {
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-40, -22, 80, 20, 8); ctx.fill(); ctx.stroke(); return;
    }
    case "body": {
      const g = ctx.createLinearGradient(0, -18, 0, 52); g.addColorStop(0, col); g.addColorStop(1, "#1b1140"); ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-44, -18); ctx.lineTo(44, -18); ctx.lineTo(34, 52); ctx.lineTo(-34, 52); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-14, -18); ctx.lineTo(0, 0); ctx.lineTo(14, -18); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 22, 6, 0, 7); ctx.fill(); return;
    }
    case "legs": {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.lineTo(46, 50); ctx.lineTo(6, 50); ctx.lineTo(0, 30); ctx.lineTo(-6, 50); ctx.lineTo(-46, 50); ctx.closePath(); ctx.fill(); ctx.stroke(); return;
    }
    case "feet": {
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-24, -8, 48, 22, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillRect(-26, 12, 52, 5); return;
    }
    case "back": {
      if (/wing/.test(id)) {
        ctx.globalAlpha = 0.55; ctx.fillStyle = col;
        [-1, 1].forEach((s) => { ctx.beginPath(); ctx.moveTo(s * 10, 0); ctx.bezierCurveTo(s * 50, -50, s * 90, -30, s * 110, 20); ctx.bezierCurveTo(s * 70, 35, s * 40, 20, s * 10, 0); ctx.fill(); });
        ctx.globalAlpha = 1;
        [-1, 1].forEach((s) => { ctx.beginPath(); ctx.moveTo(s * 10, 0); ctx.bezierCurveTo(s * 50, -50, s * 90, -30, s * 110, 20); ctx.bezierCurveTo(s * 70, 35, s * 40, 20, s * 10, 0); ctx.stroke(); });
      } else if (/prop/.test(id)) {
        ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -20); ctx.stroke();
        ctx.save(); ctx.translate(0, -24); ctx.scale(1, 0.25); ctx.rotate(t * 8); ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillRect(-60, -6, 120, 12); ctx.restore();
      } else {
        ctx.globalAlpha = 0.85; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(34, 0);
        ctx.bezierCurveTo(64, 60, 70, 100, 52, 128 + Math.sin(t * 3) * 6); ctx.lineTo(-52, 128 + Math.sin(t * 3 + 1) * 6); ctx.bezierCurveTo(-70, 100, -64, 60, -34, 0);
        ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      } return;
    }
    case "aura": {
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.65 - i * 0.18; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); const r = 60 + i * 16 + Math.sin(t * 3 + i) * 4; ctx.ellipse(0, 0, r, r * 1.15, 0, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = "#fff";
      for (let i = 0; i < 6; i++) { const a = t * 1.5 + i * 1.05; ctx.beginPath(); ctx.arc(Math.cos(a) * 76, Math.sin(a) * 88, 4, 0, 7); ctx.fill(); } return;
    }
    case "hand":
    default: {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.stroke(); return;
    }
  }
}

// 6-0. 카툰 스프라이트 캐시: 안 움직이는 아이템은 한 번만 그려서 그림 한 장(외곽선+음영+그림자 포함)으로 저장해 두고
// 매 프레임 drawImage 한 번으로 찍어요. 움직이는 그림(오라·불꽃·반짝이)은 예전처럼 실시간으로 그려요.
const costumeSprites = new Map();   // id -> { png: 0|1, spr: 완성된 스프라이트 | null(아직/불필요 → 실시간으로 그림) }
const COSTUME_LIVE = new Set(["legs_disco_pants", "back_jetpack", "aura_dragon", "aura_fireworks"]);
function costumeSprite(item) {
  if (item.slot === "aura" || COSTUME_LIVE.has(item.id) || (item.slot === "back" && /prop/.test(item.id))) return null;
  const png = costumeImg(item.id) ? 1 : 0;
  let e = costumeSprites.get(item.id);
  if (!e || e.png !== png) {                        // 처음이거나, PNG가 뒤늦게 로드되면 다시 구워요
    e = { png, spr: null };
    costumeSprites.set(item.id, e);
    try {
      const spr = bakeToon((g) => drawCostumeLocal(g, item, false, true), { outline: !png });
      // ImageBitmap으로 바꿔 두면 그래픽카드에서 가장 빠르게 찍혀요. 준비되는 짧은 동안은 실시간 그림으로 대신해요.
      if (spr) createImageBitmap(spr.cv).then((bm) => { if (costumeSprites.get(item.id) === e) { spr.cv = bm; e.spr = spr; } }).catch(() => {});
    } catch (err) { console.warn("costume bake failed:", item.id, err); }
  }
  return e.spr;
}

// 6. 커스튬 개별 파츠 렌더러 (위치/크기/회전은 앵커, 그림은 캐시 → 없으면 실시간)
function drawCostumePiece(ctx, item, anchor, isBuddy = false) {
  if (!item || !anchor) return;
  const { x, y, scale = 1.0, angle = 0 } = anchor;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.scale(anchor.sx ?? scale, anchor.sy ?? scale);   // 몸통/하의는 가로·세로를 따로 맞춰요

  const spr = costumeSprite(item);
  if (spr) ctx.drawImage(spr.cv, spr.x, spr.y, spr.w, spr.h);
  else drawCostumeLocal(ctx, item, isBuddy, false);
  ctx.restore();
}

/** 앵커 기준 로컬 좌표로 아이템 한 개를 그려요. bake=true 면 캐시용(번쩍임 없이) */
function drawCostumeLocal(ctx, item, isBuddy, bake) {
  const col = item.color || "#00d2ff";
  if (!bake) { ctx.shadowColor = col; ctx.shadowBlur = isBuddy ? 6 : 16; }

  // 🖼️ PNG 일러스트가 있으면 그걸 쓰고, 없으면 아래 벡터로
  const png = costumeImg(item.id);
  if (png) {
    if (!bake) ctx.shadowBlur = isBuddy ? 4 : 10;
    drawCostumeImage(ctx, item, png);
    return;
  }

  switch (item.id) {
    case "head_crown": // 네온 골든 크라운
      ctx.fillStyle = "rgba(255, 184, 0, 0.9)";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-36, 12);
      ctx.lineTo(-30, -22);
      ctx.lineTo(-14, -6);
      ctx.lineTo(0, -32);
      ctx.lineTo(14, -6);
      ctx.lineTo(30, -22);
      ctx.lineTo(36, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 보석 포인트
      ctx.fillStyle = "#ff0055";
      [-22, 0, 22].forEach((bx) => {
        ctx.beginPath();
        ctx.arc(bx, 2, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      break;

    case "cap_cyber": // 사이버 홈런 캡
      ctx.fillStyle = "#00d2ff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 38, 20, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 챙
      ctx.fillStyle = "#ff2e93";
      ctx.beginPath();
      ctx.ellipse(14, 2, 28, 8, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "helm_visor": // 홀로그램 러너 바이저
      ctx.fillStyle = "rgba(0, 210, 255, 0.4)";
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-42, -10, 84, 22, 8);
      ctx.fill();
      ctx.stroke();
      // HUD 라인
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-30, 0); ctx.lineTo(30, 0);
      ctx.stroke();
      break;

    case "head_phones": // 사이버 비트 헤드폰
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, -10, 36, Math.PI * 0.9, Math.PI * 2.1);
      ctx.stroke();
      // 양쪽 이어컵
      ctx.fillStyle = "#00d2ff";
      [-38, 38].forEach((hx) => {
        ctx.beginPath();
        ctx.roundRect(hx - 8, -12, 16, 26, 6);
        ctx.fill();
      });
      break;

    case "head_foxmask": // 네온 여우 가면
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.strokeStyle = "#ff4d5e";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-32, -26); ctx.lineTo(-12, -4); ctx.lineTo(0, 24); ctx.lineTo(12, -4); ctx.lineTo(32, -26);
      ctx.lineTo(18, 0); ctx.lineTo(0, 24); ctx.lineTo(-18, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 여우 붉은 무늬
      ctx.fillStyle = "#ff4d5e";
      ctx.beginPath();
      ctx.ellipse(-14, 0, 7, 3, -0.4, 0, Math.PI * 2);
      ctx.ellipse(14, 0, 7, 3, 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "head_astro": // 우주 탐사대 헬멧
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.fillStyle = "rgba(20, 30, 60, 0.85)";
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 골든 바이저
      ctx.fillStyle = "rgba(255, 209, 102, 0.85)";
      ctx.beginPath();
      ctx.ellipse(0, 4, 26, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "body_nano": // 나노 티타늄 체스트
      ctx.fillStyle = "#e1037d";
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-42, -18); ctx.lineTo(42, -18); ctx.lineTo(32, 38); ctx.lineTo(0, 52); ctx.lineTo(-32, 38);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 아크 리액터
      ctx.fillStyle = "#00d2ff";
      ctx.beginPath();
      ctx.arc(0, 10, 14, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "robe_master": // 그랜드마스터 비룡 도복
      ctx.fillStyle = "#ff4d5e";
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-50, -20); ctx.lineTo(50, -20); ctx.lineTo(38, 48); ctx.lineTo(-38, 48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 블랙 띠
      ctx.fillStyle = "#111111";
      ctx.fillRect(-36, 18, 72, 10);
      break;

    case "back_angel": // 네온 엔젤 윙
      ctx.fillStyle = "rgba(0, 210, 255, 0.35)";
      ctx.strokeStyle = "#a5e7ff";
      ctx.lineWidth = 3;
      // 좌측 날개
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.bezierCurveTo(-50, -50, -90, -30, -110, 20); ctx.bezierCurveTo(-70, 35, -40, 20, -10, 0);
      ctx.fill(); ctx.stroke();
      // 우측 날개
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.bezierCurveTo(50, -50, 90, -30, 110, 20); ctx.bezierCurveTo(70, 35, 40, 20, 10, 0);
      ctx.fill(); ctx.stroke();
      break;

    case "back_jetpack": // 사이버 부스터 제트팩
      ctx.fillStyle = "#1e1035";
      ctx.strokeStyle = "#00d2ff";
      ctx.lineWidth = 3;
      // 듀얼 실린더
      ctx.roundRect(-38, -26, 26, 56, 8);
      ctx.roundRect(12, -26, 26, 56, 8);
      ctx.fill(); ctx.stroke();
      // 부스터 화염
      ctx.fillStyle = "#ff5500";
      ctx.beginPath();
      ctx.moveTo(-32, 30); ctx.lineTo(-25, 52 + Math.random() * 12); ctx.lineTo(-18, 30);
      ctx.moveTo(18, 30); ctx.lineTo(25, 52 + Math.random() * 12); ctx.lineTo(32, 30);
      ctx.fill();
      break;

    case "bat_gold": // 골든 슬러거 배트
      ctx.fillStyle = "linear-gradient(#fff, #ffd700)";
      ctx.fillStyle = "#ffd700";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-8, -65, 16, 95, 6);
      ctx.fill(); ctx.stroke();
      // 그립
      ctx.fillStyle = "#ff3344";
      ctx.fillRect(-6, 22, 12, 18);
      break;

    case "hand_sabers": // 듀얼 플라즈마 빔 세이버
      ctx.strokeStyle = "#00d2ff";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 10); ctx.lineTo(0, -75);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      break;

    case "hand_firebox": // 불꽃 타이거 글러브
      ctx.fillStyle = "#ff3344";
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      break;

    case "hand_shield": // 은하 플라즈마 실드
      ctx.fillStyle = "rgba(0, 210, 255, 0.4)";
      ctx.strokeStyle = "#00d2ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      break;

    case "aura_dragon": // 비룡 용오름 각성 오라
      const t = performance.now() * 0.004;
      ctx.strokeStyle = "rgba(0, 210, 255, 0.7)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const r = 45 + i * 14;
        ctx.ellipse(0, 0, r, r * 0.45, t + i * 1.8, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;

    default: // 전용 그림이 없으면 슬롯별 벡터로 (이모티콘 사용 안 함)
      drawGenericCostume(ctx, item, col);
      break;
  }
}

// 사람(내 몸/상대 몸)마다 따로 흔들림 상태를 가져요
const costumeMotions = [new CostumeMotion(), new CostumeMotion()];

// 7. 실시간 인게임 & 피팅 캔버스 신체 장착 렌더러
function drawEquippedCostumesOnBody(ctx, skel, pointers, isBuddy = false) {
  if (!ctx) return;

  // ⚡ [극상의 60 FPS 최적화] 장착된 장비가 없고 피팅룸도 아니면 연산 0회 완전 스킵
  const hasAnyCostume = Boolean(
    equippedCostume.aura || equippedCostume.back || equippedCostume.body ||
    equippedCostume.head || equippedCostume.hand || equippedCostume.face ||
    equippedCostume.legs || equippedCostume.feet
  );
  if (!hasAnyCostume && !isCostumeRoomOpen) return;

  try {
    // 앵커 좌표 도출
    let headAnchor = null, faceAnchor = null, chestAnchor = null, backAnchor = null, handAnchors = [], legsAnchor = null, feetAnchors = [];

    if (skel && skel[0] && skel[11] && skel[12]) {
      // MediaPipe 전신 포즈 기준 — 모든 위치/크기를 "내 몸 크기"에 비례해서 계산
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const midShoulder = { x: (skel[11].x + skel[12].x) / 2, y: (skel[11].y + skel[12].y) / 2 };
      const sw = Math.max(40, dist(skel[11], skel[12]));                       // 어깨 폭(px)
      const kb = cl(sw / 80, 0.4, 4);                                          // 몸 기준 배율
      const earD = (skel[7] && skel[8]) ? dist(skel[7], skel[8]) : sw * 0.42;   // 머리 폭(px)
      const kh = cl(earD / 55, 0.4, 4);                                        // 머리 기준 배율
      const hasHip = skel[23] && skel[24];
      const midHip = hasHip ? { x: (skel[23].x + skel[24].x) / 2, y: (skel[23].y + skel[24].y) / 2 } : null;
      const torso = midHip ? dist(midShoulder, midHip) : sw * 1.35;            // 몸통 길이(px)
      const mo = costumeMotions[isBuddy ? 1 : 0].update(performance.now(), midShoulder, torso, [skel[15], skel[16]]);   // 스프링 관성

      // 신체 기울기 각도 (어깨선, 머리/귀, 골반 기울기)
      const shoulderAngle = Math.atan2(skel[12].y - skel[11].y, skel[12].x - skel[11].x);
      const headAngle = (skel[7] && skel[8]) ? Math.atan2(skel[8].y - skel[7].y, skel[8].x - skel[7].x) : shoulderAngle * 0.7;
      const hipAngle = (skel[23] && skel[24]) ? Math.atan2(skel[24].y - skel[23].y, skel[24].x - skel[23].x) : shoulderAngle;

      headAnchor = { x: skel[0].x, y: skel[0].y - earD * 0.62 - mo.head.dy * torso, scale: kh * 1.05, angle: headAngle + mo.head.rot };
      faceAnchor = { x: skel[0].x, y: skel[0].y + earD * 0.1, scale: kh, angle: headAngle };      // 코 기준 (콧수염/안경)
      const bodySy = torso / 72;
      chestAnchor = { x: midShoulder.x, y: midShoulder.y + 14 * bodySy, scale: kb, sx: (sw * 1.2) / 88, sy: bodySy, angle: shoulderAngle };
      backAnchor = { x: midShoulder.x, y: midShoulder.y + 8 * kb, scale: kb * 1.15, angle: shoulderAngle + mo.back.rot };

      const kHand = cl(sw / 150, 0.5, 2.5);
      if (skel[15]) handAnchors.push({ x: skel[15].x, y: skel[15].y, scale: kHand, angle: shoulderAngle + mo.hands[0].rot });
      if (skel[16]) handAnchors.push({ x: skel[16].x, y: skel[16].y, scale: kHand, angle: shoulderAngle + mo.hands[1].rot });

      // 하의/바지 앵커 (골반 중심, 허벅지 길이에 맞춰 세로 늘임)
      if (midHip) {
        const hw = dist(skel[23], skel[24]);
        const thigh = (skel[25] && skel[26])
          ? dist(midHip, { x: (skel[25].x + skel[26].x) / 2, y: (skel[25].y + skel[26].y) / 2 }) : torso * 0.9;
        legsAnchor = { x: midHip.x, y: midHip.y - 6, scale: kb, sx: Math.max(hw * 1.7, sw * 0.9) / 88, sy: thigh / 62, angle: hipAngle };
      }
      // 신발/슬리퍼 앵커 (발목)
      const kFoot = cl(sw / 190, 0.5, 2.5);
      if (skel[27]) feetAnchors.push({ x: skel[27].x, y: skel[27].y + 6 * kFoot, scale: kFoot, angle: hipAngle });
      if (skel[28]) feetAnchors.push({ x: skel[28].x, y: skel[28].y + 6 * kFoot, scale: kFoot, angle: hipAngle });
      // 오라는 몸 중심에서 크게
      chestAnchor.auraX = midShoulder.x; chestAnchor.auraY = midShoulder.y + torso * 0.5; chestAnchor.auraK = kb * 1.5;
    } else if (pointers && pointers.length > 0) {
      // 손 인식 기반 (상체 중심 추정)
      const avgX = pointers.reduce((s, p) => s + p.x, 0) / pointers.length;
      const avgY = pointers.reduce((s, p) => s + p.y, 0) / pointers.length;
      headAnchor = { x: avgX, y: Math.max(80, avgY - 140), scale: 1.0 };
      faceAnchor = { x: avgX, y: Math.max(100, avgY - 110), scale: 1.0 };
      chestAnchor = { x: avgX, y: avgY, scale: 1.0 };
      backAnchor = { x: avgX, y: avgY - 20, scale: 1.1 };
      handAnchors = pointers.map((p) => ({ x: p.x, y: p.y, scale: 1.0 }));
      legsAnchor = { x: avgX, y: avgY + 120, scale: 1.0 };
      feetAnchors = [{ x: avgX - 30, y: avgY + 220, scale: 1.0 }, { x: avgX + 30, y: avgY + 220, scale: 1.0 }];
    }

    if (!chestAnchor && !headAnchor) return;

    // 👗 장착한 모든 커스튬 파츠는 레디타임 시작부터 100% 온전히 착용한 채로 노출
    const isSlotReady = () => true;

    // 1. 오라 (가장 뒷면 레이어)
    if (equippedCostume.aura && isSlotReady("aura")) {
      const item = COSTUME_ITEMS[equippedCostume.aura];
      if (item) {
        const aa = chestAnchor.auraK
          ? { x: chestAnchor.auraX, y: chestAnchor.auraY, scale: chestAnchor.auraK }
          : chestAnchor;
        drawCostumePiece(ctx, item, aa, isBuddy);
      }
    }

    // 2. 등 / 날개 / 가방
    if (equippedCostume.back && backAnchor && isSlotReady("back")) {
      const item = COSTUME_ITEMS[equippedCostume.back];
      if (item) drawCostumePiece(ctx, item, backAnchor, isBuddy);
    }

    // 3. 하의 / 바지 / 팬티
    if (equippedCostume.legs && legsAnchor && isSlotReady("legs")) {
      const item = COSTUME_ITEMS[equippedCostume.legs];
      if (item) drawCostumePiece(ctx, item, legsAnchor, isBuddy);
    }

    // 4. 신발 / 슬리퍼
    if (equippedCostume.feet && feetAnchors.length > 0 && isSlotReady("feet")) {
      const item = COSTUME_ITEMS[equippedCostume.feet];
      if (item) feetAnchors.forEach((fa) => drawCostumePiece(ctx, item, fa, isBuddy));
    }

    // 5. 상의 / 아머 / 티셔츠
    if (equippedCostume.body && chestAnchor && isSlotReady("body")) {
      const item = COSTUME_ITEMS[equippedCostume.body];
      if (item) drawCostumePiece(ctx, item, chestAnchor, isBuddy);
    }

    // 6. 머리 / 헬멧 / 모자
    if (equippedCostume.head && headAnchor && isSlotReady("head")) {
      const item = COSTUME_ITEMS[equippedCostume.head];
      if (item) drawCostumePiece(ctx, item, headAnchor, isBuddy);
    }

    // 7. 얼굴 / 콧수염 / 안경
    if (equippedCostume.face && faceAnchor && isSlotReady("face")) {
      const item = COSTUME_ITEMS[equippedCostume.face];
      if (item) drawCostumePiece(ctx, item, faceAnchor, isBuddy);
    }

    // 8. 손 / 무기 / 장갑
    if (equippedCostume.hand && handAnchors.length > 0 && isSlotReady("hand")) {
      const item = COSTUME_ITEMS[equippedCostume.hand];
      if (item) {
        handAnchors.forEach((ha) => drawCostumePiece(ctx, item, ha, isBuddy));
      }
    }
  } catch (err) {
    // 🛡️ Zero-Crash Policy: 커스튬 드로잉 중 오류 발생 시에도 메인 게임 렌더링은 100% 정상 유지
    console.warn("Costume render suppressed:", err);
  }
}

// 8. 가상 피팅 룸 제스처 & UI 컨트롤러 (CostumeRoomEngine)
let isCostumeRoomOpen = false;
let costumeDragItem = null; // 현재 주먹으로 쥐고 있는 아이템
let costumeDragPos = { x: 0, y: 0 };
let currentCostumeTab = "all";

// 피팅룸 비전 부팅 상태 (화면 배너에 표시 — 메뉴가 가려져 있어도 진행 상황을 볼 수 있게)
const costumeVision = { stage: "camera", msg: "" };
let costumeBootToken = 0;

// 카메라 → 몸 인식 모델 순서로 준비. 실패하면 지수 백오프(0.8s, 1.6s, 3.2s)로 최대 3회 재시도 (무한 루프 방지)
async function costumeVisionBoot() {
  const token = ++costumeBootToken;
  const alive = () => isCostumeRoomOpen && token === costumeBootToken;
  for (let attempt = 0; attempt < 3 && alive(); attempt++) {
    try {
      costumeVision.stage = "camera"; costumeVision.msg = "📷 카메라 연결 중… (브라우저에서 카메라 허용을 눌러 주세요)";
      if (!useMouse && !(await ensureVideo())) throw new Error("카메라 연결 실패");
      if (!alive()) return;
      visionAI.setActive(useMouse ? null : "pose");
      costumeVision.stage = "pose"; costumeVision.msg = "🧍 몸 인식 준비 중… (처음에는 몇 초 걸려요)";
      if (!useMouse && !(await ensureModel("pose"))) throw new Error("몸 인식 모델 로드 실패");
      if (!alive()) return;
      costumeVision.stage = "ready"; costumeVision.msg = "";
      ensureModel("hand").catch(() => {});          // 손(주먹) 모델은 뒤에서 — 몸 인식은 바로 시작
      return;
    } catch (e) {
      console.warn(`피팅룸 비전 준비 실패(${attempt + 1}/3):`, e);
      costumeVision.stage = "error"; costumeVision.msg = `⚠️ 연결 재시도 중… (${attempt + 1}/3)`;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
  if (alive()) { costumeVision.stage = "error"; costumeVision.msg = "❌ 카메라/인식 모델을 불러오지 못했어요. 카메라 허용·인터넷 연결 확인 후 다시 열어 주세요."; }
}

// 화면 상단 중앙 상태 배너 (부팅 진행/전신 미인식/손 모델 준비 안내)
function drawCostumeStatusBanner(ctx, cw, ch, skel) {
  let msg = costumeVision.msg;
  if (!msg && !useMouse && !(skel && skel[11] && skel[12])) msg = "🧍 전신이 화면에 보이도록 한 걸음 뒤로 물러서 주세요";
  else if (!msg && !useMouse && !(visionAI.ready("hand") || handLandmarker)) msg = "✊ 주먹 인식 준비 중… (잠시 후 손을 올려 보세요)";
  if (!msg) return;
  ctx.save();
  ctx.font = "bold 20px 'Rubik', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const tw = ctx.measureText(msg).width + 48, x = cw / 2 - tw / 2, y = 84;
  ctx.fillStyle = costumeVision.stage === "error" ? "rgba(120,20,40,.88)" : "rgba(15,8,35,.82)";
  ctx.strokeStyle = costumeVision.stage === "error" ? "#ff5470" : "#00d2ff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y - 24, tw, 48, 24); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.fillText(msg, cw / 2, y);
  ctx.restore();
}

async function openCostumeRoom() {
  isCostumeRoomOpen = true;
  $("costumeRoom")?.classList.remove("hidden");
  $("menu")?.classList.add("hidden");

  // ⚡ 1. 카메라 + 포즈(몸) 먼저, 손(주먹) 모델은 뒤에서 — 단계 표시 + 재시도
  costumeSliceKind = "pose"; costumeSliceT = performance.now();
  costumeHand.seen = 0; costumeHand.votes = 0; costumeHand.stable = false; costumeHand.prevStable = false;
  costumeVisionBoot();

  // ⚡ 2. 캔버스 = 화면 크기 1:1 (인식 좌표계 W×H와 동일 → 옷이 몸에 정확히 붙어요)
  const cvs = $("costumeCanvas");
  if (cvs) {
    cvs.width = innerWidth;
    cvs.height = innerHeight;
  }

  // 🔒 1등 뺏김 검사: 순위가 밀린 옷이 있다면 자동 회수 및 알림
  await auditAndStripIneligibleCostumes();
  // 🪙 코인 잔액 최신화
  await loadPlayerCoins();
  await renderCostumeShelf();
  renderEquippedSlotsUI();
  buddyEngine.init();
  buddyEngine.say("주인님 어서오세요! 게임으로 모은 코인으로 명품 옷을 장만해보세요!");
  ac();
  sfx.levelUp();
}

function closeCostumeRoom() {
  isCostumeRoomOpen = false;
  costumeDragItem = null;
  costumeHand.hoverEl?.classList.remove("hand-hover"); costumeHand.hoverEl = null;
  $("costumeRoom")?.classList.add("hidden");
  $("menu")?.classList.remove("hidden");
  // 메인 메뉴 복귀 시 비전 인식 대기 모드로 전환
  visionAI.setActive(null);
  saveCostumeData();
  sfx.end();
}

// 진열장 아이템 렌더링 (실시간 순위 독점 자격 + 코인 구매/소장 시스템 반영)
async function renderCostumeShelf() {
  const listEl = $("costumeItemList");
  if (!listEl) return;
  const frag = document.createDocumentFragment();   // 완성 후 한 번에 교체 (깜빡임/스크롤 초기화 방지)

  const items = Object.values(COSTUME_ITEMS).filter((it) => currentCostumeTab === "all" || it.slot === currentCostumeTab);

  for (const it of items) {
    const isEq = equippedCostume[it.slot] === it.id;
    const isOwned = costumeInventory.has(it.id);
    const price = getItemPrice(it);
    const { eligible, rankReq, currentRank } = await checkItemRankEligibility(it);

    const card = document.createElement("div");
    card.className = `costume-card ${isEq ? "equipped" : ""} ${isOwned ? "owned" : ""}`;
    card.dataset.itemId = it.id;
    card.dataset.owned = isOwned ? "1" : "0";
    card.dataset.price = String(price);

    const tierLabels = { legend: "👑 1등 최고급", hero: "🥈 2등 중고급", rare: "🥉 3등 보급형", common: "기본 패션" };
    const tierBadge = `<span class="card-tier-badge tier-${it.tier}">${tierLabels[it.tier] || "일반"}</span>`;
    const priceBadge = `<span class="card-price-badge">🪙 ${price.toLocaleString()}</span>`;

    let actionBtnHtml = "";
    if (isOwned) {
      if (isEq) {
        actionBtnHtml = `<button class="btn-card-buy btn-act-toggle" type="button" style="background:#ff2e93;">✓ 착용 중 (벗기)</button>`;
      } else {
        actionBtnHtml = `<button class="btn-card-buy btn-act-toggle" type="button" style="background:rgba(34,197,94,0.3);border-color:#22c55e;color:#4ade80;">✓ 소장 완료 (입기)</button>`;
      }
    } else {
      actionBtnHtml = `<button class="btn-card-buy btn-act-buy" type="button">🪙 ${price.toLocaleString()} 구매</button>`;
    }

    let statusNote = "";
    if (!isOwned) {
      statusNote = `<div class="costume-card-status" style="color:#ffdea8;">미소장 (클릭 시 구매)</div>`;
    } else if (it.tier === "legend") {
      statusNote = `<div class="costume-card-status" style="color:#ffd700;">👑 1등 상징 독점 소장</div>`;
    } else {
      statusNote = `<div class="costume-card-status" style="color:#4ade80;">소장 중인 아이템</div>`;
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
        ${tierBadge}
        ${priceBadge}
      </div>
      <div class="costume-card-icon">${costumeImg(it.id) ? `<img src="assets/costumes/${it.id}.png" alt="${escapeHtml(it.name)}" draggable="false">` : it.icon}</div>
      <div class="costume-card-name">${escapeHtml(it.name)}</div>
      <div class="costume-card-desc">${escapeHtml(it.desc)}</div>
      ${statusNote}
      ${actionBtnHtml}
    `;

    // 구매 버튼 또는 카드 클릭 이벤트 바인딩
    card.addEventListener("click", async (e) => {
      const isBuyBtn = e.target.classList.contains("btn-act-buy");
      
      if (!isOwned) {
        // 미소장 아이템 구매 시도
        if (playerCoins >= price) {
          const success = await spendPlayerCoins(price);
          if (success) {
            costumeInventory.add(it.id);
            await saveCostumeData();
            await equipCostumeItem(it);
            popup(W / 2, H * 0.45, `🎉 [${it.name}] 구매 성공! 영구 소장되었습니다!`, "#ffd700");
            sfx.levelUp();
            buddyEngine.say(`와! 주인님 [${it.name}]을(를) 구매하셨군요! 너무 멋져요!`);
            burst(W / 2, H * 0.45, it.color || "#ffd700", 36);
          }
        } else {
          // 코인 부족 경고
          const lack = price - playerCoins;
          popup(W / 2, H * 0.45, `⚠️ 코인이 부족합니다! (필요: ${price.toLocaleString()} 🪙 / 부족: ${lack.toLocaleString()} 🪙) 게임을 더 플레이하세요!`, "#ff3366");
          sfx.countdown(false);
          buddyEngine.say(`코인이 ${lack.toLocaleString()}개 부족해요! 게임을 더 플레이해서 모아봐요!`);
          // 피팅룸에서는 시착(미리 입어보기) 지원
          await equipCostumeItem(it);
        }
      } else {
        // 이미 소장한 아이템은 자유롭게 입고 벗기
        await equipCostumeItem(it);
      }
    });

    frag.appendChild(card);
  }
  const keepScroll = listEl.scrollTop;
  listEl.replaceChildren(frag);
  listEl.scrollTop = keepScroll;
}

function renderEquippedSlotsUI() {
  const chipsContainer = $("costumeEquippedChips");
  if (!chipsContainer) return;

  chipsContainer.innerHTML = "";
  const equippedList = Object.entries(equippedCostume).filter(([_, id]) => id && COSTUME_ITEMS[id]);

  if (equippedList.length === 0) {
    chipsContainer.innerHTML = `<span class="cec-empty">아직 착용한 장비가 없습니다. (우측 진열장에서 터치하여 착용해보세요!)</span>`;
    return;
  }

  equippedList.forEach(([slot, id]) => {
    const item = COSTUME_ITEMS[id];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cec-chip";
    chip.title = `클릭하면 [${item.name}] 벗기`;
    chip.innerHTML = `<span>${item.icon}</span> <span>${escapeHtml(item.name)}</span> <span class="cec-chip-remove">✕</span>`;
    chip.addEventListener("click", async () => {
      await equipCostumeItem(item); // 토글(벗기)
    });
    chipsContainer.appendChild(chip);
  });
}

// 아이템 장착 & 탈착 (가상 피팅 룸 자유 착용 & 랭킹 상징 연동)
async function equipCostumeItem(item) {
  if (!item) return;

  const { eligible } = await checkItemRankEligibility(item);

  if (equippedCostume[item.slot] === item.id) {
    // 이미 착용 중이면 탈착
    equippedCostume[item.slot] = null;
    sfx.costumeUnequip();
    buddyEngine.say(`${item.name}을(를) 벗었습니다!`);
    popup(W / 2, H * 0.45, `✨ [${item.name}] 장비 해제`, "#aaa");
  } else {
    equippedCostume[item.slot] = item.id;
    sfx.costumeEquip();
    const rankTitle = item.tier === "legend" ? "👑 1등 챔피언 상징" : (item.tier === "hero" ? "🥈 2등 영웅 상징" : "🥉 3등 상징");
    buddyEngine.say(`${item.name} 장착 완료! 아주 멋져요!`);
    popup(W / 2, H * 0.45, `✨ [${item.name}] 착용 완료! (${rankTitle})`, item.color || "#00d2ff");
    burst(costumeDragPos.x || W / 2, costumeDragPos.y || H / 2, item.color || "#00d2ff", 32);
  }

  saveCostumeData();
  await renderCostumeShelf();
  renderEquippedSlotsUI();
}

// ✊ 피팅룸 손 입력 엔진 — 진열장 위에 손을 올리고 "주먹을 쥐면" 클릭(착용/해제/탭 선택)
// 포즈 모델은 손가락 모양(주먹/손바닥)을 읽지 못해서, 손 모델과 번갈아 돌려 주먹 여부를 정확히 읽어요.
const costumeHand = {
  x: 0, y: 0, fist: false, seen: 0, votes: 0, stable: false, prevStable: false,
  lastClick: 0, hoverEl: null, hoverLast: null, hoverAt: 0, dwellEl: null, dwellT: 0, pendingBuy: null
};
let costumeSliceKind = "pose", costumeSliceT = 0, costumeHandInferT = 0;
const COSTUME_CLICK_SELECTOR = ".costume-card, .c-tab, .btn-costume-tool, .cec-chip";

// ✊ 노트북LM 최적화 권장사항 반영: 단일 트래커 파이프라인 (Single Tracker Pipeline)
// 모델 모드를 핑퐁 스위칭하지 않고 전신 Pose 33개 랜드마크에서 손목/손끝을 100% 실시간(60 FPS) 추출!
function costumeReadHand(now, skel) {
  if (useMouse) return;
  if (!skel || !skel[11] || !skel[12]) {
    // 🛡️ 300ms Grace Window: 일시적으로 포즈가 끊겨도 직전 손 위치와 상태 유지 (노트북LM 권장 규격)
    if (now - costumeHand.seen > 300) {
      costumeHand.votes = 0;
      costumeHand.stable = false;
    }
    return;
  }

  // 양손 후보 분석: 왼손(15:손목, 17:새끼, 19:검지), 오른손(16:손목, 18:새끼, 20:검지)
  const sw = Math.hypot(skel[12].x - skel[11].x, skel[12].y - skel[11].y) || 80; // 어깨 너비(px) 기준 척도
  const hands = [];

  if (skel[16] && skel[16].v >= 0.35) {
    // 오른손 (사용자 기준 또는 미러 기준 화면 우측 UI 조작에 가장 가까운 손)
    const wrist = skel[16];
    const index = skel[20] || wrist;
    const pinky = skel[18] || wrist;
    const span = Math.hypot(index.x - wrist.x, index.y - wrist.y);
    const spanPinky = Math.hypot(pinky.x - wrist.x, pinky.y - wrist.y);
    const ratio = Math.max(span, spanPinky) / sw;
    // 검지나 손끝이 손목 쪽으로 모이면 주먹 (자연스러운 주먹 쥐기 0.28 이하로 관대하게 판정)
    let isFist = ratio < 0.28;
    if (pointers && pointers.some((p) => p.fist && Math.hypot(p.x - wrist.x, p.y - wrist.y) < sw * 0.8)) {
      isFist = true;
    }
    hands.push({ x: (wrist.x + index.x) / 2, y: (wrist.y + index.y) / 2, fist: isFist, side: "right" });
  }

  if (skel[15] && skel[15].v >= 0.35) {
    // 왼손
    const wrist = skel[15];
    const index = skel[19] || wrist;
    const pinky = skel[17] || wrist;
    const span = Math.hypot(index.x - wrist.x, index.y - wrist.y);
    const spanPinky = Math.hypot(pinky.x - wrist.x, pinky.y - wrist.y);
    const ratio = Math.max(span, spanPinky) / sw;
    let isFist = ratio < 0.28;
    if (pointers && pointers.some((p) => p.fist && Math.hypot(p.x - wrist.x, p.y - wrist.y) < sw * 0.8)) {
      isFist = true;
    }
    hands.push({ x: (wrist.x + index.x) / 2, y: (wrist.y + index.y) / 2, fist: isFist, side: "left" });
  }

  if (hands.length === 0) {
    if (now - costumeHand.seen > 300) { costumeHand.votes = 0; costumeHand.stable = false; }
    return;
  }

  // 화면 우측 사이드바(진열장)에 더 가까운 손 또는 더 높은 손을 우선 타겟팅
  hands.sort((a, b) => b.x - a.x);
  const activeHand = hands[0];

  // 📍 EMA 스무딩 (alpha = 0.55) 적용으로 지연 없이 즉각 추적하면서 손 떨림 완벽 제거
  const alpha = now - costumeHand.seen > 300 ? 1.0 : 0.55;
  costumeHand.x = costumeHand.x * (1 - alpha) + activeHand.x * alpha;
  costumeHand.y = costumeHand.y * (1 - alpha) + activeHand.y * alpha;
  costumeHand.seen = now;
  costumeHand.fist = activeHand.fist;

  // 빠른 응답성: 1프레임 감지 즉시 주먹 상태 반영 (지연 제로)
  costumeHand.votes = activeHand.fist ? Math.min(3, costumeHand.votes + 1) : 0;
  costumeHand.stable = activeHand.fist;
}

// 주먹 클릭 실행: 미소장 아이템은 실수 구매 방지를 위해 "3.5초 안에 한 번 더" 쥐어야 구매돼요
function costumeFistActivate(el, now) {
  try {
    if (!el || !el.isConnected) return;
    if (el.classList.contains("costume-card") && el.dataset.owned === "0" && playerCoins >= Number(el.dataset.price || 0)) {
      const id = el.dataset.itemId;
      const pb = costumeHand.pendingBuy;
      if (pb && pb.id === id && now - pb.t < 3500) {
        costumeHand.pendingBuy = null;
      } else {
        costumeHand.pendingBuy = { id, t: now };
        const nm = COSTUME_ITEMS[id]?.name || "아이템";
        popup(W / 2, H * 0.45, `🪙 [${nm}] 구매하려면 3초 안에 주먹을 한 번 더!`, "#ffd166");
        sfx.tick();
        return;
      }
    }
    el.click();
    el.classList.add("hand-click");
    setTimeout(() => el.classList.remove("hand-click"), 380);
  } catch (e) {
    console.warn("주먹 클릭 처리 예외(무시):", e);
  }
}

// 손 포인터 그리기 + 진열장 호버/스크롤/주먹+체류(Dwell) 듀얼 클릭 처리
function costumeHandUiTick(ctx, cvs, rect, now) {
  // 1) 포인터 결정: 손 모델(주먹 판정 가능) > 포즈 손목(주먹 판정 불가, 체류 클릭) > 마우스
  let ptr = null, fromHand = false;
  if (useMouse) {
    ptr = { x: (mouse.x - rect.left) * cvs.width / (rect.width || cvs.width), y: (mouse.y - rect.top) * cvs.height / (rect.height || cvs.height), fist: !!mouse.down };
  } else if (now - costumeHand.seen < 800) {
    ptr = { x: costumeHand.x, y: costumeHand.y, fist: costumeHand.stable }; fromHand = true;
  } else if (pointers && pointers.length > 0) {
    ptr = { x: pointers[0].x, y: pointers[0].y, fist: Boolean(pointers[0].fist) }; fromHand = true;
  }
  if (!ptr) {
    costumeHand.hoverEl?.classList.remove("hand-hover"); costumeHand.hoverEl = null; costumeHand.dwellEl = null;
    costumeHand.prevStable = false;
    return;
  }
  const sx = rect.left + ptr.x * (rect.width || cvs.width) / cvs.width;
  const sy = rect.top + ptr.y * (rect.height || cvs.height) / cvs.height;
  costumeDragPos = { x: ptr.x, y: ptr.y };

  // 2) 손 아래 UI 찾기 + 하이라이트 (우측 진열장 카드 및 탭 타겟팅)
  const el = document.elementFromPoint(sx, sy)?.closest?.(COSTUME_CLICK_SELECTOR) || null;
  if (el !== costumeHand.hoverEl) {
    costumeHand.hoverEl?.classList.remove("hand-hover");
    el?.classList.add("hand-hover");
    costumeHand.hoverEl = el;
    costumeHand.dwellT = now; // 새 카드 위에 올라가면 Dwell 타이머 리셋
    if (el && !useMouse) sfx.tick();
  }
  if (el) { costumeHand.hoverAt = now; costumeHand.hoverLast = el; }

  // 3) 진열장 위/아래 가장자리에 손을 두면 자동 스크롤
  const grid = $("costumeItemList");
  if (grid && !useMouse) {
    const gr = grid.getBoundingClientRect();
    if (sx >= gr.left && sx <= gr.right && sy >= gr.top && sy <= gr.bottom) {
      const edge = Math.min(100, gr.height * 0.20);
      if (sy < gr.top + edge) grid.scrollTop -= (1 - (sy - gr.top) / edge) * 18;
      else if (sy > gr.bottom - edge) grid.scrollTop += (1 - (gr.bottom - sy) / edge) * 18;
    }
  }

  // 4) 듀얼 클릭 판정:
  // A. 주먹을 쥐면 즉시(0ms) 클릭!
  // B. 주먹을 쥐지 않아도 손을 카드 위에 0.6초만 올려두면(Dwell 게이지 회전) 자동 클릭!
  const rising = costumeHand.stable && !costumeHand.prevStable;
  costumeHand.prevStable = costumeHand.stable;
  const target = el || (now - costumeHand.hoverAt < 300 ? costumeHand.hoverLast : null);
  let dwellP = 0;

  if (!useMouse && el) {
    if (costumeHand.dwellEl !== el) {
      costumeHand.dwellEl = el;
      costumeHand.dwellT = now;
    }
    // 0.6초 체류(Dwell) 프로그레스
    dwellP = Math.min(1, (now - costumeHand.dwellT) / 600);
    if (dwellP >= 1 && now - costumeHand.lastClick > 650) {
      costumeHand.lastClick = now;
      costumeHand.dwellT = now + 900;
      costumeFistActivate(el, now);
      burst(ptr.x, ptr.y, "#00d2ff", 22);
    }
  } else {
    costumeHand.dwellEl = null;
  }

  // 주먹 쥐기 클릭: rising이거나 주먹을 쥔 채 새 요소에 닿았을 때 즉각 트리거
  if (!useMouse && (rising || (costumeHand.stable && el && el !== costumeHand.lastFistEl)) && target && now - costumeHand.lastClick > 650) {
    costumeHand.lastClick = now;
    costumeHand.lastFistEl = el;
    costumeFistActivate(target, now);
    burst(ptr.x, ptr.y, "#ff2e93", 26);
  }
  if (!costumeHand.stable) {
    costumeHand.lastFistEl = null;
  }

  // 5) 최상위 네온 포인터 링 + Dwell 게이지 + 안내 텍스트 렌더링
  ctx.save();
  const hot = !!el;
  const col = ptr.fist ? "#ff2e93" : (hot ? "#22c55e" : "#00d2ff");

  // 메인 포인터 원형 링
  ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 20; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(ptr.x, ptr.y, ptr.fist ? 26 : 36, 0, Math.PI * 2); ctx.stroke();

  // 0.6초 체류(Dwell) 프로그레스 링 (골드 옐로우)
  if (dwellP > 0) {
    ctx.strokeStyle = "#fbb500";
    ctx.shadowColor = "#fbb500";
    ctx.shadowBlur = 18;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(ptr.x, ptr.y, 48, -Math.PI / 2, -Math.PI / 2 + dwellP * Math.PI * 2);
    ctx.stroke();
  }

  // 중심 코어 닷
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 7, 0, Math.PI * 2); ctx.fill();

  // 실시간 직관적 상태 안내 뱃지
  let label = "✋ 진열장 위에 손을 올리세요";
  if (ptr.fist) {
    label = "✊ 주먹 쥠! (즉시 선택)";
  } else if (el?.classList.contains("costume-card")) {
    const owned = el.dataset.owned === "1";
    const actText = el.classList.contains("equipped") ? "벗기" : (owned ? "착용" : "구매/시착");
    label = `✊ 주먹 or 잠시 유지 → ${actText}`;
  } else if (el) {
    label = "✊ 주먹 or 잠시 유지 → 선택";
  }
  if (!ptr.fist && !useMouse && hot && dwellP > 0) {
    label = `⏳ 선택 중… (${Math.round(dwellP * 100)}%)`;
  }

  ctx.font = "bold 18px 'Rubik', sans-serif"; ctx.textAlign = "center"; ctx.shadowBlur = 8; ctx.shadowColor = "#000";
  ctx.fillStyle = "#fff"; ctx.fillText(label, ptr.x, ptr.y - 52);
  ctx.restore();
}

// 가상 피팅 룸 전용 렌더 루프 (캔버스 = 화면 크기 1:1 → 인식 좌표와 옷 위치가 정확히 일치)
function costumeRoomUpdateAndDraw(now, dt) {
  const cvs = $("costumeCanvas");
  if (!cvs || !isCostumeRoomOpen) return;
  try {
    const ctx = cvs.getContext("2d");
    const cw = innerWidth, ch = innerHeight;
    if (cvs.width !== cw || cvs.height !== ch) { cvs.width = cw; cvs.height = ch; }
    const rect = cvs.getBoundingClientRect();

    // 1. 웹캠 거울 영상 (인식 좌표 변환 videoToScreen과 동일한 Cover + 미러 규칙)
    if (video && video.readyState >= 2) {
      const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
      const s = Math.max(cw / vw, ch / vh);
      const isMirror = playerSettings ? playerSettings.mirror !== false : true;
      ctx.save();
      if (isMirror) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, (cw - vw * s) / 2, (ch - vh * s) / 2, vw * s, vh * s);
      ctx.restore();
      ctx.fillStyle = "rgba(10, 6, 24, 0.32)";
      ctx.fillRect(0, 0, cw, ch);
    } else {
      ctx.fillStyle = "#0c0618";
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = "#00d2ff";
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("📷 카메라 영상 로딩 중...", cw / 2, ch / 2);
    }

    // 2. 신체 관절 시각화 & Pose 기반 손 제스처 처리
    const skel = getBody();
    costumeReadHand(now, skel);

    if (skel && skel[0] && skel[11] && skel[12]) {
      ctx.save();
      ctx.strokeStyle = "rgba(0, 210, 255, 0.4)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#00d2ff";
      ctx.shadowBlur = 10;
      const bones = [
        [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
        [11, 23], [12, 24], [23, 24],
        [23, 25], [25, 27], [24, 26], [26, 28]
      ];
      bones.forEach(([i, j]) => {
        if (skel[i] && skel[j]) {
          ctx.beginPath();
          ctx.moveTo(skel[i].x, skel[i].y);
          ctx.lineTo(skel[j].x, skel[j].y);
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    // 3. 실시간 장착 파츠 (신체 기울기에 1:1 완벽 밀착)
    drawEquippedCostumesOnBody(ctx, skel, pointers);

    // 4. ⚡ [최상위 레이어] 우측 진열장 위에서도 절대 가려지지 않는 모션 핸드 오버레이 렌더링!
    const overlayCvs = $("costumeHandOverlay");
    if (overlayCvs) {
      if (overlayCvs.width !== cw || overlayCvs.height !== ch) {
        overlayCvs.width = cw; overlayCvs.height = ch;
      }
      const overlayCtx = overlayCvs.getContext("2d");
      overlayCtx.clearRect(0, 0, cw, ch);
      costumeHandUiTick(overlayCtx, cvs, rect, now);
    } else {
      costumeHandUiTick(ctx, cvs, rect, now);
    }

    // 5. 상단 비전 상태 안내 배너 (로딩 진행 상황 및 물러서기 안내)
    drawCostumeStatusBanner(ctx, cw, ch, skel);

    // 6. 미니 버디
    buddyEngine.updateAndDraw(dt, skel, pointers);
  } catch (err) {
    console.warn("피팅룸 렌더 예외(자동 복구):", err);   // 🛡️ Zero-Crash: 한 프레임 실패해도 다음 프레임 계속
  }
}

// 9. 커스튬 룸 이벤트 리스너 바인딩
function setupCostumeRoomEvents() {
  $("btnCostumeRoom")?.addEventListener("click", openCostumeRoom);
  $("btnCloseCostume")?.addEventListener("click", closeCostumeRoom);
  // ESC 키로 피팅 룸 즉시 나가기 지원
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isCostumeRoomOpen) {
      closeCostumeRoom();
    }
  });
  $("btnGoCostumeFromReward")?.addEventListener("click", () => {
    $("result")?.classList.add("hidden");
    openCostumeRoom();
  });

  // 📺 커스튬 룸 TV/대화면 전체화면 토글
  $("btnFsCostume")?.addEventListener("click", () => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        const txt = $("btnFsCostume")?.querySelector(".fs-text");
        if (txt) txt.textContent = "창모드";
      } else {
        document.exitFullscreen().catch(() => {});
        const txt = $("btnFsCostume")?.querySelector(".fs-text");
        if (txt) txt.textContent = "전체화면";
      }
      sfx.tick();
    } catch (e) {
      console.warn("Fullscreen toggle error:", e);
    }
  });

  // 카테고리 탭 클릭
  document.querySelectorAll(".costume-filter-tabs .c-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".costume-filter-tabs .c-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentCostumeTab = tab.dataset.slot || "all";
      renderCostumeShelf();
      sfx.tick();
    });
  });

  // 모두 벗기
  $("btnUnequipAll")?.addEventListener("click", () => {
    equippedCostume = { head: null, face: null, body: null, legs: null, feet: null, back: null, hand: null, aura: null };
    saveCostumeData();
    renderCostumeShelf();
    renderEquippedSlotsUI();
    sfx.costumeUnequip();
    buddyEngine.say("모든 장비를 벗었습니다!");
  });

  // ⚡ 즉시 나노 변신 실행 버튼
  $("btnTriggerNanoSuit")?.addEventListener("click", () => {
    nanoSuitEngine.startTransform();
  });

  // 📸 히어로 포토 캡처 & 로컬 다운로드
  $("btnCostumePhoto")?.addEventListener("click", () => {
    const cvs = $("costumeCanvas");
    if (!cvs) return;
    try {
      const dataUrl = cvs.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `kinetic_hero_${Date.now()}.png`;
      a.click();
      sfx.fanfare();
      speak("히어로 포토가 저장되었습니다!", true);
      buddyEngine.say("찰칵! 인생샷이 나왔어요!");
    } catch (e) {
      console.warn("포토 저장 실패:", e);
    }
  });

  // 초기 인벤토리 및 저장 데이터 로드
  loadCostumeData();
}

// 커스튬 룸 초기화 실행
loadCostumeImages();
setupCostumeRoomEvents();
// 🔥 마우스를 버튼 위에 올리면 몸 인식 모델을 미리 로드 (피팅룸 진입 시 기다림 최소화)
$("btnCostumeRoom")?.addEventListener("pointerenter", () => { if (!useMouse) ensureModel("pose").catch(() => {}); }, { once: true });

// 메인 루프에서 커스튬 룸 전용 프레임 틱 호출 연동
const origFrame = frame;
frame = function(now) {
  origFrame(now);
  if (isCostumeRoomOpen) {
    costumeRoomUpdateAndDraw(now, 0.016);
  }
};

showBest();
requestAnimationFrame((t) => { last = t; frame(t); });


// 개발용 측정 훅: 주소에 ?bench 가 있을 때만 열려요 (커스튬 그리기 속도 비교용, 게임에는 영향 없음)
if (/[?&]bench\b/.test(location.search)) {
  window.__kk = { dbg: () => ({ mainInfers, poseMain: !!poseLandmarker, handMain: !!handLandmarker, st: { ...visionAI.stats } }), drawEquippedCostumesOnBody, COSTUME_ITEMS, setEquip: (o) => { equippedCostume = { ...equippedCostume, ...o }; } };
}
