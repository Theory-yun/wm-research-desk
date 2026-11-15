// 프론트엔드 전역 설정. 백엔드(scripts/lib/config.mjs)와 태그 분류 체계를 맞춰 두었습니다.

export const DATA_FILES = {
  morning: "data/morning-latest.json",
  evening: "data/evening-latest.json",
  newsArchive: "data/news-archive.json",
  insights: "data/insights.json",
  macroEvents: "data/macro-events.json",
  autoEvents: "data/auto-events.json",
  eventResults: "data/event-results.json",
  archiveIndex: "data/archive/index.json",
};

/** 지난 브리핑 파일 경로 (예: data/archive/morning-2026-11-14.json) */
export const archiveFile = (edition, date) => `data/archive/${edition.toLowerCase()}-${date}.json`;

// 뉴스 분야(서버의 scripts/lib/newsIntel.mjs NEWS_CATEGORIES와 같은 이름)
export const TAG_CLASS_MAP = {
  "매크로": "tag-macro",
  "증시": "tag-equity",
  "채권·금리": "tag-bond",
  "외환": "tag-forex",
  "원자재": "tag-commodity",
  "부동산": "tag-estate",
  "TAX": "tag-tax",
  "대체투자": "tag-alt",
};
export const TAG_ICON = {
  "매크로": "🌐",
  "증시": "📈",
  "채권·금리": "🏦",
  "외환": "💱",
  "원자재": "🛢️",
  "부동산": "🏢",
  "TAX": "⚖️",
  "대체투자": "💎",
};
/** 분야 배지 HTML (아이콘 + 이름) */
export const tagBadge = (t, esc) => `<span class="badge-tag ${TAG_CLASS_MAP[t] || "tag-macro"}">${TAG_ICON[t] ?? ""} ${esc(t)}</span>`;

export const LOCAL_STORAGE_KEYS = {
  newsClicks: "wm_desk_news_clicks_v1",
  scrapMap: "wm_desk_scrap_map_v1",
  boardPosts: "wm_desk_board_posts_v1",
  editionOverride: "wm_desk_edition_override_v1",
  allocModel: "wm_desk_alloc_model_v1", // 사용자가 고른 예시 배분 모델(이 브라우저에만 저장)
};

export const TOP5_DEFAULT_COUNT = 5;
export const NEWSROOM_PAGE_SIZE = 10;
