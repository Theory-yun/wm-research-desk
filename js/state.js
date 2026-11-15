import { LOCAL_STORAGE_KEYS } from "./config.js";

export const StorageUtil = {
  get(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* 저장 공간이 꽉 찼거나 비공개 모드인 경우 조용히 무시 */
    }
  },
};

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 앱 전역 상태.
 * - morningData / eveningData: data/*.json에서 불러온 에디션별 브리핑
 * - newsArchive / insights / portfolioNotes / macro(매크로 캘린더): 공용 데이터
 * - edition: 현재 화면에 표시 중인 에디션 ('MORNING' | 'EVENING')
 * - clickMap / scrapMap: 브라우저 로컬 개인화(이 기기에서만 유지됨)
 */
export const STATE = {
  morningData: null,
  eveningData: null,
  newsArchive: [],
  insights: [],
  portfolioNotes: [],
  macro: null,

  edition: "MORNING",
  isEditing: false,

  newsFilter: "ALL",
  newsSearch: "",
  newsVisibleCount: 10,

  insightFilter: "ALL",

  clickMap: StorageUtil.get(LOCAL_STORAGE_KEYS.newsClicks, {}),
  scrapMap: StorageUtil.get(LOCAL_STORAGE_KEYS.scrapMap, {}),
};

export function currentEditionData() {
  return STATE.edition === "MORNING" ? STATE.morningData : STATE.eveningData;
}
