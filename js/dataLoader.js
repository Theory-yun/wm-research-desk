import { DATA_FILES } from "./config.js";
import { STATE } from "./state.js";

export async function fetchJson(url) {
  try {
    // 캐시 버스팅: GitHub Pages의 CDN 캐시 때문에 새로 커밋된 데이터가 바로 안 보이는 것을 방지
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`[dataLoader] ${url} 로드 실패:`, err.message);
    console.warn(
      "로컬에서 테스트 중이라면 index.html을 더블클릭해서 열지 말고, " +
        "`npx serve .` 같은 로컬 서버로 열어야 fetch가 동작합니다 (file:// 프로토콜은 JSON fetch가 차단됩니다)."
    );
    return null;
  }
}

/**
 * 모든 데이터 파일을 병렬로 불러와 STATE에 채웁니다.
 * 하나라도 실패해도 나머지 탭은 정상 동작하도록 각각 독립적으로 처리합니다.
 */
export async function loadAllData() {
  const [morning, evening, newsArchive, insights, macroEvents, autoEvents, eventResults, archiveIndex] = await Promise.all([
    fetchJson(DATA_FILES.morning),
    fetchJson(DATA_FILES.evening),
    fetchJson(DATA_FILES.newsArchive),
    fetchJson(DATA_FILES.insights),
    fetchJson(DATA_FILES.macroEvents),
    fetchJson(DATA_FILES.autoEvents),
    fetchJson(DATA_FILES.eventResults),
    fetchJson(DATA_FILES.archiveIndex),
  ]);

  STATE.morningData = morning;
  STATE.eveningData = evening;
  STATE.newsArchive = newsArchive?.items ?? [];
  STATE.insights = insights?.items ?? [];
  STATE.macro = macroEvents ?? null; // { coverage, kinds, items, ... }
  STATE.autoEvents = autoEvents?.items ?? [];
  STATE.eventResults = eventResults?.results ?? {};
  STATE.archiveIndex = archiveIndex?.dates ?? [];
  STATE.insightCategories = insights?.categories ?? [];
}
