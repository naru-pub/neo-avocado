// 쪽지 (bbs/memo_form_update.php, memo_view.php, memo_delete.php): sending,
// reading and removing messages. Pages subscribed to community/inbox:status
// hear of each as Naru re-runs it.
import {
  amount,
  communitySettings,
  invalid,
  kstDay,
  lacking,
  signedIn,
  text,
} from "../../modules/access.js";
import { pay, record, wallet } from "../../modules/economy.js";
import { messageOf, ownMessage } from "../../modules/mail.js";
import { profileOf } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";
import { push } from "../../modules/push.js";

/** Messages a member may send a day unless the owner sets another number. */
const MESSAGE_DAILY_LIMIT = 100;

/**
 * Sends one message to each of 1–20 members, who must take 쪽지, paying
 * the owner's cost for each. Not to oneself.
 */
export async function sendMessage(
  ctx: MutationCtx,
  args: { recipients?: string[]; body?: string },
) {
  const me = signedIn(ctx);
  const { recipients, body } = args ?? {};
  if (
    !Array.isArray(recipients) ||
    !recipients.length ||
    recipients.length > 20 ||
    recipients.some((id) => typeof id !== "string") ||
    new Set(recipients).size !== recipients.length
  )
    ctx.fail("INVALID_REQUEST", "받는 회원을 중복 없이 1~20명 선택해 주세요.", {
      reason: "invalid_recipients",
    });
  const message = text(body, 5000, true);
  const profile = await profileOf(ctx, me);
  if (!profile)
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  const { rows: taking } = await ctx.sql<{ member: string }>(
    `SELECT member FROM profiles WHERE accept_messages != 0
     AND member IN (${recipients.map(() => "?").join(", ")})`,
    recipients,
  );
  if (recipients.includes(me) || taking.length !== recipients.length)
    ctx.fail("INVALID_REQUEST", "받는 회원을 확인해 주세요.", {
      reason: "no_recipient",
    });
  const settings = await communitySettings(ctx);
  // The original makes each send pass a captcha (bbs/memo_form_update.php);
  // here a member may send so many a day (0: no limit), counted from the
  // Korean day's midnight, so one account cannot fill the site with mail.
  const daily = Number.isSafeInteger(settings.messageDailyLimit)
    ? settings.messageDailyLimit
    : MESSAGE_DAILY_LIMIT;
  if (daily > 0) {
    // A gift's or money's note is not a 쪽지 they wrote.
    const { rows } = await ctx.sql<{ n: number }>`SELECT count(*) AS n
      FROM messages WHERE sender = ${me}
      AND sent_at >= ${Date.parse(`${kstDay(ctx.now)}T00:00:00+09:00`)}
      AND gift IS NULL`;
    const sent = rows[0].n;
    if (sent + recipients.length > daily)
      ctx.fail(
        "RATE_LIMITED",
        `쪽지는 하루에 ${daily}통까지 보낼 수 있습니다. 오늘 ${Math.max(0, daily - sent)}통 남았습니다.`,
        { reason: "daily_limit", remaining: Math.max(0, daily - sent) },
      );
  }
  const cost = amount(settings.messageCost ?? 0, "Message cost");
  const total = cost * recipients.length;
  if (!Number.isSafeInteger(total)) throw new Error("Message cost overflow.");
  const current = await wallet(ctx);
  if (current.balance < total)
    ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
      reason: "not_enough",
    });
  const balance = cost ? await pay(ctx, current, total) : current.balance;
  const { rows: sent } = await ctx.sql<{ id: number; recipient: string }>(
    `INSERT INTO messages (sender, recipient, body, sent_at)
     VALUES ${recipients.map(() => "(?, ?, ?, ?)").join(", ")} RETURNING id, recipient`,
    recipients.flatMap((to) => [me, to, message, ctx.now]),
  );
  for (const row of sent)
    await push(ctx, [row.recipient], {
      title: `${profile.data.nick}님의 쪽지`,
      body: message.slice(0, 100),
      path: `/messages/${row.id}`,
    });
  if (cost)
    await record(ctx, "message", { recipients, delta: -total, balance });
  return { ids: sent.map((row) => String(row.id)), balance };
}

/**
 * A message of the member's (#/messages/<id>), read now if they received
 * it and had not.
 */
export async function readMessage(ctx: MutationCtx, args: { id?: string }) {
  signedIn(ctx);
  const row = await ownMessage(ctx, args?.id);
  if (row.recipient === ctx.member.id && row.read_at === null) {
    await ctx.sql`UPDATE messages SET read_at = ${ctx.now} WHERE id = ${row.id}`;
    row.read_at = ctx.now;
  }
  return { document: messageOf(row) };
}

/**
 * Reads everything `partner` sent the member and they had not read, as
 * opening the conversation (memo_view.php) does; every one at once.
 */
export async function readConversation(
  ctx: MutationCtx,
  args: { partner?: string },
) {
  const me = signedIn(ctx);
  const { partner } = args ?? {};
  if (typeof partner !== "string" || partner === me) invalid(ctx);
  const { changes } = await ctx.sql`UPDATE messages SET read_at = ${ctx.now}
    WHERE recipient = ${me} AND sender = ${partner}
    AND read_at IS NULL AND hidden_by_recipient = 0`;
  return { read: changes };
}

/**
 * Deletes a message. Its sender deletes it for both, as AvocadoEdition's
 * memo_delete.php does (본인이 보낸 우편만 삭제 가능): unread, it never
 * arrives. Its recipient, whom the original let delete nothing, removes it
 * from their own box only. Gone once both have removed it.
 */
export async function removeMessage(ctx: MutationCtx, args: { id?: string }) {
  const me = signedIn(ctx);
  const row = await ownMessage(ctx, args?.id);
  if (row.sender === me) {
    await ctx.sql`DELETE FROM messages WHERE id = ${row.id}`;
    return null;
  }
  const bySender = row.hidden_by_sender !== 0;
  const byRecipient = row.recipient === me || row.hidden_by_recipient !== 0;
  if (bySender && byRecipient)
    await ctx.sql`DELETE FROM messages WHERE id = ${row.id}`;
  else
    await ctx.sql`UPDATE messages SET hidden_by_sender = ${bySender},
      hidden_by_recipient = ${byRecipient} WHERE id = ${row.id}`;
  return null;
}
