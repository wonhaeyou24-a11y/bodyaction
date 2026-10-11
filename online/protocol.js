// 두 기기가 주고받는 메시지의 "약속"과 검사기.
// 네트워크로 들어온 데이터는 믿지 않고(Zero-Trust) 항상 sanitize()를 거쳐서 안전한 값만 써요.

export const PROTOCOL_VERSION = 1;

export const MSG = Object.freeze({
  JOIN: "join",           // 손님 -> 방장: 참가해도 될까요?
  JOIN_OK: "join_ok",     // 방장 -> 손님: 들어오세요 (방 상태 포함)
  JOIN_FULL: "join_full", // 방장 -> 손님: 방이 가득 찼거나 이미 게임 중이에요
  LOBBY: "lobby",         // 방장 -> 모두: 방 상태(누가 있고 누가 준비했는지) 알림
  READY: "ready",         // 손님 -> 방장: 준비/준비 취소
  START: "start",         // 방장 -> 모두: 게임 시작! (시드·게임·곡 포함)
  SCORE: "score",         // 모두: 지금 내 점수
  FINISH: "finish",       // 모두: 내 게임이 끝났어요 (최종 점수)
  REMATCH: "rematch",     // 모두: 한 번 더 하고 싶어요
  PING: "ping",           // 모두: 아직 연결돼 있어요
  LEAVE: "leave",         // 모두: 방을 나가요
});
const TYPES = new Set(Object.values(MSG));

/** 온라인 대결이 가능한 게임 (같은 시드로 같은 판이 나오도록 만든 게임만) */
export const ONLINE_MODES = Object.freeze(["runner", "beat"]);
export const PHASES = Object.freeze(["lobby", "playing", "finished"]);
export const ROOM_CODE_RE = /^KABOOM-[A-HJ-NP-Z2-9]{6}$/;

const CTRL_AND_HTML = /[\u0000-\u001f\u007f<>&"'`]/g;

export function cleanName(v, fallback = "플레이어") {
  const s = typeof v === "string" ? v.replace(CTRL_AND_HTML, "").trim().slice(0, 14) : "";
  return s || fallback;
}

/** 아바타는 우리 앱 안의 이미지 경로만 허용 (외부 주소·data URL 차단) */
export function cleanAvatar(v) {
  return typeof v === "string" && /^assets\/[\w.\-]{1,40}\.(jpg|jpeg|png|webp)$/.test(v) ? v : "assets/avatar.jpg";
}

function int(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
const idOf = (v) => (typeof v === "string" && /^[\w\-]{1,40}$/.test(v) ? v : null);
const trackOf = (v) => (typeof v === "string" && /^[\w\-]{1,32}$/.test(v) ? v : null);

/**
 * 받은 메시지를 검사해서 안전한 새 객체로 돌려줘요. 이상하면 null (조용히 무시).
 */
export function sanitize(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!TYPES.has(raw.type)) return null;
  const from = idOf(raw.from);
  if (!from) return null;
  const out = { v: PROTOCOL_VERSION, type: raw.type, from, to: raw.to == null ? null : idOf(raw.to) };

  switch (raw.type) {
    case MSG.JOIN:
      if (!ROOM_CODE_RE.test(String(raw.code))) return null;
      out.code = String(raw.code);
      out.name = cleanName(raw.name);
      out.avatar = cleanAvatar(raw.avatar);
      break;
    case MSG.JOIN_OK:
    case MSG.LOBBY: {
      const mode = ONLINE_MODES.includes(raw.mode) ? raw.mode : null;
      if (!mode || !PHASES.includes(raw.phase) || !Array.isArray(raw.players)) return null;
      out.mode = mode;
      out.phase = raw.phase;
      out.trackId = trackOf(raw.trackId);
      out.players = raw.players.slice(0, 2).map((p) => ({
        id: idOf(p?.id), name: cleanName(p?.name), avatar: cleanAvatar(p?.avatar), ready: !!p?.ready,
      })).filter((p) => p.id);
      if (out.players.length === 0) return null;
      break;
    }
    case MSG.READY:
      out.ready = !!raw.ready;
      break;
    case MSG.START: {
      const mode = ONLINE_MODES.includes(raw.mode) ? raw.mode : null;
      const seed = int(raw.seed, 0, 4294967295);
      if (!mode || seed === null) return null;
      out.mode = mode; out.seed = seed; out.trackId = trackOf(raw.trackId);
      break;
    }
    case MSG.SCORE:
    case MSG.FINISH: {
      const score = int(raw.score, 0, 10_000_000), combo = int(raw.combo, 0, 100_000);
      if (score === null) return null;
      out.score = score; out.combo = combo ?? 0;
      break;
    }
    default: break;          // REMATCH / PING / LEAVE / JOIN_FULL 은 추가 데이터 없음
  }
  return out;
}
