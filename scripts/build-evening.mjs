import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEdition } from "./lib/buildEdition.mjs";
import { DOMESTIC_RSS_FEEDS, DOMESTIC_QUERY_RULES } from "./lib/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

buildEdition({
  edition: "EVENING",
  directFeeds: DOMESTIC_RSS_FEEDS,
  queryRules: DOMESTIC_QUERY_RULES,
  pbNotesPath: path.join(__dirname, "../data/pb-notes-evening.md"),
}).catch((err) => {
  console.error("이브닝 브리핑 생성 중 치명적 오류:", err);
  process.exit(1);
});
