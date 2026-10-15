// When a shop item is on display (shop/index.php's sh_date, sh_time and
// sh_week), shared by the site functions and the shop page, which reads this
// file as it is published.

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/**
 * Whether an item is on display now (sh_date_s/e, sh_time_s/e, sh_week): its
 * dates, hours (inclusive) and weekdays, in Korean time; a limit left empty
 * does not limit.
 */
export function onDisplay(display, now) {
  if (!display || typeof display !== "object") return true;
  const korea = new Date(now + 9 * 3600 * 1000);
  const day = korea.toISOString().slice(0, 10);
  const hour = korea.getUTCHours();
  const weekday = WEEKDAYS[korea.getUTCDay()];
  if (display.from && day < display.from) return false;
  if (display.until && day > display.until) return false;
  if (Number.isInteger(display.fromHour) && hour < display.fromHour)
    return false;
  if (Number.isInteger(display.untilHour) && hour > display.untilHour)
    return false;
  if (
    Array.isArray(display.weekdays) &&
    display.weekdays.length &&
    !display.weekdays.includes(weekday)
  )
    return false;
  return true;
}
