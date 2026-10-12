// 🙆 포즈 미믹 그림: 마스코트 캐릭터, 내 몸 위에 겹쳐 보여 주는 목표 자세 가이드, 마디별 맞음/틀림 표시.
// 캐릭터는 poses.js의 "각도"로 그려요. 그래서 화면에 보이는 자세 = 인식하는 기준이에요.
import { skeletonFromAngles, BODY, ARM_LIMBS, LEG_LIMBS } from "./poses.js";

const OUT = "#1b1140";                                   // 윤곽선(어두운 남색)
const HEAD = "#fff4e0", SUIT_A = "#7df9ff", SUIT_B = "#7c5cff", LIMB = "#a99bff", GLOVE = "#ffffff", BOOT = "#ff6fb1";

function line(ctx, a, b, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}
// 윤곽선이 있는 굵은 팔다리(둥근 끝)
function limb(ctx, a, b, w, fill) { line(ctx, a, b, w + w * 0.34, OUT); line(ctx, a, b, w, fill); }

/** 캐릭터의 화면 크기를 정하기 위해 그림이 차지하는 위/아래(몸 크기 단위)를 구해요 */
export function figureBounds(sk) {
  const bottom = Math.max(sk.la[1], sk.ra[1]) + 0.28;
  const top = BODY.headY - BODY.headR - 0.55;           // 토끼 귀까지
  return { top, bottom, height: bottom - top };
}

/**
 * 마스코트 그리기
 * @param angles  poses.anglesOf / lerpAngles 결과
 * @param box     { x: 가운데 x, y: 위 y, h: 그림 높이(px) }
 * @param o       { mood: "normal"|"happy", t: 시간(초, 숨쉬기/귀 흔들기), pop: 0~1(자세 바뀔 때 통통) }
 */
export function drawMascot(ctx, angles, box, o = {}) {
  const sk = skeletonFromAngles(angles), bnd = figureBounds(sk);
  const t = o.t ?? 0, mood = o.mood ?? "normal";
  const bob = Math.sin(t * 3) * 0.015;                                      // 숨쉬는 느낌
  const S = box.h / bnd.height;
  const ox = box.x, oy = box.y - bnd.top * S;
  const P = (p) => [ox + p[0] * S, oy + (p[1] + bob) * S];
  const u = S;                                                              // 1 = 어깨~엉덩이 길이

  ctx.save();
  // 바닥 그림자
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath();
  ctx.ellipse(ox, P([0, bnd.bottom - 0.12])[1], 0.95 * u, 0.1 * u, 0, 0, 7); ctx.fill();

  // 다리 + 부츠
  const [lh, lk, la, rh, rk, ra] = [P(sk.lh), P(sk.lk), P(sk.la), P(sk.rh), P(sk.rk), P(sk.ra)];
  for (const [h, k, a] of [[lh, lk, la], [rh, rk, ra]]) {
    limb(ctx, h, k, 0.27 * u, SUIT_B); limb(ctx, k, a, 0.24 * u, SUIT_B);
    ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(k[0], k[1], 0.16 * u, 0.16 * u, 0, 0, 7); ctx.fill();   // 무릎
    ctx.fillStyle = BOOT; ctx.strokeStyle = OUT; ctx.lineWidth = 0.06 * u;
    ctx.beginPath(); ctx.ellipse(a[0], a[1] + 0.08 * u, 0.2 * u, 0.13 * u, 0, 0, 7); ctx.fill(); ctx.stroke();     // 부츠
  }

  // 몸통 (둥근 사다리꼴 + 가슴 별)
  const [ls, rs, lhh, rhh] = [P(sk.ls), P(sk.rs), P(sk.lh), P(sk.rh)];
  const g = ctx.createLinearGradient(0, ls[1], 0, lhh[1]);
  g.addColorStop(0, SUIT_A); g.addColorStop(1, SUIT_B);
  ctx.beginPath();
  ctx.moveTo(ls[0] - 0.1 * u, ls[1] - 0.06 * u); ctx.lineTo(rs[0] + 0.1 * u, rs[1] - 0.06 * u);
  ctx.lineTo(rhh[0] + 0.12 * u, rhh[1] + 0.1 * u); ctx.lineTo(lhh[0] - 0.12 * u, lhh[1] + 0.1 * u); ctx.closePath();
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 0.07 * u; ctx.lineJoin = "round"; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `900 ${0.42 * u}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("★", ox, P([0, 0.5])[1]);

  // 팔 + 장갑
  for (const [s, e, w] of [[ls, P(sk.le), P(sk.lw)], [rs, P(sk.re), P(sk.rw)]]) {
    limb(ctx, s, e, 0.2 * u, LIMB); limb(ctx, e, w, 0.18 * u, LIMB);
    ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(e[0], e[1], 0.12 * u, 0, 7); ctx.fill();                       // 팔꿈치
    ctx.fillStyle = GLOVE; ctx.strokeStyle = OUT; ctx.lineWidth = 0.055 * u;
    ctx.beginPath(); ctx.arc(w[0], w[1], 0.15 * u, 0, 7); ctx.fill(); ctx.stroke();                               // 장갑 손
  }

  // 머리 + 토끼 귀 + 얼굴
  const hc = P(sk.head), hr = BODY.headR * u * 1.12;
  const wig = Math.sin(t * 4) * 0.12;
  for (const side of [-1, 1]) {                                              // 귀
    const base = [hc[0] + side * hr * 0.55, hc[1] - hr * 0.8], tip = [hc[0] + side * hr * (0.75 + wig * side), hc[1] - hr * 2.1];
    line(ctx, base, tip, hr * 0.62, OUT); line(ctx, base, tip, hr * 0.42, HEAD); line(ctx, base, [tip[0], tip[1] + hr * 0.25], hr * 0.18, "#ffb3d1");
  }
  ctx.fillStyle = HEAD; ctx.strokeStyle = OUT; ctx.lineWidth = 0.07 * u;
  ctx.beginPath(); ctx.arc(hc[0], hc[1], hr, 0, 7); ctx.fill(); ctx.stroke();
  const blink = (t % 3.2) > 3.05;                                            // 가끔 눈 깜빡임
  for (const side of [-1, 1]) {
    const ex = hc[0] + side * hr * 0.4, ey = hc[1] - hr * 0.05;
    if (blink || mood === "happy") {                                         // 웃는 눈 ^ ^
      ctx.strokeStyle = OUT; ctx.lineWidth = 0.06 * u; ctx.lineCap = "round"; ctx.beginPath();
      ctx.arc(ex, ey + hr * 0.1, hr * 0.17, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(ex, ey, hr * 0.2, hr * 0.26, 0, 0, 7); ctx.fill();
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(ex, ey + hr * 0.04, hr * 0.12, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex - hr * 0.04, ey - hr * 0.03, hr * 0.04, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,111,177,.55)"; ctx.beginPath(); ctx.ellipse(hc[0] + side * hr * 0.62, hc[1] + hr * 0.3, hr * 0.17, hr * 0.1, 0, 0, 7); ctx.fill();   // 볼
  }
  ctx.strokeStyle = OUT; ctx.lineWidth = 0.06 * u; ctx.lineCap = "round"; ctx.beginPath();
  if (mood === "happy") { ctx.arc(hc[0], hc[1] + hr * 0.18, hr * 0.3, 0.1 * Math.PI, 0.9 * Math.PI); }
  else { ctx.arc(hc[0], hc[1] + hr * 0.28, hr * 0.17, 0.15 * Math.PI, 0.85 * Math.PI); }
  ctx.stroke();

  if (mood === "happy") {                                                    // 반짝이
    ctx.font = `${0.4 * u}px serif`; ctx.fillStyle = "#fff";
    const k = (t * 2) % 1;
    ctx.globalAlpha = 1 - k * 0.6;
    ctx.fillText("✨", ox - 0.95 * u, hc[1] - k * 0.3 * u); ctx.fillText("✨", ox + 0.95 * u, hc[1] + 0.2 * u - k * 0.3 * u);
  }
  ctx.restore();
}

/** 내 몸 위에 목표 자세를 점선으로 겹쳐 보여 줘요 (anchor: 내 어깨 중앙, scale: 내 몸통 길이 px) */
export function drawGhost(ctx, angles, anchor, scale, { legs = false, alpha = 0.55, color = "#ffd166" } = {}) {
  if (!anchor || !(scale > 20)) return;
  const sk = skeletonFromAngles(angles), P = (p) => [anchor.x + p[0] * scale, anchor.y + p[1] * scale];
  ctx.save();
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, scale * 0.07); ctx.setLineDash([scale * 0.12, scale * 0.1]);
  const seg = (a, b) => { const A = P(a), B = P(b); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); };
  seg(sk.ls, sk.le); seg(sk.le, sk.lw); seg(sk.rs, sk.re); seg(sk.re, sk.rw);
  seg(sk.ls, sk.rs);
  if (legs) { seg(sk.lh, sk.rh); seg(sk.ls, sk.lh); seg(sk.rs, sk.rh); seg(sk.lh, sk.lk); seg(sk.lk, sk.la); seg(sk.rh, sk.rk); seg(sk.rk, sk.ra); }
  ctx.setLineDash([]);
  for (const j of [sk.lw, sk.rw].concat(legs ? [sk.la, sk.ra] : [])) { const p = P(j); ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(8, scale * 0.11), 0, 7); ctx.fill(); }
  ctx.restore();
}

const SEG = { LU: [11, 13], LF: [13, 15], RU: [12, 14], RF: [14, 16], LT: [23, 25], LS: [25, 27], RT: [24, 26], RS: [26, 28] };
const vis = (b, i) => !!b?.[i] && (b[i].v ?? 1) >= 0.45;
/** 내 몸의 팔다리를 마디별로: 맞으면 초록, 틀리면 주황, 이번 자세와 상관없는 마디는 흐리게 */
export function drawUserLimbs(ctx, body, match, pose, { needLegs = false } = {}) {
  if (!body) return;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  const limbs = ARM_LIMBS.concat(needLegs ? LEG_LIMBS : []);
  for (const k of limbs) {
    const [i, j] = SEG[k];
    if (!vis(body, i) || !vis(body, j)) continue;
    const r = match?.perLimb?.[k];                        // 이번 자세에서 보는 마디만 판정이 있어요
    const color = r ? (r.ok ? "#00e676" : "#ff9f43") : "rgba(125,249,255,.45)";
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = r ? 16 : 0;
    ctx.lineWidth = r ? 12 : 8;
    ctx.beginPath(); ctx.moveTo(body[i].x, body[i].y); ctx.lineTo(body[j].x, body[j].y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(125,249,255,.6)"; ctx.lineWidth = 8;                   // 어깨선/몸통
  if (vis(body, 11) && vis(body, 12)) { ctx.beginPath(); ctx.moveTo(body[11].x, body[11].y); ctx.lineTo(body[12].x, body[12].y); ctx.stroke(); }
  if (needLegs && vis(body, 23) && vis(body, 24)) {
    ctx.beginPath(); ctx.moveTo(body[23].x, body[23].y); ctx.lineTo(body[24].x, body[24].y);
    ctx.moveTo((body[11].x + body[12].x) / 2, (body[11].y + body[12].y) / 2); ctx.lineTo((body[23].x + body[24].x) / 2, (body[23].y + body[24].y) / 2); ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  for (const i of [15, 16].concat(needLegs ? [27, 28] : [])) if (vis(body, i)) { ctx.beginPath(); ctx.arc(body[i].x, body[i].y, 9, 0, 7); ctx.fill(); }
  if (vis(body, 0)) { ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(body[0].x, body[0].y, 26, 0, 7); ctx.stroke(); }
  ctx.restore();
}

/** 부드러운 전환(살짝 튕기는 느낌) */
export const easeOutBack = (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
