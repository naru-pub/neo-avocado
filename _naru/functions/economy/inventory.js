import {
  INVENTORY,
  ITEMS,
  PROFILES,
  RECIPES,
  CHARACTERS,
  record,
  ownCharacter,
  text,
  imageUrl,
  failure,
  amount,
  wallet,
  pay,
  give,
  draw,
  ownedItem,
  useRestriction,
  restoreStat,
} from "../../modules/shared.js";
import { presentCharacter } from "../../modules/characters.js";

/** Selling consumes exactly one owned item; prices always come from the catalog. */
export async function sell(ctx, { inventory } = {}) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  const item = await ctx.get(ITEMS, owned.data.item);
  if (
    !item ||
    item.data.sellPrice === undefined ||
    item.data.sellable === false
  )
    return failure("not_sellable");
  const price = amount(item.data.sellPrice, "Sale price");
  const balance = await pay(ctx, await wallet(ctx), -price);
  await ctx.delete(INVENTORY, owned.id);
  await record(ctx, "sell", {
    character: owned.data.character ?? null,
    item: owned.data.item,
    inventory: owned.id,
    delta: price,
    balance,
  });
  return { ok: true, balance, name: owned.data.name };
}

/** The recipient must be an existing member profile, never a browser-supplied owner. */
export async function gift(
  ctx,
  { inventory, recipient, character = null, memo = "" } = {},
) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  if (
    typeof recipient !== "string" ||
    recipient === ctx.member.id ||
    !(await ctx.get(PROFILES, recipient))
  )
    return failure("no_recipient");
  if (typeof memo !== "string" || memo.length > 500)
    return failure("invalid_input");
  const item = await ctx.get(ITEMS, owned.data.item);
  if (!item || item.data.giftable === false) return failure("not_giftable");
  const target =
    typeof character === "string" ? await ctx.get(CHARACTERS, character) : null;
  if (
    character &&
    (!target ||
      target.data.deleted ||
      (target.createdBy ?? target.data.owner) !== recipient)
  )
    return failure("no_character");
  if (owned.data.character && !target) return failure("no_character");
  const transferred = await ctx.set(INVENTORY, owned.id, {
    ...owned.data,
    owner: recipient,
    sender: ctx.member.id,
    memo,
    receivedAt: ctx.now,
    character,
  });
  await record(ctx, "gift", {
    item: owned.data.item,
    inventory: owned.id,
    recipient,
    character,
    memo,
  });
  await record(
    ctx,
    "giftReceived",
    {
      item: owned.data.item,
      inventory: owned.id,
      sender: ctx.member.id,
      character,
      memo,
    },
    recipient,
  );
  return { ok: true, owned: transferred };
}

/** Selected materials are checked against the owner's recipe, then consumed atomically. */
export async function craft(ctx, { recipe, materials, character = null } = {}) {
  if (character && !(await ownCharacter(ctx, character)))
    return failure("no_character");
  const row =
    typeof recipe === "string" ? await ctx.get(RECIPES, recipe) : null;
  if (!row || row.data.hidden) return failure("no_recipe");
  if (
    !Array.isArray(materials) ||
    materials.length > 20 ||
    materials.some((id) => typeof id !== "string") ||
    new Set(materials).size !== materials.length
  )
    return failure("invalid_materials");
  const ingredients = row.data.ingredients;
  if (
    !Array.isArray(ingredients) ||
    !ingredients.length ||
    ingredients.length > 20
  )
    throw new Error("Recipe ingredients must be a non-empty list.");
  const required = new Map();
  for (const ingredient of ingredients) {
    if (typeof ingredient.item !== "string")
      throw new Error("Recipe item is missing.");
    const count = amount(ingredient.count, "Ingredient count");
    if (!count) throw new Error("Ingredient count must be positive.");
    required.set(ingredient.item, (required.get(ingredient.item) ?? 0) + count);
  }
  const owned = await Promise.all(materials.map((id) => ownedItem(ctx, id)));
  if (
    owned.some((item) => !item || (item.data.character ?? null) !== character)
  )
    return failure("not_owned");
  const provided = new Map();
  for (const item of owned)
    provided.set(item.data.item, (provided.get(item.data.item) ?? 0) + 1);
  if (
    provided.size !== required.size ||
    [...required].some(([item, count]) => provided.get(item) !== count)
  )
    return failure("invalid_materials");
  const prize =
    typeof row.data.item === "string"
      ? await ctx.get(ITEMS, row.data.item)
      : null;
  if (!prize) throw new Error("Recipe output item is missing.");
  const cost = amount(row.data.cost ?? 0, "Crafting cost");
  const current = await wallet(ctx);
  if (current.balance < cost) return failure("not_enough");
  const balance = await pay(ctx, current, cost);
  for (const item of owned) await ctx.delete(INVENTORY, item.id);
  const output = await give(ctx, prize, "craft", character);
  await record(ctx, "craft", {
    character,
    item: prize.id,
    delta: -cost,
    balance,
  });
  return { ok: true, balance, owned: output };
}

export async function assignInventory(
  ctx,
  { inventory, character = null } = {},
) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  if (character && !(await ownCharacter(ctx, character)))
    return failure("no_character");
  return {
    ok: true,
    document: await ctx.set(INVENTORY, owned.id, { ...owned.data, character }),
  };
}

/** Four built-in item actions mirror inventory/use_item.php. */
export async function useItem(ctx, { inventory, character, data = {} } = {}) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  const item = await ctx.get(ITEMS, owned.data.item);
  if (!item?.data.effect || item.data.usable === false)
    return failure("not_usable");
  if (owned.data.character && owned.data.character !== character)
    return failure("wrong_character");
  if (owned.data.character && !(await ownCharacter(ctx, character)))
    return failure("not_owned");
  const restricted = await useRestriction(ctx, item, character);
  if (restricted) return failure(restricted);
  const effect = item.data.effect;
  let result = { ok: true, name: owned.data.name };
  if (effect.type === "restore") {
    if (!(await ownCharacter(ctx, character))) return failure("not_owned");
    const restored = await restoreStat(ctx, effect, character);
    if (!restored) return failure("already_full");
    result.document = restored;
  } else if (effect.type === "draw") {
    const outcome = await draw(ctx, item.id);
    if (!outcome.configured) return failure("empty");
    result.owned = outcome.prize
      ? await give(ctx, outcome.prize, "item", owned.data.character ?? null)
      : null;
  } else if (effect.type === "create") {
    const name = text(data.name, 80, true);
    const description = text(data.description ?? "", 2000);
    const image = data.image ? imageUrl(data.image) : null;
    const personal = await ctx.add(ITEMS, {
      name,
      description,
      image,
      category: "personal",
      hidden: true,
      sellable: false,
    });
    result.owned = await give(
      ctx,
      personal,
      "personal",
      owned.data.character ?? null,
    );
  } else if (effect.type === "profile") {
    const target = await ownCharacter(ctx, character);
    if (!target) return failure("not_owned");
    if (data.revision !== target.revision) return failure("conflict");
    const profile = {
      ...target.data,
      name: text(data.name, 40, true),
      side: text(data.side ?? "", 40),
      profile: text(data.profile ?? "", 4000),
    };
    if (Object.hasOwn(data, "image"))
      profile.image = data.image ? imageUrl(data.image) : null;
    delete profile.imageId;
    result.document = await presentCharacter(
      ctx,
      await ctx.set(CHARACTERS, character, profile),
    );
  } else return failure("not_usable");
  // The original personal-item creation form always consumes its ticket.
  if (item.data.reusable !== true || effect.type === "create")
    await ctx.delete(INVENTORY, owned.id);
  await record(ctx, "use", {
    item: item.id,
    inventory: owned.id,
    character: character ?? null,
    effect: effect.type,
  });
  return result;
}
