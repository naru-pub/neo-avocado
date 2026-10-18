// What a member holds (inventory/list.inc.php), with the items it is of.
import { signedIn } from "../../modules/access.js";
import { inventoryOf, itemsByIds } from "../../modules/economy.js";
import { ownCharacter } from "../../modules/characters.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * The member's own copies, oldest first: one of their characters'
 * (`character`), what no character holds, or everything (`all`, as a post's
 * item lists read it), with the items they are of, hidden ones too.
 */
export async function inventory(
  ctx: QueryCtx,
  args: { character?: string | null; all?: boolean } | null,
) {
  const me = signedIn(ctx);
  const { character = null, all = false } = args ?? {};
  if (character !== null && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const rows = await inventoryOf(ctx, me, { character, all: all === true });
  return {
    inventory: rows,
    items: [
      ...(
        await itemsByIds(
          ctx,
          rows.map((row) => row.data.item),
        )
      ).values(),
    ],
  };
}
