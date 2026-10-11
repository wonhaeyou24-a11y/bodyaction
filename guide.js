// 첫 실행 안내(카메라 세팅): 위치/밝기 안내 + 실제로 손/몸이 잘 보이는지 확인해 주는 3단계 창.
// 판단 규칙(judge*)은 화면을 모르는 순수 함수라서 Node로 테스트할 수 있어요 (node test/guide.test.js).
// 카메라/인식 모델은 main.js가 hooks로 넘겨 줘요 (이 파일은 카메라를 직접 켜지 않아요).

export const GUIDE_KEY = "kk_setup_done_v1";

/** 밝기(0~255 평균) 판정 */
export function judgeBrightness(avg) {
  if (!Number.isFinite(avg)) return { level: "none", text: "밝기를 확인하는 중…" };
  if (avg < 55) return { level: "bad", text: "너무 어두워요 💡 불을 켜 주세요" };
  if (avg < 85) return { level: "warn", text: "조금 어두워요. 불을 더 켜면 잘 보여요" };
  if (avg > 225) return { level: "warn", text: "너무 밝아요. 창문 빛이 뒤에서 오지 않게 해 주세요" };
  return { level: "ok", text: "밝기가 좋아요 ✅" };
}

/** 손 인식 결과 판정. hands = 손마다 21개 점 [{x,y}] (0~1 정규화 좌표) */
export function judgeHand(hands) {
  if (!Array.isArray(hands) || hands.length === 0 || !hands[0]?.[9]) {
    return { level: "none", text: "손바닥을 펴서 카메라에 보여 주세요 ✋" };
  }
  const h = hands[0];
  const size = Math.hypot(h[0].x - h[9].x, h[0].y - h[9].y);          // 손목~가운데 손가락 뿌리
  if (size < 0.07) return { level: "far", text: "조금 더 가까이 와 주세요" };
  if (size > 0.4) return { level: "close", text: "조금 뒤로 가 주세요" };
  return { level: "ok", text: "손이 잘 보여요! ✋" + (hands.length > 1 ? " (두 손 모두)" : "") };
}

/** 몸 인식 결과 판정. lm = 33개 점 [{x,y,visibility}] (0~1 정규화 좌표) */
export function judgeBody(lm) {
  if (!Array.isArray(lm) || lm.length < 29) return { level: "none", text: "카메라 앞에 서 주세요 🧍" };
  const vis = (i) => lm[i]?.visibility ?? 0;
  const inFrame = (i) => !!lm[i] && lm[i].x > 0.02 && lm[i].x < 0.98 && lm[i].y > 0 && lm[i].y < 1;
  const seen = (ids) => ids.every((i) => vis(i) > 0.5 && inFrame(i));
  if (!seen([0, 11, 12])) return { level: "none", text: "얼굴과 어깨가 보이게 서 주세요" };
  if (!seen([25, 26, 27, 28])) return { level: "partial", text: "한두 걸음 뒤로! 발끝까지 보여야 해요" };
  const height = Math.max(lm[27].y, lm[28].y) - lm[0].y;
  if (height < 0.45) return { level: "far", text: "조금 더 가까이 와 주세요" };
  return { level: "ok", text: "전신이 잘 보여요! 👍" };
}

/** 영상 한 장의 평균 밝기(0~255)를 작은 캔버스로 재요 */
export function measureBrightness(video, canvas) {
  try {
    const w = 32, h = 24;
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext("2d", { willReadFrequently: true });
    c.drawImage(video, 0, 0, w, h);
    const d = c.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  } catch { return NaN; }
}

/**
 * 안내 창 화면. hooks:
 *   startCamera(kind) -> Promise<boolean>   kind: "hand" | "body"  (카메라+인식 모델 준비)
 *   stopCamera()                            카메라 끄기
 *   getStream() -> MediaStream | null       미리보기용
 *   detect(kind) -> hands[] | landmarks[] | null
 */
export function initSetupGuide(hooks) {
  const $ = (id) => document.getElementById(id);
  const modal = $("guideModal");
  if (!modal) return null;
  const STEPS = 3;
  let step = 1, kind = "hand", timer = null, running = false;

  const show = (el, on = true) => el?.classList.toggle("hidden", !on);
  const markDone = () => { try { localStorage.setItem(GUIDE_KEY, "1"); } catch { /* 저장 못 해도 계속 */ } };

  function render() {
    document.querySelectorAll("#guideModal [data-step]").forEach((s) => show(s, +s.dataset.step === step));
    document.querySelectorAll("#guideDots i").forEach((d, i) => d.classList.toggle("on", i + 1 === step));
    $("guidePrev").disabled = step === 1;
    $("guideNext").textContent = step === STEPS ? "✅ 끝내기" : "다음 ▶";
  }
  function setChip(id, res) {
    const el = $(id); if (!el) return;
    el.textContent = res.text; el.dataset.level = res.level;
  }

  function stopLoop() { clearInterval(timer); timer = null; running = false; const v = $("guideVideo"); if (v) v.srcObject = null; show($("guidePreviewWrap"), false); }
  function closeModal() { stopLoop(); hooks.stopCamera(); show(modal, false); markDone(); }
  function open() { step = 1; setChip("guideBright", { level: "none", text: "카메라를 켜면 확인해요" }); setChip("guideDetect", { level: "none", text: "카메라를 켜면 확인해요" }); show(modal, true); render(); }

  async function startTest() {
    stopLoop();
    $("guideStart").disabled = true;
    setChip("guideDetect", { level: "none", text: "카메라를 켜는 중… (처음엔 조금 걸려요)" });
    const ok = await hooks.startCamera(kind);
    $("guideStart").disabled = false;
    if (!ok) { setChip("guideDetect", { level: "bad", text: "카메라를 쓸 수 없어요. 허용했는지 확인해 주세요" }); return; }
    const v = $("guideVideo"); v.srcObject = hooks.getStream(); v.play?.().catch(() => {});
    show($("guidePreviewWrap"), true);
    running = true;
    let tick = 0;
    timer = setInterval(() => {
      if (!running) return;
      const src = $("guideVideo");
      if (src.readyState < 2) return;
      if (tick++ % 4 === 0) setChip("guideBright", judgeBrightness(measureBrightness(src, $("guideCanvas"))));
      const res = hooks.detect(kind);
      setChip("guideDetect", kind === "body" ? judgeBody(res) : judgeHand(res));
    }, 150);
  }

  $("btnSetupGuide")?.addEventListener("click", open);
  $("guideClose")?.addEventListener("click", closeModal);
  $("guideSkip")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  $("guidePrev")?.addEventListener("click", () => { if (step > 1) { step--; if (step < 3) { stopLoop(); hooks.stopCamera(); } render(); } });
  $("guideNext")?.addEventListener("click", () => { if (step < STEPS) { step++; render(); } else closeModal(); });
  $("guideStart")?.addEventListener("click", startTest);
  document.querySelectorAll("#guideModal [data-kind]").forEach((b) => b.addEventListener("click", () => {
    kind = b.dataset.kind;
    document.querySelectorAll("#guideModal [data-kind]").forEach((x) => x.classList.toggle("active", x === b));
    if (running) startTest();                      // 테스트 중에 손/몸을 바꾸면 바로 다시 확인
  }));

  return { open, close: closeModal, shouldAutoOpen: () => { try { return !localStorage.getItem(GUIDE_KEY); } catch { return false; } } };
}
