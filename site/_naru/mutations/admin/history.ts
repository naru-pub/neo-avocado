// 선택삭제 of 전체 활동·구매 기록 (adm/exp_list_delete.php,
// point_list_delete.php): each entry goes, and what it moved is taken back.
// An experience entry's amount comes off its character's experience, the
// later entries' running totals with it, and ranks the character falls
// below take back their bonus points (or reaching one adds them); a money
// entry's comes off its member's balance in the same way. An entry whose
// undoing would leave less than none is refused, and the call keeps nothing.
import { invalid } from "../../modules/admin.js";
import {
  amount,
  communitySettings,
  one,
  ownerOnly,
} from "../../modules/access.js";
import { withExp } from "../../modules/characters.js";
import { saveWallet, walletOf } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

interface Entry {
  id: number;
  owner: string;
  delta: number | null;
  exp_delta: number | null;
  character_id: string | null;
}

export const remove = ownerOnly(async function remove(
  ctx: MutationCtx,
  { ids }: { ids?: string[] } = {},
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 20 ||
    ids.some((id) => !Number.isSafeInteger(Number(id)))
  )
    invalid(ctx);
  let removed = 0;
  for (const id of new Set(ids.map(Number))) {
    const entry = await one<Entry>(
      ctx,
      "SELECT id, owner, delta, exp_delta, character_id FROM history WHERE id = ?",
      [id],
    );
    if (!entry) continue;
    await ctx.sql`DELETE FROM history WHERE id = ${id}`;
    removed += 1;
    if (entry.exp_delta !== null && entry.character_id !== null) {
      const character = await one<{ exp: number; points: number | null }>(
        ctx,
        "SELECT exp, points FROM characters WHERE id = ?",
        [Number(entry.character_id)],
      );
      if (character) {
        const exp = character.exp - entry.exp_delta;
        if (exp < 0)
          ctx.fail(
            "CONFLICT",
            "경험치가 0보다 적어져 이 기록을 지울 수 없습니다.",
            { reason: "below_zero", id: String(id) },
          );
        // Points not yet written are the owner's starting points.
        const points =
          character.points ??
          amount(
            (await communitySettings(ctx)).initialStatPoints ?? 0,
            "Initial stat points",
          );
        const after = await withExp(ctx, { exp: character.exp, points }, exp);
        await ctx.sql`UPDATE characters SET exp = ${after.exp},
          points = ${after.points}, version = version + 1
          WHERE id = ${Number(entry.character_id)}`;
      }
      // ex_ch_exp of the entries after it (exp_list_delete.php:31-35).
      await ctx.sql`UPDATE history SET exp = exp - ${entry.exp_delta}
        WHERE character_id = ${entry.character_id} AND id > ${id} AND exp IS NOT NULL`;
    }
    if (entry.delta !== null) {
      const wallet = await walletOf(ctx, entry.owner);
      const balance = wallet.balance - entry.delta;
      if (balance < 0)
        ctx.fail(
          "CONFLICT",
          "잔액이 0보다 적어져 이 기록을 지울 수 없습니다.",
          { reason: "below_zero", id: String(id) },
        );
      await saveWallet(ctx, entry.owner, balance);
      // po_mb_point of the entries after it (point_list_delete.php:46-50).
      await ctx.sql`UPDATE history SET balance = balance - ${entry.delta}
        WHERE owner = ${entry.owner} AND id > ${id} AND delta IS NOT NULL`;
    }
  }
  return { removed };
});
