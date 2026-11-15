/**
 * 기사 "실제 발행 시각" 확인.
 *
 * 문제: 구글 뉴스 RSS의 pubDate는 기사가 '수정·재노출'된 시각인 경우가 많아,
 *       며칠 전 기사가 오늘 기사처럼 보이거나 시각이 원문(입력 시각)과 어긋납니다.
 * 해결: 필독 뉴스 후보에 한해
 *   1) 구글 뉴스 링크 → 언론사 원문 URL로 변환
 *   2) 원문 페이지의 발행 시각 메타데이터(article:published_time, datePublished 등)를 읽음
 *   3) 그래도 없으면 원문 URL 속 날짜(예: .../20261110...)가 RSS 날짜보다 이르면 그 날짜 사용
 * 실패하면 RSS 시각을 그대로 둡니다(기능이 멈추지 않도록).
 */
import { fetchWithRetry } from "./fetchUtil.mjs";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function kstFormat(ts) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(ts)).map((x) => [x.type, x.value])
  );
  return `${p.year}.${p.month}.${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** 구글 뉴스 기사 링크 → 언론사 원문 URL (실패 시 null) */
export async function resolveGoogleNewsUrl(gnUrl) {
  const m = String(gnUrl).match(/news\.google\.com\/(?:rss\/)?articles\/([^?/#]+)/);
  if (!m) return null;
  const id = m[1];
  try {
    const html = await fetchWithRetry(`https://news.google.com/articles/${id}`, {
      responseType: "text", timeoutMs: 10000, retries: 1, headers: { "User-Agent": BROWSER_UA },
    });
    const sg = html?.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html?.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) return null;
    const inner = JSON.stringify([
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id, Number(ts), sg,
    ]);
    const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
    const res = await fetchWithRetry("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST", body, responseType: "text", timeoutMs: 10000, retries: 1,
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": BROWSER_UA },
    });
    const url = res?.match(/\\"garturlres\\",\\"(https?:[^"\\]+)/)?.[1];
    return url ? url.replace(/\\u0026/g, "&").replace(/\\\//g, "/") : null;
  } catch {
    return null;
  }
}

/** HTML에서 발행 시각 추출 (ms, 실패 시 null) */
export function extractPublishedTs(html) {
  if (!html) return null;
  const head = html.slice(0, 400000);
  const patterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:article:published_time|datePublished|pubdate|publishdate|article:published|dable:published_time)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|og:article:published_time|datePublished|pubdate|publishdate)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ];
  for (const re of patterns) {
    const raw = head.match(re)?.[1];
    const ts = parseLooseDate(raw);
    if (ts) return ts;
  }
  return null;
}

/** '2026-11-10T09:01:00+09:00', '2026-11-10 09:01:00'(시간대 없으면 KST), '20261110090100' 등 */
export function parseLooseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+09:00`);
  m = s.match(/^(\d{4})[-.\/](\d{2})[-.\/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const tz = m[8] ? (m[8] === "Z" ? "Z" : m[8].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "+09:00";
    const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${tz}`);
    return Number.isNaN(ts) ? null : ts;
  }
  const ts = Date.parse(s);
  return Number.isNaN(ts) ? null : ts;
}

/** URL 속 날짜(yyyymmdd 또는 yyyy/mm/dd) → 그날 00:00 KST (ms) */
export function urlDateTs(url) {
  const m = String(url || "").match(/(?:^|[^\d])(20\d{2})[\/-]?(0[1-9]|1[0-2])[\/-]?(0[1-9]|[12]\d|3[01])/);
  if (!m) return null;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * 기사 하나의 실제 발행 시각 확인. item: {url, timestamp}
 * 반환: { publishedTs, originalUrl, source: "meta"|"url"|"rss" }
 */
export async function verifyArticleTime(item) {
  const isGN = /news\.google\.com/.test(item.url);
  const originalUrl = isGN ? await resolveGoogleNewsUrl(item.url) : item.url;
  let publishedTs = null;
  let source = "rss";
  if (originalUrl) {
    try {
      const html = await fetchWithRetry(originalUrl, {
        responseType: "text", timeoutMs: 9000, retries: 1, headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      });
      publishedTs = extractPublishedTs(html);
      if (publishedTs) source = "meta";
    } catch { /* 원문 접속 실패 → 아래 대안 */ }
    if (!publishedTs) {
      const u = urlDateTs(originalUrl);
      // URL 날짜가 RSS 날짜(KST 기준)보다 하루 이상 이르면 URL 날짜를 채택(시각 미상)
      if (u && u < item.timestamp - 86400000) { publishedTs = u; source = "url"; }
    }
  }
  // 말이 안 되는 값(미래, 1년 이상 과거)은 버림
  if (publishedTs && (publishedTs > Date.now() + 3600e3 || publishedTs < Date.now() - 365 * 86400e3)) {
    publishedTs = null; source = "rss";
  }
  return { publishedTs: publishedTs ?? item.timestamp, originalUrl: originalUrl ?? null, source };
}

/**
 * 필독 뉴스 후보 목록의 발행 시각을 바로잡고, 실제로 오래된 기사(maxAgeHours 초과)는 뺍니다.
 * 각 항목에 timestamp/date(바로잡은 값), rssDate(원래 값), originalUrl, timeSource를 남깁니다.
 */
export async function verifyStoryTimes(items, { maxAgeHours = 72 } = {}) {
  const out = [];
  let fixed = 0, dropped = 0, resolved = 0;
  for (const n of items) {
    const v = await verifyArticleTime(n);
    if (v.originalUrl && v.originalUrl !== n.url) resolved++;
    const rssDate = n.date;
    const changed = Math.abs(v.publishedTs - n.timestamp) >= 30 * 60e3;
    const date = v.source === "url" ? kstFormat(v.publishedTs).slice(0, 10) : kstFormat(v.publishedTs);
    const next = { ...n, timestamp: v.publishedTs, date, rssDate, timeSource: v.source };
    if (v.originalUrl && v.originalUrl !== n.url) { next.googleUrl = n.url; next.url = v.originalUrl; }
    if (changed) {
      fixed++;
      console.log(`  [발행시각 보정] ${rssDate} → ${date} (${v.source}) ${n.title.slice(0, 36)}`);
    }
    if (Date.now() - v.publishedTs > maxAgeHours * 3600e3) {
      dropped++;
      console.log(`  [오래된 기사 제외] 실제 발행 ${date} ${n.title.slice(0, 36)}`);
      continue;
    }
    out.push(next);
  }
  console.log(`[발행시각 확인] ${items.length}건 · 원문 URL 확인 ${resolved} · 보정 ${fixed} · 오래돼 제외 ${dropped}`);
  return out;
}
