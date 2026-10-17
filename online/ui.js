// 온라인 대결 화면(DOM). Room(방 규칙)의 이벤트를 화면에 보여 주고, 게임과는 bus로만 이어져요.
// 게임을 직접 건드리지 않고, main.js가 넘겨 준 hooks(launch 등)만 불러요.
//
// hooks:
//   getProfile()      -> { name, avatar }              내 닉네임/아바타
//   launch(mode, o)   -> Promise<boolean>              게임 시작 (카메라 준비 포함). o = { seed, trackId, online }
//   getBeatTracks()   -> [{ id, title }]               비트 게임에서 고를 수 있는 곡
import { bus } from "./bus.js";
import { Room } from "./room.js";
import { createTransport, LocalTransport } from "./transport.js";
import { ONLINE_MODES, ROOM_CODE_RE } from "./protocol.js";
import { drawQr } from "./qr.js";
import { makeInviteCode, normalizeCode } from "./rng.js";

const $ = (id) => document.getElementById(id);
const MODE_LABEL = { runner: "🦘 점프 달리기 (몸 인식)", beat: "🎵 네온 노트 슬래시" };

export function initOnline(hooks) {
  const modal = $("onlineModal");
  if (!modal) return null;

  let room = null;
  let offs = [];
  let toastTimer = null;

  // ---------- 작은 도우미 ----------
  const show = (el, on = true) => el?.classList.toggle("hidden", !on);
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  function setError(msg = "") { setText("onlineError", msg); }
  function toast(msg) {
    const el = $("onlineToast"); if (!el) return;
    el.textContent = msg; show(el, true);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => show(el, false), 3500);
  }
  function showStep(name) { show($("onlineStepStart"), name === "start"); show($("onlineStepLobby"), name === "lobby"); }
  function openModal() {
    show(modal, true);
    showStep(room?.active ? "lobby" : "start");
    setError("");
    if (!LocalTransport.isSupported()) setError("이 브라우저는 탭 간 연결을 지원하지 않아요.");
    if (room?.active) renderLobby();
  }
  function closeModal() { show(modal, false); }

  // ---------- 방 만들기 / 참가 ----------
  function makeRoom() {
    const r = new Room({ transport: createTransport("remote"), self: hooks.getProfile(), joinTimeoutMs: 15000 });
    offs = [
      r.on("lobby", renderLobby),
      r.on("start", onStart),
      r.on("opponent-score", onOpponentScore),
      r.on("result", showResult),
      r.on("rematch", onRematch),
      r.on("peer-left", ({ name }) => { toast(`${name}님이 나갔어요`); renderLobby(); }),
      r.on("closed", ({ reason }) => onClosed(reason)),
    ];
    return r;
  }

  async function createRoom(fixedCode = null) {
    setError("");
    const mode = $("onlineMode").value;
    if (mode === "beat" && !$("onlineTrack").value) { setError("곡을 골라 주세요"); return; }
    room = makeRoom();
    if (fixedCode) setError("가족방을 여는 중이에요…");
    try {
      await room.create(mode, mode === "beat" ? ($("onlineTrack").value || null) : null, fixedCode);
      setError(""); showStep("lobby"); renderLobby();
    } catch (e) { setError(e.message); dropRoom(); }
  }

  async function joinRoom(codeArg = null) {
    setError("");
    const code = typeof codeArg === "string" ? codeArg : $("onlineCodeInput").value;
    if (!code.trim()) { setError("초대 코드를 입력해 주세요"); return; }
    room = makeRoom();
    $("onlineJoin").disabled = true;
    setError("방에 연결하는 중이에요… (멀리 있는 친구와는 몇 초 걸려요)");
    try { await room.join(code); setError(""); showStep("lobby"); renderLobby(); }
    catch (e) { setError(e.message); dropRoom(); }
    finally { $("onlineJoin").disabled = false; }
  }

  function dropRoom() { offs.forEach((f) => f()); offs = []; room = null; bus.onlineActive = false; setText("roomPinText", "—"); }

  // ---------- 초대 링크 / QR ----------
  const inviteUrl = (code) => `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
  let qrFor = null;
  function renderQr() {
    const box = $("onlineQrBox");
    if (!box) return;
    if (!(room?.isHost && room.phase === "lobby" && room.players.size < 2)) { show(box, false); return; }   // 방장이고 아직 친구를 기다리는 동안만
    if (qrFor !== room.code) {
      try { drawQr($("onlineQr"), inviteUrl(room.code), 200); qrFor = room.code; }
      catch { show(box, false); return; }                                                                      // 주소가 너무 길면 QR은 건너뛰어요(코드·링크 복사는 그대로)
    }
    show(box, true);
  }

  // ---------- 로비 ----------
  function renderLobby() {
    if (!room?.active) return;
    setText("onlineCode", room.code);
    setText("roomPinText", room.code);
    renderQr();
    const ul = $("onlinePlayers"); ul.textContent = "";
    for (const p of room.players.values()) {
      const li = document.createElement("li");
      const img = document.createElement("img"); img.src = p.avatar; img.alt = ""; img.width = 36; img.height = 36;
      const name = document.createElement("span"); name.className = "op-name";
      name.textContent = p.name + (p.id === room.id ? " (나)" : "") + (p.id === room.hostId ? " 👑" : "");
      const st = document.createElement("em");
      const ready = p.id === room.hostId || p.ready;
      st.textContent = ready ? "준비 완료" : "준비 중…"; st.className = ready ? "op-ready" : "op-wait";
      li.append(img, name, st); ul.append(li);
    }
    if (room.players.size < 2) { const li = document.createElement("li"); li.className = "op-empty"; li.textContent = "친구를 기다리는 중… 초대 코드를 알려 주세요"; ul.append(li); }

    const host = room.isHost;
    const trackTitle = (hooks.getBeatTracks?.() ?? []).find((t) => t.id === room.trackId)?.title;
    setText("onlineModeInfo", `게임: ${MODE_LABEL[room.mode] ?? room.mode}` + (room.mode === "beat" && trackTitle ? ` · 곡: ${trackTitle}` : ""));
    show($("onlineReady"), !host);
    show($("onlineStart"), host);
    const me = room.me;
    $("onlineReady").textContent = me?.ready ? "↩ 준비 취소" : "✅ 준비하기";
    $("onlineStart").disabled = !room.canStart();
    setText("onlineHint", host
      ? (room.players.size < 2 ? "친구가 들어오면 시작할 수 있어요" : room.canStart() ? "시작할 수 있어요!" : "친구가 준비하면 시작할 수 있어요")
      : (me?.ready ? "방장이 시작하길 기다리는 중…" : "준비하기를 눌러 주세요"));
  }

  function fillTracks() {
    const sel = $("onlineTrack"), isBeat = $("onlineMode").value === "beat";
    show($("onlineTrackRow"), isBeat);
    if (!isBeat || sel.options.length) return;
    for (const t of hooks.getBeatTracks?.() ?? []) { const o = document.createElement("option"); o.value = t.id; o.textContent = t.title; sel.append(o); }
  }

  // ---------- 게임 시작 / 진행 ----------
  async function onStart({ mode, seed, trackId }) {
    closeModal();
    bus.onlineActive = true;
    resetCompare();
    const opp = room.opponent;
    setText("ohName", opp?.name ?? "상대"); setText("ohScore", "0");
    show($("onlineHud"), true);
    const ok = await hooks.launch(mode, { seed, trackId, online: true });
    if (!ok) { toast("카메라를 켤 수 없어 대결을 취소했어요"); room?.leave(); }
  }

  function onOpponentScore({ name, score }) {
    setText("ohName", name); setText("ohScore", score.toLocaleString());
    if ($("ocOpp")) setText("ocOpp", score.toLocaleString());
  }

  // ---------- 결과 비교 / 재대결 ----------
  function resetCompare() {
    show($("onlineCompare"), false);
    $("result")?.classList.remove("has-online");
    const again = $("again")?.querySelector(".btn-text"); if (again) again.textContent = "다시 하기";
  }

  function showWaiting(myScore) {
    show($("onlineCompare"), true);
    $("result")?.classList.add("has-online");
    $("onlineCompare").dataset.outcome = "";
    setText("ocMeName", "나"); setText("ocMe", myScore.toLocaleString());
    setText("ocOppName", room?.opponent?.name ?? "상대"); setText("ocOpp", (room?.opponent?.score ?? 0).toLocaleString());
    setText("ocVerdict", "⏳ 상대가 끝나길 기다리는 중…");
    setText("ocRematch", "");
  }

  function showResult(r) {
    show($("onlineHud"), false);
    show($("onlineCompare"), true);
    $("result")?.classList.add("has-online");
    $("onlineCompare").dataset.outcome = r.outcome;
    setText("ocMeName", r.me.name); setText("ocMe", r.me.score.toLocaleString());
    setText("ocOppName", r.opp?.name ?? "상대"); setText("ocOpp", (r.opp?.score ?? 0).toLocaleString());
    setText("ocVerdict", r.forfeit ? "🏆 상대가 나가서 승리!" : r.outcome === "win" ? "🏆 승리!" : r.outcome === "lose" ? "😢 패배…" : "🤝 무승부!");
    setText("ocRematch", r.forfeit ? "" : "‘재대결’을 누르면 상대에게 알려요");
    const again = $("again")?.querySelector(".btn-text"); if (again) again.textContent = r.forfeit ? "다시 하기" : "재대결";
    if (r.forfeit) bus.onlineActive = false;           // 상대가 없으니 혼자 하기로 돌아감
  }

  function onRematch({ me, opp }) {
    if (me && !opp) setText("ocRematch", "재대결을 신청했어요. 상대의 대답을 기다리는 중…");
    else if (!me && opp) setText("ocRematch", "상대가 재대결을 원해요! ‘재대결’을 눌러 주세요");
  }

  function onClosed(reason) {
    const wasPlaying = bus.onlineActive;
    dropRoom(); show($("onlineHud"), false); resetCompare();
    if (reason === "host-left") toast("방장이 방을 닫았어요");
    if (!modal.classList.contains("hidden")) showStep("start");
    return wasPlaying;
  }

  // ---------- 버튼 연결 ----------
  $("btnParty")?.addEventListener("click", openModal);
  $("onlineClose")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  $("onlineCreate")?.addEventListener("click", createRoom);
  $("onlineJoin")?.addEventListener("click", joinRoom);
  $("onlineCodeInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  $("onlineMode")?.addEventListener("change", fillTracks);
  $("onlineReady")?.addEventListener("click", () => room?.setReady(!room.me?.ready));
  $("onlineStart")?.addEventListener("click", () => room?.start());
  $("onlineLeave")?.addEventListener("click", () => { room?.leave(); showStep("start"); });
  $("onlineCopy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(room.code); toast("초대 코드를 복사했어요"); }
    catch { toast("코드를 직접 알려 주세요: " + room.code); }
  });
  $("onlineCopyLink")?.addEventListener("click", async () => {
    if (!room?.code) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(room.code));
      toast("🔗 초대 링크를 복사했어요! 친구에게 보내보세요");
    } catch {
      toast("코드를 알려 주세요: " + room.code);
    }
  });

  // URL 초대 링크(?room=KABOOM-XXXXXX)로 들어온 경우 자동 참가 유도
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get("room");
    if (roomFromUrl && /^KABOOM-[A-Za-z0-9]{6}$/i.test(roomFromUrl.trim())) {
      setTimeout(() => {
        openModal();
        const codeInput = $("onlineCodeInput");
        const code = roomFromUrl.trim().toUpperCase();
        if (codeInput) codeInput.value = code;
        try { const u = new URL(location.href); u.searchParams.delete("room"); history.replaceState(null, "", u.toString()); } catch {}   // 새로고침해도 또 참가하지 않게 주소에서 지워요
        toast("초대 링크로 들어왔어요. 방에 자동으로 참가하는 중…");
        joinRoom(code);                                                                                                                   // QR·링크로 들어오면 코드를 다시 누르지 않아도 바로 참가해요
      }, 400);
    }
  } catch {}

  // ---------- 우리 가족방: 한 번 정해 두면 "열기 / 들어가기" 한 번으로 끝 ----------
  const FAMILY_KEY = "kk_family_room";
  const getFamily = () => { try { const c = normalizeCode(localStorage.getItem(FAMILY_KEY) || ""); return ROOM_CODE_RE.test(c) ? c : null; } catch { return null; } };
  function renderFamily() {
    const code = getFamily();
    show($("onlineFamilyNone"), !code); show($("onlineFamilySet"), !!code);
    if (code) setText("onlineFamilyCode", code);
  }
  $("onlineFamilySave")?.addEventListener("click", () => {
    const raw = $("onlineFamilyInput").value.trim();
    const code = raw ? normalizeCode(raw) : makeInviteCode();
    if (!ROOM_CODE_RE.test(code)) { setError("가족 코드는 영어 대문자와 숫자 6글자예요 (0, 1, I, L, O는 헷갈려서 빼요)"); return; }
    try { localStorage.setItem(FAMILY_KEY, code); } catch {}
    setError(""); $("onlineFamilyInput").value = ""; renderFamily(); toast("가족방 코드를 저장했어요: " + code);
  });
  $("onlineFamilyChange")?.addEventListener("click", () => { try { localStorage.removeItem(FAMILY_KEY); } catch {} renderFamily(); });
  $("onlineFamilyOpen")?.addEventListener("click", () => { const c = getFamily(); if (c) createRoom(c); });
  $("onlineFamilyJoin")?.addEventListener("click", () => { const c = getFamily(); if (c) joinRoom(c); });
  renderFamily();

  // 모드 선택 목록 채우기
  const modeSel = $("onlineMode");
  if (modeSel && !modeSel.options.length) {
    for (const m of ONLINE_MODES) { const o = document.createElement("option"); o.value = m; o.textContent = MODE_LABEL[m]; modeSel.append(o); }
  }
  fillTracks();

  // ---------- 게임이 알려 주는 사건 듣기 ----------
  bus.on("game:score", ({ score, combo }) => { if (room?.phase === "playing") room.reportScore(score, combo); });
  bus.on("game:end", ({ score, maxCombo }) => {
    if (room?.phase !== "playing") return;
    room.finish(score, maxCombo);
    if (room.phase === "playing") showWaiting(score);     // 상대가 아직이면 기다림 표시 (둘 다 끝났으면 result 이벤트가 이미 처리)
  });
  bus.on("game:quit", () => { if (room?.active) room.leave(); });
  bus.on("online:rematch", () => {
    if (!room?.active) return;
    room.requestRematch();
  });

  return { open: openModal, get room() { return room; } };
}
