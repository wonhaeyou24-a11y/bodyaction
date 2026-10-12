// 인형(퍼핏) 캐릭터: 시안 이미지를 부품(머리·몸통·팔·다리)으로 잘라 두고(tools/rig_character.py), 내 관절 각도대로 돌려서 그려요.
// "내 몸의 각도 + 캐릭터 자기 팔다리 길이"로 그려서, 어떤 체형이어도 캐릭터 모습이 안 찌그러져요. 판정은 항상 내 몸 인식 좌표예요.
// 부품 파일: assets/characters/<id>.png (부품 모음) + <id>.json (관절·부품 위치).  좌/우는 화면 기준(왼쪽 = L).
const cache = new Map();      // id -> { state: "loading"|"ready"|"failed", img, meta }

export function preloadPuppet(id) {
  let e = cache.get(id);
  if (e) return e.promise;
  e = { state: "loading", img: null, meta: null };
  e.promise = (async () => {
    try {
      const meta = await (await fetch(`assets/characters/${id}.json`)).json();
      const img = new Image(); img.decoding = "async"; img.src = `assets/characters/${id}.png`;
      await img.decode();
      e.img = img; e.meta = prepare(meta); e.state = "ready";
    } catch (err) { e.state = "failed"; console.warn("캐릭터 부품을 불러오지 못했어요:", id, err); }
    return e.state === "ready";
  })();
  cache.set(id, e);
  return e.promise;
}
export const puppetState = (id) => cache.get(id)?.state ?? "none";

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** json의 관절로 쉬는 자세의 각도·길이를 미리 계산 */
function prepare(meta) {
  const j = meta.joints, shMid = mid(j.sh_l, j.sh_r), hipMid = mid(j.hip_l, j.hip_r);
  meta.shMid = shMid; meta.hipMid = hipMid; meta.torsoLen = len(hipMid, shMid); meta.spineRest = ang(hipMid, shMid);
  for (const s of ["l", "r"]) {
    meta["ua_" + s] = { len: len(j["sh_" + s], j["el_" + s]), rest: ang(j["sh_" + s], j["el_" + s]) };
    meta["fa_" + s] = { len: len(j["el_" + s], j["wr_" + s]), rest: ang(j["el_" + s], j["wr_" + s]) };
    meta["th_" + s] = { len: len(j["hip_" + s], j["kn_" + s]), rest: ang(j["hip_" + s], j["kn_" + s]) };
    meta["sn_" + s] = { len: len(j["kn_" + s], j["an_" + s]), rest: ang(j["kn_" + s], j["an_" + s]) };
  }
  return meta;
}

/**
 * 그리기. sk = character.js 뼈대(화면 px). 아직 부품을 못 불러왔으면 false (그때는 아무것도 안 그림)
 * o: { t: 시간(초), mood }
 */
export function drawPuppet(ctx, id, sk, o = {}) {
  const e = cache.get(id);
  if (!e || e.state !== "ready" || !sk || !(sk.u > 8)) return false;
  const { img, meta: m } = e, J = m.joints, t = o.t ?? 0;
  const s = sk.u / m.torsoLen;                                   // 캐릭터 크기 = 내 몸통 길이에 맞춤
  const shUser = mid(sk.ls, sk.rs), spineUser = ang(sk.hipMid, shUser);
  const rot = spineUser - m.spineRest;                            // 몸통 기울기
  const T = (p) => {                                             // 캐릭터 좌표 → 화면 (엉덩이 중심 기준 회전)
    const x = (p[0] - m.hipMid[0]) * s, y = (p[1] - m.hipMid[1]) * s, c = Math.cos(rot), sn = Math.sin(rot);
    return [sk.hipMid[0] + x * c - y * sn, sk.hipMid[1] + x * sn + y * c];
  };
  const part = (name, pivot, pos, r) => {
    const p = m.parts[name]; if (!p) return;
    ctx.save(); ctx.translate(pos[0], pos[1]); ctx.rotate(r); ctx.scale(s, s); ctx.translate(-pivot[0], -pivot[1]);
    ctx.drawImage(img, p.x, p.y, p.w, p.h, p.ox, p.oy, p.w, p.h);
    ctx.restore();
  };
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";

  // 팔다리 끝 위치(그림자용)도 같이 계산
  const legs = [["l", sk.lh, sk.lk, sk.la], ["r", sk.rh, sk.rk, sk.ra]];
  const feet = [];
  const legDraw = [];
  for (const [side, h, k, a] of legs) {
    const hipPos = T(J["hip_" + side]), th = m["th_" + side], sn = m["sn_" + side];
    const aT = ang(h, k), aS = ang(k, a);
    const knee = [hipPos[0] + Math.cos(aT) * th.len * s, hipPos[1] + Math.sin(aT) * th.len * s];
    const ankle = [knee[0] + Math.cos(aS) * sn.len * s, knee[1] + Math.sin(aS) * sn.len * s];
    legDraw.push([side, hipPos, aT - th.rest, knee, aS - sn.rest, J["hip_" + side], J["kn_" + side]]);
    feet.push(ankle);
  }
  if (o.shadow !== false) {                                       // 바닥 그림자
    const fy = Math.max(feet[0][1], feet[1][1]) + sk.u * 0.2, fx = (feet[0][0] + feet[1][0]) / 2;
    ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.beginPath(); ctx.ellipse(fx, fy, sk.u * 0.95, sk.u * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  }
  for (const [side, hipPos, rT, knee, rS, hipJ, knJ] of legDraw) { part("shin_" + side, knJ, knee, rS); part("thigh_" + side, hipJ, hipPos, rT); }

  part("torso", m.hipMid, sk.hipMid, rot);                       // 몸통

  for (const [side, sh, el, wr] of [["l", sk.ls, sk.le, sk.lw], ["r", sk.rs, sk.re, sk.rw]]) {   // 팔 (몸통 앞)
    const shPos = T(J["sh_" + side]), ua = m["ua_" + side], fa = m["fa_" + side];
    const aU = ang(sh, el), aF = ang(el, wr);
    const elbow = [shPos[0] + Math.cos(aU) * ua.len * s, shPos[1] + Math.sin(aU) * ua.len * s];
    part("fore_" + side, J["el_" + side], elbow, aF - fa.rest);
    part("arm_" + side, J["sh_" + side], shPos, aU - ua.rest);
  }

  // 머리: 목에 붙여서 내 머리 기울기를 조금 따라가요 + 숨쉬는 흔들림
  const tilt = clamp(wrap(ang(shUser, sk.head) - spineUser), -0.5, 0.5) * 0.6;
  const neck = T(J.neck); neck[1] += Math.sin(t * 3) * sk.u * 0.006;
  part("head", J.neck, neck, rot + tilt);
  ctx.restore();
  return true;
}
