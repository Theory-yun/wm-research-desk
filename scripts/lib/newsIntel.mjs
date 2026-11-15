import { geminiJson, GEMINI_LITE_FIRST } from "./gemini.mjs";

/**
 * 뉴스 "분야 판정"과 "필독 순위"를 담당합니다.
 *
 * 순위(필독 뉴스) = 같은 사건을 보도한 서로 다른 언론사 수(=외부 노출 정도)
 *   → 제목이 비슷한 기사들을 하나의 '이야기'로 묶고, 몇 개 언론이 다뤘는지 셉니다.
 *   → 많이 보도된 이야기일수록 시장 관심이 큰 이슈로 보고 위에 올립니다. 동률이면 최신순.
 *
 * 분야(태그) = Gemini가 제목 내용을 읽고 판정(1~2개). 실패 시 정교화한 키워드 규칙으로 대체.
 */

export const NEWS_CATEGORIES = ["매크로", "증시", "채권·금리", "외환", "원자재", "부동산", "TAX", "대체투자"];

const CATEGORY_GUIDE = `- 매크로: 경기·성장률·물가·고용·무역/수출입·중앙은행 정책 방향 등 거시경제
- 증시: 주가지수·종목·업종·수급·기업 실적 등 주식시장
- 채권·금리: 국채·회사채 금리, 채권시장, 기준금리 결정의 금리시장 영향
- 외환: 환율(원·달러, 엔, 유로 등), 달러 강약
- 원자재: 원유·금·구리 등 원자재 가격
- 부동산: 주택·상업용 부동산 시장, 부동산 정책·세제
- TAX: 상속·증여·가업승계·신탁·세법 개정 등 자산가 세무
- 대체투자: 사모펀드·사모대출·헤지펀드·인프라·가상자산 등`;

/* ----------------------------- 키워드 규칙(폴백) ----------------------------- */
const RULES = {
  "TAX": [/상속|증여|가업승계|가업상속|유언대용신탁|세제\s?개편|세법|양도세|종부세|절세/],
  "부동산": [/부동산|아파트|재건축|재개발|분양|빌딩|오피스텔|상업용|토지거래|전세|주택/],
  "외환": [/환율|원[·\/]?달러|엔화|엔[·\/]?달러|위안화|유로화|달러\s?인덱스|외환/],
  "원자재": [/유가|WTI|브렌트|원유|금값|금 시세|금시세|국제\s?금|구리|원자재|은값/],
  "채권·금리": [/국채|국고채|채권|금리\s?(상승|하락|급등|급락)|회사채|크레딧|수익률/],
  "대체투자": [/사모|PEF|헤지펀드|사모대출|인프라 투자|비트코인|가상자산|암호화폐|이더리움/],
  "증시": [/코스피|코스닥|증시|뉴욕증시|나스닥|S&P|다우|주가|상장|순매수|순매도|실적/],
  "매크로": [/연준|FOMC|파월|기준금리|한국은행|금통위|물가|CPI|PCE|고용|GDP|성장률|경기|수출|무역|관세|ECB|일본은행/],
};

export function keywordClassify(title) {
  const hits = NEWS_CATEGORIES.map((c) => ({ c, n: (RULES[c] ?? []).filter((r) => r.test(title)).length + (title.match(RULES[c]?.[0] ?? /$^/g)?.length ?? 0) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return hits.slice(0, 2).map((x) => x.c);
}

/* ----------------------------- 같은 이야기 묶기 ----------------------------- */
function bigrams(t) {
  const s = t.replace(/\[[^\]]*\]|[\s\p{P}\p{S}]/gu, "").toLowerCase();
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function overlap(A, B) {
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * 제목이 비슷한 기사를 묶습니다. (기준: 2글자 묶음 겹침 45% 이상, 48시간 이내)
 * @returns {Array<{rep:object, items:object[], outlets:string[], latestTs:number}>}
 */
export function clusterStories(items, { threshold = 0.45 } = {}) {
  const clusters = [];
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
  for (const it of sorted) {
    const bg = bigrams(it.title);
    // 묶음의 첫 기사(seed)와만 비교해 A~B~C로 꼬리를 물며 엉뚱한 기사까지 묶이는 것을 막음
    const hit = clusters.find((c) => Math.abs(c.latestTs - it.timestamp) < 48 * 3600e3 && overlap(c.seed, bg) >= threshold);
    if (hit) hit.items.push(it);
    else clusters.push({ items: [it], seed: bg, latestTs: it.timestamp });
  }
  return clusters.map((c) => {
    const outlets = [...new Set(c.items.map((i) => i.press).filter(Boolean))];
    // 대표 기사: [위클리]·[속보] 같은 말머리가 없는 기사 중 가장 최신
    const rep = c.items.find((i) => !/^\s*\[/.test(i.title)) ?? c.items[0];
    return { rep, items: c.items, outlets, latestTs: c.latestTs };
  });
}

/** 보도한 언론사 수 많은 순 → 최신순 */
export function rankClusters(clusters) {
  return [...clusters].sort((a, b) => b.outlets.length - a.outlets.length || b.latestTs - a.latestTs);
}

/* ----------------------------- AI 분야 판정 ----------------------------- */
/**
 * 기사 제목 목록의 분야를 판정합니다. (60건씩 나눠 호출)
 * @returns {Promise<Map<number,{cats:string[], relevant:boolean}>>|null}  실패 시 null
 */
export async function aiClassifyTitles(titles, { label = "뉴스 분야" } = {}) {
  if (!process.env.GEMINI_API_KEY || !titles.length) return null;
  const out = new Map();
  for (let start = 0; start < titles.length; start += 60) {
    const chunk = titles.slice(start, start + 60);
    const r = await geminiJson({
      label,
      models: GEMINI_LITE_FIRST,
      prompt: `증권사 PB가 초고액자산가 손님에게 전할 뉴스를 분류합니다. 각 기사 제목의 '실제 내용'을 보고 분야를 정하세요.
제목에 특정 단어가 들어 있다는 이유만으로 분류하지 말고, 기사의 핵심 주제가 무엇인지로 판단하세요.
(예: "환율·유가 하락에 수입물가 1.8%↓" → 핵심은 물가 통계이므로 매크로, 보조로 외환)

분야(이 목록의 이름 그대로만 사용):
${CATEGORY_GUIDE}

각 기사마다 주 분야 1개(필요하면 보조 분야 1개 더)를 고르세요.
relevant: 금융사 행사·세미나·상품 홍보, 분양 일정 단순 나열, 투자와 무관한 기사면 false.

${chunk.map((t, i) => `${i + 1}. ${t}`).join("\n")}

JSON 배열로만: [{"idx": 번호, "cats": ["주 분야", "보조 분야(선택)"], "relevant": true|false}]`,
      validate: (d) => Array.isArray(d) && d.length > 0,
    });
    if (!r) return out.size ? out : null;
    for (const x of r.data) {
      const i = start + Number(x.idx) - 1;
      const cats = (Array.isArray(x.cats) ? x.cats : []).filter((c) => NEWS_CATEGORIES.includes(c)).slice(0, 2);
      if (i >= start && i < start + chunk.length && cats.length) out.set(i, { cats, relevant: x.relevant !== false });
    }
  }
  return out;
}

/**
 * 상위 이야기 묶음들을 Gemini로 한 번 더 점검합니다.
 *  - 제목 표현만 달라 따로 묶인 '같은 사건'을 합치고 (보도 언론사 수 합산)
 *  - 각 이야기의 분야(1~2개)와 PB 관련성(relevant)을 판정합니다.
 * @returns {Promise<Array<{clusters:object[], cats:string[], relevant:boolean}>|null>}
 */
export async function aiMergeAndClassify(clusters, { label = "필독 뉴스" } = {}) {
  if (!process.env.GEMINI_API_KEY || !clusters.length) return null;
  const r = await geminiJson({
    label,
    models: GEMINI_LITE_FIRST,
    prompt: `아래는 최근 뉴스를 비슷한 제목끼리 묶은 '이야기' 목록입니다(괄호는 보도한 언론사 수).
1) 서로 같은 사건·같은 발표를 다룬 항목은 하나의 그룹으로 합치세요. 주제만 비슷하고 다른 사건이면 합치지 마세요.
2) 각 그룹의 핵심 주제를 보고 분야를 정하세요. 제목에 단어가 들어 있다는 이유만으로 분류하지 말고 핵심 주제로 판단하세요.
3) relevant: 금융사 행사·세미나·상품 홍보, 개인 투자 실패담 같은 흥미 위주 기사, 투자와 무관한 기사면 false.

분야(이 이름 그대로만, 주 분야 1개 + 필요시 보조 1개):
${CATEGORY_GUIDE}

${clusters.map((c, i) => `${i + 1}. ${c.rep.title} (${c.outlets.length}곳)`).join("\n")}

모든 번호가 정확히 한 그룹에 들어가야 합니다. JSON 배열로만:
[{"members": [번호들], "cats": ["주 분야", "보조 분야(선택)"], "relevant": true|false}]`,
    validate: (d) => Array.isArray(d) && d.length > 0,
  });
  if (!r) return null;
  const used = new Set();
  const groups = [];
  for (const g of r.data) {
    const members = (g.members ?? []).map((n) => Number(n) - 1).filter((i) => i >= 0 && i < clusters.length && !used.has(i));
    if (!members.length) continue;
    members.forEach((i) => used.add(i));
    const cats = (g.cats ?? []).filter((c) => NEWS_CATEGORIES.includes(c)).slice(0, 2);
    groups.push({ clusters: members.map((i) => clusters[i]), cats, relevant: g.relevant !== false });
  }
  // AI가 빠뜨린 묶음은 그대로 남김
  clusters.forEach((c, i) => !used.has(i) && groups.push({ clusters: [c], cats: [], relevant: true }));
  console.log(`[${label}] Gemini 판정 완료 (${r.model}) — 묶음 ${clusters.length}개 → 이야기 ${groups.length}개`);
  return groups;
}
