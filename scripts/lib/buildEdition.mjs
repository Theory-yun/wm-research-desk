import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCoreMarket } from "./market.mjs";
import { fetchGoogleNewsQuery, fetchRssFeed, mergeAndDedupe, rankNews } from "./news.mjs";
import { generateBriefingSummary } from "./summarize.mjs";
import { kstStamp, kstDateKey } from "./fetchUtil.mjs";
import { FO_QUERY_RULES, NEWS_ARCHIVE_MAX_AGE_DAYS, NEWS_ARCHIVE_MAX_ITEMS, SUMMARY_CANDIDATE_NEWS_COUNT, TOP_NEWS_COUNT } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");
const DATA_DIR = path.join(ROOT, "data");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

/**
 * 모닝/이브닝 에디션 공통 빌드 로직.
 * build-morning.mjs / build-evening.mjs는 이 함수에 "에디션별 설정"만 넘겨서 호출합니다.
 * → 로직은 한 곳(여기)에만 있으므로, 향후 수정할 때 두 곳을 중복 수정할 필요가 없습니다.
 */
export async function buildEdition({ edition, directFeeds, queryRules, pbNotesPath }) {
  console.log(`\n=== [${edition}] 브리핑 데이터 생성 시작 ===`);

  const latestPath = path.join(DATA_DIR, `${edition.toLowerCase()}-latest.json`);
  const archivePath = path.join(DATA_DIR, "news-archive.json");

  const previous = readJsonSafe(latestPath, null);
  const archive = readJsonSafe(archivePath, { updatedAt: null, items: [] });

  // 1) 시세 수집 (실패 종목은 이전 값 + stale 플래그 유지 — "조용히 틀린 값"을 보여주지 않음)
  const market = await collectCoreMarket(previous?.market ?? []);
  const marketFailCount = market.filter((m) => m.stale).length;
  console.log(`시세 수집: ${market.length - marketFailCount}/${market.length} 성공`);

  // 2) 이 에디션 전용 뉴스 수집 (직접 RSS + 구글 뉴스 쿼리 + F/O 공통 쿼리)
  const batches = [];
  for (const feed of directFeeds) {
    batches.push(await fetchRssFeed(feed.url, feed.cat, feed.press));
  }
  for (const rule of [...queryRules, ...FO_QUERY_RULES]) {
    batches.push(await fetchGoogleNewsQuery(rule.query, rule.cat));
  }
  const freshCount = batches.reduce((sum, b) => sum + b.length, 0);
  console.log(`신규 수집 뉴스: ${freshCount}건 (중복 제거 전)`);

  // 3) 뉴스룸 탭용 누적 아카이브에 병합 (모닝/이브닝 공통 저장소)
  const mergedArchive = mergeAndDedupe(archive.items, batches, { maxAgeDays: NEWS_ARCHIVE_MAX_AGE_DAYS }).slice(
    0,
    NEWS_ARCHIVE_MAX_ITEMS
  );
  writeJson(archivePath, { updatedAt: new Date().toISOString(), items: mergedArchive });
  console.log(`뉴스 아카이브: 총 ${mergedArchive.length}건 보관 중`);

  // 4) 이번 에디션에 쓸 뉴스 후보 (이번에 새로 모은 것 중심으로 랭킹)
  const editionFresh = mergeAndDedupe([], batches, { maxAgeDays: NEWS_ARCHIVE_MAX_AGE_DAYS });
  const candidateNews = rankNews(editionFresh, SUMMARY_CANDIDATE_NEWS_COUNT);
  const topNews = rankNews(editionFresh, TOP_NEWS_COUNT);

  // 5) AI 요약 (키 없음/호출 실패 시 자동으로 규칙 기반 폴백 — summarize.mjs 참고)
  let pbNotes = "";
  try {
    pbNotes = fs.readFileSync(pbNotesPath, "utf-8").trim();
  } catch {
    /* 본사 메모 파일이 없으면 생략 */
  }

  const summary = await generateBriefingSummary({
    edition,
    market,
    candidateNews: candidateNews.length ? candidateNews : previous?.topNews ?? [],
    pbNotes,
  });
  console.log(`요약 생성 방식: ${summary.summarySource}${summary.summaryModel ? ` (${summary.summaryModel})` : ""}`);

  // 6) 최종 JSON 작성 (latest + 날짜별 아카이브 둘 다 저장 → 추후 "지난 브리핑 다시보기" 기능 확장 가능)
  const now = new Date();
  const payload = {
    edition,
    generatedAt: now.toISOString(),
    generatedAtKST: kstStamp(now),
    sourceStatus: {
      market: marketFailCount === 0 ? "ok" : marketFailCount === market.length ? "failed" : "partial",
      news: freshCount > 0 ? "ok" : "failed",
      summary: summary.summarySource,
      ...(summary.summaryModel ? { summaryModel: summary.summaryModel } : {}),
    },
    market,
    issues: summary.issues,
    talkingPoint: summary.talkingPoint,
    topNews: topNews.length ? topNews : previous?.topNews ?? [],
  };

  writeJson(latestPath, payload);
  writeJson(path.join(ARCHIVE_DIR, `${edition.toLowerCase()}-${kstDateKey(now)}.json`), payload);

  console.log(`=== [${edition}] 완료 → ${latestPath} ===\n`);
  return payload;
}
