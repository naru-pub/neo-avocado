import {
  CHARACTERS,
  HISTORY,
  MESSAGES,
  PROFILES,
  amount,
  lacking,
  names,
  pay,
  record,
  wallet,
  WALLETS,
} from "../../modules/shared.js";
import type { Ctx } from "../../modules/naru-types.js";

export const readOnly = ["ledger"];

/**
 * 화폐관리 (mypage/money/money_update.php): sends money to the member who
 * owns the character named, records it on both sides, and tells them by
 * 쪽지 as the original's send_memo. Not to oneself.
 */
export async function send(
  ctx: Ctx,
  { character, amount: value }: { character?: string; amount?: number } = {},
) {
  const sent = amount(value, "Money sent");
  if (!sent)
    ctx.fail("INVALID_REQUEST", "보낼 금액을 1 이상으로 입력해 주세요.", {
      reason: "invalid_input",
    });
  const target =
    typeof character === "string" ? await ctx.get(CHARACTERS, character) : null;
  const recipient =
    target && !target.data.deleted
      ? (target.createdBy ?? target.data.owner)
      : null;
  const [from, to] = await Promise.all([
    ctx.get(PROFILES, ctx.member.id),
    recipient ? ctx.get(PROFILES, recipient) : null,
  ]);
  if (!to || recipient === ctx.member.id)
    ctx.fail("INVALID_REQUEST", "상대를 확인할 수 없습니다.", {
      reason: "no_recipient",
    });
  const current = await wallet(ctx);
  if (current.balance < sent)
    ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
      reason: "not_enough",
    });
  const named = await names(ctx);
  const balance = await pay(ctx, current, sent);
  const theirs = await ctx.get(WALLETS, recipient);
  const received = (theirs?.data.balance ?? 0) + sent;
  await ctx.set(WALLETS, recipient, { ...theirs?.data, balance: received });
  await record(ctx, "moneySent", {
    delta: -sent,
    balance,
    recipient,
    memo: `[보냄] ${to.data.nick}님`,
  });
  await record(
    ctx,
    "moneyReceived",
    {
      delta: sent,
      balance: received,
      sender: ctx.member.id,
      memo: `[받음] ${from?.data.nick ?? ""}님`,
    },
    recipient,
  );
  await ctx.add(MESSAGES, {
    from: ctx.member.id,
    to: recipient,
    body: `${from?.data.nick ?? ""}님이 ${sent.toLocaleString("ko-KR")}${named.moneyUnit ? ` ${named.moneyUnit}` : ""} 보냈습니다.`,
    sentAt: ctx.now,
    readAt: null,
    gift: true,
  });
  ctx.notify(recipient, { unread: true });
  return { balance, nick: to.data.nick };
}

/**
 * The member's money ledger (mypage/money/index.php): what came in and what
 * went out, newest first, 20 a page.
 */
export async function ledger(
  ctx: Ctx,
  { after = null }: { after?: string | null } = {},
) {
  if (after !== null && typeof after !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  return await ctx.list(HISTORY, {
    filter: { owner: ctx.member.id },
    where: { gt: ["delta", -Number.MAX_SAFE_INTEGER] },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: 20,
    after,
  });
}
