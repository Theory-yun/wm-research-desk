/**
 * 규칙으로 정해지는 캘린더 일정을 계산해 data/macro-events.json 에 반영합니다. (수동 실행)
 *   node scripts/build-rule-events.mjs
 *
 * - 한국 KOSPI200 옵션 만기: 매월 둘째 목요일 (휴장일이면 직전 거래일), 3·6·9·12월은 선물·옵션 동시만기
 * - 미국 월물 옵션 만기: 매월 셋째 금요일 (휴장일이면 직전 거래일), 3·6·9·12월은 쿼드러플 위칭
 * - KOSPI200 정기변경 적용: 6·12월 동시만기 다음 거래일
 * - 한·미 휴장일/조기폐장/개장지연, MSCI 정기 리뷰 발표·적용일: data/market-holidays.json 기준
 *
 * 이 스크립트가 만든 항목은 "auto": "rule" 로 표시되며, 다시 실행하면 지우고 새로 만듭니다.
 * (손으로 넣은 FOMC·금통위 등 다른 항목은 건드리지 않습니다.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MACRO = path.join(ROOT, "data/macro-events.json");
const HOL = path.join(ROOT, "data/market-holidays.json");

const macro = JSON.parse(fs.readFileSync(MACRO, "utf-8"));
const hol = JSON.parse(fs.readFileSync(HOL, "utf-8"));
const WD = "일월화수목금토";

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const md = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
};
const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const isOpen = (d, mkt) => !isWeekend(d) && !hol[mkt].closed[iso(d)];

function nthWeekday(y, m, weekday, n) {
  const d = new Date(Date.UTC(y, m, 1));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * (n - 1));
  return d;
}
function prevOpen(d, mkt) {
  const x = new Date(d);
  while (!isOpen(x, mkt)) x.setUTCDate(x.getUTCDate() - 1);
  return x;
}
function nextOpen(d, mkt) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + 1);
  while (!isOpen(x, mkt)) x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

const [fy, fm] = macro.coverage.from.split("-").map(Number);
const [ty, tm] = macro.coverage.to.split("-").map(Number);
const inCoverage = (s) => s.slice(0, 7) >= macro.coverage.from && s.slice(0, 7) <= macro.coverage.to;

const out = [];
for (let y = fy, m = fm - 1; y < ty || (y === ty && m <= tm - 1); m === 11 ? ((y += 1), (m = 0)) : (m += 1)) {
  const quarterly = [2, 5, 8, 11].includes(m);

  // 한국: 둘째 목요일
  const krRaw = nthWeekday(y, m, 4, 2);
  const kr = prevOpen(krRaw, "KR");
  const krShift = iso(kr) !== iso(krRaw) ? ` (원래 ${md(iso(krRaw))}이 휴장이라 직전 거래일로 당겨짐)` : "";
  out.push({
    date: iso(kr),
    kind: quarterly ? "kr_quad" : "kr_expiry",
    meeting: `${m + 1}월물 최종거래일${krShift}`,
    timeKst: `${md(iso(kr))} 장 마감(15:20) 전후 변동성 유의`,
  });
  if (quarterly && (m === 5 || m === 11)) {
    const reb = nextOpen(kr, "KR");
    out.push({
      date: iso(reb),
      kind: "kospi200_rebal",
      meeting: `${m + 1}월 동시만기(${md(iso(kr))}) 다음 거래일`,
      timeKst: `${md(iso(reb))} 개장부터 새 구성종목 적용`,
    });
  }

  // 미국: 셋째 금요일
  const usRaw = nthWeekday(y, m, 5, 3);
  const us = prevOpen(usRaw, "US");
  const usShift = iso(us) !== iso(usRaw) ? ` (원래 ${md(iso(usRaw))}이 휴장이라 직전 거래일로 당겨짐)` : "";
  out.push({
    date: iso(us),
    kind: quarterly ? "us_quad" : "us_opex",
    meeting: `${m + 1}월물 만기${usShift}`,
    timeKst: "미국 장 마감 시 (한국시간 다음 날 새벽)",
  });
}

for (const [d, name] of Object.entries(hol.KR.closed)) out.push({ date: d, kind: "kr_holiday", meeting: name, timeKst: `${md(d)} 종일 휴장` });
for (const [d, name] of Object.entries(hol.KR.lateOpen ?? {})) out.push({ date: d, kind: "kr_late_open", meeting: name, timeKst: `${md(d)} 개장 시각 변경` });
for (const [d, name] of Object.entries(hol.US.closed)) out.push({ date: d, kind: "us_holiday", meeting: name, timeKst: "미국 증시 종일 휴장" });
for (const [d, name] of Object.entries(hol.US.earlyClose ?? {})) out.push({ date: d, kind: "us_early_close", meeting: name, timeKst: "한국시간 다음 날 새벽 3시 조기 마감" });
for (const r of hol.MSCI.reviews) {
  out.push({ date: r.announce, kind: "msci_announce", meeting: r.name, timeKst: "현지 장 마감 후 발표 (한국시간 다음 날 새벽~오전 확인)" });
  out.push({ date: r.effective, kind: "msci_effective", meeting: `${r.name} 적용`, timeKst: "적용일 직전 거래일 종가 기준으로 지수 반영" });
}

const generated = out.filter((e) => inCoverage(e.date)).map((e) => ({ ...e, auto: "rule" }));
const missingKinds = [...new Set(generated.map((e) => e.kind))].filter((k) => !macro.kinds[k]);
if (missingKinds.length) throw new Error(`macro-events.json kinds에 설명이 없는 유형: ${missingKinds.join(", ")}`);

macro.items = [...macro.items.filter((e) => e.auto !== "rule"), ...generated].sort((a, b) =>
  a.date === b.date ? a.kind.localeCompare(b.kind) : a.date.localeCompare(b.date)
);
macro.updatedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(MACRO, JSON.stringify(macro, null, 2) + "\n", "utf-8");
console.log(`규칙 기반 일정 ${generated.length}건 반영 (전체 ${macro.items.length}건)`);
for (const e of generated.filter((x) => /quad|expiry|opex|rebal/.test(x.kind))) console.log(e.date, e.kind, e.meeting);
