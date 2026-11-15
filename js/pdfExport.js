import { STATE, currentEditionData, escapeHtml } from "./state.js";
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
    .map((n, i) => `📌 *${i + 1}. ${n.title}* (${n.press} | ${n.date})\n   🔗 ${n.url}`)
    .join("\n\n");
  const talking = $("edition-talking-point")?.textContent.trim() ?? data.talkingPoint;

  const msg = `🏛️ *[하나증권 패밀리오피스 마켓 브리핑]*\n${icon} *기준:* ${data.generatedAtKST} (${STATE.edition === "MORNING" ? "모닝 · 글로벌" : "이브닝 · 국내"})\n━━━━━━━━━━━━━━━━━━\n\n📊 *1. 핵심 지표 (요약)*\n${lines}\n\n🔥 *2. 핵심 마켓 이슈*\n${issues}\n\n💡 *3. 손님 브리핑 종합 요약*\n${talking}\n\n📰 *4. 손님 필독 인기 뉴스*\n${top5}\n\n━━━━━━━━━━━━━━━━━━\n💼 *HANA Family Office Solution*\n※ 본 자료는 PB 상담 보조용이며 법적 책임 증빙자료로 사용될 수 없습니다.`;

  navigator.clipboard?.writeText(msg).then(() => alert("손님 카톡 브리핑 문구가 복사되었습니다. 채팅방에 붙여넣기(Ctrl+V) 하세요."));
}

function buildFormalPdfHtml() {
  const data = currentEditionData();
  const talking = $("edition-talking-point")?.textContent.trim() ?? data.talkingPoint;
  const top5 = getTop5News();
  const edTitle = STATE.edition === "MORNING" ? "모닝 에디션 (간밤 글로벌 주요 이슈)" : "이브닝 에디션 (당일 대한민국 주요 이슈)";

  const tRows = data.market
    .map((item) => {
      const isUp = item.changePct >= 0;
      const col = isUp ? "#dc2626" : "#2563eb";
      const pct = `${isUp ? "+" : ""}${item.changePct}%`;
      return `
        <tr>
          <td style="font-weight:800;">${escapeHtml(item.name)}</td>
          <td style="font-size:11px; line-height:1.35;"><span style="color:#64748b;">${escapeHtml(item.asOfLocal)}</span><br><strong style="color:#004B49;">${escapeHtml(item.asOfKst)}</strong></td>
          <td style="text-align:right; font-weight:800;">${escapeHtml(item.priceStr)}</td>
          <td style="text-align:right; font-weight:700; color:${col};">${escapeHtml(item.diffStr)} (${pct})</td>
        </tr>
      `;
    })
    .join("");

  const issHtml = data.issues
    .map(
      (iss) => `
      <div style="border:1px solid #d1d5db; border-left:4px solid #004B49; border-radius:8px; padding:11px 14px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:800; color:#004B49; margin-bottom:3px;"><span>${escapeHtml(iss.cat)}</span><span>[${escapeHtml(iss.tag)}]</span></div>
        <div style="font-size:13.5px; font-weight:800; margin-bottom:4px;">${escapeHtml(iss.title)}</div>
        <div style="font-size:12px; color:#334155; line-height:1.5;">${escapeHtml(iss.desc)}</div>
      </div>
    `
    )
    .join("");

  const top5Html = top5
    .map(
      (n, i) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:9px 12px; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:7px; background:#f8fafc;">
        <div style="display:flex; align-items:center; gap:10px; padding-right:10px;">
          <span style="background:${i < 2 ? "#C5A059" : "#004B49"}; color:${i < 2 ? "#002E2C" : "#ffffff"}; font-weight:800; font-size:11.5px; width:22px; height:22px; border-radius:5px; display:inline-flex; align-items:center; justify-content:center;">${i + 1}</span>
          <div>
            <div style="font-size:10.5px; color:#004B49; font-weight:800;">[${escapeHtml((n.tags || []).join("·"))}] ${escapeHtml(n.press)} | 출고: ${escapeHtml(n.date)}</div>
            <span style="font-size:12.8px; font-weight:700; color:#0f172a;">${escapeHtml(n.title)}</span>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  const pfRows = (data.assetChecks?.cards ?? [])
    .map(
      (c) => `
      <div style="border:1px solid #cbd5e1; border-top:3px solid #004B49; border-radius:8px; padding:11px;">
        <div style="font-size:11.5px; font-weight:800; color:#004B49; margin-bottom:4px;">${c.icon} ${escapeHtml(c.name)} · ${escapeHtml(c.level)}</div>
        <div style="font-size:12.5px; font-weight:800; margin-bottom:5px;">${escapeHtml(c.headline)}</div>
        <div style="font-size:11.5px; color:#334155; line-height:1.45;">${escapeHtml(c.check)}</div>
      </div>
    `
    )
    .join("");

  return `
    <div class="pdf-report-page">
      <div class="pdf-cover-banner">
        <div class="pdf-cover-top-row"><span class="pdf-cover-badge">HANA FAMILY OFFICE · VIP CLIENT REPORT</span><span style="font-size:11px; color:#cbd5e1;">Doc No. HFO-${data.generatedAtKST.replace(/[.\s:]/g, "")}</span></div>
        <div class="pdf-cover-title">하나 패밀리오피스 데일리 마켓 브리핑 리포트</div>
        <div class="pdf-cover-subtitle">초고액자산가(HNW) 가문 자산보존 및 글로벌 포트폴리오 전략을 위한 일일 시장 분석 보고서</div>
        <div class="pdf-cover-meta-grid">
          <div><span style="color:#C5A059; font-weight:700;">발행 기준</span><br><strong>${escapeHtml(data.generatedAtKST)}</strong></div>
          <div><span style="color:#C5A059; font-weight:700;">브리핑 에디션</span><br><strong>${escapeHtml(edTitle)}</strong></div>
          <div><span style="color:#C5A059; font-weight:700;">발행 부서</span><br><strong>하나증권 WM그룹 패밀리오피스</strong></div>
        </div>
      </div>
      <div class="pdf-sec-title"><span>01. Executive Summary — 핵심 이슈 및 손님 브리핑 종합 요약</span></div>
      <div style="background:#faf6ee; border:1px solid #C5A059; border-radius:8px; padding:12px 14px; margin-bottom:10px; font-size:12.3px; line-height:1.55;">
        <div style="font-weight:800; color:#004B49; margin-bottom:4px;">💡 손님 브리핑 종합 요약</div><div>${escapeHtml(talking)}</div>
      </div>
      ${issHtml}
      <div class="pdf-sec-title"><span>02. 핵심 지표 — 현지시간 및 한국시간(KST) 기준</span></div>
      <table class="pdf-summary-table">
        <thead><tr><th>지표명</th><th>마감일시</th><th style="text-align:right;">종가</th><th style="text-align:right;">전일대비</th></tr></thead>
        <tbody>${tRows}</tbody>
      </table>
    </div>
    <div class="pdf-report-page pdf-page-break">
      <div style="display:flex; justify-content:space-between; border-bottom:2px solid #004B49; padding-bottom:8px; margin-bottom:14px;">
        <span style="font-size:12px; font-weight:800; color:#004B49;">HANA FAMILY OFFICE DAILY MARKET BRIEFING</span>
        <span style="font-size:11px; color:#64748b;">발행: ${escapeHtml(data.generatedAtKST)} | Page 2 of 2</span>
      </div>
      <div class="pdf-sec-title"><span>03. 손님 필독 마켓 뉴스</span></div>
      ${top5Html}
      ${pfRows ? `<div class="pdf-sec-title"><span>04. 자산군별 점검 포인트 (시장 데이터 기반 점검 항목 · 투자 권유 아님)</span></div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:14px;">${pfRows}</div>` : ""}
      <div style="margin-top:16px; padding-top:10px; border-top:1px solid #cbd5e1; font-size:10px; color:#64748b; line-height:1.5;">
        <strong>[Compliance Notice | 하나증권 패밀리오피스 안내사항]</strong> 본 보고서는 하나증권 패밀리오피스 손님의 자산관리 이해를 돕기 위해 시장 정보와 정규장 마감 데이터를 바탕으로 자동 생성되었으며(AI 요약 포함), 투자 결과에 대한 법적 책임 소재의 증빙자료로 사용될 수 없습니다. 손님 전달 전 PB의 사실 확인을 권장합니다.
      </div>
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
  wrap.style.display = "block";

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
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(wrap)
        .save();
    } catch {
      window.print();
    }
  } else {
    window.print();
  }

  wrap.style.display = "none";
  btn.innerHTML = orig;
  btn.disabled = false;
}
