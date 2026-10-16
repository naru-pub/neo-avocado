// 알림: marking the member's calls and comment notices seen.
import { signedIn } from "../../modules/access.js";
import { profileOf } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * Marks every call seen (close_call.php); the member's other pages, which
 * subscribe to community/calls:unread, clear their notice too.
 */
export async function seeCalls(ctx: MutationCtx) {
  const member = signedIn(ctx);
  if (!(await profileOf(ctx, member)))
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  await ctx.sql`UPDATE profiles SET calls_seen_at = ${ctx.now} WHERE member = ${member}`;
  return null;
}
