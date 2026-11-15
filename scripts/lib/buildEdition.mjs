import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCoreMarket } from "./market.mjs";
import { fetchGoogleNewsQuery, fetchRssFeed, mergeAndDedupe } from "./news.mjs";
import { clusterStories, rankClusters, aiMergeAndClassify, aiClassifyTitles, keywordClassify } from "./newsIntel.mjs";
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
 * data/archive/ 의 날짜별 브리핑 파일 목록을 index.json으로 정리합니다.
 * (정적 사이트는 폴더 목록을 직접 읽을 수 없으므로, "지난 브리핑 다시보기" 화면이 이 목록을 사용합니다.)
 */
export function writeArchiveIndex() {
  const byDate = {};
  for (const f of fs.readdirSync(ARCHIVE_DIR)) {
    const m = f.match(/^(morning|evening)-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    (byDate[m[2]] = byDate[m[2]] || []).push(m[1]);
  }
  const dates = Object.keys(byDate)
    .sort()
    .reverse()
    .map((date) => ({ date, editions: byDate[date].sort().reverse() })); // morning 먼저
  writeJson(path.join(ARCHIVE_DIR, "index.json"), { updatedAt: new Date().toISOString(), dates });
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

  // 3) 이번 에디션 필독 뉴스: "같은 사건을 보도한 언론사 수"(외부 노출 정도) 기준
  const editionFresh = mergeAndDedupe([], batches, { maxAgeDays: NEWS_ARCHIVE_MAX_AGE_DAYS });
  const nowMs = Date.now();
  let pool = editionFresh.filter((n) => nowMs - n.timestamp < 36 * 3600e3);
  if (pool.length < 20) pool = editionFresh; // 주말 등 기사가 적으면 범위를 넓힘
  const clusters = rankClusters(clusterStories(pool)).slice(0, 40);
  const groups = await aiMergeAndClassify(clusters, { label: `${edition} 필독 뉴스` });
  const stories = (groups ?? clusters.map((c) => ({ clusters: [c], cats: [], relevant: true })))
    .filter((g) => g.relevant)
    .map((g) => {
      const items = g.clusters.flatMap((c) => c.items);
      const outlets = [...new Set(items.map((i) => i.press).filter(Boolean))];
      const rep = [...g.clusters].sort((a, b) => b.outlets.length - a.outlets.length)[0].rep;
      const tags = g.cats.length ? g.cats : keywordClassify(rep.title);
      return {
        ...rep,
        tags: tags.length ? tags : rep.tags,
        tagSource: g.cats.length ? "ai" : "keyword",
        coverage: outlets.length,
        outlets: outlets.slice(0, 6),
        latestTs: Math.max(...items.map((i) => i.timestamp)),
      };
    })
    .sort((a, b) => b.coverage - a.coverage || b.latestTs - a.latestTs);
  const topNews = stories.slice(0, TOP_NEWS_COUNT).map(({ latestTs, ...n }) => n);
  const candidateNews = stories.slice(0, SUMMARY_CANDIDATE_NEWS_COUNT);
  console.log(`필독 뉴스: 후보 ${pool.length}건 → 이야기 ${stories.length}개 (분야 판정: ${groups ? "AI" : "키워드 규칙"})`);
  topNews.forEach((n, i) => console.log(`  ${i + 1}. [${n.coverage}곳] [${n.tags.join(",")}] ${n.title.slice(0, 50)}`));

  // 4) 뉴스룸 탭용 누적 아카이브에 병합 + 아직 AI 분야 판정을 안 받은 기사 판정
  const mergedArchive = mergeAndDedupe(archive.items, batches, { maxAgeDays: NEWS_ARCHIVE_MAX_AGE_DAYS }).slice(
    0,
    NEWS_ARCHIVE_MAX_ITEMS
  );
  const storyTags = new Map(topNews.concat(candidateNews).map((n) => [n.url, n.tags]));
  const pending = mergedArchive.filter((n) => n.tagSource !== "ai").slice(0, 180);
  const aiTags = await aiClassifyTitles(pending.map((n) => n.title), { label: `${edition} 뉴스룸 분야` });
  pending.forEach((n, i) => {
    const t = aiTags?.get(i);
    if (t) Object.assign(n, { tags: t.cats, tagSource: "ai", ...(t.relevant ? {} : { lowRelevance: true }) });
    else if (storyTags.has(n.url)) Object.assign(n, { tags: storyTags.get(n.url) });
    else {
      const k = keywordClassify(n.title);
      if (k.length) n.tags = k;
    }
  });
  writeJson(archivePath, { updatedAt: new Date().toISOString(), items: mergedArchive });
  console.log(`뉴스 아카이브: 총 ${mergedArchive.length}건 보관 (이번에 AI 분야 판정 ${aiTags?.size ?? 0}건)`);

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
  writeArchiveIndex();

  console.log(`=== [${edition}] 완료 → ${latestPath} ===\n`);
  return payload;
}
