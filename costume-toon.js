// 카툰풍 스프라이트 굽기: 커스튬 한 개를 "한 번만" 그려서 그림 한 장(캔버스)으로 저장해 둬요.
//  - 두꺼운 어두운 외곽선 + 위쪽 밝은 반사/아래쪽 그림자(셀 셰이딩) + 부드러운 바닥 그림자
//  - 매 프레임은 drawImage 한 번이면 끝: 모양 그리기·번쩍임(shadowBlur) 계산이 없어서 더 가벼워요.
// 움직이는 그림(오라·불꽃 등)은 굽지 않고 예전처럼 실시간으로 그려요 (main.js에서 판단).

const RES = 2.5;                       // 로컬 1단위 = 2.5픽셀로 구워요 (몸 크기 ×2 정도까지 선명)
const HALF_W = 140, HALF_H = 150;      // 굽는 영역: 앵커 기준 가로 ±140, 세로 ±150 단위
const OUTLINE = 2.4;                   // 외곽선 두께(단위)
const OUTLINE_COLOR = "#2d1b4e";

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 알파가 있는 픽셀의 경계 상자 (없으면 null) */
function alphaBounds(c) {
  const g = c.getContext("2d"), w = c.width, h = c.height;
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * @param drawLocal (ctx) => void  앵커 기준 로컬 좌표로 그리는 함수 (번쩍임 없이)
 * @param opts.outline  외곽선+셀 셰이딩 사용 여부 (PNG 일러스트는 false: 그림 그대로 + 바닥 그림자만)
 * @returns {{cv, x, y, w, h}} 로컬 단위 기준 위치/크기. ctx.drawImage(cv, x, y, w, h) 로 그리면 돼요. 그릴 게 없으면 null
 */
export function bakeToon(drawLocal, opts = {}) {
  const outline = opts.outline !== false;
  const W = HALF_W * 2 * RES, H = HALF_H * 2 * RES;
  const src = makeCanvas(W, H), g = src.getContext("2d");
  g.translate(W / 2, H / 2); g.scale(RES, RES);
  g.imageSmoothingQuality = "high";
  drawLocal(g);
  g.setTransform(1, 0, 0, 1, 0, 0);

  const b = alphaBounds(src);
  if (!b) return null;

  // 셀 셰이딩: 위쪽은 밝게, 아래쪽은 살짝 어둡게 (이미 그려진 부분 위에만)
  if (outline) {
    g.globalCompositeOperation = "source-atop";
    const gr = g.createLinearGradient(0, b.y, 0, b.y + b.h);
    gr.addColorStop(0, "rgba(255,255,255,0.30)"); gr.addColorStop(0.42, "rgba(255,255,255,0)");
    gr.addColorStop(1, "rgba(30,10,60,0.22)");
    g.fillStyle = gr; g.fillRect(b.x, b.y, b.w, b.h);
    g.globalCompositeOperation = "source-over";
  }

  const pad = Math.ceil((OUTLINE + 4) * RES);          // 외곽선 + 그림자가 들어갈 여백
  const out = makeCanvas(b.w + pad * 2, b.h + pad * 2), o = out.getContext("2d");
  o.imageSmoothingQuality = "high";

  // 실루엣(단색) 만들기
  const sil = makeCanvas(b.w, b.h), s = sil.getContext("2d");
  s.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  s.globalCompositeOperation = "source-in"; s.fillStyle = outline ? OUTLINE_COLOR : "#000"; s.fillRect(0, 0, b.w, b.h);

  // 바닥 그림자 (아래로 살짝, 흐릿한 느낌은 투명도로)
  o.globalAlpha = outline ? 0.28 : 0.22;
  o.drawImage(sil, pad, pad + 3 * RES);
  o.globalAlpha = 1;
  if (outline) {
    const r = OUTLINE * RES;
    for (let i = 0; i < 14; i++) {                      // 14방향으로 밀어 그려 두꺼운 외곽선
      const a = (i / 14) * Math.PI * 2;
      o.drawImage(sil, pad + Math.cos(a) * r, pad + Math.sin(a) * r);
    }
  }
  o.drawImage(src, b.x, b.y, b.w, b.h, pad, pad, b.w, b.h);

  return {
    cv: out,
    x: (b.x - pad - W / 2) / RES, y: (b.y - pad - H / 2) / RES,
    w: out.width / RES, h: out.height / RES,
  };
}
