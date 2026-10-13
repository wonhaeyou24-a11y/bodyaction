// E2EE 암호화 모듈 테스트: node online/test/crypto.test.js
import assert from "node:assert/strict";
import { deriveRoomKey, encryptPayload, decryptPayload } from "../crypto.js";

async function runTests() {
  console.log("🔒 E2EE 암호화 단위 테스트 시작...");

  // 1. 키 생성 테스트
  const roomCode = "KABOOM-A7X9K2";
  const key1 = await deriveRoomKey(roomCode);
  const key2 = await deriveRoomKey(roomCode);
  assert.ok(key1, "키 생성이 성공해야 해요");

  // 2. 암호화 및 복호화 성공 테스트
  const sampleMsg = {
    type: "score",
    score: 12500,
    combo: 14,
    from: "user-1234"
  };

  const encrypted = await encryptPayload(sampleMsg, key1);
  assert.ok(typeof encrypted === "string" && encrypted.length > 20, "암호문은 Base64 문자열이어야 해요");
  assert.ok(!encrypted.includes("12500"), "암호문에 원본 텍스트가 노출되면 안 돼요");

  const decrypted = await decryptPayload(encrypted, key2);
  assert.deepEqual(decrypted, sampleMsg, "동일한 방 키로 복호화된 객체는 원본과 정확히 일치해야 해요");

  // 3. 다른 방 코드로 복호화 시도 (위변조/제3자 감청 방지)
  const wrongKey = await deriveRoomKey("KABOOM-WRONG9");
  const failedDecrypt = await decryptPayload(encrypted, wrongKey);
  assert.equal(failedDecrypt, null, "키가 다르면 복호화 결과는 null이어야 해요");

  // 4. 패킷 위변조 공격 시도 (인증 태그 불일치로 차단)
  const tampered = encrypted.slice(0, -4) + "AAAA";
  const tamperedResult = await decryptPayload(tampered, key1);
  assert.equal(tamperedResult, null, "위변조된 패킷은 복호화되지 않고 즉각 폐기되어야 해요");

  console.log("✅ E2EE 암호화 단위 테스트 통과 (AES-256-GCM & PBKDF2)");
}

runTests().catch((err) => {
  console.error("❌ E2EE 테스트 실패:", err);
  process.exit(1);
});
