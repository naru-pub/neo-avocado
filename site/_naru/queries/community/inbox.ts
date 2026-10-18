// What the member's tabs and card say is new: unread 쪽지 (a gift's or
// money's note among them) and 알림 newer than they last looked, with the
// newest of each for the arrival popups (ajax/load_memo_call.php,
// load_board_call.php). Pages subscribe to it, and Naru re-runs it whenever
// a mutation writes the tables it reads (messages, calls, profiles): a
// message arriving or read, a call, a gift, money sent, the calls seen.
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * { messages: how many are unread (outlogin.skin.2.php's $memo_not_read),
 * calls: whether any call or comment notice is new, memo: the newest unread
 * 쪽지's id and its sender's nickname (mb_memo_call), call: the newest new
 * call's id, kind, the name it showed, its post and comment, and how many
 * are new (확인하지 않은 호출) }, in one statement. Nothing for a visitor or
 * the owner.
 */
export async function status(ctx: QueryCtx) {
  const none = { messages: 0, calls: false, memo: null, call: null };
  if (!ctx.member) return none;
  const me = ctx.member.id;
  const seen = `coalesce((SELECT calls_seen_at FROM profiles WHERE member = ${"?"}), 0)`;
  const { rows } = await ctx.sql<{
    messages: number;
    calls: number;
    memo: string | null;
    call: string | null;
  }>(
    `SELECT
      (SELECT count(*) FROM messages WHERE recipient = ?
        AND read_at IS NULL AND hidden_by_recipient = 0) AS messages,
      (SELECT count(*) FROM calls WHERE recipient = ? AND at > ${seen}) AS calls,
      (SELECT json_object('id', messages.id,
          'nick', (SELECT nick FROM profiles WHERE profiles.member = messages.sender))
        FROM messages WHERE recipient = ? AND read_at IS NULL AND hidden_by_recipient = 0
        ORDER BY sent_at DESC, id DESC LIMIT 1) AS memo,
      (SELECT json_object('id', calls.id, 'kind', calls.kind, 'nick', calls.nick,
          'post', calls.post_id, 'comment', calls.comment_id)
        FROM calls WHERE recipient = ? AND at > ${seen}
        ORDER BY id DESC LIMIT 1) AS call`,
    [me, me, me, me, me, me],
  );
  const [row] = rows;
  const memo = row.memo ? JSON.parse(row.memo) : null;
  const call = row.call ? JSON.parse(row.call) : null;
  return {
    messages: row.messages,
    calls: row.calls > 0,
    memo: memo && { id: String(memo.id), nick: memo.nick ?? "알 수 없는 회원" },
    call: call && {
      id: String(call.id),
      kind: call.kind,
      nick: call.nick || "이름 없음",
      post: String(call.post),
      comment: call.comment === null ? null : String(call.comment),
      count: row.calls,
    },
  };
}
