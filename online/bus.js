// 게임 <-> 온라인 사이의 얇은 연결점.
// 게임(main.js)은 "무슨 일이 일어났다"만 알리고(emit), 온라인 쪽(ui.js)이 그걸 듣기만 해요(on).
// 그래서 온라인 기능을 빼도 게임은 그대로 돌아가고, 게임 코드는 네트워크를 전혀 몰라요.
//
// 게임이 알리는 사건
//   game:start  { mode, online, seed }       한 판이 시작됨
//   game:score  { score, combo }             점수 변화 (약 0.25초마다)
//   game:end    { mode, score, maxCombo }    한 판이 끝남 (하트 소진/시간 종료)
//   game:quit   {}                           메뉴로 나감 (게임 중간 포기 포함)
// 온라인 화면이 게임에 요청하는 사건
//   online:rematch {}                        결과 화면에서 "재대결" 버튼을 누름
const target = new EventTarget();

export const bus = {
  /** 온라인 대결이 진행 중이면 true. 게임 쪽 버튼(다시 하기 등)의 동작이 달라져요. */
  onlineActive: false,
  emit(type, detail = {}) { target.dispatchEvent(new CustomEvent(type, { detail })); },
  on(type, fn) {
    const h = (e) => fn(e.detail);
    target.addEventListener(type, h);
    return () => target.removeEventListener(type, h);
  },
};
