/**
 * 공통 fetch 유틸리티
 * ---------------------------------------------------------------------------
 * 이 레포의 핵심 설계 포인트:
 *   기존 버전은 "브라우저" 안에서 corsproxy.io / allorigins.win / codetabs.com 같은
 *   공개 무료 프록시 3개를 경쟁 호출해 시세를 받아왔습니다. 이는
 *     1) 프록시가 죽거나 막히면 전체 기능이 멈추고
 *     2) 중간 서버를 신뢰해야 하며
 *     3) 매 요청마다 왕복이 느려서 로딩이 오래 걸리는
 *   구조적 문제가 있었습니다.
 *
 *   이 스크립트들은 "브라우저가 아니라 GitHub Actions 서버"에서 실행됩니다.
 *   CORS는 브라우저가 강제하는 정책이라, 서버(Node.js)에서는 CORS 제약이 전혀
 *   없습니다. 즉 프록시 자체가 필요 없습니다. → 더 빠르고, 더 안정적이고,
 *   더 정확합니다.
 * ---------------------------------------------------------------------------
 */

export async function fetchWithRetry(
  url,
  { timeoutMs = 8000, retries = 2, headers = {}, responseType = "json", method = "GET", body, backoffMs = 400, noRetryStatuses = [] } = {}
) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; WMResearchDeskBot/1.0; +https://github.com/)",
          Accept: responseType === "json" ? "application/json" : "*/*",
          ...headers,
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 서버가 돌려준 에러 메시지(예: 구글 API의 "high demand", "no longer available")를 로그에 남겨 원인 파악을 쉽게 합니다.
        const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        const httpErr = new Error(`HTTP ${res.status} (${url}) ${detail}`);
        httpErr.status = res.status;
        throw httpErr;
      }
      return responseType === "json" ? await res.json() : await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries && !noRetryStatuses.includes(err.status)) {
        // backoffMs 기본 400ms: 시세/뉴스처럼 빠르게 넘어가야 하는 호출에 적합.
        // AI 요약처럼 "503 모델 과부하" 같은 일시적 장애에 더 여유를 두고 싶으면
        // 호출하는 쪽에서 backoffMs를 더 크게 넘기면 됩니다(지수 백오프: backoffMs * 2^attempt).
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
    }
  }
  console.error(`[fetchWithRetry] 최종 실패: ${url} — ${lastErr?.message}`);
  return null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowKstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
  };
}

export function kstStamp(date = new Date()) {
  const p = nowKstParts(date);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

export function kstDateKey(date = new Date()) {
  const p = nowKstParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
