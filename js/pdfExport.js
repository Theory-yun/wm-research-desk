import { STATE, currentEditionData, escapeHtml } from "./state.js";
import { currentAssetInsights, globalSessionLabel } from "./render.js";
import { getTop5News } from "./render.js";

const $ = (id) => document.getElementById(id);

const ASSET_EMOJI = { kr_equity: "🇰🇷", us_equity: "🌐", bonds: "🏦", fx: "💱", commodities: "🛢️", alternatives: "🏢" };

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
export function buildKakaoText() {
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
    `🏛️ J's WM RESEARCH DESK`,
    `${isMorning ? "🌅" : "🌇"} ${title}`,
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
    "※ 시장 데이터와 보도를 바탕으로 자동 작성된 참고 자료이며 투자 권유가 아닙니다.",
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
  const msg = buildKakaoText();
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
