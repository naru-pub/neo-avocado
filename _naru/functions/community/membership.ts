import {
  PROFILES,
  MEMBERS,
  communityAccess,
  communityAmount,
  kstDay,
  pay,
  record,
  text,
  wallet,
} from "../../modules/shared.js";
import type { Ctx } from "../../modules/naru-types.js";

export const readOnly = ["membership"];

export async function membership(ctx: Ctx) {
  const access = await communityAccess(ctx);
  // 경고내역 (mypage/index.php): the member sees the owner's warnings.
  const record = await ctx.get(MEMBERS, ctx.member.id);
  return {
    ...access,
    warnings: Number.isSafeInteger(record?.data.warnings)
      ? record.data.warnings
      : 0,
    warningNote:
      typeof record?.data.warningNote === "string"
        ? record.data.warningNote
        : "",
    // The site owner signed in here answers as staff (Q&A answers).
    owner: ctx.owner === true,
    memberId: ctx.member.id,
    profile: await ctx.get(PROFILES, ctx.member.id),
  };
}

export async function join(
  ctx: Ctx,
  {
    nick,
    acceptMessages = true,
    commentAlerts = true,
  }: { nick?: string; acceptMessages?: boolean; commentAlerts?: boolean } = {},
) {
  const access = await communityAccess(ctx);
  if (access.left)
    ctx.fail("ACCESS_DENIED", "탈퇴한 회원입니다. 운영자에게 문의해 주세요.", {
      reason: "left",
    });
  const old = await ctx.get(PROFILES, ctx.member.id);
  const profile = await ctx.set(PROFILES, ctx.member.id, {
    ...old?.data,
    owner: ctx.member.id,
    nick: text(nick, 20, true),
    acceptMessages: acceptMessages !== false,
    commentAlerts: commentAlerts !== false,
  });
  if (!(await ctx.get(MEMBERS, ctx.member.id)))
    await ctx.set(MEMBERS, ctx.member.id, {
      role: "member",
      requestedAt: ctx.now,
    });
  // 회원가입 포인트 (bbs/register_form_update.php:245, cf_register_point):
  // paid once, on joining; changing the nickname later pays nothing.
  if (!old) {
    const reward = await communityAmount(ctx, "signupReward");
    if (reward) {
      const balance = await pay(ctx, await wallet(ctx), -reward);
      await record(ctx, "signup", {
        delta: reward,
        balance,
        memo: "회원가입 축하",
      });
    }
  }
  return { profile, ...access };
}

/**
 * Leaves the community (bbs/member_leave.php): the member's record keeps the
 * date, and they are a guest from then on; their posts and characters stay.
 * The owner clears the date to let them back. Leaving the Naru site itself is
 * Naru's, under the site's members.
 */
export async function leave(ctx: Ctx, { confirm }: { confirm?: boolean } = {}) {
  if (confirm !== true)
    ctx.fail("INVALID_REQUEST", "탈퇴를 확인해 주세요.", {
      reason: "invalid_input",
    });
  const row = await ctx.get(MEMBERS, ctx.member.id);
  if (row?.data.left)
    ctx.fail("CONFLICT", "이미 탈퇴했습니다.", { reason: "left" });
  await ctx.set(MEMBERS, ctx.member.id, {
    role: "member",
    ...row?.data,
    left: kstDay(ctx.now),
  });
  return { left: true };
}
