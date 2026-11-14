/**
 * 데이터 소스/분류 규칙을 한 곳에 모아둔 설정 파일.
 * 향후 지표나 언론사를 추가/변경할 때는 코드 로직을 건드리지 않고
 * 이 파일만 수정하면 됩니다. (유지보수성 확보)
 */

// 대시보드 6대 핵심 지표. (예전 버전의 60여 개 종목 실시간 탭은 제거했습니다 —
// 브리핑 목적에 실제로 쓰이는 지표만 남겨 로딩을 가볍게 하기 위한 의도적 축소입니다.)
export const CORE_SYMBOLS = [
  {
    key: "KOSPI",
    name: "코스피",
    group: "domestic",
    naverDomesticCode: "KOSPI",
    yahooSymbol: "^KS11",
  },
  {
    key: "KOSDAQ",
    name: "코스닥",
    group: "domestic",
    naverDomesticCode: "KOSDAQ",
    yahooSymbol: "^KQ11",
  },
  {
    key: "SP500",
    name: "S&P 500",
    group: "global",
    naverWorldCode: ".INX",
    yahooSymbol: "^GSPC",
  },
  {
    key: "NASDAQ",
    name: "나스닥",
    group: "global",
    naverWorldCode: ".IXIC",
    yahooSymbol: "^IXIC",
  },
  {
    key: "SOX",
    name: "필라델피아 반도체",
    group: "global",
    naverWorldCode: ".SOX",
    yahooSymbol: "^SOX",
  },
  {
    key: "USDKRW",
    name: "원/달러 환율",
    group: "fx",
    yahooSymbol: "KRW=X",
  },
];

// 국내(이브닝) 브리핑용 직접 RSS 피드.
// 기존 운영 중인 코드에서 실제로 쓰던 주소를 그대로 재사용했습니다(검증된 소스).
export const DOMESTIC_RSS_FEEDS = [
  { url: "https://www.hankyung.com/feed/economy", press: "한국경제", cat: "매크로" },
  { url: "https://www.hankyung.com/feed/finance", press: "한국경제", cat: "매크로" },
  { url: "https://www.hankyung.com/feed/realestate", press: "한국경제", cat: "부동산" },
  { url: "https://www.mk.co.kr/rss/30100041/", press: "매일경제", cat: "매크로" },
  { url: "https://www.mk.co.kr/rss/50200011/", press: "매일경제", cat: "매크로" },
  { url: "https://www.mk.co.kr/rss/50300009/", press: "매일경제", cat: "부동산" },
  { url: "https://www.yna.co.kr/rss/economy.xml", press: "연합뉴스", cat: "매크로" },
  { url: "https://www.fnnews.com/rss/r20/fn_realnews_economy.xml", press: "파이낸셜뉴스", cat: "매크로" },
];

// 해외 언론사별 "국제" 섹션 RSS 주소는 실제 존재 여부를 하나하나 검증하지 못해
// 임의로 추가하지 않았습니다(부정확한 데이터를 섣불리 넣지 않는다는 원칙).
// 대신 검증된 방식(구글 뉴스 RSS 검색 — 원문 기사 링크를 그대로 사용)으로
// 모닝 에디션에 필요한 "글로벌" 키워드를 조회합니다.
// → 특정 언론사의 국제 섹션 RSS 주소를 확인하셨다면 아래 배열에 추가하면 바로 반영됩니다.
export const GLOBAL_RSS_FEEDS = [];

// 모닝(장 개장 전) 에디션: 간밤 글로벌 시장 중심 쿼리
export const GLOBAL_QUERY_RULES = [
  { cat: "매크로", query: '(뉴욕증시 OR "S&P500" OR 나스닥 OR 연준 OR FOMC) when:2d' },
  { cat: "외환", query: "(달러 인덱스 OR 원달러 환율 OR 엔달러 환율) when:2d" },
  { cat: "대체투자", query: "(국제유가 OR WTI OR 국제 금값 OR 비트코인) when:2d" },
];

// 이브닝(장 종료 후) 에디션: 당일 국내 시장 중심 쿼리
export const DOMESTIC_QUERY_RULES = [
  { cat: "매크로", query: "(코스피 OR 코스닥 OR 기관 순매수 OR 외국인 순매도) when:1d" },
  { cat: "부동산", query: "(종합부동산세 OR 재건축 OR 상업용 빌딩 OR 토지거래허가구역) when:3d" },
];

// 두 에디션 공통 — 패밀리오피스 핵심 관심사(세무·승계·신탁)
export const FO_QUERY_RULES = [
  { cat: "TAX", query: "(가업상속공제 OR 상속세 OR 증여세 OR 유언대용신탁 OR 패밀리오피스) when:7d" },
];

// 뉴스 본문/제목 → 탭 필터용 태그 자동 분류 키워드
export const KEYWORD_TAGS = [
  {
    cat: "매크로",
    keywords: ["금리", "연준", "FOMC", "파월", "국채", "국고채", "물가", "CPI", "통화정책", "한국은행", "코스피", "코스닥", "증시", "뉴욕증시", "나스닥", "다우"],
  },
  {
    cat: "TAX",
    keywords: ["세무", "세제", "상속", "증여", "가업승계", "가업상속", "패밀리오피스", "유언대용신탁", "신탁", "절세", "비상장", "배당"],
  },
  {
    cat: "부동산",
    keywords: ["부동산", "빌딩", "종부세", "종합부동산세", "토지거래", "재건축", "아파트", "상업용", "오피스", "꼬마빌딩"],
  },
  {
    cat: "외환",
    keywords: ["환율", "원/달러", "원달러", "달러", "엔화", "유로", "위안", "외환", "환헤지"],
  },
  {
    cat: "대체투자",
    keywords: ["금값", "금 시세", "원유", "유가", "WTI", "브렌트유", "구리", "원자재", "비트코인", "가상자산", "사모펀드", "PEF"],
  },
];

// 뉴스 아카이브 보존 정책
export const NEWS_ARCHIVE_MAX_ITEMS = 250;
export const NEWS_ARCHIVE_MAX_AGE_DAYS = 30;

// AI 요약에 후보로 넘길 뉴스 개수
export const SUMMARY_CANDIDATE_NEWS_COUNT = 15;
// 대시보드 Top 뉴스로 노출할 개수
export const TOP_NEWS_COUNT = 8;
