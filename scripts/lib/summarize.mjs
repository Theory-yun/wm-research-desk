import { fetchWithRetry } from "./fetchUtil.mjs";
import { geminiJson, extractJson } from "./gemini.mjs";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929"; // 운영 전 Anthropic 콘솔에서 최신 모델ID 확인 권장

const SYSTEM_PROMPT =
  "당신은 국내 증권사 패밀리오피스(Family Office) 소속의 30년 경력 PB입니다. " +
  "오직 사용자가 제공한 '시장 지표'와 '뉴스 헤드라인' 데이터만 근거로 삼아 " +
  "초고액자산가(UHNW) 손님에게 전달할 하루 브리핑 콘텐츠를 작성합니다. " +
  "제공되지 않은 숫자·사실을 새로 만들어내지 마세요. " +
  "설명이나 코드블록 없이, 반드시 지정된 JSON 스키마 객체 하나만 출력하세요.";

/**
 * "핵심 이슈 3건 + 종합 talkingPoint"를 생성합니다. (Gemini 1순위 → Claude 2순위 → 규칙 기반 폴백)
 *
 * 설계 원칙(정확성 최우선):
 *  - 숫자(시세·등락률 등)는 전부 market 배열에서 이미 서버가 계산해 둔 값을 "그대로 문장에 녹여서"
 *    쓰게 하고, AI가 새로운 숫자를 창작하지 못하도록 프롬프트에 명시합니다.
 *  - 응답은 반드시 JSON 스키마로만 받고, 파싱에 실패하면 즉시 규칙 기반 폴백으로 전환합니다.
 *  - 두 AI 키가 모두 없거나 호출이 모두 실패해도 사이트 자체는 절대 깨지지 않도록 폴백을 항상 보장합니다.
 *  - 제공자 선택은 환경변수 존재 여부로만 결정합니다(GEMINI_API_KEY가 있으면 Gemini를 먼저 시도) —
 *    두 키를 동시에 넣어두면 Gemini 장애 시 Claude로 자동 전환되는 이중 안전망이 됩니다.
 */
export async function generateBriefingSummary({ edition, market, candidateNews, pbNotes }) {
  const prompt = buildPrompt({ edition, market, candidateNews, pbNotes });

  if (process.env.GEMINI_API_KEY) {
    const r = await geminiJson({ prompt, system: SYSTEM_PROMPT, validate: isValidSummary, label: "summarize" });
    if (r) {
      return {
        issues: r.data.issues.slice(0, 3),
        talkingPoint: String(r.data.talkingPoint),
        summarySource: "ai-gemini",
        summaryModel: r.model,
      };
    }
    console.error("[summarize] Gemini 후보 모델 모두 실패");
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const parsed = await callClaude(prompt);
      return { issues: parsed.issues.slice(0, 3), talkingPoint: String(parsed.talkingPoint), summarySource: "ai-claude" };
    } catch (err) {
      console.error(`[summarize] Claude API 호출 실패: ${err.message}`);
    }
  }

  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.warn("[summarize] GEMINI_API_KEY/ANTHROPIC_API_KEY가 모두 설정되지 않아 규칙 기반 폴백 요약을 사용합니다.");
  }
  return { ...fallbackSummary({ edition, market, candidateNews }), summarySource: "fallback" };
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;

  const body = {
    model,
    max_tokens: 1400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  };

  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    timeoutMs: 30000,
    retries: 1,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    method: "POST",
    body: JSON.stringify(body),
    responseType: "json",
  });

  const text = res?.content?.[0]?.text;
  const parsed = extractJson(text);
  validateSchema(parsed);
  return parsed;
}

function isValidSummary(parsed) {
  return Array.isArray(parsed?.issues) && parsed.issues.length > 0 && !!parsed.talkingPoint;
}

function validateSchema(parsed) {
  if (!isValidSummary(parsed)) throw new Error("AI 응답 스키마가 예상과 다릅니다.");
}

function buildPrompt({ edition, market, candidateNews, pbNotes }) {
  const marketLines = market
    .map((m) => `- ${m.name}: ${m.priceStr} (${m.diffStr}, ${m.changePct}%) [${m.asOfKst}]${m.stale ? " ※갱신 실패, 이전 값" : ""}`)
    .join("\n");

  const newsLines = candidateNews
    .map((n, i) => `${i + 1}. [${n.tags.join(",")}] ${n.title} (${n.press}, ${n.date})`)
    .join("\n");

  const editionGuide =
    edition === "MORNING"
      ? "모닝 에디션입니다. 대한민국 장 개장 전 시점이며, 간밤 글로벌(미국/유럽/아시아) 시장 이슈를 중심으로 작성하세요. 손님이 출근길에 읽고 '오늘 국내 장에서 뭘 주목해야 하는지' 감을 잡을 수 있어야 합니다."
      : "이브닝 에디션입니다. 대한민국 장 종료 후 시점이며, 당일 국내 증시·수급·업종 이슈를 중심으로 작성하세요. 손님에게 '오늘 장이 왜 이렇게 끝났는지'를 설명할 수 있어야 합니다.";

  return `[에디션] ${edition}
${editionGuide}

[오늘의 시장 지표] (이 숫자만 사용하세요. 새 숫자를 만들지 마세요)
${marketLines}

[수집된 뉴스 헤드라인 후보] (이 중에서 PB 관점으로 가장 중요한 것을 골라 반영하세요)
${newsLines}

${pbNotes ? `[본사 참고 메모]\n${pbNotes}\n` : ""}

[요청사항]
1. 위 뉴스·지표 중에서 패밀리오피스 PB가 손님에게 꼭 전달해야 할 핵심 이슈 3개를 뽑아 간결하게 정리하세요.
2. 각 이슈는 cat(이슈 구분 라벨), tag(한 줄 숫자 요약, 예: "S&P500 -0.51% · 나스닥 -1.07%"), title(기사형 제목), desc(2~3문장 설명)으로 구성하세요.
3. 전체를 아우르는 "손님 브리핑 종합 요약"(talkingPoint)을 3~5문장으로 작성하세요. 숫자는 위에서 준 값만 사용하세요.
4. 반드시 아래 JSON 스키마로만, 다른 텍스트 없이 응답하세요.

{
  "issues": [
    {"cat": "string", "tag": "string", "title": "string", "desc": "string"},
    {"cat": "string", "tag": "string", "title": "string", "desc": "string"},
    {"cat": "string", "tag": "string", "title": "string", "desc": "string"}
  ],
  "talkingPoint": "string"
}`;
}

/** API 키가 없거나 호출 실패 시에도 사이트가 절대 깨지지 않도록 하는 규칙 기반 폴백 */
function fallbackSummary({ edition, market, candidateNews }) {
  const byKey = Object.fromEntries(market.map((m) => [m.key, m]));
  const top = candidateNews.slice(0, 3);

  const issues = top.map((n, i) => ({
    cat: edition === "MORNING" ? `GLOBAL ISSUE 0${i + 1}` : `KOREA ISSUE 0${i + 1}`,
    tag: n.tags.join(" · "),
    title: n.title,
    desc: `${n.press} (${n.date}) 보도. 자동 요약 생성에 실패하여 원문 제목을 그대로 노출했습니다 — AI 요약 키 설정 또는 호출 상태를 확인해주세요.`,
  }));

  while (issues.length < 3) {
    issues.push({
      cat: edition === "MORNING" ? "GLOBAL ISSUE" : "KOREA ISSUE",
      tag: "-",
      title: "수집된 뉴스가 충분하지 않습니다.",
      desc: "다음 자동 수집 주기에 다시 채워집니다.",
    });
  }

  const ks = byKey.KOSPI,
    kq = byKey.KOSDAQ,
    sp = byKey.SP500,
    nd = byKey.NASDAQ,
    sox = byKey.SOX,
    fx = byKey.USDKRW;

  const talkingPoint =
    edition === "MORNING"
      ? `[글로벌 모닝 요약] S&P500 ${sp?.priceStr ?? "-"}(${sp?.changePct ?? "-"}%), 나스닥 ${nd?.priceStr ?? "-"}(${nd?.changePct ?? "-"}%), 필라델피아 반도체 ${sox?.priceStr ?? "-"}(${sox?.changePct ?? "-"}%)로 마감했습니다. 참고로 직전 국내 마감은 코스피 ${ks?.priceStr ?? "-"}(${ks?.changePct ?? "-"}%), 코스닥 ${kq?.priceStr ?? "-"}(${kq?.changePct ?? "-"}%)였습니다. (이 요약은 AI 생성에 실패해 규칙 기반으로 생성되었습니다.)`
      : `[국내 이브닝 요약] 코스피 ${ks?.priceStr ?? "-"}(${ks?.changePct ?? "-"}%), 코스닥 ${kq?.priceStr ?? "-"}(${kq?.changePct ?? "-"}%)로 마감했습니다. 원/달러 환율은 ${fx?.priceStr ?? "-"}원(${fx?.changePct ?? "-"}%)을 기록했습니다. (이 요약은 AI 생성에 실패해 규칙 기반으로 생성되었습니다.)`;

  return { issues, talkingPoint };
}
