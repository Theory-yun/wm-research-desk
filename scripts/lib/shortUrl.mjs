/**
 * 카톡 공유용 단축 URL.
 * 1순위 is.gd, 실패 시 TinyURL (둘 다 API 키 불필요). 모두 실패하면 원문 URL 그대로 사용.
 * 같은 기사 URL은 이전 브리핑에서 만든 단축 URL을 재사용합니다(cache).
 */
import { fetchWithRetry } from "./fetchUtil.mjs";

const SERVICES = [
  (u) => `https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}`,
  (u) => `https://tinyurl.com/api-create.php?url=${encodeURIComponent(u)}`,
];

export async function shortenUrl(url) {
  if (!/^https?:\/\//.test(url || "")) return null;
  for (const make of SERVICES) {
    try {
      const out = String(await fetchWithRetry(make(url), { responseType: "text", timeoutMs: 8000, retries: 1 })).trim();
      if (/^https:\/\/\S{8,40}$/.test(out)) return out;
    } catch (e) {
      console.log(`[단축 URL] ${make(url).split("/")[2]} 실패: ${e.message?.slice(0, 80)}`);
    }
  }
  return null;
}

/** items 각각에 shortUrl을 붙입니다. cache: Map(url → shortUrl) */
export async function attachShortUrls(items, cache = new Map()) {
  let made = 0, reused = 0;
  for (const n of items) {
    if (cache.has(n.url)) { n.shortUrl = cache.get(n.url); reused++; continue; }
    const s = await shortenUrl(n.url);
    if (s) { n.shortUrl = s; cache.set(n.url, s); made++; }
  }
  console.log(`[단축 URL] 신규 ${made}건 · 재사용 ${reused}건 · 실패 ${items.length - made - reused}건`);
  return items;
}
