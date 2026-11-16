/**
 * 중계 서버(Cloudflare Workers) 연동
 *  - 실시간 시세: 상단 티커만 1분마다 갱신 (핵심지표 타일·요약·PDF는 브리핑 수집 값 유지)
 *  - PB의 생각: 손님 브리핑 요약을 PB 관점으로 다시 작성 (메모리에만 보관, 새로고침하면 AI 원본)
 * 서버 주소는 배포 때 자동 기록되는 data/api-config.json에서 읽습니다. 없으면 두 기능 모두 꺼짐.
 */
import { STATE } from "./state.js";
import { fetchJson } from "./dataLoader.js";

let API_BASE = null;
let timer = null;

export async function initLiveApi(onQuotes) {
  try {
    const cfg = await fetchJson(`./data/api-config.json?t=${Date.now()}`);
    API_BASE = cfg?.apiBase ? String(cfg.apiBase).replace(/\/$/, "") : null;
  } catch {
    API_BASE = null;
  }
  STATE.apiReady = Boolean(API_BASE);
  if (!API_BASE) return false;

  const tick = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch(`${API_BASE}/quotes`, { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      STATE.live = { updatedAt: d.updatedAt, items: Object.fromEntries((d.items ?? []).map((q) => [q.key, q])) };
      onQuotes?.();
    } catch {
      /* 실패하면 브리핑 수집 값 그대로 */
    }
  };
  await tick();
  clearInterval(timer);
  timer = setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", () => !document.hidden && tick());
  return true;
}

export async function requestPbRewrite(pbView, file) {
  if (!API_BASE) throw new Error("중계 서버가 아직 연결되지 않았습니다.");
  const r = await fetch(`${API_BASE}/pb-rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pbView, file }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.talkingPoint) throw new Error(d.message || "AI 응답을 받지 못했습니다.");
  return d;
}
