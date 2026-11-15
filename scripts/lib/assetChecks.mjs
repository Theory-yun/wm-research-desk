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
 * 예시 배분 모델 (안전자산 : 시장 추종 : 초과 수익) — 화면에서 사용자가 선택
 * 손님 성향 판정이 아니라 예시 모델이며, 실제 적용은 손님 투자성향 진단 결과에 맞춰야 합니다.
 */
export const ALLOCATION_MODELS = [
  { key: "conservative", name: "안전 추구형", icon: "🛡️", ratios: { safe: 70, core: 20, satellite: 10 } },
  { key: "standard", name: "표준형", icon: "⚖️", ratios: { safe: 30, core: 40, satellite: 30 } },
  { key: "aggressive", name: "공격형", icon: "🚀", ratios: { safe: 10, core: 40, satellite: 50 } },
];

export const ASSET_GROUPS = [
  {
    key: "safe",
    name: "안전자산",
    target: 30,
    icon: "🛡️",
    role: "예금·국채·우량채·달러·금 등 자산을 지키는 바구니",
    tags: ["채권·금리", "외환"],
    kinds: ["fomc", "bok", "ecb", "boj", "cpi_us", "jobs_us"],
    market: ["USDKRW"],
  },
  {
    key: "core",
    name: "시장 추종",
    target: 40,
    icon: "📊",
    role: "국내·해외 지수 ETF·분산 펀드로 시장 수익을 따라가는 바구니",
    tags: ["증시", "매크로"],
    kinds: ["kr_quad", "kr_expiry", "us_quad", "us_opex", "msci_announce", "msci_effective", "kospi200_rebal"],
    market: ["KOSPI", "KOSDAQ", "SP500", "NASDAQ"],
  },
  {
    key: "satellite",
    name: "초과 수익",
    target: 30,
    icon: "🚀",
    role: "개별 종목·테마·원자재·대체투자로 추가 수익을 노리는 바구니",
    tags: ["원자재", "대체투자"],
    kinds: ["earnings_kr"],
    market: ["SOX"],
  },
];
const TAX_TAGS = ["부동산", "TAX"];

const FALLBACK = {
  safe: { insight: "금리·환율 관련 일정과 뉴스를 확인하세요.", check: "보유 채권의 만기·듀레이션, 외화자산의 환헤지 여부와 원화 환산 손익을 확인하세요." },
  core: { insight: "주요 지수 흐름과 만기·지수 변경 일정을 확인하세요.", check: "지수형 상품의 국가·업종 분산 상태와 배분 모델 기준 비중 이탈 여부를 확인하세요." },
  satellite: { insight: "개별 종목·테마·대체투자 관련 일정과 뉴스를 확인하세요.", check: "종목·테마 집중도와 대체투자 상품의 환매 조건(유동성)을 확인하세요." },
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
  const move = (k) => Math.abs(marketLines.find((m) => m.key === k)?.changePct ?? 0);
  const maxMove = Math.max(0, ...marketLines.map((m) => Math.abs(m.changePct ?? 0)));
  const soon = (pred) => events.some((e) => e.dday <= 3 && pred(e));
  const hot = Math.max(0, ...news.map((n) => n.coverage ?? 1));
  if (group.key === "safe")
    return move("USDKRW") >= 1 ? "변동 큼" : move("USDKRW") >= 0.5 || soon((e) => RATE_KINDS.has(e.kind) || e.kind === "cpi_us") || hot >= 5 ? "주목" : "평이";
  if (group.key === "core") return maxMove >= 2 ? "변동 큼" : maxMove >= 1 || soon(() => true) || hot >= 10 ? "주목" : "평이";
  return move("SOX") >= 3 ? "변동 큼" : move("SOX") >= 1.5 || soon(() => true) || hot >= 5 ? "주목" : "평이";
}

export async function buildAssetChecks({ edition, market, stories, dataDir }) {
  const todayIso = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const events = upcomingEvents(dataDir, todayIso);
  const newsFor = (tags, n = 2) =>
    stories
      .filter((x) => (x.tags ?? []).some((t) => tags.includes(t)))
      .sort((a, b) => (b.coverage ?? 1) - (a.coverage ?? 1))
      .slice(0, n)
      .map((x) => ({ title: x.title, url: x.url, press: x.press, coverage: x.coverage ?? 1 }));

  const used = new Set(); // 같은 뉴스가 두 바구니에 중복으로 붙지 않게
  const cards = ASSET_GROUPS.map((g) => {
    const marketLines = market.filter((m) => g.market.includes(m.key) && !m.stale);
    const evs = events.filter((e) => g.kinds.includes(e.kind)).slice(0, 3);
    const news = newsFor(g.tags, 4).filter((x) => !used.has(x.url)).slice(0, 2);
    news.forEach((x) => used.add(x.url));
    const card = {
      key: g.key,
      name: g.name,
      target: g.target,
      icon: g.icon,
      role: g.role,
      market: marketLines.map((m) => ({ name: m.name, priceStr: m.priceStr, changePct: m.changePct })),
      events: evs,
      news,
    };
    card.level = levelOf(g, { marketLines, events: evs, news });
    return card;
  });

  // 2곳 이상 보도된 것만, 자격시험·인사 등 자산가 세무와 무관한 기사 제외(잡음 방지)
  const taxNews = newsFor(TAX_TAGS, 6)
    .filter((n) => n.coverage >= 2 && !/세무사|시험|합격|채용|인사|임명|선임/.test(n.title))
    .slice(0, 2);

  // 리밸런싱 안내: 변동이 큰 바구니 중 그 모델에서 비중이 20% 이상인 바구니만 (비중이 작으면 전체 영향 제한적)
  const rebalance = {};
  for (const m of ALLOCATION_MODELS) {
    const hit = cards.filter((c) => c.level === "변동 큼" && m.ratios[c.key] >= 20);
    rebalance[m.key] = hit.length
      ? `오늘 ${hit.map((c) => `${c.name}(${m.ratios[c.key]}%)`).join("·")} 바구니의 시장 변동이 커서, ${m.name} 기준 비중(${ratioText(m)})에서 벗어났을 수 있습니다. 허용 범위 이탈 여부를 점검하세요.`
      : null;
  }

  // ---- 문구 생성: 세 모델 × 세 바구니를 한 번에 (AI → 실패/권유 표현 시 규칙 기반) ----
  const brief = cards
    .map((c) => {
      const lines = [
        ...c.market.map((m) => `시세: ${m.name} ${m.priceStr} (${m.changePct >= 0 ? "+" : ""}${m.changePct}%)`),
        ...c.events.map((e) => `일정: ${e.when} D-${e.dday} ${e.label}`),
        ...c.news.map((n) => `뉴스: ${n.title} (${n.coverage}개 언론 보도)`),
      ];
      return `[${c.key}] ${c.name} — ${c.role} / 점검 강도: ${c.level}\n${lines.length ? lines.join("\n") : "(특이 근거 없음)"}`;
    })
    .join("\n\n");

  const r = await geminiJson({
    label: `${edition} 배분 모델 점검`,
    prompt: `당신은 패밀리오피스 PB의 리서치 보조입니다. 손님 자산은 세 바구니(안전자산 safe · 시장 추종 core · 초과 수익 satellite)로 나눠 관리하며,
아래 세 가지 예시 배분 모델이 있습니다. 비율은 고정이며 바꾸라고 하지 않습니다.
${ALLOCATION_MODELS.map((m) => `- ${m.key} (${m.name}): 안전자산 ${m.ratios.safe}% · 시장 추종 ${m.ratios.core}% · 초과 수익 ${m.ratios.satellite}%`).join("\n")}

같은 '근거'를 모델별 비중에 맞게 해석하세요. 비중이 큰 바구니는 더 구체적으로, 비중이 작은 바구니는 포트폴리오 전체 영향이 제한적이라는 관점으로 짧게 쓰세요.
(예: 같은 반도체 급락도 공격형의 초과 수익 50%에서는 핵심 점검 사항이지만, 안전 추구형의 10%에서는 영향이 제한적)

규칙:
- 근거에 없는 숫자·사실을 만들지 마세요.
- 매수·매도·비중 확대/축소/조절·추천 등 투자 의견이나 권유 표현은 쓰지 마세요. '시사점'과 '확인할 것'만 쓰세요.
- headline: 그 모델에서 이 바구니의 핵심 한 줄(35자 이내)
- insight: 오늘 시장이 이 모델의 이 바구니에 주는 시사점 1~2문장
- check: PB가 확인할 구체적 항목 1문장
- 근거가 없으면 headline은 "특이 신호 없음 — 정기 점검 유지"로 쓰세요.

${brief}

JSON으로만:
{"conservative": {"safe": {"headline": "", "insight": "", "check": ""}, "core": {...}, "satellite": {...}},
 "standard": {...같은 구조},
 "aggressive": {...같은 구조}}`,
    validate: (d) => ALLOCATION_MODELS.every((m) => d?.[m.key] && typeof d[m.key] === "object"),
  });

  let aiUsed = 0;
  let total = 0;
  for (const c of cards) {
    c.texts = {};
    for (const m of ALLOCATION_MODELS) {
      total++;
      const ai = r?.data?.[m.key]?.[c.key];
      const joined = ai ? `${ai.headline} ${ai.insight} ${ai.check}` : "";
      if (ai?.headline && ai?.insight && ai?.check && !ADVICE.test(joined)) {
        c.texts[m.key] = { headline: String(ai.headline).slice(0, 60), insight: String(ai.insight), check: String(ai.check), textBy: "ai" };
        aiUsed++;
      } else {
        if (ai && ADVICE.test(joined)) console.log(`[배분 모델 점검] ${m.name}·${c.name}: 권유 표현이 섞여 규칙 기반 문구로 대체`);
        const e = c.events[0];
        c.texts[m.key] = {
          headline: e ? `${e.label} ${e.dday === 0 ? "오늘" : `D-${e.dday}`}` : c.news[0]?.title ?? "특이 신호 없음 — 정기 점검 유지",
          ...FALLBACK[c.key],
          textBy: "rule",
        };
      }
    }
  }
  console.log(`[배분 모델 점검] 3개 모델 × 바구니 ${cards.length}개 (AI 문구 ${aiUsed}/${total}${r ? `, ${r.model}` : ""})`);
  return {
    framework: "models",
    generatedAt: new Date().toISOString(),
    model: r?.model ?? null,
    models: ALLOCATION_MODELS,
    defaultModel: "standard",
    cards,
    rebalance,
    taxNews,
  };
}

function ratioText(m) {
  return `${m.ratios.safe}:${m.ratios.core}:${m.ratios.satellite}`;
}
