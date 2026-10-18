// A member changes their own nickname and preferences (프로필 수정); the
// rest of the profile is kept by the community's own code.
import { reservedNick, signedIn, invalid } from "../../modules/access.js";
import { birthYearValid, nickTaken, profileOf } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export async function update(
  ctx: MutationCtx,
  {
    nick,
    acceptMessages,
    commentAlerts,
    birthYear,
  }: {
    nick?: string;
    acceptMessages?: boolean;
    commentAlerts?: boolean;
    birthYear?: number | null;
  } = {},
) {
  const member = signedIn(ctx);
  const before = await profileOf(ctx, member);
  if (!before || before.data.deleted)
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  if (
    typeof nick !== "string" ||
    !nick ||
    nick !== nick.trim() ||
    nick.length > 20 ||
    typeof acceptMessages !== "boolean" ||
    typeof commentAlerts !== "boolean" ||
    !birthYearValid(birthYear)
  )
    invalid(ctx);
  // A new nickname may not be a reserved word (cf_prohibit_id); one taken
  // before the owner reserved it may stay.
  if (nick !== before.data.nick) {
    if (await reservedNick(ctx, nick))
      ctx.fail(
        "INVALID_REQUEST",
        "이미 예약된 단어로 사용할 수 없는 닉네임입니다.",
        { reason: "reserved_nick" },
      );
    await nickTaken(ctx, nick, member);
  }
  await ctx.sql`
    UPDATE profiles SET nick = ${nick}, accept_messages = ${acceptMessages},
      comment_alerts = ${commentAlerts},
      birth_year = ${birthYear === undefined ? (before.data.birthYear ?? null) : birthYear}
    WHERE member = ${member}`;
  return { profile: await profileOf(ctx, member, { favorites: true }) };
}
