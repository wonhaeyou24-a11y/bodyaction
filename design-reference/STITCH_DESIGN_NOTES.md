# Stitch 디자인 시스템 및 프로젝트 상세 분석 보고서

> **Stitch 프로젝트 정보**
> - **프로젝트 리소스 ID**: `projects/2433221128680868293`
> - **프로젝트명(타이틀)**: 생동감 넘치는 모션 액션 게임 - 손과 몸으로 놀자! (Kinetic Kaboom)
> - **디자인 테마 이름**: Kinetic Arcade Party
> - **기본 모드**: Dark Mode (깊은 셀레스티얼 퍼플 기반)
> - **조회 일시**: 2026-10-11
> - **주의 사항**: 본 문서는 Stitch MCP를 통해 실제 조회된 디자인 데이터 및 HTML/CSS 코드를 기반으로 작성되었으며, 조회되지 않은 요소는 미확인으로 명시하였습니다.

---

## 1. 적용할 화면의 레이아웃 (Layout)

### 1-1. 메인 아케이드 허브 화면 (`screens/eab7ad3d03644660b20fa81cf3ef7b8a`)
- **전체 구조**: 상단 고정 바(Top App Bar) + 카테고리 필터 서브 내비게이션 + 대형 히어로 쇼케이스(Hero Spotlight Bento Banner) + 스테이지 선택 그리드(Stage Selection Bento Grid) + 플로팅 파티 로비 독.
- **최대 너비 및 정렬**: `max-w-7xl` (1280px), `mx-auto`, 반응형 패딩 `px-space-md md:px-margin`.
- **히어로 섹션 (Hero Showcase)**:
  - 벤토 그리드(Bento Grid) 스타일 대형 카드 (`glass-candy-card`, `rounded-3xl`, 패딩 `p-6 md:p-8`).
  - 좌측(컨텐츠): 파티 스포트라이트 배지, 대형 타이포그래피 타이틀, 게임 설명, 베스트 레코드/센서 상태 티커, 듀얼 CTA 액션 버튼.
  - 우측(비주얼 포털): 420px 너비, 높이 256~288px의 3D 게임 월드 뷰포트 프리뷰 (16:9 프레임, 60 FPS 뱃지 오버레이).
- **스테이지 선택 그리드 (Stage Selection Grid)**:
  - 반응형 그리드: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`.
  - 6개 이상의 인터랙티브 토이 글래스 카드 배치.

### 1-2. 인게임 라이브 모션 HUD 화면 (`screens/3bc60af9228f401fb34ca61f0c8e2c96`)
- **전체 구조**: 16:9 뷰포트 종횡비 (`aspect-[16/9]`, `min-h-[560px]`, `max-h-[720px]`, `rounded-3xl` 외곽 프레임).
- **상단 서브 헤더 (Telemetry Ribbon)**:
  - 스테이지 명칭 태그 + 60.0 FPS 고정 락 센서 뱃지 + 실시간 점수(Live Score) / 펀치 횟수(Hit Count) / 케이던스(PPM) / 남은 시간(0:38) / 하트 라이프(3개).
- **중앙 상단**: 플로팅 조작 가이드 알약 배너 (예: "양손으로 샌드백을 리듬에 맞춰 연속 타격하세요!").
- **상단 우측**: 실시간 웹캠 미니 PIP (256x140px, 녹색 네온 보더, 광학 뼈대 스켈레톤 와이어프레임 및 추적 신뢰도 99.4% 표시).
- **상단 좌측**: -2° 각도로 틸트된 플로팅 콤보/피버 배지 (`48x COMBO!`, 50x 메가 블래스트 충전 바).
- **하단 좌/우측**: 듀얼 손 속도(km/h, PSI) 텔레메트리 독 및 하이퍼 오버드라이브 게이지 트랙.

---

## 2. 사이드바와 상단 메뉴 (Sidebar & Top Navigation)

### 2-1. 사이드바 (Sidebar)
- **실제 디자인 확인 결과**: **별도의 좌측/우측 고정 사이드바는 존재하지 않음 (미존재)**.
- **설계 의도**: 거실 TV(10-Foot UI) 및 카메라 모션 게임의 특성상, 화면 좌우를 가로막는 수직 사이드바 대신 상단 바(Top App Bar)와 가로 스크롤형 칩(Horizontal Filter Chips)을 채택하여 게임 캔버스 면적을 100% 확보함.

### 2-2. 상단 메뉴 (Top App Bar & Sub-Nav)
- **Top App Bar (`<header>`)**:
  - `sticky top-0 z-50`, `bg-surface/80`, `backdrop-blur-xl`, 은은한 시안 글로우 그림자 `shadow-[0_8px_32px_rgba(0,210,255,0.2)]`.
  - **좌측 (브랜드 영역)**:
    - 48x48px 둥근 사각형 그라데이션 마스코트 아이콘 (번개 볼트 `bolt` 아이콘 + 펄스 핑 애니메이션).
    - 메인 로고 텍스트: `KINETIC KABOOM` (`Rubik 900`, 대문자, 시안 글로우).
    - 서브 텍스트: `FAMILY MOTION ARCADE` 배지 + `2.4 GHz Ultra-Sync`.
  - **중앙 (모션 센서 진단 HUD 알약)**:
    - 원형 미니 웹캠 PIP (`#22C55E` 라임 보더 + `accessibility_new` 아이콘).
    - 센서 상태 텍스트: `LIVE MOTION SENSOR` (녹색 점멸등) + `Full Body • 60 FPS • Calibrated`.
    - 캘리브레이션 퀵 버튼: `Calibrate` (`videocam` 아이콘 포함).
  - **우측 (유저 리워드 및 프로필)**:
    - 스타 카운터: ⭐ `4,850` (골드 텍스트 칩).
    - 티켓 카운터: 🎟️ `120` (마젠타 텍스트 칩).
    - 오디오 토글 원형 버튼 (`volume_up`).
    - 플레이어 아바타 배지: 마스코트 캐릭터 원형 이미지 + 레벨 14 배지 + `P1 Leo / Party Leader`.
- **Sub-Nav Bar (카테고리 필터 칩)**:
  - 가로 정렬 필터 버튼 칩:
    - `⭐ All Games (6)` (활성: 시안 솔리드 + 입체 그림자).
    - `👋 Hand Swipes`
    - `🏃 Full Body Jump`
    - `🤝 Co-op Party`
    - `⚡ 60s Blitz`
  - 룸 PIN 코드: `Room PIN: KABOOM-88` + `Party (2P)` 핑크 액션 버튼.

---

## 3. 색상, 폰트, 여백 (Design Tokens)

### 3-1. 색상 팔레트 (Color Tokens)
| 역할 | 토큰명 | HEX 코드 | 설명 및 용도 |
| :--- | :--- | :--- | :--- |
| **Canvas Base** | `background`, `surface` | `#190B30` | 딥 셀레스티얼 바이올렛 (야간 아케이드 베이스) |
| **Surface Low** | `surface-container-lowest` | `#14062B` | 가장 어두운 카드/뷰포트 베이스 |
| **Surface High** | `surface-container-high` | `#312348` | 버튼 및 칩 기본 배경 |
| **Surface Highest** | `surface-container-highest` | `#3C2E54` | 보더 및 게이지 트랙 배경 |
| **Primary** | `primary-container` | `#00D2FF` | 일렉트릭 시안 (주요 포커스, 1P 트래커, 액티브 버튼) |
| **Primary Light** | `primary` | `#A5E7FF` | 고휘도 시안 하이라이트 |
| **Secondary** | `secondary-container` | `#E1037D` / `#FF2E93` | 버블검 마젠타 (강렬한 CTA, 2P 트래커, 피버 타임) |
| **Secondary Light**| `secondary` | `#FFB0C9` | 보조 핑크 텍스트 및 뱃지 |
| **Tertiary** | `tertiary-container` | `#FBB500` / `#FFB800` | 래디언트 골드 (별점, 코인, 콤보 배수) |
| **Tertiary Light** | `tertiary` | `#FFD894` | 골드 텍스트 및 림 라이트 |
| **Success/Sensor** | `motion-active` | `#22C55E` / `#10B981` | 라임 스플래시 (카메라 센서 연결, 60 FPS 락) |
| **Text Main** | `on-surface` | `#ECDCFF` | 밝은 라벤더 화이트 본문 |
| **Text Dim** | `on-surface-variant` | `#BBC9CF` | 메탈릭 딤 그레이 보조 텍스트 |

### 3-2. 타이포그래피 (Typography)
- **헤드라인 & 아케이드 라벨**: `Rubik` (Bold 700 / ExtraBold 800 / Black 900)
  - `display-hero`: 56px / Line Height 64px / Letter Spacing -0.02em / Weight 900
  - `display-hero-mobile`: 36px / Line Height 44px / Letter Spacing -0.01em / Weight 900
  - `headline-lg`: 38px / Line Height 48px / Letter Spacing -0.01em / Weight 800
  - `headline-md`: 26px / Line Height 34px / Letter Spacing 0em / Weight 800
  - `headline-sm`: 20px / Line Height 28px / Letter Spacing 0em / Weight 700
  - `label-badge`: 14px / Line Height 16px / Letter Spacing +0.05em / Weight 900 (All Caps)
  - `label-sensor`: 12px / Line Height 14px / Letter Spacing +0.08em / Weight 800 (All Caps)
- **본문 및 설명문**: `Nunito Sans` (SemiBold 600 / Bold 700)
  - `body-lg`: 18px / Line Height 26px / Weight 700
  - `body-md`: 16px / Line Height 24px / Weight 600
  - `body-sm`: 14px / Line Height 20px / Weight 600

### 3-3. 여백 및 스페이싱 (Spacing Tokens)
- `margin`: Desktop 2.5rem (40px) / Mobile 1.25rem (20px)
- `gutter`: Desktop 1.5rem (24px) / Mobile 1rem (16px)
- `space-xs`: 0.375rem (6px)
- `space-sm`: 0.75rem (12px)
- `space-md`: 1.25rem (20px)
- `space-lg`: 2rem (32px)
- `space-xl`: 3rem (48px)

### 3-4. 모서리 곡률 (Border Radius Tokens)
- `sm`: 0.5rem (8px)
- `DEFAULT`: 1rem (16px)
- `lg`: 2rem (32px)
- `xl`: 3rem (48px)
- `full`: 9999px (완전한 타원 알약형 Pill)

---

## 4. 버튼, 입력창, 카드, 패널 (UI Components)

### 4-1. 버튼 (Tactile 3D Jelly Candy Push Buttons)
- **형태 구조**: 완전한 알약형(`rounded-full`), 하단 솔리드 3D 베벨 그림자 + 상단 광택 그라데이션.
- **3D 입체 그림자 명세**:
  - **시안 플레이 버튼**:
    ```css
    box-shadow: 0 6px 0 #008db3, 0 12px 24px rgba(0, 210, 255, 0.4);
    ```
  - **마젠타 드롭인 버튼**:
    ```css
    box-shadow: 0 6px 0 #8e004c, 0 12px 24px rgba(225, 3, 125, 0.45);
    ```
  - **골드 챌린지 버튼**:
    ```css
    box-shadow: 0 6px 0 #936300, 0 10px 20px rgba(251, 181, 0, 0.4);
    ```
- **눌림(Active / Pressed) 인터랙션**:
  - `transform: translateY(4px)`로 물리적 하강.
  - 그림자가 `0 2px 0`으로 압축되어 실제 오락실 볼록 버튼을 누르는 듯한 쫀득한 타격 피드백 제공.
- **원형 유틸리티 버튼**: 40x40px 또는 44x44px (`rounded-full`, 보더 `1px solid rgba(0,210,255,0.3)`).

### 4-2. 입력창 (Input Fields)
- **실제 디자인 확인 결과**: **일반 텍스트 입력 폼 필드는 디자인에 포함되어 있지 않음 (미확인/미존재)**.
- **대체 컨트롤**: 방 PIN 코드는 읽기 전용 뱃지로 노출되며, 정렬은 `SORT: POPULAR FIRST` 드롭다운 칩 버튼으로 처리됨.

### 4-3. 카드 (Glassmorphic Candy Stage Cards)
- **기본 구조**:
  ```css
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 100%);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1.5px solid rgba(255, 255, 255, 0.22);
  border-radius: 1.5rem (24px);
  ```
- **상단 뷰포트 포털**:
  - 높이 192px (`h-48`), `rounded-t-2xl`, 3D 액션 그래픽 이미지 내장.
  - 상단 좌측: 모션 제스처 배지 (`👋 Hand Swipes`, `⚔️ Dual Hand Slices` 등).
  - 상단 우측: 난이도 별점 배지 (⭐ 1~3개 골드/그레이).
  - 하단 좌측: 스테이지 마스코트 알약 (`🐧 Penny Penguin Host` 등).
- **하단 바디**:
  - 스테이지 명칭 (`Rubik 800`), 2줄 설명문 (`Nunito Sans 600`).
  - 최고 점수 바: 🏆 `Best Score: 24,500 Pts` (어두운 컨테이너 박스).
  - 액션 그룹: `PLAY NOW` 3D 버튼 + `2P Co-op` 원형 버튼.
- **호버 인터랙션**: `hover:-translate-y-2`, `hover:shadow-[0_16px_32px_rgba(0,210,255,0.3)]`, 테두리 네온 점등.

### 4-4. 패널 (Bento Panels & Telemetry Pods)
- **히어로 벤토 패널**: `rounded-3xl`, 두께 2px의 네온 시안/마젠타 그라데이션 보더, 어두운 방사형 그라데이션 오버레이.
- **인게임 텔레메트리 팟 (Telemetry Pod)**:
  - 어두운 배경 `rgba(20, 6, 43, 0.85)` + 블러 `blur(14px~16px)`.
  - 좌측 시안 라이트 바 / 우측 마젠타 라이트 바 내장.
  - 실시간 수치(속도 km/h, 파워 PSI, 콤보 히트 스트릭)를 거대하고 선명하게 표시.

---

## 5. 화면 크기별 반응형 배치 (Responsive Breakpoints)

| 항목 | 데스크톱 / 대형 TV (`>= 1200px`) | 태블릿 / 중형 화면 (`768px ~ 1199px`) | 모바일 (`<= 767px`) |
| :--- | :--- | :--- | :--- |
| **그리드 컬럼** | 12 컬럼 (스테이지 카드 3열 배치) | 8 컬럼 (스테이지 카드 2열 배치) | 4 컬럼 (스테이지 카드 1열 수직 스택) |
| **바깥 여백 (Margin)** | `2.5rem` (40px) | `1.5rem` (24px) | `1.25rem` (20px) |
| **카드 간격 (Gutter)** | `1.5rem` (24px) | `1.25rem` (20px) | `1rem` (16px) |
| **히어로 배너** | 좌(컨텐츠) / 우(420px 프리뷰) 가로 2분할 | 세로 스택 (프리뷰 상단/하단 전환) | 단일 세로 스택, 높이 컴팩트 축소 |
| **히어로 폰트 크기** | `56px` (`display-hero`) | `44px` | `36px` (`display-hero-mobile`) |
| **상단 내비게이션 바**| 센서 HUD 뱃지 및 프로필 클러스터 전체 노출 | 센서 HUD 뱃지 간소화 | 보조 카운터 숨김 (`hidden sm:flex`), 필수 로고만 노출 |

---

## 6. 디자인에 포함된 이미지와 아이콘 (Assets & Icons)

### 6-1. 아이콘 시스템 (Material Symbols & Emojis)
- **기본 아이콘 폰트**: Google `Material Symbols Outlined` (가변 폰트: `FILL 0~1`, `wght 400~900`).
- **주요 아이콘 목록**:
  - `bolt`: 브랜드 심볼, 번개, 케이던스
  - `accessibility_new`: 전신 모션 감지 센서
  - `videocam`: 웹캠 연결 및 카메라 보정
  - `sports_esports`: 게임 시작, 컨트롤러
  - `volume_up`: 사운드 및 BGM 설정
  - `star`: 난이도 및 획득 스타 평점
  - `monetization_on`: 코인 리워드
  - `confirmation_number`: 아케이드 티켓
  - `sports_mma` / `fitness_center`: 복싱 샌드백, 펀치 타격
  - `local_fire_department` / `whatshot`: 피버 타임, 불꽃 콤보
  - `group` / `group_add`: 2인 협동(Co-op) 모드
- **시각적 마스코트 이모지**:
  - 🐧 (펭귄 호스트 - 풍선 터트리기)
  - 🐱 (닌자 캣 - 과일 베기)
  - 🦔 (두더지 - 두더지 잡기)
  - 🐯 (호랑이 사부 - 쿵푸 펀치 도조)
  - 🐰 (우주 토끼 - 천체 점프 러너)

### 6-2. 디자인 내 포함된 실제 이미지 (3D Render Images)
- **마스코트 프로필 아바타**: 고글을 착용하고 귀가 보라색으로 빛나는 3D 디즈니/픽사 스타일 코스믹 로봇 마스코트.
- **히어로 프리뷰 3D 비주얼**: 네온 메테오와 레이저 허들을 뛰어넘는 우주 토끼 & 로봇 액션 장면.
- **스테이지별 3D 게임 월드 썸네일 (Unreal Engine 5 스타일)**:
  1. `Balloon Pop Carnival`: 축제 안경을 쓴 펭귄과 네온 파스텔 헬륨 풍선.
  2. `Fruit Splash Ninja`: 가라테 도복을 입고 공중에서 수박과 파인애플을 베는 고양이.
  3. `Whack-a-Mole Mania`: 선글라스를 끼고 파이프에서 솟아오르는 장난꾸러기 두더지.
  4. `Kung Fu Punch Dojo`: 드래곤 청록색 오라를 두르고 펀치/킥 콤보를 날리는 호랑이.
  5. `Astro Jump Runner`: 달 표면 네온 허들을 점프하는 우주 토끼.
- **인게임 3D 아레나 배경**:
  - `Speed Punching Bag`: 네온 링 로프, 3D 크롬 샌드백, 볼류메트릭 스포트라이트가 쏟아지는 사이버 복싱 경기장 1인칭 시점 배경.
  - `Neon Note Slash`: 소실점으로 빨려 들어가는 네온 사이버 터널 및 듀얼 플라즈마 에너지 세이버 궤적.

---

## 7. 미확인 요소 (Unverified Elements)
- **일반 텍스트 입력창 (Form Input)**: 모션 제스처 기반 게임 특성상 가상 키보드나 텍스트 인풋 컴포넌트는 실제 Stitch 디자인에 포함되어 있지 않음 (미확인).
- **결제 및 상점 모달 (Store/Checkout)**: 티켓/코인 수치는 상단 바에 존재하나, 세부 교환 상점 화면은 프로젝트에 미포함 (미확인).
- **다국어 언어 변경 드롭다운**: 한국어/영어 혼용 표기 외 별도 언어 선택기는 미확인.
