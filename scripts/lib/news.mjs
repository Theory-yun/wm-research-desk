import { fetchWithRetry } from "./fetchUtil.mjs";
import { keywordClassify } from "./newsIntel.mjs";
import { urlDateTs } from "./articleTime.mjs";

function decodeEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDirectArticleUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (!path || ["/economy", "/finance", "/news/economy"].includes(path)) return false;
    return path.length > 8 || u.search.length > 4;
  } catch {
    return false;
  }
}

function classifyTags(title, fallbackCat) {
  // 1차 분류(키워드 규칙). 최종 분야는 빌드 단계에서 Gemini가 기사 내용으로 다시 판정합니다(newsIntel.mjs).
  const cats = keywordClassify(title);
  return cats.length ? cats : [fallbackCat || "매크로"];
}

function parsePubDate(raw) {
  if (!raw) return null;
  const clean = decodeEntities(raw);
  const ts = new Date(clean).getTime();
  if (Number.isNaN(ts) || ts <= 0) return null;
  return ts;
}

function kstFormat(ts) {
  const dt = new Date(ts);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}.${get("month")}.${get("day")} ${hh}:${get("minute")}`;
}

function extractTag(block, tag) {
  const rx = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(rx);
  return m ? decodeEntities(m[1]) : "";
}

function parseRssXml(xmlText, fallbackCat, fallbackPress) {
  const blocks = xmlText.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const out = [];

  blocks.forEach((block) => {
    let title = extractTag(block, "title");
    const link = extractTag(block, "link") || extractTag(block, "guid");
    const pubDateRaw = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    let press = extractTag(block, "source") || fallbackPress || "";

    // "제목 - 언론사" 패턴에서 언론사명을 분리 (구글 뉴스 RSS 등)
    if (!fallbackPress && title.lastIndexOf(" - ") !== -1) {
      const candidate = title.slice(title.lastIndexOf(" - ") + 3).trim();
      if (/^https?:\/\//.test(candidate)) {
        // "제목 - https://www.언론사.com/" 형태: 주소에서 언론사 도메인만 남기고 제목에서 떼어냄
        try {
          press = press || new URL(candidate).hostname.replace(/^www\./, "");
        } catch {
          /* noop */
        }
        title = title.slice(0, title.lastIndexOf(" - ")).trim();
      } else if (candidate.length <= 18) {
        press = press || candidate;
        title = title.slice(0, title.lastIndexOf(" - ")).trim();
      }
    }
    if (!press) press = "경제뉴스";

    let ts = parsePubDate(pubDateRaw);
    if (!ts || !title || !isDirectArticleUrl(link)) return;
    // RSS 시각이 '수정 시각'이라 원문 URL 속 날짜보다 하루 이상 늦으면 URL 날짜를 발행일로 사용
    const uts = urlDateTs(link);
    const dateOnly = uts && uts < ts - 86400000;
    if (dateOnly) ts = uts;

    out.push({
      title,
      press,
      url: link,
      timestamp: ts,
      date: dateOnly ? kstFormat(ts).slice(0, 10) : kstFormat(ts),
      tags: classifyTags(title, fallbackCat),
    });
  });

  return out;
}

export async function fetchRssFeed(url, cat, press) {
  const xml = await fetchWithRetry(url, { timeoutMs: 7000, responseType: "text" });
  if (!xml || !xml.includes("<item")) return [];
  return parseRssXml(xml, cat, press);
}

export async function fetchGoogleNewsQuery(query, cat, { lang = "ko" } = {}) {
  const loc = lang === "en" ? "hl=en-US&gl=US&ceid=US:en" : "hl=ko&gl=KR&ceid=KR:ko";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${loc}`;
  return fetchRssFeed(url, cat);
}

/**
 * 여러 소스에서 모은 뉴스를 하나의 리스트로 합치고
 * (1) URL/제목 중복 제거, (2) 너무 오래된 기사 제거, (3) 최신순 정렬 까지 처리합니다.
 */
export function mergeAndDedupe(existingItems, newItemsBatches, { maxAgeDays = 30 } = {}) {
  const seenUrls = new Set(existingItems.map((a) => a.url));
  const seenTitles = new Set(existingItems.map((a) => a.title));
  const maxAgeMs = maxAgeDays * 86400000;
  const nowMs = Date.now();
  const merged = [...existingItems];

  for (const batch of newItemsBatches) {
    for (const item of batch) {
      if (!item.title || !item.timestamp || !isDirectArticleUrl(item.url)) continue;
      if (nowMs - item.timestamp > maxAgeMs) continue;
      if (item.timestamp > nowMs + 3600000) continue; // 미래 타임스탬프 방어
      if (seenUrls.has(item.url) || seenTitles.has(item.title)) continue;
      seenUrls.add(item.url);
      seenTitles.add(item.title);
      merged.push(item);
    }
  }

  merged.sort((a, b) => b.timestamp - a.timestamp);
  return merged;
}

/**
 * 대시보드 Top 뉴스 후보 랭킹: 태그 다양성 + 중요 카테고리 가중치 + 최신성.
 * (기존 버전의 클릭수 가중치는 서버에는 없으므로, 프론트에서 로컬 클릭 가중치를
 *  추가로 얹어 개인화합니다. 여기서는 "공통 기준선"만 계산합니다.)
 */
