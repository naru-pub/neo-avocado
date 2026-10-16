import {
  PROFILES,
  SETTINGS,
  MESSAGES,
  kstDay,
  record,
  text,
  amount,
  wallet,
  pay,
  lacking,
} from "../../modules/shared.js";
import { callsUnread } from "../../modules/roleplay.js";
import type { Ctx, NaruDocument } from "../../modules/naru-types.js";

export const readOnly = ["messageStatus", "conversations"];

/** Messages a member may send a day unless the owner sets another number. */
const MESSAGE_DAILY_LIMIT = 100;

/** Message storage is admin-only; every public operation checks the parties. */
export async function sendMessage(
  ctx: Ctx,
  { recipients, body }: { recipients?: string[]; body?: string } = {},
) {
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
  if (!(await ctx.get(PROFILES, ctx.member.id)))
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  for (const id of recipients) {
    const recipient = await ctx.get(PROFILES, id);
    if (
      id === ctx.member.id ||
      !recipient ||
      recipient.data.acceptMessages === false
    )
      ctx.fail("INVALID_REQUEST", "받는 회원을 확인해 주세요.", {
        reason: "no_recipient",
      });
  }
  const settings = (await ctx.get(SETTINGS, "community"))?.data ?? {};
  // The original makes each send pass a captcha (bbs/memo_form_update.php);
  // here a member may send so many a day (0: no limit), so one account
  // cannot fill the site's storage with mail.
  const daily = Number.isSafeInteger(settings.messageDailyLimit)
    ? settings.messageDailyLimit
    : MESSAGE_DAILY_LIMIT;
  if (daily > 0) {
    const sent = await ctx.count(MESSAGES, {
      filter: { from: ctx.member.id },
      // A gift's notice (economy/inventory:gift) is not a 쪽지 they wrote.
      where: {
        all: [
          { gte: ["sentAt", Date.parse(`${kstDay(ctx.now)}T00:00:00+09:00`)] },
          { ne: ["gift", true] },
        ],
      },
    });
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
  const ids = await Promise.all(
    recipients.map(
      async (to) =>
        (
          await ctx.add(MESSAGES, {
            from: ctx.member.id,
            to,
            body: message,
            sentAt: ctx.now,
            readAt: null,
          })
        ).id,
    ),
  );
  if (cost)
    await record(ctx, "message", { recipients, delta: -total, balance });
  // Sent after the commit; a reason for the recipient's page to show the tab.
  for (const to of recipients) ctx.notify(to, { unread: true });
  return { ids, balance };
}

/**
 * A message the member sent or received and has not removed from their own
 * box, or a refusal.
 */
async function ownMessage(ctx: Ctx, id: unknown): Promise<NaruDocument> {
  const message = typeof id === "string" ? await ctx.get(MESSAGES, id) : null;
  const me = ctx.member.id;
  if (
    !message ||
    !(
      (message.data.from === me && message.data.hiddenFrom !== true) ||
      (message.data.to === me && message.data.hiddenTo !== true)
    )
  )
    ctx.fail("NOT_FOUND", "쪽지가 없거나 읽을 권한이 없습니다.", {
      reason: "message_not_found",
    });
  return message;
}

export async function readMessage(ctx: Ctx, { id }: { id?: string } = {}) {
  let message = await ownMessage(ctx, id);
  const receipt =
    message.data.to === ctx.member.id && message.data.readAt === null;
  if (receipt)
    message = await ctx.set(MESSAGES, message.id, {
      ...message.data,
      readAt: ctx.now,
    });
  const { unread } = await messageStatus(ctx);
  // The member's other tabs clear their notice too.
  if (receipt) ctx.notify(ctx.member.id, { unread });
  return { document: message, unread };
}

/**
 * Removes a message from the member's own box only, as GnuBoard 5.4 keeps a
 * sender's and a recipient's copy (AvocadoEdition's single row let a sender
 * erase what the recipient received). Gone once both have removed it.
 */
export async function removeMessage(ctx: Ctx, { id }: { id?: string } = {}) {
  const message = await ownMessage(ctx, id);
  const me = ctx.member.id;
  const data = {
    ...message.data,
    ...(message.data.from === me ? { hiddenFrom: true } : {}),
    ...(message.data.to === me ? { hiddenTo: true } : {}),
  };
  if (data.hiddenFrom === true && data.hiddenTo === true)
    await ctx.delete(MESSAGES, message.id);
  else await ctx.set(MESSAGES, message.id, data);
  return null;
}

/** Unread mail, and calls/comment notices since the member last looked. */
export async function messageStatus(ctx: Ctx) {
  const page = await ctx.list(MESSAGES, {
    filter: { to: ctx.member.id, readAt: null },
    where: { ne: ["hiddenTo", true] },
    size: 1,
  });
  return {
    unread: page.documents.length > 0,
    calls: await callsUnread(ctx),
  };
}

/** The messages between the member and others, as many as a list reads. */
async function correspondence(
  ctx: Ctx,
  partner: string | null = null,
): Promise<NaruDocument[]> {
  const me = ctx.member.id;
  const read = (box: "inbox" | "sent") =>
    ctx.list(MESSAGES, {
      filter: {
        [box === "inbox" ? "to" : "from"]: me,
        ...(partner ? { [box === "inbox" ? "from" : "to"]: partner } : {}),
      },
      where: { ne: [box === "inbox" ? "hiddenTo" : "hiddenFrom", true] },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size: 100,
    });
  const [inbox, sent] = await Promise.all([read("inbox"), read("sent")]);
  return [...inbox.documents, ...sent.documents].sort(
    (a, b) => b.data.sentAt - a.data.sentAt || (a.id < b.id ? 1 : -1),
  );
}

/**
 * 쪽지함 as the original's (mypage/memo/index.php): one entry a member the
 * member has written with, newest first: their last message, how many, and
 * whether one is unread. Five a page.
 */
export async function conversations(
  ctx: Ctx,
  { page = 1 }: { page?: number } = {},
) {
  if (!Number.isInteger(page) || page < 1 || page > 100)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const me = ctx.member.id;
  const partners = new Map();
  for (const row of await correspondence(ctx)) {
    const partner = row.data.from === me ? row.data.to : row.data.from;
    const entry = partners.get(partner) ?? {
      partner,
      last: {
        id: row.id,
        preview: row.data.body.slice(0, 150),
        sentAt: row.data.sentAt,
        mine: row.data.from === me,
      },
      count: 0,
      unread: false,
    };
    entry.count += 1;
    if (row.data.to === me && row.data.readAt === null) entry.unread = true;
    partners.set(partner, entry);
  }
  const all = [...partners.values()];
  return {
    total: all.length,
    documents: all.slice((page - 1) * 5, page * 5),
    unread: (await messageStatus(ctx)).unread,
  };
}

/**
 * The messages between the member and one other (memo_view.php), oldest
 * first; what they sent is read now.
 */
export async function conversation(
  ctx: Ctx,
  { partner }: { partner?: string } = {},
) {
  if (typeof partner !== "string" || partner === ctx.member.id)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const rows = await correspondence(ctx, partner);
  // At most 20 receipts a call, inside a call's write budget; the rest
  // are read the next time the conversation opens.
  let read = 0;
  for (const row of rows)
    if (
      row.data.to === ctx.member.id &&
      row.data.readAt === null &&
      read < 20
    ) {
      row.data = (
        await ctx.set(MESSAGES, row.id, { ...row.data, readAt: ctx.now })
      ).data;
      read += 1;
    }
  const { unread } = await messageStatus(ctx);
  if (read) ctx.notify(ctx.member.id, { unread });
  return { documents: rows.reverse(), unread };
}
