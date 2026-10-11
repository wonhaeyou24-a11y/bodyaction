// 가족 프로필: 사람마다 닉네임/아바타와 "최고 기록·순위표"를 따로 저장해요.
// 화면(DOM)을 모르는 순수 로직이라 Node로 단독 테스트할 수 있어요 (node test/profiles.test.js).
//
// 기록 저장 이름(키) 규칙:  첫 번째 프로필(p1)은 예전 기록을 그대로 이어받도록 "best-balloon" 처럼 접두어 없이,
//                           나머지 프로필은 "p2:best-balloon" 처럼 접두어를 붙여요.

const KEY = "kinetickaboom_profiles_v1";
export const MAX_PROFILES = 6;
const ID_RE = /^p[1-9]$/;
const AVATARS = [
  ["assets/avatar.jpg", "leo"], ["assets/runner.jpg", "bunny"], ["assets/ninja.jpg", "cat"],
  ["assets/kungfu.jpg", "boxer"], ["assets/space.jpg", "pilot"], ["assets/balloon.jpg", "penny"],
];
const TITLES = ["PARTY LEADER", "SPEED RUNNER", "NEON SLASHER", "KINETIC MASTER", "COMBO KING"];

export const cleanNick = (v, fallback = "플레이어") => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f<>&"'`]/g, "").trim().slice(0, 14) : "";
  return s || fallback;
};
const cleanAvatar = (v) => (typeof v === "string" && /^assets\/[\w.\-]{1,40}\.(jpg|jpeg|png|webp)$/.test(v) ? v : AVATARS[0][0]);
const cleanTitle = (v) => (typeof v === "string" && v.trim() ? v.replace(/[\u0000-\u001f<>&"'`]/g, "").trim().slice(0, 30) : TITLES[0]);

function cleanProfile(p, id) {
  const avatar = cleanAvatar(p?.avatar);
  return {
    id,
    nickname: cleanNick(p?.nickname),
    title: cleanTitle(p?.title),
    avatar,
    avatarId: typeof p?.avatarId === "string" && /^[\w\-]{1,20}$/.test(p.avatarId) ? p.avatarId : (AVATARS.find((a) => a[0] === avatar)?.[1] ?? "leo"),
  };
}

export class ProfileStore {
  /**
   * @param storage  getItem/setItem/removeItem/key/length 를 가진 저장소 (localStorage 또는 테스트용 가짜)
   * @param seed     처음 실행할 때 첫 프로필(p1)로 쓸 값 { nickname, title, avatar, avatarId }
   */
  constructor(storage, seed = {}) {
    this.storage = storage;
    this.data = this._load() ?? { active: "p1", list: [cleanProfile(seed, "p1")] };
    this._save();
  }

  _load() {
    try {
      const raw = JSON.parse(this.storage.getItem(KEY) ?? "null");
      if (!raw || !Array.isArray(raw.list)) return null;
      const seen = new Set(), list = [];
      for (const p of raw.list.slice(0, MAX_PROFILES)) {
        if (!p || !ID_RE.test(p.id) || seen.has(p.id)) continue;
        seen.add(p.id); list.push(cleanProfile(p, p.id));
      }
      if (!list.length) return null;
      return { active: list.some((p) => p.id === raw.active) ? raw.active : list[0].id, list };
    } catch { return null; }
  }
  _save() { try { this.storage.setItem(KEY, JSON.stringify(this.data)); } catch { /* 저장 실패해도 계속 동작 */ } }

  get list() { return this.data.list.map((p) => ({ ...p })); }
  get activeId() { return this.data.active; }
  get active() { return { ...this.data.list.find((p) => p.id === this.data.active) }; }
  get(id) { const p = this.data.list.find((x) => x.id === id); return p ? { ...p } : null; }

  setActive(id) {
    if (!this.data.list.some((p) => p.id === id)) return false;
    this.data.active = id; this._save(); return true;
  }

  /** 새 프로필 추가 (빈 번호 중 가장 작은 것). 가득 찼으면 null */
  add(fields = {}) {
    if (this.data.list.length >= MAX_PROFILES) return null;
    const used = new Set(this.data.list.map((p) => p.id));
    let n = 1; while (used.has("p" + n)) n++;
    const id = "p" + n, [avatar, avatarId] = AVATARS[(n - 1) % AVATARS.length];
    const p = cleanProfile({ nickname: `플레이어${n}`, title: TITLES[(n - 1) % TITLES.length], avatar, avatarId, ...fields }, id);
    this.data.list.push(p); this._save();
    return { ...p };
  }

  update(id, fields) {
    const i = this.data.list.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.data.list[i] = cleanProfile({ ...this.data.list[i], ...fields }, id);
    this._save(); return true;
  }

  /** 프로필 삭제 + 그 사람의 기록 삭제. 마지막 한 명은 지울 수 없어요. 지운 뒤 활성 프로필 id를 돌려줘요. */
  remove(id) {
    if (this.data.list.length <= 1 || !this.data.list.some((p) => p.id === id)) return null;
    this.data.list = this.data.list.filter((p) => p.id !== id);
    if (this.data.active === id) this.data.active = this.data.list[0].id;
    this._save();
    this.purgeRecords(id);
    return this.data.active;
  }

  /** 기록 키: p1은 예전 기록과 같은 이름, 나머지는 "p2:" 접두어 */
  recKey(base, id = this.data.active) { return id === "p1" ? base : `${id}:${base}`; }

  /** 이 프로필의 기록(최고 기록·순위표) 전부 지우기 */
  purgeRecords(id) {
    const isMine = id === "p1"
      ? (k) => /^(__enc_)?(best|top10)-/.test(k)
      : (k) => k.startsWith(`${id}:`) || k.startsWith(`__enc_${id}:`);
    const keys = [];
    for (let i = 0; i < this.storage.length; i++) { const k = this.storage.key(i); if (k && isMine(k)) keys.push(k); }
    for (const k of keys) { try { this.storage.removeItem(k); } catch { /* 무시 */ } }
  }
}
