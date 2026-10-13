import {
  INVENTORY,
  ITEMS,
  CHARACTER_STATE,
  TITLES,
  record,
  ownCharacter,
  failure,
  amount,
  DAILY_REWARD,
  GACHA_COST,
  kstDay,
  wallet,
  pay,
  give,
  draw,
  ownedItem,
  characterState,
} from "../../modules/shared.js";

/** 하루 한 번, 한국 시간으로 날이 바뀌면 받는 출석 보상. */
export function daily(ctx) {
  const current = wallet(ctx);
  const today = kstDay(ctx.now);
  if (current.lastDaily === today) return { ok: false, reason: "already" };
  const balance = pay(ctx, current, -DAILY_REWARD, { lastDaily: today });
  record(ctx, "daily", { delta: DAILY_REWARD, balance });
  return { ok: true, balance };
}

/** 상점에서 하나 산다. 재고(stock)가 없으면 무제한이다. */
export function buy(ctx, { item, character = null, materials = [] } = {}) {
  const listing = typeof item === "string" ? ctx.get(ITEMS, item) : null;
  if (!listing || listing.data.hidden) return { ok: false, reason: "no_item" };
  const { price = 0, stock } = listing.data;
  amount(price, "Price");
  if (stock !== undefined) amount(stock, "Stock");
  if (typeof stock === "number" && stock < 1)
    return { ok: false, reason: "sold_out" };
  const current = wallet(ctx);
  if (current.balance < price) return { ok: false, reason: "not_enough" };
  const requirements = listing.data.requirements ?? {};
  const needsCharacter =
    character ||
    requirements.approved ||
    requirements.sides?.length ||
    requirements.classes?.length ||
    requirements.exp ||
    requirements.title;
  const ownedCharacter = needsCharacter ? ownCharacter(ctx, character) : null;
  if (needsCharacter && !ownedCharacter) return failure("no_character");
  const progression = ownedCharacter ? characterState(ctx, character) : null;
  if (requirements.approved && progression.data.approved !== true)
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
      throw new Error(
        "Shop character restrictions must be lists of identifiers.",
      );
    if (
      requirements[key]?.length &&
      !requirements[key].includes(progression.data[field])
    )
      return failure("restricted_character");
  }
  const expPrice = amount(requirements.exp ?? 0, "Required experience");
  if (expPrice && progression.data.exp < expPrice)
    return failure("not_enough_exp");
  if (
    requirements.title &&
    (!progression.data.titles?.includes(requirements.title) ||
      ctx.get(TITLES, requirements.title)?.data.deleted)
  )
    return failure("missing_title");
  const counts = {
    ...(progression ? progression.data.purchases : current.purchases),
  };
  const previous = amount(
    Object.hasOwn(counts, listing.id) ? counts[listing.id] : 0,
    "Purchase count",
  );
  if (
    requirements.limit !== undefined &&
    previous >= amount(requirements.limit, "Purchase limit")
  )
    return failure("purchase_limit");
  if (previous === Number.MAX_SAFE_INTEGER)
    throw new Error("Purchase count overflow.");
  Object.defineProperty(counts, listing.id, {
    value: previous + 1,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const exchanges = requirements.items ?? [];
  if (
    !Array.isArray(exchanges) ||
    !Array.isArray(materials) ||
    materials.length > 18 ||
    new Set(materials).size !== materials.length ||
    materials.some((id) => typeof id !== "string")
  )
    return failure("invalid_materials");
  const needed = new Map();
  for (const exchange of exchanges) {
    if (typeof exchange.item !== "string" || needed.has(exchange.item))
      throw new Error("Exchange items must have unique identifiers.");
    const count = amount(exchange.count, "Exchange count");
    if (!count) throw new Error("Exchange count must be positive.");
    needed.set(exchange.item, { count, consume: exchange.consume === true });
  }
  const supplied = materials.map((id) => ownedItem(ctx, id));
  if (
    supplied.some((row) => !row || (row.data.character ?? null) !== character)
  )
    return failure("not_owned");
  const provided = new Map();
  for (const row of supplied)
    provided.set(row.data.item, (provided.get(row.data.item) ?? 0) + 1);
  if (
    provided.size !== needed.size ||
    [...needed].some(([id, rule]) => provided.get(id) !== rule.count)
  )
    return failure("invalid_materials");
  const debit = requirements.consumeMoney === false ? 0 : price;
  const balance = pay(
    ctx,
    current,
    debit,
    progression ? {} : { purchases: counts },
  );
  if (progression) {
    const next = { ...progression.data, purchases: counts };
    if (requirements.consumeExp) next.exp -= expPrice;
    if (requirements.consumeTitle && requirements.title) {
      next.titles = next.titles.filter((id) => id !== requirements.title);
      if (next.activeTitle === requirements.title) next.activeTitle = null;
    }
    ctx.set(CHARACTER_STATE, character, next);
  }
  for (const row of supplied)
    if (needed.get(row.data.item).consume) ctx.delete(INVENTORY, row.id);
  if (typeof stock === "number")
    ctx.set(ITEMS, listing.id, { ...listing.data, stock: stock - 1 });
  const owned = give(ctx, listing, "shop", character);
  record(ctx, "buy", {
    character,
    item: listing.id,
    inventory: owned.id,
    delta: -debit,
    balance,
    expDelta: requirements.consumeExp ? -expPrice : 0,
  });
  return { ok: true, balance, owned };
}

export function gacha(ctx, args = {}) {
  const { character = null } = args ?? {};
  if (character && !ownCharacter(ctx, character))
    return failure("no_character");
  const current = wallet(ctx);
  if (current.balance < GACHA_COST) return failure("not_enough");
  const result = draw(ctx);
  if (!result.configured) return failure("empty");
  const balance = pay(ctx, current, GACHA_COST);
  const owned = result.prize
    ? give(ctx, result.prize, "gacha", character)
    : null;
  record(ctx, "gacha", {
    character,
    item: result.prize?.id ?? null,
    delta: -GACHA_COST,
    balance,
  });
  return {
    ok: true,
    balance,
    owned,
  };
}
