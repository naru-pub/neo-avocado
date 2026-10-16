import {
  INVENTORY,
  ITEMS,
  RECIPES,
  CHARACTERS,
  record,
  ownCharacter,
  text,
  imageUrl,
  amount,
  wallet,
  pay,
  give,
  draw,
  ownedItem,
  requireUsable,
  restoreStat,
  lacking,
  MESSAGES,
} from "../../modules/shared.js";
import { profileOf } from "../../modules/members.js";
import type { Ctx, Data, NaruDocument } from "../../modules/naru-types.js";

/** Selling consumes exactly one owned item; prices always come from the catalog. */
export async function sell(
  ctx: Ctx,
  { inventory }: { inventory?: string } = {},
) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const item = await ctx.get(ITEMS, owned.data.item);
  if (
    !item ||
    item.data.sellPrice === undefined ||
    item.data.sellable === false
  )
    ctx.fail("CONFLICT", "판매할 수 없는 아이템입니다.", {
      reason: "not_sellable",
    });
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
  return { balance, name: owned.data.name };
}

/**
 * Gives an item to a character (inventory/inventory_update.php): another
 * member's, or one of the sender's own. The recipient must be an existing
 * member profile, never a browser-supplied owner. The item remembers who
 * sent it and the message (se_ch_name, in_memo), and another member hears
 * of it by 쪽지, as the original's send_memo.
 */
export async function gift(
  ctx: Ctx,
  {
    inventory,
    recipient,
    character = null,
    memo = "",
  }: {
    inventory?: string;
    /** The receiving member's ID. */
    recipient?: string;
    character?: string | null;
    memo?: string;
  } = {},
) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const self = recipient === ctx.member.id;
  if (
    typeof recipient !== "string" ||
    (self && !character) ||
    !(await profileOf(ctx, recipient))
  )
    ctx.fail("INVALID_REQUEST", "받는 회원을 확인해 주세요.", {
      reason: "no_recipient",
    });
  if (typeof memo !== "string" || memo.length > 500)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const item = await ctx.get(ITEMS, owned.data.item);
  if (!item || item.data.giftable === false)
    ctx.fail("CONFLICT", "선물할 수 없는 아이템입니다.", {
      reason: "not_giftable",
    });
  const target =
    typeof character === "string" ? await ctx.get(CHARACTERS, character) : null;
  if (
    character &&
    (!target ||
      target.data.deleted ||
      (target.createdBy ?? target.data.owner) !== recipient)
  )
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  if (owned.data.character && !target)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  if (self && owned.data.character === character)
    ctx.fail("INVALID_REQUEST", "이미 이 캐릭터의 아이템입니다.", {
      reason: "same_character",
    });
  // By. the sending character, or the member's nickname (se_ch_name).
  const from = owned.data.character
    ? await ctx.get(CHARACTERS, owned.data.character)
    : null;
  const senderName =
    from?.data.name ?? (await profileOf(ctx, ctx.member.id))?.data.nick ?? "";
  const transferred = await ctx.set(INVENTORY, owned.id, {
    ...owned.data,
    owner: recipient,
    sender: ctx.member.id,
    senderName,
    memo,
    receivedAt: ctx.now,
    character,
  });
  // The item arrives either way; the note only to a member taking 쪽지.
  if (
    !self &&
    (await profileOf(ctx, recipient))?.data.acceptMessages !== false
  ) {
    await ctx.add(MESSAGES, {
      from: ctx.member.id,
      to: recipient,
      body: `[ ${senderName}님이 보내신 《${owned.data.name ?? item.data.name}》 아이템이 도착하였습니다. ] 캐릭터 인벤토리를 확인하세요.`,
      sentAt: ctx.now,
      readAt: null,
      gift: true,
    });
    ctx.notify(recipient, { unread: true });
  }
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
  return { owned: transferred };
}

/** Selected materials are checked against the owner's recipe, then consumed atomically. */
export async function craft(
  ctx: Ctx,
  {
    recipe,
    materials,
    character = null,
  }: { recipe?: string; materials?: string[]; character?: string | null } = {},
) {
  if (character && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const row =
    typeof recipe === "string" ? await ctx.get(RECIPES, recipe) : null;
  if (!row || row.data.hidden)
    ctx.fail("NOT_FOUND", "없는 레시피입니다.", { reason: "no_recipe" });
  if (
    !Array.isArray(materials) ||
    materials.length > 20 ||
    materials.some((id) => typeof id !== "string") ||
    new Set(materials).size !== materials.length
  )
    ctx.fail("INVALID_REQUEST", "레시피에 맞는 재료를 선택해 주세요.", {
      reason: "invalid_materials",
    });
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
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const provided = new Map();
  for (const item of owned)
    provided.set(item.data.item, (provided.get(item.data.item) ?? 0) + 1);
  if (
    provided.size !== required.size ||
    [...required].some(([item, count]) => provided.get(item) !== count)
  )
    ctx.fail("INVALID_REQUEST", "레시피에 맞는 재료를 선택해 주세요.", {
      reason: "invalid_materials",
    });
  // Only craft materials go in (it_use_recepi), and a reusable one stays
  // (it_use_ever), as in the original's 조합.
  const catalogue = await ctx.getMany(ITEMS, [...required.keys()]);
  if (catalogue.some((item) => item?.data.craftMaterial !== true))
    ctx.fail("INVALID_REQUEST", "조합 재료로 쓸 수 없는 아이템입니다.", {
      reason: "not_material",
    });
  const reusable = new Set(
    catalogue
      .filter((item) => item.data.reusable === true)
      .map((item) => item.id),
  );
  const prize =
    typeof row.data.item === "string"
      ? await ctx.get(ITEMS, row.data.item)
      : null;
  if (!prize) throw new Error("Recipe output item is missing.");
  const cost = amount(row.data.cost ?? 0, "Crafting cost");
  const current = await wallet(ctx);
  if (current.balance < cost)
    ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
      reason: "not_enough",
    });
  const balance = await pay(ctx, current, cost);
  for (const item of owned)
    if (!reusable.has(item.data.item)) await ctx.delete(INVENTORY, item.id);
  const output = await give(ctx, prize, "craft", character);
  await record(ctx, "craft", {
    character,
    item: prize.id,
    delta: -cost,
    balance,
  });
  return { balance, owned: output };
}

export async function assignInventory(
  ctx: Ctx,
  {
    inventory,
    character = null,
  }: { inventory?: string; character?: string | null } = {},
) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  if (character && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  return {
    document: await ctx.set(INVENTORY, owned.id, { ...owned.data, character }),
  };
}

/** What a personal-item (create) ticket sends. */
export interface ItemUseInput {
  name?: string;
  description?: string;
  image?: string | null;
}

/**
 * Three built-in item actions mirror inventory/use_item.php; the fourth,
 * 프로필수정, is spent by characters/sheet:save.
 */
export async function useItem(
  ctx: Ctx,
  {
    inventory,
    character,
    data = {},
  }: { inventory?: string; character?: string; data?: ItemUseInput } = {},
) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const item = await ctx.get(ITEMS, owned.data.item);
  if (!item?.data.effect || item.data.usable === false)
    ctx.fail("CONFLICT", "사용할 수 없는 아이템입니다.", {
      reason: "not_usable",
    });
  if (owned.data.character && owned.data.character !== character)
    ctx.fail("CONFLICT", "이 아이템을 가진 캐릭터를 선택해 주세요.", {
      reason: "wrong_character",
    });
  if (owned.data.character && !(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const effect = item.data.effect;
  // 프로필수정 is used by saving the character's form with it
  // (characters/sheet:save's ticket), as the original opens that form.
  if (effect.type === "profile")
    ctx.fail(
      "CONFLICT",
      "프로필 수정 아이템은 캐릭터 수정 화면에서 저장할 때 사용됩니다.",
      { reason: "use_from_sheet" },
    );
  await requireUsable(ctx, item, character);
  let result: {
    name: string;
    document?: NaruDocument | null;
    owned?: NaruDocument | null;
  } = { name: owned.data.name };
  if (effect.type === "restore") {
    if (!(await ownCharacter(ctx, character)))
      ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
        reason: "not_owned",
      });
    result.document = await restoreStat(ctx, effect, character);
  } else if (effect.type === "draw") {
    const outcome = await draw(ctx, item.id);
    if (!outcome.configured)
      ctx.fail("CONFLICT", "아직 뽑을 것이 없습니다.", { reason: "empty" });
    result.owned = outcome.prize
      ? await give(ctx, outcome.prize, "item", owned.data.character ?? null)
      : null;
  } else if (effect.type === "create") {
    // The form asks for all three (inventory/inc/add_item_form.php:26-32).
    if (
      [data.name, data.description, data.image].some(
        (value) => typeof value !== "string" || !value.trim(),
      )
    )
      ctx.fail("INVALID_REQUEST", "이름, 설명, 이미지를 모두 입력해 주세요.", {
        reason: "invalid_input",
      });
    const name = text(data.name, 80, true);
    const description = text(data.description ?? "", 2000, true);
    const image = imageUrl(data.image);
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
  } else
    ctx.fail("CONFLICT", "사용할 수 없는 아이템입니다.", {
      reason: "not_usable",
    });
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
