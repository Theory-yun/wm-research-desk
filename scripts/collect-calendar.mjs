/**
 * 캘린더 자동 갱신 (calendar-auto-update 워크플로가 하루 두 번 실행)
 *  1) 코스피 시총 상위 10개 기업 실적 일정 — DART 공시 → data/auto-events.json
 *  2) 지난 일정의 결과(금리 결정·CPI·고용·잠정실적) → data/event-results.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectEarnings } from "./lib/earnings.mjs";
import { collectEventResults } from "./lib/eventResults.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (f) => path.join(ROOT, "data", f);
const read = (f, fb) => {
  try {
    return JSON.parse(fs.readFileSync(P(f), "utf-8"));
  } catch {
    return fb;
  }
};
const write = (f, obj) => fs.writeFileSync(P(f), JSON.stringify(obj, null, 2) + "\n", "utf-8");

async function main() {
  const macro = read("macro-events.json", { items: [] });
  const auto = read("auto-events.json", { updatedAt: null, top10: [], items: [] });
  const res = read("event-results.json", { updatedAt: null, results: {} });

  const nowKst = new Date(Date.now() + 9 * 3600e3);
  const todayKst = nowKst.toISOString().slice(0, 10);
  const hourKst = nowKst.getUTCHours();

  // 1) 실적 일정
  try {
    const e = await collectEarnings({ previousTop10: auto.top10, existingItems: auto.items, existingResults: res.results });
    Object.assign(res.results, e.results);
    write("auto-events.json", { updatedAt: new Date().toISOString(), note: e.note || undefined, top10: e.top10, items: e.items });
    console.log(`[실적] 일정 ${e.items.length}건 보관 ${e.note ? `(${e.note})` : ""}`);
  } catch (err) {
    console.error("[실적] 수집 오류(기존 데이터 유지):", err);
  }

  // 2) 일정 결과
  try {
    const added = await collectEventResults(macro.items, res.results, todayKst, hourKst);
    console.log(`[결과] 신규 ${added}건`);
  } catch (err) {
    console.error("[결과] 수집 오류(기존 데이터 유지):", err);
  }
  res.updatedAt = new Date().toISOString();
  write("event-results.json", res);
}

main();
