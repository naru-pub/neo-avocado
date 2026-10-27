// The shop page (shop/index.php, inventory/): in one read, the items the
// member may see, the recipes, and the chosen character's inventory (or
// what no character holds). The balance is economy/wallet:wallet.
import { signedIn } from "../../modules/access.js";
import { ownCharacter } from "../../modules/characters.js";
import {
  inventoryOf,
  openRecipes,
  shopOffers,
  visibleItems,
} from "../../modules/economy.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/**
 * What the shop shows: the shop's items and the hidden
 * ones the member may see (their own, or a recipe's), the recipes, and the
 * inventory of `character`, one of their own, or what no character holds.
 */
export async function shop(
  ctx: QueryCtx,
  args: { character?: string | null } | null,
) {
  const me = signedIn(ctx);
  const { character = null } = args ?? {};
  if (character !== null && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  return {
    items: await visibleItems(ctx, me),
    // 상점 진열: further sales of items, which may be hidden ones.
    offers: await shopOffers(ctx),
    recipes: await openRecipes(ctx),
    inventory: await inventoryOf(ctx, me, { character }),
  };
}
