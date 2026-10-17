// 접속자 집계 (adm/visit_list.php and its tabs): visits between two Korean
// days, inclusive, broken down by day, hour, weekday, month, year, browser,
// operating system, device or where visitors came from, with the totals:
// visits, guests' visits and how many members visited. All of it is summed
// by SQL: the hours and the rest are JSON maps a day keeps, opened with
// json_each(visits.<column>) row by row.
import { invalid, ownerOnly } from "../../modules/admin.js";
import { one } from "../../modules/access.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** The breakdowns kept as a JSON map on each day: their columns. */
const MAPS = {
  hour: "hours",
  browsers: "browsers",
  os: "os",
  devices: "devices",
  domains: "domains",
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The report `by` one of day, hour, week, month, year, browsers, os,
 * devices or domains: rows of { label, count } and the totals, and how many
 * days are kept from before `from` (what pruning would delete).
 */
export async function report(
  ctx: QueryCtx,
  {
    from = "",
    to = "",
    by = "day",
  }: { from?: string; to?: string; by?: string } = {},
) {
  ownerOnly(ctx);
  if (
    ![from, to].every((day) => day === "" || DAY.test(day)) ||
    !["day", "week", "month", "year", ...Object.keys(MAPS)].includes(by)
  )
    invalid(ctx);
  // Within the range; '9999' is after every day.
  const range: SqlValue[] = [from, to || "9999"];
  const within = "day >= ? AND day <= ?";
  const totals = await one<{ total: number; guests: number }>(
    ctx,
    `SELECT coalesce(sum(total), 0) AS total, coalesce(sum(guests), 0) AS guests FROM visits WHERE ${within}`,
    range,
  );
  // Each day's members (a JSON map of member to visits): how many different
  // ones visited.
  const members = await one<{ count: number }>(
    ctx,
    `SELECT count(DISTINCT j.key) AS count FROM visits, json_each(visits.members) AS j WHERE ${within}`,
    range,
  );
  let rows: { label: string; count: number }[];
  if (Object.hasOwn(MAPS, by)) {
    // Each label's counts over the days; a value that is not a number is
    // not counted.
    const counts = (
      await ctx.sql(
        `SELECT j.key AS label, sum(j.value) AS count FROM visits, json_each(visits.${MAPS[by as keyof typeof MAPS]}) AS j
         WHERE ${within} AND j.type IN ('integer', 'real')
         GROUP BY j.key ORDER BY count DESC, label LIMIT 1000`,
        range,
      )
    ).rows;
    rows = counts.map(({ label, count }) =>
      by === "hour"
        ? { label: `${String(label).padStart(2, "0")}시`, count: Number(count) }
        : { label: String(label), count: Number(count) },
    );
    rows.sort(
      by === "hour"
        ? (a, b) => (a.label < b.label ? -1 : 1)
        : (a, b) => b.count - a.count || (a.label < b.label ? -1 : 1),
    );
  } else {
    const group = {
      day: "day",
      month: "substr(day, 1, 7)",
      year: "substr(day, 1, 4)",
      week: "CAST(strftime('%w', day) AS INTEGER)",
    }[by];
    rows = (
      await ctx.sql(
        `SELECT ${group} AS label, sum(total) AS count FROM visits WHERE ${within} GROUP BY ${group} ORDER BY ${group}`,
        range,
      )
    ).rows.map((row) => ({
      label: by === "week" ? WEEKDAYS[Number(row.label)] : String(row.label),
      count: Number(row.count),
    }));
  }
  const older = from
    ? (
        await one<{ count: number }>(
          ctx,
          "SELECT count(*) AS count FROM visits WHERE day < ?",
          [from],
        )
      ).count
    : 0;
  return {
    total: totals.total,
    guests: totals.guests,
    members: members.count,
    rows,
    older,
  };
}
