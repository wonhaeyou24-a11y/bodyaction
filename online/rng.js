// 시드(씨앗 숫자) 기반 난수와 초대 코드 만들기.
// 같은 시드를 넣으면 항상 같은 순서의 난수가 나와서, 두 사람이 "똑같은 판"을 하게 해 줘요.

/** mulberry32: 작고 빠른 시드 난수 생성기. 0 이상 1 미만의 숫자를 돌려주는 함수를 만들어 줘요. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

export function randomSeed() {
  const b = randomBytes(4);
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

export function randomId() {
  return Array.from(randomBytes(9), (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

// 헷갈리는 글자(0 O 1 I L)를 뺀 알파벳. 6글자 = 약 8.9억 가지라서 남이 우연히 맞히기 어려워요.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function makeInviteCode() {
  const b = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return "KABOOM-" + s;
}

/** 사용자가 입력한 코드를 정리: 공백 제거, 대문자, "KABOOM-" 접두어 자동 보충. */
export function normalizeCode(input) {
  const raw = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = raw.startsWith("KABOOM") ? raw.slice(6) : raw;
  return "KABOOM-" + body;
}
