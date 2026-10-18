// 화폐관리 (mypage/money/): sending money to another member.
import { amount, lacking, names, signedIn } from "../../modules/access.js";
import { pay, record, wallet } from "../../modules/economy.js";
import { characterRow } from "../../modules/characters.js";
import { sendNote } from "../../modules/mail.js";
import { profileOf, saveWallet, walletOf } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * 화폐관리 (mypage/money/money_update.php): sends money to the member who
 * owns the character named, records it on both sides, and tells them by
 * 쪽지 as the original's send_memo, in the same transaction. Not to
 * oneself.
 */
export async function send(
  ctx: MutationCtx,
  args: { character?: string; amount?: number },
) {
  const me = signedIn(ctx);
  const { character, amount: value } = args ?? {};
  const sent = amount(value, "Money sent");
  if (!sent)
    ctx.fail("INVALID_REQUEST", "보낼 금액을 1 이상으로 입력해 주세요.", {
      reason: "invalid_input",
    });
  const target = await characterRow(ctx, character);
  // A deleted (삭제) character names no one.
  const recipient = target && target.state !== "deleted" ? target.owner : null;
  const from = await profileOf(ctx, me);
  const to = recipient ? await profileOf(ctx, recipient) : null;
  if (!to || recipient === me)
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
  // The money arrives either way; the note only to a member taking 쪽지.
  const notice = to.data.acceptMessages !== false;
  if (notice)
    await sendNote(
      ctx,
      recipient,
      `${from?.data.nick ?? ""}님이 ${String(sent).replace(/\B(?=(\d{3})+$)/g, ",")}${named.moneyUnit ? ` ${named.moneyUnit}` : ""} 보냈습니다.`,
      { kind: "money", amount: sent },
    );
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
      sender: me,
      memo: `[받음] ${from?.data.nick ?? ""}님`,
    },
    recipient,
  );
  return { balance, nick: to.data.nick, notice };
}
