import { fetchWithRetry } from "./fetchUtil.mjs";
import { fetchGoogleNewsQuery } from "./news.mjs";
import { geminiJson, GEMINI_LITE_FIRST } from "./gemini.mjs";

/**
 * 캘린더 일정의 "결과"를 수집합니다. 가능한 한 공식 출처를 쓰고, 공식 API가 없는 일정만 뉴스+AI로 정리합니다.
 *   - 미국 CPI·고용: BLS 공식 API(키 불필요)에서 지수를 받아 계산          → method "official"
 *   - FOMC: 연준 공식 보도자료(RSS → 성명서 원문)에서 결정·금리 범위 추출     → method "official"
 *   - 한은·ECB·BOJ: 발표 직후 뉴스 헤드라인을 Gemini가 정리(근거 2건 이상 필수) → method "ai-news"
 * 결과는 한 번 확정되면 다시 덮어쓰지 않습니다(발표 당시 1차 수치 보존).
 */

const pct = (x, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

/* ----------------------------- BLS (CPI · 고용) ----------------------------- */
const BLS_SERIES = {
  cpiSA: "CUSR0000SA0",
  cpiNSA: "CUUR0000SA0",
  coreSA: "CUSR0000SA0L1E",
  coreNSA: "CUUR0000SA0L1E",
  payrolls: "CES0000000001",
  unemp: "LNS14000000",
  ahe: "CES0500000003",
};
let blsCache = null;

async function loadBls() {
  if (blsCache) return blsCache;
  const y = new Date().getUTCFullYear();
  const res = await fetchWithRetry("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seriesid: Object.values(BLS_SERIES), startyear: String(y - 2), endyear: String(y) }),
    timeoutMs: 20000,
    retries: 2,
  });
  if (res?.status !== "REQUEST_SUCCEEDED") {
    console.error(`[결과-BLS] 조회 실패: ${res?.status ?? "응답 없음"} ${(res?.message ?? []).join(" ")}`);
    return (blsCache = {});
  }
  const map = {};
  for (const s of res.Results.series) {
    const key = Object.keys(BLS_SERIES).find((k) => BLS_SERIES[k] === s.seriesID);
    map[key] = {};
    for (const d of s.data) {
      const v = Number(d.value); // 미발표 월은 "-" 등으로 오므로 숫자가 아니면 건너뜀(예: 2025년 10월 셧다운으로 미발표)
      if (/^M\d\d$/.test(d.period) && d.period !== "M13" && Number.isFinite(v)) map[key][`${d.year}-${d.period.slice(1)}`] = v;
    }
  }
  return (blsCache = map);
}

function refMonthOf(ev) {
  const refM = Number(ev.meeting.match(/(\d{1,2})월/)?.[1]);
  const [ey, em] = ev.date.split("-").map(Number);
  const refY = refM > em ? ey - 1 : ey;
  return { y: refY, m: refM };
}
const ym = (y, m) => {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

async function cpiResult(ev) {
  const b = await loadBls();
  const { y, m } = refMonthOf(ev);
  const cur = ym(y, m), prev = ym(y, m - 1), yago = ym(y - 1, m);
  const v = (s, k) => b[s]?.[k];
  const has = (...xs) => xs.every((x) => Number.isFinite(x));
  // 해당 월 지수가 아직 없으면(미발표) 다음 실행 때 재시도
  if (!has(v("cpiSA", cur), v("coreSA", cur))) return null;
  const mom = has(v("cpiSA", prev), v("coreSA", prev))
    ? `전월비(계절조정): 헤드라인 ${pct(v("cpiSA", cur) / v("cpiSA", prev) - 1)}, 근원 ${pct(v("coreSA", cur) / v("coreSA", prev) - 1)}`
    : null;
  const yoyOk = has(v("cpiNSA", cur), v("cpiNSA", yago), v("coreNSA", cur), v("coreNSA", yago));
  const headline = yoyOk
    ? `헤드라인 CPI 전년비 ${pct(v("cpiNSA", cur) / v("cpiNSA", yago) - 1)} · 근원 CPI 전년비 ${pct(v("coreNSA", cur) / v("coreNSA", yago) - 1)}`
    : mom
      ? mom.replace("전월비(계절조정): ", "CPI 전월비 ")
      : null;
  if (!headline) return null;
  return {
    headline,
    details: [
      yoyOk ? mom : `전년 같은 달(${y - 1}년 ${m}월) 지수가 BLS에서 발표되지 않아 전년비는 BLS 보도자료 원문을 확인하세요.`,
      `${y}년 ${m}월 지표 · BLS 공식 지수로 계산(발표 수치와 반올림 차이가 있을 수 있음)`,
    ].filter(Boolean),
    method: "official",
    sourceName: "BLS — Consumer Price Index",
    sourceUrl: "https://www.bls.gov/cpi/",
  };
}

async function jobsResult(ev) {
  const b = await loadBls();
  const { y, m } = refMonthOf(ev);
  const cur = ym(y, m), prev = ym(y, m - 1), yago = ym(y - 1, m);
  const p = b.payrolls ?? {}, u = b.unemp ?? {}, a = b.ahe ?? {};
  if (![p[cur], p[prev], u[cur], a[cur], a[prev], a[yago]].every((x) => Number.isFinite(x))) return null;
  const chg = p[cur] - p[prev]; // 천 명 단위
  return {
    headline: `비농업 고용 ${chg >= 0 ? "+" : ""}${(chg / 10).toFixed(1)}만 명 · 실업률 ${u[cur].toFixed(1)}%`,
    details: [
      `평균 시간당 임금: 전월비 ${pct(a[cur] / a[prev] - 1)}, 전년비 ${pct(a[cur] / a[yago] - 1)}`,
      `${y}년 ${m}월 지표 · 수집 시점의 BLS 수치(이후 발표에서 수정될 수 있음)`,
    ],
    method: "official",
    sourceName: "BLS — Employment Situation",
    sourceUrl: "https://www.bls.gov/ces/",
  };
}

/* ----------------------------- FOMC (연준 공식 보도자료) ----------------------------- */
// 연준 성명서의 "3-1/2" 같은 분수 표기를 3.50 으로 변환
const frac = (s) => {
  const [w, f] = s.split("-");
  const [num, den] = f ? f.split("/").map(Number) : [0, 1];
  return (Number(w) + num / den).toFixed(2);
};

async function fomcStatementUrl(ev) {
  // 연준 성명서 주소는 날짜 규칙이 고정돼 있음(monetaryYYYYMMDDa.htm). 실패하면 RSS에서 찾음.
  const direct = `https://www.federalreserve.gov/newsevents/pressreleases/monetary${ev.date.replaceAll("-", "")}a.htm`;
  const html = await fetchWithRetry(direct, { responseType: "text", timeoutMs: 10000, retries: 1, noRetryStatuses: [404] });
  if (html && /federal funds rate/i.test(html)) return { url: direct, html };
  const rss = await fetchWithRetry("https://www.federalreserve.gov/feeds/press_monetary.xml", { responseType: "text", timeoutMs: 10000 });
  const items = rss?.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const target = items.find((it) => {
    const d = new Date(it.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "");
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === ev.date && /FOMC statement/i.test(it);
  });
  const link = target?.match(/<link>(.*?)<\/link>/)?.[1]?.trim();
  const html2 = link ? await fetchWithRetry(link, { responseType: "text", timeoutMs: 10000 }) : null;
  return html2 ? { url: link, html: html2 } : null;
}

async function fomcResult(ev) {
  const page = await fomcStatementUrl(ev);
  if (!page) return null;
  const text = page.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const rng = text.match(/target range for the federal funds rate (?:at|to) (\d+(?:-\d\/\d)?) to (\d+(?:-\d\/\d)?) percent/i);
  if (!rng) return null;
  const decision = /decided to (?:maintain|keep)/i.test(text) ? "동결" : /decided to lower/i.test(text) ? "인하" : /decided to raise/i.test(text) ? "인상" : null;
  if (!decision) return null;
  // "Voting against this action was Stephen I. Miran, who preferred ..." — 중간 이니셜의 마침표에서 잘리지 않게
  const against = text.match(/Voting against (?:the|this) action (?:were|was):? (.+?)(?:, who |; |\. [A-Z][a-z])/i)?.[1];
  return {
    headline: `기준금리 ${decision} — 연방기금금리 목표 범위 ${frac(rng[1])}~${frac(rng[2])}%`,
    details: [against ? `반대 의견: ${against.trim()}` : "반대 의견 없음(성명서 기준)"],
    method: "official",
    sourceName: "Federal Reserve — FOMC 성명서",
    sourceUrl: page.url,
  };
}

/* ----------------------------- 한은·ECB·BOJ (뉴스 + AI) ----------------------------- */
const NEWS_QUERIES = {
  bok: { q: "한국은행 기준금리 금통위", lang: "ko", who: "한국은행 금융통화위원회 기준금리 결정" },
  ecb: { q: "ECB interest rates decision deposit rate", lang: "en", who: "유럽중앙은행(ECB) 통화정책회의 금리 결정" },
  boj: { q: "일본은행 금리 결정", lang: "ko", who: "일본은행(BOJ) 금융정책결정회의 금리 결정" },
};

function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function newsAiResult(ev) {
  const cfg = NEWS_QUERIES[ev.kind];
  const from = new Date(`${ev.date}T00:00:00+09:00`).getTime() - 12 * 3600e3;
  const to = new Date(`${ev.date}T00:00:00+09:00`).getTime() + 3 * 86400e3;
  const raw = await fetchGoogleNewsQuery(`${cfg.q} after:${shiftDate(ev.date, -1)} before:${shiftDate(ev.date, 3)}`, "결과", { lang: cfg.lang });
  const heads = raw.filter((n) => n.timestamp >= from && n.timestamp <= to).slice(0, 20);
  if (heads.length < 2) return null;

  const prompt = `아래는 ${cfg.who}(${ev.date}, ${ev.meeting}) 직후 보도된 뉴스 헤드라인입니다.
헤드라인에 '명시된 내용만'으로 결정 결과를 정리하세요. 추측하지 말고, 헤드라인끼리 엇갈리거나 결과가 분명하지 않으면 found=false로 답하세요.

${heads.map((h, i) => `${i + 1}. ${h.title} (${h.press}, ${h.date})`).join("\n")}

JSON으로만 답하세요:
{"found": true|false, "decision": "동결"|"인상"|"인하", "rateAfter": "결정 후 정책금리(헤드라인에 있을 때만, 예: 연 3.00%)", "summary": "결과를 한 문장으로(헤드라인 내용 범위 안에서)", "evidence": [근거가 된 헤드라인 번호들]}`;

  const r = await geminiJson({
    prompt,
    label: `결과-${ev.kind}`,
    models: GEMINI_LITE_FIRST,
    validate: (d) => typeof d.found === "boolean",
  });
  const d = r?.data;
  if (!d?.found || !["동결", "인상", "인하"].includes(d.decision) || !Array.isArray(d.evidence) || d.evidence.length < 2) return null;
  const ev0 = heads[Number(d.evidence[0]) - 1];
  return {
    headline: `기준금리 ${d.decision}${d.rateAfter ? ` — ${d.rateAfter}` : ""}`,
    details: [d.summary, `근거 헤드라인 ${d.evidence.length}건 · 예: "${ev0?.title ?? ""}" (${ev0?.press ?? ""})`].filter(Boolean),
    method: "ai-news",
    model: r.model,
    sourceName: ev0?.press ? `${ev0.press} 외 뉴스` : "뉴스 헤드라인",
    sourceUrl: ev0?.url,
  };
}

/* ----------------------------- 진입점 ----------------------------- */
const COLLECTORS = { cpi_us: cpiResult, jobs_us: jobsResult, fomc: fomcResult, bok: newsAiResult, ecb: newsAiResult, boj: newsAiResult };
export const RESULT_KINDS = Object.keys(COLLECTORS);

/**
 * @param {Array} items  캘린더 일정(macro-events.json items)
 * @param {object} results  기존 event-results.json 의 results
 * @param {string} todayKst  YYYY-MM-DD
 * @param {number} hourKst
 */
export async function collectEventResults(items, results, todayKst, hourKst) {
  const lookbackFrom = shiftDate(todayKst, -60);
  let added = 0;
  for (const ev of items) {
    const id = ev.id ?? `${ev.date}|${ev.kind}`;
    if (!COLLECTORS[ev.kind] || results[id]?.status === "final") continue;
    if (ev.date < lookbackFrom) continue;
    // 발표가 끝난 일정만: 현지 날짜 기준 하루 지난 일정, 또는 한은·BOJ는 당일 오후부터
    const ready = ev.date < todayKst || (ev.date === todayKst && ["bok", "boj"].includes(ev.kind) && hourKst >= 15);
    if (!ready) continue;
    try {
      const r = await COLLECTORS[ev.kind](ev);
      if (r) {
        results[id] = { status: "final", ...r, collectedAt: new Date().toISOString() };
        added++;
        console.log(`[결과] ${id} → ${r.headline} (${r.method})`);
      } else {
        console.log(`[결과] ${id} → 아직 확인 불가(다음 실행 때 재시도)`);
      }
    } catch (err) {
      console.error(`[결과] ${id} 수집 오류: ${err.message}`);
    }
  }
  return added;
}
