// A member's character sheets: name, side, profile, pictures and the custom
// fields the admin defines. The site owner edits, deletes, moves and creates
// any member's, as the original's admin (adm/character_form.php,
// character_delete.php).

import { ownerOnly } from "../../modules/access.js";
import type { SheetInput } from "../../modules/characters.js";
import {
  characterRow,
  checkRevision,
  memberByNick,
  moveCharacter,
  presentCharacter,
  removeCharacter,
  saveSheet,
} from "../../modules/characters.js";
import { profileTicket, record, spend } from "../../modules/economy.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * Registers a character (no `id`) or edits one of the member's own (`id`,
 * with the `revision` it was read at). The site owner saves any, and
 * registers one for the member named by `nick`.
 *
 * With `ticket`, a member saves with a 프로필수정 ticket (inventory/
 * use_item.php 27-28, character_form.php:80-84): one of their own, or the
 * character's, whose item's effect is "profile". It opens an approved
 * character while editing is closed, and is spent unless it lasts
 * (it_use_ever; character_form_update.php:268).
 */
export async function save(
  ctx: MutationCtx,
  args: {
    id?: string | null;
    data?: SheetInput;
    revision?: string | null;
    nick?: string | null;
    /** A 프로필수정 ticket's inventory ID. */
    ticket?: string;
  } = {},
) {
  const { ticket, ...sheet } = args ?? {};
  if (ticket === undefined) {
    const { row, catalogue } = await saveSheet(ctx, sheet);
    return { document: await presentCharacter(ctx, row, { catalogue }) };
  }
  if (!ctx.member)
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  const character = await characterRow(ctx, sheet.id);
  const { owned, item } = await profileTicket(ctx, ticket, character);
  const { row, catalogue } = await saveSheet(
    ctx,
    {
      id: String(character.id),
      data: sheet.data ?? {},
      revision: sheet.revision ?? null,
    },
    { opened: true },
  );
  if (item.data.reusable !== true) await spend(ctx, [owned]);
  await record(ctx, "use", {
    item: item.id,
    inventory: owned.id,
    character: String(row.id),
    effect: "profile",
  });
  return { document: await presentCharacter(ctx, row, { catalogue }) };
}

/**
 * Deletes one of the member's characters with what hangs off it; the items
 * it held go back to their owners' own inventory. The site owner deletes
 * any (adm/character_delete.php).
 */
export async function remove(ctx: MutationCtx, { id }: { id?: string } = {}) {
  if (!ctx.member && !ctx.owner)
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  const row = await characterRow(ctx, id);
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  if (!ctx.owner && row.owner !== ctx.member.id)
    ctx.fail("ACCESS_DENIED", "직접 쓴 것만 고치거나 지울 수 있습니다.", {
      reason: "not_owned",
    });
  // A deleted (삭제) character is the site owner's to remove (선택제거).
  if (!ctx.owner && row.state === "deleted")
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  // The original offers 캐릭터 정보 삭제 only before approval (viewer.php:203).
  if (!ctx.owner && row.state === "approved")
    ctx.fail(
      "ACCESS_DENIED",
      "승인된 캐릭터는 삭제할 수 없습니다. 운영자에게 문의해 주세요.",
      { reason: "approved" },
    );
  await removeCharacter(ctx, row);
  return { done: true };
}

/**
 * The site owner gives a character to the member named by `nick`, as the
 * admin form changes its mb_id (adm/character_form.php:135), whatever that
 * member's limit, with its outfits, relations and items.
 */
export const move = ownerOnly(async function move(
  ctx: MutationCtx,
  {
    id,
    nick,
    revision = null,
  }: { id?: string; nick?: string; revision?: string | null } = {},
) {
  const row = await characterRow(ctx, id);
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  checkRevision(ctx, row, revision);
  const member = await memberByNick(ctx, nick);
  const moved = await moveCharacter(ctx, row, member);
  return { document: await presentCharacter(ctx, moved), done: true };
});
