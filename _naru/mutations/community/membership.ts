// Joining and leaving the community (bbs/register_form_update.php,
// bbs/member_leave.php). Being a member of the Naru site is Naru's; this is
// the community's own record of them.
import {
  communityAccess,
  communityAmount,
  communitySettings,
  kstDay,
  one,
  reservedNick,
  signedIn,
  text,
} from "../../modules/access.js";
import {
  addHistory,
  nickTaken,
  profileOf,
  saveWallet,
  walletOf,
} from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * Joins the community with a nickname (bbs/register_form_update.php). Where
 * the owner has written 커뮤니티 활동 규칙 or 캐릭터 유의사항 (cf_stipulation,
 * cf_privacy), the member agrees to them first (register.skin.php), and the
 * member record keeps when. A reserved word (cf_prohibit_id) is no nickname.
 * Joining again changes the nickname and preferences.
 */
export async function join(
  ctx: MutationCtx,
  {
    nick,
    acceptMessages = true,
    commentAlerts = true,
    agreed = false,
  }: {
    nick?: string;
    acceptMessages?: boolean;
    commentAlerts?: boolean;
    agreed?: boolean;
  } = {},
) {
  const member = signedIn(ctx);
  const access = await communityAccess(ctx);
  if (access.left)
    ctx.fail("ACCESS_DENIED", "탈퇴한 회원입니다. 운영자에게 문의해 주세요.", {
      reason: "left",
    });
  const name = text(nick, 20, true);
  if (await reservedNick(ctx, name))
    ctx.fail(
      "INVALID_REQUEST",
      "이미 예약된 단어로 사용할 수 없는 닉네임입니다.",
      { reason: "reserved_nick" },
    );
  await nickTaken(ctx, name, member);
  const settings = await communitySettings(ctx);
  const rules = [settings.stipulation, settings.characterNotice].some(
    (value) => typeof value === "string" && value.trim(),
  );
  if (rules && agreed !== true)
    ctx.fail("INVALID_REQUEST", "커뮤니티 규칙에 동의해 주세요.", {
      reason: "not_agreed",
    });
  const joined = !(await one(ctx, "SELECT 1 FROM profiles WHERE member = ?", [
    member,
  ]));
  await ctx.sql`
    INSERT INTO profiles (member, nick, accept_messages, comment_alerts)
    VALUES (${member}, ${name}, ${acceptMessages !== false}, ${commentAlerts !== false})
    ON CONFLICT (member) DO UPDATE SET nick = excluded.nick,
      accept_messages = excluded.accept_messages,
      comment_alerts = excluded.comment_alerts`;
  if (!(await one(ctx, "SELECT 1 FROM members WHERE member = ?", [member])))
    await ctx.sql`INSERT INTO members (member, requested_at, agreed_at) VALUES (${member}, ${ctx.now}, ${rules ? ctx.now : null})`;
  else if (rules)
    await ctx.sql`UPDATE members SET agreed_at = ${ctx.now} WHERE member = ${member}`;
  // 회원가입 포인트 (bbs/register_form_update.php:245, cf_register_point):
  // paid once, on joining; changing the nickname later pays nothing.
  if (joined) {
    const reward = await communityAmount(ctx, "signupReward");
    if (reward) {
      const balance = (await walletOf(ctx, member)).balance + reward;
      await saveWallet(ctx, member, balance);
      await addHistory(ctx, {
        owner: member,
        kind: "signup",
        at: ctx.now,
        delta: reward,
        balance,
        memo: "회원가입 축하",
      });
    }
  }
  return {
    profile: await profileOf(ctx, member, { favorites: true }),
    ...access,
  };
}

/**
 * Leaves the community (bbs/member_leave.php): the member's record keeps the
 * date, and they are a guest from then on; their posts and characters stay.
 * The owner clears the date to let them back. Leaving the Naru site itself is
 * Naru's, under the site's members.
 */
export async function leave(
  ctx: MutationCtx,
  { confirm }: { confirm?: boolean } = {},
) {
  const member = signedIn(ctx);
  if (confirm !== true)
    ctx.fail("INVALID_REQUEST", "탈퇴를 확인해 주세요.", {
      reason: "invalid_input",
    });
  const row = await one<{ left_on: string | null }>(
    ctx,
    "SELECT left_on FROM members WHERE member = ?",
    [member],
  );
  if (row?.left_on)
    ctx.fail("CONFLICT", "이미 탈퇴했습니다.", { reason: "left" });
  await ctx.sql`
    INSERT INTO members (member, left_on) VALUES (${member}, ${kstDay(ctx.now)})
    ON CONFLICT (member) DO UPDATE SET left_on = excluded.left_on`;
  return { left: true };
}
