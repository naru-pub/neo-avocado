// The shop (shop/index.php): buying an item as one's approved character,
// and the paid gacha (뽑기).
import { onDisplay } from "../../modules/display.js";
import {
  amount,
  lacking,
  names,
  one,
  restrictedFor,
  signedIn,
} from "../../modules/access.js";
import {
  GACHA_COST,
  draw,
  give,
  itemById,
  offerData,
  ownedItems,
  pay,
  record,
  spend,
  wallet,
} from "../../modules/economy.js";
import {
  characterState,
  ownCharacter,
  saveState,
  withExp,
} from "../../modules/characters.js";
import type { Progress } from "../../modules/characters.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * Buys one of an item for one of the member's approved characters
 * (shop/_ajax.shop_update.php), at the catalogue's price and conditions:
 * no stock (stock) is no limit; an exchange takes the items it names from
 * that character's own (`materials`).
 */
export async function buy(
  ctx: MutationCtx,
  args: {
    item?: string;
    entry?: string;
    character?: string | null;
    materials?: string[];
  },
) {
  signedIn(ctx);
  const { item, entry, character = null, materials = [] } = args ?? {};
  let listing = await itemById(ctx, item);
  // 상점 진열 (avo_shop): an entry sells its item on its own terms, and
  // counts its own stock and 구매 한도.
  let limitKey = listing?.id;
  if (entry !== undefined) {
    const row = await one<any>(
      ctx,
      "SELECT * FROM shop_entries WHERE id = ? AND enabled != 0",
      [entry],
    );
    if (!listing || !row || row.item_id !== listing.id)
      ctx.fail("NOT_FOUND", "없는 아이템입니다.", { reason: "no_item" });
    listing = { ...listing, data: { ...listing.data, ...offerData(row) } };
    delete listing.data.hidden;
    if (row.stock === null) delete listing.data.stock;
    if (row.display === null) delete listing.data.display;
    limitKey = `entry:${row.id}`;
  } else if (listing?.data.hidden) listing = null;
  if (!listing)
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
  if (!progression.data.approved)
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
  ] as const) {
    if (
      requirements[key] !== undefined &&
      (!Array.isArray(requirements[key]) ||
        requirements[key].some((value) => typeof value !== "string"))
    )
      throw new Error(
        "Shop character restrictions must be lists of identifiers.",
      );
    if (requirements[key]?.length && !requirements[key].includes(buyer[field]))
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
    // A deleted title is taken from its holders with it.
    !progression.data.titles.includes(requirements.title)
  )
    ctx.fail("CONFLICT", "필요한 타이틀이 없습니다.", {
      reason: "missing_title",
    });
  // Limits count the character's purchases (_ajax.shop_update.php:89).
  const counts = { ...progression.data.purchases };
  const previous = amount(
    Object.hasOwn(counts, limitKey) ? counts[limitKey] : 0,
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
  Object.defineProperty(counts, limitKey, {
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
  const needed = new Map<string, { count: number; consume: boolean }>();
  for (const exchange of exchanges) {
    if (typeof exchange.item !== "string" || needed.has(exchange.item))
      throw new Error("Exchange items must have unique identifiers.");
    const count = amount(exchange.count, "Exchange count");
    if (!count) throw new Error("Exchange count must be positive.");
    needed.set(exchange.item, { count, consume: exchange.consume === true });
  }
  const supplied = await ownedItems(ctx, materials);
  if (supplied.some((row) => !row || row.data.character !== character))
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const provided = new Map<string, number>();
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
  let next: Progress = { ...progression.data, purchases: counts };
  if (requirements.consumeExp)
    next = await withExp(ctx, next, next.exp - expPrice);
  if (requirements.consumeTitle && requirements.title) {
    next.titles = next.titles.filter((id) => id !== requirements.title);
    if (next.activeTitle === requirements.title) next.activeTitle = null;
  }
  await saveState(ctx, character, next);
  await spend(
    ctx,
    supplied.filter((row) => needed.get(row.data.item).consume),
  );
  if (typeof stock === "number")
    await (entry !== undefined
      ? ctx.sql`UPDATE shop_entries SET stock = stock - 1 WHERE id = ${entry}`
      : ctx.sql`UPDATE items SET stock = stock - 1 WHERE id = ${listing.id}`);
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

/** 뽑기: GACHA_COST for a draw from the paid table, for a character or the member. */
export async function gacha(
  ctx: MutationCtx,
  args: { character?: string | null },
) {
  signedIn(ctx);
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
  return { balance, owned };
}
