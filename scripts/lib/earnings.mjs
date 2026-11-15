import { fetchWithRetry } from "./fetchUtil.mjs";
import { listDisclosures, fetchDocumentText, dartViewerUrl, hasDartKey } from "./dart.mjs";
import { geminiJson, GEMINI_LITE_FIRST } from "./gemini.mjs";

/**
 * 코스피 시가총액 상위 10개 기업의 실적 관련 일정을 DART 공시에서 자동으로 찾아냅니다.
 *  - "결산실적공시 예고" / "기업설명회(IR) 개최"  → 공시 원문에서 예정일을 읽어 '예정 일정'으로 등록
 *  - "영업(잠정)실적(공정공시)"                   → 공시일에 '잠정실적 발표' 일정 + 결과(매출·영업이익) 등록
 * 아직 공시되지 않은 일정은 만들지 않습니다(추정 날짜 없음).
 */

/** 네이버 증권 시가총액 순위(코스피). 실패하면 직전에 저장한 목록을 그대로 씁니다. */
export async function fetchKospiTop10(previous = []) {
  const res = await fetchWithRetry("https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=15", {
    timeoutMs: 10000,
    retries: 2,
  });
  const stocks = (res?.stocks ?? [])
    .filter((s) => s.itemCode && s.stockName && !/우$|우B$|\d우$/.test(s.stockName)) // 우선주 제외
    .slice(0, 10)
    .map((s) => ({ code: s.itemCode, name: s.stockName }));
  if (stocks.length === 10) return { list: stocks, fresh: true };
  console.error(`[실적] 시총 상위 목록 조회 실패 → 직전 목록 사용 (${previous.length}개)`);
  return { list: previous, fresh: false };
}

const KST_DATE = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const yyyymmdd = (iso) => iso.replaceAll("-", "");
const isoFrom8 = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** 공시 원문에서 '일시/예정일' 다음에 나오는 첫 날짜 */
function regexEventDate(text) {
  const m = text.match(/(?:일시|일자|예정일|개최일|공시예정일)[^0-9]{0,30}(20\d{2})\s*[-.년]\s*(\d{1,2})\s*[-.월]\s*(\d{1,2})/);
  if (!m) return null;
  const time = text.slice(m.index, m.index + 120).match(/(\d{1,2})\s*[:시]\s*(\d{2})?/);
  return {
    date: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    time: time ? `${time[1].padStart(2, "0")}:${(time[2] ?? "00").padStart(2, "0")}` : "",
  };
}

async function aiEventDate(text, company) {
  const r = await geminiJson({
    label: `실적일정-${company}`,
    models: GEMINI_LITE_FIRST,
    prompt: `다음은 ${company}의 공시 원문 일부입니다. 실적 발표(또는 기업설명회) 예정 일자와 시각을 원문에 적힌 그대로 추출하세요. 원문에 없으면 found=false.
JSON으로만: {"found": true|false, "date": "YYYY-MM-DD", "time": "HH:MM 또는 빈 문자열"}

${text.slice(0, 3000)}`,
    validate: (d) => typeof d.found === "boolean",
  });
  return r?.data?.found && /^\d{4}-\d{2}-\d{2}$/.test(r.data.date) ? { date: r.data.date, time: r.data.time ?? "" } : null;
}

async function aiPrelimResult(text, company) {
  const r = await geminiJson({
    label: `잠정실적-${company}`,
    models: GEMINI_LITE_FIRST,
    prompt: `다음은 ${company}의 "영업(잠정)실적" 공시 원문입니다. 원문 표에 있는 숫자만 그대로 옮기세요. 계산하거나 추측하지 마세요.
JSON으로만: {"found": true|false, "period": "대상 기간(예: 2026년 3분기)", "revenue": "매출액(단위 포함, 예: 79.1조원)", "opIncome": "영업이익(단위 포함)", "opYoY": "영업이익 전년동기대비 증감률(원문에 있을 때만, 예: +15.2%)", "basis": "연결/별도"}

${text.slice(0, 5000)}`,
    validate: (d) => typeof d.found === "boolean",
  });
  return r?.data?.found ? r : null;
}

/**
 * @returns {{items:Array, results:object, top10:Array, note:string}}
 */
export async function collectEarnings({ previousTop10 = [], existingItems = [], existingResults = {} }) {
  const top = await fetchKospiTop10(previousTop10);
  if (!hasDartKey()) {
    return { items: existingItems, results: {}, top10: top.list, note: "DART_API_KEY 미설정 — 실적 공시 수집 생략" };
  }
  const codes = new Map(top.list.map((t) => [t.code, t.name]));
  const today = KST_DATE();
  const from = new Date(Date.now() - 21 * 86400e3);
  const list = await listDisclosures({ bgnDe: yyyymmdd(KST_DATE(from)), endDe: yyyymmdd(today) });
  console.log(`[실적] 최근 3주 거래소공시 ${list.length}건 중 시총 상위 10개 기업 공시 확인`);

  const items = new Map(existingItems.map((e) => [e.id, e]));
  const results = {};
  for (const d of list) {
    const name = codes.get(d.stock_code);
    if (!name) continue;
    const rn = d.report_nm.replace(/\s+/g, "");
    const isPrelim = /영업\(잠정\)실적/.test(rn);
    const isNotice = /결산실적공시예고/.test(rn);
    const isIR = /기업설명회\(IR\)개최/.test(rn);
    if (!isPrelim && !isNotice && !isIR) continue;

    const base = { kind: "earnings_kr", company: name, stockCode: d.stock_code, rceptNo: d.rcept_no, sourceUrl: dartViewerUrl(d.rcept_no), auto: "dart" };

    if (isPrelim) {
      const date = isoFrom8(d.rcept_dt);
      const id = `${date}|earnings_kr|${d.stock_code}|prelim`;
      items.set(id, { ...base, id, date, title: `${name} 잠정실적 발표`, meeting: d.report_nm.trim(), timeKst: `${date.slice(5).replace("-", "/")} 공시` });
      if (existingResults[id]?.status === "final") continue;
      const text = await fetchDocumentText(d.rcept_no);
      const ai = text ? await aiPrelimResult(text, name) : null;
      results[id] = ai
        ? {
            status: "final",
            headline: `${ai.data.period ?? ""} 매출 ${ai.data.revenue} · 영업이익 ${ai.data.opIncome}${ai.data.opYoY ? ` (전년비 ${ai.data.opYoY})` : ""}`.trim(),
            details: [`${ai.data.basis || "연결"} 기준 잠정실적 · 공시 원문 표에서 AI가 옮겨 적은 수치이므로 원문 확인 권장`],
            method: "ai-disclosure",
            model: ai.model,
            sourceName: `DART — ${name} ${d.report_nm.trim()}`,
            sourceUrl: dartViewerUrl(d.rcept_no),
            collectedAt: new Date().toISOString(),
          }
        : {
            status: "final",
            headline: `${name} 잠정실적 공시 — 수치는 공시 원문에서 확인`,
            details: [],
            method: "official",
            sourceName: `DART — ${d.report_nm.trim()}`,
            sourceUrl: dartViewerUrl(d.rcept_no),
            collectedAt: new Date().toISOString(),
          };
      continue;
    }

    // 예고/IR: 원문에서 예정일 추출
    if ([...items.values()].some((e) => e.rceptNo === d.rcept_no)) continue; // 이미 처리한 공시
    const text = await fetchDocumentText(d.rcept_no);
    if (!text) continue;
    const when = regexEventDate(text) ?? (await aiEventDate(text, name));
    if (!when) {
      console.log(`[실적] ${name} "${d.report_nm.trim()}" — 예정일을 찾지 못함`);
      continue;
    }
    const id = `${when.date}|earnings_kr|${d.stock_code}|${isIR ? "ir" : "notice"}`;
    items.set(id, {
      ...base,
      id,
      date: when.date,
      title: isIR ? `${name} 기업설명회(IR)` : `${name} 실적 발표 예정`,
      meeting: `${d.report_nm.trim()} (공시일 ${isoFrom8(d.rcept_dt)})`,
      timeKst: `${when.date.slice(5).replace("-", "/")}${when.time ? ` ${when.time}` : ""} (공시 기준)`,
    });
  }

  const keepFrom = KST_DATE(new Date(Date.now() - 400 * 86400e3));
  return {
    items: [...items.values()].filter((e) => e.date >= keepFrom).sort((a, b) => a.date.localeCompare(b.date)),
    results,
    top10: top.list,
    note: top.fresh ? "" : "시총 상위 목록은 직전 저장분 사용",
  };
}
