import {
  PROFILES,
  MEMBERS,
  SETTINGS,
  communityAccess,
  kstDay,
  reservedNick,
  text,
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

/**
 * Joins the community with a nickname (bbs/register_form_update.php). Where
 * the owner has written 커뮤니티 활동 규칙 or 캐릭터 유의사항 (cf_stipulation,
 * cf_privacy), the member agrees to them first (register.skin.php), and the
 * member record keeps when. A reserved word (cf_prohibit_id) is no nickname.
 */
export async function join(
  ctx: Ctx,
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
  const settings = (await ctx.get(SETTINGS, "community"))?.data ?? {};
  const rules = [settings.stipulation, settings.characterNotice].some(
    (value) => typeof value === "string" && value.trim(),
  );
  if (rules && agreed !== true)
    ctx.fail("INVALID_REQUEST", "커뮤니티 규칙에 동의해 주세요.", {
      reason: "not_agreed",
    });
  const old = await ctx.get(PROFILES, ctx.member.id);
  const profile = await ctx.set(PROFILES, ctx.member.id, {
    ...old?.data,
    owner: ctx.member.id,
    nick: name,
    acceptMessages: acceptMessages !== false,
    commentAlerts: commentAlerts !== false,
  });
  const record = await ctx.get(MEMBERS, ctx.member.id);
  if (!record || rules)
    await ctx.set(MEMBERS, ctx.member.id, {
      ...(record?.data ?? { role: "member", requestedAt: ctx.now }),
      ...(rules ? { agreedAt: ctx.now } : {}),
    });
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
