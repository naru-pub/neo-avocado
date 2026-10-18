// 설문조사 (bbs/poll_update.php, poll_etc_update.php): a member's one vote,
// paid the poll's 포인트, and 기타의견 written and removed.
import {
  communityAccess,
  names,
  one,
  signedIn,
  text,
} from "../../modules/access.js";
import { addHistory, saveWallet, walletOf } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

async function pollOf(ctx: MutationCtx, id: unknown) {
  const poll =
    typeof id === "string"
      ? await one<{
          id: string;
          subject: string;
          options: string;
          level: number;
          point: number;
          etc: string;
        }>(ctx, "SELECT * FROM polls WHERE id = ? AND enabled != 0", [id])
      : null;
  if (!poll)
    ctx.fail("NOT_FOUND", "설문조사가 없습니다.", { reason: "no_poll" });
  return poll;
}

export async function vote(
  ctx: MutationCtx,
  { id, choice }: { id?: string; choice?: number } = {},
) {
  const me = signedIn(ctx);
  const poll = await pollOf(ctx, id);
  const access = await communityAccess(ctx);
  if (access.level < poll.level)
    ctx.fail(
      "ACCESS_DENIED",
      `권한 ${poll.level} 이상 회원만 투표에 참여하실 수 있습니다.`,
      { reason: "poll_level" },
    );
  const answers = poll.options.split("\n").filter(Boolean);
  if (!Number.isInteger(choice) || choice < 1 || choice > answers.length)
    ctx.fail("INVALID_REQUEST", "항목을 선택하세요.", {
      reason: "invalid_input",
    });
  if (
    await one(
      ctx,
      "SELECT 1 FROM poll_votes WHERE poll_id = ? AND member = ?",
      [poll.id, me],
    )
  )
    ctx.fail("CONFLICT", `${poll.subject}에 이미 참여하셨습니다.`, {
      reason: "voted",
    });
  await ctx.sql`INSERT INTO poll_votes (poll_id, member, choice)
    VALUES (${poll.id}, ${me}, ${choice})`;
  // insert_point(…, '@poll', po_id, '투표') (poll_update.php:57).
  if (poll.point > 0) {
    const balance = (await walletOf(ctx, me)).balance + poll.point;
    await saveWallet(ctx, me, balance);
    await addHistory(ctx, {
      owner: me,
      kind: "poll",
      at: ctx.now,
      delta: poll.point,
      balance,
      memo: `${poll.id}. ${poll.subject.slice(0, 20)} 투표 참여`,
    });
  }
  return { voted: choice, moneyName: (await names(ctx)).moneyName };
}

/** 기타의견 (poll_etc_update.php): a member's word on a poll that asks one. */
export async function comment(
  ctx: MutationCtx,
  { id, idea }: { id?: string; idea?: string } = {},
) {
  const me = signedIn(ctx);
  const poll = await pollOf(ctx, id);
  if (!poll.etc)
    ctx.fail("INVALID_REQUEST", "기타의견을 받지 않는 설문입니다.", {
      reason: "no_etc",
    });
  const words = text(idea, 255, true);
  await ctx.sql`INSERT INTO poll_comments (poll_id, member, idea, created_at)
    VALUES (${poll.id}, ${me}, ${words}, ${ctx.now})`;
  return { done: true };
}

/** A 기타의견's writer, or the owner, removes it. */
export async function removeComment(
  ctx: MutationCtx,
  { id }: { id?: string } = {},
) {
  const key = Number(id);
  const row = Number.isSafeInteger(key)
    ? await one<{ member: string }>(
        ctx,
        "SELECT member FROM poll_comments WHERE id = ?",
        [key],
      )
    : null;
  if (!row || (!ctx.owner && row.member !== ctx.member?.id))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  await ctx.sql`DELETE FROM poll_comments WHERE id = ${key}`;
  return { done: true };
}
