import { STATE } from "./state.js";
import { loadAllData } from "./dataLoader.js";
import { renderDashboard, toggleEditBriefing } from "./render.js";
import { renderNewsroom, initNewsroomEvents } from "./newsroom.js";
import { renderInsights, initInsightEvents } from "./insight.js";
import { renderBoard, initBoardEvents } from "./board.js";
import { copyKakaoBriefing, downloadPdf } from "./pdfExport.js";
import { defaultEditionByTime, formatKstDate } from "./util.js";
import { selectArchiveDate } from "./archive.js";

const $ = (id) => document.getElementById(id);

function switchTab(tabId) {
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  $(tabId)?.classList.add("active");
  document.querySelector(`.nav-btn[data-tab="${tabId}"]`)?.classList.add("active");
  sessionStorage.setItem("wm_desk_active_tab", tabId);

  if (tabId === "tab-dashboard") renderDashboard();
  if (tabId === "tab-newsroom") renderNewsroom();
  if (tabId === "tab-insight") renderInsights();
  if (tabId === "tab-board") renderBoard();
}

function setEdition(edition) {
  STATE.edition = edition;
  renderDashboard();
}

function wireUpStaticEvents() {
  $("main-nav-inner").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-btn");
    if (btn) switchTab(btn.dataset.tab);
  });

  $("btn-ed-morning").addEventListener("click", () => setEdition("MORNING"));
  $("btn-ed-evening").addEventListener("click", () => setEdition("EVENING"));
  $("btn-edit-briefing").addEventListener("click", toggleEditBriefing);
  $("btn-copy-kakao").addEventListener("click", copyKakaoBriefing);
  $("btn-pdf-download").addEventListener("click", downloadPdf);
  $("btn-goto-newsroom").addEventListener("click", () => switchTab("tab-newsroom"));

  // 지난 브리핑 다시보기
  $("archive-date-select").addEventListener("change", async (e) => {
    if (await selectArchiveDate(e.target.value)) renderDashboard();
  });
  $("btn-archive-latest").addEventListener("click", async () => {
    await selectArchiveDate("");
    renderDashboard();
  });

  $("btn-reload-data").addEventListener("click", async () => {
    const btn = $("btn-reload-data");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳ 데이터 확인 중...";
    await loadAllData();
    renderDashboard();
    renderNewsroom();
    renderInsights();
    btn.textContent = "✅ 최신 데이터 확인 완료";
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = orig;
    }, 2000);
  });

  initNewsroomEvents();
  initInsightEvents();
  initBoardEvents();
}

async function init() {
  $("current-date").textContent = formatKstDate();
  STATE.edition = defaultEditionByTime();

  wireUpStaticEvents();
  await loadAllData();

  renderDashboard();
  renderNewsroom();
  renderInsights();
  renderBoard();

  const lastTab = sessionStorage.getItem("wm_desk_active_tab");
  if (lastTab && lastTab !== "tab-dashboard") switchTab(lastTab);

  // 정적 JSON 스냅샷을 쓰는 구조이므로, 초(브라우저 폴링) 단위 재조회는 하지 않습니다.
  // 대신 10분마다 "새로운 데이터가 커밋되었는지"만 가볍게 재확인합니다.
  setInterval(async () => {
    await loadAllData();
    if (document.getElementById("tab-dashboard").classList.contains("active")) renderDashboard();
  }, 10 * 60 * 1000);
}

init();
