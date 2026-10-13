import {
  PROFILES,
  SETTINGS,
  MESSAGES,
  record,
  text,
  failure,
  amount,
  wallet,
  pay,
} from "../../modules/shared.js";

/** Message storage is admin-only; every public operation checks the parties. */
export function sendMessage(ctx, { recipients, body } = {}) {
  if (
    !Array.isArray(recipients) ||
    !recipients.length ||
    recipients.length > 20 ||
    recipients.some((id) => typeof id !== "string") ||
    new Set(recipients).size !== recipients.length
  )
    return failure("invalid_recipients");
  const message = text(body, 5000, true);
  if (!ctx.get(PROFILES, ctx.member.id)) return failure("no_profile");
  for (const id of recipients) {
    const recipient = ctx.get(PROFILES, id);
    if (
      id === ctx.member.id ||
      !recipient ||
      recipient.data.acceptMessages === false
    )
      return failure("no_recipient");
  }
  const cost = amount(
    ctx.get(SETTINGS, "community")?.data.messageCost ?? 0,
    "Message cost",
  );
  const total = cost * recipients.length;
  if (!Number.isSafeInteger(total)) throw new Error("Message cost overflow.");
  const current = wallet(ctx);
  if (current.balance < total) return failure("not_enough");
  const balance = cost ? pay(ctx, current, total) : current.balance;
  const ids = recipients.map(
    (to) =>
      ctx.add(MESSAGES, {
        from: ctx.member.id,
        to,
        body: message,
        sentAt: ctx.now,
        readAt: null,
      }).id,
  );
  if (cost) record(ctx, "message", { recipients, delta: -total, balance });
  return { ok: true, ids, balance };
}

export function mailbox(ctx, { box = "inbox", after = null, size = 20 } = {}) {
  if (
    !["inbox", "sent"].includes(box) ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string")
  )
    return failure("invalid_input");
  const page = ctx.list(MESSAGES, {
    filter: { [box === "inbox" ? "to" : "from"]: ctx.member.id },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size,
    after,
  });
  return {
    ok: true,
    unread: messageStatus(ctx).unread,
    nextCursor: page.nextCursor,
    documents: page.documents.map((row) => ({
      id: row.id,
      data: {
        from: row.data.from,
        to: row.data.to,
        preview: row.data.body.slice(0, 150),
        sentAt: row.data.sentAt,
        readAt: row.data.readAt,
      },
    })),
  };
}

export function readMessage(ctx, { id } = {}) {
  let message = typeof id === "string" ? ctx.get(MESSAGES, id) : null;
  if (
    !message ||
    (message.data.from !== ctx.member.id && message.data.to !== ctx.member.id)
  )
    return failure("message_not_found");
  if (message.data.to === ctx.member.id && message.data.readAt === null)
    message = ctx.set(MESSAGES, message.id, {
      ...message.data,
      readAt: ctx.now,
    });
  return { ok: true, document: message, unread: messageStatus(ctx).unread };
}

export function removeMessage(ctx, { id } = {}) {
  const message = typeof id === "string" ? ctx.get(MESSAGES, id) : null;
  if (
    !message ||
    (message.data.from !== ctx.member.id && message.data.to !== ctx.member.id)
  )
    return failure("message_not_found");
  ctx.delete(MESSAGES, message.id);
  return { ok: true };
}

export function messageStatus(ctx) {
  const page = ctx.list(MESSAGES, {
    filter: { to: ctx.member.id, readAt: null },
    size: 1,
  });
  return { ok: true, unread: page.documents.length > 0 };
}
