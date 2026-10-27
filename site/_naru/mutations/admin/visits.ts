// 접속자 집계: the owner deletes the days kept from before one.

import { ownerOnly } from "../../modules/access.js";
import { invalid } from "../../modules/admin.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/** Deletes every day before `before` (YYYY-MM-DD); answers how many. */
export const prune = ownerOnly(async function prune(
  ctx: MutationCtx,
  { before }: { before?: string } = {},
) {
  if (typeof before !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(before))
    invalid(ctx);
  const { changes } = await ctx.sql`DELETE FROM visits WHERE day < ${before}`;
  return { deleted: changes };
});
