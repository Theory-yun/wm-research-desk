import { STATE, escapeHtml } from "./state.js";

/**
 * 월별 핵심 매크로 일정 캘린더 + 대시보드 상단 "다가오는 빅이벤트" 띠
 *  - data/macro-events.json : kinds(유형별 설명) + items(공식 일정·규칙 기반 만기/휴장)
 *  - data/auto-events.json  : DART 공시에서 자동 수집한 시총 상위 기업 실적 일정
 *  - data/event-results.json: 일정 결과(금리 결정·CPI·고용·잠정실적·선거)
 */

const $ = (id) => document.getElementById(id);
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const REGION_SHORT = { US: "美", KR: "韓", EU: "EU", JP: "日", GL: "" };
// 같은 날 일정이 여러 개일 때 달력 칸에 먼저 보여줄 순서
const CATEGORY_PRIORITY = { rate: 0, data: 1, politics: 2, earnings: 3, derivatives: 4, market: 5 };
const RESULT_KINDS = new Set(["fomc", "bok", "ecb", "boj", "cpi_us", "jobs_us", "midterm", "earnings_kr"]);

const view = { y: null, m: null }; // m: 0~11
const hiddenCats = new Set();
let eventsWired = false;

function macro() {
  return STATE.macro ?? { kinds: {}, items: [], coverage: null, regions: {}, categories: {} };
}
export const eventId = (ev) => ev.id ?? `${ev.date}|${ev.kind}`;
const kindOf = (ev) => macro().kinds[ev.kind] ?? {};

function allEvents() {
  return [...macro().items, ...(STATE.autoEvents ?? [])].sort((a, b) =>
    a.date === b.date ? (CATEGORY_PRIORITY[kindOf(a).category] ?? 9) - (CATEGORY_PRIORITY[kindOf(b).category] ?? 9) : a.date.localeCompare(b.date)
  );
}
const visibleEvents = () => allEvents().filter((e) => !hiddenCats.has(kindOf(e).category));

function ymKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function todayKst() {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d, iso: s };
}

function clampToCoverage() {
  const cov = macro().coverage;
  if (!cov) return;
  const cur = ymKey(view.y, view.m);
  if (cur < cov.from) [view.y, view.m] = [Number(cov.from.slice(0, 4)), Number(cov.from.slice(5, 7)) - 1];
  if (cur > cov.to) [view.y, view.m] = [Number(cov.to.slice(0, 4)), Number(cov.to.slice(5, 7)) - 1];
}

function pillHtml(ev, { full = false } = {}) {
  const k = kindOf(ev);
  if (!k.label) return "";
  const text = ev.company ? `${k.label}·${ev.company}` : `${REGION_SHORT[k.region] ?? ""} ${k.label}`.trim();
  const done = STATE.eventResults?.[eventId(ev)] ? `<i class="mc-done" title="결과 있음">✓</i>` : "";
  return `<span class="mc-pill cat-${k.category}${full ? " is-full" : ""}">${escapeHtml(text)}${done}</span>`;
}
const titleOf = (ev) => ev.title ?? kindOf(ev).name ?? "";

/* ----------------------------- 캘린더 ----------------------------- */
export function renderMacroCalendar() {
  const grid = $("macro-calendar-grid");
  const list = $("macro-event-detail-list");
  if (!grid || !list) return;

  const t = todayKst();
  if (view.y === null) [view.y, view.m] = [t.y, t.m];
  clampToCoverage();

  const { y, m } = view;
  const cov = macro().coverage;
  $("macro-cal-title").textContent = `${y}년 ${m + 1}월 글로벌·국내 핵심 매크로 일정`;
  $("mc-month-label").textContent = `${y}.${String(m + 1).padStart(2, "0")}`;
  $("mc-prev").disabled = !!cov && ymKey(y, m) <= cov.from;
  $("mc-next").disabled = !!cov && ymKey(y, m) >= cov.to;
  $("mc-today").disabled = y === t.y && m === t.m;
  renderLegend();

  const monthEvents = visibleEvents().filter((e) => e.date.startsWith(ymKey(y, m)));
  const byDay = {};
  monthEvents.forEach((e) => (byDay[Number(e.date.slice(8, 10))] ??= []).push(e));

  const firstDow = new Date(y, m, 1).getDay();
  const lastDate = new Date(y, m + 1, 0).getDate();
  const prevLast = new Date(y, m, 0).getDate();

  let html = "";
  for (let i = firstDow - 1; i >= 0; i--) html += `<div class="cal-day-cell other-month"><div class="cal-day-num">${prevLast - i}</div></div>`;
  for (let d = 1; d <= lastDate; d++) {
    const iso = `${ymKey(y, m)}-${String(d).padStart(2, "0")}`;
    const dow = (firstDow + d - 1) % 7;
    const evs = byDay[d] || [];
    const cls = ["cal-day-cell", dow === 0 ? "sun" : dow === 6 ? "sat" : "", iso === t.iso ? "today-cell" : "", iso < t.iso ? "past-day" : "", evs.length ? "has-events" : ""].join(" ");
    const pills = evs.slice(0, 2).map((e) => pillHtml(e)).join("") + (evs.length > 2 ? `<span class="mc-more">+${evs.length - 2}</span>` : "");
    const attrs = evs.length ? `data-date="${iso}" role="button" tabindex="0" aria-label="${m + 1}월 ${d}일 일정 ${evs.length}건 보기"` : "";
    html += `<div class="${cls}" ${attrs}><div class="cal-day-num"><span>${d}</span></div>${pills}</div>`;
  }
  const rem = (7 - ((firstDow + lastDate) % 7)) % 7;
  for (let n = 1; n <= rem; n++) html += `<div class="cal-day-cell other-month"><div class="cal-day-num">${n}</div></div>`;
  grid.innerHTML = html;

  list.innerHTML = !monthEvents.length
    ? `<div class="mc-empty">이 달에는 표시할 일정이 없습니다.</div>`
    : `<div class="mc-list-head">${m + 1}월 일정 <strong>${monthEvents.length}</strong>건 <span>· 눌러서 상세 보기</span></div>` +
      `<div class="mc-list-scroll">` +
      monthEvents
        .map((ev) => {
          const dd = new Date(`${ev.date}T00:00:00`);
          const res = STATE.eventResults?.[eventId(ev)];
          return `
            <button type="button" class="cal-event-card ${ev.date < t.iso ? "is-past" : ""}" data-date="${ev.date}">
              <span class="cal-date-chip">${String(m + 1).padStart(2, "0")}.${ev.date.slice(8, 10)}<small>(${WD[dd.getDay()]})</small></span>
              ${pillHtml(ev)}
              <span class="mc-card-title">${escapeHtml(titleOf(ev))}${ev.highlight ? ` <em>★</em>` : ""}
                ${res ? `<small class="mc-card-result">${escapeHtml(res.headline)}</small>` : ""}</span>
            </button>`;
        })
        .join("") +
      `</div>`;

  wireEventsOnce();
}

function renderLegend() {
  const box = $("mc-legend-filters");
  if (!box) return;
  const cats = macro().categories ?? {};
  box.innerHTML = Object.entries(cats)
    .map(
      ([c, label]) =>
        `<button type="button" class="mc-pill cat-${c} mc-filter ${hiddenCats.has(c) ? "is-off" : ""}" data-cat="${c}" aria-pressed="${!hiddenCats.has(c)}">${escapeHtml(label)}</button>`
    )
    .join("");
}

/* ----------------------------- 다가오는 빅이벤트 띠 ----------------------------- */
export function renderUpcomingStrip() {
  const box = $("upcoming-strip");
  if (!box) return;
  const t = todayKst();
  const end = new Date(`${t.iso}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const endIso = end.toISOString().slice(0, 10);
  // 휴장·조기폐장 같은 운영 일정은 띠에서는 빼고(캘린더엔 그대로 표시), 시장에 영향 큰 일정만 보여줍니다.
  const evs = allEvents().filter((e) => e.date >= t.iso && e.date <= endIso && kindOf(e).category !== "market");

  if (!evs.length) {
    box.innerHTML = `<span class="up-title">📌 앞으로 7일</span><span class="up-empty">예정된 핵심 일정이 없습니다.</span>`;
    return;
  }
  box.innerHTML =
    `<span class="up-title">📌 앞으로 7일 빅이벤트</span>` +
    `<div class="up-items">` +
    evs
      .map((ev) => {
        const diff = Math.round((new Date(`${ev.date}T00:00:00Z`) - new Date(`${t.iso}T00:00:00Z`)) / 86400e3);
        const dday = diff === 0 ? "D-DAY" : `D-${diff}`;
        const dd = new Date(`${ev.date}T00:00:00`);
        return `<button type="button" class="up-item ${diff === 0 ? "is-today" : ""}" data-date="${ev.date}">
            <span class="up-dday">${dday}</span>
            <span class="up-date">${dd.getMonth() + 1}/${dd.getDate()}(${WD[dd.getDay()]})</span>
            ${pillHtml(ev)}
          </button>`;
      })
      .join("") +
    `</div>`;
}

/* ----------------------------- 상세 팝업 ----------------------------- */
function resultBlock(ev) {
  const res = STATE.eventResults?.[eventId(ev)];
  if (res) {
    const methodLabel =
      { official: "공식 발표 자료 기준", "ai-news": "발표 직후 뉴스 헤드라인을 AI가 정리 — 원문 확인 권장", "ai-disclosure": "공시 원문 표를 AI가 옮겨 적음 — 원문 확인 권장", manual: "직접 확인해 입력" }[res.method] ?? "";
    return `
      <section class="mc-result">
        <div class="mc-result-label">발표 결과</div>
        <p class="mc-result-headline">${escapeHtml(res.headline)}</p>
        ${(res.details ?? []).length ? `<ul>${res.details.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
        <p class="mc-result-meta">${escapeHtml(methodLabel)}${
          res.sourceUrl ? ` · <a href="${escapeHtml(res.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(res.sourceName ?? "출처")}</a>` : res.sourceName ? ` · ${escapeHtml(res.sourceName)}` : ""
        }</p>
      </section>`;
  }
  if (RESULT_KINDS.has(ev.kind) && ev.date < todayKst().iso) {
    return `<section class="mc-result is-pending"><div class="mc-result-label">발표 결과</div><p>결과를 수집하고 있습니다. 발표 후 다음 자동 갱신(하루 2회) 때 반영됩니다.</p></section>`;
  }
  return "";
}

export function openDayModal(iso) {
  const evs = allEvents().filter((e) => e.date === iso);
  if (!evs.length) return;
  const { regions, categories } = macro();
  const d = new Date(`${iso}T00:00:00`);

  $("mc-modal-date").textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) · 현지 기준`;
  $("mc-modal-body").innerHTML = evs
    .map((ev) => {
      const k = kindOf(ev);
      const checks = (k.pbCheck ?? []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");
      return `
        <article class="mc-detail">
          <div class="mc-detail-tags">
            ${pillHtml(ev, { full: true })}
            <span class="mc-tag-plain">${escapeHtml(regions[k.region] ?? "")} · ${escapeHtml(categories[k.category] ?? "")}</span>
          </div>
          <h4>${escapeHtml(titleOf(ev))}</h4>
          <dl class="mc-meta">
            <dt>일정</dt><dd>${escapeHtml(ev.meeting ?? "")}</dd>
            <dt>한국시간</dt><dd>${escapeHtml(ev.timeKst ?? "")}</dd>
          </dl>
          ${ev.highlight ? `<p class="mc-highlight">★ ${escapeHtml(ev.highlight)}</p>` : ""}
          ${resultBlock(ev)}
          <h5>어떤 일정인가요</h5>
          <p>${escapeHtml(k.about ?? "")}</p>
          <h5>시장에 왜 중요한가요</h5>
          <p>${escapeHtml(k.why ?? "")}</p>
          ${checks ? `<h5>PB 체크포인트</h5><ul>${checks}</ul>` : ""}
          ${k.caveat ? `<p class="mc-caveat">※ ${escapeHtml(k.caveat)}</p>` : ""}
          ${
            ev.sourceUrl
              ? `<p class="mc-source">공시 원문: <a href="${escapeHtml(ev.sourceUrl)}" target="_blank" rel="noopener noreferrer">DART에서 보기</a></p>`
              : k.source
                ? `<p class="mc-source">출처: <a href="${escapeHtml(k.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(k.source.name)}</a></p>`
                : ""
          }
        </article>`;
    })
    .join("");

  $("mc-modal").hidden = false;
  document.body.classList.add("modal-open");
  $("mc-modal-close").focus();
}

function closeModal() {
  const modal = $("mc-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function moveMonth(delta) {
  const dt = new Date(view.y, view.m + delta, 1);
  [view.y, view.m] = [dt.getFullYear(), dt.getMonth()];
  renderMacroCalendar();
}

function wireEventsOnce() {
  if (eventsWired) return;
  eventsWired = true;

  $("mc-prev").addEventListener("click", () => moveMonth(-1));
  $("mc-next").addEventListener("click", () => moveMonth(1));
  $("mc-today").addEventListener("click", () => {
    const t = todayKst();
    [view.y, view.m] = [t.y, t.m];
    renderMacroCalendar();
  });
  $("mc-legend-filters")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    hiddenCats.has(b.dataset.cat) ? hiddenCats.delete(b.dataset.cat) : hiddenCats.add(b.dataset.cat);
    renderMacroCalendar();
  });

  const onPick = (e) => {
    const target = e.target.closest("[data-date]");
    if (target) openDayModal(target.dataset.date);
  };
  ["macro-calendar-grid", "macro-event-detail-list", "upcoming-strip"].forEach((id) => $(id)?.addEventListener("click", onPick));
  $("macro-calendar-grid").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(e);
    }
  });

  $("mc-modal-close").addEventListener("click", closeModal);
  $("mc-modal").addEventListener("click", (e) => {
    if (e.target.id === "mc-modal") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}
