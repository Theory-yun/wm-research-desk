import { STATE, escapeHtml } from "./state.js";

/**
 * 월별 핵심 매크로 일정 캘린더
 *  - data/macro-events.json 의 kinds(유형별 설명) + items(날짜별 일정)를 사용합니다.
 *  - 전월/익월 이동은 coverage(공식 일정이 수록된 기간) 안에서만 허용합니다.
 *  - 일정이 있는 날짜(또는 우측 목록)를 누르면 레이어 팝업으로 상세 설명을 보여줍니다.
 */

const $ = (id) => document.getElementById(id);
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const REGION_SHORT = { US: "美", KR: "韓", EU: "EU", JP: "日" };

const view = { y: null, m: null }; // m: 0~11
let eventsWired = false;

function macro() {
  return STATE.macro ?? { kinds: {}, items: [], coverage: null, regions: {}, categories: {} };
}

function ymKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function todayKst() {
  // 브라우저 시간대와 무관하게 한국 날짜 기준으로 '오늘'을 판단합니다.
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

function eventsOfMonth(y, m) {
  const prefix = ymKey(y, m);
  return macro().items.filter((e) => e.date.startsWith(prefix));
}

function eventsOfDate(iso) {
  return macro().items.filter((e) => e.date === iso);
}

function pillHtml(ev) {
  const k = macro().kinds[ev.kind];
  if (!k) return "";
  return `<span class="mc-pill cat-${k.category}">${REGION_SHORT[k.region] ?? ""} ${escapeHtml(k.label)}</span>`;
}

/* ----------------------------- 렌더 ----------------------------- */
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

  const monthEvents = eventsOfMonth(y, m);
  const byDay = {};
  monthEvents.forEach((e) => {
    const d = Number(e.date.slice(8, 10));
    (byDay[d] = byDay[d] || []).push(e);
  });

  const firstDow = new Date(y, m, 1).getDay();
  const lastDate = new Date(y, m + 1, 0).getDate();
  const prevLast = new Date(y, m, 0).getDate();

  let html = "";
  for (let i = firstDow - 1; i >= 0; i--) {
    html += `<div class="cal-day-cell other-month"><div class="cal-day-num">${prevLast - i}</div></div>`;
  }
  for (let d = 1; d <= lastDate; d++) {
    const iso = `${ymKey(y, m)}-${String(d).padStart(2, "0")}`;
    const dow = (firstDow + d - 1) % 7;
    const cls = [
      "cal-day-cell",
      dow === 0 ? "sun" : dow === 6 ? "sat" : "",
      iso === t.iso ? "today-cell" : "",
      iso < t.iso ? "past-day" : "",
      byDay[d] ? "has-events" : "",
    ].join(" ");
    const evs = byDay[d] || [];
    const pills = evs.slice(0, 2).map(pillHtml).join("") + (evs.length > 2 ? `<span class="mc-more">+${evs.length - 2}</span>` : "");
    const attrs = evs.length
      ? `data-date="${iso}" role="button" tabindex="0" aria-label="${m + 1}월 ${d}일 일정 ${evs.length}건 보기"`
      : "";
    html += `<div class="${cls}" ${attrs}><div class="cal-day-num"><span>${d}</span></div>${pills}</div>`;
  }
  const rem = (7 - ((firstDow + lastDate) % 7)) % 7;
  for (let n = 1; n <= rem; n++) {
    html += `<div class="cal-day-cell other-month"><div class="cal-day-num">${n}</div></div>`;
  }
  grid.innerHTML = html;

  // 우측: 선택한 달의 일정 목록
  if (!monthEvents.length) {
    list.innerHTML = `<div class="mc-empty">이 달에는 등록된 공식 일정이 없습니다.</div>`;
  } else {
    list.innerHTML =
      `<div class="mc-list-head">${m + 1}월 핵심 일정 <strong>${monthEvents.length}</strong>건 <span>· 눌러서 상세 보기</span></div>` +
      monthEvents
        .map((ev) => {
          const k = macro().kinds[ev.kind] ?? {};
          const dd = new Date(`${ev.date}T00:00:00`);
          const past = ev.date < t.iso ? "is-past" : "";
          return `
            <button type="button" class="cal-event-card ${past}" data-date="${ev.date}">
              <span class="cal-date-chip">${String(m + 1).padStart(2, "0")}.${ev.date.slice(8, 10)}<small>(${WD[dd.getDay()]})</small></span>
              ${pillHtml(ev)}
              <span class="mc-card-title">${escapeHtml(k.name ?? "")}${ev.highlight ? ` <em>★</em>` : ""}</span>
            </button>`;
        })
        .join("");
  }

  wireEventsOnce();
}

/* ----------------------------- 팝업 ----------------------------- */
function openDayModal(iso) {
  const evs = eventsOfDate(iso);
  if (!evs.length) return;
  const { kinds, regions, categories } = macro();
  const d = new Date(`${iso}T00:00:00`);

  $("mc-modal-date").textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) · 현지 기준`;
  $("mc-modal-body").innerHTML = evs
    .map((ev) => {
      const k = kinds[ev.kind] ?? {};
      const checks = (k.pbCheck ?? []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");
      return `
        <article class="mc-detail">
          <div class="mc-detail-tags">
            ${pillHtml(ev)}
            <span class="mc-tag-plain">${escapeHtml(regions[k.region] ?? "")} · ${escapeHtml(categories[k.category] ?? "")}</span>
          </div>
          <h4>${escapeHtml(k.name ?? "")}</h4>
          <dl class="mc-meta">
            <dt>일정</dt><dd>${escapeHtml(ev.meeting ?? "")}</dd>
            <dt>한국시간</dt><dd>${escapeHtml(ev.timeKst ?? "")}</dd>
          </dl>
          ${ev.highlight ? `<p class="mc-highlight">★ ${escapeHtml(ev.highlight)}</p>` : ""}
          <h5>어떤 일정인가요</h5>
          <p>${escapeHtml(k.about ?? "")}</p>
          <h5>시장에 왜 중요한가요</h5>
          <p>${escapeHtml(k.why ?? "")}</p>
          ${checks ? `<h5>PB 체크포인트</h5><ul>${checks}</ul>` : ""}
          ${k.caveat ? `<p class="mc-caveat">※ ${escapeHtml(k.caveat)}</p>` : ""}
          ${
            k.source
              ? `<p class="mc-source">출처: <a href="${escapeHtml(k.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(k.source.name)}</a></p>`
              : ""
          }
        </article>`;
    })
    .join("");

  const modal = $("mc-modal");
  modal.hidden = false;
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

  const onPick = (e) => {
    const target = e.target.closest("[data-date]");
    if (target) openDayModal(target.dataset.date);
  };
  $("macro-calendar-grid").addEventListener("click", onPick);
  $("macro-event-detail-list").addEventListener("click", onPick);
  $("macro-calendar-grid").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(e);
    }
  });

  $("mc-modal-close").addEventListener("click", closeModal);
  $("mc-modal").addEventListener("click", (e) => {
    if (e.target.id === "mc-modal") closeModal(); // 바깥 어두운 영역 클릭 시 닫기
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}
