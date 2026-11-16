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

  // 장 시작 전(동시호가 등)에는 '오늘 세션'으로 넘어가 등락이 0으로 표시됨 →
  // 마지막으로 마감한 거래일의 종가·등락을 일별 시세에서 가져옴
  const status = String(data.marketStatus || "").toUpperCase();
  const notClosed = status && status !== "CLOSE";
  if (notClosed || (diff === 0 && ratio === 0)) {
    const last = await fetchNaverDomesticLastClose(code);
    if (last) return last;
  }
  return {
    price,
    diff: isDown ? -Math.abs(diff) : Math.abs(diff),
    pct: isDown ? -Math.abs(ratio) : Math.abs(ratio),
    tradeDate: String(data.localTradedAt || "").slice(0, 10) || null,
  };
}

/** 일별 시세에서 '오늘(KST) 이전'의 가장 최근 마감 거래일 */
async function fetchNaverDomesticLastClose(code) {
  const url = `https://m.stock.naver.com/api/index/${encodeURIComponent(code)}/price?pageSize=5&page=1`;
  const rows = await fetchWithRetry(url, { timeoutMs: 6000 });
  if (!Array.isArray(rows)) return null;
  const todayKst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const row = rows.find((r) => String(r.localTradedAt || "").slice(0, 10) < todayKst);
  if (!row) return null;
  const num = (v) => parseFloat(String(v ?? "").replace(/,/g, ""));
  const price = num(row.closePrice);
  const diffAbs = Math.abs(num(row.compareToPreviousClosePrice));
  const pctRaw = num(row.fluctuationsRatio);
  if (Number.isNaN(price) || price <= 100 || Number.isNaN(diffAbs)) return null;
  const down = row.compareToPreviousPrice?.code === "5" || row.compareToPreviousPrice?.code === "4" || pctRaw < 0 ||
    String(row.compareToPreviousClosePrice).trim().startsWith("-");
  console.log(`[국내지수] ${code}: 장 시작 전이라 ${String(row.localTradedAt).slice(0, 10)} 마감 종가 사용`);
  return { price, diff: down ? -diffAbs : diffAbs, pct: down ? -Math.abs(pctRaw) : Math.abs(pctRaw), tradeDate: String(row.localTradedAt).slice(0, 10) };
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
  // chartPreviousClose는 '조회 기간(5일) 시작 전' 종가라 전일 대비가 아님 →
  // 일봉 종가 배열에서 마지막 거래일 직전 종가를 사용
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((v) => Number.isFinite(v));
  let prev = null;
  if (closes.length >= 2) {
    const last = closes[closes.length - 1];
    // 마지막 봉 = 현재가(오늘/마지막 거래일 봉) → 그 전 봉이 전일 종가
    // 마지막 봉이 현재가와 다르면(오늘 봉이 아직 없음) 마지막 봉이 전일 종가
    prev = Math.abs(last - cur) / Math.max(1e-9, Math.abs(cur)) < 0.003 ? closes[closes.length - 2] : last;
  }
  prev = prev ?? result.meta.previousClose ?? null;
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
        const md = quote?.tradeDate ? ` ${quote.tradeDate.slice(5, 7)}.${quote.tradeDate.slice(8, 10)}` : "";
        dual = { local: "국내 정규장 기준", kst: `한국 정규장${md} 15:30 마감` };
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

/**
 * 자산별 시사점 분석용 추가 지표 (화면 타일에는 쓰지 않음).
 * Yahoo Finance 일봉 메타 — 실패한 항목은 조용히 빠집니다(분석은 있는 근거로만 진행).
 */
const EXTRA_SYMBOLS = [
  { key: "US10Y", name: "미 10년물 금리", yahoo: "^TNX", unit: "%", dec: 2 },
  { key: "US5Y", name: "미 5년물 금리", yahoo: "^FVX", unit: "%", dec: 2 },
  { key: "DXY", name: "달러인덱스", yahoo: "DX-Y.NYB", unit: "", dec: 2 },
  { key: "USDJPY", name: "엔/달러", yahoo: "JPY=X", unit: "엔", dec: 2 },
  { key: "GOLD", name: "금", yahoo: "GC=F", unit: "달러", dec: 1 },
  { key: "WTI", name: "WTI 유가", yahoo: "CL=F", unit: "달러", dec: 2 },
  { key: "BTC", name: "비트코인", yahoo: "BTC-USD", unit: "달러", dec: 0 },
];

export async function collectExtraMarket() {
  const out = await Promise.all(
    EXTRA_SYMBOLS.map(async (s) => {
      try {
        const q = await fetchYahooMeta(s.yahoo);
        if (!q || !Number.isFinite(q.price)) return null;
        return {
          key: s.key, name: s.name, unit: s.unit,
          priceStr: formatNum(q.price, s.dec, s.dec),
          changePct: Number(q.pct.toFixed(2)),
          diff: Number(q.diff.toFixed(s.dec + 1)),
          // 금리는 등락률(%)보다 bp 변화가 의미 있음: 5.10% → 5.15% = +5bp
          ...(s.unit === "%" ? { chgStr: `${q.diff >= 0 ? "+" : ""}${Math.round(q.diff * 100)}bp` } : {}),
          stale: false,
        };
      } catch {
        return null;
      }
    })
  );
  const ok = out.filter(Boolean);
  console.log(`[추가 지표] ${ok.length}/${EXTRA_SYMBOLS.length}개 수집: ${ok.map((m) => `${m.name} ${m.priceStr}${m.unit}(${m.chgStr ?? `${m.changePct}%`})`).join(", ")}`);
  return ok;
}
