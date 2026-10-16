import {
  MESSAGES,
  amount,
  lacking,
  names,
  pay,
  record,
  wallet,
} from "../../modules/shared.js";
import {
  historyPage,
  profileOf,
  saveWallet,
  walletOf,
} from "../../modules/members.js";
import { characterRow } from "../../modules/characters.js";
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
  const recipient = (await characterRow(ctx, character))?.owner ?? null;
  const [from, to] = await Promise.all([
    profileOf(ctx, ctx.member.id),
    recipient ? profileOf(ctx, recipient) : null,
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
  const received = (await walletOf(ctx, recipient)).balance + sent;
  if (!Number.isSafeInteger(received))
    ctx.fail("INVALID_REQUEST", "받는 사람이 더 받을 수 없습니다.", {
      reason: "invalid_input",
    });
  await saveWallet(ctx, recipient, received);
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
  // The money arrives either way; the note only to a member taking 쪽지.
  if (to.data.acceptMessages !== false)
    await ctx.add(MESSAGES, {
      from: ctx.member.id,
      to: recipient,
      body: `${from?.data.nick ?? ""}님이 ${sent.toLocaleString("ko-KR")}${named.moneyUnit ? ` ${named.moneyUnit}` : ""} 보냈습니다.`,
      sentAt: ctx.now,
      readAt: null,
      gift: true,
    });
  if (to.data.acceptMessages !== false) ctx.notify(recipient, { unread: true });
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
  return await historyPage(
    ctx,
    { owner: ctx.member.id },
    { size: 20, after, money: true },
  );
}
