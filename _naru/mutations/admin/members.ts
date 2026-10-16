// 회원 관리 (adm/member_form.php): the owner sets a member's level (1–10),
// 성인, warnings, leaving day and note, and their community role and board
// groups, which are Naru roles (staff, group-<id>); 활동량 관리 saves the
// warnings alone. Deleting a member's record takes those roles too.
import {
  TABLES,
  checked,
  conflict,
  invalid,
  memberData,
  ownerOnly,
  rolesOfData,
  setRolesOf,
  writeRow,
} from "../../modules/admin.js";
import { one } from "../../modules/access.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export async function save(
  ctx: MutationCtx,
  {
    id,
    values,
    create = false,
  }: { id?: string; values?: Record<string, unknown>; create?: boolean } = {},
) {
  ownerOnly(ctx);
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
}

export async function remove(ctx: MutationCtx, { id }: { id?: string } = {}) {
  ownerOnly(ctx);
  if (typeof id !== "string" || !id) invalid(ctx);
  await ctx.sql`DELETE FROM members WHERE member = ${id}`;
  const roles = (await ctx.rolesOf([id]))[id] ?? [];
  await setRolesOf(ctx, id, rolesOfData({}, roles));
  return null;
}
