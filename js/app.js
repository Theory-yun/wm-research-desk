import { STATE } from "./state.js";
import { loadAllData } from "./dataLoader.js";
import { renderDashboard, toggleEditBriefing, renderPortfolio } from "./render.js";
import { StorageUtil } from "./state.js";
import { LOCAL_STORAGE_KEYS } from "./config.js";
import { renderNewsroom, initNewsroomEvents } from "./newsroom.js";
import { renderInsights, initInsightEvents } from "./insight.js";
import { renderBoard, initBoardEvents } from "./board.js";
import { copyKakaoBriefing, downloadPdf } from "./pdfExport.js";
import { defaultEditionByTime, formatKstDate, setMarketHolidays } from "./util.js";
import { fetchJson } from "./dataLoader.js";
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

  // 상단 J's WM RESEARCH DESK 클릭 → 종합 대시보드
  $("brand-home-link").addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("tab-dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // 예시 배분 모델 선택 (선택값은 이 브라우저에 저장)
  $("alloc-picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-alloc]");
    if (!b) return;
    STATE.allocModel = b.dataset.alloc;
    StorageUtil.set(LOCAL_STORAGE_KEYS.allocModel, STATE.allocModel);
    renderPortfolio();
  });

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
    btn.textContent = "확인 중…";
    await loadAllData();
    renderDashboard();
    renderNewsroom();
    renderInsights();
    btn.textContent = "최신 상태";
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
  await Promise.all([
    loadAllData(),
    fetchJson("./data/market-holidays.json").then(setMarketHolidays).catch(() => {}),
  ]);

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
