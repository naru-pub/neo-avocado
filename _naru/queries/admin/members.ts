// 회원 관리 (adm/member_list.php): each member's level, role, warnings,
// leaving day and note, with their nickname and last visit, newest visit
// first, found by nickname or member number; and one member.
import {
  PAGE,
  TABLES,
  invalid,
  memberData,
  offsetOf,
  ownerOnly,
  pageOf,
} from "../../modules/admin.js";
import { one } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export async function list(
  ctx: QueryCtx,
  {
    search = "",
    after = null,
  }: { search?: string; after?: string | null } = {},
) {
  ownerOnly(ctx);
  if (typeof search !== "string" || search.length > 100) invalid(ctx);
  const offset = offsetOf(ctx, after);
  const needle = search.trim().toLocaleLowerCase();
  const { rows } = await ctx.sql(
    `SELECT members.*, profiles.nick, presence.at AS last_seen
     FROM members
     LEFT JOIN profiles ON profiles.member = members.member
     LEFT JOIN presence ON presence.member = members.member
     WHERE ? = '' OR instr(lower(coalesce(profiles.nick, members.member || ' (닉네임 없음)') || ' ' || members.member), ?) > 0
     ORDER BY presence.at IS NULL, presence.at DESC, members.member
     LIMIT ? OFFSET ?`,
    [needle, needle, PAGE + 1, offset],
  );
  const roles = await ctx.rolesOf(rows.map((row) => String(row.member)));
  return pageOf(
    rows.map((row) => ({
      id: String(row.member),
      data: memberData(row, roles[String(row.member)] ?? []),
      nick: row.nick ?? null,
      lastSeen: row.last_seen ?? null,
    })),
    offset,
  );
}

export async function get(ctx: QueryCtx, { id }: { id?: string } = {}) {
  ownerOnly(ctx);
  if (typeof id !== "string") return null;
  const row = await one(
    ctx,
    `SELECT * FROM ${TABLES.members.table} WHERE member = ?`,
    [id],
  );
  if (!row) return null;
  return { id, data: memberData(row, (await ctx.rolesOf([id]))[id] ?? []) };
}
