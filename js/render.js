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
        <span class="${dir}">${arrow} ${escapeHtml(m.diffStr)} (${m.changePct >= 0 ? "+" : ""}${m.changePct}%)</span>
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
function renderPortfolio() {
  const grid = $("portfolio-cards-grid");
  if (!grid) return;
  grid.innerHTML = STATE.portfolioNotes
    .map(
      (pf) => `
      <div class="pf-strategy-card" style="border-top: 3px solid ${escapeHtml(pf.color || "#004B49")};">
        <div class="pf-card-head">
          <span class="pf-asset-badge" style="color:${escapeHtml(pf.color || "#004B49")};">${escapeHtml(pf.badge)}</span>
          <span class="pf-stance-tag">${escapeHtml(pf.stance)}</span>
        </div>
        <div class="pf-card-headline">${escapeHtml(pf.headline)}</div>
        <p class="pf-card-body">${escapeHtml(pf.body)}</p>
      </div>
    `
    )
    .join("");
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
