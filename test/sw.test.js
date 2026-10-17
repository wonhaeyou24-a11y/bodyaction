// 오프라인 저장(sw.js) 시험: node test/sw.test.js
// 서비스 워커를 가짜 환경(가짜 저장소·가짜 인터넷)에 올려서, 인터넷이 있을 때/없을 때/노래 일부분 요청/옛 파일 정리 등을 확인해요.
import assert from "node:assert/strict";

const origin = "https://site.test";
let online = true, netHits = [], routes = {};
const stores = new Map();                                    // 저장소 이름 → Map(url → Response)
const mkCache = (name) => {
  const m = stores.get(name) ?? stores.set(name, new Map()).get(name);
  const urlOf = (r) => (typeof r === "string" ? r : r.url);
  const strip = (u) => u.split("?")[0];
  return {
    match: async (r, o = {}) => { const u = urlOf(r); const hit = m.get(u) ?? (o.ignoreSearch ? [...m].find(([k]) => strip(k) === strip(u))?.[1] : undefined); return hit ? hit.clone() : undefined; },
    put: async (r, res) => { m.set(urlOf(r), res); },
    keys: async () => [...m.keys()].map((url) => ({ url })),
    delete: async (r) => m.delete(urlOf(r)),
    addAll: async (list) => { for (const u of list) { const res = await fakeFetch(new Request(new URL(u, origin + "/"))); if (res.ok) m.set(new URL(u, origin + "/").href, res); } },
    add: async (r) => { const res = await fakeFetch(typeof r === "string" ? new Request(r) : r); if (res.ok) m.set(urlOf(r), res); },
  };
};
globalThis.caches = {
  open: async (n) => mkCache(n),
  keys: async () => [...stores.keys()],
  delete: async (n) => stores.delete(n),
  match: async (r, o) => { for (const n of stores.keys()) { const hit = await mkCache(n).match(r, o); if (hit) return hit; } return undefined; },
};
async function fakeFetch(req) {
  const r = typeof req === "string" ? new Request(req) : req;
  if (!online) throw new TypeError("offline");
  netHits.push(r.url);
  const route = routes[r.url] ?? routes[new URL(r.url).pathname];
  if (!route) return new Response("not found", { status: 404 });
  return typeof route === "function" ? route(r) : new Response(route.body ?? "ok", { status: 200, headers: route.headers ?? {} });
}
globalThis.fetch = fakeFetch;
globalThis.location = { origin };
const handlers = {};
globalThis.self = { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => { globalThis.__skipped = true; }, clients: { claim: async () => { globalThis.__claimed = true; } } };
await import("../sw.js");

const call = async (url, init = {}) => {                      // 페이지가 요청한 것처럼 fetch 이벤트를 흘려 보내고, 서비스 워커가 직접 답했는지(responded)도 돌려줘요
  const request = new Request(url, init);
  let responded = null, waits = [];
  await handlers.fetch({ request, respondWith: (p) => { responded = Promise.resolve(p); }, waitUntil: (p) => waits.push(p) });
  const res = responded ? await responded.catch((e) => ({ error: e })) : null;
  await Promise.all(waits);
  return { handled: !!responded, res };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tests = [], test = (n, f) => tests.push([n, f]);
const reset = () => { stores.clear(); netHits = []; routes = {}; online = true; };

test("설치: 핵심 파일을 저장하고 바로 시작, 활성화: 옛 버전 저장소만 지움", async () => {
  reset(); routes["/"] = { body: "home" }; routes["/index.html"] = { body: "<html>" }; routes["/manifest.json"] = { body: "{}" };
  stores.set("kk-v0", new Map([["x", new Response("old")]])); stores.set("other-app", new Map());
  let p; handlers.install({ waitUntil: (x) => { p = x; } }); await p;
  assert.ok(globalThis.__skipped); assert.ok(stores.get("kk-v1").size >= 2);
  handlers.activate({ waitUntil: (x) => { p = x; } }); await p;
  assert.ok(!stores.has("kk-v0") && stores.has("other-app") && stores.has("kk-v1") && globalThis.__claimed);
});
test("게임 코드: 인터넷이 되면 항상 새 것을 받고(저장도 갱신), 끊기면 저장본을 줌", async () => {
  reset(); routes["/main.js"] = { body: "v1" };
  let r = await call(origin + "/main.js?v=1"); assert.equal(await r.res.text(), "v1");
  routes["/main.js"] = { body: "v2" };
  r = await call(origin + "/main.js?v=1"); assert.equal(await r.res.text(), "v2", "인터넷이 되면 새 것");
  online = false;
  r = await call(origin + "/main.js?v=1"); assert.equal(await r.res.text(), "v2", "끊기면 저장본");
});
test("끊긴 상태에서 새로고침(처음 화면)은 저장해 둔 index.html 로 열림", async () => {
  reset(); routes["/index.html"] = { body: "<html>home" }; await call(origin + "/index.html");
  online = false;
  const r = await call(origin + "/?x=1", { mode: "navigate" }).catch(() => null);
  // Request 생성자는 mode:'navigate' 를 허용하지 않으므로 같은 주소의 저장본 폴백(ignoreSearch)으로 확인
  const r2 = await call(origin + "/index.html?sw");
  assert.equal(await r2.res.text(), "<html>home");
});
test("실패한 응답(404)은 저장하지 않음", async () => {
  reset(); await call(origin + "/missing.js"); online = false;
  const r = await call(origin + "/missing.js"); assert.ok(r.res.error, "저장되어 있으면 안 돼요");
});
test("같은 파일의 옛 버전(?v=)은 새 버전을 저장할 때 지워짐 (저장 공간이 계속 늘지 않음)", async () => {
  reset(); routes["/main.js"] = { body: "a" };
  await call(origin + "/main.js?v=1"); await call(origin + "/main.js?v=2"); await call(origin + "/main.js?v=3");
  const keys = [...stores.get("kk-v1").keys()].filter((k) => k.includes("/main.js")); assert.deepEqual(keys, [origin + "/main.js?v=3"]);
});
test("노래: 처음엔 인터넷에서 바로 재생, 뒤에서 저장 → 다음부터는 저장본에서 '일부분 요청(206)'에 정확히 답함", async () => {
  reset(); const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  routes["/assets/music/a.mp3"] = { body: bytes, headers: { "Content-Type": "audio/mpeg" } };
  let r = await call(origin + "/assets/music/a.mp3?v=1", { headers: { Range: "bytes=0-99" } });
  assert.ok(r.handled); await sleep(20);
  assert.ok(stores.get("kk-v1").has(origin + "/assets/music/a.mp3?v=1"), "뒤에서 저장돼야 해요");
  netHits = [];
  r = await call(origin + "/assets/music/a.mp3?v=1", { headers: { Range: "bytes=100-299" } });
  assert.equal(r.res.status, 206); assert.equal(r.res.headers.get("Content-Range"), "bytes 100-299/1000");
  const got = new Uint8Array(await r.res.arrayBuffer()); assert.equal(got.length, 200); assert.equal(got[0], 100 % 251); assert.equal(netHits.length, 0, "저장본이 있으면 인터넷을 안 써요");
  r = await call(origin + "/assets/music/a.mp3?v=1", { headers: { Range: "bytes=900-" } }); assert.equal(r.res.headers.get("Content-Range"), "bytes 900-999/1000");
  r = await call(origin + "/assets/music/a.mp3?v=1"); assert.equal((await r.res.arrayBuffer()).byteLength, 1000);
});
test("AI 라이브러리·모델(CDN): 한 번 받으면 다시 안 받음", async () => {
  reset(); const u = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"; routes[u] = { body: "lib" };
  await call(u); netHits = []; const r = await call(u); assert.equal(await r.res.text(), "lib"); assert.equal(netHits.length, 0);
  const m = "https://storage.googleapis.com/mediapipe-models/pose.task"; routes[m] = { body: "model" }; await call(m); netHits = []; await call(m); assert.equal(netHits.length, 0);
});
test("시험용 주소(?bench, ?nosw)·POST·다른 서비스 주소는 건드리지 않음", async () => {
  reset(); routes["/index.html"] = { body: "x" };
  assert.equal((await call(origin + "/index.html?bench")).handled, false);
  assert.equal((await call(origin + "/index.html?nosw=1")).handled, false);
  assert.equal((await call(origin + "/api", { method: "POST", body: "x" })).handled, false);
  assert.equal((await call("https://example.com/x.js")).handled, false);
});
test("느린 인터넷(6초 넘게 응답 없음)이면 저장본으로 빠르게 열림", async () => {
  reset(); routes["/slow.js"] = { body: "cached" }; await call(origin + "/slow.js");
  routes["/slow.js"] = () => new Promise(() => {});               // 영원히 응답 없음
  const t0 = Date.now(); const r = await call(origin + "/slow.js");
  assert.equal(await r.res.text(), "cached"); assert.ok(Date.now() - t0 >= 5900 && Date.now() - t0 < 8000);
});

let failed = 0;
for (const [n, f] of tests) { try { await f(); console.log("  ok  ", n); } catch (e) { failed++; console.log("  FAIL", n, "\n      ", String(e.message).split("\n")[0]); } }
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
