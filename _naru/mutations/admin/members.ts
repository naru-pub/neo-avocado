// 회원 관리 (adm/member_form.php): the owner sets a member's level (1–10),
// 성인, warnings, leaving and blocking days and note, and their community
// role and board groups, which are Naru roles (staff, group-<id>); 활동량
// 관리 saves the warnings alone. Deleting a member's record takes those
// roles too; deleting the member (member_delete.php) takes their data.
import {
  TABLES,
  checked,
  conflict,
  invalid,
  memberData,
  rolesOfData,
  setRolesOf,
  writeRow,
} from "../../modules/admin.js";
import { kstDay, one, ownerOnly } from "../../modules/access.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const save = ownerOnly(async function save(
  ctx: MutationCtx,
  {
    id,
    values,
    create = false,
  }: { id?: string; values?: Record<string, unknown>; create?: boolean } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  const row = await one(ctx, "SELECT * FROM members WHERE member = ?", [id]);
  if (create ? row : !row) conflict(ctx);
  const roles = (await ctx.rolesOf([id]))[id] ?? [];
  // A new record starts from the role and groups the member already has.
  const record = await checked(ctx, "members", {
    id,
    values,
    current: { id, data: memberData(row, roles) },
  });
  await writeRow(ctx, TABLES.members, id, record.data);
  await setRolesOf(ctx, id, rolesOfData(record.data, roles));
  return { id, data: record.data };
});

export const remove = ownerOnly(async function remove(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  await ctx.sql`DELETE FROM members WHERE member = ${id}`;
  const roles = (await ctx.rolesOf([id]))[id] ?? [];
  await setRolesOf(ctx, id, rolesOfData({}, roles));
  return null;
});

/**
 * 회원 삭제 (adm/member_delete.php, lib/common.lib.php member_delete): the
 * member's nickname stays, kept so no one else takes it, and their record
 * says when they were deleted (mb_memo's "YYYYMMDD 삭제함") at level 1;
 * their 쪽지 either way, 관심로그, money history and balance, members-only
 * groups and staff role, and 게시판·그룹 관리자 go. Their posts, comments
 * and characters stay, as the original's do. Naru's account is the
 * member's own: the site cannot delete it, and from now on treats them as
 * a guest; banning them on Naru keeps them from signing in.
 */
export const deleteMember = ownerOnly(async function deleteMember(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  if (typeof id !== "string" || !id) invalid(ctx);
  const profile = await one<{ deleted_at: number | null }>(
    ctx,
    "SELECT deleted_at FROM profiles WHERE member = ?",
    [id],
  );
  const record = await one(ctx, "SELECT 1 FROM members WHERE member = ?", [id]);
  if (!profile && !record)
    ctx.fail("NOT_FOUND", "회원자료가 존재하지 않습니다.", {
      reason: "document_not_found",
    });
  // 이미 삭제된 회원은 제외.
  if (profile?.deleted_at) return { id, deleted: false };
  const day = kstDay(ctx.now).replace(/-/g, "");
  await ctx.sql`INSERT INTO members (member, level, note) VALUES (${id}, 1, ${`${day} 삭제함`})
    ON CONFLICT (member) DO UPDATE SET level = 1,
      note = ${`${day} 삭제함`} || CASE WHEN members.note = '' THEN '' ELSE char(10) || members.note END`;
  await ctx.sql`UPDATE profiles SET deleted_at = ${ctx.now}, main_character = NULL WHERE member = ${id}`;
  await ctx.sql`DELETE FROM history WHERE owner = ${id}`;
  await ctx.sql`DELETE FROM wallets WHERE member = ${id}`;
  await ctx.sql`DELETE FROM messages WHERE recipient = ${id}`;
  await ctx.sql`DELETE FROM messages WHERE sender = ${id}`;
  await ctx.sql`DELETE FROM favorites WHERE member = ${id}`;
  await ctx.sql`UPDATE board_groups SET admin = NULL WHERE admin = ${id}`;
  await ctx.sql`UPDATE boards SET admin = NULL WHERE admin = ${id}`;
  const roles = (await ctx.rolesOf([id]))[id] ?? [];
  await setRolesOf(ctx, id, rolesOfData({}, roles));
  return { id, deleted: true };
});
