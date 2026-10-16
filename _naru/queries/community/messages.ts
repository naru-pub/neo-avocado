// 쪽지함 (mypage/memo/index.php) and a conversation (memo_view.php): the
// member's own mail, as each side's box shows it.
import { signedIn } from "../../modules/access.js";
import { messageOf } from "../../modules/mail.js";
import type { MessageRow } from "../../modules/mail.js";
import { rowKey } from "../../modules/boards.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** Correspondents a 쪽지함 page shows. */
const BOX_PAGE = 5;
/** Messages a conversation shows at a time, newest first. */
const THREAD_PAGE = 50;

const invalid = (ctx: QueryCtx) =>
  ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });

/**
 * Every message in the member's two boxes, as (id, partner, unread): what
 * they sent and what they received, less what they removed.
 */
const CORRESPONDENCE = `WITH box AS (
  SELECT id, recipient AS partner, 0 AS unread FROM messages
  WHERE sender = ? AND hidden_by_sender = 0
  UNION ALL
  SELECT id, sender AS partner, read_at IS NULL AS unread FROM messages
  WHERE recipient = ? AND hidden_by_recipient = 0
)`;

/**
 * 쪽지함 as the original's: one entry a member the member has written with,
 * newest first: their last message, how many, and whether one is unread.
 * Five a page, grouped in SQL over the whole of both boxes.
 */
export async function conversations(ctx: QueryCtx, args: { page?: number }) {
  const me = signedIn(ctx);
  const { page = 1 } = args ?? {};
  if (!Number.isInteger(page) || page < 1 || page > 10_000) invalid(ctx);
  const { rows } = await ctx.sql<{
    partner: string;
    count: number;
    unread: number;
    last: number;
    total: number;
  }>(
    `${CORRESPONDENCE}
    SELECT partner, count(*) AS count, max(unread) AS unread, max(id) AS last,
      count(*) OVER () AS total
    FROM box GROUP BY partner ORDER BY last DESC LIMIT ? OFFSET ?`,
    [me, me, BOX_PAGE, (page - 1) * BOX_PAGE],
  );
  // Past the last page: how many there are, all the same.
  const total = rows.length
    ? rows[0].total
    : (
        await ctx.sql<{ n: number }>(
          `${CORRESPONDENCE} SELECT count(DISTINCT partner) AS n FROM box`,
          [me, me],
        )
      ).rows[0].n;
  const last = new Map(
    (rows.length
      ? (
          await ctx.sql<{
            id: number;
            sender: string;
            preview: string;
            sent_at: number;
          }>(
            `SELECT id, sender, substr(body, 1, 150) AS preview, sent_at
             FROM messages WHERE id IN (${rows.map(() => "?").join(", ")})`,
            rows.map((row) => row.last),
          )
        ).rows
      : []
    ).map((row) => [row.id, row]),
  );
  return {
    total,
    documents: rows.map((row) => {
      const message = last.get(row.last);
      return {
        partner: row.partner,
        last: {
          id: String(row.last),
          preview: message.preview,
          sentAt: message.sent_at,
          mine: message.sender === me,
        },
        count: row.count,
        unread: row.unread !== 0,
      };
    }),
  };
}

/**
 * The messages between the member and one other, oldest first: the newest
 * 50, or with `before` (the oldest one's ID) the 50 before those. `unread`
 * says how many the other sent the member has not read, on any page; the
 * page then reads them (community/messages:readConversation).
 */
export async function conversation(
  ctx: QueryCtx,
  args: { partner?: string; before?: string | null },
) {
  const me = signedIn(ctx);
  const { partner, before = null } = args ?? {};
  const cursor = before === null ? null : rowKey(before);
  if (
    typeof partner !== "string" ||
    partner === me ||
    (before !== null && cursor === null)
  )
    invalid(ctx);
  const { rows } = await ctx.sql<MessageRow>(
    `SELECT * FROM messages WHERE id < ? AND (
       (sender = ? AND recipient = ? AND hidden_by_sender = 0) OR
       (sender = ? AND recipient = ? AND hidden_by_recipient = 0))
     ORDER BY id DESC LIMIT ?`,
    [
      cursor ?? Number.MAX_SAFE_INTEGER,
      me,
      partner,
      partner,
      me,
      THREAD_PAGE + 1,
    ],
  );
  // Older ones count too, so a long conversation does not keep its 쪽지
  // notice on.
  const { rows: unread } = await ctx.sql<{ n: number }>`SELECT count(*) AS n
    FROM messages WHERE recipient = ${me} AND sender = ${partner}
    AND read_at IS NULL AND hidden_by_recipient = 0`;
  return {
    documents: rows.slice(0, THREAD_PAGE).reverse().map(messageOf),
    more: rows.length > THREAD_PAGE,
    unread: unread[0].n,
  };
}
