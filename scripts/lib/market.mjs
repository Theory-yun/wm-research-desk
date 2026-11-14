import { fetchWithRetry } from "./fetchUtil.mjs";
import { CORE_SYMBOLS } from "./config.mjs";

/**
 * 네이버 금융 공식 "국내지수" API (KOSPI/KOSDAQ).
 * 기존 코드에서 실제 운영 중이던 엔드포인트를 그대로 사용합니다.
 */
async function fetchNaverDomesticIndex(code) {
  const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(code)}/basic`;
  const data = await fetchWithRetry(url, { timeoutMs: 6000 });
  if (!data || data.closePrice == null) return null;

  const price = parseFloat(String(data.closePrice).replace(/,/g, ""));
  const diff = parseFloat(String(data.compareToPreviousClosePrice || "0").replace(/,/g, ""));
  const ratio = parseFloat(String(data.fluctuationsRatio || "0").replace(/,/g, ""));
  const pCode = data.compareToPreviousPrice?.code;
  const isDown =
    pCode === "5" ||
    pCode === "4" ||
    data.compareToPreviousPrice?.name === "FALLING" ||
    String(data.fluctuationsRatio).includes("-");

  if (Number.isNaN(price) || price <= 100) return null;

  return {
    price,
    diff: isDown ? -Math.abs(diff) : Math.abs(diff),
    pct: isDown ? -Math.abs(ratio) : Math.abs(ratio),
  };
}

/** 네이버 금융 공식 "해외지수" API (.INX, .IXIC, .SOX 등) */
async function fetchNaverWorldIndex(naverCode) {
  const url = `https://api.stock.naver.com/index/${encodeURIComponent(naverCode)}/basic`;
  const data = await fetchWithRetry(url, { timeoutMs: 6000 });
  if (!data || data.closePrice == null) return null;

  const price = parseFloat(String(data.closePrice).replace(/,/g, ""));
  const diff = parseFloat(String(data.compareToPreviousClosePrice || "0").replace(/,/g, ""));
  const ratio = parseFloat(String(data.fluctuationsRatio || "0").replace(/,/g, ""));
  const pCode = data.compareToPreviousPrice?.code;
  const isDown =
    pCode === "5" ||
    pCode === "4" ||
    data.compareToPreviousPrice?.name === "FALLING" ||
    String(data.fluctuationsRatio).includes("-");

  if (Number.isNaN(price) || price <= 100) return null;

  return {
    price,
    diff: isDown ? -Math.abs(diff) : Math.abs(diff),
    pct: isDown ? -Math.abs(ratio) : Math.abs(ratio),
    timestampSec: data.localTradedAt ? Math.floor(new Date(data.localTradedAt).getTime() / 1000) : null,
  };
}

/** Yahoo Finance 차트 API — 네이버에 없는 FX 등과, 위 두 API 실패 시의 공통 폴백 */
async function fetchYahooMeta(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const json = await fetchWithRetry(url, { timeoutMs: 8000 });
  const result = json?.chart?.result?.[0];
  if (!result?.meta) return null;

  const cur = result.meta.regularMarketPrice;
  const prev = result.meta.chartPreviousClose ?? result.meta.previousClose;
  if (cur == null || prev == null) return null;

  const diff = cur - prev;
  const pct = prev ? (diff / prev) * 100 : 0;
  return { price: cur, diff, pct, timestampSec: result.meta.regularMarketTime ?? null };
}

function formatNum(n, minDec = 2, maxDec = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: minDec, maximumFractionDigits: maxDec });
}

/**
 * 미국 종가 기준 "현지시간 / 한국시간(KST)" 듀얼 표기를 계산합니다.
 */
function dualCloseTimeLabel(timestampSec) {
  if (!timestampSec) return { local: "현지 마감 기준", kst: "한국시간 기준" };
  const dt = new Date(timestampSec * 1000);
  const nyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "short",
  }).formatToParts(dt);
  const get = (t) => nyParts.find((p) => p.type === t)?.value;
  const nyY = parseInt(get("year") || "2026", 10);
  const nyM = parseInt(get("month") || "1", 10);
  const nyD = parseInt(get("day") || "1", 10);
  const tzName = get("timeZoneName") || "EST";

  const kstNext = new Date(nyY, nyM - 1, nyD + 1);
  const kstHour = tzName.includes("EDT") ? "05:00" : "06:00";

  return {
    local: `현지 ${String(nyM).padStart(2, "0")}.${String(nyD).padStart(2, "0")} 16:00 마감`,
    kst: `한국 ${String(kstNext.getMonth() + 1).padStart(2, "0")}.${String(kstNext.getDate()).padStart(2, "0")} ${kstHour} 마감`,
  };
}

/**
 * 핵심 6개 지표를 전부 수집합니다.
 * 각 항목마다 성공/실패 여부를 명시적으로 남겨서(stale 플래그),
 * 프론트엔드가 "갱신 실패 시 이전 값을 보여주는 중" 임을 숨기지 않고 투명하게 표시할 수 있게 합니다.
 *
 * @param {object} previousMarket 이전 실행에서 저장된 market 배열(실패 시 폴백용). 없으면 빈 배열.
 */
export async function collectCoreMarket(previousMarket = []) {
  const prevByKey = Object.fromEntries((previousMarket || []).map((m) => [m.key, m]));
  const nowIso = new Date().toISOString();

  const results = await Promise.all(
    CORE_SYMBOLS.map(async (sym) => {
      let quote = null;
      let dual = null;

      if (sym.naverDomesticCode) {
        quote = await fetchNaverDomesticIndex(sym.naverDomesticCode);
        dual = { local: "국내 정규장 기준", kst: "한국 정규장 15:30 마감" };
      } else if (sym.naverWorldCode) {
        quote = await fetchNaverWorldIndex(sym.naverWorldCode);
        if (quote?.timestampSec) dual = dualCloseTimeLabel(quote.timestampSec);
      }

      // 네이버 조회 실패 시 Yahoo로 폴백 (지수/환율 공통)
      if (!quote) {
        quote = await fetchYahooMeta(sym.yahooSymbol);
        if (quote?.timestampSec && sym.group === "global") {
          dual = dualCloseTimeLabel(quote.timestampSec);
        }
      }

      if (!quote) {
        // 모든 소스 실패 → 거짓으로 "실시간처럼" 보이는 값을 만들지 않고,
        // 이전에 성공했던 값을 stale=true로 표시해 그대로 유지합니다.
        const prev = prevByKey[sym.key];
        if (prev) {
          return { ...prev, stale: true, staleSince: nowIso };
        }
        return {
          key: sym.key,
          name: sym.name,
          group: sym.group,
          priceStr: "—",
          diffStr: "—",
          changePct: 0,
          asOfLocal: "데이터 없음",
          asOfKst: "데이터 없음",
          stale: true,
          staleSince: nowIso,
        };
      }

      const isUp = quote.diff >= 0;
      return {
        key: sym.key,
        name: sym.name,
        group: sym.group,
        priceStr: formatNum(quote.price, quote.price >= 1000 ? 2 : 2),
        diffStr: `${isUp ? "▲ +" : "▼ -"}${formatNum(Math.abs(quote.diff))}`,
        changePct: Number(quote.pct.toFixed(2)),
        asOfLocal: dual?.local ?? "집계 기준 확인 중",
        asOfKst: dual?.kst ?? "집계 기준 확인 중",
        stale: false,
        updatedAt: nowIso,
      };
    })
  );

  return results;
}
