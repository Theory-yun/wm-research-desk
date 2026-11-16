import { STATE } from "./state.js";
import { loadAllData } from "./dataLoader.js";
import { renderDashboard, renderTicker, currentDataFile } from "./render.js";
import { initLiveApi, requestPbRewrite } from "./liveApi.js";
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
  // PB의 생각 → 손님 브리핑 요약 재작성 (메모리에만 보관)
  const panel = $("pb-view-panel");
  const input = $("pb-view-input");
  const status = $("pb-view-status");
  const toggleBtn = $("btn-pb-view");
  const openPanel = (open) => {
    panel.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      if (!STATE.apiReady) status.textContent = "중계 서버 연결 전이라 아직 사용할 수 없습니다.";
      input.focus();
    }
  };
  toggleBtn.addEventListener("click", () => openPanel(panel.hidden));
  $("btn-pb-cancel").addEventListener("click", () => openPanel(false));
  input.addEventListener("input", () => ($("pb-view-count").textContent = `${input.value.length} / 600`));
  $("btn-pb-reset").addEventListener("click", () => {
    STATE.pbOverride = null;
    status.textContent = "AI가 정리한 원본 요약으로 되돌렸습니다.";
    renderDashboard();
  });
  $("btn-pb-apply").addEventListener("click", async () => {
    const view = input.value.trim();
    if (view.length < 5) {
      status.textContent = "PB의 생각을 조금 더 적어 주세요.";
      return;
    }
    const btn = $("btn-pb-apply");
    btn.disabled = true;
    btn.textContent = "작성 중…";
    status.textContent = "오늘 지표·뉴스와 종합해 손님 브리핑을 다시 작성하고 있습니다 (10초 내외).";
    try {
      const file = currentDataFile();
      const r = await requestPbRewrite(view, file);
      STATE.pbOverride = { file, talkingPoint: r.talkingPoint, pbView: view };
      renderDashboard();
      status.textContent = "반영했습니다. 카톡 복사·PDF에도 이 요약이 들어갑니다. 새로고침하면 AI 원본으로 돌아갑니다.";
      document.querySelector(".pb-talking-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      status.textContent = `반영하지 못했습니다: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "반영하기";
    }
  });
  $("btn-copy-kakao").addEventListener("click", copyKakaoBriefing);
  $("btn-pdf-download").addEventListener("click", downloadPdf);
  $("btn-goto-newsroom").addEventListener("click", () => switchTab("tab-newsroom"));

  // 상단 J's WM RESEARCH DESK 클릭 → 종합 대시보드
  $("brand-home-link").addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("tab-dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  // 실시간 티커 (중계 서버가 있을 때만)
  initLiveApi(() => renderTicker()).catch(() => {});

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
