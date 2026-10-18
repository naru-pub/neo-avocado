// The economy in the site's tables: the shop's items, what members hold, the
// recipes, the draw tables, and the money a member pays with. The queries
// and mutations in economy/ use it, and so do the boards' (a post's 탐색,
// 조합 and items, its rewards), so an
// item reads the same everywhere. Items and held copies keep the shape pages
// know ({ id, data }); a held copy's ID is its row's number as a string.
import {
  amount,
  imageUrl,
  lacking,
  names,
  one,
  parsed,
  restrictedFor,
  text,
} from "./access.js";
import type { SqlCtx } from "./access.js";
import { addHistory, saveWallet, walletOf } from "./members.js";
import type { Wallet } from "./members.js";
import {
  characterKey,
  characterRow,
  characterState,
  ownCharacter,
  saveState,
  sheetOf,
} from "./characters.js";
import type { CharacterRow } from "./characters.js";
import type { QueryCtx, SqlValue } from "./naru-types.js";

/** What economy code uses of a call's ctx: the caller, `sql`, `fail` and `now`. */
export type EconomyCtx = SqlCtx &
  Pick<QueryCtx, "fail"> & { readonly now: number };

/** What the paid gacha (뽑기) costs. */
export const GACHA_COST = 50;

/** An items row. */
export interface ItemRow {
  id: string;
  item_type?: string;
  name: string;
  description: string;
  effect_description: string;
  shop_talk: string;
  image: string | null;
  shop_category: string;
  display: string | null;
  price: number;
  stock: number | null;
  sell_price: number | null;
  sort_order: number;
  hidden: number;
  sellable: number;
  giftable: number;
  usable: number;
  usable_in_posts: number;
  craft_material: number;
  reusable: number;
  effect: string | null;
  requirements: string;
  use_requirements: string;
  personal: number;
  /** 아이템 분류 (it_category): general, personal or attendance. */
  category: string;
  /** 상세이미지 (it_1). */
  detail_image: string | null;
}

/** An item as pages and old code read it. */
export interface Item {
  id: string;
  data: Record<string, any>;
}

/** A row as an item document; what it has none of, it leaves out. */
export function itemOf(row: ItemRow): Item {
  const data: Record<string, any> = {
    name: row.name,
    description: row.description,
    effectDescription: row.effect_description,
    shopTalk: row.shop_talk,
    shopCategory: row.shop_category,
    price: row.price,
    order: row.sort_order,
    hidden: row.hidden !== 0,
    sellable: row.sellable !== 0,
    giftable: row.giftable !== 0,
    usable: row.usable !== 0,
    usableInPosts: row.usable_in_posts !== 0,
    craftMaterial: row.craft_material !== 0,
    reusable: row.reusable !== 0,
    requirements: parsed(row.requirements, {}),
    useRequirements: parsed(row.use_requirements, {}),
  };
  if (row.image !== null) data.image = row.image;
  if (row.detail_image) data.detailImage = row.detail_image;
  data.category = row.category ?? "general";
  if (row.display !== null) data.display = parsed(row.display, {});
  if (row.stock !== null) data.stock = row.stock;
  if (row.sell_price !== null) data.sellPrice = row.sell_price;
  const effect = parsed<Record<string, any> | null>(row.effect, null);
  if (effect) data.effect = effect;
  if (row.personal !== 0) data.personal = true;
  if (row.item_type) data.itemType = row.item_type;
  return { id: row.id, data };
}

/** An item, or null. */
export async function itemById(ctx: SqlCtx, id: unknown): Promise<Item | null> {
  if (typeof id !== "string") return null;
  const row = await one<ItemRow>(ctx, "SELECT * FROM items WHERE id = ?", [id]);
  return row ? itemOf(row) : null;
}

/** The items of these IDs that exist, by ID. */
export async function itemsByIds(
  ctx: SqlCtx,
  ids: readonly unknown[],
): Promise<Map<string, Item>> {
  const wanted = [
    ...new Set(ids.filter((id): id is string => typeof id === "string")),
  ];
  const found = new Map<string, Item>();
  for (let at = 0; at < wanted.length; at += 90) {
    const chunk = wanted.slice(at, at + 90);
    const { rows } = await ctx.sql<ItemRow>(
      `SELECT * FROM items WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
    for (const row of rows) found.set(row.id, itemOf(row));
  }
  return found;
}

/** An inventory row. */
export interface InventoryRow {
  id: number;
  owner: string;
  item_id: string;
  name: string;
  origin: string;
  character_id: number | null;
  gift: string;
}

/** A held copy as pages and old code read it. */
export interface Owned {
  id: string;
  data: {
    owner: string;
    item: string;
    name: string;
    from: string;
    character: string | null;
    sender?: string;
    senderName?: string;
    memo?: string;
    receivedAt?: number;
  };
}

export function ownedOf(row: InventoryRow): Owned {
  return {
    id: String(row.id),
    data: {
      ...parsed(row.gift, {}),
      owner: row.owner,
      item: row.item_id,
      name: row.name,
      from: row.origin,
      character: row.character_id === null ? null : String(row.character_id),
    },
  };
}

/** The caller's own copies of these IDs, in order, null where not theirs. */
export async function ownedItems(
  ctx: SqlCtx,
  ids: readonly unknown[],
): Promise<(Owned | null)[]> {
  const keys = ids.map((id) => characterKey(id));
  const wanted = [...new Set(keys.filter((key) => key !== null))];
  if (!ctx.member || !wanted.length) return ids.map(() => null);
  const found = new Map<number, Owned>();
  for (let at = 0; at < wanted.length; at += 90) {
    const chunk = wanted.slice(at, at + 90);
    const { rows } = await ctx.sql<InventoryRow>(
      `SELECT * FROM inventory WHERE owner = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
      [ctx.member.id, ...chunk],
    );
    for (const row of rows) found.set(row.id, ownedOf(row));
  }
  return keys.map((key) => (key === null ? null : (found.get(key) ?? null)));
}

/** One of the caller's own copies, or null. */
export async function ownedItem(
  ctx: SqlCtx,
  id: unknown,
): Promise<Owned | null> {
  return (await ownedItems(ctx, [id]))[0];
}

/** A new copy of `item` for `owner` (the caller), a character's or their own. */
export async function give(
  ctx: SqlCtx,
  item: Item,
  from: string,
  character: string | null = null,
  owner: string = ctx.member.id,
  gift: Record<string, unknown> = {},
): Promise<Owned> {
  const { rows } = await ctx.sql<InventoryRow>(
    "INSERT INTO inventory (owner, item_id, name, origin, character_id, gift) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
    [
      owner,
      item.id,
      String(item.data.name ?? ""),
      from,
      characterKey(character),
      JSON.stringify(gift),
    ],
  );
  return ownedOf(rows[0]);
}

/** Takes these copies away (used up, sold, or made into something). */
export async function spend(ctx: SqlCtx, owned: readonly Owned[]) {
  const keys = owned.map((row) => Number(row.id));
  for (let at = 0; at < keys.length; at += 90) {
    const chunk = keys.slice(at, at + 90);
    await ctx.sql(
      `DELETE FROM inventory WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
  }
}

/**
 * Draws from the paid gacha (source null), a draw ticket's own table
 * (source, the ticket's item) or exploration's, by weight with the host's
 * roll: `configured` is false when the table has nothing to draw, and
 * `prize` null for a miss. A row naming an item the shop does not have is
 * the owner's mistake, and fails the call.
 */
export async function draw(
  ctx: SqlCtx,
  source: string | null = null,
  table: "gacha" | "explore" = "gacha",
): Promise<{ configured: boolean; prize: Item | null }> {
  const scope = table === "gacha" ? "source IS ? AND weight > 0" : "weight > 0";
  const values: SqlValue[] = table === "gacha" ? [source] : [];
  const total =
    (
      await one<{ total: number }>(
        ctx,
        `SELECT total(weight) AS total FROM ${table} WHERE ${scope}`,
        values,
      )
    )?.total ?? 0;
  if (!(total > 0)) return { configured: false, prize: null };
  if (!Number.isFinite(total)) throw new Error("Draw weights are too large.");
  const roll = Math.random() * total;
  const won =
    (await one<{ item_id: string | null }>(
      ctx,
      `SELECT item_id FROM (SELECT id, item_id, sum(weight) OVER (ORDER BY id) AS upto FROM ${table} WHERE ${scope}) WHERE upto > ? ORDER BY upto LIMIT 1`,
      [...values, roll],
    )) ??
    (await one<{ item_id: string | null }>(
      ctx,
      `SELECT item_id FROM ${table} WHERE ${scope} ORDER BY id DESC LIMIT 1`,
      values,
    ));
  if (won.item_id === null) return { configured: true, prize: null };
  const prize = await itemById(ctx, won.item_id);
  if (!prize)
    throw new Error(`뽑기의 아이템 ${won.item_id}이 상점에 없습니다.`);
  return { configured: true, prize };
}

/** A recipe as pages and old code read it, with its materials. */
export interface Recipe {
  id: string;
  data: {
    name: string;
    description: string;
    item: string;
    cost: number;
    hidden: boolean;
    ingredients: { item: string; count: number }[];
  };
}

interface RecipeRow {
  id: string;
  name: string;
  description: string;
  item_id: string;
  cost: number;
  hidden: number;
  ingredients: string;
}

const RECIPE_SELECT =
  "SELECT recipes.*, (SELECT json_group_array(json_object('item', item_id, 'count', count)) FROM recipe_ingredients WHERE recipe_id = recipes.id) AS ingredients FROM recipes";

const recipeOf = (row: RecipeRow): Recipe => ({
  id: row.id,
  data: {
    name: row.name,
    description: row.description,
    item: row.item_id,
    cost: row.cost,
    hidden: row.hidden !== 0,
    ingredients: parsed<{ item: string; count: number }[]>(row.ingredients, []),
  },
});

/** A recipe, or null. */
export async function recipeById(ctx: SqlCtx, id: unknown) {
  if (typeof id !== "string") return null;
  const row = await one<RecipeRow>(ctx, `${RECIPE_SELECT} WHERE id = ?`, [id]);
  return row ? recipeOf(row) : null;
}

/**
 * The recipes members may use: the owner's hidden ones (숨기기) cannot be
 * crafted, and the original keeps them off players' screens altogether
 * (adm/recipi_list.php).
 */
export async function openRecipes(ctx: SqlCtx): Promise<Recipe[]> {
  const { rows } = await ctx.sql<RecipeRow>(
    `${RECIPE_SELECT} WHERE hidden = 0 ORDER BY id LIMIT 1000`,
  );
  return rows.map(recipeOf);
}

/**
 * The items a member may see: the shop's (not hidden), and hidden ones only
 * as the original shows them: in their own inventory, or as part of a
 * recipe they can see.
 */
export async function visibleItems(
  ctx: SqlCtx,
  member: string,
): Promise<Item[]> {
  const { rows } = await ctx.sql<ItemRow>(
    `SELECT * FROM items WHERE hidden = 0
       OR id IN (SELECT item_id FROM shop_entries WHERE enabled != 0)
       OR id IN (SELECT item_id FROM inventory WHERE owner = ?)
       OR id IN (SELECT item_id FROM recipes WHERE hidden = 0)
       OR id IN (SELECT recipe_ingredients.item_id FROM recipes
         JOIN recipe_ingredients ON recipe_ingredients.recipe_id = recipes.id
         WHERE recipes.hidden = 0)
     ORDER BY id LIMIT 1000`,
    [member],
  );
  return rows.map(itemOf);
}

/**
 * 상점 진열 (avo_shop): the items' further sales on display, each its
 * entry's ID, its item's and what it sells it for, in its order.
 */
export async function shopOffers(ctx: SqlCtx) {
  const { rows } = await ctx.sql<{
    id: string;
    item_id: string;
    shop_category: string;
    shop_talk: string;
    display: string | null;
    price: number;
    stock: number | null;
    sort_order: number;
    requirements: string;
  }>(
    `SELECT shop_entries.* FROM shop_entries
     JOIN items ON items.id = shop_entries.item_id
     WHERE shop_entries.enabled != 0
     ORDER BY shop_entries.sort_order, shop_entries.id LIMIT 500`,
  );
  return rows.map((row) => ({
    id: row.id,
    item: row.item_id,
    data: offerData(row),
  }));
}
/** What an entry sells its item for, as an item's own shop fields read. */
export function offerData(row: {
  shop_category: string;
  shop_talk: string;
  display: string | null;
  price: number;
  stock: number | null;
  sort_order: number;
  requirements: string;
}) {
  return {
    shopCategory: row.shop_category,
    shopTalk: row.shop_talk,
    price: row.price,
    order: row.sort_order,
    requirements: parsed(row.requirements, {}),
    ...(row.display !== null ? { display: parsed(row.display, {}) } : {}),
    ...(row.stock !== null ? { stock: row.stock } : {}),
  };
}

/**
 * A member's held copies, oldest first: one character's, those of no
 * character (`character` null), or all of them (`all`).
 */
export async function inventoryOf(
  ctx: SqlCtx,
  member: string,
  { character = null, all = false }: { character?: unknown; all?: boolean },
): Promise<Owned[]> {
  const key = characterKey(character);
  const { rows } = all
    ? await ctx.sql<InventoryRow>`SELECT * FROM inventory WHERE owner = ${member} ORDER BY id LIMIT 1000`
    : key === null
      ? await ctx.sql<InventoryRow>`SELECT * FROM inventory WHERE owner = ${member} AND character_id IS NULL ORDER BY id LIMIT 1000`
      : await ctx.sql<InventoryRow>`SELECT * FROM inventory WHERE owner = ${member} AND character_id = ${key} ORDER BY id LIMIT 1000`;
  return rows.map(ownedOf);
}

/**
 * What a character holds, by name and picture, as its page shows it
 * (member/viewer.php's ad_use_inven), at most 100.
 */
export async function characterInventory(ctx: SqlCtx, character: number) {
  const { rows } = await ctx.sql<{
    name: string;
    item_name: string | null;
    image: string | null;
  }>`SELECT inventory.name, items.name AS item_name, items.image FROM inventory
     LEFT JOIN items ON items.id = inventory.item_id
     WHERE inventory.character_id = ${character} ORDER BY inventory.id LIMIT 100`;
  return rows.map((row) => ({
    name: row.name || row.item_name || "",
    image: row.image ?? null,
  }));
}

/** The caller's wallet: { balance, lastDaily }. */
export async function wallet(ctx: SqlCtx): Promise<Wallet> {
  const current = await walletOf(ctx, ctx.member.id);
  amount(current.balance, "Balance");
  return current;
}

/** Takes `amount` from the caller's wallet (a negative one pays them); the new balance. */
export async function pay(
  ctx: SqlCtx,
  current: { balance: number },
  amount: number,
  changes: { lastDaily?: string | null } = {},
): Promise<number> {
  const balance = current.balance - amount;
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error("Balance is outside its allowed range.");
  await saveWallet(
    ctx,
    ctx.member.id,
    balance,
    Object.hasOwn(changes, "lastDaily") ? changes.lastDaily : undefined,
  );
  return balance;
}

/** Adds a history row of `kind` for `owner` (the caller). */
export async function record(
  ctx: SqlCtx & { readonly now: number },
  kind: string,
  details: Record<string, any>,
  owner: string = ctx.member.id,
) {
  await addHistory(ctx, { owner, kind, at: ctx.now, ...details });
}

/** Fails the call unless `character` meets the item's use requirements. */
export async function requireUsable(
  ctx: EconomyCtx,
  item: Item,
  character: string | null | undefined,
) {
  const requirements = item.data.useRequirements ?? {};
  if (
    !requirements.approved &&
    !requirements.sides?.length &&
    !requirements.classes?.length &&
    !requirements.exp &&
    !requirements.title
  )
    return;
  const sheet = await ownCharacter(ctx, character);
  if (!sheet)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const official = (await characterState(ctx, character)).data;
  if (requirements.approved && !official.approved)
    ctx.fail("CONFLICT", "승인된 캐릭터만 할 수 있습니다.", {
      reason: "not_approved",
    });
  for (const [key, field] of [
    ["sides", "side"],
    ["classes", "class"],
  ] as const) {
    if (
      requirements[key] !== undefined &&
      (!Array.isArray(requirements[key]) ||
        requirements[key].some((value) => typeof value !== "string"))
    )
      throw new Error("Use restrictions must be lists of identifiers.");
    if (
      requirements[key]?.length &&
      // The sheet's own 소속 and 종족 (ch_side, ch_class).
      !requirements[key].includes(sheet[field])
    )
      ctx.fail("CONFLICT", restrictedFor(await names(ctx), "사용할"), {
        reason: "restricted_character",
      });
  }
  if (official.exp < amount(requirements.exp ?? 0, "Use experience"))
    ctx.fail("CONFLICT", await lacking(ctx, "expName"), {
      reason: "not_enough_exp",
    });
  if (
    requirements.title &&
    // A deleted title is taken from its holders with it.
    !official.titles.includes(requirements.title)
  )
    ctx.fail("CONFLICT", "필요한 타이틀이 없습니다.", {
      reason: "missing_title",
    });
}

/**
 * Applies a recovery effect to an owned character, up to the stat's maximum:
 * at full it changes nothing and the item is still used, as set_status
 * clamps (extend/status.lib.php:80) and use_item.php:35 consumes regardless.
 */
export async function restoreStat(
  ctx: EconomyCtx,
  effect: Record<string, any>,
  character: string,
) {
  const state = await characterState(ctx, character);
  if (
    typeof effect.stat !== "string" ||
    !Object.hasOwn(state.data.stats, effect.stat)
  )
    throw new Error("Recovery stat does not exist.");
  const recovery = amount(effect.amount, "Recovery amount");
  if (!recovery) throw new Error("Recovery amount must be positive.");
  const stat = state.data.stats[effect.stat];
  stat.damage = Math.max(0, stat.damage - recovery);
  stat.current = Math.max(0, stat.max - stat.damage);
  await saveState(ctx, character, state.data);
  return sheetOf(await characterRow(ctx, character));
}

/**
 * A personal item a 개인 아이템 제작권 makes (inventory/inc/add_item_form.php):
 * the member's name, description and picture, hidden from the shop and
 * not for sale, kept by an ID made from the ticket's.
 */
export async function makePersonalItem(
  ctx: EconomyCtx,
  ticket: Owned,
  data: { name?: unknown; description?: unknown; image?: unknown },
): Promise<Item> {
  // The form asks for all three (inventory/inc/add_item_form.php:26-32).
  if (
    [data.name, data.description, data.image].some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  )
    ctx.fail("INVALID_REQUEST", "이름, 설명, 이미지를 모두 입력해 주세요.", {
      reason: "invalid_input",
    });
  const id = `personal-${ctx.now.toString(36)}-${ticket.id}`;
  const { rows } = await ctx.sql<ItemRow>(
    "INSERT INTO items (id, name, description, image, hidden, sellable, personal, category) VALUES (?, ?, ?, ?, 1, 0, 1, 'personal') RETURNING *",
    [
      id,
      text(data.name, 80, true),
      text(data.description, 2000, true),
      imageUrl(data.image),
    ],
  );
  return itemOf(rows[0]);
}

/**
 * A 프로필수정 ticket for `character` (inventory/use_item.php 27-28,
 * character_form.php:80-84): one of the member's own, or the character's,
 * whose item's effect is "profile" and which the character may use.
 */
export async function profileTicket(
  ctx: EconomyCtx,
  ticket: unknown,
  character: CharacterRow | null,
): Promise<{ owned: Owned; item: Item }> {
  const owned = await ownedItem(ctx, ticket);
  const item = owned ? await itemById(ctx, owned.data.item) : null;
  if (
    !owned ||
    !character ||
    !item ||
    item.data.effect?.type !== "profile" ||
    item.data.usable === false ||
    (owned.data.character && owned.data.character !== String(character.id))
  )
    ctx.fail(
      "CONFLICT",
      "이 캐릭터에 쓸 수 있는 프로필 수정 아이템이 아닙니다.",
      { reason: "invalid_ticket" },
    );
  await requireUsable(ctx, item, String(character.id));
  return { owned, item };
}
