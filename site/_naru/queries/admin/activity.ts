// 활동량 관리 (adm/action_list.php): each member's posts and comments on a
// board (every board when none) between two Korean days, inclusive, counted
// by SQL, with their main character, their last visit and the owner's
// warnings; most active first, then by nickname, 100 a page: each page
// after the last one's (activity, nickname, member), so a community of any
// size is read to its end.

import { ownerOnly } from "../../modules/access.js";
import { invalid, kstStart } from "../../modules/admin.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

const DAY = 24 * 3600 * 1000;
/** Members a page. */
const PAGE = 100;

/** A page's cursor: the last row's activity, nickname and member, or null. */
function cursorOf(after: unknown): [number, string, string] | null | false {
  if (after === null || after === undefined) return null;
  if (typeof after !== "string" || after.length > 300) return false;
  try {
    const value = JSON.parse(after);
    return Array.isArray(value) &&
      value.length === 3 &&
      Number.isSafeInteger(value[0]) &&
      typeof value[1] === "string" &&
      typeof value[2] === "string"
      ? (value as [number, string, string])
      : false;
  } catch {
    return false;
  }
}

export const report = ownerOnly(async function report(
  ctx: QueryCtx,
  {
    board = "",
    from = "",
    to = "",
    after = null,
  }: { board?: string; from?: string; to?: string; after?: string | null } = {},
) {
  const start = from === "" ? 0 : kstStart(from);
  const end = to === "" ? Number.MAX_SAFE_INTEGER : kstStart(to);
  const cursor = cursorOf(after);
  if (
    typeof board !== "string" ||
    start === null ||
    end === null ||
    cursor === false
  )
    invalid(ctx);
  const until = to === "" ? end : end + DAY;
  const values: SqlValue[] = [
    start,
    until,
    board,
    board,
    start,
    until,
    board,
    board,
  ];
  // Past the last page's row, in the list's order: less active, or as
  // active and later by nickname, then member.
  const activity = "counted.logs + counted.comments";
  const past = cursor
    ? `WHERE ${activity} < ? OR (${activity} = ? AND (counted.nick > ? OR (counted.nick = ? AND counted.member > ?)))`
    : "";
  if (cursor)
    values.push(cursor[0], cursor[0], cursor[1], cursor[1], cursor[2]);
  const { rows } = await ctx.sql(
    `SELECT * FROM (
       SELECT profiles.member, profiles.nick, characters.name AS main_character,
         (SELECT count(*) FROM posts WHERE posts.owner = profiles.member
            AND posts.created_at >= ? AND posts.created_at < ? AND (? = '' OR posts.board = ?)) AS logs,
         (SELECT count(*) FROM comments JOIN posts ON posts.id = comments.post_id
            WHERE comments.owner = profiles.member
            AND comments.created_at >= ? AND comments.created_at < ? AND (? = '' OR posts.board = ?)) AS comments,
         presence.at AS last_seen, members.member IS NOT NULL AS has_member,
         coalesce(members.warnings, 0) AS warnings, coalesce(members.warning_note, '') AS warning_note
       FROM profiles
       LEFT JOIN members ON members.member = profiles.member
       LEFT JOIN presence ON presence.member = profiles.member
       LEFT JOIN characters ON characters.id = profiles.main_character
     ) AS counted
     ${past}
     ORDER BY ${activity} DESC, counted.nick, counted.member
     LIMIT ?`,
    [...values, PAGE + 1],
  );
  const listed = rows.slice(0, PAGE).map((row) => ({
    id: String(row.member),
    nick: row.nick,
    mainCharacter: row.main_character ?? "",
    logs: Number(row.logs),
    comments: Number(row.comments),
    lastSeen: row.last_seen ?? null,
    warnings: Number(row.warnings),
    warningNote: String(row.warning_note),
    member: row.has_member === 1,
  }));
  const last = listed.at(-1);
  return {
    rows: listed,
    nextCursor:
      rows.length > PAGE
        ? JSON.stringify([last.logs + last.comments, last.nick, last.id])
        : null,
  };
});
