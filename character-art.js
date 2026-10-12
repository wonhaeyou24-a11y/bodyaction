// 캐릭터 4종 그림 (귀여운 카툰풍): 사람 하루 · 여우 토리 · 로봇 볼트 · 마법사 루나.
// 입력은 character.js의 뼈대(skeletonFromBody / skeletonToPx) — 내 몸 움직임을 그대로 따라 해요. 모두 코드로 그려서 파일이 필요 없어요.
// 한 프레임에 도형 수십 개라 가벼워요 (그림자 번짐(shadowBlur) 없이 그라디언트/외곽선만 사용).
const TAU = Math.PI * 2;

// ---------- 공통 도구 ----------
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const add = (a, v, k = 1) => [a[0] + v[0] * k, a[1] + v[1] * k];

/** 끝이 둥글고 한쪽이 가는 굵은 선(팔다리) + 윤곽선 */
function cap(ctx, a, b, r1, r2, fill, out, ow) {
  const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.beginPath();
  ctx.arc(a[0], a[1], r1, th + Math.PI / 2, th + (3 * Math.PI) / 2);
  ctx.arc(b[0], b[1], r2, th - Math.PI / 2, th + Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.lineJoin = "round"; ctx.stroke();
}
function circle(ctx, c, r, fill, out, ow) {
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (out) { ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.stroke(); }
}
function ell(ctx, c, rx, ry, rot, fill, out, ow) {
  ctx.beginPath(); ctx.ellipse(c[0], c[1], rx, ry, rot, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (out) { ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.stroke(); }
}
function poly(ctx, pts, fill, out, ow) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (out) { ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.lineJoin = "round"; ctx.stroke(); }
}
function rrect(ctx, x, y, w, h, r, fill, out, ow) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (out) { ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.stroke(); }
}
function vgrad(ctx, y0, y1, c0, c1) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
const gloss = (ctx, c, r, a = 0.35) => { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.ellipse(c[0] - r * 0.35, c[1] - r * 0.4, r * 0.28, r * 0.16, -0.6, 0, TAU); ctx.fill(); };   // 반짝 하이라이트

/** 몸통 기준 좌표계: 어깨선 방향(side)·아래 방향(down) */
function frame(sk) {
  const a = Math.atan2(sk.rs[1] - sk.ls[1], sk.rs[0] - sk.ls[0]);
  return { side: [Math.cos(a), Math.sin(a)], down: [-Math.sin(a), Math.cos(a)], ang: a };
}
/** 눈: 깜빡임/웃는 눈/놀란 눈 */
function eye(ctx, c, r, o) {
  const { iris = "#3a2a1a", out = "#1b1140", mood = "normal", blink = false, ry = 1.3 } = o;
  if (blink || mood === "happy") {
    ctx.strokeStyle = out; ctx.lineWidth = Math.max(2, r * 0.38); ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(c[0], c[1] + r * 0.25, r * 0.8, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke(); return;
  }
  ell(ctx, c, r, r * ry, 0, "#fff", out, Math.max(1.5, r * 0.28));
  ell(ctx, [c[0], c[1] + r * 0.12], r * 0.66, r * ry * 0.78, 0, iris);
  circle(ctx, [c[0], c[1] + r * 0.15], r * 0.34, "#140a2a");
  circle(ctx, [c[0] - r * 0.22, c[1] - r * 0.28], r * 0.24, "#fff");
  circle(ctx, [c[0] + r * 0.2, c[1] + r * 0.4], r * 0.12, "rgba(255,255,255,.85)");
}
const blinking = (t) => (t % 3.4) > 3.24;

/** 공통 몸 그리기. S 에 색/장식 함수를 넣어서 캐릭터마다 다르게 */
function drawBody(ctx, sk, S, o) {
  const u = sk.u, ow = Math.max(2, u * 0.055), { side, down } = frame(sk), t = o.t ?? 0;
  const legsEst = sk.est?.legs;
  // 1) 다리 + 신발
  const legs = [[sk.lh, sk.lk, sk.la], [sk.rh, sk.rk, sk.ra]];
  for (let i = 0; i < 2; i++) {
    const [h, k, a] = legs[i];
    cap(ctx, h, k, u * 0.15, u * 0.125, S.legTop, S.out, ow);
    cap(ctx, k, a, u * 0.125, u * 0.1, S.legBottom ?? S.legTop, S.out, ow);
    if (S.knee) circle(ctx, k, u * 0.11, S.knee, S.out, ow * 0.7);
    S.shoe(ctx, a, side, down, u, ow, i === 0 ? -1 : 1);
  }
  // 2) 뒤쪽 장식(꼬리/망토)은 몸통보다 먼저
  S.back?.(ctx, sk, o, { side, down, ow });
  // 3) 몸통
  const top = (p, dx, dy) => [p[0] + side[0] * dx * u + down[0] * dy * u, p[1] + side[1] * dx * u + down[1] * dy * u];
  const tl = top(sk.ls, -0.12, -0.07), tr = top(sk.rs, 0.12, -0.07), br = top(sk.rh, 0.15, S.hem ?? 0.1), bl = top(sk.lh, -0.15, S.hem ?? 0.1);
  ctx.beginPath();
  ctx.moveTo(tl[0], tl[1]);
  ctx.quadraticCurveTo((tl[0] + tr[0]) / 2 - down[0] * u * 0.06, (tl[1] + tr[1]) / 2 - down[1] * u * 0.06, tr[0], tr[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.quadraticCurveTo((br[0] + bl[0]) / 2 + down[0] * u * 0.05, (br[1] + bl[1]) / 2 + down[1] * u * 0.05, bl[0], bl[1]);
  ctx.closePath();
  const minY = Math.min(tl[1], tr[1]), maxY = Math.max(bl[1], br[1]);
  ctx.fillStyle = vgrad(ctx, minY, maxY, S.torsoA, S.torsoB); ctx.fill();
  ctx.lineWidth = ow; ctx.strokeStyle = S.out; ctx.lineJoin = "round"; ctx.stroke();
  S.torso?.(ctx, sk, o, { side, down, ow, tl, tr, br, bl });
  // 4) 팔 + 손
  const arms = [[sk.ls, sk.le, sk.lw], [sk.rs, sk.re, sk.rw]];
  for (let i = 0; i < 2; i++) {
    const [s, e, w] = arms[i];
    cap(ctx, s, e, u * 0.13, u * 0.105, S.armTop, S.out, ow);
    cap(ctx, e, w, u * 0.105, u * 0.09, S.armBottom ?? S.armTop, S.out, ow);
    S.hand(ctx, w, e, u, ow, i === 0 ? -1 : 1, t);
  }
}

// ---------- 하루 (사람, 모험가) ----------
const HARU = {
  out: "#3a2218", legTop: "#ffd2a8", legBottom: "#ffd2a8", torsoA: "#ff9a4d", torsoB: "#f0661c", armTop: "#ff8a3d", armBottom: "#ff8a3d",
  hem: 0.04,
  shoe(ctx, a, side, down, u, ow, dir) {
    // 흰 양말 + 빨간 운동화
    ctx.save(); cap(ctx, add(a, down, -u * 0.12), a, u * 0.1, u * 0.1, "#ffffff", this.out, ow * 0.8); ctx.restore();
    const c = add(add(a, down, u * 0.09), side, dir * u * 0.07);
    ell(ctx, c, u * 0.2, u * 0.115, 0, "#e8343b", this.out, ow);
    ell(ctx, add(c, side, dir * u * 0.04), u * 0.12, u * 0.035, 0, "#ffffff");
    gloss(ctx, c, u * 0.2, 0.3);
  },
  torso(ctx, sk, o, k) {
    const u = sk.u, mid = mix(sk.ls, sk.rs, 0.5), hip = sk.hipMid;
    // 후드티: 지퍼 선 + 주머니 + 반바지 허리
    ctx.strokeStyle = "rgba(120,40,0,.55)"; ctx.lineWidth = k.ow * 0.7; ctx.beginPath();
    ctx.moveTo(mid[0] + k.down[0] * u * 0.02, mid[1] + k.down[1] * u * 0.02); ctx.lineTo(hip[0] - k.down[0] * u * 0.1, hip[1] - k.down[1] * u * 0.1); ctx.stroke();
    const pc = add(hip, k.down, -u * 0.18);
    ell(ctx, pc, u * 0.2, u * 0.08, k.ang, "rgba(255,255,255,.28)", "rgba(120,40,0,.4)", k.ow * 0.6);
    // 파란 반바지
    poly(ctx, [add(sk.lh, k.side, -u * 0.17), add(sk.rh, k.side, u * 0.17), add(add(sk.rh, k.side, u * 0.2), k.down, u * 0.22), add(add(sk.lh, k.side, -u * 0.2), k.down, u * 0.22)], "#3b6cff", this.out, k.ow);
    ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = k.ow * 0.6; ctx.beginPath(); ctx.moveTo(hip[0], hip[1]); ctx.lineTo(hip[0] + k.down[0] * u * 0.2, hip[1] + k.down[1] * u * 0.2); ctx.stroke();
  },
  hand(ctx, w, e, u, ow, dir) { circle(ctx, w, u * 0.115, "#ffd2a8", this.out, ow); gloss(ctx, w, u * 0.12, 0.35); },
  head(ctx, hc, hr, sk, o) {
    const { t = 0, mood = "normal" } = o, ow = Math.max(2, sk.u * 0.055), out = this.out;
    // 뒤통수 머리카락
    circle(ctx, hc, hr * 1.06, "#6b4426", out, ow);
    // 얼굴
    ell(ctx, add(hc, [0, 1], hr * 0.1), hr * 0.93, hr * 0.9, 0, "#ffd9b8", out, ow * 0.9);
    // 앞머리(뾰족한 앞머리 3갈래)
    const bangs = [[-0.92, -0.2], [-0.5, -0.78], [-0.1, -0.5], [0.3, -0.82], [0.72, -0.5], [0.95, -0.15]];
    ctx.beginPath(); ctx.moveTo(hc[0] - hr * 1.0, hc[1] - hr * 0.1);
    for (const [bx, by] of bangs) ctx.lineTo(hc[0] + bx * hr, hc[1] + by * hr - hr * 0.1);
    ctx.lineTo(hc[0] + hr * 1.0, hc[1] - hr * 0.1); ctx.arc(hc[0], hc[1], hr * 1.04, 0, Math.PI, true); ctx.closePath();
    ctx.fillStyle = "#6b4426"; ctx.fill(); ctx.lineWidth = ow * 0.8; ctx.strokeStyle = out; ctx.lineJoin = "round"; ctx.stroke();
    // 이마 위 고글 (끈 + 노란 렌즈)
    ctx.strokeStyle = "#2a2a3a"; ctx.lineWidth = hr * 0.2; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(hc[0], hc[1] - hr * 0.1, hr * 1.02, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    for (const s of [-1, 1]) {
      const lc = [hc[0] + s * hr * 0.4, hc[1] - hr * 0.95];
      circle(ctx, lc, hr * 0.27, "#2a2a3a"); circle(ctx, lc, hr * 0.2, "#ffd84a"); circle(ctx, [lc[0] - hr * 0.06, lc[1] - hr * 0.07], hr * 0.07, "#fff");
    }
    // 얼굴 표정
    const bl = blinking(t);
    for (const s of [-1, 1]) {
      eye(ctx, [hc[0] + s * hr * 0.36, hc[1] + hr * 0.2], hr * 0.17, { iris: "#6a3d1e", out, mood, blink: bl });
      ctx.strokeStyle = "#4a2a14"; ctx.lineWidth = hr * 0.07; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(hc[0] + s * hr * 0.2, hc[1] - hr * 0.1); ctx.lineTo(hc[0] + s * hr * 0.55, hc[1] - hr * 0.14 - (mood === "happy" ? hr * 0.06 : 0)); ctx.stroke();
      ell(ctx, [hc[0] + s * hr * 0.62, hc[1] + hr * 0.5], hr * 0.15, hr * 0.09, 0, "rgba(255,110,120,.55)");
    }
    circle(ctx, [hc[0], hc[1] + hr * 0.42], hr * 0.05, "#e9a17a");
    ctx.strokeStyle = out; ctx.lineWidth = hr * 0.07; ctx.lineCap = "round"; ctx.beginPath();
    if (mood === "happy") { ctx.arc(hc[0], hc[1] + hr * 0.5, hr * 0.26, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke(); ctx.fillStyle = "#c2434b"; ctx.fill(); }
    else { ctx.arc(hc[0], hc[1] + hr * 0.56, hr * 0.15, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
  },
};

// ---------- 토리 (여우) ----------
const TORI = {
  out: "#4a2a1a", legTop: "#ff9a3c", legBottom: "#ff9a3c", torsoA: "#ffab4d", torsoB: "#f07f1e", armTop: "#ff9a3c", armBottom: "#ff9a3c", hem: 0.06,
  shoe(ctx, a, side, down, u, ow, dir) {
    cap(ctx, add(a, down, -u * 0.2), a, u * 0.1, u * 0.1, "#5a3524", this.out, ow * 0.8);                // 갈색 양말
    const c = add(add(a, down, u * 0.08), side, dir * u * 0.06);
    ell(ctx, c, u * 0.2, u * 0.12, 0, "#5a3524", this.out, ow);
    for (const k of [-0.07, 0, 0.07]) circle(ctx, add(add(c, side, dir * u * 0.12), side, k * u * 0.5), u * 0.03, "#ffd9b8");   // 발가락 젤리
    gloss(ctx, c, u * 0.2, 0.2);
  },
  back(ctx, sk, o, k) {
    // 복슬복슬 큰 꼬리 (살랑살랑)
    const u = sk.u, t = o.t ?? 0, wag = Math.sin(t * 3.2) * 0.18, base = add(sk.hipMid, k.down, -u * 0.05);
    const dirx = (sk.hipMid[0] >= (sk.ls[0] + sk.rs[0]) / 2 ? 1 : 1);
    const p1 = add(add(base, k.side, dirx * u * 0.55), k.down, u * 0.2), p2 = add(add(base, k.side, dirx * u * (0.95 + wag)), k.down, -u * 0.35), tip = add(add(base, k.side, dirx * u * (1.05 + wag * 1.3)), k.down, -u * 0.75);
    ctx.beginPath(); ctx.moveTo(base[0], base[1] + 0);
    ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], tip[0], tip[1]);
    ctx.bezierCurveTo(add(p2, k.side, u * 0.3)[0], add(p2, k.side, u * 0.3)[1] + u * 0.1, add(p1, k.side, u * 0.35)[0], add(p1, k.side, u * 0.35)[1] + u * 0.25, add(base, k.down, u * 0.12)[0], add(base, k.down, u * 0.12)[1]);
    ctx.closePath(); ctx.fillStyle = "#ff9a3c"; ctx.fill(); ctx.lineWidth = k.ow; ctx.strokeStyle = this.out; ctx.lineJoin = "round"; ctx.stroke();
    // 하얀 꼬리 끝
    ctx.save(); ctx.clip();
    ell(ctx, add(tip, k.down, u * 0.1), u * 0.28, u * 0.24, 0, "#fff6e8"); ctx.restore();
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], tip[0], tip[1]); ctx.lineWidth = k.ow; ctx.strokeStyle = this.out; ctx.stroke();
  },
  torso(ctx, sk, o, k) {
    const u = sk.u, hip = sk.hipMid, mid = mix(sk.ls, sk.rs, 0.5);
    ell(ctx, mix(mid, hip, 0.55), u * 0.2, u * 0.34, k.ang, "#fff1dc");                                  // 배 쪽 크림색 털
    // 빨간 목도리
    const sc = add(mid, k.down, -u * 0.02);
    cap(ctx, add(sc, k.side, -u * 0.34), add(sc, k.side, u * 0.34), u * 0.075, u * 0.075, "#e8343b", this.out, k.ow);
    cap(ctx, add(sc, k.side, u * 0.2), add(add(sc, k.side, u * 0.26), k.down, u * 0.4), u * 0.07, u * 0.05, "#f0555b", this.out, k.ow * 0.9);   // 늘어진 목도리 끝
  },
  hand(ctx, w, e, u, ow) { circle(ctx, w, u * 0.125, "#5a3524", this.out, ow); circle(ctx, w, u * 0.05, "#7a4a34"); gloss(ctx, w, u * 0.12, 0.25); },
  head(ctx, hc, hr, sk, o) {
    const { t = 0, mood = "normal" } = o, ow = Math.max(2, sk.u * 0.055), out = this.out;
    // 귀 (뾰족, 안쪽 분홍, 끝 검정)
    for (const s of [-1, 1]) {
      const wig = Math.sin(t * 4 + s) * 0.05;
      const b1 = [hc[0] + s * hr * 0.25, hc[1] - hr * 0.7], b2 = [hc[0] + s * hr * 0.95, hc[1] - hr * 0.35], tip = [hc[0] + s * hr * (0.95 + wig), hc[1] - hr * 1.7];
      poly(ctx, [b1, tip, b2], "#ff9a3c", out, ow);
      poly(ctx, [mix(b1, tip, 0.18), mix(tip, mix(b1, b2, 0.5), 0.35), mix(b2, tip, 0.18)], "#ffb3a0");
      poly(ctx, [mix(b1, tip, 0.72), tip, mix(b2, tip, 0.72)], "#3a2418", out, ow * 0.5);
    }
    circle(ctx, hc, hr * 1.04, "#ff9a3c", out, ow);                                                       // 얼굴 (털)
    // 하얀 볼 털 (양쪽 뺨이 뾰족하게)
    for (const s of [-1, 1]) poly(ctx, [[hc[0] + s * hr * 1.0, hc[1] + hr * 0.1], [hc[0] + s * hr * 0.35, hc[1] + hr * 0.42], [hc[0] + s * hr * 0.72, hc[1] + hr * 0.78], [hc[0] + s * hr * 0.98, hc[1] + hr * 0.62]], "#fff6e8");
    ell(ctx, [hc[0], hc[1] + hr * 0.55], hr * 0.5, hr * 0.38, 0, "#fff6e8");                              // 주둥이
    ctx.beginPath(); ctx.arc(hc[0], hc[1], hr * 1.04, 0, TAU); ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.stroke();
    ell(ctx, [hc[0], hc[1] + hr * 0.33], hr * 0.13, hr * 0.09, 0, "#2a1810");                             // 코
    gloss(ctx, [hc[0], hc[1] + hr * 0.3], hr * 0.2, 0.7);
    const bl = blinking(t);
    for (const s of [-1, 1]) {
      eye(ctx, [hc[0] + s * hr * 0.4, hc[1] - hr * 0.02], hr * 0.18, { iris: "#6a3d1e", out, mood, blink: bl, ry: 1.35 });
      ctx.strokeStyle = out; ctx.lineWidth = hr * 0.04; ctx.lineCap = "round";                           // 수염
      for (const d of [-0.07, 0.07]) { ctx.beginPath(); ctx.moveTo(hc[0] + s * hr * 0.75, hc[1] + hr * (0.5 + d)); ctx.lineTo(hc[0] + s * hr * 1.22, hc[1] + hr * (0.45 + d * 3)); ctx.stroke(); }
    }
    ctx.strokeStyle = out; ctx.lineWidth = hr * 0.06; ctx.beginPath();                                    // 입 (w)
    if (mood === "happy") { ctx.arc(hc[0], hc[1] + hr * 0.5, hr * 0.2, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke(); ctx.fillStyle = "#e8505a"; ctx.fill(); }
    else { ctx.arc(hc[0] - hr * 0.09, hc[1] + hr * 0.46, hr * 0.09, 0.1 * Math.PI, 0.95 * Math.PI); ctx.arc(hc[0] + hr * 0.09, hc[1] + hr * 0.46, hr * 0.09, 0.05 * Math.PI, 0.9 * Math.PI); ctx.stroke(); }
  },
};

// ---------- 볼트 (로봇) ----------
const BOLT = {
  out: "#1c2a4a", legTop: "#aebfe0", legBottom: "#8fa6d4", torsoA: "#dce8ff", torsoB: "#8fb2f0", armTop: "#aebfe0", armBottom: "#8fa6d4", knee: "#33466e", hem: 0.06,
  shoe(ctx, a, side, down, u, ow, dir) {
    const c = add(add(a, down, u * 0.09), side, dir * u * 0.05);
    ell(ctx, c, u * 0.21, u * 0.12, 0, "#4a6bb5", this.out, ow);
    ell(ctx, add(c, side, dir * u * 0.12), u * 0.09, u * 0.07, 0, "#ff9a3c");                              // 주황 발끝
    gloss(ctx, c, u * 0.2, 0.3);
  },
  torso(ctx, sk, o, k) {
    const u = sk.u, t = o.t ?? 0, mid = mix(sk.ls, sk.rs, 0.5), c = mix(mid, sk.hipMid, 0.38);
    // 패널 선 + 가슴 코어(깜빡이는 하늘색 불빛)
    ctx.strokeStyle = "rgba(28,42,74,.45)"; ctx.lineWidth = k.ow * 0.6; ctx.beginPath();
    ctx.moveTo(...add(mid, k.side, -u * 0.28)); ctx.lineTo(...add(sk.hipMid, k.side, -u * 0.2)); ctx.moveTo(...add(mid, k.side, u * 0.28)); ctx.lineTo(...add(sk.hipMid, k.side, u * 0.2)); ctx.stroke();
    const pulse = 0.75 + 0.25 * Math.sin(t * 4);
    circle(ctx, c, u * 0.2, "#33466e", this.out, k.ow);
    circle(ctx, c, u * 0.145, `rgba(111,246,255,${pulse})`);
    circle(ctx, c, u * 0.07, "#ffffff"); gloss(ctx, c, u * 0.2, 0.5);
    for (let i = -1; i <= 1; i++) circle(ctx, add(add(sk.hipMid, k.down, -u * 0.12), k.side, i * u * 0.14), u * 0.03, i === 0 ? "#ff9a3c" : "#6ff6ff");
    ctx.strokeStyle = "#ff9a3c"; ctx.lineWidth = k.ow * 1.1; ctx.beginPath(); ctx.moveTo(...add(sk.lh, k.side, -u * 0.14)); ctx.lineTo(...add(sk.rh, k.side, u * 0.14)); ctx.stroke();   // 주황 벨트
  },
  hand(ctx, w, e, u, ow, dir) {
    circle(ctx, w, u * 0.13, "#f4f8ff", this.out, ow); circle(ctx, w, u * 0.06, "#33466e"); gloss(ctx, w, u * 0.13, 0.5);
  },
  head(ctx, hc, hr, sk, o) {
    const { t = 0, mood = "normal" } = o, ow = Math.max(2, sk.u * 0.055), out = this.out, ang = frame(sk).ang;
    // 안테나
    const ab = [hc[0], hc[1] - hr * 0.85], at = [hc[0] + Math.sin(t * 3) * hr * 0.12, hc[1] - hr * 1.55];
    ctx.strokeStyle = out; ctx.lineWidth = hr * 0.14; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(ab[0], ab[1]); ctx.lineTo(at[0], at[1]); ctx.stroke();
    ctx.strokeStyle = "#aebfe0"; ctx.lineWidth = hr * 0.07; ctx.beginPath(); ctx.moveTo(ab[0], ab[1]); ctx.lineTo(at[0], at[1]); ctx.stroke();
    const glow = 0.6 + 0.4 * Math.sin(t * 5);
    circle(ctx, at, hr * 0.2, `rgba(255,154,60,${glow})`, out, ow * 0.8); gloss(ctx, at, hr * 0.2, 0.6);
    // 귀 볼트
    for (const s of [-1, 1]) { rrect(ctx, hc[0] + s * hr * 1.0 - hr * 0.12, hc[1] - hr * 0.22, hr * 0.24, hr * 0.5, hr * 0.1, "#8fa6d4", out, ow * 0.8); }
    // 머리 (둥근 네모) + 하이라이트
    const w = hr * 2.0, h = hr * 1.7, x = hc[0] - w / 2, y = hc[1] - h / 2;
    ctx.save(); ctx.translate(hc[0], hc[1]); ctx.rotate(ang * 0.6); ctx.translate(-hc[0], -hc[1]);
    ctx.beginPath(); ctx.roundRect(x, y, w, h, hr * 0.5); ctx.fillStyle = vgrad(ctx, y, y + h, "#f4f8ff", "#a9c2f3"); ctx.fill(); ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.stroke();
    // 얼굴 화면
    const sw = w * 0.82, sh = h * 0.62, sx = hc[0] - sw / 2, sy = hc[1] - sh / 2 + h * 0.03;
    rrect(ctx, sx, sy, sw, sh, hr * 0.32, "#14213d", out, ow * 0.7);
    const bl = blinking(t), led = "#6ff6ff";
    for (const s of [-1, 1]) {
      const ex = hc[0] + s * sw * 0.24, ey = sy + sh * 0.44;
      ctx.fillStyle = led;
      if (bl) rrect(ctx, ex - hr * 0.2, ey - hr * 0.03, hr * 0.4, hr * 0.07, hr * 0.03, led);
      else if (mood === "happy") { ctx.strokeStyle = led; ctx.lineWidth = hr * 0.11; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(ex, ey + hr * 0.08, hr * 0.17, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      else { rrect(ctx, ex - hr * 0.17, ey - hr * 0.22, hr * 0.34, hr * 0.44, hr * 0.12, led); rrect(ctx, ex - hr * 0.1, ey - hr * 0.15, hr * 0.1, hr * 0.12, hr * 0.04, "#ffffff"); }
    }
    ctx.strokeStyle = led; ctx.lineWidth = hr * 0.08; ctx.lineCap = "round"; ctx.beginPath();
    if (mood === "happy") ctx.arc(hc[0], sy + sh * 0.66, hr * 0.22, 0.1 * Math.PI, 0.9 * Math.PI); else { ctx.moveTo(hc[0] - hr * 0.16, sy + sh * 0.82); ctx.lineTo(hc[0] + hr * 0.16, sy + sh * 0.82); }
    ctx.stroke();
    ell(ctx, [hc[0] - sw * 0.34, y + h * 0.1], hr * 0.35, hr * 0.12, -0.3, "rgba(255,255,255,.55)");
    for (const s of [-1, 1]) ell(ctx, [hc[0] + s * sw * 0.42, sy + sh * 0.8], hr * 0.1, hr * 0.06, 0, "rgba(255,120,150,.7)");
    ctx.restore();
  },
};

// ---------- 루나 (마법사) ----------
const LUNA = {
  out: "#1f1245", legTop: "#4b3aa6", legBottom: "#3c2d8a", torsoA: "#7a5cff", torsoB: "#4a34c8", armTop: "#6a4cf0", armBottom: "#5a3fd8", hem: 0.2,
  shoe(ctx, a, side, down, u, ow, dir) {
    const c = add(add(a, down, u * 0.09), side, dir * u * 0.06);
    ell(ctx, c, u * 0.2, u * 0.12, 0, "#7a3b24", this.out, ow);
    rrect(ctx, c[0] - u * 0.07, c[1] - u * 0.06, u * 0.14, u * 0.09, u * 0.02, "#ffd84a", this.out, ow * 0.5);   // 금색 버클
    gloss(ctx, c, u * 0.2, 0.25);
  },
  back(ctx, sk, o, k) {
    // 망토 (몸 움직임에 살랑)
    const u = sk.u, t = o.t ?? 0, s0 = add(sk.ls, k.side, -u * 0.1), s1 = add(sk.rs, k.side, u * 0.1);
    const sway = Math.sin(t * 2.6) * 0.06 * u;
    const bl = add(add(sk.lh, k.down, u * 0.95), k.side, -u * 0.42 + sway), br = add(add(sk.rh, k.down, u * 0.95), k.side, u * 0.42 + sway);
    ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]);
    ctx.bezierCurveTo(add(s1, k.side, u * 0.45)[0], add(s1, k.down, u * 0.5)[1], add(br, k.side, u * 0.2)[0], add(br, k.down, -u * 0.3)[1], br[0], br[1]);
    const n = 5;
    for (let i = 1; i <= n; i++) { const f = i / n, p = mix(br, bl, f), wave = Math.sin(t * 3 + f * 6) * u * 0.05 + (i % 2 ? u * 0.06 : 0); ctx.lineTo(p[0], p[1] + wave); }
    ctx.bezierCurveTo(add(bl, k.side, -u * 0.2)[0], add(bl, k.down, -u * 0.3)[1], add(s0, k.side, -u * 0.45)[0], add(s0, k.down, u * 0.5)[1], s0[0], s0[1]);
    ctx.closePath(); ctx.fillStyle = vgrad(ctx, s0[1], bl[1], "#5a2fb8", "#2f1a78"); ctx.fill();
    ctx.lineWidth = k.ow; ctx.strokeStyle = this.out; ctx.lineJoin = "round"; ctx.stroke();
    // 별무늬 안감 느낌
    ctx.fillStyle = "rgba(255,216,74,.85)"; ctx.font = `${u * 0.2}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("✦", mix(s0, bl, 0.55)[0] + u * 0.1, mix(s0, bl, 0.55)[1]); ctx.fillText("✦", mix(s1, br, 0.65)[0] - u * 0.1, mix(s1, br, 0.65)[1] + u * 0.1);
  },
  torso(ctx, sk, o, k) {
    const u = sk.u, mid = mix(sk.ls, sk.rs, 0.5), hip = sk.hipMid;
    // 금색 단 + 가운데 줄 + 별 장식
    ctx.strokeStyle = "#ffd84a"; ctx.lineWidth = k.ow * 1.1; ctx.beginPath(); ctx.moveTo(k.bl[0], k.bl[1] - u * 0.03); ctx.lineTo(k.br[0], k.br[1] - u * 0.03); ctx.stroke();
    ctx.lineWidth = k.ow * 0.8; ctx.beginPath(); ctx.moveTo(...add(mid, k.down, u * 0.12)); ctx.lineTo(...add(hip, k.down, u * 0.1)); ctx.stroke();
    ctx.fillStyle = "#ffd84a"; ctx.font = `900 ${u * 0.3}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("★", ...add(mid, k.down, u * 0.22));
    circle(ctx, add(mid, k.down, -u * 0.02), u * 0.06, "#ffd84a", this.out, k.ow * 0.6);                       // 망토 단추
  },
  hand(ctx, w, e, u, ow) { circle(ctx, w, u * 0.11, "#ffd9b8", this.out, ow); gloss(ctx, w, u * 0.11, 0.35); },
  head(ctx, hc, hr, sk, o) {
    const { t = 0, mood = "normal" } = o, ow = Math.max(2, sk.u * 0.055), out = this.out, u = sk.u;
    // 긴 머리(뒤)
    const hairBack = (s) => poly(ctx, [[hc[0] + s * hr * 0.95, hc[1] - hr * 0.2], [hc[0] + s * hr * 1.15, hc[1] + hr * 1.5], [hc[0] + s * hr * 0.45, hc[1] + hr * 1.25], [hc[0] + s * hr * 0.2, hc[1]]], "#ff7fd1", out, ow);
    hairBack(-1); hairBack(1);
    ell(ctx, add(hc, [0, 1], hr * 0.08), hr * 0.95, hr * 0.92, 0, "#ffd9b8", out, ow * 0.9);                // 얼굴
    // 앞머리 (가운데 가르마)
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(hc[0], hc[1] - hr * 0.55);
      ctx.quadraticCurveTo(hc[0] + s * hr * 0.9, hc[1] - hr * 0.7, hc[0] + s * hr * 0.98, hc[1] + hr * 0.1);
      ctx.quadraticCurveTo(hc[0] + s * hr * 0.55, hc[1] - hr * 0.25, hc[0], hc[1] - hr * 0.55); ctx.closePath();
      ctx.fillStyle = "#ff7fd1"; ctx.fill(); ctx.lineWidth = ow * 0.7; ctx.strokeStyle = out; ctx.stroke();
    }
    const bl = blinking(t);
    for (const s of [-1, 1]) {
      eye(ctx, [hc[0] + s * hr * 0.36, hc[1] + hr * 0.2], hr * 0.2, { iris: "#7a4cff", out, mood, blink: bl, ry: 1.32 });
      ell(ctx, [hc[0] + s * hr * 0.62, hc[1] + hr * 0.52], hr * 0.15, hr * 0.09, 0, "rgba(255,110,150,.6)");
    }
    ctx.strokeStyle = out; ctx.lineWidth = hr * 0.065; ctx.lineCap = "round"; ctx.beginPath();
    if (mood === "happy") { ctx.arc(hc[0], hc[1] + hr * 0.5, hr * 0.24, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke(); ctx.fillStyle = "#c2434b"; ctx.fill(); }
    else { ctx.arc(hc[0], hc[1] + hr * 0.55, hr * 0.14, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    // 마법사 모자: 챙 + 휘어진 뾰족 모자 + 금색 띠 + 별
    const ho = [hc[0], hc[1] - hr * 0.78], wob = Math.sin(t * 2.4) * hr * 0.12;
    ell(ctx, ho, hr * 1.55, hr * 0.36, 0, "#4a2fc0", out, ow);
    const tip = [ho[0] + hr * 0.75 + wob, ho[1] - hr * 2.0];
    ctx.beginPath(); ctx.moveTo(ho[0] - hr * 0.95, ho[1] - hr * 0.05);
    ctx.quadraticCurveTo(ho[0] - hr * 0.5, ho[1] - hr * 1.2, tip[0] - hr * 0.05, tip[1]);
    ctx.quadraticCurveTo(ho[0] + hr * 0.3, ho[1] - hr * 1.0, ho[0] + hr * 0.95, ho[1] - hr * 0.05);
    ctx.quadraticCurveTo(ho[0], ho[1] + hr * 0.25, ho[0] - hr * 0.95, ho[1] - hr * 0.05); ctx.closePath();
    ctx.fillStyle = vgrad(ctx, tip[1], ho[1], "#7a5cff", "#4a2fc0"); ctx.fill(); ctx.lineWidth = ow; ctx.strokeStyle = out; ctx.stroke();
    ctx.strokeStyle = "#ffd84a"; ctx.lineWidth = hr * 0.22; ctx.beginPath(); ctx.moveTo(ho[0] - hr * 0.93, ho[1] - hr * 0.1); ctx.quadraticCurveTo(ho[0], ho[1] + hr * 0.2, ho[0] + hr * 0.93, ho[1] - hr * 0.1); ctx.stroke();
    ctx.fillStyle = "#ffd84a"; ctx.font = `900 ${hr * 0.6}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("★", ho[0] + hr * 0.08, ho[1] - hr * 0.78);
    // 반짝이 (떠다님)
    ctx.fillStyle = "rgba(255,240,170,.95)"; ctx.font = `${u * 0.2}px serif`;
    for (let i = 0; i < 3; i++) { const a = t * 1.3 + i * 2.1, r = hr * (2.0 + 0.3 * Math.sin(t * 2 + i)); ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + i * 2); ctx.fillText("✦", hc[0] + Math.cos(a) * r, hc[1] + hr * 0.2 + Math.sin(a) * r * 0.55); }
    ctx.globalAlpha = 1;
  },
};

const STYLES = { human: HARU, animal: TORI, robot: BOLT, fantasy: LUNA };
const KIND_OF = { haru: "human", tori: "animal", bolt: "robot", luna: "fantasy" };

/**
 * 캐릭터 그리기
 * @param id   "haru" | "tori" | "bolt" | "luna"
 * @param sk   character.js 의 뼈대 (화면 픽셀)
 * @param o    { t: 시간(초, 숨쉬기·깜빡임·꼬리), mood: "normal"|"happy", shadow: 바닥 그림자 여부(기본 true) }
 */
export function drawCharacter(ctx, id, sk, o = {}) {
  const S = STYLES[KIND_OF[id]];
  if (!S || !sk || !(sk.u > 8)) return;
  const t = o.t ?? 0, u = sk.u;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (o.shadow !== false) {                                                   // 바닥 그림자
    const fy = Math.max(sk.la[1], sk.ra[1]) + u * 0.17, fx = (sk.la[0] + sk.ra[0]) / 2;
    ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(fx, fy, u * 0.85, u * 0.1, 0, 0, TAU); ctx.fill();
  }
  const bob = Math.sin(t * 3) * u * 0.012;                                    // 숨쉬는 느낌
  const sk2 = bob ? { ...sk, head: [sk.head[0], sk.head[1] + bob] } : sk;
  drawBody(ctx, sk2, S, o);
  S.head(ctx, sk2.head, u * 0.4, sk2, o);
  if (o.mood === "happy") {                                                   // 기쁠 때 반짝
    ctx.font = `${u * 0.34}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const k = (t * 2) % 1; ctx.globalAlpha = 1 - k * 0.6;
    ctx.fillText("✨", sk.head[0] - u * 0.75, sk.head[1] - k * u * 0.25); ctx.fillText("✨", sk.head[0] + u * 0.75, sk.head[1] + u * 0.15 - k * u * 0.25);
  }
  ctx.restore();
}
