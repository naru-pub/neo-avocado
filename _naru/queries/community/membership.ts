// The member's standing in the community, read as a page opens.
import { communityAccess, one, signedIn } from "../../modules/access.js";
import { profileOf } from "../../modules/members.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * The caller's level, role and groups, the owner's warnings (경고내역,
 * mypage/index.php), whether they are adult (mb_adult: 19금 posts show to
 * them uncovered, list.log.skin.php:133), and their profile, null before
 * they join.
 */
export async function membership(ctx: QueryCtx) {
  const member = signedIn(ctx);
  const access = await communityAccess(ctx);
  const record = await one<{
    warnings: number;
    warning_note: string;
    adult: number;
  }>(
    ctx,
    "SELECT warnings, warning_note, adult FROM members WHERE member = ?",
    [member],
  );
  return {
    ...access,
    warnings: record?.warnings ?? 0,
    warningNote: record?.warning_note ?? "",
    adult: record?.adult === 1,
    // The site owner signed in here answers as staff (Q&A answers).
    owner: ctx.owner === true,
    memberId: member,
    profile: await profileOf(ctx, member, { favorites: true }),
  };
}
