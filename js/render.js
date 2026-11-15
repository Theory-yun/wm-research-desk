import { STATE, currentEditionData, escapeHtml, StorageUtil } from "./state.js";
import { renderMacroCalendar, renderUpcomingStrip } from "./macroCalendar.js";
import { renderArchivePicker } from "./archive.js";
import { TAG_CLASS_MAP, LOCAL_STORAGE_KEYS, TOP5_DEFAULT_COUNT, tagBadge } from "./config.js";
import { isKrxOpenNow } from "./util.js";

const $ = (id) => document.getElementById(id);

function tagClass(t) {
  return TAG_CLASS_MAP[t] || "tag-macro";
}

function statusBadgeLabel(status) {
  switch (status) {
    case "ok":
      return { cls: "ok", text: "✔ 자동 수집 데이터 정상" };
    case "partial":
      return { cls: "partial", text: "⚠ 일부 지표/뉴스 갱신 실패 — 이전 값 혼재" };
    case "failed":
      return { cls: "failed", text: "⚠ 갱신 실패 — 이전 데이터 표시 중" };
    case "seed":
    default:
      return { cls: "seed", text: "⚠ 초기 샘플 데이터 — 아직 자동 수집 전 (README 참고)" };
  }
}

/* ----------------------------- 상단 티커 ----------------------------- */
export function renderTicker() {
  const track = $("wm-ticker-track");
  const data = currentEditionData();
  if (!track || !data) return;

  const krxOpen = isKrxOpenNow();

  const buildItem = (m) => {
    const isUp = m.changePct >= 0;
    const dir = m.stale ? "wm-flat" : isUp ? "wm-up" : "wm-down";
    const arrow = m.stale ? "•" : isUp ? "▲" : "▼";
    const liveBadge =
      m.group === "domestic"
        ? krxOpen
          ? "LIVE"
          : "장마감"
        : "해외마감";
    return `
      <div class="wm-ticker-item">
        ${m.stale ? '<span class="wm-stale-dot" title="갱신 실패"></span>' : ""}
        <span class="wm-ticker-name">[${liveBadge}] ${escapeHtml(m.name)}</span>
        <span class="${dir}">${escapeHtml(m.priceStr)}</span>
        <span class="${dir}">${arrow} ${escapeHtml(String(m.diffStr).replace(/^[▲▼]\s*/, ""))} (${m.changePct >= 0 ? "+" : ""}${m.changePct}%)</span>
      </div>
    `;
  };

  const cycle = data.market.map(buildItem).join("");
  track.innerHTML = cycle + cycle;
}

/* ----------------------------- 6개 핵심 지표 타일 ----------------------------- */
function renderTiles(data) {
  const grid = $("dashboard-6tiles-grid");
  if (!grid) return;

  grid.innerHTML = data.market
    .map((item) => {
      const isUp = item.changePct >= 0;
      const theme = item.stale ? "theme-stale" : isUp ? "theme-up" : "theme-down";
      const pct = `${isUp ? "+" : ""}${item.changePct}%`;
      return `
        <div class="info-tile ${theme}">
          <div class="info-time-stack" style="align-self:flex-end;">
            <span class="info-local-dt">${escapeHtml(item.asOfLocal)}</span>
            <span class="info-kst-dt">${escapeHtml(item.asOfKst)}</span>
          </div>
          <div>
            <div class="info-asset-title">${escapeHtml(item.name)}</div>
            <div class="info-big-price">${escapeHtml(item.priceStr)}</div>
            <div class="info-delta-row">
              <span class="info-diff-pt">${escapeHtml(item.diffStr)}</span>
              <span class="info-pct-pill">${pct}</span>
            </div>
          </div>
          ${item.stale ? '<div class="info-stale-note">⚠ 최신화 실패 · 이전 값 표시 중</div>' : ""}
        </div>
      `;
    })
    .join("");
}

function renderDataStatusBadge(data) {
  const badge = $("dashboard-sync-badge");
  if (!badge) return;
  const worst = [data.sourceStatus?.market, data.sourceStatus?.news].includes("seed")
    ? "seed"
    : [data.sourceStatus?.market, data.sourceStatus?.news].includes("failed")
    ? "failed"
    : [data.sourceStatus?.market, data.sourceStatus?.news].includes("partial")
    ? "partial"
    : "ok";
  const { cls, text } = statusBadgeLabel(worst);
  badge.className = `data-status-badge ${cls}`;
  badge.textContent = `${text} · 생성: ${data.generatedAtKST}`;
}

/* ----------------------------- 핵심 이슈 3건 + 종합 멘트 ----------------------------- */
function renderIssues(data) {
  const editionLabel = STATE.edition === "MORNING" ? "🌅 모닝 (글로벌 · 장 개장 전)" : "🌇 이브닝 (국내 · 장 종료 후)";
  $("edition-badge-tag").textContent = `${data.generatedAtKST} · ${editionLabel}`;
  $("edition-main-heading").textContent =
    STATE.edition === "MORNING" ? "간밤 글로벌 핵심 이슈 & 손님 브리핑 종합 요약" : "당일 대한민국 핵심 이슈 & 손님 브리핑 종합 요약";
  $("edition-auto-time-note").textContent =
    STATE.edition === "MORNING"
      ? "✔ 매일 06:30(KST) 간밤 글로벌 시장 기준 자동 생성"
      : "✔ 매일 16:05(KST) 국내 장 마감 기준 자동 생성";

  $("edition-issues-container").innerHTML = data.issues
    .map(
      (iss) => `
      <div class="issue-box">
        <div class="issue-cat-label"><span>${escapeHtml(iss.cat)}</span><span class="issue-tag-pill">${escapeHtml(iss.tag)}</span></div>
        <div class="issue-main-title editable-text" contenteditable="false">${escapeHtml(iss.title)}</div>
        <p class="issue-desc-text editable-text" contenteditable="false">${escapeHtml(iss.desc)}</p>
      </div>
    `
    )
    .join("");

  const talkEl = $("edition-talking-point");
  talkEl.textContent = data.talkingPoint;
  talkEl.setAttribute("contenteditable", "false");
}

/* ----------------------------- Top 뉴스 ----------------------------- */
// 순서는 서버가 정한 "같은 사건을 보도한 언론사 수" 순위를 그대로 따릅니다(모든 PB에게 같은 순서).
export function getTop5News(count = TOP5_DEFAULT_COUNT) {
  const data = currentEditionData();
  return data ? (data.topNews || []).slice(0, count) : [];
}

export function recordNewsClick(title) {
  STATE.clickMap[title] = (STATE.clickMap[title] || 0) + 1;
  StorageUtil.set(LOCAL_STORAGE_KEYS.newsClicks, STATE.clickMap);
}

function renderTop5News() {
  $("top5-news-heading").textContent =
    STATE.edition === "MORNING" ? "손님 필독 글로벌 뉴스 TOP" : "손님 필독 국내 뉴스 TOP";
  const box = $("dashboard-top5-news");
  const top = getTop5News();
  if (!top.length) {
    box.innerHTML = `<div style="padding:24px; text-align:center; color:#004B49; font-size:13.5px; font-weight:700;">아직 수집된 기사가 없습니다. GitHub Actions 실행 후 채워집니다.</div>`;
    return;
  }
  box.innerHTML = top
    .map((n, idx) => {
      const rCls = idx < 2 ? "rank-badge top-rank" : "rank-badge";
      const tags = (n.tags || [])
        .slice(0, 2)
        .map((t) => tagBadge(t, escapeHtml))
        .join("");
      const coverage = n.coverage
        ? `<span class="coverage-chip" title="${escapeHtml((n.outlets || []).join(", "))}">📰 ${n.coverage}개 언론 보도</span>`
        : "";
      return `
        <a href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer" class="top5-news-item" data-news-title="${escapeHtml(n.title)}">
          <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
            <div class="${rCls}">${idx + 1}</div>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px; flex-wrap:wrap;">
                ${tags}
                ${coverage}
                <span style="font-size:11.5px; font-weight:800; color:#004B49;">${escapeHtml(n.press)}</span>
                <span style="font-size:11px; color:#475569; font-weight:700;">원문 출고: ${escapeHtml(n.date)}</span>
              </div>
              <div style="font-size:14px; font-weight:700; color:#0f172a; line-height:1.35;">${escapeHtml(n.title)}</div>
            </div>
          </div>
          <span class="top5-link-pill">기사 원문 ↗</span>
        </a>
      `;
    })
    .join("");
}

/* ----------------------------- 포트폴리오 체크포인트 ----------------------------- */
const LEVEL_CLASS = { "변동 큼": "lv-high", "주목": "lv-mid", "평이": "lv-low" };

/** 브리핑 데이터를 '모델별' 형태로 맞춰줌 (구형 3:4:3 단일 데이터도 표준형으로 표시) */
function normalizeAssetChecks(ac) {
  if (!ac?.cards?.length) return null;
  if (ac.framework === "models") return ac;
  if (ac.framework === "3:4:3")
    return {
      ...ac,
      models: [{ key: "standard", name: "표준형", icon: "⚖️", ratios: { safe: 30, core: 40, satellite: 30 } }],
      defaultModel: "standard",
      cards: ac.cards.map((c) => ({ ...c, texts: { standard: { headline: c.headline, insight: c.insight, check: c.check } } })),
      rebalance: { standard: ac.rebalance },
    };
  return null;
}

/** 화면·PDF 공용: 지금 선택된 모델 기준의 카드 목록 */
export function currentAllocation() {
  const ac = normalizeAssetChecks(currentEditionData()?.assetChecks);
  if (!ac) return null;
  const model = ac.models.find((m) => m.key === STATE.allocModel) ?? ac.models.find((m) => m.key === ac.defaultModel) ?? ac.models[0];
  return {
    ac,
    model,
    cards: ac.cards.map((c) => ({ ...c, ratio: model.ratios[c.key], ...(c.texts?.[model.key] ?? {}) })),
    rebalance: ac.rebalance?.[model.key] ?? null,
  };
}

export function renderPortfolio() {
  const grid = $("portfolio-cards-grid");
  if (!grid) return;
  const extra = $("ac-extra");
  const bar = $("ac-ratio-bar");
  const picker = $("alloc-picker");
  const cur = currentAllocation();
  if (!cur) {
    grid.innerHTML = `<div class="ac-empty">다음 브리핑 생성부터 배분 모델별 시사점이 표시됩니다.</div>`;
    [extra, bar, picker].forEach((el) => el && (el.innerHTML = ""));
    return;
  }
  const { ac, model, cards, rebalance } = cur;
  const ratioStr = (m) => `${m.ratios.safe / 10}:${m.ratios.core / 10}:${m.ratios.satellite / 10}`;

  if (picker)
    picker.innerHTML =
      `<span class="alloc-label">예시 배분 모델</span>` +
      ac.models
        .map(
          (m) => `<button type="button" class="alloc-btn ${m.key === model.key ? "active" : ""}" data-alloc="${m.key}" aria-pressed="${m.key === model.key}">
            ${m.icon} ${escapeHtml(m.name)} <span>${ratioStr(m)}</span></button>`
        )
        .join("");

  if (bar)
    bar.innerHTML = cards
      // 비중이 작은 칸은 폭이 좁아 이름이 잘리므로 퍼센트만 표시(이름은 마우스를 올리면 보임)
      .map((c) => `<div class="ratio-seg seg-${c.key}" style="flex:${c.ratio}" title="${escapeHtml(c.name)} ${c.ratio}%"><b>${c.ratio}%</b>${c.ratio >= 20 ? ` <span>${c.icon} ${escapeHtml(c.name)}</span>` : ""}</div>`)
      .join("");

  grid.innerHTML = cards
    .map((c) => {
      const market = c.market
        .map((m) => `<span class="ac-mkt ${m.changePct > 0 ? "up" : m.changePct < 0 ? "down" : ""}">${escapeHtml(m.name)} ${m.changePct > 0 ? "+" : ""}${escapeHtml(m.changePct)}%</span>`)
        .join("");
      const events = c.events
        .map((e) => `<button type="button" class="ac-ev" data-date="${escapeHtml(e.date)}"><b>${e.dday === 0 ? "D-DAY" : `D-${e.dday}`}</b> ${escapeHtml(e.when)} ${escapeHtml(e.label)}</button>`)
        .join("");
      const news = c.news
        .map((n) => `<a class="ac-news" href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer">📰 ${escapeHtml(n.title)} <em>${n.coverage}곳</em></a>`)
        .join("");
      return `
        <article class="ac-card card-${c.key}">
          <div class="ac-head">
            <span class="ac-name">${c.icon} ${escapeHtml(c.name)} <span class="ac-target">비중 ${c.ratio}%</span></span>
            <span class="ac-level ${LEVEL_CLASS[c.level] ?? ""}">${escapeHtml(c.level)}</span>
          </div>
          <div class="ac-role">${escapeHtml(c.role)}</div>
          <div class="ac-headline">${escapeHtml(c.headline ?? "")}</div>
          <p class="ac-check"><span class="lb-insight">오늘의 시사점</span>${escapeHtml(c.insight ?? "")}</p>
          <p class="ac-check"><span>확인할 것</span>${escapeHtml(c.check ?? "")}</p>
          ${market || events || news ? `<div class="ac-basis"><div class="ac-basis-label">근거 (모든 모델 공통)</div>${market ? `<div class="ac-mkts">${market}</div>` : ""}${events}${news}</div>` : ""}
        </article>`;
    })
    .join("");

  if (extra) {
    const reb = rebalance ? `<div class="ac-rebalance">⚖️ <b>리밸런싱 점검</b> ${escapeHtml(rebalance)}</div>` : "";
    const tax = (ac.taxNews ?? []).length
      ? `<div class="ac-tax"><span>🏢⚖️ 세무·부동산 참고</span>${ac.taxNews
          .map((n) => `<a href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)} <em>${n.coverage}곳</em></a>`)
          .join("")}</div>`
      : "";
    extra.innerHTML = reb + tax;
  }
}

/* ----------------------------- 대시보드 전체 렌더 ----------------------------- */
export function renderDashboard() {
  const data = currentEditionData();
  $("btn-ed-morning")?.classList.toggle("active", STATE.edition === "MORNING");
  $("btn-ed-evening")?.classList.toggle("active", STATE.edition === "EVENING");

  // 에디션 데이터와 무관한 영역은 항상 그립니다.
  renderArchivePicker();
  renderUpcomingStrip();
  renderPortfolio();
  renderMacroCalendar();

  if (!data) {
    $("edition-main-heading").textContent = STATE.archiveView
      ? `이 날짜에는 ${STATE.edition === "MORNING" ? "모닝" : "이브닝"} 브리핑이 없습니다. 다른 에디션을 선택해 주세요.`
      : "데이터를 불러오지 못했습니다.";
    return;
  }

  renderDataStatusBadge(data);
  renderTiles(data);
  renderIssues(data);
  renderTop5News();
  renderTicker();
}

export function toggleEditBriefing() {
  STATE.isEditing = !STATE.isEditing;
  const btn = $("btn-edit-briefing");
  document.querySelectorAll("#dashboard-screen-view .editable-text").forEach((el) => {
    el.contentEditable = STATE.isEditing ? "true" : "false";
    el.style.outline = STATE.isEditing ? "1px dashed #C5A059" : "none";
    el.style.backgroundColor = STATE.isEditing ? "#fffbeb" : "";
  });
  if (btn) {
    btn.innerHTML = STATE.isEditing ? "✅ <span>편집 완료 (이 화면에만 임시 적용)</span>" : "✏️ <span>문구 임시 편집</span>";
  }
}
