// Joining and leaving the community (bbs/register_form_update.php,
// bbs/member_leave.php). Being a member of the Naru site is Naru's; this is
// the community's own record of them.
import {
  activeMember,
  amountOf,
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
  nickValid,
  profileByNick,
  profileOf,
  saveWallet,
  walletOf,
} from "../../modules/members.js";
import { birthYearValid } from "../../modules/members.js";
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
    recommender: recommended = "",
    birthYear,
  }: {
    /** 출생년도 (mb_birth), which a member may leave out. */
    birthYear?: number | null;
    nick?: string;
    acceptMessages?: boolean;
    commentAlerts?: boolean;
    agreed?: boolean;
    /** 추천인: a member's nickname, while 추천인제도 사용 is on. */
    recommender?: string;
  } = {},
) {
  const member = await activeMember(ctx);
  const name = text(nick, 20, true);
  if (!nickValid(name))
    ctx.fail(
      "INVALID_REQUEST",
      "닉네임은 공백없이 한글, 영문, 숫자만 입력 가능합니다.",
      { reason: "invalid_nick" },
    );
  if (!birthYearValid(birthYear))
    ctx.fail("INVALID_REQUEST", "출생년도를 확인해 주세요.", {
      reason: "invalid_input",
    });
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
  // 추천인 (register_form_update.php:129-135): a member who exists, not
  // oneself; named once, on joining.
  let recommender: string | null = null;
  if (joined && settings.useRecommend === true && recommended) {
    const named =
      typeof recommended === "string" && recommended.length <= 20
        ? await profileByNick(ctx, recommended.trim())
        : null;
    if (!named || named.data.deleted)
      ctx.fail("INVALID_REQUEST", "추천인으로 입력하신 회원이 없습니다.", {
        reason: "no_recommender",
      });
    if (named.id === member)
      ctx.fail("INVALID_REQUEST", "본인을 추천할 수 없습니다.", {
        reason: "self_recommend",
      });
    recommender = named.id;
  }
  await ctx.sql`
    INSERT INTO profiles (member, nick, joined_at, accept_messages, comment_alerts, birth_year)
    VALUES (${member}, ${name}, ${ctx.now}, ${acceptMessages !== false}, ${commentAlerts !== false}, ${birthYear ?? null})
    ON CONFLICT (member) DO UPDATE SET nick = excluded.nick,
      birth_year = coalesce(excluded.birth_year, profiles.birth_year),
      accept_messages = excluded.accept_messages,
      comment_alerts = excluded.comment_alerts`;
  if (!(await one(ctx, "SELECT 1 FROM members WHERE member = ?", [member]))) {
    // 회원가입시 권한 (cf_register_level, register_form_update.php:219).
    const level = Number(settings.registerLevel ?? 2);
    await ctx.sql`INSERT INTO members (member, level, requested_at, agreed_at, recommender) VALUES (${member}, ${Number.isInteger(level) && level >= 1 && level <= 9 ? level : 2}, ${ctx.now}, ${rules ? ctx.now : null}, ${recommender})`;
  } else if (recommender)
    await ctx.sql`UPDATE members SET recommender = ${recommender} WHERE member = ${member}`;
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
    // The recommender's 추천인 포인트 (register_form_update.php:248).
    const points = recommender ? amountOf(settings, "recommendReward") : 0;
    if (points) {
      const balance = (await walletOf(ctx, recommender)).balance + points;
      await saveWallet(ctx, recommender, balance);
      await addHistory(ctx, {
        owner: recommender,
        kind: "recommend",
        at: ctx.now,
        delta: points,
        balance,
        memo: `${name}의 추천인`,
      });
    }
  }
  return {
    profile: await profileOf(ctx, member, { favorites: true }),
    ...(await communityAccess(ctx)),
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
