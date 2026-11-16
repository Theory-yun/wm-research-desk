export function kstNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: get("hour") === "24" ? 0 : Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"), // "Mon", "Tue", ...
  };
}

/** 거래소 휴장일 (data/market-holidays.json, 앱 시작 시 setMarketHolidays로 채움) */
let HOLIDAYS = { KR: {}, US: {} };
export function setMarketHolidays(h) {
  HOLIDAYS = { KR: h?.KR?.closed ?? {}, US: h?.US?.closed ?? {} };
}
function zoneParts(tz, date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return { ymd: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hm: (Number(p.hour) % 24) * 100 + Number(p.minute) };
}

/** 한국 증시 정규장(09:00~15:30, 평일·휴장일 제외) */
export function isKrxOpenNow(date = new Date()) {
  const z = zoneParts("Asia/Seoul", date);
  if (["Sat", "Sun"].includes(z.weekday) || HOLIDAYS.KR[z.ymd]) return false;
  return z.hm >= 900 && z.hm < 1530;
}

/** 미국 증시 정규장(뉴욕 09:30~16:00, 평일·휴장일 제외) */
export function isUsOpenNow(date = new Date()) {
  const z = zoneParts("America/New_York", date);
  if (["Sat", "Sun"].includes(z.weekday) || HOLIDAYS.US[z.ymd]) return false;
  return z.hm >= 930 && z.hm < 1600;
}

/** 서울 외환시장 원/달러(09:00~익일 02:00, 평일) */
export function isFxOpenNow(date = new Date()) {
  const z = zoneParts("Asia/Seoul", date);
  const wd = z.weekday;
  if (z.hm < 200) return !["Sun", "Mon"].includes(wd) && !HOLIDAYS.KR[zoneParts("Asia/Seoul", new Date(date.getTime() - 3 * 3600e3)).ymd]; // 전날 세션 연장
  if (["Sat", "Sun"].includes(wd) || HOLIDAYS.KR[z.ymd]) return false;
  return z.hm >= 900;
}

/** 현재 KST 시각 기준으로 어느 에디션을 기본으로 보여줄지 결정합니다. */
export function defaultEditionByTime() {
  const p = kstNowParts();
  const hm = p.hour * 100 + p.minute;
  return hm < 1530 ? "MORNING" : "EVENING";
}

export function formatKstDate(date = new Date()) {
  const p = kstNowParts(date);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayMap = { Sun: "일", Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토" };
  return `기준 : ${p.year}.${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")}(${weekdayMap[p.weekday] ?? ""})`;
}
