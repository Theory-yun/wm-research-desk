import fs from "node:fs";
import path from "node:path";
import { geminiJson } from "./gemini.mjs";

/**
 * "오늘의 자산군별 점검 포인트" — 매 브리핑마다 자동 생성
 *
 * 1) 근거(결정적·검증 가능): 자산군별로 그날 시세 변동, 14일 내 관련 일정(D-day), 관련 필독 뉴스(보도 언론사 수)를 붙임
 * 2) 점검 강도: 근거 수치로 규칙에 따라 "변동 큼 / 주목 / 평이" 결정 (AI가 정하지 않음)
 * 3) 문구: Gemini가 근거만 사용해 '무엇을 확인할지'를 작성. 매수·매도·비중 조절 같은 투자 의견은 금지,
 *    금지 표현이 섞이면 그 카드는 규칙 기반 문구로 대체
 */

export const ASSET_GROUPS = [
  { key: "bond", name: "채권·금리", icon: "🏦", tags: ["채권·금리"], kinds: ["fomc", "bok", "ecb", "boj", "cpi_us"], market: [] },
  {
    key: "equity",
    name: "주식",
    icon: "📈",
    tags: ["증시"],
    kinds: ["kr_quad", "kr_expiry", "us_quad", "us_opex", "msci_announce", "msci_effective", "kospi200_rebal", "earnings_kr", "jobs_us"],
    market: ["KOSPI", "KOSDAQ", "SP500", "NASDAQ", "SOX"],
  },
  { key: "fx", name: "외환", icon: "💱", tags: ["외환"], kinds: ["fomc", "bok", "boj", "ecb"], market: ["USDKRW"] },
  { key: "commodity", name: "원자재·대체투자", icon: "🛢️", tags: ["원자재", "대체투자"], kinds: [], market: [] },
  { key: "estate_tax", name: "부동산·세무", icon: "🏢", tags: ["부동산", "TAX"], kinds: [], market: [] },
];

const FALLBACK_CHECK = {
  bond: "보유 채권의 만기·듀레이션과 금리 변동에 따른 평가손익 민감도를 확인하세요.",
  equity: "보유 종목·업종의 편중도와 관련 일정 전후의 변동성 노출을 확인하세요.",
  fx: "외화자산 비중, 환헤지 여부, 환율 변동에 따른 원화 환산 손익을 확인하세요.",
  commodity: "원자재·대체투자 상품의 비중과 환매 조건(유동성)을 확인하세요.",
  estate_tax: "보유 부동산 관련 정책 변화가 증여·상속 계획 일정에 주는 영향을 확인하세요.",
};

// 투자 권유로 읽힐 수 있는 표현 — AI 문구에 섞이면 해당 카드는 규칙 기반 문구로 대체
const ADVICE = /매수|매도|비중\s?(확대|축소|조절|늘|줄)|추천|사세요|파세요|사야|팔아야|권유|담으세요|편입하세요|정리하세요|차익\s?실현하세요/;

const RATE_KINDS = new Set(["fomc", "bok", "ecb", "boj"]);
const WD = "일월화수목금토";

function readJson(p, fb) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fb;
  }
}

function upcomingEvents(dataDir, todayIso, days = 14) {
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

function levelOf(group, { marketLines, events, news }) {
  const maxMove = Math.max(0, ...marketLines.map((m) => Math.abs(m.changePct ?? 0)));
  const soonRate = events.some((e) => e.dday <= 3 && (RATE_KINDS.has(e.kind) || e.kind === "cpi_us"));
  const soonAny = events.some((e) => e.dday <= 3);
  const hot = Math.max(0, ...news.map((n) => n.coverage ?? 1));
  if (group.key === "equity") return maxMove >= 2 ? "변동 큼" : maxMove >= 1 || soonAny || hot >= 10 ? "주목" : "평이";
  if (group.key === "fx") return maxMove >= 1 ? "변동 큼" : maxMove >= 0.5 || soonRate || hot >= 5 ? "주목" : "평이";
  if (group.key === "bond") return soonRate || hot >= 5 ? "주목" : "평이";
  return hot >= 5 ? "주목" : "평이";
}

export async function buildAssetChecks({ edition, market, stories, dataDir }) {
  const todayIso = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const events = upcomingEvents(dataDir, todayIso);

  const cards = ASSET_GROUPS.map((g) => {
    const marketLines = market.filter((m) => g.market.includes(m.key) && !m.stale);
    const evs = events.filter((e) => g.kinds.includes(e.kind)).slice(0, 3);
    const news = stories
      .filter((n) => (n.tags ?? []).some((t) => g.tags.includes(t)))
      .sort((a, b) => (b.coverage ?? 1) - (a.coverage ?? 1))
      .slice(0, 2)
      .map((n) => ({ title: n.title, url: n.url, press: n.press, coverage: n.coverage ?? 1 }));
    const card = {
      key: g.key,
      name: g.name,
      icon: g.icon,
      market: marketLines.map((m) => ({ name: m.name, priceStr: m.priceStr, changePct: m.changePct })),
      events: evs,
      news,
    };
    card.level = levelOf(g, { marketLines, events: evs, news });
    return card;
  });

  // ---- 문구 생성 (AI → 실패/금지 표현 시 규칙 기반) ----
  const brief = cards
    .map((c) => {
      const lines = [
        ...c.market.map((m) => `시세: ${m.name} ${m.priceStr} (${m.changePct >= 0 ? "+" : ""}${m.changePct}%)`),
        ...c.events.map((e) => `일정: ${e.when} D-${e.dday} ${e.label}`),
        ...c.news.map((n) => `뉴스: ${n.title} (${n.coverage}개 언론 보도)`),
      ];
      return `[${c.key}] ${c.name} — 점검 강도: ${c.level}\n${lines.length ? lines.join("\n") : "(특이 근거 없음)"}`;
    })
    .join("\n\n");

  const r = await geminiJson({
    label: `${edition} 자산군 점검`,
    prompt: `당신은 패밀리오피스 PB의 리서치 보조입니다. 아래 자산군별 '근거'만 사용해서, PB가 오늘 손님 포트폴리오에서 무엇을 확인해야 하는지 정리하세요.

규칙:
- 근거에 없는 숫자·사실을 만들지 마세요.
- 매수·매도·비중 확대/축소·추천 등 투자 의견이나 권유 표현은 절대 쓰지 마세요. '확인할 것', '점검할 것'만 쓰세요.
- headline: 오늘 이 자산군에서 주목할 점 한 줄(35자 이내, 근거의 일정·수치를 활용)
- check: PB가 손님 포트폴리오에서 확인할 구체적 항목 1~2문장
- 근거가 없으면 headline은 "특이 신호 없음 — 정기 점검 유지"로 쓰세요.

${brief}

JSON 배열로만: [{"key": "bond|equity|fx|commodity|estate_tax", "headline": "...", "check": "..."}]`,
    validate: (d) => Array.isArray(d) && d.length >= 3,
  });

  const aiByKey = new Map((r?.data ?? []).map((x) => [x.key, x]));
  let aiUsed = 0;
  for (const c of cards) {
    const ai = aiByKey.get(c.key);
    if (ai?.headline && ai?.check && !ADVICE.test(`${ai.headline} ${ai.check}`)) {
      c.headline = String(ai.headline).slice(0, 60);
      c.check = String(ai.check);
      c.textBy = "ai";
      aiUsed++;
    } else {
      if (ai && ADVICE.test(`${ai.headline} ${ai.check}`)) console.log(`[자산군 점검] ${c.name}: 투자 의견 표현이 섞여 규칙 기반 문구로 대체`);
      const e = c.events[0];
      c.headline = e ? `${e.label} ${e.dday === 0 ? "오늘" : `D-${e.dday}`}` : c.news[0]?.title ?? "특이 신호 없음 — 정기 점검 유지";
      c.check = FALLBACK_CHECK[c.key];
      c.textBy = "rule";
    }
  }
  console.log(`[자산군 점검] 카드 ${cards.length}개 (AI 문구 ${aiUsed}개${r ? `, ${r.model}` : ""})`);
  return { generatedAt: new Date().toISOString(), model: r?.model ?? null, cards };
}
