import { INVENTORY, ITEMS, RECIPES } from "../modules/shared.js";

// Catalogue rows (items, titles, recipes, emoticons, couples, relations,
// outfits) the admin or a site function has not marked deleted.
//
// Recipes the owner hid (숨기기) cannot be crafted, and the original keeps
// recipes off players' screens altogether (adm/recipi_list.php), so members
// never read them. Items hidden from the shop (상점에서 숨기기), such as
// prizes and crafted goods, show only as the original shows them: in the
// reader's own inventory, or as part of a recipe they can see.
export async function readable(ctx, { collection }) {
  const listed = { ne: ["deleted", true] };
  if (collection === RECIPES)
    return { all: [listed, { ne: ["hidden", true] }] };
  if (collection !== ITEMS) return listed;
  const known = new Set();
  // The reader's inventory, up to 2,000 rows (a rule reads at most 100
  // times a call); items past it read as hidden ones do.
  for (let after = null, pages = 0; ctx.member && pages < 20; pages++) {
    const owned = await ctx.list(INVENTORY, {
      filter: { owner: ctx.member.id },
      size: 100,
      after,
    });
    for (const row of owned.documents) known.add(row.data.item);
    after = owned.nextCursor;
    if (!after) break;
  }
  const recipes = await ctx.list(RECIPES, {
    where: { all: [listed, { ne: ["hidden", true] }] },
    size: 100,
  });
  for (const row of recipes.documents) {
    known.add(row.data.item);
    for (const ingredient of row.data.ingredients ?? [])
      known.add(ingredient.item);
  }
  const ids = [...known].filter((id) => typeof id === "string");
  const visible = [{ ne: ["hidden", true] }];
  for (let at = 0; at < ids.length; at += 100)
    visible.push({ in: [{ metadata: "id" }, ids.slice(at, at + 100)] });
  return { all: [listed, { any: visible }] };
}

export function canWrite() {
  return false;
}
