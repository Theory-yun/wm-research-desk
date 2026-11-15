import zlib from "node:zlib";
import { fetchWithRetry } from "./fetchUtil.mjs";

/**
 * 금융감독원 전자공시(DART) OpenAPI 도우미 — DART_API_KEY 필요 (opendart.fss.or.kr 무료 발급)
 */
const API = "https://opendart.fss.or.kr/api";

export const hasDartKey = () => !!process.env.DART_API_KEY;
export const dartViewerUrl = (rceptNo) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`;

/** 기간 내 유가증권시장 거래소공시(I) 목록 (페이지 끝까지) */
export async function listDisclosures({ bgnDe, endDe, maxPages = 40 }) {
  const key = process.env.DART_API_KEY;
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${API}/list.json?crtfc_key=${key}&bgn_de=${bgnDe}&end_de=${endDe}&corp_cls=Y&pblntf_ty=I&page_no=${page}&page_count=100`;
    const res = await fetchWithRetry(url, { timeoutMs: 15000, retries: 2 });
    if (!res) break;
    if (res.status && res.status !== "000") {
      if (res.status !== "013") console.error(`[DART] list 오류 ${res.status}: ${res.message}`); // 013 = 조회 데이터 없음
      break;
    }
    out.push(...(res.list ?? []));
    if (page >= Number(res.total_page ?? 1)) break;
  }
  return out;
}

/** 공시 원문(zip 안의 XML)을 텍스트로 변환 */
export async function fetchDocumentText(rceptNo) {
  const key = process.env.DART_API_KEY;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API}/document.xml?crtfc_key=${key}&rcept_no=${rceptNo}`, { signal: ctrl.signal });
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.readUInt32LE(0) !== 0x04034b50) return ""; // zip이 아니면(에러 응답) 무시
    return unzipEntries(buf)
      .map(({ data }) => decodeXml(data))
      .join("\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  } catch (err) {
    console.error(`[DART] 원문 조회 실패 ${rceptNo}: ${err.message}`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(bytes) {
  const head = bytes.subarray(0, 200).toString("latin1");
  const enc = (head.match(/encoding=["']([^"']+)["']/i)?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(enc === "euc-kr" || enc === "ks_c_5601-1987" ? "euc-kr" : enc).decode(bytes);
  } catch {
    return bytes.toString("utf-8");
  }
}

/** 의존성 없이 쓰는 최소 zip 해제(중앙 디렉터리 기준, stored/deflate 지원) */
function unzipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf-8");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (data) entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
