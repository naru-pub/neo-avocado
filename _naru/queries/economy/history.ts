// The member's own history: what moved their money, items or experience.
import { signedIn } from "../../modules/access.js";
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
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  return await historyPage(
    ctx,
    { owner: me, ...(kind ? { kind } : {}) },
    { size, after },
  );
}
