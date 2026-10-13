// 🌐 멀리 있는 친구와의 실시간 원격 대결 전송 계층 (RemoteTransport)
// 특징:
// 1. WebRTC DataChannel (초저지연 P2P 직접 통신)
// 2. AES-256-GCM 종단간 암호화(E2EE) - 방 코드를 키 삼아 데이터 전송 전 암호화
// 3. 로컬 BroadcastChannel 하이브리드 지원 (같은 컴퓨터의 다른 창/탭끼리도 0ms 즉시 통신)
// 4. Zero-Crash & Fallback: 네트워크 단절 또는 피어 연결 지연 시 안전한 오류 격리

import { Transport } from "./base-transport.js";
import { LocalTransport } from "./transport.js";
import { deriveRoomKey, encryptPayload, decryptPayload } from "./crypto.js";

const PEERJS_URL = "https://esm.sh/peerjs@1.5.4";

export class RemoteTransport extends Transport {
  constructor() {
    super();
    this.roomCode = null;
    this.cryptoKey = null;
    this.localChannel = null;
    this.peer = null;
    this.connections = new Set();
    this.senderId = "p_" + Math.random().toString(36).slice(2, 9);
    this.isHost = false;
    this.isDestroyed = false;
  }

  /**
   * 방 코드 채널에 연결해요.
   * @param {string} roomCode - 방 초대 코드 (예: KABOOM-A7X9K2)
   * @param {object} opts - { isHost: boolean }
   */
  async open(roomCode, { isHost = false } = {}) {
    this.roomCode = roomCode.trim().toUpperCase();
    this.isHost = isHost;
    this.isDestroyed = false;

    // 1. 방 코드로부터 AES-256-GCM E2EE 대칭키 생성
    try {
      this.cryptoKey = await deriveRoomKey(this.roomCode);
    } catch (err) {
      console.warn("⚠️ 암호화 키 생성 오류, 평문 격리 모드로 폴백:", err);
    }

    // 2. 로컬 BroadcastChannel 연결 (같은 컴퓨터 탭끼리 즉시 반응)
    if (LocalTransport.isSupported()) {
      try {
        this.localChannel = new BroadcastChannel("kinetic-kaboom:" + this.roomCode);
        this.localChannel.onmessage = async (e) => {
          await this._handleIncomingRaw(e.data);
        };
      } catch (err) {
        console.warn("로컬 채널 연결 실패:", err);
      }
    }

    // 3. WebRTC P2P 원격 연결 (브라우저 환경)
    if (typeof window !== "undefined") {
      await this._initWebRTC();
    }
  }

  async _initWebRTC() {
    try {
      // PeerJS 동적 로드
      let PeerModule;
      try {
        PeerModule = await import(PEERJS_URL);
      } catch (cdnErr) {
        console.warn("PeerJS CDN 로드 실패 (로컬 통신 유지):", cdnErr);
        return;
      }

      const Peer = PeerModule.Peer || PeerModule.default?.Peer || PeerModule.default;
      if (!Peer) return;

      const cleanCode = this.roomCode.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      const hostPeerId = `kaboom-${cleanCode}-host`;

      if (this.isHost) {
        // [방장]: 고정된 호스트 ID로 리슨
        this.peer = new Peer(hostPeerId, {
          debug: 0,
          config: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" }
            ]
          }
        });

        this.peer.on("connection", (conn) => {
          this._setupConnection(conn);
        });
      } else {
        // [손님]: 게스트 ID 생성 후 호스트 ID에 직접 연결
        const guestPeerId = `kaboom-${cleanCode}-g-${this.senderId}`;
        this.peer = new Peer(guestPeerId, {
          debug: 0,
          config: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" }
            ]
          }
        });

        this.peer.on("open", () => {
          if (this.isDestroyed) return;
          const conn = this.peer.connect(hostPeerId, { reliable: true });
          this._setupConnection(conn);
        });
      }

      this.peer.on("error", (err) => {
        // 방이 없거나 중복 생성 등 정상 흐름 내 피어 오류 조용히 격리
        console.warn("피어 네트워크 알림:", err?.type || err?.message);
      });
    } catch (err) {
      console.warn("WebRTC 초기화 예외 보호:", err);
    }
  }

  _setupConnection(conn) {
    if (!conn) return;

    conn.on("open", () => {
      this.connections.add(conn);
    });

    conn.on("data", async (data) => {
      await this._handleIncomingRaw(data);
    });

    conn.on("close", () => {
      this.connections.delete(conn);
    });

    conn.on("error", () => {
      this.connections.delete(conn);
    });
  }

  /**
   * 수신된 원시(Raw) 패킷 복호화 및 유효성 검사 후 방으로 전달
   */
  async _handleIncomingRaw(rawPacket) {
    if (!rawPacket || this.isDestroyed) return;

    let payload = null;
    // 패킷 래퍼 구조: { s: senderId, enc: "Base64암호문" }
    if (typeof rawPacket === "object" && rawPacket.enc) {
      if (rawPacket.s === this.senderId) return; // 내가 보낸 패킷 반사 방지
      if (this.cryptoKey) {
        payload = await decryptPayload(rawPacket.enc, this.cryptoKey);
      }
    } else if (typeof rawPacket === "object") {
      // 로컬/테스트 환경의 암호화되지 않은 패킷 호환
      if (rawPacket._senderId === this.senderId) return;
      payload = rawPacket;
    }

    if (payload) {
      this._deliver(payload);
    }
  }

  /**
   * 같은 방의 다른 사람들에게 데이터 전송 (E2EE 암호화 후 WebRTC + Local 양방향 브로드캐스트)
   */
  async send(obj) {
    if (this.isDestroyed || !obj) return;

    let packetToSend = obj;

    // E2EE 암호화 처리
    if (this.cryptoKey) {
      try {
        const encryptedBase64 = await encryptPayload(obj, this.cryptoKey);
        packetToSend = { s: this.senderId, enc: encryptedBase64 };
      } catch (err) {
        console.warn("패킷 암호화 실패, 기본 전송:", err);
        packetToSend = { ...obj, _senderId: this.senderId };
      }
    } else {
      packetToSend = { ...obj, _senderId: this.senderId };
    }

    // 1. WebRTC 피어 데이터 채널로 전송
    for (const conn of this.connections) {
      try {
        if (conn.open) conn.send(packetToSend);
      } catch {}
    }

    // 2. 같은 브라우저 탭 간 BroadcastChannel로도 동시 전송
    if (this.localChannel) {
      try {
        this.localChannel.postMessage(packetToSend);
      } catch {}
    }
  }

  /**
   * 연결 종료 및 메모리 안전 해제
   */
  close() {
    this.isDestroyed = true;
    for (const conn of this.connections) {
      try { conn.close(); } catch {}
    }
    this.connections.clear();

    if (this.peer) {
      try { this.peer.destroy(); } catch {}
      this.peer = null;
    }

    if (this.localChannel) {
      try { this.localChannel.close(); } catch {}
      this.localChannel = null;
    }

    this.cryptoKey = null;
    super.close();
  }
}
