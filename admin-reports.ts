// The owner's reports' filters: visits' breakdowns (adm/visit_list and its
// tabs) and Korean days. The reports themselves are queries
// (admin/visits:report, admin/activity:report); admin.js draws the tables.

/** How visits can be broken down, as the original's tabs. */
export const VISIT_BREAKDOWNS = [
  ["day", "날짜별"],
  ["hour", "시간별"],
  ["week", "요일별"],
  ["month", "월별"],
  ["year", "연도별"],
  ["browsers", "브라우저별"],
  ["os", "운영체제별"],
  ["devices", "접속기기별"],
  ["domains", "접속 경로별"],
];

/** The day (YYYY-MM-DD) in Korea of an ISO time or epoch milliseconds. */
export function koreanDay(at) {
  return new Date(new Date(at).getTime() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}
