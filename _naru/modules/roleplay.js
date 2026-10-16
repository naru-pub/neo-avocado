// Roleplay on log boards, after skin/board/mmb and its write_update.inc.php:
// posting as a character, server-rolled dice, exploration (탐색), items used
// in a post, and [[nick]] calls with comment notices.
import {
  CALLS,
  CHARACTER_STATE,
  EXPLORE,
  INVENTORY,
  ITEMS,
  PROFILES,
  SETTINGS,
  TITLES,
  WARDROBE,
  RECIPES,
  amount,
  pay,
  wallet,
  weightedRows,
  author,
  characterState,
  communityAccess,
  draw,
  give,
  kstDay,
  logReadable,
  ownCharacter,
  ownedItem,
  record,
  restoreStat,
  requireUsable,
  lacking,
} from "./shared.js";

const https = (value) =>
  typeof value === "string" && value.startsWith("https://") ? value : null;

/**
 * Who a post speaks as: one of the caller's own, non-deleted characters, with
 * its displayed title and worn outfit at the time of posting (as the original
 * stored ch_id, ti_id and ma_id with each post). Null posts as the nickname.
 */
export async function speakerOf(ctx, id) {
  if (id === undefined || id === null) return null;
  const character = await ownCharacter(ctx, id);
  if (!character)
    ctx.fail("ACCESS_DENIED", "내 캐릭터로만 쓸 수 있습니다.", {
      reason: "not_owned",
    });
  const state = await ctx.get(CHARACTER_STATE, character.id);
  const titleId = state?.data.activeTitle;
  const title =
    typeof titleId === "string" && state.data.titles?.includes(titleId)
      ? await ctx.get(TITLES, titleId)
      : null;
  const outfit =
    typeof character.data.outfit === "string"
      ? await ctx.get(WARDROBE, character.data.outfit)
      : null;
  const worn = outfit?.data.character === character.id ? outfit : null;
  return {
    character: character.id,
    name: character.data.name,
    type: character.data.type ?? "main",
    title: title && !title.data.deleted ? title.data.name : null,
    titleImage: title && !title.data.deleted ? https(title.data.image) : null,
    portrait: https(worn?.data.image) ?? https(character.data.image),
  };
}

/** Two six-sided dice from the server's random source, fixed once posted. */
export function rollDice() {
  return [0, 1].map(() => 1 + Math.floor(Math.random() * 6));
}

const CALL = /\[\[([^[\]\r\n]{1,20})\]\]/g;
export const MAX_CALLS = 5;

/** The distinct nicknames a text calls, in order, at most MAX_CALLS. */
export function calledNicks(text) {
  const nicks = [];
  for (const match of String(text ?? "").matchAll(CALL)) {
    const nick = match[1].trim();
    if (nick && !nicks.includes(nick)) nicks.push(nick);
  }
  return nicks.slice(0, MAX_CALLS);
}

/**
 * Members newly called by `text` (not already called by `before`). Like the
 * original, a nickname no member uses is blurred to [[???]] in the saved text.
 */
export async function resolveCalls(ctx, text, before = "") {
  const already = calledNicks(before);
  const recipients = [];
  let saved = text;
  for (const nick of calledNicks(text)) {
    if (already.includes(nick)) continue;
    const found = (await ctx.list(PROFILES, { filter: { nick }, size: 1 }))
      .documents[0];
    if (!found) saved = saved.split(`[[${nick}]]`).join("[[???]]");
    else if (
      found.id !== ctx.member.id &&
      !recipients.some((row) => row.id === found.id)
    )
      recipients.push({ id: found.id, nick });
  }
  return { text: saved, recipients };
}

/**
 * Records and sends calls and the comment notice after a post is saved. A
 * member who could not read the post is not told about it; the post's author
 * may turn comment notices off (profile.commentAlerts).
 */
export async function deliverCalls(
  ctx,
  {
    log,
    comment = null,
    text,
    speaker,
    recipients,
    notifyAuthor = false,
    guest = null,
    anonymous = false,
  },
) {
  const from = ctx.member?.id ?? null;
  const me = from && !anonymous ? await ctx.get(PROFILES, from) : null;
  const preview = text.replace(/\[\[|\]\]/g, "").slice(0, 100);
  const sent = new Set();
  const send = async (to, kind) => {
    if (sent.has(to) || to === from) return;
    if (!(await logReadable(ctx, log, await communityAccess(ctx, to), to)))
      return;
    sent.add(to);
    // A 익명 writer's notice names no one (view_comment.skin.php: 익명의 누군가).
    await ctx.add(CALLS, {
      to,
      from: anonymous ? null : from,
      nick: anonymous
        ? "익명의 누군가"
        : (me?.data.nick ?? (guest ? `${guest} (손님)` : "")),
      speaker: anonymous ? null : (speaker?.name ?? null),
      kind,
      board: log.data.board ?? "default",
      logId: log.id,
      commentId: comment?.id ?? null,
      preview,
      at: ctx.now,
    });
    ctx.notify(to, { calls: true });
  };
  for (const recipient of recipients) await send(recipient.id, "call");
  const owner = author(log);
  if (notifyAuthor && owner && !sent.has(owner)) {
    const profile = await ctx.get(PROFILES, owner);
    if (profile && profile.data.commentAlerts !== false)
      await send(owner, "comment");
  }
  return [...sent];
}

/** Whether the member has calls newer than they last looked (profile.callsSeenAt). */
export async function callsUnread(ctx) {
  const profile = await ctx.get(PROFILES, ctx.member.id);
  const seen = Number.isFinite(profile?.data.callsSeenAt)
    ? profile.data.callsSeenAt
    : 0;
  const page = await ctx.list(CALLS, {
    filter: { to: ctx.member.id },
    where: { gt: ["at", seen] },
    size: 1,
  });
  return page.documents.length > 0;
}

/**
 * Exploration (탐색): an approved character, up to the configured number of
 * times a Korean day, counted on request rather than reset by a job. A drop is
 * drawn from the explore table by weight; a miss is a row without an item.
 */
export async function explore(ctx, speaker) {
  if (!speaker)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const limit = amount(
    (await ctx.get(SETTINGS, "community"))?.data.exploreLimit ?? 0,
    "Explore limit",
  );
  if (!limit)
    ctx.fail("CONFLICT", "지금은 탐색할 수 없습니다.", {
      reason: "explore_closed",
    });
  const state = await characterState(ctx, speaker.character);
  if (state.data.approved !== true)
    ctx.fail("CONFLICT", "승인된 캐릭터만 할 수 있습니다.", {
      reason: "not_approved",
    });
  const today = kstDay(ctx.now);
  const used =
    state.data.explore?.day === today
      ? amount(state.data.explore.count, "Explore count")
      : 0;
  if (used >= limit)
    ctx.fail("CONFLICT", "이 캐릭터는 오늘 탐색을 모두 했습니다.", {
      reason: "explore_limit",
    });
  const outcome = await draw(ctx, null, EXPLORE);
  const prize = outcome.prize;
  if (prize) await give(ctx, prize, "explore", speaker.character);
  await ctx.set(CHARACTER_STATE, speaker.character, {
    ...state.data,
    explore: { day: today, count: used + 1 },
  });
  await record(ctx, "explore", {
    character: speaker.character,
    item: prize?.id ?? null,
  });
  return {
    type: "explore",
    item: prize?.id ?? null,
    name: prize?.data.name ?? null,
    image: https(prize?.data.image),
    remaining: limit - used - 1,
  };
}

/**
 * An item used in a post (wr_item_log): recovery heals the speaking character,
 * a draw ticket rolls its own table, an item without an effect is shown as
 * used. Forms (personal items, profile tickets) stay in the inventory.
 */
export async function useInPost(ctx, inventory, speaker) {
  const owned = await ownedItem(ctx, inventory);
  if (!owned)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const item = await ctx.get(ITEMS, owned.data.item);
  if (!item || item.data.usable === false)
    ctx.fail("CONFLICT", "사용할 수 없는 아이템입니다.", {
      reason: "not_usable",
    });
  const character = speaker?.character ?? null;
  if (owned.data.character && owned.data.character !== character)
    ctx.fail("CONFLICT", "이 아이템을 가진 캐릭터를 선택해 주세요.", {
      reason: "wrong_character",
    });
  await requireUsable(ctx, item, character);
  const effect = item.data.effect?.type ?? null;
  const used = {
    type: "use",
    item: item.id,
    name: owned.data.name,
    image: https(item.data.image),
    effect,
  };
  if (effect === "restore") {
    if (!character)
      ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
        reason: "no_character",
      });
    if (!(await restoreStat(ctx, item.data.effect, character)))
      ctx.fail("CONFLICT", "이미 전부 회복되었습니다.", {
        reason: "already_full",
      });
    used.stat = item.data.effect.stat;
    used.amount = item.data.effect.amount;
  } else if (effect === "draw") {
    const outcome = await draw(ctx, item.id);
    if (!outcome.configured)
      ctx.fail("CONFLICT", "아직 뽑을 것이 없습니다.", { reason: "empty" });
    if (outcome.prize)
      await give(ctx, outcome.prize, "item", owned.data.character ?? character);
    used.prize = outcome.prize
      ? { item: outcome.prize.id, name: outcome.prize.data.name }
      : null;
  } else if (effect)
    ctx.fail("CONFLICT", "이 아이템은 인벤토리에서 사용해 주세요.", {
      reason: "not_usable_here",
    });
  else used.description = String(item.data.description ?? "").slice(0, 200);
  if (item.data.reusable !== true) await ctx.delete(INVENTORY, owned.id);
  await record(ctx, "use", {
    item: item.id,
    inventory: owned.id,
    character,
    effect: effect ?? "post",
  });
  return used;
}

/** At most this many materials go into one combination, as make_1…make_3. */
export const MAX_MATERIALS = 3;

/**
 * Combination (조합, action H): one to three of the speaking character's items
 * matched against the recipes by item, ignoring order. A match makes the
 * recipe's item for the character and charges its cost; a miss still uses up
 * the materials, as the original did. Reusable items are never consumed.
 */
export async function combineInPost(ctx, materials, speaker) {
  if (!speaker)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  if (
    !Array.isArray(materials) ||
    !materials.length ||
    materials.length > MAX_MATERIALS ||
    materials.some((id) => typeof id !== "string") ||
    new Set(materials).size !== materials.length
  )
    ctx.fail("INVALID_REQUEST", "레시피에 맞는 재료를 선택해 주세요.", {
      reason: "invalid_materials",
    });
  const owned = await Promise.all(materials.map((id) => ownedItem(ctx, id)));
  if (
    owned.some(
      (row) =>
        !row ||
        ((row.data.character ?? null) !== null &&
          row.data.character !== speaker.character),
    )
  )
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const key = owned
    .map((row) => row.data.item)
    .sort()
    .join("||");
  const recipe = (await weightedRows(ctx, RECIPES)).find((row) => {
    if (row.data.hidden || !Array.isArray(row.data.ingredients)) return false;
    const needed = [];
    for (const ingredient of row.data.ingredients)
      for (let n = 0; n < (ingredient.count ?? 0) && needed.length < 4; n++)
        needed.push(ingredient.item);
    return needed.sort().join("||") === key;
  });
  const prize =
    typeof recipe?.data.item === "string"
      ? await ctx.get(ITEMS, recipe.data.item)
      : null;
  let balance = null;
  if (prize) {
    const cost = amount(recipe.data.cost ?? 0, "Crafting cost");
    const current = await wallet(ctx);
    if (current.balance < cost)
      ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
        reason: "not_enough",
      });
    if (cost) balance = await pay(ctx, current, cost);
    await give(ctx, prize, "craft", speaker.character);
  }
  const catalogue = await ctx.getMany(
    ITEMS,
    owned.map((row) => row.data.item),
  );
  for (const [index, row] of owned.entries())
    if (catalogue[index]?.data.reusable !== true)
      await ctx.delete(INVENTORY, row.id);
  await record(ctx, "craft", {
    character: speaker.character,
    item: prize?.id ?? null,
    ...(balance !== null ? { balance } : {}),
  });
  return {
    type: "combine",
    success: Boolean(prize),
    item: prize?.id ?? null,
    name: prize?.data.name ?? null,
    image: https(prize?.data.image),
    materials: owned.map((row) => row.data.name ?? row.data.item),
  };
}
