import fs from "node:fs";
import path from "node:path";
import { geminiJson } from "./gemini.mjs";

/**
 * "자산배분 모델별 점검" — 매 브리핑마다 자동 생성
 *   예시 배분 모델(안전 추구형 7:2:1 · 표준형 3:4:3 · 공격형 1:4:5) 각각의 비율을 고정 원칙으로 두고,
 *   비율을 바꾸라는 의견 대신 "오늘 시장이 각 바구니에 주는 시사점과 확인할 것"을 제시합니다.
 *
 * 1) 근거(결정적·검증 가능): 자산군별로 그날 시세 변동, 14일 내 관련 일정(D-day), 관련 필독 뉴스(보도 언론사 수)를 붙임
 * 2) 점검 강도: 근거 수치로 규칙에 따라 "변동 큼 / 주목 / 평이" 결정 (AI가 정하지 않음)
 * 3) 문구: Gemini가 근거만 사용해 '무엇을 확인할지'를 작성. 매수·매도·비중 조절 같은 투자 의견은 금지,
 *    금지 표현이 섞이면 그 카드는 규칙 기반 문구로 대체
 */

/**
 * 자산별 시사점 — 매 브리핑마다 자동 생성 (배분 비율과 무관)
 *   자산군마다 시세(추가 지표 포함) · 관련 뉴스(보도 언론사 수) · 다가오는 일정을 모아
 *   Gemini가 '무슨 일이 있었고 왜 그런지, 앞으로 볼 변수'를 정리합니다. 투자 의견·권유 표현은 금지.
 */
export const ASSET_CLASSES = [
  { key: "kr_equity", name: "국내 주식", market: ["KOSPI", "KOSDAQ"], tags: ["증시"], scope: "국내",
    kinds: ["kr_expiry", "kr_quad", "kospi200_rebal", "msci_announce", "msci_effective", "earnings_kr", "bok", "kr_late_open", "kr_holiday"] },
  { key: "us_equity", name: "해외 주식", market: ["SP500", "NASDAQ", "SOX"], tags: ["증시"], scope: "해외",
    kinds: ["us_opex", "us_quad", "fomc", "cpi_us", "jobs_us", "us_holiday", "us_early_close"] },
  { key: "bonds", name: "채권·금리", market: ["US10Y", "US5Y"], tags: ["채권·금리", "매크로"],
    kinds: ["fomc", "bok", "ecb", "boj", "cpi_us", "jobs_us"] },
  { key: "fx", name: "외환", market: ["USDKRW", "DXY", "USDJPY"], tags: ["외환"],
    kinds: ["fomc", "bok", "boj"] },
  { key: "commodities", name: "원자재", market: ["GOLD", "WTI"], tags: ["원자재"], kinds: [] },
  { key: "alternatives", name: "부동산·대체투자", market: ["BTC"], tags: ["부동산", "대체투자"], kinds: [] },
];
// 이전 브리핑(배분 모델 방식)과의 호환용 — 더 이상 화면에서 쓰지 않음
export const ALLOCATION_MODELS = [];

const TAX_TAGS = ["부동산", "TAX"];

const FALLBACK_WATCH = "관련 일정과 보도 흐름을 이어서 확인할 필요가 있습니다.";

// 투자 권유로 읽힐 수 있는 표현 — AI 문구에 섞이면 해당 카드는 규칙 기반 문구로 대체
// 투자 권유로 읽힐 수 있는 표현 — "매매 행위 + 권유형 어미" 조합이나 명시적 추천만 잡습니다.
// ("외국인 순매도"처럼 사실을 전하는 표현은 허용, "비중을 줄이세요/편입을 검토하세요"는 차단)
const ADVICE =
  /(매수|매도|편입|비중\s?(확대|축소|조절)|비중을?\s?(늘|줄)|차익\s?실현|손절|교체|청산|담)[가-힣\s]{0,10}(하세요|하십시오|권합니다|권고|권유|추천|바람직|고려하|검토하|하는 것이 좋|할 것을)|비중을?\s?(늘|줄)[가-힣]{0,3}(세요|십시오)|추천합니다|권유합니다|권고합니다|사세요|파세요/;

const RATE_KINDS = new Set(["fomc", "bok", "ecb", "boj"]);
const WD = "일월화수목금토";

function readJson(p, fb) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fb;
  }
}

export function upcomingEvents(dataDir, todayIso, days = 14) {
  const macro = readJson(path.join(dataDir, "macro-events.json"), { kinds: {}, items: [] });
  const auto = readJson(path.join(dataDir, "auto-events.json"), { items: [] });
  const end = new Date(`${todayIso}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const endIso = end.toISOString().slice(0, 10);
  return [...macro.items, ...auto.items]
    .filter((e) => e.date >= todayIso && e.date <= endIso)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      const dday = Math.round((new Date(`${e.date}T00:00:00Z`) - new Date(`${todayIso}T00:00:00Z`)) / 86400e3);
      const d = new Date(`${e.date}T00:00:00Z`);
      return {
        date: e.date,
        kind: e.kind,
        dday,
        label: e.title ?? macro.kinds[e.kind]?.name ?? e.kind,
        when: `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`,
      };
    });
}

/** 점검 강도(규칙, AI가 정하지 않음): 시세 변동 폭·일정 임박도·보도량 */
function levelOf(cls, { marketLines, events, news }) {
  const maxMove = Math.max(0, ...marketLines.map((m) => Math.abs(m.changePct ?? 0)));
  const big = { kr_equity: 2, us_equity: 2, bonds: 2.5, fx: 1, commodities: 2.5, alternatives: 5 }[cls.key] ?? 2;
  const soon = events.some((e) => e.dday <= 3);
  const hot = Math.max(0, ...news.map((n) => n.coverage ?? 1));
  if (maxMove >= big) return "변동 큼";
  if (maxMove >= big / 2 || soon || hot >= 5) return "주목";
  return "평이";
}

const fmtChg = (m) => m.chgStr ?? `${m.changePct >= 0 ? "+" : ""}${m.changePct}%`;

export async function buildAssetChecks({ edition, market, extraMarket = [], stories, dataDir, sessionContext = "" }) {
  const todayIso = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const events = upcomingEvents(dataDir, todayIso);
  const allMarket = [...market, ...extraMarket].filter((m) => !m.stale);
  const pickNews = (cls, n) =>
    stories
      .filter((x) => (x.tags ?? []).some((t) => cls.tags.includes(t)) && (!cls.scope || !x.scope || x.scope === cls.scope))
      .sort((a, b) => (b.coverage ?? 1) - (a.coverage ?? 1))
      .slice(0, n)
      .map((x) => ({ title: x.title, url: x.url, press: x.press, coverage: x.coverage ?? 1 }));

  const used = new Set(); // 같은 뉴스가 여러 자산에 중복으로 붙지 않게
  const cards = ASSET_CLASSES.map((cls) => {
    const marketLines = allMarket.filter((m) => cls.market.includes(m.key));
    const evs = events.filter((e) => cls.kinds.includes(e.kind)).slice(0, 3);
    const pool = pickNews(cls, 8);
    const news = pool.filter((x) => !used.has(x.url)).slice(0, 4);
    news.slice(0, 2).forEach((x) => used.add(x.url));
    const card = {
      key: cls.key,
      name: cls.name,
      market: marketLines.map((m) => ({ key: m.key, name: m.name, priceStr: m.priceStr, changePct: m.changePct, unit: m.unit ?? "", ...(m.chgStr ? { chgStr: m.chgStr } : {}) })),
      events: evs,
      news,
    };
    card.level = levelOf(cls, { marketLines, events: evs, news });
    return card;
  });

  // 2곳 이상 보도된 것만, 자격시험·인사 등 자산가 세무와 무관한 기사 제외(잡음 방지)
  const taxNews = stories
    .filter((x) => (x.tags ?? []).some((t) => TAX_TAGS.includes(t)))
    .sort((a, b) => (b.coverage ?? 1) - (a.coverage ?? 1))
    .map((x) => ({ title: x.title, url: x.url, press: x.press, coverage: x.coverage ?? 1 }))
    .filter((n) => n.coverage >= 2 && !/세무사|시험|합격|채용|인사|임명|선임/.test(n.title))
    .slice(0, 2);

  const brief = cards
    .map((c) => {
      const lines = [
        ...c.market.map((m) => `시세: ${m.name} ${m.priceStr}${m.unit} (${fmtChg(m)})`),
        ...c.events.map((e) => `일정: ${e.when} D-${e.dday} ${e.label}`),
        ...c.news.map((n) => `뉴스: ${n.title} (${n.coverage}개 언론 보도)`),
      ];
      return `[${c.key}] ${c.name} / 점검 강도: ${c.level}\n${lines.length ? lines.join("\n") : "(특이 근거 없음)"}`;
    })
    .join("\n\n");

  const r = await geminiJson({
    label: `${edition} 자산별 시사점`,
    prompt: `당신은 패밀리오피스 PB의 리서치 애널리스트입니다. 아래 자산군별 근거(시세·뉴스·일정)를 분석해
고액자산가 손님과 상담할 때 쓸 '자산별 시사점'을 작성하세요.

${sessionContext}

규칙:
- 근거에 있는 숫자·사실만 사용하고, 없는 숫자를 만들지 마세요. 자산군 사이의 연결(예: 금리 ↔ 달러 ↔ 성장주)을 짚어 주면 좋습니다.
- 매수·매도·비중 확대/축소·추천 등 투자 의견이나 권유 표현은 쓰지 마세요. 현상·원인·앞으로 볼 변수만 쓰세요.
- 매일 같은 말이 반복되지 않도록, 그날 근거에서 가장 두드러진 점을 중심으로 쓰세요.
- 각 자산군마다:
  · headline: 핵심 한 줄(40자 이내)
  · analysis: 무슨 일이 있었고 왜 그런지 2~3문장 (숫자 근거 포함)
  · watch: 앞으로 볼 변수 1문장 (일정이 있으면 날짜 포함)
- 근거가 거의 없으면 headline은 "뚜렷한 신호 없음"으로 쓰고 analysis는 한 문장으로 짧게.

${brief}

JSON으로만:
{${ASSET_CLASSES.map((c) => `"${c.key}": {"headline": "", "analysis": "", "watch": ""}`).join(", ")}}`,
    validate: (d) => ASSET_CLASSES.filter((c) => d?.[c.key]?.headline).length >= 4,
  });

  let aiUsed = 0;
  for (const c of cards) {
    const ai = r?.data?.[c.key];
    const joined = ai ? `${ai.headline} ${ai.analysis} ${ai.watch}` : "";
    if (ai?.headline && ai?.analysis && !ADVICE.test(joined)) {
      Object.assign(c, { headline: String(ai.headline).slice(0, 60), analysis: String(ai.analysis), watch: String(ai.watch || FALLBACK_WATCH), textBy: "ai" });
      aiUsed++;
    } else {
      if (ai && ADVICE.test(joined)) console.log(`[자산별 시사점] ${c.name}: 권유 표현이 섞여 규칙 기반 문구로 대체`);
      const m = c.market[0];
      const e = c.events[0];
      Object.assign(c, {
        headline: m ? `${m.name} ${fmtChg(m)}` : c.news[0]?.title ?? "뚜렷한 신호 없음",
        analysis: [c.market.map((x) => `${x.name} ${x.priceStr}${x.unit}(${fmtChg(x)})`).join(", "), c.news[0] ? `주요 보도: ${c.news[0].title}` : ""].filter(Boolean).join(". "),
        watch: e ? `${e.when} ${e.label}` : FALLBACK_WATCH,
        textBy: "rule",
      });
    }
  }
  console.log(`[자산별 시사점] ${cards.length}개 자산군 (AI 문구 ${aiUsed}/${cards.length}${r ? `, ${r.model}` : ""})`);
  return { framework: "assets", generatedAt: new Date().toISOString(), model: r?.model ?? null, cards, taxNews };
}
