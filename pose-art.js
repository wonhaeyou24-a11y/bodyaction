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

const vec = (deg, len) => [Math.cos((deg * Math.PI) / 180) * len, Math.sin((deg * Math.PI) / 180) * len];
const add = (p, v) => [p[0] + v[0], p[1] + v[1]];
const vis = (b, i) => !!b?.[i] && (b[i].v ?? 1) >= 0.35;

/** 🎯 회전하는 사이버 네온 타겟 조준 링 (Holographic Target Reticle) */
function drawTargetReticle(ctx, x, y, r, { locked = false, t = 0, label = "" } = {}) {
  ctx.save();
  ctx.translate(x, y);
  const col = locked ? "#00ff88" : "#00f0ff";
  const glow = locked ? "#00ff88" : "#00e5ff";
  ctx.shadowColor = glow;
  ctx.shadowBlur = locked ? 24 : 14;

  // 1) 외곽 회전 점선/호
  ctx.strokeStyle = col;
  ctx.lineWidth = locked ? 3.5 : 2.5;
  const rot = (t * (locked ? 4.5 : 2.2)) % (Math.PI * 2);
  ctx.beginPath();
  ctx.arc(0, 0, r, rot, rot + Math.PI * 1.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, rot + Math.PI, rot + Math.PI * 2.4);
  ctx.stroke();

  // 2) 내부 펄스 링
  const pulse = Math.sin(t * (locked ? 10 : 5)) * (locked ? 3 : 2);
  ctx.strokeStyle = locked ? "rgba(0,255,136,0.9)" : "rgba(255,209,102,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(4, r * 0.55 + pulse), 0, Math.PI * 2);
  ctx.stroke();

  // 3) 중심 크로스헤어(+) 및 코어 점
  ctx.fillStyle = locked ? "#ffffff" : col;
  ctx.beginPath();
  ctx.arc(0, 0, locked ? 5 : 3.5, 0, Math.PI * 2);
  ctx.fill();

  const cross = r * 0.35;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-cross, 0); ctx.lineTo(cross, 0);
  ctx.moveTo(0, -cross); ctx.lineTo(0, cross);
  ctx.stroke();

  // 4) 락온 배지
  if (locked) {
    ctx.fillStyle = "#00ff88";
    ctx.font = "900 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LOCK", 0, -r - 12);
  } else if (label) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "800 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, -r - 10);
  }
  ctx.restore();
}

/**
 * 🌟 내 몸 위에 목표 자세를 실물 1:1 홀로그램 빔과 사이버 타겟 링으로 표시
 * - 플레이어의 실제 신체 비율(어깨너비, 팔길이, 다리길이)에 100% 맞추어 왜소하거나 짧아지지 않음!
 * - 손끝/발끝 목표 위치에 회전하는 타겟 링을 띄워 어디로 뻗어야 하는지 즉시 직관적으로 안내!
 */
export function drawGhost(ctx, angles, anchor, scale, { body = null, legs = false, alpha = 0.65, color = "#00f0ff", t = 0 } = {}) {
  if (!anchor || !(scale > 15)) return;

  // 1. 플레이어 실측 신체 스케일 산출 (어깨너비, 팔/다리 길이 1:1 동기화)
  const sw = (body && vis(body, 11) && vis(body, 12))
    ? Math.hypot(body[11].x - body[12].x, body[11].y - body[12].y)
    : Math.max(scale * 0.7, 75);

  let realUpper = sw * 1.1;
  let realFore = sw * 1.05;
  if (body) {
    const uArms = [];
    if (vis(body, 11) && vis(body, 13)) uArms.push(Math.hypot(body[11].x - body[13].x, body[11].y - body[13].y));
    if (vis(body, 12) && vis(body, 14)) uArms.push(Math.hypot(body[12].x - body[14].x, body[12].y - body[14].y));
    if (uArms.length) realUpper = uArms.reduce((a, b) => a + b, 0) / uArms.length;

    const fArms = [];
    if (vis(body, 13) && vis(body, 15)) fArms.push(Math.hypot(body[13].x - body[15].x, body[13].y - body[15].y));
    if (vis(body, 14) && vis(body, 16)) fArms.push(Math.hypot(body[14].x - body[16].x, body[14].y - body[16].y));
    if (fArms.length) realFore = fArms.reduce((a, b) => a + b, 0) / fArms.length;
  }
  realUpper = Math.max(realUpper, sw * 0.95);
  realFore = Math.max(realFore, sw * 0.90);

  let realThigh = sw * 1.35;
  let realShin = sw * 1.30;
  if (body) {
    const thighs = [];
    if (vis(body, 23) && vis(body, 25)) thighs.push(Math.hypot(body[23].x - body[25].x, body[23].y - body[25].y));
    if (vis(body, 24) && vis(body, 26)) thighs.push(Math.hypot(body[24].x - body[26].x, body[24].y - body[26].y));
    if (thighs.length) realThigh = thighs.reduce((a, b) => a + b, 0) / thighs.length;

    const shins = [];
    if (vis(body, 25) && vis(body, 27)) shins.push(Math.hypot(body[25].x - body[27].x, body[25].y - body[27].y));
    if (vis(body, 26) && vis(body, 28)) shins.push(Math.hypot(body[26].x - body[28].x, body[26].y - body[28].y));
    if (shins.length) realShin = shins.reduce((a, b) => a + b, 0) / shins.length;
  }
  realThigh = Math.max(realThigh, sw * 1.25);
  realShin = Math.max(realShin, sw * 1.20);

  // 2. 어깨 및 골반 시작점 (플레이어 신체 랜드마크에 직접 앵커링)
  const ls = (body && vis(body, 11)) ? [body[11].x, body[11].y] : [anchor.x - sw * 0.5, anchor.y];
  const rs = (body && vis(body, 12)) ? [body[12].x, body[12].y] : [anchor.x + sw * 0.5, anchor.y];
  const lh = (body && vis(body, 23)) ? [body[23].x, body[23].y] : [anchor.x - sw * 0.35, anchor.y + Math.max(scale, sw * 1.3)];
  const rh = (body && vis(body, 24)) ? [body[24].x, body[24].y] : [anchor.x + sw * 0.35, anchor.y + Math.max(scale, sw * 1.3)];

  // 3. 목표 관절 위치 계산
  const le = add(ls, vec(angles.LU, realUpper)), lw = add(le, vec(angles.LF, realFore));
  const re = add(rs, vec(angles.RU, realUpper)), rw = add(re, vec(angles.RF, realFore));
  const lk = add(lh, vec(angles.LT, realThigh)), la = add(lk, vec(angles.LS, realShin));
  const rk = add(rh, vec(angles.RT, realThigh)), ra = add(rk, vec(angles.RS, realShin));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 4. 홀로그램 빔 가이드라인 렌더링
  const guideBeam = (p1, p2, width = 8, beamColor = "rgba(0, 240, 255, 0.75)") => {
    // 외곽 홀로그램 네온 글로우
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = width;
    ctx.setLineDash([14, 7]);
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();

    // 중심 코어 라인
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    ctx.lineWidth = width * 0.35;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  };

  // 양팔 가이드 빔
  guideBeam(ls, le, 9); guideBeam(le, lw, 8);
  guideBeam(rs, re, 9); guideBeam(re, rw, 8);
  guideBeam(ls, rs, 6, "rgba(0, 220, 255, 0.45)");

  // 다리 가이드 빔 (다리 포즈일 때)
  if (legs) {
    guideBeam(lh, rh, 6, "rgba(0, 220, 255, 0.45)");
    guideBeam(ls, lh, 6, "rgba(0, 220, 255, 0.35)");
    guideBeam(rs, rh, 6, "rgba(0, 220, 255, 0.35)");
    guideBeam(lh, lk, 10); guideBeam(lk, la, 9);
    guideBeam(rh, rk, 10); guideBeam(rk, ra, 9);
  }

  // 팔꿈치/무릎 관절 연결 링
  ctx.shadowBlur = 10; ctx.shadowColor = "#00f0ff";
  ctx.fillStyle = "rgba(0, 240, 255, 0.6)";
  for (const j of [le, re].concat(legs ? [lk, rk] : [])) {
    ctx.beginPath(); ctx.arc(j[0], j[1], 6, 0, Math.PI * 2); ctx.fill();
  }

  // 5. 🎯 사이버 네온 타겟 조준 링 (손끝과 발끝 목표 지점)
  const reticleR = Math.max(18, Math.min(sw * 0.22, 28));

  // 플레이어 손/발 위치와의 거리 측정 및 락온 판정
  const lockDist = reticleR * 1.8;
  const lHandNear = body && vis(body, 15) && Math.hypot(body[15].x - lw[0], body[15].y - lw[1]) <= lockDist;
  const rHandNear = body && vis(body, 16) && Math.hypot(body[16].x - rw[0], body[16].y - rw[1]) <= lockDist;
  const lFootNear = legs && body && vis(body, 27) && Math.hypot(body[27].x - la[0], body[27].y - la[1]) <= lockDist;
  const rFootNear = legs && body && vis(body, 28) && Math.hypot(body[28].x - ra[0], body[28].y - ra[1]) <= lockDist;

  // 내 손에서 목표 타겟으로 이어지는 유도 보조 펄스선
  if (body && vis(body, 15) && !lHandNear) {
    ctx.strokeStyle = "rgba(0, 240, 255, 0.35)"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(body[15].x, body[15].y); ctx.lineTo(lw[0], lw[1]); ctx.stroke();
  }
  if (body && vis(body, 16) && !rHandNear) {
    ctx.strokeStyle = "rgba(0, 240, 255, 0.35)"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(body[16].x, body[16].y); ctx.lineTo(rw[0], rw[1]); ctx.stroke();
  }
  ctx.setLineDash([]);

  // 왼손 목표 링 & 오른손 목표 링
  drawTargetReticle(ctx, lw[0], lw[1], reticleR, { locked: !!lHandNear, t, label: "L HAND" });
  drawTargetReticle(ctx, rw[0], rw[1], reticleR, { locked: !!rHandNear, t, label: "R HAND" });

  // 다리 목표 링
  if (legs) {
    drawTargetReticle(ctx, la[0], la[1], reticleR, { locked: !!lFootNear, t, label: "L FOOT" });
    drawTargetReticle(ctx, ra[0], ra[1], reticleR, { locked: !!rFootNear, t, label: "R FOOT" });
  }

  ctx.restore();
}

const SEG = { LU: [11, 13], LF: [13, 15], RU: [12, 14], RF: [14, 16], LT: [23, 25], LS: [25, 27], RT: [24, 26], RS: [26, 28] };

/**
 * ⚡ 내 몸의 전신 1:1 풀사이즈 네온 스켈레톤 슈트
 * - 온몸(머리, 목, 어깨, 척추, 골반, 양팔, 양다리)을 온전히 선명하게 렌더링하여 왜소하거나 끊기지 않음!
 * - 일치하는 마디: 눈부신 네온 에메랄드 그린 (#00ff88) + 백색 코어 빔
 * - 틀리거나 조정 필요한 마디: 네온 앰버 골드 (#ffaa00)
 * - 판정 외 마디: 사이언 네온 (#00e5ff)으로 전신 체형을 항상 완벽하게 유지
 */
export function drawUserLimbs(ctx, body, match, pose, { needLegs = false } = {}) {
  if (!body) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. 전신 골격 라인 정의 (신체 모든 부위를 포함하여 풍성한 1:1 골격 구축)
  const LIMB_SEGMENTS = [
    { k: "LU", a: 11, b: 13, isLimb: true },
    { k: "LF", a: 13, b: 15, isLimb: true },
    { k: "RU", a: 12, b: 14, isLimb: true },
    { k: "RF", a: 14, b: 16, isLimb: true },
    { k: "LT", a: 23, b: 25, isLimb: true },
    { k: "LS", a: 25, b: 27, isLimb: true },
    { k: "RT", a: 24, b: 26, isLimb: true },
    { k: "RS", a: 26, b: 28, isLimb: true },
  ];

  // 2. 팔다리 세그먼트 그리기
  for (const item of LIMB_SEGMENTS) {
    const { k, a, b } = item;
    if (!vis(body, a) || !vis(body, b)) continue;

    const r = match?.perLimb?.[k]; // 현재 자세에서 판정 중인 마디인가?
    const isTarget = !!r;
    const ok = r?.ok;

    let outerColor = "rgba(0, 229, 255, 0.65)";
    let shadowColor = "#00e5ff";
    let outerWidth = 8;
    let coreWidth = 3;

    if (isTarget) {
      if (ok) {
        outerColor = "#00e676";
        shadowColor = "#00ff88";
        outerWidth = 14;
        coreWidth = 5;
      } else {
        outerColor = "#ff9f43";
        shadowColor = "#ffaa00";
        outerWidth = 12;
        coreWidth = 4;
      }
    }

    // 외곽 네온 글로우 빔
    ctx.strokeStyle = outerColor;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = isTarget ? 20 : 10;
    ctx.lineWidth = outerWidth;
    ctx.beginPath();
    ctx.moveTo(body[a].x, body[a].y);
    ctx.lineTo(body[b].x, body[b].y);
    ctx.stroke();

    // 중심 화이트 코어 빔 (광선검 효과)
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isTarget ? (ok ? "#ffffff" : "#ffeaa7") : "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = coreWidth;
    ctx.beginPath();
    ctx.moveTo(body[a].x, body[a].y);
    ctx.lineTo(body[b].x, body[b].y);
    ctx.stroke();
  }

  // 3. 몸통 및 척추 렌더링 (어깨, 옆구리, 골반, 중심 척추)
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "rgba(0, 229, 255, 0.75)";
  ctx.lineWidth = 7;

  // 어깨선
  if (vis(body, 11) && vis(body, 12)) {
    ctx.beginPath(); ctx.moveTo(body[11].x, body[11].y); ctx.lineTo(body[12].x, body[12].y); ctx.stroke();
  }
  // 골반선 & 옆구리 & 척추선
  if (vis(body, 23) && vis(body, 24)) {
    ctx.beginPath(); ctx.moveTo(body[23].x, body[23].y); ctx.lineTo(body[24].x, body[24].y); ctx.stroke();
    if (vis(body, 11)) { ctx.beginPath(); ctx.moveTo(body[11].x, body[11].y); ctx.lineTo(body[23].x, body[23].y); ctx.stroke(); }
    if (vis(body, 12)) { ctx.beginPath(); ctx.moveTo(body[12].x, body[12].y); ctx.lineTo(body[24].x, body[24].y); ctx.stroke(); }
    // 척추 중앙선
    if (vis(body, 11) && vis(body, 12)) {
      const shMidX = (body[11].x + body[12].x) / 2, shMidY = (body[11].y + body[12].y) / 2;
      const hipMidX = (body[23].x + body[24].x) / 2, hipMidY = (body[23].y + body[24].y) / 2;
      ctx.strokeStyle = "rgba(125, 249, 255, 0.85)"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(shMidX, shMidY); ctx.lineTo(hipMidX, hipMidY); ctx.stroke();
    }
  }

  // 목선
  if (vis(body, 0) && vis(body, 11) && vis(body, 12)) {
    const shMidX = (body[11].x + body[12].x) / 2, shMidY = (body[11].y + body[12].y) / 2;
    ctx.strokeStyle = "rgba(125, 249, 255, 0.85)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(shMidX, shMidY); ctx.lineTo(body[0].x, body[0].y); ctx.stroke();
  }

  // 4. 관절 노드 포인트 (어깨, 팔꿈치, 손목, 엉덩이, 무릎, 발목)
  const joints = [11, 12, 13, 14, 23, 24, 25, 26];
  ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 10;
  ctx.fillStyle = "#ffffff";
  for (const j of joints) {
    if (vis(body, j)) { ctx.beginPath(); ctx.arc(body[j].x, body[j].y, 6, 0, Math.PI * 2); ctx.fill(); }
  }

  // 손목 노드 (15, 16): 크고 빛나는 네온 보석 링
  for (const [idx, limbKey] of [[15, "LF"], [16, "RF"]]) {
    if (!vis(body, idx)) continue;
    const r = match?.perLimb?.[limbKey];
    const ok = r?.ok;
    const handCol = r ? (ok ? "#00ff88" : "#ffaa00") : "#00f0ff";
    ctx.shadowColor = handCol; ctx.shadowBlur = 18;
    ctx.fillStyle = handCol;
    ctx.beginPath(); ctx.arc(body[idx].x, body[idx].y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(body[idx].x, body[idx].y, 5, 0, Math.PI * 2); ctx.fill();
  }

  // 발목 노드 (27, 28)
  for (const [idx, limbKey] of [[27, "LS"], [28, "RS"]]) {
    if (!vis(body, idx)) continue;
    const r = match?.perLimb?.[limbKey];
    const ok = r?.ok;
    const footCol = r ? (ok ? "#00ff88" : "#ffaa00") : "#00f0ff";
    ctx.shadowColor = footCol; ctx.shadowBlur = 14;
    ctx.fillStyle = footCol;
    ctx.beginPath(); ctx.arc(body[idx].x, body[idx].y, 9, 0, Math.PI * 2); ctx.fill();
  }

  // 머리 페이스 바이저 (0)
  if (vis(body, 0)) {
    const sw = (vis(body, 11) && vis(body, 12)) ? Math.abs(body[11].x - body[12].x) : 80;
    const hr = Math.max(20, Math.min(sw * 0.35, 36));
    ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 16;
    ctx.strokeStyle = "rgba(0, 240, 255, 0.85)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(body[0].x, body[0].y, hr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(0, 240, 255, 0.18)"; ctx.fill();
  }

  ctx.restore();
}

/** 부드러운 전환(살짝 튕기는 느낌) */
export const easeOutBack = (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

