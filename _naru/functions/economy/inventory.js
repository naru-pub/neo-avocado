import {
  INVENTORY,
  ITEMS,
  PROFILES,
  RECIPES,
  CHARACTERS,
  CHARACTER_STATE,
  TITLES,
  saveImage,
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
  characterState,
} from "../../modules/shared.js";

/** Selling consumes exactly one owned item; prices always come from the catalog. */
export function sell(ctx, { inventory } = {}) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  const item = ctx.get(ITEMS, owned.data.item);
  if (
    !item ||
    item.data.sellPrice === undefined ||
    item.data.sellable === false
  )
    return failure("not_sellable");
  const price = amount(item.data.sellPrice, "Sale price");
  const balance = pay(ctx, wallet(ctx), -price);
  ctx.delete(INVENTORY, owned.id);
  record(ctx, "sell", {
    character: owned.data.character ?? null,
    item: owned.data.item,
    inventory: owned.id,
    delta: price,
    balance,
  });
  return { ok: true, balance, name: owned.data.name };
}

/** The recipient must be an existing member profile, never a browser-supplied owner. */
export function gift(
  ctx,
  { inventory, recipient, character = null, memo = "" } = {},
) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  if (
    typeof recipient !== "string" ||
    recipient === ctx.member.id ||
    !ctx.get(PROFILES, recipient)
  )
    return failure("no_recipient");
  if (typeof memo !== "string" || memo.length > 500)
    return failure("invalid_input");
  const item = ctx.get(ITEMS, owned.data.item);
  if (!item || item.data.giftable === false) return failure("not_giftable");
  const target =
    typeof character === "string" ? ctx.get(CHARACTERS, character) : null;
  if (
    character &&
    (!target ||
      target.data.deleted ||
      (target.createdBy ?? target.data.owner) !== recipient)
  )
    return failure("no_character");
  if (owned.data.character && !target) return failure("no_character");
  const transferred = ctx.set(INVENTORY, owned.id, {
    ...owned.data,
    owner: recipient,
    sender: ctx.member.id,
    memo,
    receivedAt: ctx.now,
    character,
  });
  record(ctx, "gift", {
    item: owned.data.item,
    inventory: owned.id,
    recipient,
    character,
    memo,
  });
  record(
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
export function craft(ctx, { recipe, materials, character = null } = {}) {
  if (character && !ownCharacter(ctx, character))
    return failure("no_character");
  const row = typeof recipe === "string" ? ctx.get(RECIPES, recipe) : null;
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
  const owned = materials.map((id) => ownedItem(ctx, id));
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
    typeof row.data.item === "string" ? ctx.get(ITEMS, row.data.item) : null;
  if (!prize) throw new Error("Recipe output item is missing.");
  const cost = amount(row.data.cost ?? 0, "Crafting cost");
  const current = wallet(ctx);
  if (current.balance < cost) return failure("not_enough");
  const balance = pay(ctx, current, cost);
  for (const item of owned) ctx.delete(INVENTORY, item.id);
  const output = give(ctx, prize, "craft", character);
  record(ctx, "craft", { character, item: prize.id, delta: -cost, balance });
  return { ok: true, balance, owned: output };
}

export function assignInventory(ctx, { inventory, character = null } = {}) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  if (character && !ownCharacter(ctx, character))
    return failure("no_character");
  return {
    ok: true,
    document: ctx.set(INVENTORY, owned.id, { ...owned.data, character }),
  };
}

/** Four built-in item actions mirror inventory/use_item.php. */
export function useItem(ctx, { inventory, character, data = {} } = {}) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  const item = ctx.get(ITEMS, owned.data.item);
  if (!item?.data.effect || item.data.usable === false)
    return failure("not_usable");
  if (owned.data.character && owned.data.character !== character)
    return failure("wrong_character");
  if (owned.data.character && !ownCharacter(ctx, character))
    return failure("not_owned");
  const requirements = item.data.useRequirements ?? {};
  if (
    requirements.approved ||
    requirements.sides?.length ||
    requirements.classes?.length ||
    requirements.exp ||
    requirements.title
  ) {
    if (!ownCharacter(ctx, character)) return failure("no_character");
    const official = characterState(ctx, character).data;
    if (requirements.approved && official.approved !== true)
      return failure("not_approved");
    for (const [key, field] of [
      ["sides", "side"],
      ["classes", "class"],
    ]) {
      if (
        requirements[key] !== undefined &&
        (!Array.isArray(requirements[key]) ||
          requirements[key].some((value) => typeof value !== "string"))
      )
        throw new Error("Use restrictions must be lists of identifiers.");
      if (
        requirements[key]?.length &&
        !requirements[key].includes(official[field])
      )
        return failure("restricted_character");
    }
    if (official.exp < amount(requirements.exp ?? 0, "Use experience"))
      return failure("not_enough_exp");
    if (
      requirements.title &&
      (!official.titles?.includes(requirements.title) ||
        ctx.get(TITLES, requirements.title)?.data.deleted)
    )
      return failure("missing_title");
  }
  const effect = item.data.effect;
  let result = { ok: true, name: owned.data.name };
  if (effect.type === "restore") {
    if (!ownCharacter(ctx, character)) return failure("not_owned");
    const state = characterState(ctx, character);
    if (
      typeof effect.stat !== "string" ||
      !Object.hasOwn(state.data.stats, effect.stat)
    )
      throw new Error("Recovery stat does not exist.");
    const recovery = amount(effect.amount, "Recovery amount");
    if (!recovery) throw new Error("Recovery amount must be positive.");
    const stat = state.data.stats[effect.stat];
    if (stat.current === stat.max) return failure("already_full");
    stat.damage = Math.max(0, stat.damage - recovery);
    stat.current = Math.max(0, stat.max - stat.damage);
    result.document = ctx.set(CHARACTER_STATE, character, state.data);
  } else if (effect.type === "draw") {
    const outcome = draw(ctx, item.id);
    if (!outcome.configured) return failure("empty");
    result.owned = outcome.prize
      ? give(ctx, outcome.prize, "item", owned.data.character ?? null)
      : null;
  } else if (effect.type === "create") {
    const name = text(data.name, 80, true);
    const description = text(data.description ?? "", 2000);
    const image = data.image ? imageUrl(data.image) : null;
    const personal = saveImage(
      ctx,
      ITEMS,
      null,
      {
        name,
        description,
        image,
        category: "personal",
        hidden: true,
        sellable: false,
      },
      data,
    );
    result.owned = give(
      ctx,
      personal,
      "personal",
      owned.data.character ?? null,
    );
  } else if (effect.type === "profile") {
    const target = ownCharacter(ctx, character);
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
    result.document = saveImage(
      ctx,
      CHARACTERS,
      target,
      profile,
      data,
      character,
    );
    result.mediaCleanup = Boolean(
      target.data.imageId &&
      target.data.imageId !== result.document.data.imageId,
    );
  } else return failure("not_usable");
  // The original personal-item creation form always consumes its ticket.
  if (item.data.reusable !== true || effect.type === "create")
    ctx.delete(INVENTORY, owned.id);
  record(ctx, "use", {
    item: item.id,
    inventory: owned.id,
    character: character ?? null,
    effect: effect.type,
  });
  return result;
}
