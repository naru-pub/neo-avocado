// What a member does with what they hold (inventory/): selling, gifts,
// crafting, moving a copy between their characters, and using an item.
import {
  activeMember,
  amount,
  invalid,
  lacking,
  signedIn,
} from "../../modules/access.js";
import type { Character } from "../../modules/characters.js";
import {
  characterKey,
  characterRow,
  ownCharacter,
} from "../../modules/characters.js";
import type { Owned } from "../../modules/economy.js";
import {
  draw,
  give,
  itemById,
  itemsByIds,
  makePersonalItem,
  ownedItem,
  ownedItems,
  pay,
  recipeById,
  record,
  requireUsable,
  restoreStat,
  spend,
  wallet,
} from "../../modules/economy.js";
import { sendNote } from "../../modules/mail.js";
import { profileOf } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/** The refusal for a copy that is not the caller's. */
function notOwned(ctx: MutationCtx): never {
  ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
    reason: "not_owned",
  });
}

/** Selling consumes exactly one owned item; prices always come from the catalog. */
export async function sell(ctx: MutationCtx, args: { inventory?: string }) {
  await activeMember(ctx);
  const owned = await ownedItem(ctx, args?.inventory);
  if (!owned) notOwned(ctx);
  const item = await itemById(ctx, owned.data.item);
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
  await spend(ctx, [owned]);
  await record(ctx, "sell", {
    character: owned.data.character,
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
 * sent it and the message (se_ch_name, in_memo), and another member taking
 * 쪽지 hears of it by one, as the original's send_memo, in the same
 * transaction.
 */
export async function gift(
  ctx: MutationCtx,
  args: {
    inventory?: string;
    /** The receiving member's ID. */
    recipient?: string;
    character?: string | null;
    memo?: string;
  },
) {
  const me = await activeMember(ctx);
  const { inventory, recipient, character = null, memo = "" } = args ?? {};
  const owned = await ownedItem(ctx, inventory);
  if (!owned) notOwned(ctx);
  const self = recipient === me;
  const receiver =
    typeof recipient === "string" ? await profileOf(ctx, recipient) : null;
  if (!receiver || (self && !character))
    ctx.fail("INVALID_REQUEST", "받는 회원을 확인해 주세요.", {
      reason: "no_recipient",
    });
  if (typeof memo !== "string" || memo.length > 500) invalid(ctx);
  const item = await itemById(ctx, owned.data.item);
  if (!item || item.data.giftable === false)
    ctx.fail("CONFLICT", "선물할 수 없는 아이템입니다.", {
      reason: "not_giftable",
    });
  const target = character ? await characterRow(ctx, character) : null;
  // A deleted (삭제) character takes no gifts.
  if (
    character &&
    (!target || target.owner !== recipient || target.state === "deleted")
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
    ? await characterRow(ctx, owned.data.character)
    : null;
  const senderName = from?.name ?? (await profileOf(ctx, me))?.data.nick ?? "";
  await ctx.sql`UPDATE inventory SET owner = ${recipient}, character_id = ${target ? target.id : null}, gift = ${JSON.stringify(
    { sender: me, senderName, memo, receivedAt: ctx.now },
  )} WHERE id = ${Number(owned.id)}`;
  const transferred = {
    id: owned.id,
    data: {
      ...owned.data,
      owner: recipient,
      sender: me,
      senderName,
      memo,
      receivedAt: ctx.now,
      character,
    },
  };
  // The item arrives either way; the note only to a member taking 쪽지.
  const notice = !self && receiver.data.acceptMessages !== false;
  if (notice)
    await sendNote(
      ctx,
      recipient,
      `[ ${senderName}님이 보내신 《${owned.data.name || item.data.name}》 아이템이 도착하였습니다. ] 캐릭터 인벤토리를 확인하세요.`,
      { kind: "item", inventory: owned.id },
    );
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
      sender: me,
      character,
      memo,
    },
    recipient,
  );
  return { owned: transferred, notice };
}

/** Selected materials are checked against the owner's recipe, then consumed atomically. */
export async function craft(
  ctx: MutationCtx,
  args: { recipe?: string; materials?: string[]; character?: string | null },
) {
  signedIn(ctx);
  const { recipe, materials, character = null } = args ?? {};
  if (character && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const row = await recipeById(ctx, recipe);
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
  if (!ingredients.length || ingredients.length > 20)
    throw new Error("Recipe ingredients must be a non-empty list.");
  const required = new Map<string, number>();
  for (const ingredient of ingredients)
    required.set(
      ingredient.item,
      (required.get(ingredient.item) ?? 0) +
        amount(ingredient.count, "Ingredient count"),
    );
  const owned = await ownedItems(ctx, materials);
  if (owned.some((item) => !item || item.data.character !== character))
    notOwned(ctx);
  const provided = new Map<string, number>();
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
  const catalogue = await itemsByIds(ctx, [...required.keys()]);
  if (
    [...required.keys()].some(
      (id) => catalogue.get(id)?.data.craftMaterial !== true,
    )
  )
    ctx.fail("INVALID_REQUEST", "조합 재료로 쓸 수 없는 아이템입니다.", {
      reason: "not_material",
    });
  const prize = await itemById(ctx, row.data.item);
  if (!prize) throw new Error("Recipe output item is missing.");
  const cost = amount(row.data.cost ?? 0, "Crafting cost");
  const current = await wallet(ctx);
  if (current.balance < cost)
    ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
      reason: "not_enough",
    });
  const balance = await pay(ctx, current, cost);
  await spend(
    ctx,
    owned.filter(
      (item) => catalogue.get(item.data.item).data.reusable !== true,
    ),
  );
  const output = await give(ctx, prize, "craft", character);
  await record(ctx, "craft", {
    character,
    item: prize.id,
    delta: -cost,
    balance,
  });
  return { balance, owned: output };
}

/** Moves a copy to one of the member's characters, or to no character. */
export async function assignInventory(
  ctx: MutationCtx,
  args: { inventory?: string; character?: string | null },
) {
  signedIn(ctx);
  const { inventory, character = null } = args ?? {};
  const owned = await ownedItem(ctx, inventory);
  if (!owned) notOwned(ctx);
  if (character && !(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  await ctx.sql`UPDATE inventory SET character_id = ${characterKey(character)} WHERE id = ${Number(owned.id)}`;
  return { document: { ...owned, data: { ...owned.data, character } } };
}

/** What a personal-item (create) ticket sends. */
export interface ItemUseInput {
  name?: string;
  description?: string;
  image?: string | null;
}

/**
 * Three built-in item actions mirror inventory/use_item.php; the fourth,
 * 프로필수정, is spent by saving the character's sheet with it
 * (characters/sheet:save's `ticket`).
 */
export async function useItem(
  ctx: MutationCtx,
  args: { inventory?: string; character?: string; data?: ItemUseInput },
) {
  signedIn(ctx);
  const { inventory, character, data = {} } = args ?? {};
  const owned = await ownedItem(ctx, inventory);
  if (!owned) notOwned(ctx);
  const item = await itemById(ctx, owned.data.item);
  if (!item?.data.effect || item.data.usable === false)
    ctx.fail("CONFLICT", "사용할 수 없는 아이템입니다.", {
      reason: "not_usable",
    });
  if (owned.data.character && owned.data.character !== character)
    ctx.fail("CONFLICT", "이 아이템을 가진 캐릭터를 선택해 주세요.", {
      reason: "wrong_character",
    });
  if (owned.data.character && !(await ownCharacter(ctx, character)))
    notOwned(ctx);
  const effect = item.data.effect;
  // 프로필수정 is used by saving the character's form with it, as the
  // original opens that form.
  if (effect.type === "profile")
    ctx.fail(
      "CONFLICT",
      "프로필 수정 아이템은 캐릭터 수정 화면에서 저장할 때 사용됩니다.",
      { reason: "use_from_sheet" },
    );
  await requireUsable(ctx, item, character);
  const result: {
    name: string;
    document?: Character | null;
    owned?: Owned | null;
  } = { name: owned.data.name };
  if (effect.type === "restore") {
    if (!(await ownCharacter(ctx, character))) notOwned(ctx);
    result.document = await restoreStat(ctx, effect, character);
  } else if (effect.type === "draw") {
    const outcome = await draw(ctx, item.id);
    if (!outcome.configured)
      ctx.fail("CONFLICT", "아직 뽑을 것이 없습니다.", { reason: "empty" });
    result.owned = outcome.prize
      ? await give(ctx, outcome.prize, "item", owned.data.character)
      : null;
  } else if (effect.type === "create") {
    const personal = await makePersonalItem(ctx, owned, data ?? {});
    result.owned = await give(ctx, personal, "personal", owned.data.character);
  } else
    ctx.fail("CONFLICT", "사용할 수 없는 아이템입니다.", {
      reason: "not_usable",
    });
  // The original personal-item creation form always consumes its ticket.
  if (item.data.reusable !== true || effect.type === "create")
    await spend(ctx, [owned]);
  await record(ctx, "use", {
    item: item.id,
    inventory: owned.id,
    character: character ?? null,
    effect: effect.type,
  });
  return result;
}
