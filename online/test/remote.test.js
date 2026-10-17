// 원격 연결(RemoteTransport)의 "연결이 열리기 전 메시지 보관"과 "같은 메시지 두 번 처리 방지" 시험: node online/test/remote.test.js
// (진짜 인터넷 연결은 브라우저에서만 되므로, 가짜 연결 객체로 규칙만 확인해요)
import assert from "node:assert/strict";
import { RemoteTransport } from "../remote-transport.js";

const tests = [], test = (n, f) => tests.push([n, f]);
const fakeConn = () => { const h = {}; return { open: false, sent: [], on: (e, f) => { h[e] = f; }, send(x) { this.sent.push(x); }, close() {}, fire: (e, d) => h[e]?.(d) }; };

test("같은 보낸 사람·같은 번호의 메시지는 한 번만 전달됨 (탭 연결과 인터넷 연결로 두 번 도착해도)", async () => {
  const t = new RemoteTransport(), got = []; t.onMessage((m) => got.push(m));
  await t._handleIncomingRaw({ type: "ping", _senderId: "a", _n: 1 });
  await t._handleIncomingRaw({ type: "ping", _senderId: "a", _n: 1 });
  await t._handleIncomingRaw({ type: "ping", _senderId: "b", _n: 1 });
  await t._handleIncomingRaw({ type: "ping", _senderId: "a", _n: 2 });
  assert.equal(got.length, 3);
});
test("손님: 방장과 연결되기 전에 보낸 메시지(참가 요청)를 모아 뒀다가, 연결이 열리면 순서대로 보냄", async () => {
  const t = new RemoteTransport(); t.isHost = false; t.peer = {};
  await t.send({ type: "join", n: 1 }); await t.send({ type: "ready" });
  assert.equal(t.outbox.length, 2);
  const c = fakeConn(); t._setupConnection(c); c.open = true; c.fire("open");
  assert.equal(c.sent.length, 2); assert.equal(c.sent[0]._n < c.sent[1]._n, true); assert.equal(t.outbox.length, 0);
  await t.send({ type: "score" }); assert.equal(c.sent.length, 3, "연결된 뒤에는 바로 보내요");
});
test("방장은 보관하지 않음 / 보관은 최대 40개", async () => {
  const h = new RemoteTransport(); h.isHost = true; h.peer = {}; await h.send({ type: "lobby" }); assert.equal(h.outbox.length, 0);
  const g = new RemoteTransport(); g.isHost = false; g.peer = {}; for (let i = 0; i < 60; i++) await g.send({ type: "ping", i });
  assert.equal(g.outbox.length, 40); assert.equal(g.outbox[0].i, 20);
});
test("내가 보낸 메시지가 되돌아와도 무시", async () => {
  const t = new RemoteTransport(), got = []; t.onMessage((m) => got.push(m));
  await t._handleIncomingRaw({ type: "x", _senderId: t.senderId, _n: 1 }); assert.equal(got.length, 0);
});

let failed = 0;
for (const [n, f] of tests) { try { await f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", String(e.message).split("\n")[0]); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
