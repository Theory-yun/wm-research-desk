import { STATE, escapeHtml, StorageUtil } from "./state.js";
import { TAG_CLASS_MAP, LOCAL_STORAGE_KEYS, NEWSROOM_PAGE_SIZE, tagBadge } from "./config.js";
import { recordNewsClick } from "./render.js";

const $ = (id) => document.getElementById(id);

function tagClass(t) {
  return TAG_CLASS_MAP[t] || "tag-macro";
}

function getFilteredNews() {
  let list;
  if (STATE.newsFilter === "SCRAP") {
    list = Object.values(STATE.scrapMap).sort((a, b) => b.timestamp - a.timestamp);
  } else if (STATE.newsFilter === "ALL") {
    list = STATE.newsArchive;
  } else {
    list = STATE.newsArchive.filter((a) => (a.tags || []).includes(STATE.newsFilter));
  }

  if (STATE.newsSearch.trim()) {
    const kw = STATE.newsSearch.trim().toLowerCase();
    list = list.filter((a) => a.title.toLowerCase().includes(kw));
  }
  return list;
}

export function renderNewsroom() {
  const box = $("news-container");
  if (!box) return;

  $("scrap-count").textContent = Object.keys(STATE.scrapMap).length;
  const badge = $("news-status-badge");
  if (badge) {
    badge.textContent = STATE.newsArchive.length
      ? `● 아카이브 보관 중 (자동 수집, 실시간 외부 호출 없음)`
      : "⏳ 아직 수집된 기사가 없습니다 (GitHub Actions 실행 전)";
  }

  const all = getFilteredNews();
  const visible = all.slice(0, STATE.newsVisibleCount);

  if (!visible.length) {
    box.innerHTML = `<div style="text-align:center; padding:50px 20px; color:#8FD3C4; font-size:14px; font-weight:700;">조건에 맞는 기사가 없습니다.</div>`;
    $("news-count-info").textContent = "";
    $("btn-load-more-news").style.display = "none";
    return;
  }

  box.innerHTML = visible
    .map((n) => {
      const tags = (n.tags || []).map((t) => tagBadge(t, escapeHtml)).join("");
      const scrapped = !!STATE.scrapMap[n.title];
      return `
        <article class="news-card-item">
          <div class="news-badges-wrap">${tags}</div>
          <a href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer" class="news-title-link" data-news-title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</a>
          <div class="news-meta-info">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="news-press">${escapeHtml(n.press)}</span>
              <span style="font-weight:700; color:#DCE4E2;">발행 ${escapeHtml(n.date)}</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn-news-util ${scrapped ? "scrapped" : ""}" data-action="scrap" data-news-title="${escapeHtml(n.title)}">${scrapped ? "★ 스크랩됨" : "☆ 스크랩"}</button>
              <button type="button" class="btn-news-util" data-action="copy" data-news-title="${escapeHtml(n.title)}">📋 브리핑 복사</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  $("news-count-info").textContent = `현재 표시: ${visible.length}건 (조건에 맞는 전체: ${all.length}건 · 아카이브 총: ${STATE.newsArchive.length}건)`;
  $("btn-load-more-news").style.display = visible.length < all.length ? "inline-block" : "none";
}

function findNewsByTitle(title) {
  return getFilteredNews().find((n) => n.title === title) || STATE.newsArchive.find((n) => n.title === title);
}

export function initNewsroomEvents() {
  $("news-filter-bar").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-pill-btn");
    if (!btn) return;
    STATE.newsFilter = btn.dataset.filter;
    STATE.newsVisibleCount = NEWSROOM_PAGE_SIZE;
    document.querySelectorAll("#news-filter-bar .filter-pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderNewsroom();
  });

  $("btn-news-search").addEventListener("click", () => {
    STATE.newsSearch = $("custom-news-input").value;
    STATE.newsVisibleCount = NEWSROOM_PAGE_SIZE;
    renderNewsroom();
  });
  $("custom-news-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-news-search").click();
  });

  $("btn-load-more-news").addEventListener("click", () => {
    STATE.newsVisibleCount += NEWSROOM_PAGE_SIZE;
    renderNewsroom();
  });

  $("news-container").addEventListener("click", (e) => {
    const link = e.target.closest("a[data-news-title]");
    if (link) {
      recordNewsClick(link.dataset.newsTitle);
      return;
    }
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const title = btn.dataset.newsTitle;
    const item = findNewsByTitle(title);
    if (!item) return;

    if (btn.dataset.action === "scrap") {
      if (STATE.scrapMap[item.title]) delete STATE.scrapMap[item.title];
      else STATE.scrapMap[item.title] = item;
      StorageUtil.set(LOCAL_STORAGE_KEYS.scrapMap, STATE.scrapMap);
      renderNewsroom();
    } else if (btn.dataset.action === "copy") {
      const msg = `📰 [J's WM RESEARCH DESK 마켓 브리핑]\n■ ${item.title}\n• 분류: ${(item.tags || []).join(", ")} | 언론사: ${item.press} (발행: ${item.date})\n🔗 원문: ${item.shortUrl || item.url}`;
      navigator.clipboard?.writeText(msg).then(() => alert("기사 브리핑 문구가 복사되었습니다."));
    }
  });
}
