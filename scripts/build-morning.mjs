import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEdition } from "./lib/buildEdition.mjs";
import { GLOBAL_RSS_FEEDS, GLOBAL_QUERY_RULES } from "./lib/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

buildEdition({
  edition: "MORNING",
  directFeeds: GLOBAL_RSS_FEEDS,
  queryRules: GLOBAL_QUERY_RULES,
  pbNotesPath: path.join(__dirname, "../data/pb-notes-morning.md"),
}).catch((err) => {
  console.error("모닝 브리핑 생성 중 치명적 오류:", err);
  process.exit(1);
});
