import { STATE, currentEditionData, escapeHtml } from "./state.js";
import { currentAllocation } from "./render.js";
import { getTop5News } from "./render.js";

const $ = (id) => document.getElementById(id);

export function copyKakaoBriefing() {
  const data = currentEditionData();
  if (!data) return;
  const icon = STATE.edition === "MORNING" ? "🌅" : "🌇";

  const lines = data.market
    .map((item) => {
      const isUp = item.changePct >= 0;
      const sign = `${isUp ? "+" : ""}${item.changePct}%`;
      return `${isUp ? "📈" : "📉"} *${item.name}*: ${item.priceStr} (${item.diffStr} / ${sign})\n   🕒 ${item.asOfKst}`;
    })
    .join("\n");

  const issues = data.issues.map((i, idx) => `${idx + 1}️⃣ *[${i.tag}]* ${i.title}\n   └ ${i.desc}`).join("\n\n");
  const top5 = getTop5News()
    .map((n, i) => `📌 *${i + 1}. ${n.title}* (${n.press} | ${n.date})\n   🔗 ${n.shortUrl || n.url}`)
    .join("\n\n");
  const talking = $("edition-talking-point")?.textContent.trim() ?? data.talkingPoint;

  const msg = `🏛️ *[하나증권 패밀리오피스 마켓 브리핑]*\n${icon} *기준:* ${data.generatedAtKST} (${STATE.edition === "MORNING" ? "모닝 · 글로벌" : "이브닝 · 국내"})\n━━━━━━━━━━━━━━━━━━\n\n📊 *1. 핵심 지표 (요약)*\n${lines}\n\n🔥 *2. 핵심 마켓 이슈*\n${issues}\n\n💡 *3. 손님 브리핑 종합 요약*\n${talking}\n\n📰 *4. 손님 필독 인기 뉴스*\n${top5}\n\n━━━━━━━━━━━━━━━━━━\n💼 *HANA Family Office Solution*\n※ 본 자료는 PB 상담 보조용이며 법적 책임 증빙자료로 사용될 수 없습니다.`;

  navigator.clipboard?.writeText(msg).then(() => alert("손님 카톡 브리핑 문구가 복사되었습니다. 채팅방에 붙여넣기(Ctrl+V) 하세요."));
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const clip = (t, n) => {
  const s = String(t ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const kstNow = () => new Date(Date.now() + 9 * 3600e3);

/**
 * 보고서 출력 시점이 속한 주(월~일, 한국시간)의 주요 일정.
 * 토·일요일에 출력하면 이미 지나간 주 대신 다가오는 주(다음 주)를 보여줍니다.
 */
function thisWeekEvents() {
  const now = kstNow();
  const dow = (now.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const weekend = dow >= 5;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - dow + (weekend ? 7 : 0));
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const from = mon.toISOString().slice(0, 10);
  const to = sun.toISOString().slice(0, 10);
  const kinds = STATE.macro?.kinds ?? {};
  const prio = { rate: 0, data: 1, politics: 2, earnings: 3, derivatives: 4, market: 5 };
  const items = [...(STATE.macro?.items ?? []), ...(STATE.autoEvents ?? [])]
    .filter((e) => e.date >= from && e.date <= to && kinds[e.kind])
    .sort((a, b) => a.date.localeCompare(b.date) || (prio[kinds[a.kind].category] ?? 9) - (prio[kinds[b.kind].category] ?? 9));
  return { from, to, items, kinds, label: weekend ? "다음 주 주요 일정" : "이번 주 주요 일정" };
}

export function buildFormalPdfHtml() {
  const data = currentEditionData();
  const talking = $("edition-talking-point")?.textContent.trim() || data.talkingPoint;
  const top5 = getTop5News(5);
  const isMorning = STATE.edition === "MORNING";
  const edTitle = isMorning ? "모닝 · 간밤 글로벌" : "이브닝 · 당일 국내";
  const printed = kstNow();
  const printedStr = `${printed.getUTCFullYear()}.${String(printed.getUTCMonth() + 1).padStart(2, "0")}.${String(printed.getUTCDate()).padStart(2, "0")} ${String(printed.getUTCHours()).padStart(2, "0")}:${String(printed.getUTCMinutes()).padStart(2, "0")}`;

  // 1) 핵심 지표
  const tiles = data.market
    .map((m) => {
      const up = m.changePct > 0, down = m.changePct < 0;
      return `<div class="rp-tile">
        <div class="rp-tile-name">${escapeHtml(m.name)}</div>
        <div class="rp-tile-price">${escapeHtml(m.priceStr)}</div>
        <div class="rp-tile-chg ${up ? "up" : down ? "down" : ""}">${escapeHtml(m.diffStr)} (${up ? "+" : ""}${escapeHtml(m.changePct)}%)</div>
      </div>`;
    })
    .join("");

  // 2) 주요 이슈
  const issues = data.issues
    .slice(0, 3)
    .map(
      (iss, i) => `<div class="rp-issue">
        <div class="rp-issue-head"><span class="rp-num">${i + 1}</span><span class="rp-issue-cat">${escapeHtml(clip(iss.cat, 14))}</span><span class="rp-issue-tag">${escapeHtml(clip(iss.tag, 40))}</span></div>
        <div class="rp-issue-title">${escapeHtml(clip(iss.title, 46))}</div>
        <div class="rp-issue-desc">${escapeHtml(clip(iss.desc, 72))}</div>
      </div>`
    )
    .join("");

  // 4) 필독 뉴스 (원문 링크)
  const news = top5
    .map(
      (n, i) => `<a class="rp-news" href="${encodeURI(n.url)}" target="_blank" rel="noopener noreferrer">
        <span class="rp-num ${i < 2 ? "gold" : ""}">${i + 1}</span>
        <span class="rp-news-body">
          <span class="rp-news-title">${escapeHtml(clip(n.title, 40))}</span>
          <span class="rp-news-meta">${escapeHtml((n.tags || []).slice(0, 2).join("·"))} · ${escapeHtml(n.press)}${n.coverage ? ` · ${n.coverage}개 언론 보도` : ""}</span>
        </span>
        <span class="rp-link">원문 ↗</span>
      </a>`
    )
    .join("");

  // 5) 자산배분 (현재 선택된 모델)
  const alloc = currentAllocation();
  const allocHtml = alloc
    ? `<div class="rp-alloc-bar">${alloc.cards
        .map((c) => `<div class="seg-${c.key}" style="flex:${c.ratio}">${c.ratio}%${c.ratio >= 20 ? ` ${escapeHtml(c.name)}` : ""}</div>`)
        .join("")}</div>
      ${alloc.cards
        .map(
          (c) => `<div class="rp-alloc-row">
            <div class="rp-alloc-name">${c.icon} ${escapeHtml(c.name)} <b>${c.ratio}%</b> <span class="rp-lv lv-${c.level === "변동 큼" ? "high" : c.level === "주목" ? "mid" : "low"}">${escapeHtml(c.level)}</span></div>
            <div class="rp-alloc-text"><b>${escapeHtml(clip(c.headline, 38))}</b> — ${escapeHtml(clip(c.check, 46))}</div>
          </div>`
        )
        .join("")}
      ${alloc.rebalance ? `<div class="rp-rebal">⚖️ ${escapeHtml(clip(alloc.rebalance, 84))}</div>` : ""}`
    : `<div class="rp-empty">자산배분 점검 데이터가 없습니다.</div>`;

  // 6) 이번 주 주요 일정
  const wk = thisWeekEvents();
  const regionShort = { US: "美", KR: "韓", EU: "EU", JP: "日", GL: "" };
  const fmt = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
  };
  const evRows = wk.items.slice(0, 9).map((e) => {
    const k = wk.kinds[e.kind];
    const res = STATE.eventResults?.[e.id ?? `${e.date}|${e.kind}`];
    return `<tr>
      <td class="rp-ev-date">${fmt(e.date)}</td>
      <td><span class="rp-ev-pill cat-${k.category}">${escapeHtml(`${regionShort[k.region] ?? ""} ${e.company ?? k.label}`.trim())}</span></td>
      <td class="rp-ev-name">${escapeHtml(clip(e.title ?? k.name, 30))}${res ? `<span class="rp-ev-res"> → ${escapeHtml(clip(res.headline, 34))}</span>` : ""}</td>
      <td class="rp-ev-time">${escapeHtml(clip(e.timeKst ?? "", 26))}</td>
    </tr>`;
  });
  const more = wk.items.length > 9 ? `<div class="rp-more">외 ${wk.items.length - 9}건 — 대시보드 캘린더 참고</div>` : "";

  return `
    <div class="rp-page">
      <header class="rp-header">
        <div class="rp-brand"><span class="rp-badge">HANA FAMILY OFFICE</span><span class="rp-title">데일리 마켓 브리핑</span><span class="rp-edition">${escapeHtml(edTitle)}</span></div>
        <div class="rp-meta">데이터 기준 <b>${escapeHtml(data.generatedAtKST)}</b> · 출력 ${escapeHtml(printedStr)}</div>
      </header>

      <section class="rp-tiles">${tiles}</section>

      <div class="rp-grid">
        <section class="rp-box">
          <h3><span>01</span> 주요 이슈</h3>
          ${issues}
        </section>
        <section class="rp-box rp-summary">
          <h3><span>02</span> 손님 브리핑 요약</h3>
          <p>${escapeHtml(clip(talking, 360))}</p>
        </section>
        <section class="rp-box">
          <h3><span>03</span> 손님 필독 뉴스 <small>보도 언론사 수 기준 · 제목 클릭 시 원문</small></h3>
          ${news}
        </section>
        <section class="rp-box rp-alloc">
          <h3><span>04</span> 자산배분 점검 <small>${escapeHtml(alloc?.model?.name ?? "")} 예시 모델 ${alloc ? `${alloc.model.ratios.safe}:${alloc.model.ratios.core}:${alloc.model.ratios.satellite}` : ""}</small></h3>
          ${allocHtml}
        </section>
        <section class="rp-box rp-week">
          <h3><span>05</span> ${wk.label} <small>${fmt(wk.from)} ~ ${fmt(wk.to)} · 날짜는 현지 기준</small></h3>
          ${evRows.length ? `<table class="rp-ev"><tbody>${evRows.join("")}</tbody></table>${more}` : `<div class="rp-empty">이번 주 등록된 주요 일정이 없습니다.</div>`}
        </section>
      </div>

      <footer class="rp-footer">본 자료는 하나증권 패밀리오피스 PB의 상담 참고용으로 시장 데이터와 공시·보도를 바탕으로 자동 생성(AI 요약 포함)되었습니다. 자산배분 모델은 예시이며 투자 권유가 아니고, 투자 결과에 대한 법적 책임의 증빙자료로 사용될 수 없습니다. 손님 전달 전 PB의 확인을 권장합니다.</footer>
    </div>
  `;
}

export async function downloadPdf() {
  if (STATE.isEditing) document.getElementById("btn-edit-briefing").click();
  const wrap = $("formal-pdf-report-wrapper");
  const btn = $("btn-pdf-download");
  if (!wrap || !btn) return;

  const orig = btn.innerHTML;
  btn.innerHTML = "⏳ <span>보고서 조판중...</span>";
  btn.disabled = true;

  wrap.innerHTML = buildFormalPdfHtml();
  // 화면 가운데 정렬 상태로 캡처하면 왼쪽이 잘리므로, 출력 동안만 가운데 정렬을 풀고 스크롤을 맨 위로 올립니다.
  const prevScroll = window.scrollY;
  window.scrollTo(0, 0);
  Object.assign(wrap.style, { display: "block", margin: "0" });

  const data = currentEditionData();
  const edTag = STATE.edition === "MORNING" ? "0_Morning" : "1_Evening";
  const fName = `HANA_FamilyOffice_마켓브리핑_${data.generatedAtKST.replace(/[.\s:]/g, "")}_${edTag}.pdf`;

  if (window.html2pdf) {
    try {
      await window
        .html2pdf()
        .set({
          margin: [0, 0, 0, 0],
          filename: fName,
          enableLinks: true,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 },
          jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
          pagebreak: { mode: ["avoid-all"] },
        })
        .from(wrap)
        .save();
    } catch {
      window.print();
    }
  } else {
    window.print();
  }

  Object.assign(wrap.style, { display: "none", margin: "" });
  window.scrollTo(0, prevScroll);
  btn.innerHTML = orig;
  btn.disabled = false;
}
