// 오프라인 저장(서비스 워커): 한 번 받은 파일을 이 기기에 저장해 두어서, 두 번째부터 빨리 열리고 인터넷이 불안정해도 게임이 열려요.
//  - 게임 코드(HTML/JS/CSS/JSON): 인터넷이 되면 항상 새 것을 받고(그래서 고친 게임이 바로 반영돼요), 안 될 때만 저장해 둔 것을 써요.
//  - 노래·음성·그림: 한 번 받으면 저장해 두고 다음부터는 저장된 것을 써요 (노래는 곡 바꿈/되감기에 필요한 "일부분 요청"도 처리해요).
//  - AI 인식 파일(MediaPipe 라이브러리·모델): 한 번 받으면 저장해 두어요. 처음 한 번만 인터넷이 필요해요.
// 저장 데이터는 이 기기 안에만 있어요. 문제가 생기면 아래 VERSION 숫자를 올리면 옛 저장분이 모두 지워져요.
const VERSION = "kk-v1";
const CORE = ["./", "./index.html", "./manifest.json"];
const inflight = new Set();

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("kk-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/** 저장: 성공한 응답만. 같은 파일의 옛 버전(?v=다른 값)은 지워서 저장 공간이 계속 늘지 않게 해요 */
async function put(req, res) {
  if (!res || !(res.ok || (res.type === "opaque" && /cdn\.jsdelivr\.net\/npm\/@mediapipe\//.test(req.url)))) return;
  const c = await caches.open(VERSION);
  const u = new URL(req.url);
  if (u.origin === location.origin && u.search) {
    for (const k of await c.keys()) { const ku = new URL(k.url); if (ku.origin === u.origin && ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k); }
  }
  await c.put(req, res);
}

async function networkFirst(req) {
  try {
    // 주소에 버전(?v=)이 없는 파일은 서버에 "바뀌었나요?"를 꼭 물어봐요 (서버가 10분 동안 옛 파일을 내주는 걸 피해서, 고친 게 바로 반영돼요)
    const fresh = new URL(req.url).searchParams.has("v") ? undefined : { cache: "no-cache" };
    const res = await Promise.race([fetch(req, fresh), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000))]);
    put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    if (req.mode === "navigate") { const home = await caches.match("./index.html"); if (home) return home; }
    throw err;
  }
}

/** 버전이 주소에 박혀 있어 바뀌지 않는 큰 파일(AI 라이브러리·모델)은 저장본이 있으면 다시 받지 않아요 */
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req) {
  const hit = await caches.match(req);
  const net = fetch(req).then((res) => { put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

/** 노래·음성은 "일부분 요청(Range)"으로 오기 때문에 저장된 파일에서 요청한 부분만 잘라서 206으로 답해요 */
async function rangeFrom(req, res) {
  const h = req.headers.get("range");
  const m = h && /bytes=(\d+)-(\d*)/.exec(h);
  if (!m) return res;
  const buf = await res.arrayBuffer(), s = +m[1], e = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(s, e + 1), { status: 206, statusText: "Partial Content", headers: { "Content-Type": res.headers.get("Content-Type") || "audio/mpeg", "Content-Range": `bytes ${s}-${e}/${buf.byteLength}`, "Content-Length": String(e - s + 1), "Accept-Ranges": "bytes" } });
}
async function audio(req, event) {
  const key = req.url;
  const c = await caches.open(VERSION);
  const hit = await c.match(key);
  if (hit) return rangeFrom(req, hit);
  if (!inflight.has(key)) {                               // 처음 듣는 곡: 재생은 인터넷에서 바로, 저장은 뒤에서 따로 받아 둬요
    inflight.add(key);
    event.waitUntil(fetch(key).then((r) => (r.ok ? c.put(key, r) : null)).catch(() => {}).finally(() => inflight.delete(key)));
  }
  return fetch(req);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !/^https?:/.test(req.url)) return;
  const u = new URL(req.url);
  if (u.searchParams.has("bench") || u.searchParams.has("nosw")) return;             // 시험용 주소는 건드리지 않아요
  if (u.origin === location.origin) {
    if (/\.(mp3|ogg|wav|m4a)$/i.test(u.pathname)) return void event.respondWith(audio(req, event));
    if (/\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i.test(u.pathname)) return void event.respondWith(staleWhileRevalidate(req));
    return void event.respondWith(networkFirst(req));
  }
  if (/(cdn\.jsdelivr\.net|storage\.googleapis\.com)$/.test(u.hostname)) return void event.respondWith(cacheFirst(req));
  if (/(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)) return void event.respondWith(staleWhileRevalidate(req));
});
