/**
 * Gemini API 진단 스크립트 (수동 실행 전용 — .github/workflows/diagnose-gemini.yml)
 *
 * 키 값 자체는 절대 출력하지 않고, 아래만 확인합니다.
 *  1) 키 형식 기본 점검(길이/앞뒤 공백/따옴표 포함 여부) — 복사·붙여넣기 실수 검출
 *  2) 모델 목록 조회(ListModels) — 키가 유효한지, 어떤 모델을 쓸 수 있는지
 *  3) 후보 모델별 초소형 generateContent 호출 — HTTP 상태, 소요시간, 구글이 돌려준 에러 메시지
 */
const RAW_KEY = process.env.GEMINI_API_KEY ?? "";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function line(title) {
  console.log(`\n==================== ${title} ====================`);
}

async function call(url, init = {}, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - started, text };
  } catch (err) {
    return { status: "NETWORK_ERROR", ms: Date.now() - started, text: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function googleErrorMessage(text) {
  try {
    const j = JSON.parse(text);
    if (j.error) return `${j.error.status ?? ""} ${j.error.message ?? ""}`.trim();
  } catch {
    /* noop */
  }
  return text.slice(0, 300);
}

async function main() {
  line("1. 키 형식 점검");
  if (!RAW_KEY) {
    console.log("❌ GEMINI_API_KEY 시크릿이 비어 있습니다. (이름 오타 또는 미등록)");
    process.exit(0);
  }
  const key = RAW_KEY.trim();
  console.log(`길이: ${RAW_KEY.length}자 (공백 제거 후 ${key.length}자)`);
  console.log(`앞뒤 공백/줄바꿈 포함: ${RAW_KEY !== key ? "⚠️ 예 — 붙여넣을 때 공백이 같이 들어갔습니다" : "아니오"}`);
  console.log(`따옴표 포함: ${/["']/.test(key) ? "⚠️ 예 — 따옴표 없이 키만 넣어야 합니다" : "아니오"}`);
  console.log(`키 접두어 형식: ${key.startsWith("AIza") ? "AIza(기존형)" : "신규 형식(아래 2번 결과로 유효성 판단)"}`);

  line("2. 모델 목록 조회 (키 유효성)");
  const list = await call(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } }, 20000);
  console.log(`HTTP ${list.status} (${list.ms}ms)`);
  let available = [];
  if (list.status === 200) {
    const models = JSON.parse(list.text).models ?? [];
    available = models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
    console.log(`✅ 키 유효 — generateContent 지원 모델 ${available.length}개`);
    console.log(available.filter((n) => /flash|pro/i.test(n)).join("\n"));
  } else {
    console.log(`❌ 키 확인 실패: ${googleErrorMessage(list.text)}`);
  }

  line("3. 모델별 테스트 호출 (짧은 프롬프트)");
  const candidates = [...new Set([
    process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ])].filter((m) => available.length === 0 || available.includes(m));

  // 실제 브리핑과 비슷한 분량의 프롬프트(뉴스 헤드라인 15건 + 지표)로 소요시간을 측정합니다.
  const headlines = Array.from({ length: 15 }, (_, i) => `- [언론사${i + 1}] 글로벌 증시와 금리, 환율 관련 테스트 헤드라인 ${i + 1}`).join("\n");
  const realisticPrompt =
    `[시장 지표]\n- 코스피: 5,290.53 (▼ -52.20, -0.98%)\n- S&P500: 7,561.67 (-0.4%)\n\n[뉴스 헤드라인]\n${headlines}\n\n` +
    `아래 JSON 스키마로만 답하세요: {"issues":[{"tag":"","title":"","body":""}],"talkingPoint":""} — issues는 3개, 각 body 2문장.`;

  for (const model of candidates) {
    const body = {
      contents: [{ role: "user", parts: [{ text: realisticPrompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
    };
    const r = await call(
      `${BASE}/models/${model}:generateContent`,
      { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) },
      45000
    );
    let detail = "";
    if (r.status === 200) {
      const j = JSON.parse(r.text);
      const out = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
      let schemaOk = false;
      try {
        const parsed = JSON.parse(out);
        schemaOk = Array.isArray(parsed.issues) && parsed.issues.length > 0 && !!parsed.talkingPoint;
      } catch {
        /* noop */
      }
      detail = `스키마 ${schemaOk ? "✅" : "❌"} · finishReason=${j?.candidates?.[0]?.finishReason} · 실제모델=${j?.modelVersion ?? "-"} · 출력 ${out.length}자`;
    } else {
      detail = googleErrorMessage(r.text);
    }
    console.log(`[${model}] HTTP ${r.status} · ${r.ms}ms · ${detail}`);
  }
}

main();
