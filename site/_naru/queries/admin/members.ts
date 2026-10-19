// 회원 관리 (adm/member_list.php): each member's level, role, warnings,
// leaving and blocking days and note, with their nickname and last visit,
// newest visit first, found by nickname or member number, and how many
// there are, blocked and left (총회원수, 차단, 탈퇴); and one member.
import {
  MEMBER_SELECT,
  PAGE,
  invalid,
  memberData,
  offsetOf,
  pageOf,
} from "../../modules/admin.js";
import { one, ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * member_list.php's column sorts (sst, sod): the newest visit first, as
 * the list opens, or by 가입일, nickname or level.
 */
const MEMBER_SORTS: Record<string, string> = {
  seen: "presence.at IS NULL, presence.at DESC",
  joined: "profiles.joined_at IS NULL, profiles.joined_at DESC",
  nick: "profiles.nick IS NULL, profiles.nick",
  level: "members.level DESC",
};

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    search = "",
    field = "nick",
    after = null,
    sort = "seen",
  }: {
    search?: string;
    field?: string;
    after?: string | null;
    sort?: string;
  } = {},
) {
  if (
    typeof search !== "string" ||
    search.length > 100 ||
    !["nick", "level", "recommender"].includes(field) ||
    !Object.hasOwn(MEMBER_SORTS, sort)
  )
    invalid(ctx);
  const offset = offsetOf(ctx, after);
  const needle = search.trim().toLocaleLowerCase();
  // member_list.php's sfl: 닉네임·회원 번호, 권한 (mb_level, exactly) or 추천인.
  const where = !needle
    ? "1"
    : field === "level"
      ? "members.level = ?"
      : field === "recommender"
        ? "members.recommender IN (SELECT member FROM profiles WHERE instr(lower(nick), ?) > 0 LIMIT 100)"
        : "instr(lower(coalesce(profiles.nick, members.member || ' (닉네임 없음)') || ' ' || members.member), ?) > 0";
  if (field === "level" && needle && !/^(?:[1-9]|10)$/.test(needle))
    invalid(ctx);
  const { rows } = await ctx.sql(
    `SELECT members.*, profiles.nick, profiles.joined_at, presence.at AS last_seen,
       (SELECT nick FROM profiles AS named WHERE named.member = members.recommender) AS recommender_nick,
       (SELECT json_group_array(json_object('id', CAST(id AS TEXT), 'name', name))
        FROM (SELECT id, name FROM characters WHERE characters.owner = members.member
          AND state != 'deleted' ORDER BY id LIMIT 20)) AS characters
     FROM members
     LEFT JOIN profiles ON profiles.member = members.member
     LEFT JOIN presence ON presence.member = members.member
     WHERE ${where}
     ORDER BY ${MEMBER_SORTS[sort]}, members.member
     LIMIT ? OFFSET ?`,
    [
      ...(needle ? [field === "level" ? Number(needle) : needle] : []),
      PAGE + 1,
      offset,
    ],
  );
  const roles = await ctx.rolesOf(rows.map((row) => String(row.member)));
  const counts = await one<{ total: number; blocked: number; left: number }>(
    ctx,
    `SELECT count(*) AS total, coalesce(sum(blocked_on IS NOT NULL), 0) AS blocked,
       coalesce(sum(left_on IS NOT NULL), 0) AS left FROM members`,
  );
  return {
    ...pageOf(
      rows.map((row) => ({
        id: String(row.member),
        data: memberData(row, roles[String(row.member)] ?? []),
        nick: row.nick ?? null,
        lastSeen: row.last_seen ?? null,
        joinedAt: row.joined_at ?? null,
        ...(row.deleted_at !== null ? { deleted: true } : {}),
        ...(row.recommender_nick ? { recommender: row.recommender_nick } : {}),
        // 보유캐릭터 (member_list.php:175-190).
        characters: JSON.parse(String(row.characters ?? "[]")),
      })),
      offset,
    ),
    counts: {
      total: Number(counts.total),
      blocked: Number(counts.blocked),
      left: Number(counts.left),
    },
  };
});

export const get = ownerOnly(async function get(
  ctx: QueryCtx,
  { id }: { id?: string } = {},
) {
  if (typeof id !== "string") return null;
  const row = await one(ctx, `${MEMBER_SELECT} WHERE members.member = ?`, [id]);
  if (!row) return null;
  return { id, data: memberData(row, (await ctx.rolesOf([id]))[id] ?? []) };
});
