import { STATE, escapeHtml } from "./state.js";
import { archiveFile } from "./config.js";
import { fetchJson } from "./dataLoader.js";

/**
 * 지난 브리핑 다시보기
 *  - data/archive/index.json 의 날짜 목록으로 선택 상자를 채우고,
 *  - 날짜를 고르면 그날의 모닝/이브닝 파일을 불러와 STATE.archiveView 에 넣습니다.
 *    (currentEditionData()가 archiveView를 우선 사용하므로 대시보드·카톡 복사·PDF가 모두 그날 기준으로 바뀝니다.)
 */
const $ = (id) => document.getElementById(id);
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const ED_LABEL = { morning: "모닝", evening: "이브닝" };

export function renderArchivePicker() {
  const sel = $("archive-date-select");
  if (!sel) return;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  sel.innerHTML =
    `<option value="">최신 브리핑</option>` +
    STATE.archiveIndex
      .map(({ date, editions }) => {
        const d = new Date(`${date}T00:00:00`);
        const label = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) · ${editions.map((e) => ED_LABEL[e]).join("·")}${date === today ? " (오늘)" : ""}`;
        return `<option value="${escapeHtml(date)}">${escapeHtml(label)}</option>`;
      })
      .join("");
  sel.value = STATE.archiveView?.date ?? "";
  renderArchiveBanner();
}

function renderArchiveBanner() {
  const b = $("archive-banner");
  if (!b) return;
  if (!STATE.archiveView) {
    b.hidden = true;
    return;
  }
  const d = new Date(`${STATE.archiveView.date}T00:00:00`);
  $("archive-banner-text").textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일(${WD[d.getDay()]}) 지난 브리핑을 보고 있습니다.`;
  b.hidden = false;
}

/** @returns {Promise<boolean>} 화면을 다시 그려야 하면 true */
export async function selectArchiveDate(date) {
  if (!date) {
    STATE.archiveView = null;
    renderArchivePicker();
    return true;
  }
  const entry = STATE.archiveIndex.find((x) => x.date === date);
  if (!entry) return false;
  const [morning, evening] = await Promise.all(
    ["morning", "evening"].map((ed) => (entry.editions.includes(ed) ? fetchJson(archiveFile(ed, date)) : Promise.resolve(null)))
  );
  if (!morning && !evening) {
    alert("해당 날짜의 브리핑 파일을 불러오지 못했습니다.");
    return false;
  }
  STATE.archiveView = { date, morning, evening };
  // 고른 날짜에 지금 에디션이 없으면 있는 쪽으로 전환
  if (STATE.edition === "MORNING" && !morning) STATE.edition = "EVENING";
  if (STATE.edition === "EVENING" && !evening) STATE.edition = "MORNING";
  renderArchivePicker();
  return true;
}
