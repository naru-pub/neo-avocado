// 게시판 그룹 (adm/boardgroup_list.php): the owner's list, a page at a time, and one entry.
import { getRecord, invalid, listRecords } from "../../modules/admin.js";
import { GROUP_ROLE, ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(
  (ctx: QueryCtx, args: { after?: string | null }) =>
    listRecords(ctx, "board_groups", args),
);

export const get = ownerOnly((ctx: QueryCtx, args: { id?: string }) =>
  getRecord(ctx, "board_groups", args),
);

/** Members a call looks through for a group's: five rolesOf calls. */
const SCAN = 500;

/**
 * 접근회원 (adm/boardgroupmember_list.php): the members holding the group's
 * role (group-<id>), with their nicknames, by member ID. Naru tells the roles
 * of members a site names, so the call looks through 500 of them after
 * `after` and answers those it found and where to go on (null at the end).
 */
export const members = ownerOnly(async function members(
  ctx: QueryCtx,
  { group, after = "" }: { group?: string; after?: string | null } = {},
) {
  if (
    typeof group !== "string" ||
    !group ||
    (after !== null && typeof after !== "string")
  )
    invalid(ctx);
  const { rows } = await ctx.sql<{ member: string; nick: string }>`
    SELECT member, nick FROM profiles
    WHERE member > ${after ?? ""} AND deleted_at IS NULL
    ORDER BY member LIMIT ${SCAN + 1}`;
  const scanned = rows.slice(0, SCAN);
  const role = `${GROUP_ROLE}${group}`;
  const found = [];
  for (let start = 0; start < scanned.length; start += 100) {
    const batch = scanned.slice(start, start + 100);
    const roles = await ctx.rolesOf(batch.map((row) => row.member));
    for (const row of batch)
      if ((roles[row.member] ?? []).includes(role))
        found.push({ id: row.member, nick: row.nick });
  }
  return {
    members: found,
    nextCursor: rows.length > SCAN ? scanned.at(-1).member : null,
  };
});
