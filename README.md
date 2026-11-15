# J's WM RESEARCH DESK

PB(프라이빗 뱅커)가 손님에게 전달할 **장 개장 전(모닝/글로벌) · 장 종료 후(이브닝/국내)** 데일리 마켓 브리핑을
자동으로 만들어주는 정적 웹 포털입니다. GitHub Actions가 서버사이드에서 시세·뉴스를 수집하고 Gemini API(또는
Claude API)로 핵심 요약을 생성해 `data/*.json`에 저장하면, GitHub Pages가 그 데이터를 읽는 정적 페이지를 서빙합니다.

이전 버전(브라우저에서 공개 CORS 프록시로 실시간 스크래핑)을 처음부터 다시 설계했습니다. 왜, 무엇이
바뀌었는지는 맨 아래 [기존 버전과 달라진 점](#기존-버전과-달라진-점--종합-제언-반영) 참고.

---

## 1. 아키텍처 한 장 요약

```
[GitHub Actions: 06:30 KST]        [GitHub Actions: 16:05 KST]
 모닝(글로벌) 데이터 수집            이브닝(국내) 데이터 수집
   ├─ 핵심 지표 6종 시세(Naver/Yahoo, 서버사이드 직접 호출 — 프록시 불필요)
   ├─ 뉴스 수집(RSS + 구글 뉴스 RSS 검색)
   ├─ Gemini API 호출 → 핵심 이슈 3건 + 종합 요약 생성 (Gemini 실패/미설정 시 Claude → 그래도 실패 시 규칙 기반 폴백)
   └─ data/morning-latest.json 또는 data/evening-latest.json 커밋 & 푸시
                              │
                              ▼
                   data/*.json (레포에 커밋된 정적 파일)
                              │
                              ▼
                 GitHub Pages (정적 호스팅, 빌드 과정 없음)
                              │
                              ▼
            브라우저: index.html이 data/*.json을 fetch로 읽어서 렌더링
            (실시간 API 호출/프록시 없음 → 빠르고 안정적)
```

핵심 포인트: **CORS 프록시가 사라진 이유**는 "프록시를 더 좋은 프록시로 바꿔서"가 아니라,
시세·뉴스 수집 자체를 **브라우저가 아니라 GitHub Actions 서버**에서 하기 때문입니다. CORS는
브라우저만 강제하는 정책이라 서버에는 적용되지 않습니다. 그래서 프록시 자체가 필요 없어졌습니다.

---

## 2. 폴더 구조

```
wm-research-desk/
├── .github/workflows/
│   ├── briefing-morning.yml   # 매일 06:30 KST(평일) 글로벌 데이터 자동 수집·커밋
│   └── briefing-evening.yml   # 매일 16:05 KST(평일) 국내 데이터 자동 수집·커밋
├── scripts/
│   ├── build-morning.mjs      # 모닝 에디션 빌드 진입점
│   ├── build-evening.mjs      # 이브닝 에디션 빌드 진입점
│   ├── build-insights.mjs     # F/O 리포트 아카이브 주간 보강
│   └── lib/
│       ├── config.mjs         # 지표·RSS·키워드 분류 설정 (여길 고치면 거의 다 커스터마이징됨)
│       ├── market.mjs         # 시세 수집 (Naver 공식 API 우선, Yahoo 폴백)
│       ├── news.mjs           # RSS/구글뉴스 수집·중복제거·태깅
│       ├── summarize.mjs      # Gemini API 요약(1순위) + Claude API(2순위) + 규칙 기반 폴백
│       ├── buildEdition.mjs   # 모닝/이브닝 공통 빌드 로직
│       └── fetchUtil.mjs      # 재시도/타임아웃 fetch, KST 시간 유틸
├── data/
│   ├── morning-latest.json    # 최신 모닝 브리핑 (Actions가 덮어씀)
│   ├── evening-latest.json    # 최신 이브닝 브리핑 (Actions가 덮어씀)
│   ├── archive/               # 날짜별 과거 브리핑 보관 (Actions가 자동 생성)
│   ├── news-archive.json      # 뉴스룸 탭용 누적 뉴스 아카이브 (Actions가 덮어씀)
│   ├── insights.json          # F/O 리포트 목록 (정적 유지 + 주간 자동 보강)
│   ├── portfolio-notes.json   # 포트폴리오 체크포인트 3카드 문구 (PB가 직접 편집)
│   ├── macro-events.json      # 월별 핵심 매크로 일정 (공식 발표 일정만, PB가 직접 편집)
│   ├── pb-notes-morning.md    # AI 요약 생성 시 참고할 본사 메모(모닝)
│   └── pb-notes-evening.md    # AI 요약 생성 시 참고할 본사 메모(이브닝)
├── index.html / css/styles.css / js/*.js   # 프론트엔드 (정적, 빌드 과정 없음)
└── package.json
```

---

## 3. 처음 배포 체크리스트

1. **이 폴더 전체를 본인 GitHub 저장소에 업로드**합니다. (이미 `git init` + 첫 커밋까지 되어 있는 폴더를
   받으셨다면: `git remote add origin <레포 URL>` → `git push -u origin main`)
2. 레포 → **Settings → Pages** → Source를 "Deploy from a branch"로, Branch를 `main` / `root (/)`로 지정합니다.
   (별도 빌드 워크플로 없이 정적 파일을 바로 서빙합니다.)
3. 레포 → **Settings → Secrets and variables → Actions**
   - `New repository secret` → `GEMINI_API_KEY` 등록 (Gemini API 키, [aistudio.google.com/apikey](https://aistudio.google.com/apikey)에서 발급 — AI 요약 1순위)
   - (선택) `New repository variable` → `GEMINI_MODEL` 등록 — 비워두면 코드의 후보 목록을 순서대로 시도합니다
     (한 모델이 503·단종·타임아웃이면 자동으로 다음 모델로 전환). 문제가 생기면 Actions 탭의
     **"Gemini API 진단"** 워크플로를 수동 실행해 키 유효성과 모델별 응답 상태를 확인하세요.
   - (선택) `New repository secret` → `ANTHROPIC_API_KEY` 등록 — Gemini 키가 없거나 호출이 실패할 때 대신 쓰이는
     2순위 Claude API 키. 필요 시 `ANTHROPIC_MODEL` 변수도 함께 등록.
   - **둘 다 등록하지 않아도 사이트는 정상 동작합니다.** 이 경우 AI 요약 대신 규칙 기반 폴백 문구가 생성됩니다.
4. 레포 → **Actions** 탭 → 두 워크플로("모닝 브리핑 자동 수집", "이브닝 브리핑 자동 수집")가 보이는지 확인 →
   각각 **Run workflow**로 1회 수동 실행해 `data/*.json`이 실제 값으로 갱신되는지 확인합니다.
5. Pages URL(`https://<계정>.github.io/<레포명>/`)에 접속해 화면이 뜨는지 확인합니다.

이후에는 평일 06:30 / 16:05(KST)에 자동으로 갱신됩니다. (스케줄은 `.github/workflows/*.yml`의 `cron` 값을
수정하면 바꿀 수 있습니다 — 단, GitHub Actions cron은 UTC 기준이라 파일 안 주석에 KST↔UTC 환산을 설명해
두었습니다.)

---

## 4. 로컬에서 미리보기

```bash
# 정적 파일이라 fetch()가 동작하려면 http(s) 서버가 필요합니다 (file://로 열면 JSON 로드가 막힙니다)
npx serve .
# 또는
python3 -m http.server 8080
```

데이터 수집 스크립트만 따로 테스트하려면:

```bash
cp .env.example .env   # 값 채운 뒤
export $(grep -v '^#' .env | xargs)   # 또는 direnv 등 사용
node scripts/build-morning.mjs
node scripts/build-evening.mjs
```

---

## 5. 요구사항 1~8 어떻게 반영했는지

| 요구사항 | 반영 내용 |
|---|---|
| 1. 의도 정확히 반영 | 모닝=글로벌, 이브닝=국내로 뉴스/쿼리 자체를 분리(`config.mjs`의 `GLOBAL_QUERY_RULES` / `DOMESTIC_QUERY_RULES`). 기존엔 두 에디션이 같은 뉴스 풀을 공유했습니다. |
| 2. 로딩시간 단축 | 브라우저는 정적 JSON만 fetch (실시간 다중 API 호출·프록시 전부 제거). 60여 개 종목 실시간 탭/차트 제거. 45초 폴링 제거(→ 10분 주기로 "새 데이터 있는지"만 가볍게 확인). |
| 3. 지속 업데이트 고려 | 모듈화된 Node 스크립트(`scripts/lib/*`), 설정은 `config.mjs` 한 곳에 집중, 프론트도 ES 모듈로 분리. 지표/RSS/캘린더는 코드 수정 없이 JSON·config만 바꾸면 반영. |
| 4. 데이터 항상 정확 | 모든 소스 실패 시 "그런 척" 하지 않고 `stale:true` + 이전 값 유지로 투명하게 표시. 검증 못 한 RSS 주소는 추측해서 넣지 않음. AI는 제공된 숫자만 쓰도록 프롬프트에 명시. |
| 5. 핵심만 뽑은 요약 | Gemini(또는 Claude) API가 시세+뉴스 후보 중 PB 관점 핵심 3이슈 + 종합 talkingPoint만 생성(길게 나열하지 않음). 키 없으면 규칙 기반 폴백. |
| 6. 모닝=글로벌 | `build-morning.mjs`는 `GLOBAL_QUERY_RULES`(뉴욕증시·연준·달러인덱스·국제유가 등)만 사용. |
| 7. 이브닝=국내 | `build-evening.mjs`는 `DOMESTIC_RSS_FEEDS` + `DOMESTIC_QUERY_RULES`(코스피·코스닥·수급·부동산 등)만 사용. |
| 8. 종합 제언 반영 | 아래 표 참고. |

---

## 6. 기존 버전과 달라진 점 (= 종합 제언 반영)

| 기존 문제 | 이번 버전에서의 해결 |
|---|---|
| 브라우저에서 무료 CORS 프록시 3개 경쟁 호출 | GitHub Actions 서버사이드 직접 호출로 완전 대체 (프록시 불필요) |
| 실패 시 하드코딩된 값이 "실시간"처럼 보임 | `stale` 플래그 + 상단 배지로 갱신 실패를 투명하게 표시 |
| 뉴스 제목/게시판 글이 sanitize 없이 innerHTML 삽입 (XSS 위험) | 모든 동적 텍스트에 `escapeHtml()` 적용 |
| 투자 권유성 문구에 면책조항이 PDF 하단에만 존재 | 대시보드 화면 하단에 상시 컴플라이언스 문구 고정 노출, 카톡/PDF에도 동일 포함 |
| 게시판 글을 누구나 삭제 가능 | 삭제 시 작성자명 재입력 요구(완전한 인증은 아니지만 최소 안전장치) + 로컬 전용임을 화면에 명시 |
| 전역 변수 오염, 단일 2,600줄 파일 | ES 모듈로 기능별 분리(`state/render/newsroom/insight/board/pdfExport/app`) |
| 날짜 계산이 공휴일을 고려하지 않음 | (완전한 공휴일 캘린더 연동까진 아니지만) 날짜 로직을 최소화하고, 매크로 캘린더는 PB가 직접 관리하는 JSON으로 분리해 오류 발생 지점을 줄임 |
| 로컬스토리지만 사용 → 캐시 삭제 시 전부 소실 | 뉴스/시세/요약은 레포(`data/*.json`)에 영구 보관. 스크랩/클릭/게시판처럼 "개인화/로컬 전용"이 맞는 것만 localStorage 유지 |

---

## 7. 알려진 제약사항 & 다음 단계 제안

- **게시판은 아직 브라우저 로컬 저장소입니다.** 여러 PB가 공유하는 게시판이 필요하다면
  Supabase/Firebase 같은 무료 티어 백엔드나, GitHub Issues API를 게시판으로 쓰는 방법을 고려하세요.
- **등락종목수·투자자별 수급(개인/외국인/기관)** 데이터는 이번 버전에서 제외했습니다. 기존 버전은
  뉴스 홈페이지 HTML을 정규식으로 긁어오는 방식이었는데, 이는 페이지 구조가 바뀌면 조용히 깨지는
  "정확성"에 반하는 방식이라 판단해 뺐습니다. 필요하시면 한국거래소(KRX) Open API 또는 정식 시세
  벤더 계약을 통해 `scripts/lib/market.mjs`에 추가하는 것을 권장합니다.
- **해외 언론사 "국제" 섹션 RSS**는 실제 주소를 확인하지 못해 비워두고 구글 뉴스 검색으로 대체했습니다.
  특정 언론사의 국제 섹션 RSS 주소를 확인하시면 `scripts/lib/config.mjs`의 `GLOBAL_RSS_FEEDS`에
  추가해 주세요.
- **GitHub Actions 러너의 IP가 일시적으로 차단될 가능성**: Naver/Yahoo/Google News는 공개 API이지만
  클라우드 데이터센터 IP 대역을 간헐적으로 제한하는 경우가 있습니다. 이 레포는 이런 상황에서도
  (1) 재시도 2회 → (2) Yahoo 폴백 → (3) 그래도 실패하면 이전 값 + `stale:true` 표시, 순서로 절대
  화면이 깨지지 않게 설계되어 있지만, 특정 지표가 계속 "갱신 실패"로 보인다면 이 가능성을 가장 먼저
  점검하세요(며칠 뒤 자동으로 복구되는 경우가 많습니다. 지속되면 정식 시세 벤더 전환을 권장합니다).
- **AI 요약 비용**: Gemini·Claude 둘 다 호출당 과금됩니다(Gemini는 무료 등급 한도도 있으니 Google AI Studio에서
  확인). 하루 2회(모닝/이브닝) 호출이라 비용은 크지 않지만, 운영 전 각 콘솔에서 가격을 확인하세요.
- **"지난 브리핑 다시보기"**: `data/archive/`에 날짜별로 이미 쌓이고 있으니, 프론트에 간단한 날짜
  선택 UI만 추가하면 바로 확장할 수 있습니다.


## 월별 핵심 매크로 일정 관리 (`data/macro-events.json`)

대시보드 하단 캘린더는 **각 기관이 공식 발표한 일정만** 보여줍니다(추정 날짜 없음).

- 수록 범위: `coverage.from` ~ `coverage.to` (현재 2026-10 ~ 2027-12). 전월/익월 버튼은 이 범위 안에서만 이동합니다.
- 수록 항목: 미 FOMC · 한은 금통위 · ECB · BOJ 금리 결정, 미국 CPI · 고용보고서, 미국 중간선거, 국내 증시 연말 휴장
- `kinds` = 일정 유형별 팝업 설명(어떤 일정인지 / 왜 중요한지 / PB 체크포인트 / 출처), `items` = 날짜별 일정
- 날짜는 **현지 기준**이고, 한국시간은 각 항목의 `timeKst`에 적습니다(예: FOMC는 한국시간 다음 날 새벽).

**새 연도 일정 추가 방법** — 아래 공식 출처에서 다음 해 일정이 나오면 `items`에 추가하고 `coverage.to`를 늘리세요.

| 일정 | 공식 출처 | 보통 발표 시기 |
|---|---|---|
| FOMC | federalreserve.gov/monetarypolicy/fomccalendars.htm | 전년도 여름 |
| 한은 금통위 | bok.or.kr (금융통화위원회 정기회의 개최 예정일) | 전년도 10월 말 |
| 미국 CPI·고용 | bls.gov/schedule | 전년도 가을 |
| ECB | ecb.europa.eu (Governing Council meetings) | 1~2년 전 |
| BOJ | boj.or.jp (Scheduled Dates of MPMs) | 전년도 7월 말 |

> 새 유형(예: 한국 CPI, 미국 PCE)을 추가하려면 `kinds`에 설명을 먼저 넣고 `items`에서 그 `kind`를 쓰면 됩니다. 화면 코드는 수정할 필요가 없습니다.

## 자동 갱신 워크플로 `캘린더·F/O Insight 자동 갱신` (하루 2회, KST 07:10 · 17:40)

| 수집 대상 | 출처 | 방식 |
|---|---|---|
| 미국 CPI·고용 결과 | BLS 공식 API | 공식 지수로 계산 |
| FOMC 결과 | 연준 성명서 원문 | 공식 문구에서 추출 |
| 한은·ECB·BOJ 결과 | 발표 직후 뉴스 헤드라인 | Gemini 정리(근거 2건 이상일 때만 기록) |
| 코스피 시총 상위 10 실적 일정·잠정실적 | DART 공시 | **`DART_API_KEY` 시크릿 필요** (opendart.fss.or.kr 무료 발급) |
| F/O Insight 자료 | 국문·영문 뉴스 9개 주제 | Gemini가 홍보성 기사 제외·분류, 같은 사건 기사 1건으로 병합 |

- 결과는 `data/event-results.json`, 실적 일정은 `data/auto-events.json`에 저장되며, 한 번 확정된 결과는 덮어쓰지 않습니다.
- 만기일·휴장일·MSCI 일정은 `data/market-holidays.json`을 고친 뒤 `node scripts/build-rule-events.mjs`로 다시 계산합니다.
- 지난 브리핑은 `data/archive/`에 날짜별로 쌓이고, `data/archive/index.json`이 대시보드의 날짜 선택 목록이 됩니다.


## 자동화 한눈에 보기

| 워크플로 | 실행 시각(KST) | 하는 일 |
|---|---|---|
| 모닝 브리핑 자동 수집 | 평일 06:30 | 해외 시세·뉴스 수집 → 필독 뉴스(보도 언론사 수 순위·AI 분야 판정) → AI 요약 → 배분 모델별 점검 → 날짜별 보관 |
| 이브닝 브리핑 자동 수집 | 평일 16:05 | 위와 같은 과정, 국내 중심 |
| 캘린더·F/O Insight 자동 갱신 | 매일 07:10 · 17:40 | 일정 결과(FOMC·CPI·고용·금통위 등), 시총 상위 실적 공시(DART), F/O Insight 자료 수집 |
| Gemini API 진단 | 수동 | AI 요약이 안 될 때 키·모델 상태 점검 |

- 모든 워크플로는 마지막에 `node scripts/validate-data.mjs`로 데이터를 점검하고, 문제가 있으면 Actions 화면에 경고를 남깁니다.
- 데이터가 push되면 GitHub Pages가 자동으로 사이트를 다시 배포합니다.
- 사람이 해야 하는 일: 매년 새 공식 일정(FOMC·금통위·CPI 등)과 휴장일 추가 — 수록 범위 3개월 전부터 점검 스크립트가 경고합니다.
