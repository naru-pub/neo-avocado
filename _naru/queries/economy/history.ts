// The member's own history: what moved their money, items or experience.
import { signedIn, invalid } from "../../modules/access.js";
import { historyPage } from "../../modules/members.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * The member's own history, newest first: purchases, gifts, crafting and the
 * owner's adjustments, or only one `kind` of it (`exp`: experience changes).
 */
export async function history(
  ctx: QueryCtx,
  args: { after?: string | null; size?: number; kind?: string | null } | null,
) {
  const me = signedIn(ctx);
  const { after = null, size = 20, kind = null } = args ?? {};
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string") ||
    (kind !== null && (typeof kind !== "string" || kind.length > 20))
  )
    invalid(ctx);
  return await historyPage(
    ctx,
    { owner: me, ...(kind ? { kind } : {}) },
    { size, after },
  );
}
