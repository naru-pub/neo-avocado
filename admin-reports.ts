// The owner's reports, computed from what Naru keeps: visits (adm/visit_list
// and its breakdowns) and members' activity (adm/action_list). Pure, so the
// tests can check them; admin.js reads the documents and draws the tables.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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

/**
 * Visits between `from` and `to` (YYYY-MM-DD, Korean days, inclusive),
 * broken down `by` one of VISIT_BREAKDOWNS: rows of { label, count }, and
 * the totals (visits, guests' visits, distinct members).
 */
export function visitReport(days, { from, to, by }) {
  const chosen = days.filter(
    (row) => (!from || row.data.day >= from) && (!to || row.data.day <= to),
  );
  const counts = new Map();
  const add = (label, count) =>
    counts.set(label, (counts.get(label) ?? 0) + count);
  const members = new Set();
  let total = 0;
  let guests = 0;
  for (const { data } of chosen) {
    total += data.total ?? 0;
    guests += data.guests ?? 0;
    for (const id of Object.keys(data.members ?? {})) members.add(id);
    const [year, month, date] = data.day.split("-").map(Number);
    if (by === "day") add(data.day, data.total ?? 0);
    else if (by === "month") add(data.day.slice(0, 7), data.total ?? 0);
    else if (by === "year") add(data.day.slice(0, 4), data.total ?? 0);
    else if (by === "week")
      add(
        WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()],
        data.total ?? 0,
      );
    else if (by === "hour")
      for (const [hour, count] of Object.entries(data.hours ?? {}))
        add(`${hour.padStart(2, "0")}시`, count);
    else
      for (const [label, count] of Object.entries(data[by] ?? {}))
        add(label, count);
  }
  const order =
    by === "week"
      ? (a, b) => WEEKDAYS.indexOf(a.label) - WEEKDAYS.indexOf(b.label)
      : ["day", "month", "year", "hour"].includes(by)
        ? (a, b) => (a.label < b.label ? -1 : 1)
        : (a, b) => b.count - a.count || (a.label < b.label ? -1 : 1);
  return {
    total,
    guests,
    members: members.size,
    rows: [...counts].map(([label, count]) => ({ label, count })).sort(order),
  };
}

/** The day (YYYY-MM-DD) in Korea of an ISO time or epoch milliseconds. */
export function koreanDay(at) {
  return new Date(new Date(at).getTime() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Each member's posts and comments on `board` (every board when empty)
 * between `from` and `to` (Korean days, inclusive), with their main
 * character, their last visit and the owner's warnings: adm/action_list.
 */
export function activityReport(
  { profiles, members, characters, logs, comments, presence },
  { board, from, to },
) {
  const within = (row) => {
    const day = koreanDay(row.createdAt);
    return (!from || day >= from) && (!to || day <= to);
  };
  const author = (row) => row.createdBy ?? row.data.owner;
  const onBoard = new Set(
    logs
      .filter((row) => !board || (row.data.board ?? "default") === board)
      .map((row) => row.id),
  );
  const count = (rows) => {
    const counts = new Map();
    for (const row of rows) {
      const id = author(row);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };
  const posts = count(
    logs.filter(
      (row) => onBoard.has(row.id) && within(row) && !row.data.deleted,
    ),
  );
  const replies = count(
    comments.filter(
      (row) => onBoard.has(row.data.logId) && within(row) && !row.data.deleted,
    ),
  );
  return profiles
    .map((profile) => {
      const member = members.find((row) => row.id === profile.id);
      return {
        id: profile.id,
        nick: profile.data.nick,
        mainCharacter:
          characters.find((row) => row.id === profile.data.mainCharacter)?.data
            .name ?? "",
        logs: posts.get(profile.id) ?? 0,
        comments: replies.get(profile.id) ?? 0,
        lastSeen:
          presence.find((row) => row.id === profile.id)?.data.at ?? null,
        warnings: member?.data.warnings ?? 0,
        warningNote: member?.data.warningNote ?? "",
        member: member ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.logs + b.comments - (a.logs + a.comments) ||
        (a.nick < b.nick ? -1 : 1),
    );
}
