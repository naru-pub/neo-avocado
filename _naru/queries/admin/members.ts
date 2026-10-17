// 회원 관리 (adm/member_list.php): each member's level, role, warnings,
// leaving and blocking days and note, with their nickname and last visit,
// newest visit first, found by nickname or member number, and how many
// there are, blocked and left (총회원수, 차단, 탈퇴); and one member.
import {
  PAGE,
  TABLES,
  invalid,
  memberData,
  offsetOf,
  pageOf,
} from "../../modules/admin.js";
import { one, ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    search = "",
    after = null,
  }: { search?: string; after?: string | null } = {},
) {
  if (typeof search !== "string" || search.length > 100) invalid(ctx);
  const offset = offsetOf(ctx, after);
  const needle = search.trim().toLocaleLowerCase();
  const { rows } = await ctx.sql(
    `SELECT members.*, profiles.nick, profiles.deleted_at, presence.at AS last_seen,
       (SELECT nick FROM profiles AS named WHERE named.member = members.recommender) AS recommender_nick
     FROM members
     LEFT JOIN profiles ON profiles.member = members.member
     LEFT JOIN presence ON presence.member = members.member
     WHERE ? = '' OR instr(lower(coalesce(profiles.nick, members.member || ' (닉네임 없음)') || ' ' || members.member), ?) > 0
     ORDER BY presence.at IS NULL, presence.at DESC, members.member
     LIMIT ? OFFSET ?`,
    [needle, needle, PAGE + 1, offset],
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
        ...(row.deleted_at !== null ? { deleted: true } : {}),
        ...(row.recommender_nick ? { recommender: row.recommender_nick } : {}),
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
  const row = await one(
    ctx,
    `SELECT * FROM ${TABLES.members.table} WHERE member = ?`,
    [id],
  );
  if (!row) return null;
  return { id, data: memberData(row, (await ctx.rolesOf([id]))[id] ?? []) };
});
