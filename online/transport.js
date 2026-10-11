// 연결 방법(전송 계층). 방 규칙(room.js)은 이 인터페이스만 알아요.
//
//   open(roomCode)  : 방 코드 채널에 연결
//   send(obj)       : 같은 방의 다른 사람들에게 보냄 (JSON으로 보낼 수 있는 객체)
//   onMessage(fn)   : 다른 사람이 보낸 메시지를 받음. 해제 함수를 돌려줌
//   close()         : 연결 끊기
//
// 지금 쓸 수 있는 구현
//   LocalTransport  : 같은 브라우저(같은 컴퓨터)의 다른 탭/창끼리 BroadcastChannel로 연결. 서버·비용 없음.
//   MemoryHub       : 테스트용. 한 프로그램 안에서 가짜 연결을 만들어 줌.
//
// 나중에 추가할 구현 (이 인터페이스만 맞추면 방 규칙·화면은 그대로 쓸 수 있어요)
//   RemoteTransport : 진짜 원격 연결. 무료로 가능한 후보는 online/README.md 참고.

export class Transport {
  constructor() { this.handlers = new Set(); }
  async open(_roomCode) { throw new Error("구현되지 않았어요"); }
  send(_obj) { throw new Error("구현되지 않았어요"); }
  close() { this.handlers.clear(); }
  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  _deliver(obj) { for (const h of [...this.handlers]) { try { h(obj); } catch (e) { console.error("메시지 처리 오류", e); } } }
}

/** 같은 브라우저 탭끼리 연결 (BroadcastChannel). 보낸 탭 자신에게는 전달되지 않아요. */
export class LocalTransport extends Transport {
  static isSupported() { return typeof BroadcastChannel !== "undefined"; }
  async open(roomCode) {
    if (!LocalTransport.isSupported()) throw new Error("이 브라우저는 탭 간 연결을 지원하지 않아요");
    this.channel = new BroadcastChannel("kinetic-kaboom:" + roomCode);
    this.channel.onmessage = (e) => this._deliver(e.data);
  }
  send(obj) { this.channel?.postMessage(obj); }
  close() { this.channel?.close(); this.channel = null; super.close(); }
}

/** 테스트용 가짜 네트워크: 같은 코드에 연결한 transport끼리 서로 메시지를 전달(자기 자신 제외). */
export class MemoryHub {
  constructor() { this.rooms = new Map(); }
  create() { return new MemoryTransport(this); }
}
export class MemoryTransport extends Transport {
  constructor(hub) { super(); this.hub = hub; this.room = null; }
  async open(roomCode) {
    this.room = roomCode;
    if (!this.hub.rooms.has(roomCode)) this.hub.rooms.set(roomCode, new Set());
    this.hub.rooms.get(roomCode).add(this);
  }
  send(obj) {
    const peers = this.hub.rooms.get(this.room);
    if (!peers) return;
    const copy = JSON.parse(JSON.stringify(obj));        // 실제 전송처럼 복사본만 전달
    for (const p of peers) if (p !== this) queueMicrotask(() => p._deliver(copy));
  }
  close() { this.hub.rooms.get(this.room)?.delete(this); super.close(); }
}

/** kind에 맞는 전송 방식을 만들어 줘요. 원격 연결은 아직 준비 중이에요. */
export function createTransport(kind = "local") {
  if (kind === "local") return new LocalTransport();
  throw new Error(`'${kind}' 연결은 아직 준비 중이에요`);
}
