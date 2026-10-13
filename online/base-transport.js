// 전송 계층 기본 인터페이스 (순환 참조 방지용 베이스 클래스)
export class Transport {
  constructor() { this.handlers = new Set(); }
  async open(_roomCode, _opts = {}) { throw new Error("구현되지 않았어요"); }
  send(_obj) { throw new Error("구현되지 않았어요"); }
  close() { this.handlers.clear(); }
  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  _deliver(obj) { for (const h of [...this.handlers]) { try { h(obj); } catch (e) { console.error("메시지 처리 오류", e); } } }
}
