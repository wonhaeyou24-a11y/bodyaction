// 가족 프로필 로직 테스트 (Node):  node test/profiles.test.js
import assert from "node:assert/strict";
import { ProfileStore, MAX_PROFILES } from "../profiles.js";

class FakeStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const tests = [];
const test = (n, f) => tests.push([n, f]);

test("처음 실행하면 기존 닉네임/아바타로 첫 프로필(p1)이 만들어짐", () => {
  const s = new ProfileStore(new FakeStorage(), { nickname: "하윤이", avatar: "assets/ninja.jpg", avatarId: "cat", title: "COMBO KING" });
  assert.equal(s.list.length, 1);
  assert.equal(s.activeId, "p1");
  assert.equal(s.active.nickname, "하윤이");
  assert.equal(s.active.avatarId, "cat");
});
test("저장 후 다시 열면 그대로 복원", () => {
  const st = new FakeStorage();
  const a = new ProfileStore(st, { nickname: "아빠" });
  a.add({ nickname: "엄마" }); a.setActive("p2");
  const b = new ProfileStore(st, { nickname: "무시됨" });
  assert.deepEqual(b.list.map((p) => p.nickname), ["아빠", "엄마"]);
  assert.equal(b.activeId, "p2");
});
test("프로필 추가: 번호는 비어 있는 가장 작은 번호, 최대 6명", () => {
  const s = new ProfileStore(new FakeStorage(), { nickname: "a" });
  assert.equal(s.add().id, "p2");
  assert.equal(s.add().id, "p3");
  s.remove("p2");
  assert.equal(s.add().id, "p2", "지운 번호를 다시 씀");
  while (s.list.length < MAX_PROFILES) s.add();
  assert.equal(s.add(), null, "가득 차면 추가 불가");
  assert.equal(s.list.length, MAX_PROFILES);
});
test("기록 키: p1은 예전 이름 그대로, 나머지는 접두어", () => {
  const s = new ProfileStore(new FakeStorage(), {});
  s.add();
  assert.equal(s.recKey("best-balloon", "p1"), "best-balloon");
  assert.equal(s.recKey("best-balloon", "p2"), "p2:best-balloon");
  s.setActive("p2");
  assert.equal(s.recKey("top10-runner"), "p2:top10-runner");
});
test("프로필 정보 수정 + 이름은 안전하게 정리", () => {
  const s = new ProfileStore(new FakeStorage(), { nickname: "a" });
  s.update("p1", { nickname: "<b>철수</b>&\"'", avatar: "http://evil/x.jpg" });
  assert.equal(/[<>&"']/.test(s.active.nickname), false);
  assert.equal(s.active.avatar, "assets/avatar.jpg", "외부 이미지는 기본 이미지로");
  assert.equal(s.update("p9", { nickname: "x" }), false);
  s.update("p1", { nickname: "" });
  assert.equal(s.active.nickname, "플레이어", "빈 이름은 기본 이름");
});
test("삭제하면 그 사람의 기록만 지워지고, 활성 프로필이면 다른 사람으로 넘어감", () => {
  const st = new FakeStorage();
  const s = new ProfileStore(st, {});
  s.add(); s.add();                       // p2, p3
  st.setItem("best-balloon", "100"); st.setItem("__enc_top10-balloon", "x");     // p1 기록
  st.setItem("p2:best-balloon", "50"); st.setItem("__enc_p2:top10-ninja", "y");  // p2 기록
  st.setItem("p3:best-balloon", "70");                                           // p3 기록
  s.setActive("p2");
  assert.equal(s.remove("p2"), "p1");
  assert.equal(st.getItem("p2:best-balloon"), null);
  assert.equal(st.getItem("__enc_p2:top10-ninja"), null);
  assert.equal(st.getItem("p3:best-balloon"), "70", "다른 사람 기록은 그대로");
  assert.equal(st.getItem("best-balloon"), "100", "p1 기록도 그대로");
  assert.equal(s.activeId, "p1");
});
test("p1을 지우면 예전 형식의 기록도 지워지고, 마지막 한 명은 지울 수 없음", () => {
  const st = new FakeStorage();
  const s = new ProfileStore(st, {});
  assert.equal(s.remove("p1"), null, "한 명뿐이면 삭제 불가");
  s.add();
  st.setItem("best-balloon", "100"); st.setItem("__enc_best-ninja", "z"); st.setItem("p2:best-balloon", "5"); st.setItem("other-key", "keep");
  assert.equal(s.remove("p1"), "p2");
  assert.equal(st.getItem("best-balloon"), null);
  assert.equal(st.getItem("__enc_best-ninja"), null);
  assert.equal(st.getItem("p2:best-balloon"), "5");
  assert.equal(st.getItem("other-key"), "keep");
});
test("망가진/조작된 저장 데이터는 안전하게 복구", () => {
  const st = new FakeStorage();
  st.setItem("kinetickaboom_profiles_v1", "{not json");
  assert.equal(new ProfileStore(st, { nickname: "복구" }).active.nickname, "복구");
  st.setItem("kinetickaboom_profiles_v1", JSON.stringify({ active: "p7", list: [{ id: "../hack", nickname: "x" }, { id: "p2", nickname: "<i>민수</i>" }, { id: "p2", nickname: "중복" }] }));
  const s = new ProfileStore(st, {});
  assert.deepEqual(s.list.map((p) => p.id), ["p2"], "잘못된 id/중복은 버림");
  assert.equal(s.activeId, "p2", "없는 활성 id는 첫 프로필로");
  assert.equal(/[<>]/.test(s.active.nickname), false);
});
test("저장소가 막혀 있어도(예외) 죽지 않음", () => {
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() {}, key() { return null; }, length: 0 };
  const s = new ProfileStore(bad, { nickname: "ok" });
  assert.equal(s.active.nickname, "ok");
  assert.ok(s.add());
});

let failed = 0;
for (const [n, f] of tests) { try { f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", e.message); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
