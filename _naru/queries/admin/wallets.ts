// 회원 잔액 (adm/point_list.php's balances): each member's money and the day
// of their last login reward, by member, with their nickname; and one.
import {
  PAGE,
  TABLES,
  getRecord,
  offsetOf,
  pageOf,
  recordOf,
} from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  { after = null }: { after?: string | null } = {},
) {
  const offset = offsetOf(ctx, after);
  const { rows } = await ctx.sql(
    `SELECT wallets.*, profiles.nick FROM wallets
     LEFT JOIN profiles ON profiles.member = wallets.member
     ORDER BY wallets.member LIMIT ? OFFSET ?`,
    [PAGE + 1, offset],
  );
  return pageOf(
    rows.map((row) => ({ ...recordOf(TABLES.wallets, row), label: row.nick })),
    offset,
  );
});

export const get = ownerOnly((ctx: QueryCtx, args: { id?: string }) =>
  getRecord(ctx, "wallets", args),
);
