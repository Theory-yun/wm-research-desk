// 프론트엔드 전역 설정. 백엔드(scripts/lib/config.mjs)와 태그 분류 체계를 맞춰 두었습니다.

export const DATA_FILES = {
  morning: "data/morning-latest.json",
  evening: "data/evening-latest.json",
  newsArchive: "data/news-archive.json",
  insights: "data/insights.json",
  portfolioNotes: "data/portfolio-notes.json",
  macroEvents: "data/macro-events.json",
  autoEvents: "data/auto-events.json",
  eventResults: "data/event-results.json",
  archiveIndex: "data/archive/index.json",
};

/** 지난 브리핑 파일 경로 (예: data/archive/morning-2026-11-14.json) */
export const archiveFile = (edition, date) => `data/archive/${edition.toLowerCase()}-${date}.json`;

export const TAG_CLASS_MAP = {
  "매크로": "tag-macro",
  "TAX": "tag-tax",
  "부동산": "tag-estate",
  "외환": "tag-forex",
  "대체투자": "tag-alt",
};

export const LOCAL_STORAGE_KEYS = {
  newsClicks: "wm_desk_news_clicks_v1",
  scrapMap: "wm_desk_scrap_map_v1",
  boardPosts: "wm_desk_board_posts_v1",
  editionOverride: "wm_desk_edition_override_v1",
};

export const TOP5_DEFAULT_COUNT = 5;
export const NEWSROOM_PAGE_SIZE = 10;
