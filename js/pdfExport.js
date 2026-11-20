import { STATE, currentEditionData, escapeHtml } from "./state.js";
import { currentAssetInsights, globalSessionLabel } from "./render.js";
import { getTop5News } from "./render.js";
import { LOCAL_STORAGE_KEYS } from "./config.js";

const $ = (id) => document.getElementById(id);

const ASSET_EMOJI = { kr_equity: "🇰🇷", us_equity: "🌐", bonds: "🏦", fx: "💱", commodities: "🛢️", alternatives: "🏢" };


/* ----------------------------- 공유 공통: PB 이름 · 안내 문구 ----------------------------- */
const GUIDE_TEXT = "본 브리핑은 AI가 시장 데이터와 언론 보도를 바탕으로 작성했습니다. 내용에 오류가 있으면 말씀해 주시면 바로 수정하겠습니다. 기타 궁금하신 사항은 언제든지 문의 주세요.";

/**
 * 공유 전 PB 이름 묻기 (입력값은 이 브라우저에 기억)
 * 반환: 이름 문자열('' = 이름 없이), null = 취소
 */
export function askPbName(actionLabel) {
  return new Promise((resolve) => {
    let saved = "";
    try { saved = localStorage.getItem(LOCAL_STORAGE_KEYS.pbName) ?? ""; } catch { /* 저장소 사용 불가 */ }
    const modal = document.createElement("div");
    modal.className = "cn-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-label", "PB 이름 입력");
    modal.innerHTML = `<form class="pbname-box">
        <label for="pbname-input"><b>보내는 PB 이름</b></label>
        <p>입력하면 "손님께 전하는 <em>홍길동 PB</em>의 모닝 브리핑"처럼 표시됩니다. 비워 두면 J's WM RESEARCH DESK로 나갑니다.</p>
        <input id="pbname-input" type="text" maxlength="20" autocomplete="off" placeholder="예) 홍길동 PB" value="${escapeHtml(saved)}">
        <div class="pbname-actions">
          <button type="button" class="hdr-btn" data-act="cancel">취소</button>
          <button type="button" class="hdr-btn" data-act="none">이름 없이</button>
          <button type="submit" class="hdr-btn hdr-btn-primary">${escapeHtml(actionLabel)}</button>
        </div>
      </form>`;
    const done = (v) => { modal.remove(); resolve(v); };
    const input = () => modal.querySelector("#pbname-input");
    modal.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input().value.trim().slice(0, 20);
      try { localStorage.setItem(LOCAL_STORAGE_KEYS.pbName, name); } catch { /* 무시 */ }
      done(name);
    });
    modal.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (act === "cancel" || e.target === modal) done(null);
      if (act === "none") done("");
    });
    modal.addEventListener("keydown", (e) => e.key === "Escape" && done(null));
    document.body.appendChild(modal);
    setTimeout(() => input().focus(), 30);
  });
}

const editionName = () => (STATE.edition === "MORNING" ? "모닝 브리핑" : "이브닝 브리핑");
/** 머리말: "손님께 전하는 홍길동 PB의 모닝 브리핑" 또는 브랜드 */
const headerTitle = (pbName) => (pbName ? `손님께 전하는 ${pbName}의 ${editionName()}` : "J's WM RESEARCH DESK");

/** 지표 한 줄 요약: "코스피 5,290.53 (-0.98%)" */
const mktShort = (m) => `${m.name} ${m.priceStr} (${m.changePct > 0 ? "+" : ""}${m.changePct}%)`;

/** 화면의 브리핑 요약(편집했으면 편집본). 단락 줄바꿈 유지 */
function talkingText(data) {
  const el = $("edition-talking-point");
  const t = (el?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return t || data.talkingPoint || "";
}

/**
 * 손님 전달용 카톡 문구 — 마크다운 기호(*) 없이 읽기 쉬운 순수 텍스트.
 * 순서: 종합 요약 → 핵심 이슈 → 필독 뉴스 → 자산별 시사점(한 줄씩) → 지표(간단히)
 */
export function buildKakaoText(pbName = "") {
  const data = currentEditionData();
  if (!data) return "";
  const isMorning = STATE.edition === "MORNING";
  const sess = globalSessionLabel(data);
  const title = isMorning ? `모닝 브리핑 (${sess.overnight ? "간밤 글로벌" : `${sess.label} 글로벌`})` : "이브닝 브리핑 (당일 국내)";
  const line = "──────────";
  // 카톡에서 그대로 보이는 숫자 이모지 (10 넘으면 일반 숫자)
  const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  const num = (i) => NUM[i] ?? `${i + 1}.`;

  const issues = (data.issues ?? []).map((i, idx) => `${num(idx)} ${i.title}\n${i.desc}`).join("\n\n");
  const news = getTop5News()
    .map((n, i) => `${num(i)} ${n.title}\n${n.press} · ${n.date}\n🔗 ${n.shortUrl || n.url}`)
    .join("\n\n");
  const assets = (currentAssetInsights(data)?.cards ?? [])
    .filter((c) => c.headline && !/^뚜렷한 신호 없음/.test(c.headline))
    .map((c) => `${ASSET_EMOJI[c.key] ?? "▪️"} ${c.name}: ${c.headline}`)
    .join("\n");
  const mk = (m) => `${m.changePct > 0 ? "🔺" : m.changePct < 0 ? "🔽" : "▫️"} ${mktShort(m)}`;
  const kr = data.market.filter((m) => m.group === "domestic").map(mk).join("\n");
  const gl = data.market.filter((m) => m.group !== "domestic").map(mk).join("\n");

  return [
    ...(pbName
      ? [`${isMorning ? "🌅" : "🌇"} ${headerTitle(pbName)}`, `(${isMorning ? (sess.overnight ? "간밤 글로벌" : `${sess.label} 글로벌`) : "당일 국내"})`]
      : [`🏛️ J's WM RESEARCH DESK`, `${isMorning ? "🌅" : "🌇"} ${title}`]),
    `🕒 ${data.generatedAtKST} 기준`,
    "",
    "📝 브리핑 요약",
    talkingText(data),
    "",
    line,
    "🔥 핵심 이슈",
    issues,
    "",
    line,
    "📰 필독 뉴스",
    news,
    ...(assets ? ["", line, "💼 자산별 시사점", assets] : []),
    "",
    line,
    "📊 주요 지표",
    kr,
    gl,
    "",
    `💬 ${GUIDE_TEXT}`,
    "※ 투자 권유가 아닌 참고 자료입니다.",
    ...(pbName ? ["", `- ${pbName} 드림`] : []),
  ].join("\n");
}

/** 휴대폰(터치 기기) 여부 — 공유창은 휴대폰에서만 띄움(PC 카카오톡은 공유 대상에 잘 나오지 않음) */
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 일부 인앱 브라우저용 대체 복사
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.("copy");
    ta.remove();
    return Boolean(ok);
  }
}

/** 카톡 공유: 문구를 복사하고, 휴대폰이면 공유창(카카오톡 선택 → 바로 입력됨)을 띄움 */
export async function shareKakaoBriefing() {
  const pbName = await askPbName("카톡 공유");
  if (pbName === null) return;
  const msg = buildKakaoText(pbName);
  if (!msg) return;
  const copied = await copyText(msg);
  if (isMobile() && navigator.share) {
    try {
      await navigator.share({ text: msg });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return; // 사용자가 공유창을 닫음 (문구는 이미 복사됨)
    }
  }
  alert(copied ? "손님 카톡 브리핑 문구가 복사되었습니다. 카카오톡 채팅방에 붙여넣기(Ctrl+V) 하세요." : "복사하지 못했습니다. 다시 시도해 주세요.");
}
export const copyKakaoBriefing = shareKakaoBriefing;

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const clip = (t, n) => {
  const s = String(t ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const kstNow = () => new Date(Date.now() + 9 * 3600e3);

/**
 * 보고서 출력 시점이 속한 주(월~일, 한국시간)의 주요 일정.
 * 토·일요일에 출력하면 이미 지나간 주 대신 다가오는 주(다음 주)를 보여줍니다.
 */
function thisWeekEvents() {
  const now = kstNow();
  const dow = (now.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const weekend = dow >= 5;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - dow + (weekend ? 7 : 0));
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const from = mon.toISOString().slice(0, 10);
  const to = sun.toISOString().slice(0, 10);
  const kinds = STATE.macro?.kinds ?? {};
  const prio = { rate: 0, data: 1, politics: 2, earnings: 3, derivatives: 4, market: 5 };
  const items = [...(STATE.macro?.items ?? []), ...(STATE.autoEvents ?? [])]
    .filter((e) => e.date >= from && e.date <= to && kinds[e.kind])
    .sort((a, b) => a.date.localeCompare(b.date) || (prio[kinds[a.kind].category] ?? 9) - (prio[kinds[b.kind].category] ?? 9));
  return { from, to, items, kinds, label: weekend ? "다음 주 주요 일정" : "이번 주 주요 일정" };
}

export function buildFormalPdfHtml() {
  const data = currentEditionData();
  const talking = talkingText(data);
  const top5 = getTop5News(5);
  const isMorning = STATE.edition === "MORNING";
  const sess = globalSessionLabel(data);
  const edTitle = isMorning ? `모닝 · ${sess.overnight ? "간밤" : sess.label} 글로벌` : "이브닝 · 당일 국내";
  const printed = kstNow();
  const printedStr = `${printed.getUTCFullYear()}.${String(printed.getUTCMonth() + 1).padStart(2, "0")}.${String(printed.getUTCDate()).padStart(2, "0")} ${String(printed.getUTCHours()).padStart(2, "0")}:${String(printed.getUTCMinutes()).padStart(2, "0")}`;

  // 01 손님 브리핑 요약 (단락 유지, 너무 길면 마지막 단락부터 자름)
  let budget = 980;
  const paras = talking.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const t = budget <= 0 ? "" : clip(p, budget);
    budget -= p.length;
    return t;
  }).filter(Boolean);
  const summaryHtml = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");

  // 02 주요 이슈
  const issues = data.issues
    .slice(0, 3)
    .map(
      (iss, i) => `<div class="rp-issue">
        <div class="rp-issue-head"><span class="rp-num">${i + 1}</span><span class="rp-issue-cat">${escapeHtml(clip(iss.cat, 16))}</span></div>
        <div class="rp-issue-title">${escapeHtml(clip(iss.title, 44))}</div>
        <div class="rp-issue-desc">${escapeHtml(clip(iss.desc, 96))}</div>
      </div>`
    )
    .join("");

  // 03 필독 뉴스 (원문 링크)
  const news = top5
    .map(
      (n, i) => `<a class="rp-news" href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer">
        <span class="rp-num ${i < 2 ? "gold" : ""}">${i + 1}</span>
        <span class="rp-news-body">
          <span class="rp-news-title">${escapeHtml(clip(n.title, 36))}</span>
          <span class="rp-news-meta">${escapeHtml(n.press)}${n.coverage ? ` · ${n.coverage}개 언론 보도` : ""}${n.shortUrl ? ` · ${escapeHtml(n.shortUrl.replace(/^https?:\/\//, ""))}` : ""}</span>
        </span>
        
      </a>`
    )
    .join("");

  // 04 자산별 시사점
  const lvClass = (l) => (l === "변동 큼" ? "high" : l === "주목" ? "mid" : "low");
  const assets = currentAssetInsights(data)?.cards ?? [];
  const assetsHtml = assets.length
    ? assets
        .map(
          (c) => `<div class="rp-asset">
            <div class="rp-asset-name">${escapeHtml(c.name)} <span class="rp-lv lv-${lvClass(c.level)}">${escapeHtml(c.level ?? "")}</span></div>
            <div class="rp-asset-text">${escapeHtml(clip(c.headline, 40))}</div>
          </div>`
        )
        .join("")
    : `<div class="rp-empty">자산별 시사점 데이터가 없습니다.</div>`;

  // 05 이번 주 주요 일정
  const wk = thisWeekEvents();
  const regionShort = { US: "美", KR: "韓", EU: "EU", JP: "日", GL: "" };
  const fmt = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
  };
  const MAX_EV = 7;
  const evRows = wk.items.slice(0, MAX_EV).map((e) => {
    const k = wk.kinds[e.kind];
    const res = STATE.eventResults?.[e.id ?? `${e.date}|${e.kind}`];
    return `<tr>
      <td class="rp-ev-date">${fmt(e.date)}</td>
      <td class="rp-ev-name"><span class="rp-ev-pill cat-${k.category}">${escapeHtml(regionShort[k.region] ?? "")}</span> ${escapeHtml(clip(e.title ?? k.name, 22))}${res ? `<span class="rp-ev-res"> → ${escapeHtml(clip(res.headline, 20))}</span>` : ""}</td>
    </tr>`;
  });
  const more = wk.items.length > MAX_EV ? `<div class="rp-more">외 ${wk.items.length - MAX_EV}건 — 대시보드 캘린더 참고</div>` : "";

  // 하단: 주요 지표 한 줄
  const mkt = data.market
    .map((m) => {
      const cls = m.changePct > 0 ? "up" : m.changePct < 0 ? "down" : "";
      return `<span><b>${escapeHtml(m.name)}</b> ${escapeHtml(m.priceStr)} <em class="${cls}">${m.changePct > 0 ? "+" : ""}${escapeHtml(m.changePct)}%</em></span>`;
    })
    .join("");

  return `
    <div class="rp-page">
      <header class="rp-header">
        <div class="rp-brand"><span class="rp-badge">J's WM RESEARCH DESK</span><span class="rp-title">데일리 마켓 브리핑</span><span class="rp-edition">${escapeHtml(edTitle)}</span></div>
        <div class="rp-meta">데이터 기준 <b>${escapeHtml(data.generatedAtKST)}</b> · 출력 ${escapeHtml(printedStr)}</div>
      </header>

      <div class="rp-grid2">
        <section class="rp-box rp-summary rp-a">
          <h3><span>01</span> 손님 브리핑 요약</h3>
          <div class="rp-summary-body">${summaryHtml}</div>
        </section>
        <section class="rp-box rp-b">
          <h3><span>02</span> 핵심 이슈</h3>
          ${issues}
        </section>
        <section class="rp-box rp-c">
          <h3><span>03</span> 손님 필독 뉴스 <small>링크 주소로 원문 확인</small></h3>
          ${news}
        </section>
        <section class="rp-box rp-d">
          <h3><span>04</span> 자산별 시사점</h3>
          <div class="rp-assets">${assetsHtml}</div>
        </section>
        <section class="rp-box rp-e">
          <h3><span>05</span> ${wk.label} <small>${fmt(wk.from)}~${fmt(wk.to)}</small></h3>
          ${evRows.length ? `<table class="rp-ev"><tbody>${evRows.join("")}</tbody></table>${more}` : `<div class="rp-empty">등록된 주요 일정이 없습니다.</div>`}
        </section>
      </div>

      <div class="rp-mktline"><span class="rp-mkt-label">주요 지표</span>${mkt}</div>
      <footer class="rp-footer">본 자료는 J's WM RESEARCH DESK가 PB 상담 참고용으로 시장 데이터와 공시·보도를 바탕으로 자동 생성(AI 요약 포함)되었으며, 투자 권유가 아니고 투자 결과에 대한 법적 책임의 증빙자료로 사용될 수 없습니다. 손님 전달 전 PB의 확인을 권장합니다.</footer>
    </div>
  `;
}

/** 손님용 브리핑을 가로 1장 이미지(PNG)로 생성 — PC는 내려받기, 휴대폰은 공유창(카카오톡 등) */
export async function downloadBriefingImage() {
  const wrap = $("formal-pdf-report-wrapper");
  const btn = $("btn-image-download");
  if (!wrap || !btn) return;
  if (!window.html2canvas) {
    alert("이미지 생성 도구를 불러오는 중입니다. 잠시 후 다시 눌러 주세요.");
    return;
  }
  const orig = btn.textContent;
  btn.textContent = "이미지 생성 중…";
  btn.disabled = true;

  wrap.innerHTML = buildFormalPdfHtml();
  const prevScroll = window.scrollY;
  window.scrollTo(0, 0);
  Object.assign(wrap.style, { display: "block", margin: "0" });

  const data = currentEditionData();
  const edTag = STATE.edition === "MORNING" ? "Morning" : "Evening";
  const fName = `Js_WM_RESEARCH_DESK_브리핑_${data.generatedAtKST.replace(/[.\s:]/g, "")}_${edTag}.png`;

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = await window.html2canvas(wrap.querySelector(".rp-page"), { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 });
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const file = new File([blob], fName, { type: "image/png" });
    let shared = false;
    if (isMobile() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "J's WM RESEARCH DESK 브리핑" });
        shared = true;
      } catch (e) {
        shared = e?.name === "AbortError";
      }
    }
    if (!shared) {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: fName });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  } catch (err) {
    alert(`이미지를 만들지 못했습니다: ${err.message}`);
  } finally {
    Object.assign(wrap.style, { display: "none", margin: "" });
    wrap.innerHTML = "";
    window.scrollTo(0, prevScroll);
    btn.textContent = orig;
    btn.disabled = false;
  }
}

/* =========================================================================
   카드뉴스 6장 (1080×1350) — 받는 사람이 휴대폰에서 바로 읽기 쉽게 큰 글씨로 나눠 공유
   1 손님 브리핑 · 2 핵심 이슈 · 3 필독 뉴스 · 4 자산별 시사점 · 5 주요 지표 · 6 이번 주 일정 + 인사말
   숫자·문구는 해당 브리핑 수집 기준(PB의 생각 반영본이 있으면 그 요약)
   ========================================================================= */
/* 핵심 수치·키워드 하이라이트: 숫자(단위 포함)는 형광펜, 지수·기관명 등은 굵게 */
const HL_KEYWORDS = ["S&P 500", "S&P500", "코스피", "코스닥", "나스닥", "다우", "필라델피아 반도체", "반도체 지수", "원/달러", "달러인덱스", "엔/달러", "연준", "Fed", "FOMC", "금통위", "한국은행", "ECB", "일본은행", "미 10년물", "국채 금리", "WTI", "유가", "금값", "국제 금값", "비트코인", "외국인", "기관", "엔비디아", "삼성전자", "SK하이닉스", "AI"];
const HL_RE = new RegExp(
  `(${HL_KEYWORDS.sort((x, y) => y.length - x.length).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})` +
    `|([+\\-−▲▼]?\\s?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?(?:\\s?(?:%p|%|bp|원|달러|포인트|엔|선))?|[+\\-−▲▼]?\\s?\\d+(?:\\.\\d+)?\\s?(?:%p|%|bp|원|달러|포인트|조\\s?원|억\\s?원|조|억|배|엔|선|년물)|\\d+\\.\\d+)`,
  "g"
);
function highlight(raw) {
  const text = String(raw ?? "");
  let out = "";
  let last = 0;
  for (const m of text.matchAll(HL_RE)) {
    out += escapeHtml(text.slice(last, m.index));
    out += m[1] ? `<b class="hl-k">${escapeHtml(m[0])}</b>` : `<mark class="hl-n">${escapeHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

/** 지표별 종가 기준일: 국내 "11.16 종가", 해외 "현지 11.13 종가", 환율 "11.17 06:33 기준" */
function closeLabel(m, data) {
  const md = (s) => String(s ?? "").match(/(\d{2})\.(\d{2})/)?.[0];
  if (m.group === "domestic") return md(m.asOfKst) ? `${md(m.asOfKst)} 종가` : `${String(data.generatedAtKST).slice(5, 10)} 기준`;
  if (m.key === "USDKRW") return `${String(data.generatedAtKST).slice(5)} 기준`;
  return md(m.asOfLocal) ? `현지 ${md(m.asOfLocal)} 종가` : md(m.asOfKst) ? `${md(m.asOfKst)} 기준` : "";
}

/** 주간 일정: offset 0 = 금주(월~일), 1 = 차주 */
function weekEvents(offset) {
  const now = kstNow();
  const dow = (now.getUTCDay() + 6) % 7;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - dow + offset * 7);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const from = mon.toISOString().slice(0, 10);
  const to = sun.toISOString().slice(0, 10);
  const kinds = STATE.macro?.kinds ?? {};
  const prio = { rate: 0, data: 1, politics: 2, earnings: 3, derivatives: 4, market: 5 };
  const items = [...(STATE.macro?.items ?? []), ...(STATE.autoEvents ?? [])]
    .filter((e) => e.date >= from && e.date <= to && kinds[e.kind])
    .sort((a, b) => a.date.localeCompare(b.date) || (prio[kinds[a.kind].category] ?? 9) - (prio[kinds[b.kind].category] ?? 9));
  return { from, to, items, kinds };
}

function cardShell(i, top, edLabel, title, body) {
  // 모닝 = 낮(밝은 바탕·딥그린 포인트), 이브닝 = 밤(딥그린 바탕·골드)
  const theme = STATE.edition === "MORNING" ? "cn-day" : "cn-night";
  return `<section class="cn-card ${theme}"><div class="cn-frame">
    <header class="cn-top"><span class="cn-brand">${escapeHtml(top)}</span><span class="cn-pg">${String(i).padStart(2, "0")} <i>/ 06</i></span></header>
    <div class="cn-head"><div class="cn-ed">${escapeHtml(edLabel)}</div><h2 class="cn-title">${title}</h2><div class="cn-rule"></div></div>
    <div class="cn-body">${body}</div>
    <footer class="cn-foot">시장 데이터·보도 기반 참고 자료이며 투자 권유가 아닙니다.</footer>
  </div></section>`;
}

export function buildCardNewsHtml(pbName = "") {
  const data = currentEditionData();
  if (!data) return [];
  const isMorning = STATE.edition === "MORNING";
  const sess = globalSessionLabel(data);
  const [, mo, d] = String(data.generatedAtKST).split(/[.\s]/);
  const wd = WD[new Date(Date.UTC(Number(String(data.generatedAtKST).slice(0, 4)), Number(mo) - 1, Number(d))).getUTCDay()];
  const scope = isMorning ? (sess.overnight ? "간밤 글로벌 시장" : `${sess.label} 글로벌 시장`) : "오늘 국내 시장";
  const top = headerTitle(pbName);
  const edLabel = pbName ? `${Number(mo)}월 ${Number(d)}일(${wd}) · ${scope}` : `${Number(mo)}월 ${Number(d)}일(${wd}) ${editionName()} · ${scope}`;
  const pbApplied = Boolean(STATE.pbOverride);
  const shell = (i, title, body) => cardShell(i, top, edLabel, title, body);

  // 1. 손님 브리핑
  const paras = talkingText(data).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const c1 = shell(1, `손님 브리핑${pbApplied ? ' <span class="cn-badge">PB 의견 반영</span>' : ""}`,
    `<div class="cn-summary">${paras.map((p) => `<p>${highlight(p)}</p>`).join("")}</div>`);

  // 2. 핵심 이슈
  const c2 = shell(2, "오늘의 핵심 이슈",
    (data.issues ?? []).slice(0, 3).map((it, i) => `<div class="cn-issue">
      <div class="cn-issue-n">${i + 1}</div>
      <div><div class="cn-issue-cat">${escapeHtml(it.cat ?? "")}</div><div class="cn-issue-title">${highlight(it.title)}</div><div class="cn-issue-desc">${highlight(it.desc ?? "")}</div></div>
    </div>`).join(""));

  // 3. 필독 뉴스
  const news = getTop5News(5);
  const c3 = shell(3, isMorning ? "손님 필독 글로벌 뉴스" : "손님 필독 국내 뉴스",
    news.map((n, i) => `<div class="cn-news">
      <div class="cn-news-n">${i + 1}</div>
      <div><div class="cn-news-title">${escapeHtml(n.title)}</div>
      <div class="cn-news-meta">${escapeHtml(n.press)}${n.coverage ? ` · ${n.coverage}개 언론 보도` : ""}${n.shortUrl ? ` · <b>${escapeHtml(n.shortUrl.replace(/^https?:\/\//, ""))}</b>` : ""}</div></div>
    </div>`).join("") + `<div class="cn-note">링크 주소는 함께 보내드리는 카톡 메시지에서 누르실 수 있습니다.</div>`);

  // 4. 자산별 시사점
  const lvCls = (l) => (l === "변동 큼" ? "high" : l === "주목" ? "mid" : "low");
  const assets = currentAssetInsights(data)?.cards ?? [];
  const c4 = shell(4, "자산별 시사점",
    assets.map((c) => `<div class="cn-asset">
      <div class="cn-asset-head"><span>${ASSET_EMOJI[c.key] ?? ""} ${escapeHtml(c.name)}</span><span class="cn-lv lv-${lvCls(c.level)}">${escapeHtml(c.level ?? "")}</span></div>
      <div class="cn-asset-text">${highlight(c.headline ?? "")}</div>
    </div>`).join(""));

  // 5. 주요 지표 (브리핑 수집 기준, 지표별 종가 기준일)
  const pctTxt = (v) => `${v > 0 ? "+" : ""}${v}%`;
  const big = (data.market ?? []).map((m) => {
    const cls = m.changePct > 0 ? "up" : m.changePct < 0 ? "down" : "";
    return `<div class="cn-mkt"><div class="cn-mkt-name">${escapeHtml(m.name)}<span class="cn-mkt-date">${escapeHtml(closeLabel(m, data))}</span></div><div class="cn-mkt-price">${escapeHtml(m.priceStr)}</div><div class="cn-mkt-chg ${cls}">${m.changePct > 0 ? "▲" : m.changePct < 0 ? "▼" : "·"} ${pctTxt(m.changePct)}</div></div>`;
  }).join("");
  const extra = (data.extraMarket ?? []).map((m) => {
    const cls = m.changePct > 0 ? "up" : m.changePct < 0 ? "down" : "";
    return `<div class="cn-ex"><span>${escapeHtml(m.name)}</span><b>${escapeHtml(m.priceStr)}${escapeHtml(m.unit ?? "")}</b><em class="${cls}">${escapeHtml(m.chgStr ?? pctTxt(m.changePct))}</em></div>`;
  }).join("");
  const c5 = shell(5, "주요 지표",
    `<div class="cn-mkt-grid">${big}</div>${extra ? `<div class="cn-ex-wrap"><div class="cn-sub">참고 지표 (직전 거래일 종가 기준)</div>${extra}</div>` : ""}<div class="cn-note">각 지표 이름 옆에 종가 기준일을 표기했습니다 · ${escapeHtml(data.generatedAtKST)} 수집</div>`);

  // 6. 금주 · 차주 일정 + 안내 문구
  const regionShort = { US: "미국", KR: "한국", EU: "유럽", JP: "일본", GL: "" };
  const fmt = (iso) => { const t = new Date(`${iso}T00:00:00Z`); return `${t.getUTCMonth() + 1}/${t.getUTCDate()} (${WD[t.getUTCDay()]})`; };
  const today = kstNow().toISOString().slice(0, 10);
  const evList = (wk, max) => wk.items.slice(0, max).map((e) => {
    const k = wk.kinds[e.kind];
    return `<div class="cn-ev ${e.date < today ? "past" : ""}"><span class="cn-ev-d">${fmt(e.date)}</span><span class="cn-ev-t">${regionShort[k.region] ? `<i>${regionShort[k.region]}</i>` : ""}${escapeHtml(e.title ?? k.name)}</span></div>`;
  }).join("") || `<div class="cn-ev-none">등록된 주요 일정이 없습니다.</div>`;
  const w0 = weekEvents(0);
  const w1 = weekEvents(1);
  const range = (w) => `${fmt(w.from)} ~ ${fmt(w.to)}`;
  const c6 = shell(6, "금주 · 차주 핵심 일정",
    `<div class="cn-wk"><div class="cn-wk-h">금주 <span>${range(w0)}</span></div><div class="cn-evs">${evList(w0, 5)}</div></div>
     <div class="cn-wk"><div class="cn-wk-h">차주 <span>${range(w1)}</span></div><div class="cn-evs">${evList(w1, 5)}</div></div>
     <div class="cn-greet">${escapeHtml(GUIDE_TEXT)}<div class="cn-sign">${escapeHtml(pbName ? `${pbName} 드림` : "J's WM RESEARCH DESK")}</div></div>`);

  return [c1, c2, c3, c4, c5, c6];
}

/** 카드 본문이 넘치면 글자 크기를 줄여 맞춤 */
function fitCard(card) {
  const body = card.querySelector(".cn-body");
  let size = 34;
  body.style.fontSize = `${size}px`;
  while (body.scrollHeight > body.clientHeight + 1 && size > 22) {
    size -= 1;
    body.style.fontSize = `${size}px`;
  }
}

/** 카드뉴스 6장 생성 → 휴대폰은 공유창(카톡에 6장 한 번에), PC는 미리보기 창에서 저장 */
export async function shareCardNews() {
  const btn = $("btn-cardnews");
  if (!window.html2canvas) {
    alert("이미지 생성 도구를 불러오는 중입니다. 잠시 후 다시 눌러 주세요.");
    return;
  }
  const pbName = await askPbName("카드뉴스 만들기");
  if (pbName === null) return;
  const cards = buildCardNewsHtml(pbName);
  if (!cards.length) return;
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "만드는 중…"; }
  const overlay = Object.assign(document.createElement("div"), { className: "cn-overlay", textContent: "카드뉴스 6장을 만들고 있습니다…" });
  document.body.appendChild(overlay);
  const stage = Object.assign(document.createElement("div"), { className: "cn-stage" });
  document.body.appendChild(stage);
  const prevScroll = window.scrollY;
  window.scrollTo(0, 0);

  const data = currentEditionData();
  const stamp = data.generatedAtKST.replace(/[.\s:]/g, "");
  const files = [];
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    for (let i = 0; i < cards.length; i++) {
      stage.innerHTML = cards[i];
      const el = stage.firstElementChild;
      fitCard(el);
      const canvas = await window.html2canvas(el, { scale: 1, useCORS: true, backgroundColor: STATE.edition === "MORNING" ? "#FBF8F1" : "#0A2B28", scrollX: 0, scrollY: 0, width: 1080, height: 1350 });
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      files.push(new File([blob], `WMdesk_${stamp}_${i + 1}.jpg`, { type: "image/jpeg" }));
    }
  } catch (err) {
    alert(`카드뉴스를 만들지 못했습니다: ${err.message}`);
    return;
  } finally {
    stage.remove();
    overlay.remove();
    window.scrollTo(0, prevScroll);
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }

  if (isMobile() && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: "J's WM RESEARCH DESK 브리핑" });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return; // 사용자가 공유창을 닫음
      // NotAllowedError 등(생성 시간이 길어 바로 공유가 막힘) → 미리보기에서 '공유하기'로
    }
  }
  openCardNewsPreview(files);
}

/** 미리보기 창: 6장 보기 + 한 장씩/모두 저장 */
function openCardNewsPreview(files) {
  const urls = files.map((f) => URL.createObjectURL(f));
  // 생성에 몇 초 걸려 처음 공유 요청이 막힐 수 있음 → 미리보기의 '공유하기'로 다시 시도(새 클릭이라 허용됨)
  const canShareFiles = isMobile() && Boolean(navigator.canShare?.({ files }));
  const modal = document.createElement("div");
  modal.className = "cn-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", "카드뉴스 미리보기");
  modal.innerHTML = `<div class="cn-modal-box">
      <div class="cn-modal-head"><b>카드뉴스 6장</b><span>${canShareFiles ? "공유하기를 누르면 카카오톡 등으로 6장을 한 번에 보낼 수 있습니다." : "이미지를 눌러 한 장씩, 또는 모두 저장하세요."}</span>
        ${canShareFiles ? '<button type="button" class="hdr-btn hdr-btn-primary" data-act="share">공유하기</button>' : ""}
        <button type="button" class="hdr-btn ${canShareFiles ? "" : "hdr-btn-primary"}" data-act="all">모두 저장</button>
        <button type="button" class="hdr-btn" data-act="close" aria-label="닫기">닫기</button></div>
      <div class="cn-modal-grid">${urls.map((u, i) => `<a href="${u}" download="${files[i].name}" title="이 장 저장"><img src="${u}" alt="카드뉴스 ${i + 1}번"></a>`).join("")}</div>
    </div>`;
  const close = () => { modal.remove(); setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000); };
  modal.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (e.target === modal || act === "close") close();
    if (act === "share") navigator.share({ files, title: "J's WM RESEARCH DESK 브리핑" }).catch(() => {});
    if (act === "all") files.forEach((f, i) => setTimeout(() => { const a = Object.assign(document.createElement("a"), { href: urls[i], download: f.name }); document.body.appendChild(a); a.click(); a.remove(); }, i * 400));
  });
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
  document.body.appendChild(modal);
}
