// 게시판 그룹's 접근회원 (adm/boardgroupmember_list.php); the groups' list and
// one group are admin/records'.
import { invalid } from "../../modules/admin.js";
import { GROUP_ROLE, ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** Members a page of 접근회원 lists. */
const PAGE = 100;

/**
 * 접근회원 (adm/boardgroupmember_list.php): the members holding the group's
 * role (group-<id>), with their nicknames, by member ID: a page after
 * `after`, and where to go on (null at the end).
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
  const { rows } = await ctx.sql<{ id: string; nick: string }>`
    SELECT roles.member AS id, profiles.nick
    FROM member_roles AS roles
    JOIN profiles ON profiles.member = roles.member
    WHERE roles.role = ${`${GROUP_ROLE}${group}`} AND roles.member > ${after ?? ""}
      AND profiles.deleted_at IS NULL
    ORDER BY roles.member LIMIT ${PAGE + 1}`;
  const members = rows.slice(0, PAGE);
  return {
    members,
    nextCursor: rows.length > PAGE ? members.at(-1).id : null,
  };
});
