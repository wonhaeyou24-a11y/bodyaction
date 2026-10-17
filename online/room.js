// 비공개 방(2명) 규칙. 화면(DOM)이나 게임 코드를 전혀 모르고, transport(연결 방법)만 써요.
//
// 흐름:  방장 create() -> 초대 코드 공유 -> 손님 join(코드) -> 둘 다 준비 -> 방장 start()
//        -> 각자 같은 시드로 게임 -> finish() -> 'result'(승/패/무) -> requestRematch() -> 다시 start
//
// 방장이 방의 "기준"이에요: 손님은 방장에게 부탁(준비/참가)만 하고, 방 상태는 방장이 알려 줘요.
//
// 발생하는 이벤트 (on(이름, 함수)):
//   lobby           { mode, trackId, phase, players[] }   방 상태가 바뀜
//   start           { mode, seed, trackId }               게임을 시작해야 함
//   opponent-score  { name, score, combo }                상대 점수 실시간
//   result          { outcome, forfeit, me, opp }         두 명 다 끝남 (outcome: win|lose|draw)
//   rematch         { me, opp }                           재대결 희망 상태
//   peer-left       { name, reason }                      상대가 나감/연결 끊김
//   closed          { reason }                            방이 닫힘
import { MSG, ONLINE_MODES, ROOM_CODE_RE, sanitize, cleanName, cleanAvatar } from "./protocol.js";
import { makeInviteCode, normalizeCode, randomSeed, randomId } from "./rng.js";

export class RoomError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class Room {
  /**
   * @param {object} o
   * @param {import("./transport.js").Transport} o.transport
   * @param {{name:string, avatar?:string}} o.self
   */
  constructor({ transport, self, pingMs = 2000, staleMs = 7000, joinTimeoutMs = 5000, now = () => Date.now() }) {
    this.transport = transport;
    this.id = randomId();
    this.self = { name: cleanName(self?.name), avatar: cleanAvatar(self?.avatar) };
    this.pingMs = pingMs; this.staleMs = staleMs; this.joinTimeoutMs = joinTimeoutMs; this.now = now;
    this.listeners = {};
    this.reset();
  }

  reset() {
    this.phase = "idle";          // idle | lobby | playing | finished
    this.isHost = false;
    this.hostId = null;
    this.code = null;
    this.mode = ONLINE_MODES[0];
    this.trackId = null;
    this.players = new Map();     // id -> { id, name, avatar, ready, score, combo, finished, rematch, seen }
    this.lastResult = null;
  }

  // ---------- 이벤트 ----------
  on(evt, fn) { (this.listeners[evt] ??= new Set()).add(fn); return () => this.listeners[evt].delete(fn); }
  _emit(evt, data) { for (const fn of [...(this.listeners[evt] ?? [])]) { try { fn(data); } catch (e) { console.error(e); } } }

  get me() { return this.players.get(this.id); }
  get opponent() { for (const p of this.players.values()) if (p.id !== this.id) return p; return null; }
  get active() { return this.phase !== "idle"; }

  snapshot() {
    return {
      mode: this.mode, trackId: this.trackId, phase: this.phase, code: this.code, isHost: this.isHost,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, ready: p.ready })),
    };
  }

  _addPlayer(id, name, avatar) {
    const p = { id, name: cleanName(name), avatar: cleanAvatar(avatar), ready: false, score: 0, combo: 0, finished: false, rematch: false, seen: this.now() };
    this.players.set(id, p);
    return p;
  }

  // ---------- 방 만들기 / 참가 ----------
  /** @param fixedCode 가족방처럼 정해 둔 코드로 열고 싶을 때(KABOOM-XXXXXX). 없으면 새 코드를 만들어요 */
  async create(mode = ONLINE_MODES[0], trackId = null, fixedCode = null) {
    if (this.active) throw new RoomError("busy", "이미 방에 들어와 있어요");
    if (!ONLINE_MODES.includes(mode)) throw new RoomError("bad_mode", "온라인 대결을 지원하지 않는 게임이에요");
    if (fixedCode != null && !ROOM_CODE_RE.test(normalizeCode(fixedCode))) throw new RoomError("bad_code", "가족방 코드가 올바르지 않아요");
    this.isHost = true; this.hostId = this.id; this.mode = mode; this.trackId = trackId;
    this.code = fixedCode ? normalizeCode(fixedCode) : makeInviteCode();
    try { await this.transport.open(this.code, { isHost: true }); }
    catch (e) {
      this.transport.close(); this.reset();
      if (e?.code === "code_in_use") throw new RoomError("code_in_use", "이 코드로 열린 방이 이미 있어요. 다른 기기에서 방을 열어 두었거나, 방금 닫은 방이 정리되는 중이에요(최대 1분). 잠시 뒤 다시 눌러 주세요");
      throw e;
    }
    this._attach();
    this._addPlayer(this.id, this.self.name, this.self.avatar);
    this.phase = "lobby";
    this._startTimers();
    this._emit("lobby", this.snapshot());
    return this.code;
  }

  async join(codeInput) {
    if (this.active) throw new RoomError("busy", "이미 방에 들어와 있어요");
    const code = normalizeCode(codeInput);
    if (!ROOM_CODE_RE.test(code)) throw new RoomError("bad_code", "초대 코드가 올바르지 않아요");
    this.isHost = false; this.code = code;
    await this.transport.open(code, { isHost: false });
    this._attach();
    const reply = new Promise((resolve, reject) => {
      this._joinWait = { resolve, reject };
      this._joinTimer = setTimeout(() => reject(new RoomError("not_found", this.transport.explain?.() || "방을 찾을 수 없어요. 코드를 다시 확인해 주세요")), this.joinTimeoutMs);
    });
    const sendJoin = () => this._send({ type: MSG.JOIN, code, name: this.self.name, avatar: this.self.avatar });
    sendJoin();
    this._joinResend = setInterval(sendJoin, 1000);       // 연결이 늦게 열려도 답이 올 때까지 참가 요청을 1초마다 다시 보내요 (방장은 같은 요청을 여러 번 받아도 한 번만 처리)
    try { await reply; }
    catch (e) { this._detach(); this.transport.close(); this.reset(); throw e; }
    finally { clearTimeout(this._joinTimer); clearInterval(this._joinResend); this._joinWait = null; }
    this._startTimers();
    return code;
  }

  // ---------- 방 안에서 하는 일 ----------
  setReady(ready) {
    if (this.phase !== "lobby") return;
    this.me.ready = !!ready;
    if (this.isHost) this._broadcastLobby();
    else this._send({ type: MSG.READY, ready: !!ready });
    this._emit("lobby", this.snapshot());
  }

  /** 방장만: 게임/곡 바꾸기 */
  setMode(mode, trackId = null) {
    if (!this.isHost || this.phase !== "lobby" || !ONLINE_MODES.includes(mode)) return;
    this.mode = mode; this.trackId = trackId;
    for (const p of this.players.values()) p.ready = false;      // 게임이 바뀌면 다시 준비
    this._broadcastLobby();
    this._emit("lobby", this.snapshot());
  }

  canStart() {
    return this.isHost && this.phase === "lobby" && this.players.size === 2 && [...this.players.values()].every((p) => p.ready || p.id === this.id);
  }

  /** 방장만: 두 명이 준비되면 시작. 시작 정보(시드 등)를 돌려줘요. */
  start() {
    if (!this.canStart()) return null;
    return this._launch();
  }

  _launch() {
    const info = { mode: this.mode, seed: randomSeed(), trackId: this.trackId };
    this._send({ type: MSG.START, ...info });
    this._begin(info);
    return info;
  }

  _begin({ mode, seed, trackId }) {
    this.mode = mode; this.trackId = trackId ?? null; this.phase = "playing"; this.lastResult = null;
    for (const p of this.players.values()) { p.score = 0; p.combo = 0; p.finished = false; p.rematch = false; p.ready = false; }
    this._emit("start", { mode, seed, trackId: this.trackId });
  }

  /** 게임 중 내 점수 (자주 불러도 돼요. 호출하는 쪽에서 0.25초 정도로 줄여 주세요) */
  reportScore(score, combo = 0) {
    if (this.phase !== "playing" || !this.me) return;
    this.me.score = score; this.me.combo = combo;
    this._send({ type: MSG.SCORE, score, combo });
  }

  /** 내 게임이 끝났을 때 */
  finish(score, combo = 0) {
    if (this.phase !== "playing" || !this.me || this.me.finished) return;
    this.me.score = score; this.me.combo = combo; this.me.finished = true;
    this._send({ type: MSG.FINISH, score, combo });
    this._maybeResult();
  }

  requestRematch() {
    if (this.phase !== "finished" || !this.me) return;
    this.me.rematch = true;
    this._send({ type: MSG.REMATCH });
    this._emit("rematch", { me: true, opp: !!this.opponent?.rematch });
    this._tryRematchStart();
  }

  _tryRematchStart() {
    if (this.isHost && this.phase === "finished" && this.me?.rematch && this.opponent?.rematch) this._launch();
  }

  leave(reason = "left") {
    if (!this.active) return;
    this._send({ type: MSG.LEAVE });
    this._close(reason);
  }

  // ---------- 결과 ----------
  _maybeResult() {
    if (this.phase !== "playing" || !this.me?.finished) return;
    const opp = this.opponent;
    if (opp && !opp.finished) return;                      // 상대가 아직 하는 중
    const forfeit = !opp;                                  // 상대가 나갔다 -> 내 승리
    const outcome = forfeit ? "win" : this.me.score > opp.score ? "win" : this.me.score < opp.score ? "lose" : "draw";
    this.phase = "finished";
    this.lastResult = {
      outcome, forfeit,
      me: { name: this.me.name, score: this.me.score, combo: this.me.combo },
      opp: opp ? { name: opp.name, score: opp.score, combo: opp.combo } : null,
    };
    this._emit("result", this.lastResult);
  }

  // ---------- 메시지 보내기/받기 ----------
  _send(msg) { this.transport.send({ ...msg, from: this.id }); }
  _attach() { this._off = this.transport.onMessage((raw) => this._onRaw(raw)); }
  _detach() { this._off?.(); this._off = null; }
  _broadcastLobby() { this._send({ type: MSG.LOBBY, ...this.snapshot() }); }

  _onRaw(raw) {
    const msg = sanitize(raw);
    if (!msg || msg.from === this.id) return;
    if (msg.to && msg.to !== this.id) return;              // 나에게 온 게 아님
    const sender = this.players.get(msg.from);
    if (sender) sender.seen = this.now();
    this.isHost ? this._onHost(msg, sender) : this._onGuest(msg, sender);
  }

  _onHost(msg, sender) {
    switch (msg.type) {
      case MSG.JOIN: {
        if (msg.code !== this.code) return;
        if (sender) { this._reply(msg.from, MSG.JOIN_OK); return; }                   // 이미 들어온 사람의 재요청
        if (this.players.size >= 2 || this.phase !== "lobby") { this._send({ type: MSG.JOIN_FULL, to: msg.from }); return; }
        this._addPlayer(msg.from, msg.name, msg.avatar);
        this._reply(msg.from, MSG.JOIN_OK);
        this._broadcastLobby();
        this._emit("lobby", this.snapshot());
        return;
      }
      case MSG.READY:
        if (sender && this.phase === "lobby") { sender.ready = msg.ready; this._broadcastLobby(); this._emit("lobby", this.snapshot()); }
        return;
      default: this._onPeerCommon(msg, sender);
    }
  }

  _reply(to, type) { this._send({ type, to, ...this.snapshot() }); }

  _onGuest(msg, sender) {
    switch (msg.type) {
      case MSG.JOIN_OK:
        if (!this._joinWait) return;
        this.hostId = msg.from;
        this._applyLobby(msg);
        this._joinWait.resolve();
        return;
      case MSG.JOIN_FULL:
        this._joinWait?.reject(new RoomError("full", "방이 가득 찼거나 이미 게임이 시작됐어요"));
        return;
      case MSG.LOBBY:
        if (msg.from !== this.hostId) return;
        this._applyLobby(msg);
        this._emit("lobby", this.snapshot());
        return;
      case MSG.START:
        if (msg.from !== this.hostId || this.phase === "playing") return;
        this._begin(msg);
        return;
      default: this._onPeerCommon(msg, sender);
    }
  }

  _applyLobby(msg) {
    this.mode = msg.mode; this.trackId = msg.trackId;
    if (this.phase === "idle") this.phase = "lobby";
    else if (this.phase === "finished" && msg.phase === "lobby") this.phase = "lobby";
    const incoming = new Map(msg.players.map((p) => [p.id, p]));
    for (const id of [...this.players.keys()]) if (!incoming.has(id)) this.players.delete(id);
    for (const p of incoming.values()) {
      const cur = this.players.get(p.id) ?? this._addPlayer(p.id, p.name, p.avatar);
      cur.name = p.name; cur.avatar = p.avatar; cur.ready = p.ready;
    }
    if (!this.players.has(this.id)) this._addPlayer(this.id, this.self.name, this.self.avatar);
    this.me.ready = incoming.get(this.id)?.ready ?? this.me.ready;
  }

  _onPeerCommon(msg, sender) {
    if (!sender) return;
    switch (msg.type) {
      case MSG.SCORE:
        if (this.phase !== "playing") return;
        sender.score = msg.score; sender.combo = msg.combo;
        this._emit("opponent-score", { name: sender.name, score: sender.score, combo: sender.combo });
        return;
      case MSG.FINISH:
        if (this.phase !== "playing") return;
        sender.score = msg.score; sender.combo = msg.combo; sender.finished = true;
        this._maybeResult();
        return;
      case MSG.REMATCH:
        if (this.phase !== "finished") return;
        sender.rematch = true;
        this._emit("rematch", { me: !!this.me?.rematch, opp: true });
        this._tryRematchStart();
        return;
      case MSG.LEAVE:
        this._peerGone(sender, "left");
        return;
      default: return;                                    // PING 등: seen 갱신만으로 충분
    }
  }

  _peerGone(p, reason) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    if (p.id === this.hostId && !this.isHost) { this._close("host-left"); return; }   // 방장이 나가면 방이 닫힘
    this._emit("peer-left", { name: p.name, reason });
    if (this.isHost && this.phase === "lobby") { this._broadcastLobby(); this._emit("lobby", this.snapshot()); }
    this._maybeResult();                                  // 게임 중이었다면 상대 기권승 처리
  }

  // ---------- 연결 확인(ping) ----------
  _startTimers() {
    if (!this.pingMs) return;
    this._pingTimer = setInterval(() => {
      this._send({ type: MSG.PING });
      const t = this.now();
      for (const p of [...this.players.values()]) if (p.id !== this.id && t - p.seen > this.staleMs) this._peerGone(p, "timeout");
    }, this.pingMs);
  }

  _close(reason) {
    clearInterval(this._pingTimer); this._pingTimer = null;
    this._detach();
    this.transport.close();
    this.reset();
    this._emit("closed", { reason });
  }
}
