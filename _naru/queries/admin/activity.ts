// 활동량 관리 (adm/action_list.php): each member's posts and comments on a
// board (every board when none) between two Korean days, inclusive, counted
// by SQL, with their main character, their last visit and the owner's
// warnings; most active first.
import { invalid, kstStart, ownerOnly } from "../../modules/admin.js";
import type { QueryCtx } from "../../modules/naru-types.js";

const DAY = 24 * 3600 * 1000;

export async function report(
  ctx: QueryCtx,
  {
    board = "",
    from = "",
    to = "",
  }: { board?: string; from?: string; to?: string } = {},
) {
  ownerOnly(ctx);
  const start = from === "" ? 0 : kstStart(from);
  const end = to === "" ? Number.MAX_SAFE_INTEGER : kstStart(to);
  if (typeof board !== "string" || start === null || end === null) invalid(ctx);
  const until = to === "" ? end : end + DAY;
  const { rows } = await ctx.sql(
    `SELECT profiles.member, profiles.nick, characters.name AS main_character,
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
     ORDER BY logs + comments DESC, profiles.nick
     LIMIT 1000`,
    [start, until, board, board, start, until, board, board],
  );
  return rows.map((row) => ({
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
}
