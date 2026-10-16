// 회원 잔액: the owner sets a member's balance with a reason, which their
// history keeps as an adjustment (adm/point_list.php), both in this one
// call. Balances are never deleted.
import {
  TABLES,
  checked,
  conflict,
  invalid,
  ownerOnly,
  recordOf,
  writeRow,
} from "../../modules/admin.js";
import { one } from "../../modules/access.js";
import { addHistory } from "../../modules/members.js";
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
  const row = await one(ctx, "SELECT * FROM wallets WHERE member = ?", [id]);
  if (create ? row : !row) conflict(ctx);
  const record = await checked(ctx, "wallets", {
    id,
    values,
    current: row ? recordOf(TABLES.wallets, row) : null,
  });
  const before = Number(row?.balance ?? 0);
  const saved = await writeRow(ctx, TABLES.wallets, id, record.data);
  await addHistory(ctx, {
    owner: id,
    kind: "adjust",
    at: ctx.now,
    delta: record.data.balance - before,
    balance: record.data.balance,
    memo: String((values as Record<string, unknown>).note ?? "").trim(),
    actor: "site-owner",
  });
  return recordOf(TABLES.wallets, saved);
}
