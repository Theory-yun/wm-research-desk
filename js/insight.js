import { STATE, escapeHtml } from "./state.js";

const $ = (id) => document.getElementById(id);

const CATEGORY_ICON = {
  "글로벌 F/O 동향": "🌍",
  "국내 부자·웰스 리포트": "🇰🇷",
  "자산배분·시장 전망": "📊",
  "승계·세무·신탁": "⚖️",
  "대체투자·사모시장": "🏗️",
};
const CATEGORY_CLASS = {
  "글로벌 F/O 동향": "tag-forex",
  "국내 부자·웰스 리포트": "tag-macro",
  "자산배분·시장 전망": "tag-macro",
  "승계·세무·신탁": "tag-tax",
  "대체투자·사모시장": "tag-estate",
};
const NEW_DAYS = 3;

function categories() {
  const fromData = STATE.insightCategories?.length ? STATE.insightCategories : [];
  const used = [...new Set(STATE.insights.map((r) => r.category))];
  return [...new Set([...fromData, ...used])];
}

function renderFilterBar() {
  const bar = $("insight-filter-bar");
  if (!bar) return;
  const count = (c) => STATE.insights.filter((r) => r.category === c).length;
  bar.innerHTML =
    `<button type="button" class="filter-pill-btn ${STATE.insightFilter === "ALL" ? "active" : ""}" data-filter="ALL">전체 (<span id="insight-total-count">${STATE.insights.length}</span>)</button>` +
    categories()
      .map(
        (c) =>
          `<button type="button" class="filter-pill-btn ${STATE.insightFilter === c ? "active" : ""}" data-filter="${escapeHtml(c)}">${CATEGORY_ICON[c] ?? "📄"} ${escapeHtml(c)} (${count(c)})</button>`
      )
      .join("");
}

function row(r) {
  const isNew = !r.curated && r.ts && Date.now() - r.ts < NEW_DAYS * 86400e3;
  const badge = r.curated ? `<span class="ins-badge ins-curated">📌 연례 핵심</span>` : isNew ? `<span class="ins-badge ins-new">NEW</span>` : "";
  const meta = r.curated ? "" : `<div class="ins-meta">자동 수집 · ${escapeHtml(r.classifiedBy ?? "")}${r.lang === "en" ? " · 영문 원문" : ""}</div>`;
  return `
    <tr>
      <td style="text-align:center;"><span class="star-rating">${escapeHtml(r.stars)}</span></td>
      <td><span class="badge-tag ${CATEGORY_CLASS[r.category] ?? "tag-tax"}">${escapeHtml(r.category)}</span></td>
      <td>
        <div class="ins-title">${badge}${escapeHtml(r.title)}</div>
        <div class="ins-desc">${escapeHtml(r.desc)}</div>
        ${meta}
      </td>
      <td><span style="font-weight:700; color:#8FD3C4;">${escapeHtml(r.org)}</span><br><span style="font-size:11.5px; color:#8A9A97;">${escapeHtml(r.date)}</span></td>
      <td style="text-align:center;"><a href="${encodeURI(r.url)}" target="_blank" rel="noopener noreferrer" class="btn-download">${escapeHtml(r.btnText)}</a></td>
    </tr>`;
}

export function renderInsights() {
  const tbody = $("insight-report-tbody");
  if (!tbody) return;
  renderFilterBar();

  const autoCount = STATE.insights.filter((r) => !r.curated).length;
  const label = $("insight-status-label");
  if (label) label.textContent = `📌 연례 핵심 리포트 ${STATE.insights.length - autoCount}건 · 🔄 자동 수집 ${autoCount}건 (최근 90일, 하루 2회 갱신)`;

  const list = STATE.insightFilter === "ALL" ? STATE.insights : STATE.insights.filter((r) => r.category === STATE.insightFilter);
  const curated = list.filter((r) => r.curated);
  const auto = list.filter((r) => !r.curated).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

  const section = (title, rows) => (rows.length ? `<tr class="ins-section"><td colspan="5">${title}</td></tr>` + rows.map(row).join("") : "");
  tbody.innerHTML =
    section("🔄 최근 자동 수집 자료 (리서치·통계·제도 변화)", auto) + section("📌 PB 선정 연례 핵심 리포트", curated) ||
    `<tr><td colspan="5" style="text-align:center; color:#8A9A97; padding:24px;">이 분류에 해당하는 자료가 아직 없습니다.</td></tr>`;
}

export function initInsightEvents() {
  $("insight-filter-bar").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-pill-btn");
    if (!btn) return;
    STATE.insightFilter = btn.dataset.filter;
    renderInsights();
  });
}
