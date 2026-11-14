import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGoogleNewsQuery } from "./lib/news.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "../data/insights.json");

function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const current = readJsonSafe(FILE, { updatedAt: null, items: [] });

  const found = await fetchGoogleNewsQuery(
    '(패밀리오피스 리포트 OR 부자보고서 OR 유언대용신탁 OR "가업상속공제") when:30d',
    "가업승계·세무·신탁"
  );

  let added = 0;
  for (const item of found.slice(0, 6)) {
    const dup = current.items.some(
      (r) => r.title.includes(item.title) || item.title.includes(r.title.replace("[자동 수집] ", ""))
    );
    if (dup) continue;
    current.items.push({
      stars: "★★★★☆",
      category: "가업승계·세무·신탁",
      title: `[자동 수집] ${item.title}`,
      desc: `${item.press} 발간 패밀리오피스·자산관리 리서치 아티클 (원문 출고: ${item.date})`,
      org: item.press,
      date: item.date.split(" ")[0],
      btnText: "🔗 리포트 원문",
      url: item.url,
    });
    added++;
  }

  current.updatedAt = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2) + "\n", "utf-8");
  console.log(`F/O 리포트 아카이브: 신규 ${added}건 추가, 총 ${current.items.length}건 보관 중`);
}

main().catch((err) => {
  console.error("F/O 리포트 수집 중 오류:", err);
  process.exit(1);
});
