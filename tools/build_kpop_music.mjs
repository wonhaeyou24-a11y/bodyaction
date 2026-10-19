import fs from "fs";
import { spawn } from "child_process";
import path from "path";

// 🎵 최고급 K-POP 한국 댄스 스튜디오 마스터링 음원 생성기
// 1. kpop_idol: 132 BPM, 4-on-the-floor 펀치 킥 + 808 서브 슬랩 + 풍성한 팝 신스 코드 + 사이드체인 펌핑
// 2. kpop_hurricane: 138 BPM, 신바람 바운스 킥 + 신스 브라스 스타카토 + 빠른 EDM 댄스 하이햇/스네어
// 3. kpop_candy: 126 BPM, 디스코 그루브 펑키 베이스 + 벨 신스 + 화려한 팝 드럼

const SAMPLE_RATE = 44100;

function createStereoReverb(decay = 0.35, delayMs = 45) {
  const delaySamples = Math.floor((delayMs / 1000) * SAMPLE_RATE);
  const bufL = new Float32Array(delaySamples);
  const bufR = new Float32Array(delaySamples + 100);
  let idxL = 0, idxR = 0;
  return (inL, inR) => {
    const outL = inL + bufL[idxL] * decay;
    const outR = inR + bufR[idxR] * decay;
    bufL[idxL] = inL + bufL[idxL] * (decay * 0.5);
    bufR[idxR] = inR + bufR[idxR] * (decay * 0.5);
    idxL = (idxL + 1) % delaySamples;
    idxR = (idxR + 1) % (delaySamples + 100);
    return [outL, outR];
  };
}

function generateTrackPcm({ bpm, durationSec, rootFreq, style }) {
  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const buffer = Buffer.alloc(totalSamples * 4); // 16-bit stereo = 4 bytes per frame

  const beatSec = 60 / bpm;
  const sixteenthSec = beatSec / 4;
  const reverb = createStereoReverb(0.28, 48);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const beatIndex = Math.floor(t / beatSec);
    const beatTime = t % beatSec;
    const sixteenthIndex = Math.floor(t / sixteenthSec);
    const sixteenthTime = t % sixteenthSec;

    let left = 0;
    let right = 0;

    // --- 1. 💥 808 묵직한 펀치 킥 (4-on-the-floor) ---
    if (beatTime < 0.28) {
      const kickFreq = 180 * Math.exp(-beatTime * 36) + 42;
      const kickEnv = Math.exp(-beatTime * 12);
      const kickClick = (beatTime < 0.012) ? Math.sin(2 * Math.PI * 1200 * beatTime) * 0.3 : 0;
      const kickWave = (Math.sin(2 * Math.PI * kickFreq * beatTime) + kickClick) * kickEnv;
      left += kickWave * 0.85;
      right += kickWave * 0.85;
    }

    // --- 2. 🎶 리버브 일렉트릭 스네어 & 클랩 (2, 4박자 정박) ---
    const isBackbeat = (beatIndex % 2 === 1);
    if (isBackbeat && beatTime < 0.22) {
      const snareEnv = Math.exp(-beatTime * 16);
      const noise = (Math.random() * 2 - 1) * snareEnv * 0.48;
      const tone = Math.sin(2 * Math.PI * 230 * Math.exp(-beatTime * 12) * beatTime) * snareEnv * 0.38;
      left += (noise + tone) * 0.95;
      right += (noise + tone) * 0.95;
    }

    // --- 3. ⚡ 찰진 16비트 하이햇 & 셰이커 (Hi-Hat & Shaker) ---
    if (sixteenthTime < 0.065) {
      const hhEnv = Math.exp(-sixteenthTime * 45);
      const hhAccent = (sixteenthIndex % 2 === 1) ? 1.4 : 0.7;
      const hhNoise = (Math.random() * 2 - 1) * hhEnv * 0.20 * hhAccent;
      left += hhNoise * 0.75;
      right += hhNoise * 1.25;
    }

    // --- 4. 🎸 808 펑키 베이스 (다이내믹 코드 진행) ---
    const bar = Math.floor(beatIndex / 4);
    let bassNote = 0;
    if (style === "idol") {
      const idolBass = [0, 0, 5, 5, 7, 7, 5, 0];
      bassNote = idolBass[bar % idolBass.length];
    } else if (style === "hurricane") {
      const hurrBass = [0, 0, 7, 7, 5, 5, 7, 0];
      bassNote = hurrBass[bar % hurrBass.length];
    } else {
      const candyBass = [0, 0, 4, 4, 5, 5, 7, 7];
      bassNote = candyBass[bar % candyBass.length];
    }
    const bassFreq = (rootFreq * 0.5) * Math.pow(2, bassNote / 12);
    const bassEnv = Math.exp(-(beatTime % (beatSec * 0.5)) * 6.0);
    // 사이드체인(Ducking): 킥이 칠 때 베이스 음량이 살짝 내려앉았다 솟구치는 클럽 EDM 펌핑 효과
    const sidechain = Math.min(1.0, beatTime * 5.0);
    const bassWave = (Math.sin(2 * Math.PI * bassFreq * t) + 0.35 * Math.sin(4 * Math.PI * bassFreq * t)) * bassEnv * sidechain * 0.52;
    left += bassWave * 0.95;
    right += bassWave * 0.95;

    // --- 5. 🎹 다성 화음 신스 패드 (Rich Chord Progression) ---
    const chordStep = Math.floor(t / (beatSec * 2));
    const chordRoots = [0, 5, 7, 5];
    const cRoot = rootFreq * Math.pow(2, chordRoots[chordStep % 4] / 12);
    // 3화음 (Root, 3rd, 5th)
    const f1 = cRoot;
    const f2 = cRoot * Math.pow(2, (style === "hurricane" ? 3 : 4) / 12);
    const f3 = cRoot * Math.pow(2, 7 / 12);
    const chordEnv = 0.5 + 0.5 * Math.cos(2 * Math.PI * (t / (beatSec * 2)));
    const chordWave = (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t) + Math.sin(2 * Math.PI * f3 * t)) * 0.12 * chordEnv * sidechain;
    left += chordWave * 0.8;
    right += chordWave * 1.2;

    // --- 6. ✨ 화려한 K-POP 신스 훅 멜로디 (SuperSaw Lead with Stereo Spread) ---
    let leadFreq = rootFreq;
    if (style === "idol") {
      const melody = [0, 0, 3, 5, 7, 7, 10, 7, 5, 3, 0, 5, 7, 10, 12, 10];
      const step = Math.floor(t / (sixteenthSec * 2)) % melody.length;
      leadFreq = rootFreq * Math.pow(2, (melody[step] + 12) / 12);
    } else if (style === "hurricane") {
      const melody = [7, 7, 5, 7, 10, 12, 10, 7, 5, 3, 5, 7, 12, 10, 7, 0];
      const step = Math.floor(t / (sixteenthSec * 2)) % melody.length;
      leadFreq = rootFreq * Math.pow(2, (melody[step] + 12) / 12);
    } else {
      const melody = [4, 2, 0, 4, 7, 9, 7, 9, 11, 12, 11, 9, 7, 4, 2, 0];
      const step = Math.floor(t / (sixteenthSec * 2)) % melody.length;
      leadFreq = rootFreq * Math.pow(2, (melody[step] + 12) / 12);
    }
    const noteTime = (t % (sixteenthSec * 2));
    const leadEnv = Math.exp(-noteTime * 5.0);

    // 5-오실레이터 슈퍼쏘우 (두툼하고 웅장한 K-POP 리드)
    const s1 = (2 * ((t * leadFreq) % 1) - 1);
    const s2 = (2 * ((t * (leadFreq * 1.007)) % 1) - 1);
    const s3 = (2 * ((t * (leadFreq * 0.993)) % 1) - 1);
    const s4 = (2 * ((t * (leadFreq * 1.014)) % 1) - 1);
    const s5 = (2 * ((t * (leadFreq * 0.986)) % 1) - 1);
    const leadL = (s1 * 0.35 + s2 * 0.25 + s4 * 0.2) * leadEnv * 0.38;
    const leadR = (s1 * 0.35 + s3 * 0.25 + s5 * 0.2) * leadEnv * 0.38;

    left += leadL;
    right += leadR;

    // --- 7. 룸 리버브 & 마스터링 리미터 ---
    const [revL, revR] = reverb(left, right);
    const finalL = Math.max(-0.95, Math.min(0.95, revL * 0.88));
    const finalR = Math.max(-0.95, Math.min(0.95, revR * 0.88));

    buffer.writeInt16LE(Math.floor(finalL * 32767), i * 4);
    buffer.writeInt16LE(Math.floor(finalR * 32767), i * 4 + 2);
  }

  return buffer;
}

async function renderMp3(filename, pcmBuffer) {
  const wavPath = filename.replace(/\.mp3$/, ".pcm");
  fs.writeFileSync(wavPath, pcmBuffer);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-f", "s16le",
      "-ar", String(SAMPLE_RATE),
      "-ac", "2",
      "-i", wavPath,
      "-b:a", "192k",
      "-ar", "44100",
      filename
    ]);

    ffmpeg.on("close", (code) => {
      try { fs.unlinkSync(wavPath); } catch {}
      if (code === 0) resolve();
      else reject(new Error("ffmpeg exit code " + code));
    });
  });
}

async function buildAll() {
  const outDir = path.resolve("assets/music");
  console.log("Mastering Studio K-POP MP3 tracks in", outDir);

  // 1. idol (132 BPM, 85초)
  console.log("1. Mastering kpop_idol.mp3 (SuperSaw + 808 Sub + EDM Chords)...");
  const idolBuf = generateTrackPcm({ bpm: 132, durationSec: 85, rootFreq: 261.63, style: "idol" });
  await renderMp3(path.join(outDir, "kpop_idol.mp3"), idolBuf);

  // 2. hurricane (138 BPM, 85초)
  console.log("2. Mastering kpop_hurricane.mp3 (K-Bounce + Brass Lead + Club Kicks)...");
  const hurrBuf = generateTrackPcm({ bpm: 138, durationSec: 85, rootFreq: 220.00, style: "hurricane" });
  await renderMp3(path.join(outDir, "kpop_hurricane.mp3"), hurrBuf);

  // 3. candy (126 BPM, 85초)
  console.log("3. Mastering kpop_candy.mp3 (Retro Disco + Pop Chords)...");
  const candyBuf = generateTrackPcm({ bpm: 126, durationSec: 85, rootFreq: 293.66, style: "candy" });
  await renderMp3(path.join(outDir, "kpop_candy.mp3"), candyBuf);

  console.log("All Studio K-POP MP3 tracks rendered and mastered successfully!");
}

buildAll().catch(console.error);
