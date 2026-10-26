// 게시판 그룹's 접근회원 (adm/boardgroupmember_update.php); saving and deleting
// a group are admin/records'.
import { invalid, setRolesOf } from "../../modules/admin.js";
import { GROUP_ROLE, one, ownerOnly, rolesOf } from "../../modules/access.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * boardgroupmember_update.php: gives a member, named by nickname, the
 * group's access (the role group-<id>), or with `remove` takes it; the
 * member's other roles stay.
 */
export const setMember = ownerOnly(async function setMember(
  ctx: MutationCtx,
  {
    group,
    nick,
    remove = false,
  }: { group?: string; nick?: string; remove?: boolean } = {},
) {
  if (
    typeof group !== "string" ||
    typeof nick !== "string" ||
    !nick.trim() ||
    typeof remove !== "boolean"
  )
    invalid(ctx);
  if (!(await one(ctx, "SELECT 1 FROM board_groups WHERE id = ?", [group])))
    ctx.fail("NOT_FOUND", "존재하지 않는 그룹입니다.", {
      reason: "document_not_found",
    });
  const member = await one<{ member: string }>(
    ctx,
    "SELECT member FROM profiles WHERE nick = ? AND deleted_at IS NULL",
    [nick.trim()],
  );
  if (!member)
    ctx.fail("NOT_FOUND", "존재하지 않는 회원입니다.", {
      reason: "no_member",
    });
  const role = `${GROUP_ROLE}${group}`;
  const roles = (await rolesOf(ctx, member.member))
    .filter((name) => name !== role)
    .concat(remove ? [] : [role])
    .sort();
  await setRolesOf(ctx, member.member, roles);
  return { id: member.member, nick: nick.trim(), member: !remove };
});
