import {
  PREFIX,
  CALLS,
  PROFILES,
  communityAccess,
  logReadable,
} from "../../modules/shared.js";
import { callsUnread } from "../../modules/roleplay.js";

export const readOnly = ["callHistory"];

const LOGS = `${PREFIX}logs`;

/**
 * The member's calls ([[nick]]) and comment notices, newest first, as
 * ajax/board_call.php's alarm table. A post the member can no longer read
 * (deleted, made secret, or above their level) is left out.
 */
export async function callHistory(ctx, { after = null, size = 20 } = {}) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const profile = await ctx.get(PROFILES, ctx.member.id);
  const seen = Number.isFinite(profile?.data.callsSeenAt)
    ? profile.data.callsSeenAt
    : 0;
  const page = await ctx.list(CALLS, {
    filter: { to: ctx.member.id },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size,
    after,
  });
  const access = await communityAccess(ctx);
  const logs = new Map();
  const documents = [];
  for (const row of page.documents) {
    if (!logs.has(row.data.logId))
      logs.set(
        row.data.logId,
        typeof row.data.logId === "string"
          ? await ctx.get(LOGS, row.data.logId)
          : null,
      );
    if (!(await logReadable(ctx, logs.get(row.data.logId), access))) continue;
    documents.push({
      id: row.id,
      data: {
        kind: row.data.kind,
        from: row.data.from,
        nick: row.data.nick,
        speaker: row.data.speaker,
        board: row.data.board,
        logId: row.data.logId,
        commentId: row.data.commentId,
        preview: row.data.preview,
        at: row.data.at,
        unread: row.data.at > seen,
      },
    });
  }
  return {
    documents,
    nextCursor: page.nextCursor,
    unread: await callsUnread(ctx),
  };
}

/** Marks every call seen; the member's other tabs clear their notice too. */
export async function seeCalls(ctx) {
  const profile = await ctx.get(PROFILES, ctx.member.id);
  if (!profile)
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  await ctx.set(PROFILES, profile.id, {
    ...profile.data,
    callsSeenAt: ctx.now,
  });
  ctx.notify(ctx.member.id, { calls: false });
  return null;
}
