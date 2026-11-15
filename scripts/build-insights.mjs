/**
 * F/O Insight 자동 수집 (calendar-auto-update 워크플로가 하루 두 번 실행)
 *
 * 1) 패밀리오피스·초고액자산가 관점의 주제별 검색(국문·영문 뉴스)으로 후보 수집
 * 2) Gemini가 후보마다 "PB에게 쓸모 있는 리서치·데이터·제도 변화인가"를 판정하고 분류·요약
 *    (증권사 행사·세미나 홍보 같은 마케팅성 기사는 제외, 제목에 없는 사실은 쓰지 않음)
 *    Gemini 키가 없거나 실패하면 키워드 규칙으로만 분류합니다.
 * 3) PB가 고른 연례 핵심 리포트(curated)는 그대로 두고, 자동 수집분은 최근 90일·최대 60건만 보관
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGoogleNewsQuery } from "./lib/news.mjs";
import { geminiJson, GEMINI_LITE_FIRST } from "./lib/gemini.mjs";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/insights.json");

export const INSIGHT_CATEGORIES = ["글로벌 F/O 동향", "국내 부자·웰스 리포트", "자산배분·시장 전망", "승계·세무·신탁", "대체투자·사모시장"];

const QUERIES = [
  { q: "패밀리오피스 보고서 OR 조사 OR 설문 when:30d", lang: "ko", hint: "글로벌 F/O 동향" },
  { q: "부자보고서 OR 웰스리포트 OR 초고액자산가 조사 when:60d", lang: "ko", hint: "국내 부자·웰스 리포트" },
  { q: "자산배분 전망 보고서 OR 하우스뷰 OR 투자전략 전망 when:14d", lang: "ko", hint: "자산배분·시장 전망" },
  { q: "가업승계 OR 상속세 개편 OR 증여세 OR 유언대용신탁 when:14d", lang: "ko", hint: "승계·세무·신탁" },
  { q: "사모신용 OR 사모펀드 OR 대체투자 전망 when:14d", lang: "ko", hint: "대체투자·사모시장" },
  { q: '"family office" report OR survey when:30d', lang: "en", hint: "글로벌 F/O 동향" },
  { q: '"wealth report" OR "UHNW" survey when:60d', lang: "en", hint: "글로벌 F/O 동향" },
  { q: '"outlook" "asset allocation" 2027 when:30d', lang: "en", hint: "자산배분·시장 전망" },
  { q: '"private credit" OR "private equity" outlook family offices when:30d', lang: "en", hint: "대체투자·사모시장" },
];

const PROMO = /세미나|컨퍼런스|간담회|행사|개최|진행|초청|이벤트|출시|오픈|선임|수상|MOU|협약|채용/;

function readJsonSafe(p, fb) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fb;
  }
}

function ruleClassify(c) {
  if (PROMO.test(c.title)) return null;
  return { keep: true, category: c.hint, stars: 3, titleKo: c.title, desc: `${c.press} 보도 (${c.date.split(" ")[0]})` };
}

async function aiClassify(cands) {
  const r = await geminiJson({
    label: "F/O 리포트 분류",
    models: GEMINI_LITE_FIRST,
    prompt: `당신은 패밀리오피스 PB의 리서치 담당입니다. 아래 기사 제목들 중 초고액자산가 손님 상담에 실제로 쓸모 있는 것만 고르세요.
남길 것: 리서치 보고서·설문 결과·통계/데이터 발표, 자산배분 전망, 세법·상속·신탁 제도 변화, 대체투자 시장 동향.
뺄 것: 금융사 행사·세미나·상품 출시·인사·수상 등 홍보성 기사, 개별 종목 시황, 제목만으로 내용을 알 수 없는 기사.
각 항목은 제목에 적힌 내용만으로 작성하고, 제목에 없는 숫자·사실은 절대 추가하지 마세요. 영문 제목은 뜻을 바꾸지 말고 한국어로 옮기세요.

분류는 다음 중 하나: ${INSIGHT_CATEGORIES.join(" / ")}

${cands.map((c, i) => `${i + 1}. ${c.title} (${c.press})`).join("\n")}

JSON 배열로만 답하세요(남길 항목만):
[{"idx": 번호, "category": "분류", "stars": 3~5(PB 활용도), "titleKo": "한국어 제목", "desc": "PB 관점 시사점 한 문장(제목 범위 안에서)"}]`,
    validate: (d) => Array.isArray(d),
  });
  if (!r) return null;
  const out = new Map();
  for (const x of r.data) {
    const c = cands[Number(x.idx) - 1];
    if (!c || !INSIGHT_CATEGORIES.includes(x.category)) continue;
    out.set(c.url, { keep: true, category: x.category, stars: Math.min(5, Math.max(3, Number(x.stars) || 3)), titleKo: String(x.titleKo || c.title), desc: String(x.desc || "") });
  }
  return { map: out, model: r.model };
}

async function main() {
  const current = readJsonSafe(FILE, { items: [] });
  const curated = current.items.filter((r) => r.curated);
  const prevAuto = current.items.filter((r) => !r.curated);
  const known = new Set(current.items.map((r) => r.url));

  // 1) 후보 수집
  const cands = [];
  const seenTitle = new Set();
  for (const q of QUERIES) {
    const found = await fetchGoogleNewsQuery(q.q, q.hint, { lang: q.lang });
    for (const n of found.slice(0, 12)) {
      const key = n.title.replace(/\s+/g, "").slice(0, 40);
      if (known.has(n.url) || seenTitle.has(key)) continue;
      seenTitle.add(key);
      cands.push({ ...n, hint: q.hint, lang: q.lang });
    }
  }
  console.log(`F/O 후보 ${cands.length}건 수집`);

  // 2) 분류 (AI → 실패 시 규칙)
  let ai = null;
  if (cands.length && process.env.GEMINI_API_KEY) ai = await aiClassify(cands.slice(0, 60));
  const fresh = [];
  for (const c of cands) {
    const cls = ai ? ai.map.get(c.url) : ruleClassify(c);
    if (!cls) continue;
    fresh.push({
      stars: "★".repeat(cls.stars) + "☆".repeat(5 - cls.stars),
      category: cls.category,
      title: cls.titleKo,
      desc: cls.desc,
      org: c.press,
      date: c.date.split(" ")[0],
      ts: c.timestamp,
      btnText: "🔗 원문 보기",
      url: c.url,
      lang: c.lang,
      classifiedBy: ai ? `AI(${ai.model})` : "키워드 규칙",
    });
  }

  // 3) 병합·정리
  const cutoff = Date.now() - 90 * 86400e3;
  const auto = [...fresh, ...prevAuto]
    .filter((r) => (r.ts ?? 0) >= cutoff)
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .slice(0, 60);

  fs.writeFileSync(
    FILE,
    JSON.stringify({ note: current.note, updatedAt: new Date().toISOString(), categories: INSIGHT_CATEGORIES, items: [...curated, ...auto] }, null, 2) + "\n",
    "utf-8"
  );
  console.log(`F/O Insight: 신규 ${fresh.length}건 (분류: ${ai ? `AI ${ai.model}` : "키워드 규칙"}), 자동 수집 보관 ${auto.length}건 + 고정 리포트 ${curated.length}건`);
}

main().catch((err) => {
  console.error("F/O 리포트 수집 중 오류(기존 데이터 유지):", err);
});
