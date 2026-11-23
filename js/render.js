import { STATE, currentEditionData, escapeHtml, StorageUtil } from "./state.js";
import { renderMacroCalendar, renderUpcomingStrip } from "./macroCalendar.js";
import { renderArchivePicker } from "./archive.js";
import { TAG_CLASS_MAP, LOCAL_STORAGE_KEYS, TOP5_DEFAULT_COUNT, tagBadge, archiveFile } from "./config.js";
import { isKrxOpenNow, isUsOpenNow, isFxOpenNow } from "./util.js";

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

/* ----------------------------- 최신 시세 (티커·핵심지표 공용) ----------------------------- */
const fmt2 = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (iso) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const isOpenFor = (m) => (m.key === "USDKRW" ? isFxOpenNow() : m.group === "domestic" ? isKrxOpenNow() : isUsOpenNow());
function mdOf(tradedAt) {
  const t = String(tradedAt ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return t ? `${t[2]}.${t[3]}` : null;
}

/**
 * 화면에 보여줄 지표: 브리핑 수집 값 대신 '지금 기준 최신 값'.
 *  1) 중계 서버 시세 — 장중이면 실시간, 마감 후면 그날 종가 (장 시작 전 0% 값은 쓰지 않음)
 *  2) 없으면 모닝·이브닝 중 더 나중에 수집된 값
 * 지난 브리핑을 보는 중에는 그날 수집 값 그대로. 브리핑 요약·카톡·이미지는 각 브리핑 수집 값 기준.
 */
export function latestMarket(data) {
  if (!data?.market) return [];
  if (STATE.archiveView) return data.market;
  const other = data === STATE.morningData ? STATE.eveningData : STATE.morningData;
  const newerOther = other?.generatedAt && Date.parse(other.generatedAt) > Date.parse(data.generatedAt ?? 0) ? other : null;
  return data.market.map((m) => {
    const open = isOpenFor(m);
    const q = STATE.live?.items?.[m.key];
    const usable = q && Number.isFinite(q.price) && (open || q.diff !== 0 || q.pct !== 0);
    if (usable) {
      const up = q.pct >= 0;
      const md = mdOf(q.tradedAt);
      return {
        ...m,
        priceStr: fmt2(q.price),
        diffStr: `${up ? "▲" : "▼"} ${fmt2(Math.abs(q.diff))}`,
        changePct: Number(q.pct.toFixed(2)),
        stale: false,
        live: true,
        asOfLocal: open ? "실시간" : "최신 종가",
        asOfKst: open ? `실시간 ${hhmm(STATE.live.updatedAt)} 기준` : `${md ? `${md} ` : ""}마감 기준`,
      };
    }
    const alt = newerOther?.market?.find((x) => x.key === m.key && !x.stale);
    return alt ? { ...alt, group: m.group } : m;
  });
}

/* ----------------------------- 상단 티커 ----------------------------- */
export function renderTicker() {
  const track = $("wm-ticker-track");
  const data = currentEditionData();
  if (!track || !data) return;

  const buildItem = (m) => {
    const open = isOpenFor(m);
    const isUp = m.changePct >= 0;
    const dir = m.stale ? "wm-flat" : isUp ? "wm-up" : "wm-down";
    const arrow = m.stale ? "•" : isUp ? "▲" : "▼";
    const when = m.live ? m.asOfKst : `브리핑 수집 ${data.generatedAtKST} 기준`;
    const status = `<span class="wm-mkt-dot ${open ? "is-open" : "is-closed"}" role="img" aria-label="${open ? "장중" : "마감"}" title="${open ? "장중" : "마감"} · ${escapeHtml(when)}"></span>`;
    return `
      <div class="wm-ticker-item">
        ${m.stale ? '<span class="wm-stale-dot" title="갱신 실패"></span>' : ""}
        ${status}<span class="wm-ticker-name">${escapeHtml(m.name)}</span>
        <span class="${dir}">${escapeHtml(m.priceStr)}</span>
        <span class="${dir}">${arrow} ${escapeHtml(String(m.diffStr).replace(/^[▲▼]\s*/, ""))} (${m.changePct >= 0 ? "+" : ""}${m.changePct}%)</span>
      </div>
    `;
  };
  const cycle = latestMarket(data).map(buildItem).join("");
  track.innerHTML = cycle + cycle;
}

/* ----------------------------- 6개 핵심 지표 타일 ----------------------------- */
export function renderTiles(data = currentEditionData()) {
  const grid = $("dashboard-6tiles-grid");
  if (!grid || !data) return;

  grid.innerHTML = latestMarket(data)
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
              <span class="info-diff-pt">${escapeHtml(String(item.diffStr).replace(/^([▲▼])\s*[-+]?/, "$1 "))}</span>
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
const WD_KO = ["일", "월", "화", "수", "목", "금", "토"];
/**
 * 모닝 브리핑이 다루는 미국 장이 '간밤'인지(전날 거래), 주말·휴장을 건넌 '직전 거래일'인지.
 * 반환: { overnight: boolean, label: "간밤" | "11.13(금) 장 이후" }
 */
export function globalSessionLabel(data) {
  const us = (data?.market ?? []).find((m) => m.key === "SP500")?.asOfLocal ?? "";
  const m = us.match(/(\d{2})\.(\d{2})/);
  const gen = new Date(new Date(data?.generatedAt ?? Date.now()).getTime() + 9 * 3600e3);
  if (!m) return { overnight: true, label: "간밤" };
  const today = Date.UTC(gen.getUTCFullYear(), gen.getUTCMonth(), gen.getUTCDate());
  let usDay = Date.UTC(gen.getUTCFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (usDay > today) usDay = Date.UTC(gen.getUTCFullYear() - 1, Number(m[1]) - 1, Number(m[2]));
  const gap = Math.round((today - usDay) / 86400e3);
  if (gap <= 1) return { overnight: true, label: "간밤" };
  return { overnight: false, label: `${m[1]}.${m[2]}(${WD_KO[new Date(usDay).getUTCDay()]}) 이후` };
}

function renderIssues(data) {
  const editionLabel = STATE.edition === "MORNING" ? "🌅 모닝 (글로벌 · 장 개장 전)" : "🌇 이브닝 (국내 · 장 종료 후)";
  $("edition-badge-tag").textContent = `${data.generatedAtKST} · ${editionLabel}`;
  $("edition-main-heading").textContent =
    STATE.edition === "MORNING"
      ? `${globalSessionLabel(data).overnight ? "간밤" : `직전 거래일 ${globalSessionLabel(data).label}`} 글로벌 핵심 이슈 & 손님 브리핑 종합 요약`
      : "당일 대한민국 핵심 이슈 & 손님 브리핑 종합 요약";
  $("edition-auto-time-note").textContent =
    STATE.edition === "MORNING"
      ? "✔ 매일 06:30(KST) 직전 글로벌 거래일 기준 자동 생성"
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
  const pb = STATE.pbOverride && STATE.pbOverride.file === currentDataFile() ? STATE.pbOverride : null;
  talkEl.textContent = pb ? pb.talkingPoint : data.talkingPoint;
  $("pb-applied-badge")?.toggleAttribute("hidden", !pb);
  $("summary-fallback-note")?.toggleAttribute("hidden", Boolean(pb) || data.sourceStatus?.summary !== "fallback");
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
    box.innerHTML = `<div style="padding:24px; text-align:center; color:#8FD3C4; font-size:13.5px; font-weight:700;">아직 수집된 기사가 없습니다. GitHub Actions 실행 후 채워집니다.</div>`;
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
                <span style="font-size:11.5px; font-weight:800; color:#8FD3C4;">${escapeHtml(n.press)}</span>
                <span style="font-size:11px; color:#B7C3C0; font-weight:700;">발행 ${escapeHtml(n.date)}</span>
              </div>
              <div class="top5-title" style="font-size:14.5px; font-weight:600; color:#E8EEEC; line-height:1.45;">${escapeHtml(n.title)}</div>
            </div>
          </div>
          <span class="top5-link-pill">기사 원문 ↗</span>
        </a>
      `;
    })
    .join("");
}

/* ----------------------------- 자산별 시사점 ----------------------------- */
const LEVEL_CLASS = { "변동 큼": "lv-high", "주목": "lv-mid", "평이": "lv-low" };
const ASSET_ICON = {
  kr_equity: "🇰🇷", us_equity: "🌐", bonds: "🏦", fx: "💱", commodities: "🛢️", alternatives: "🏢",
  safe: "🛡️", core: "📊", satellite: "🚀",
};

/**
 * 화면·PDF 공용: 자산별 시사점 카드 목록.
 * 지난 브리핑(배분 모델 방식) 데이터도 표준형 문구로 바꿔 같은 모양으로 보여줍니다.
 */
export function currentAssetInsights(data = currentEditionData()) {
  const ac = data?.assetChecks;
  if (!ac?.cards?.length) return null;
  if (ac.framework === "assets") return { cards: ac.cards, taxNews: ac.taxNews ?? [] };
  const pick = (c) => c.texts?.standard ?? c.texts?.[Object.keys(c.texts ?? {})[0]] ?? c;
  return {
    cards: ac.cards.map((c) => {
      const t = pick(c);
      return { ...c, headline: t.headline, analysis: t.insight, watch: t.check };
    }),
    taxNews: ac.taxNews ?? [],
  };
}

const fmtPct = (v) => `${v > 0 ? "+" : ""}${v}%`;

export function renderPortfolio() {
  const grid = $("portfolio-cards-grid");
  if (!grid) return;
  const extra = $("ac-extra");
  const cur = currentAssetInsights();
  if (!cur) {
    grid.innerHTML = `<div class="ac-empty">다음 브리핑 생성부터 자산별 시사점이 표시됩니다.</div>`;
    if (extra) extra.innerHTML = "";
    return;
  }

  grid.innerHTML = cur.cards
    .map((c) => {
      const market = (c.market ?? [])
        .map(
          (m) =>
            `<span class="ac-mkt ${m.changePct > 0 ? "up" : m.changePct < 0 ? "down" : ""}"><b>${escapeHtml(m.name)}</b> ${escapeHtml(m.priceStr ?? "")}${escapeHtml(m.unit ?? "")} <em>${escapeHtml(m.chgStr ?? fmtPct(m.changePct))}</em></span>`
        )
        .join("");
      const events = (c.events ?? [])
        .slice(0, 2)
        .map((e) => `<button type="button" class="ac-ev" data-date="${escapeHtml(e.date)}"><b>${e.dday === 0 ? "D-DAY" : `D-${e.dday}`}</b> ${escapeHtml(e.when)} ${escapeHtml(e.label)}</button>`)
        .join("");
      const news = (c.news ?? [])
        .slice(0, 2)
        .map((n) => `<a class="ac-news" href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)} <em>${n.coverage}곳</em></a>`)
        .join("");
      return `
        <article class="ac-card card-${c.key}">
          <div class="ac-head">
            <span class="ac-name">${ASSET_ICON[c.key] ?? ""} ${escapeHtml(c.name)}</span>
            <span class="ac-level ${LEVEL_CLASS[c.level] ?? ""}">${escapeHtml(c.level ?? "")}</span>
          </div>
          ${market ? `<div class="ac-mkts">${market}</div>` : ""}
          <div class="ac-headline">${escapeHtml(c.headline ?? "")}</div>
          <p class="ac-analysis">${escapeHtml(c.analysis ?? "")}</p>
          ${c.watch ? `<p class="ac-watch"><span>앞으로 볼 것</span>${escapeHtml(c.watch)}</p>` : ""}
          ${events || news ? `<div class="ac-basis">${events}${news}</div>` : ""}
        </article>`;
    })
    .join("");

  if (extra) {
    extra.innerHTML = cur.taxNews.length
      ? `<div class="ac-tax"><span>🏢⚖️ 세무·부동산 참고</span>${cur.taxNews
          .map((n) => `<a href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)} <em>${n.coverage}곳</em></a>`)
          .join("")}</div>`
      : "";
  }
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

/** 지금 보고 있는 브리핑의 데이터 파일 경로 (PB의 생각 반영 시 서버에 전달) */
export function currentDataFile() {
  return STATE.archiveView
    ? archiveFile(STATE.edition, STATE.archiveView.date)
    : `data/${STATE.edition === "MORNING" ? "morning" : "evening"}-latest.json`;
}

export function toggleEditBriefing() {
  STATE.isEditing = !STATE.isEditing;
  const btn = $("btn-edit-briefing");
  document.querySelectorAll("#dashboard-screen-view .editable-text").forEach((el) => {
    el.contentEditable = STATE.isEditing ? "true" : "false";
    el.style.outline = STATE.isEditing ? "1px dashed #C5A059" : "none";
    el.style.backgroundColor = STATE.isEditing ? "#1F1B12" : "";
  });
  if (btn) {
    btn.innerHTML = STATE.isEditing ? "✅ <span>편집 완료 (이 화면에만 임시 적용)</span>" : "✏️ <span>문구 임시 편집</span>";
  }
}
