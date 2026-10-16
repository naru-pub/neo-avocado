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
import type { Ctx, NaruDocument, Where } from "../../modules/naru-types.js";

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
  const status = await unreadOf(ctx);
  // The member's other tabs clear their notice too.
  if (receipt) ctx.notify(ctx.member.id, status);
  return { document: message, ...status };
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

/**
 * Unread mail (how many, as outlogin.skin.2.php's $memo_not_read), and
 * calls/comment notices since the member last looked.
 */
export async function messageStatus(ctx: Ctx) {
  const count = await ctx.count(MESSAGES, {
    filter: { to: ctx.member.id, readAt: null },
    where: { ne: ["hiddenTo", true] },
  });
  return {
    unread: count > 0,
    unreadCount: count,
    calls: await callsUnread(ctx),
  };
}

/** Messages a 쪽지함 reads from each box: see correspondence. */
const BOX_LIMIT = 1000;
/** Messages a conversation shows at a time, newest first. */
const THREAD_PAGE = 50;

/**
 * The member's inbox and sent box, newest first. Each box is read 100 at a
 * time up to BOX_LIMIT messages: 20 of a call's 100 operations, and at most
 * 2,000 messages of up to 5,000 characters inside a call's 32 MiB. A member
 * with more sees correspondents from their 1,000 newest of each in the
 * 쪽지함 (counts over those); a conversation reads its pair's own messages
 * by date, so older ones stay reachable there (이전 쪽지 더 보기).
 */
async function correspondence(ctx: Ctx): Promise<NaruDocument[]> {
  const me = ctx.member.id;
  const read = async (box: "inbox" | "sent") => {
    const rows: NaruDocument[] = [];
    let after: string | null = null;
    do {
      const page = await ctx.list(MESSAGES, {
        filter: { [box === "inbox" ? "to" : "from"]: me },
        where: { ne: [box === "inbox" ? "hiddenTo" : "hiddenFrom", true] },
        sort: [[{ metadata: "createdAt" }, "desc"]],
        size: 100,
        after,
      });
      rows.push(...page.documents);
      after = page.nextCursor;
    } while (after && rows.length < BOX_LIMIT);
    return rows;
  };
  const [inbox, sent] = await Promise.all([read("inbox"), read("sent")]);
  return [...inbox, ...sent].sort(newestFirst);
}
const newestFirst = (a: NaruDocument, b: NaruDocument) =>
  b.data.sentAt - a.data.sentAt || (a.id < b.id ? 1 : -1);

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
    ...(await unreadOf(ctx)),
  };
}

/** What a page's mail notice shows: whether any is unread, and how many. */
async function unreadOf(ctx: Ctx) {
  const { unread, unreadCount } = await messageStatus(ctx);
  return { unread, unreadCount };
}

/**
 * The messages between the member and one other (memo_view.php), oldest
 * first: the newest 50, or with `before` (the oldest one's sentAt) the 50
 * before those. What the other sent and the member has not read is read
 * now, the newest 20 a call.
 */
export async function conversation(
  ctx: Ctx,
  { partner, before = null }: { partner?: string; before?: number | null } = {},
) {
  if (
    typeof partner !== "string" ||
    partner === ctx.member.id ||
    (before !== null && !Number.isSafeInteger(before))
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const me = ctx.member.id;
  const read = (from: string, to: string, hidden: string) =>
    ctx.list(MESSAGES, {
      filter: { from, to },
      where: {
        all: [
          { ne: [hidden, true] },
          ...(before === null ? [] : [{ lt: ["sentAt", before] } as Where]),
        ],
      },
      sort: [["sentAt", "desc"]],
      size: THREAD_PAGE + 1,
    });
  const [received, sent] = await Promise.all([
    read(partner, me, "hiddenTo"),
    read(me, partner, "hiddenFrom"),
  ]);
  const all = [...received.documents, ...sent.documents].sort(newestFirst);
  const rows = all.slice(0, THREAD_PAGE);
  const more =
    all.length > THREAD_PAGE ||
    Boolean(received.nextCursor) ||
    Boolean(sent.nextCursor);
  // At most 20 receipts a call, inside a call's write budget; the rest
  // are read the next time the conversation opens. Older unread ones count
  // too, so a long conversation does not leave its 쪽지 notice on.
  const unread = await ctx.list(MESSAGES, {
    filter: { from: partner, to: me, readAt: null },
    where: { ne: ["hiddenTo", true] },
    sort: [["sentAt", "desc"]],
    size: 20,
  });
  for (const row of unread.documents) {
    const saved = await ctx.set(MESSAGES, row.id, {
      ...row.data,
      readAt: ctx.now,
    });
    const shown = rows.find((message) => message.id === row.id);
    if (shown) shown.data = saved.data;
  }
  const status = await unreadOf(ctx);
  if (unread.documents.length) ctx.notify(me, status);
  return { documents: rows.reverse(), more, ...status };
}
