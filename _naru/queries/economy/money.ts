// 화폐관리 (mypage/money/): the member's own money ledger.
import { signedIn } from "../../modules/access.js";
import { historyPage } from "../../modules/members.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * The member's money ledger (mypage/money/index.php): what came in and what
 * went out, newest first, 20 a page.
 */
export async function ledger(
  ctx: QueryCtx,
  args: { after?: string | null; size?: number } | null,
) {
  const me = signedIn(ctx);
  const { after = null, size = 20 } = args ?? {};
  if (
    (after !== null && typeof after !== "string") ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  return await historyPage(ctx, { owner: me }, { size, after, money: true });
}
