// Mail's rows (migrations/0005_mail.sql): a message as pages know it, the
// one a member may see, and the notes a gift or money sent tells its
// recipient of, written in the same transaction as what they tell.

import type { SqlCtx } from "./access.js";
import { one, signedIn } from "./access.js";
import { rowKey } from "./boards.js";
import type { QueryCtx } from "./naru-types.js";
import { type PushCtx, push } from "./push.js";

export interface MessageRow {
  id: number;
  sender: string;
  recipient: string;
  body: string;
  sent_at: number;
  read_at: number | null;
  hidden_by_sender: number;
  hidden_by_recipient: number;
  gift: string | null;
}

/** A message as pages read it: { id, data: { from, to, body, sentAt, readAt } }. */
export function messageOf(row: MessageRow) {
  return {
    id: String(row.id),
    data: {
      from: row.sender,
      to: row.recipient,
      body: row.body,
      sentAt: row.sent_at,
      readAt: row.read_at,
      ...(row.gift !== null ? { gift: true } : {}),
    },
  };
}

/**
 * A message the member sent or received and has not removed from their own
 * box, or a refusal.
 */
export async function ownMessage(
  ctx: SqlCtx & Pick<QueryCtx, "fail">,
  id: unknown,
): Promise<MessageRow> {
  const key = rowKey(id);
  const me = signedIn(ctx);
  const row =
    key === null
      ? null
      : await one<MessageRow>(ctx, "SELECT * FROM messages WHERE id = ?", [
          key,
        ]);
  if (
    !row ||
    !(
      (row.sender === me && row.hidden_by_sender === 0) ||
      (row.recipient === me && row.hidden_by_recipient === 0)
    )
  )
    ctx.fail("NOT_FOUND", "쪽지가 없거나 읽을 권한이 없습니다.", {
      reason: "message_not_found",
    });
  return row;
}

/** How many messages the member has not read (outlogin.skin.2.php's $memo_not_read). */
export async function unreadMessages(ctx: SqlCtx, member: string) {
  return (
    (await one<{ n: number }>(
      ctx,
      `SELECT count(*) AS n FROM messages
       WHERE recipient = ? AND read_at IS NULL AND hidden_by_recipient = 0`,
      [member],
    )) ?? { n: 0 }
  ).n;
}

/**
 * The 쪽지 a gift or money sent tells `to` of (send_memo), from the caller,
 * in the same transaction: `gift` says what it was for. It is no 쪽지 of
 * the sender's daily limit.
 */
export async function sendNote(
  ctx: SqlCtx & PushCtx & { readonly now: number },
  to: string,
  body: string,
  gift: Record<string, string | number>,
) {
  const { rows } = await ctx.sql<{
    id: number;
  }>`INSERT INTO messages (sender, recipient, body, sent_at, gift)
    VALUES (${signedIn(ctx)}, ${to}, ${body}, ${ctx.now}, ${JSON.stringify(gift)}) RETURNING id`;
  await push(ctx, [to], {
    title: "쪽지가 도착했습니다",
    body,
    path: `/messages/${rows[0].id}`,
  });
}
