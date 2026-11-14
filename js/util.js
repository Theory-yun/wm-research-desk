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

export function isKrxOpenNow() {
  const p = kstNowParts();
  const isWeekday = !["Sat", "Sun"].includes(p.weekday);
  const hm = p.hour * 100 + p.minute;
  return isWeekday && hm >= 900 && hm < 1530;
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
