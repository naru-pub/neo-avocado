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
import { presentCharacter } from "../../modules/characters.js";

/** Selling consumes exactly one owned item; prices always come from the catalog. */
export async function sell(ctx, { inventory } = {}) {
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
  ctx,
  { inventory, recipient, character = null, memo = "" } = {},
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
    !(await ctx.get(PROFILES, recipient))
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
    from?.data.name ??
    (await ctx.get(PROFILES, ctx.member.id))?.data.nick ??
    "";
  const transferred = await ctx.set(INVENTORY, owned.id, {
    ...owned.data,
    owner: recipient,
    sender: ctx.member.id,
    senderName,
    memo,
    receivedAt: ctx.now,
    character,
  });
  if (!self) {
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
export async function craft(ctx, { recipe, materials, character = null } = {}) {
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
  for (const item of owned) await ctx.delete(INVENTORY, item.id);
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
  ctx,
  { inventory, character = null } = {},
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

/** Four built-in item actions mirror inventory/use_item.php. */
export async function useItem(ctx, { inventory, character, data = {} } = {}) {
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
  await requireUsable(ctx, item, character);
  const effect = item.data.effect;
  let result = { name: owned.data.name };
  if (effect.type === "restore") {
    if (!(await ownCharacter(ctx, character)))
      ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
        reason: "not_owned",
      });
    const restored = await restoreStat(ctx, effect, character);
    if (!restored)
      ctx.fail("CONFLICT", "이미 전부 회복되었습니다.", {
        reason: "already_full",
      });
    result.document = restored;
  } else if (effect.type === "draw") {
    const outcome = await draw(ctx, item.id);
    if (!outcome.configured)
      ctx.fail("CONFLICT", "아직 뽑을 것이 없습니다.", { reason: "empty" });
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
    if (!target)
      ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
        reason: "not_owned",
      });
    if (data.revision !== target.revision)
      ctx.fail(
        "CONFLICT",
        "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
        { reason: "conflict" },
      );
    const profile = {
      ...target.data,
      name: text(data.name, 40, true),
      // Left out while the owner hides 소속 (an empty cf_side_title).
      side: Object.hasOwn(data, "side")
        ? text(data.side ?? "", 40)
        : (target.data.side ?? ""),
      profile: text(data.profile ?? "", 4000),
    };
    if (Object.hasOwn(data, "image"))
      profile.image = data.image ? imageUrl(data.image) : null;
    delete profile.imageId;
    result.document = await presentCharacter(
      ctx,
      await ctx.set(CHARACTERS, character, profile),
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
