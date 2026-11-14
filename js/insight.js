import { STATE, escapeHtml } from "./state.js";

const $ = (id) => document.getElementById(id);

function tagClassForInsight(cat) {
  if (cat === "국내 부자보고서") return "tag-macro";
  if (cat === "글로벌 F/O 백서") return "tag-forex";
  return "tag-tax";
}

export function renderInsights() {
  const tbody = $("insight-report-tbody");
  if (!tbody) return;

  $("insight-total-count").textContent = STATE.insights.length;
  const label = $("insight-status-label");
  if (label) label.textContent = `✔ 총 ${STATE.insights.length}건 보관 중 (일부는 자동 수집으로 보강됨)`;

  const list = STATE.insightFilter === "ALL" ? STATE.insights : STATE.insights.filter((r) => r.category === STATE.insightFilter);

  tbody.innerHTML = list
    .map(
      (r) => `
      <tr>
        <td style="text-align:center;"><span class="star-rating">${escapeHtml(r.stars)}</span></td>
        <td><span class="badge-tag ${tagClassForInsight(r.category)}">${escapeHtml(r.category)}</span></td>
        <td>
          <div style="font-weight:800; color:#0f172a; margin-bottom:4px; font-size:14px;">${escapeHtml(r.title)}</div>
          <div style="font-size:12.2px; color:#475569; line-height:1.45;">${escapeHtml(r.desc)}</div>
        </td>
        <td><span style="font-weight:700; color:#004B49;">${escapeHtml(r.org)}</span><br><span style="font-size:11.5px; color:#94a3b8;">${escapeHtml(r.date)}</span></td>
        <td style="text-align:center;"><a href="${encodeURI(r.url)}" target="_blank" rel="noopener noreferrer" class="btn-download">${escapeHtml(r.btnText)}</a></td>
      </tr>
    `
    )
    .join("");
}

export function initInsightEvents() {
  $("insight-filter-bar").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-pill-btn");
    if (!btn) return;
    STATE.insightFilter = btn.dataset.filter;
    document.querySelectorAll("#insight-filter-bar .filter-pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderInsights();
  });
}
