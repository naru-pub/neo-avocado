import { onDisplay } from "../../modules/display.js";
import {
  INVENTORY,
  ITEMS,
  CHARACTER_STATE,
  TITLES,
  record,
  ownCharacter,
  amount,
  GACHA_COST,
  wallet,
  pay,
  give,
  draw,
  ownedItem,
  characterState,
  lacking,
  names,
  restrictedFor,
  withExp,
} from "../../modules/shared.js";
import type { Ctx, Data } from "../../modules/naru-types.js";

/**
 * 상점에서 승인된 내 캐릭터로 하나 산다. 재고(stock)가 없으면 무제한이다.
 */
export async function buy(
  ctx: Ctx,
  {
    item,
    character = null,
    materials = [],
  }: { item?: string; character?: string | null; materials?: string[] } = {},
) {
  const listing = typeof item === "string" ? await ctx.get(ITEMS, item) : null;
  if (!listing || listing.data.hidden)
    ctx.fail("NOT_FOUND", "없는 아이템입니다.", { reason: "no_item" });
  if (!onDisplay(listing.data.display, ctx.now))
    ctx.fail("CONFLICT", "지금은 진열 기간이 아닙니다.", {
      reason: "not_on_display",
    });
  const { price = 0, stock } = listing.data;
  amount(price, "Price");
  if (stock !== undefined) amount(stock, "Stock");
  if (typeof stock === "number" && stock < 1)
    ctx.fail("CONFLICT", "품절입니다.", { reason: "sold_out" });
  // Buying is a character's, and only an approved one's
  // (shop/_ajax.shop_update.php:4, shop.item.skin.php:24).
  const buyer = await ownCharacter(ctx, character);
  if (!buyer)
    ctx.fail("INVALID_REQUEST", "구매할 내 캐릭터를 골라 주세요.", {
      reason: "no_character",
    });
  const progression = await characterState(ctx, character);
  if (progression.data.approved !== true)
    ctx.fail("CONFLICT", "승인된 캐릭터만 할 수 있습니다.", {
      reason: "not_approved",
    });
  const current = await wallet(ctx);
  if (current.balance < price)
    ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
      reason: "not_enough",
    });
  const requirements = listing.data.requirements ?? {};
  // A character has one 소속 and 종족, the member's pick on its sheet
  // (ch_side, ch_class; shop/_ajax.shop_update.php:108-115).
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
      !requirements[key].includes(buyer.data[field])
    )
      ctx.fail("CONFLICT", restrictedFor(await names(ctx), "구매할"), {
        reason: "restricted_character",
      });
  }
  const expPrice = amount(requirements.exp ?? 0, "Required experience");
  if (expPrice && progression.data.exp < expPrice)
    ctx.fail("CONFLICT", await lacking(ctx, "expName"), {
      reason: "not_enough_exp",
    });
  if (
    requirements.title &&
    (!progression.data.titles?.includes(requirements.title) ||
      (await ctx.get(TITLES, requirements.title))?.data.deleted)
  )
    ctx.fail("CONFLICT", "필요한 타이틀이 없습니다.", {
      reason: "missing_title",
    });
  // Limits count the character's purchases (_ajax.shop_update.php:89).
  const counts = { ...progression.data.purchases };
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
  const balance = await pay(ctx, current, debit);
  let next: Data = { ...progression.data, purchases: counts };
  if (requirements.consumeExp)
    next = await withExp(ctx, next, next.exp - expPrice);
  if (requirements.consumeTitle && requirements.title) {
    next.titles = next.titles.filter((id) => id !== requirements.title);
    if (next.activeTitle === requirements.title) next.activeTitle = null;
  }
  await ctx.set(CHARACTER_STATE, character, next);
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

export async function gacha(
  ctx: Ctx,
  args: { character?: string | null } = {},
) {
  const { character = null } = args ?? {};
  if (character && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const current = await wallet(ctx);
  if (current.balance < GACHA_COST)
    ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
      reason: "not_enough",
    });
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
