// 온라인 대결 로직 테스트 (브라우저 없이 Node로 실행):  node online/test/room.test.js
import assert from "node:assert/strict";
import { mulberry32, makeInviteCode, normalizeCode, randomSeed } from "../rng.js";
import { sanitize, MSG, ROOM_CODE_RE } from "../protocol.js";
import { MemoryHub } from "../transport.js";
import { Room, RoomError } from "../room.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = () => tick(5);

function pair(opts = {}) {
  const hub = new MemoryHub();
  const mk = (name) => new Room({ transport: hub.create(), self: { name, avatar: "assets/avatar.jpg" }, pingMs: 0, joinTimeoutMs: 60, ...opts });
  return { hub, host: mk("방장"), guest: mk("손님") };
}
async function connected(opts) {
  const p = pair(opts);
  const code = await p.host.create("runner");
  await p.guest.join(code);
  await settle();
  return { ...p, code };
}
function collect(room, evt) { const out = []; room.on(evt, (d) => out.push(d)); return out; }

// ---------- 기초 도구 ----------
test("같은 시드는 같은 난수열, 다른 시드는 다른 난수열", () => {
  const a = mulberry32(1234), b = mulberry32(1234), c = mulberry32(999);
  const sa = Array.from({ length: 20 }, a), sb = Array.from({ length: 20 }, b), sc = Array.from({ length: 20 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});
test("초대 코드 형식과 정리", () => {
  const set = new Set();
  for (let i = 0; i < 500; i++) { const c = makeInviteCode(); assert.match(c, ROOM_CODE_RE); set.add(c); }
  assert.ok(set.size > 495, "코드가 거의 겹치지 않아야 해요");
  assert.equal(normalizeCode(" kaboom-ab c234 "), "KABOOM-ABC234");
  assert.equal(normalizeCode("abc234"), "KABOOM-ABC234");
  assert.ok(Number.isInteger(randomSeed()));
});

// ---------- 메시지 검사 (믿지 않기) ----------
test("sanitize: 이상한 메시지는 버리고, 이름/점수/아바타는 안전하게 정리", () => {
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({ type: "hack", from: "a" }), null);
  assert.equal(sanitize({ type: MSG.PING }), null, "보낸 사람이 없으면 무시");
  assert.equal(sanitize({ type: MSG.START, from: "a", mode: "balloon", seed: 1 }), null, "지원하지 않는 게임");
  assert.equal(sanitize({ type: MSG.JOIN, from: "a", code: "KABOOM-000000", name: "x" }), null, "코드 형식 오류");
  const j = sanitize({ type: MSG.JOIN, from: "a", code: "KABOOM-ABC234", name: "<img onerror=1>짱", avatar: "http://evil/x.jpg" });
  assert.equal(j.name, "img onerror=1짱".slice(0, 14));
  assert.ok(!/[<>&"']/.test(j.name));
  assert.equal(j.avatar, "assets/avatar.jpg", "외부 아바타 주소는 기본 이미지로");
  const s = sanitize({ type: MSG.SCORE, from: "a", score: 99999999999, combo: -5 });
  assert.equal(s.score, 10_000_000);
  assert.equal(s.combo, 0);
  assert.equal(sanitize({ type: MSG.SCORE, from: "a", score: "abc" }), null);
});

// ---------- 방 만들기 / 참가 ----------
test("방 만들기 -> 참가 -> 둘 다 로비에서 서로를 봄", async () => {
  const { host, guest, code } = await connected();
  assert.match(code, ROOM_CODE_RE);
  assert.equal(host.phase, "lobby");
  assert.equal(guest.phase, "lobby");
  assert.equal(host.players.size, 2);
  assert.equal(guest.players.size, 2);
  assert.equal(guest.opponent.name, "방장");
  assert.equal(host.opponent.name, "손님");
  assert.equal(guest.mode, "runner");
});
test("없는 방에 참가하면 not_found, 코드가 이상하면 bad_code", async () => {
  const { guest } = pair();
  await assert.rejects(() => guest.join("KABOOM-ZZZZZZ"), (e) => e instanceof RoomError && e.code === "not_found");
  assert.equal(guest.active, false, "실패하면 다시 시도할 수 있어야 해요");
  await assert.rejects(() => guest.join("12"), (e) => e.code === "bad_code");
});
test("세 번째 사람은 들어올 수 없음(full)", async () => {
  const { hub, code } = await connected();
  const third = new Room({ transport: hub.create(), self: { name: "셋째" }, pingMs: 0, joinTimeoutMs: 60 });
  await assert.rejects(() => third.join(code), (e) => e.code === "full");
});
test("게임이 이미 시작된 방에는 참가할 수 없음", async () => {
  const { hub, host, guest, code } = await connected();
  host.setReady(true); guest.setReady(true); await settle();
  host.start(); await settle();
  const late = new Room({ transport: hub.create(), self: { name: "지각" }, pingMs: 0, joinTimeoutMs: 60 });
  await assert.rejects(() => late.join(code), (e) => e.code === "full");
});

// ---------- 준비 / 시작 ----------
test("둘 다 준비해야만 방장이 시작할 수 있고, 손님은 시작할 수 없음", async () => {
  const { host, guest } = await connected();
  assert.equal(host.start(), null, "아직 준비 안 됨");
  guest.setReady(true); await settle();
  assert.equal(host.opponent.ready, true);
  assert.equal(guest.start(), null, "손님은 시작할 수 없어요");
  assert.ok(host.start(), "준비되면 시작");
});
test("시작하면 둘이 같은 시드/게임으로 시작 이벤트를 받음", async () => {
  const { host, guest } = await connected();
  const hs = collect(host, "start"), gs = collect(guest, "start");
  guest.setReady(true); await settle();
  const info = host.start(); await settle();
  assert.equal(hs.length, 1); assert.equal(gs.length, 1);
  assert.equal(hs[0].seed, gs[0].seed);
  assert.equal(hs[0].seed, info.seed);
  assert.equal(gs[0].mode, "runner");
  assert.equal(host.phase, "playing"); assert.equal(guest.phase, "playing");
});
test("방장이 게임을 바꾸면 준비가 풀리고 손님에게도 알려짐", async () => {
  const { host, guest } = await connected();
  guest.setReady(true); await settle();
  host.setMode("beat", "radetzky"); await settle();
  assert.equal(guest.mode, "beat"); assert.equal(guest.trackId, "radetzky");
  assert.equal(host.opponent.ready, false);
  guest.setMode("runner");                 // 손님이 바꾸려 해도 무시
  assert.equal(guest.mode, "beat");
});
test("가짜 시작 메시지(방장이 아닌 사람이 보냄)는 무시", async () => {
  const { hub, guest } = await connected();
  const starts = collect(guest, "start");
  const intruder = hub.create(); await intruder.open(guest.code);
  intruder.send({ type: MSG.START, from: "intruder", mode: "runner", seed: 5 });
  await settle();
  assert.equal(starts.length, 0);
  assert.equal(guest.phase, "lobby");
});

// ---------- 점수 / 결과 ----------
async function playing() {
  const r = await connected();
  r.guest.setReady(true); await settle();
  r.host.start(); await settle();
  return r;
}
test("상대 점수가 실시간으로 전달됨", async () => {
  const { host, guest } = await playing();
  const seen = collect(host, "opponent-score");
  guest.reportScore(120, 7); await settle();
  assert.deepEqual(seen.at(-1), { name: "손님", score: 120, combo: 7 });
});
test("둘 다 끝나면 점수 비교로 승/패 결정", async () => {
  const { host, guest } = await playing();
  const hr = collect(host, "result"), gr = collect(guest, "result");
  host.finish(500, 12); await settle();
  assert.equal(hr.length, 0, "상대를 기다리는 중");
  guest.finish(300, 5); await settle();
  assert.equal(hr[0].outcome, "win"); assert.equal(gr[0].outcome, "lose");
  assert.equal(hr[0].opp.score, 300); assert.equal(gr[0].opp.score, 500);
  assert.equal(host.phase, "finished");
});
test("점수가 같으면 무승부", async () => {
  const { host, guest } = await playing();
  const hr = collect(host, "result"), gr = collect(guest, "result");
  host.finish(250); guest.finish(250); await settle();
  assert.equal(hr[0].outcome, "draw"); assert.equal(gr[0].outcome, "draw");
});
test("게임 중 상대가 나가면 내가 끝날 때 기권승", async () => {
  const { host, guest } = await playing();
  const hr = collect(host, "result"), left = collect(host, "peer-left");
  guest.leave(); await settle();
  assert.equal(left.length, 1);
  host.finish(10); await settle();
  assert.equal(hr[0].outcome, "win"); assert.equal(hr[0].forfeit, true);
});
test("내가 먼저 끝나고 기다리는 중에 상대가 나가면 바로 기권승", async () => {
  const { host, guest } = await playing();
  const hr = collect(host, "result");
  host.finish(10); await settle();
  assert.equal(hr.length, 0);
  guest.leave(); await settle();
  assert.equal(hr[0].forfeit, true);
});

// ---------- 재대결 ----------
test("둘 다 재대결을 누르면 새 시드로 다시 시작", async () => {
  const { host, guest } = await playing();
  host.finish(100); guest.finish(50); await settle();
  const first = host.lastResult;
  const hs = collect(host, "start"), gs = collect(guest, "start");
  guest.requestRematch(); await settle();
  assert.equal(hs.length, 0, "한 명만 눌렀을 때는 시작하지 않음");
  host.requestRematch(); await settle();
  assert.equal(hs.length, 1); assert.equal(gs.length, 1);
  assert.equal(hs[0].seed, gs[0].seed);
  assert.equal(host.phase, "playing");
  assert.equal(host.me.score, 0, "점수가 초기화돼요");
  assert.ok(first);
});
test("재대결은 결과가 나온 뒤에만 가능", async () => {
  const { host } = await playing();
  const ev = collect(host, "rematch");
  host.requestRematch();
  assert.equal(ev.length, 0);
});

// ---------- 나가기 / 끊김 ----------
test("방장이 나가면 손님 방이 닫힘", async () => {
  const { host, guest } = await connected();
  const closed = collect(guest, "closed");
  host.leave(); await settle();
  assert.equal(closed[0].reason, "host-left");
  assert.equal(guest.active, false);
});
test("손님이 로비에서 나가면 방장 방은 유지되고 다른 사람이 들어올 수 있음", async () => {
  const { hub, host, guest, code } = await connected();
  guest.leave(); await settle();
  assert.equal(host.players.size, 1); assert.equal(host.phase, "lobby");
  const next = new Room({ transport: hub.create(), self: { name: "새손님" }, pingMs: 0, joinTimeoutMs: 60 });
  await next.join(code); await settle();
  assert.equal(host.players.size, 2);
});
test("연결이 조용히 끊기면(ping 없음) 방장이 상대가 나간 것으로 처리", async () => {
  const { host, guest } = await connected({ pingMs: 10, staleMs: 60 });
  const left = collect(host, "peer-left");
  guest.transport.close();                  // leave 메시지 없이 연결만 끊김 (탭을 그냥 닫은 경우)
  clearInterval(guest._pingTimer);
  await tick(200);
  assert.equal(left.length, 1);
  assert.equal(left[0].reason, "timeout");
  host.leave();
});
test("방에 있는 동안 또 방을 만들거나 참가할 수 없음", async () => {
  const { host } = await connected();
  await assert.rejects(() => host.create("runner"), (e) => e.code === "busy");
  await assert.rejects(() => host.join("KABOOM-ABC234"), (e) => e.code === "busy");
});

// ---------- 실행 ----------
let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("  ok  ", name); }
  catch (e) { failed++; console.log("  FAIL", name, "\n      ", e.message); }
}
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
