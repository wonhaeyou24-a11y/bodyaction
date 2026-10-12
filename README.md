# KINETIC KABOOM — 손과 몸으로 놀자!

카메라 앞에서 손과 몸으로 즐기는 가족용 모션 아케이드 웹앱이에요. 영상은 이 기기 밖으로 나가지 않아요(브라우저 안에서만 인식).

## 실행

```bash
# 이 폴더에서 정적 서버를 켜고 http://localhost:8080 으로 접속 (카메라는 localhost/HTTPS에서만 켜져요)
python -m http.server 8080        # 또는 시작.bat (Windows)
```

- 인식은 MediaPipe(손/포즈)를 CDN과 Google 저장소에서 내려받아 써요. 처음 한 번은 인터넷이 필요해요.
- 주소 끝에 `?cpu` 를 붙이면 GPU 대신 CPU로 인식해요(GPU에서 인식이 안 될 때).
- 주소 끝에 `?seconds=8` 처럼 붙이면 한 판을 짧게(5~60초) 시험할 수 있어요.

## 게임 (13개)

손놀이(8): 풍선 팡팡 · 과일 닌자 · 우주 유성 막기 · 네온 벽돌깨기 · 쿵푸 펀치 도장 · 매직 드로잉 · 2인 풍선 대결 · 스피드 펀치 백  
몸놀이(5): 바위 피하기 · 아스트로 점프 러너 · 포즈 미믹 · 네온 노트 슬래시(리듬) · 모션 키퍼(골키퍼)

## 주요 기능

- **비동기 AI 엔진**: 손/몸 인식을 작업자(Web Worker)에서 돌려 인식 중에도 화면이 멈추지 않음 (`vision-worker.js`, `vision-client.js`). 게임 중 HUD에 실제 fps·초당 AI 횟수·인식 시간 표시. `?noworker`로 예전 방식
- 게임별 **등급 기준**(`main.js`의 `RANK_THRESHOLDS`) · 게임별 **TOP 10 순위표**(내 기록 / 가족 전체)
- **가족 프로필**: 사람마다 닉네임·아바타·기록을 따로 저장 (`profiles.js`)
- **첫 실행 안내**: 카메라 위치·밝기·손/몸 인식 확인 (`guide.js`)
- **온라인 대결 준비**: 비공개 방·초대 코드·같은 판 대결·재대결 구조 (`online/`, 지금은 같은 컴퓨터의 다른 탭끼리 연결. 자세한 건 `online/README.md`)

## 폴더

```
index.html / style.css / main.js   게임 본체 (화면, 게임 로직)
profiles.js                        가족 프로필 저장 규칙 (화면 없음)
guide.js                           카메라 세팅 안내 + 판정 규칙
online/                            온라인 대결 (bus, room, protocol, transport, ui) — 게임 로직과 분리
test/, online/test/                Node 단독 테스트
design-reference/                  디자인 참고 자료(앱에는 쓰이지 않음)
assets/                            이미지, 음원
```

## 테스트 (고칠 때마다 꼭 실행: 예전보다 나빠지면 안 돼요)

```bash
node test/run-all.js              # 아래 묶음을 한 번에 실행 (하나라도 실패하면 종료 코드 1)
```

- `test/tracker.test.js` 손/관절 위치 추적: 튐, 지연, 휘두름 속도를 **예전 방식과 나란히 비교**
- `test/punch.test.js` 샌드백 펀치 판정: 가만히/천천히 움직일 때 헛펀치 0번, 진짜 펀치는 인식, 연타 제한
- `test/profiles.test.js`, `test/guide.test.js`, `online/test/room.test.js`

## 성능 점검 (속도·인식이 떨어지지 않았는지)

1. 게임 중 HUD에 실측값이 보여요: `화면 52fps · AI 17회/초 · 33ms 작업자 GPU` (고치기 전후로 비교)
2. 같은 조건으로 두 버전을 나란히 재려면 `test/browser-bench.js`를 쓰세요. 예전 커밋은
   `git worktree add /tmp/prev <커밋>` 후 다른 포트로 띄우고, 빈 페이지(`/assets/`)의 콘솔에서 실행해요.
   가짜 카메라 영상으로 프레임 처리 시간(평균·99%·최악)과 fps를 재서, **평균/99% 시간이 늘지 않았는지** 확인해요.
3. 기준값(2026-10-12, 가짜 카메라, 손 인식 게임): 프레임 평균 약 1ms, 99% 5ms 이하, 최악 25ms 이하

