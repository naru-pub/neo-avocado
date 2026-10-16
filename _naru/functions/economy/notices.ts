// For the time being: the 쪽지 a gift or money sent tells its recipient of
// (send_memo), while mail is still a collection the economy's mutations
// cannot write. The mutation keeps the note in the sender's history; the
// sender's page then calls this, which sends what that member's history
// holds unsent. It goes when mail moves to the site's tables.
import { MESSAGES } from "../../modules/shared.js";
import { parsed } from "../../modules/access.js";
import type { Ctx } from "../../modules/naru-types.js";

/** Notes a call sends, at most (each a write and a live message). */
const NOTICES = 20;

/** Sends the caller's gifts' and transfers' notes not sent yet. */
export async function deliver(ctx: Ctx) {
  if (!ctx.member)
    ctx.fail("AUTH_REQUIRED", "로그인해 주세요.", { reason: "sign_in" });
  const { rows } = await ctx.sql<{ id: number; at: number; details: string }>(
    `SELECT id, at, details FROM history
     WHERE owner = ? AND kind IN ('gift', 'moneySent')
       AND json_extract(details, '$.notice.to') IS NOT NULL
       AND json_extract(details, '$.noticeSent') IS NULL
     ORDER BY id LIMIT ?`,
    [ctx.member.id, NOTICES],
  );
  for (const row of rows) {
    const { notice } = parsed(row.details, {}) as {
      notice?: { to?: unknown; body?: unknown };
    };
    await ctx.sql(
      "UPDATE history SET details = json_set(details, '$.noticeSent', ?) WHERE id = ?",
      [ctx.now, row.id],
    );
    if (typeof notice?.to !== "string" || typeof notice.body !== "string")
      continue;
    await ctx.add(MESSAGES, {
      from: ctx.member.id,
      to: notice.to,
      body: notice.body,
      sentAt: row.at,
      readAt: null,
      gift: true,
    });
    ctx.notify(notice.to, { unread: true });
  }
  return { sent: rows.length };
}
