// 🔒 종단간 암호화(E2EE) 모듈 (AES-256-GCM & PBKDF2)
// 규칙: 제3자 중개 서버가 패킷을 가로채더라도 방 코드(Key)를 모르면 내용을 1바이트도 해독할 수 없어요.
// 카메라 영상이나 개인정보는 애초에 네트워크로 나가지 않으며, 게임 점수/상태 메시지도 완벽히 암호화해요.

const PBKDF2_SALT = new TextEncoder().encode("KineticKaboom-ZeroTrust-Salt-2026");
const PBKDF2_ITERATIONS = 100000;

/**
 * 방 코드(예: KABOOM-A7X9K2)로부터 256비트 AES-GCM 암호화 키를 브라우저 내에서 안전하게 생성해요.
 */
export async function deriveRoomKey(roomCode) {
  if (!roomCode || typeof roomCode !== "string") {
    throw new Error("유효하지 않은 방 코드입니다.");
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(roomCode.trim().toUpperCase()),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 일반 자바스크립트 객체를 AES-256-GCM으로 암호화하여 Base64 패킷으로 변환해요.
 * @param {object} obj - 전송할 JSON 데이터
 * @param {CryptoKey} cryptoKey - 유도된 AES-GCM 키
 * @returns {Promise<string>} 직렬화된 암호문 패킷 문자열
 */
export async function encryptPayload(obj, cryptoKey) {
  try {
    const rawText = JSON.stringify(obj);
    const encData = new TextEncoder().encode(rawText);
    // 12바이트 랜덤 IV (매 패킷마다 고유하게 생성하여 재전송 공격 방지)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      encData
    );

    // IV(12바이트) + 암호문(태그 포함) 결합
    const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuffer), iv.length);

    // 전송을 위한 바이너리 -> Base64 인코딩
    return uint8ToBase64(combined);
  } catch (err) {
    console.error("🔒 패킷 암호화 오류:", err);
    throw new Error("패킷 암호화 실패");
  }
}

/**
 * Base64 암호문 패킷을 AES-256-GCM으로 복호화하여 원본 객체로 복원해요.
 * @param {string} packetStr - Base64 암호문 패킷
 * @param {CryptoKey} cryptoKey - 유도된 AES-GCM 키
 * @returns {Promise<object|null>} 복호화된 JSON 객체 (위변조 또는 키 불일치 시 null 반환)
 */
export async function decryptPayload(packetStr, cryptoKey) {
  try {
    if (typeof packetStr !== "string" || !packetStr) return null;
    const combined = base64ToUint8(packetStr);
    if (combined.length <= 12) return null; // IV 최소 길이 미달

    const iv = combined.subarray(0, 12);
    const ciphertext = combined.subarray(12);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext
    );

    const decodedText = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decodedText);
  } catch (err) {
    // 키가 다르거나 위변조된 경우 복호화 실패 (Zero-Trust에 따라 무시)
    return null;
  }
}

// 브라우저 및 안전한 Base64 변환 도우미
function uint8ToBase64(bytes) {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
