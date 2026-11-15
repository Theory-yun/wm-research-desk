/**
 * 데이터 무결성 점검 — 사이트가 읽는 data/*.json 전체를 검사합니다.
 *   node scripts/validate-data.mjs        (오류가 있으면 종료 코드 1)
 * 워크플로에서도 매 실행 후 돌려 결과를 로그에 남깁니다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = (f) => path.join(ROOT, "data", f);
const errors = [];
const warns = [];
const err = (f, m) => errors.push(`❌ [${f}] ${m}`);
const warn = (f, m) => warns.push(`⚠️  [${f}] ${m}`);

function load(f) {
  try {
    return JSON.parse(fs.readFileSync(D(f), "utf-8"));
  } catch (e) {
    err(f, `JSON 읽기 실패: ${e.message}`);
    return null;
  }
}
const isUrl = (u) => /^https?:\/\/\S+$/.test(u ?? "");
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const BAD_TEXT = /undefined|NaN|\[object Object\]|null%/;
const NEWS_CATEGORIES = ["매크로", "증시", "채권·금리", "외환", "원자재", "부동산", "TAX", "대체투자"];
const ADVICE =
  /(매수|매도|편입|비중\s?(확대|축소|조절)|비중을?\s?(늘|줄)|차익\s?실현|손절|교체|청산|담)[가-힣\s]{0,10}(하세요|하십시오|권합니다|권고|권유|추천|바람직|고려하|검토하|하는 것이 좋|할 것을)|비중을?\s?(늘|줄)[가-힣]{0,3}(세요|십시오)|추천합니다|권유합니다|권고합니다|사세요|파세요/;

/* ---------- 모닝/이브닝 브리핑 ---------- */
function checkEdition(f, ed) {
  if (!ed) return;
  const ageH = (Date.now() - new Date(ed.generatedAt).getTime()) / 3600e3;
  if (!(ageH >= 0)) err(f, `generatedAt 이상: ${ed.generatedAt}`);
  else if (ageH > 96) warn(f, `${Math.round(ageH)}시간 전 데이터 (자동 갱신이 멈췄는지 확인)`);

  if (!Array.isArray(ed.market) || ed.market.length !== 6) err(f, `market 항목 수 ${ed.market?.length} (6개여야 함)`);
  for (const m of ed.market ?? []) {
    if (m.stale) warn(f, `${m.name} 시세 갱신 실패(이전 값 표시 중)`);
    if (m.stale && m.priceStr === "—") continue;
    if (!Number.isFinite(m.changePct)) err(f, `${m.name} changePct 숫자 아님: ${m.changePct}`);
    // 등락폭·등락률·현재가가 서로 맞는지 (diff / (price - diff) ≈ pct)
    const price = Number(String(m.priceStr).replace(/,/g, ""));
    const absDiff = Math.abs(Number(String(m.diffStr).replace(/[▲▼+\-,\s]/g, "")));
    const diff = /▼|-/.test(m.diffStr) ? -absDiff : absDiff;
    if (Number.isFinite(price) && Number.isFinite(diff) && price - diff !== 0) {
      const calc = (Math.abs(diff) / (price - diff)) * 100 * Math.sign(diff);
      if (Math.abs(calc - m.changePct) > 0.05) err(f, `${m.name} 등락률 불일치: 표시 ${m.changePct}% vs 계산 ${calc.toFixed(2)}% (${m.priceStr}, ${m.diffStr})`);
    }
  }
  if (!Array.isArray(ed.issues) || ed.issues.length < 1) err(f, "issues 없음");
  for (const i of ed.issues ?? []) for (const k of ["cat", "tag", "title", "desc"]) if (!i[k] || BAD_TEXT.test(i[k])) err(f, `issue.${k} 비었거나 이상: ${i[k]}`);
  if (!ed.talkingPoint || BAD_TEXT.test(ed.talkingPoint)) err(f, "talkingPoint 비었거나 이상");
  if (/안녕하(십니까|세요)/.test(ed.talkingPoint ?? "")) err(f, "talkingPoint에 인사말 포함");
  if (ed.sourceStatus?.summary === "fallback") warn(f, "AI 요약 실패로 규칙 기반 요약 사용 중");

  for (const n of ed.topNews ?? []) {
    if (!isUrl(n.url)) err(f, `topNews URL 이상: ${n.title}`);
    if (/ - https?:\/\//.test(n.title)) err(f, `topNews 제목에 주소 잔여물: ${n.title}`);
    for (const t of n.tags ?? []) if (!NEWS_CATEGORIES.includes(t)) err(f, `topNews 분야 이름 이상: ${t}`);
  }
  const cov = (ed.topNews ?? []).map((n) => n.coverage ?? 0);
  if (!ed.topNews?.length) err(f, "topNews 없음");

  const ac = ed.assetChecks;
  if (!ac) warn(f, "assetChecks 없음");
  else if (ac.framework === "models") {
    if (ac.models?.length !== 3) err(f, "배분 모델 수가 3이 아님");
    for (const m of ac.models ?? []) {
      const sum = m.ratios.safe + m.ratios.core + m.ratios.satellite;
      if (sum !== 100) err(f, `${m.name} 비율 합계 ${sum}%`);
    }
    for (const c of ac.cards ?? [])
      for (const m of ac.models ?? []) {
        const t = c.texts?.[m.key];
        if (!t?.headline || !t?.insight || !t?.check) err(f, `${m.name}·${c.name} 문구 누락`);
        else if (ADVICE.test(`${t.headline} ${t.insight} ${t.check}`)) err(f, `${m.name}·${c.name} 투자 권유 표현 포함`);
        else if (BAD_TEXT.test(`${t.headline}${t.insight}${t.check}`)) err(f, `${m.name}·${c.name} 문구 이상값`);
      }
  }
  return cov;
}

const morning = load("morning-latest.json");
const evening = load("evening-latest.json");
checkEdition("morning-latest.json", morning);
checkEdition("evening-latest.json", evening);

/* ---------- 지난 브리핑 아카이브 ---------- */
const idx = load("archive/index.json");
const files = fs.readdirSync(D("archive")).filter((f) => /^(morning|evening)-\d{4}-\d{2}-\d{2}\.json$/.test(f));
const listed = new Set((idx?.dates ?? []).flatMap((d) => d.editions.map((e) => `${e}-${d.date}.json`)));
for (const f of files) if (!listed.has(f)) err("archive/index.json", `목록에 없는 파일: ${f}`);
for (const f of listed) if (!files.includes(f)) err("archive/index.json", `목록에는 있는데 파일 없음: ${f}`);
for (const f of files) {
  try {
    JSON.parse(fs.readFileSync(D(`archive/${f}`), "utf-8"));
  } catch {
    err(`archive/${f}`, "JSON 깨짐");
  }
}

/* ---------- 뉴스 아카이브 ---------- */
const news = load("news-archive.json");
const seen = new Set();
let untagged = 0;
for (const n of news?.items ?? []) {
  if (!isUrl(n.url)) err("news-archive.json", `URL 이상: ${n.title}`);
  if (seen.has(n.url)) err("news-archive.json", `중복 URL: ${n.title}`);
  seen.add(n.url);
  if (n.timestamp > Date.now() + 3600e3) err("news-archive.json", `미래 시각 기사: ${n.title}`);
  for (const t of n.tags ?? []) if (!NEWS_CATEGORIES.includes(t)) err("news-archive.json", `분야 이름 이상(${t}): ${n.title.slice(0, 30)}`);
  if (n.tagSource !== "ai") untagged++;
}
if (untagged) warn("news-archive.json", `AI 분야 판정 전 기사 ${untagged}건 (다음 실행 때 판정)`);

/* ---------- 캘린더 ---------- */
const macro = load("macro-events.json");
const auto = load("auto-events.json");
const results = load("event-results.json");
const ids = new Set();
for (const e of [...(macro?.items ?? []), ...(auto?.items ?? [])]) {
  const id = e.id ?? `${e.date}|${e.kind}`;
  if (ids.has(id)) err("macro/auto-events", `중복 일정: ${id}`);
  ids.add(id);
  if (!isDate(e.date)) err("macro/auto-events", `날짜 형식 이상: ${e.date}`);
  if (!macro?.kinds?.[e.kind]) err("macro/auto-events", `설명이 없는 일정 유형: ${e.kind}`);
}
for (const [k, kd] of Object.entries(macro?.kinds ?? {})) {
  if (!macro.categories?.[kd.category]) err("macro-events.json", `${k}: 분류 이름 없음(${kd.category})`);
  if (kd.source && !isUrl(kd.source.url)) err("macro-events.json", `${k}: 출처 URL 이상`);
}
const lastMonth = [...(macro?.items ?? [])].map((e) => e.date.slice(0, 7)).sort().pop();
if (macro?.coverage && lastMonth && lastMonth < macro.coverage.to) warn("macro-events.json", `coverage.to(${macro.coverage.to})까지 일정이 채워지지 않음`);
const monthsLeft = macro?.coverage ? (Number(macro.coverage.to.slice(0, 4)) - new Date().getFullYear()) * 12 + Number(macro.coverage.to.slice(5)) - (new Date().getMonth() + 1) : 99;
if (monthsLeft < 3) warn("macro-events.json", `수록 범위가 ${monthsLeft}개월 남음 — 다음 해 공식 일정 추가 필요`);
for (const [id, r] of Object.entries(results?.results ?? {})) {
  if (!ids.has(id)) err("event-results.json", `존재하지 않는 일정의 결과: ${id}`);
  if (!r.headline || BAD_TEXT.test(r.headline + (r.details ?? []).join(""))) err("event-results.json", `${id} 결과 문구 이상: ${r.headline}`);
  if (r.sourceUrl && !isUrl(r.sourceUrl)) err("event-results.json", `${id} 출처 URL 이상`);
}
if (!auto?.top10?.length) warn("auto-events.json", "시총 상위 10 목록이 비어 있음");
if (auto?.note) warn("auto-events.json", auto.note);

/* ---------- F/O Insight ---------- */
const ins = load("insights.json");
for (const r of ins?.items ?? []) {
  if (!isUrl(r.url)) err("insights.json", `URL 이상: ${r.title}`);
  if (ins.categories && !ins.categories.includes(r.category)) err("insights.json", `분류 이름 이상(${r.category}): ${r.title.slice(0, 30)}`);
}

/* ---------- 결과 ---------- */
console.log(`\n데이터 점검: 오류 ${errors.length}건 · 주의 ${warns.length}건`);
[...errors, ...warns].forEach((l) => console.log(l));
process.exit(errors.length ? 1 : 0);
