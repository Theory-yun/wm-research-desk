import { fetchWithRetry } from "./fetchUtil.mjs";

/**
 * Gemini 공용 호출 모듈 — 브리핑 요약, 일정 결과 추출, 실적 공시 날짜 추출, F/O 리포트 분류에 함께 씁니다.
 *
 * 후보 모델을 위에서부터 순서대로 시도하고, 실패(503 수요 폭주·404 단종·타임아웃)하면 즉시 다음 모델로 넘어갑니다.
 * 2026-11-15 진단 결과(실제 브리핑 크기 프롬프트, 이 저장소의 키 기준):
 *   gemini-flash-latest      → 45~60초 무응답
 *   gemini-3.8-flash         → 503 high demand
 *   gemini-3.5-flash         → ✅ 약 9초
 *   gemini-3.5-flash-lite    → ✅ 약 2초
 *   gemini-2.5-flash(-lite)  → 404 신규 사용자 제공 종료
 * 버전 고정 모델이 단종돼도 "-latest" 별칭이 받쳐주도록 별칭을 뒤에 둡니다.
 * 저장소 variable GEMINI_MODEL을 지정하면 그 모델을 맨 앞에서 먼저 시도합니다.
 */
export const GEMINI_MODEL_CHAIN = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite"];
const PER_MODEL_TIMEOUT_MS = 30000;

export function hasGeminiKey() {
  return !!process.env.GEMINI_API_KEY;
}

export function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * JSON 응답을 받는 Gemini 호출.
 * @param {object} p
 * @param {string} p.prompt
 * @param {string} [p.system]
 * @param {(parsed:any)=>boolean} [p.validate]  스키마 검증 — false면 다음 모델로 넘어감
 * @param {string} [p.label]  로그용 이름
 * @param {string[]} [p.models]  후보 모델(기본: GEMINI_MODEL_CHAIN). 가벼운 작업은 lite 우선 목록을 넘기면 빠름.
 * @returns {Promise<{data:any, model:string}|null>}  모든 후보 실패 시 null
 */
export async function geminiJson({ prompt, system, validate = () => true, label = "gemini", models } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const chain = [...new Set([process.env.GEMINI_MODEL, ...(models ?? GEMINI_MODEL_CHAIN)].filter(Boolean))];
  // maxOutputTokens를 넉넉하게: 최신 모델은 내부 thinking 토큰이 같은 예산을 쓰므로 작으면 답이 비어버릴 수 있음.
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
  };

  for (const model of chain) {
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      timeoutMs: PER_MODEL_TIMEOUT_MS,
      retries: 1,
      backoffMs: 3000,
      noRetryStatuses: [400, 401, 403, 404], // 키·모델 문제는 재시도해도 같으므로 즉시 다음 모델로
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      method: "POST",
      body: JSON.stringify(body),
      responseType: "json",
    });
    if (!res) {
      console.error(`[${label}] Gemini(${model}) 응답 없음 → 다음 후보`);
      continue;
    }
    const text = res?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    const parsed = extractJson(text);
    if (parsed && validate(parsed)) {
      console.log(`[${label}] Gemini 성공: ${model}`);
      return { data: parsed, model };
    }
    console.error(`[${label}] Gemini(${model}) 응답 형식 불일치 → 다음 후보`);
  }
  return null;
}

/** 가벼운 분류·추출 작업용 후보 순서(빠른 lite 모델 우선) */
export const GEMINI_LITE_FIRST = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
