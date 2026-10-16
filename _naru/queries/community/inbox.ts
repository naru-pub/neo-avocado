// What the member's tabs and card say is new: unread 쪽지 (a gift's or
// money's note among them) and 알림 newer than they last looked. Pages
// subscribe to it, and Naru re-runs it whenever a mutation writes the
// tables it reads (messages, calls, profiles): a message arriving or read,
// a call, a gift, money sent, the calls seen.
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * { messages: how many are unread (outlogin.skin.2.php's $memo_not_read),
 * calls: whether any call or comment notice is new }, in one statement.
 * Nothing for a visitor or the owner.
 */
export async function status(ctx: QueryCtx) {
  if (!ctx.member) return { messages: 0, calls: false };
  const me = ctx.member.id;
  const { rows } = await ctx.sql<{ messages: number; calls: number }>`SELECT
    (SELECT count(*) FROM messages WHERE recipient = ${me}
      AND read_at IS NULL AND hidden_by_recipient = 0) AS messages,
    EXISTS (SELECT 1 FROM calls WHERE recipient = ${me}
      AND at > coalesce((SELECT calls_seen_at FROM profiles WHERE member = ${me}), 0))
      AS calls`;
  return { messages: rows[0].messages, calls: rows[0].calls !== 0 };
}
