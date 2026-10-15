import {
  INVENTORY,
  ITEMS,
  CHARACTER_STATE,
  TITLES,
  record,
  ownCharacter,
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
export async function daily(ctx) {
  const current = await wallet(ctx);
  const today = kstDay(ctx.now);
  if (current.lastDaily === today)
    ctx.fail("CONFLICT", "오늘은 이미 받았습니다.", { reason: "already" });
  const balance = await pay(ctx, current, -DAILY_REWARD, { lastDaily: today });
  await record(ctx, "daily", { delta: DAILY_REWARD, balance });
  return { balance };
}

/** 상점에서 하나 산다. 재고(stock)가 없으면 무제한이다. */
export async function buy(
  ctx,
  { item, character = null, materials = [] } = {},
) {
  const listing = typeof item === "string" ? await ctx.get(ITEMS, item) : null;
  if (!listing || listing.data.hidden)
    ctx.fail("NOT_FOUND", "없는 아이템입니다.", { reason: "no_item" });
  const { price = 0, stock } = listing.data;
  amount(price, "Price");
  if (stock !== undefined) amount(stock, "Stock");
  if (typeof stock === "number" && stock < 1)
    ctx.fail("CONFLICT", "품절입니다.", { reason: "sold_out" });
  const current = await wallet(ctx);
  if (current.balance < price)
    ctx.fail("CONFLICT", "아보가 모자랍니다.", { reason: "not_enough" });
  const requirements = listing.data.requirements ?? {};
  const needsCharacter =
    character ||
    requirements.approved ||
    requirements.sides?.length ||
    requirements.classes?.length ||
    requirements.exp ||
    requirements.title;
  const ownedCharacter = needsCharacter
    ? await ownCharacter(ctx, character)
    : null;
  if (needsCharacter && !ownedCharacter)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const progression = ownedCharacter
    ? await characterState(ctx, character)
    : null;
  if (requirements.approved && progression.data.approved !== true)
    ctx.fail("CONFLICT", "승인된 캐릭터만 할 수 있습니다.", {
      reason: "not_approved",
    });
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
      ctx.fail("CONFLICT", "이 캐릭터의 세력·종족은 구매할 수 없습니다.", {
        reason: "restricted_character",
      });
  }
  const expPrice = amount(requirements.exp ?? 0, "Required experience");
  if (expPrice && progression.data.exp < expPrice)
    ctx.fail("CONFLICT", "경험치가 모자랍니다.", { reason: "not_enough_exp" });
  if (
    requirements.title &&
    (!progression.data.titles?.includes(requirements.title) ||
      (await ctx.get(TITLES, requirements.title))?.data.deleted)
  )
    ctx.fail("CONFLICT", "필요한 타이틀이 없습니다.", {
      reason: "missing_title",
    });
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
    ctx.fail("CONFLICT", "이 아이템의 구매 한도에 도달했습니다.", {
      reason: "purchase_limit",
    });
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
    ctx.fail("INVALID_REQUEST", "레시피에 맞는 재료를 선택해 주세요.", {
      reason: "invalid_materials",
    });
  const needed = new Map();
  for (const exchange of exchanges) {
    if (typeof exchange.item !== "string" || needed.has(exchange.item))
      throw new Error("Exchange items must have unique identifiers.");
    const count = amount(exchange.count, "Exchange count");
    if (!count) throw new Error("Exchange count must be positive.");
    needed.set(exchange.item, { count, consume: exchange.consume === true });
  }
  const supplied = await Promise.all(materials.map((id) => ownedItem(ctx, id)));
  if (
    supplied.some((row) => !row || (row.data.character ?? null) !== character)
  )
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const provided = new Map();
  for (const row of supplied)
    provided.set(row.data.item, (provided.get(row.data.item) ?? 0) + 1);
  if (
    provided.size !== needed.size ||
    [...needed].some(([id, rule]) => provided.get(id) !== rule.count)
  )
    ctx.fail("INVALID_REQUEST", "레시피에 맞는 재료를 선택해 주세요.", {
      reason: "invalid_materials",
    });
  const debit = requirements.consumeMoney === false ? 0 : price;
  const balance = await pay(
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
    await ctx.set(CHARACTER_STATE, character, next);
  }
  for (const row of supplied)
    if (needed.get(row.data.item).consume) await ctx.delete(INVENTORY, row.id);
  if (typeof stock === "number")
    await ctx.set(ITEMS, listing.id, { ...listing.data, stock: stock - 1 });
  const owned = await give(ctx, listing, "shop", character);
  await record(ctx, "buy", {
    character,
    item: listing.id,
    inventory: owned.id,
    delta: -debit,
    balance,
    expDelta: requirements.consumeExp ? -expPrice : 0,
  });
  return { balance, owned };
}

export async function gacha(ctx, args = {}) {
  const { character = null } = args ?? {};
  if (character && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const current = await wallet(ctx);
  if (current.balance < GACHA_COST)
    ctx.fail("CONFLICT", "아보가 모자랍니다.", { reason: "not_enough" });
  const result = await draw(ctx);
  if (!result.configured)
    ctx.fail("CONFLICT", "아직 뽑을 것이 없습니다.", { reason: "empty" });
  const balance = await pay(ctx, current, GACHA_COST);
  const owned = result.prize
    ? await give(ctx, result.prize, "gacha", character)
    : null;
  await record(ctx, "gacha", {
    character,
    item: result.prize?.id ?? null,
    delta: -GACHA_COST,
    balance,
  });
  return {
    balance,
    owned,
  };
}
