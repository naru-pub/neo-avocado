// Roleplay on log boards, after skin/board/mmb and its write_update.inc.php:
// posting as a character, server-rolled dice, exploration (탐색), items used
// in a post, and [[nick]] calls with comment notices.
import {
  amount,
  communityAccess,
  communitySettings,
  kstDay,
  lacking,
  one,
  parsed,
} from "./access.js";
import {
  draw,
  give,
  itemById,
  itemsByIds,
  openRecipes,
  ownedItem,
  ownedItems,
  pay,
  record,
  requireUsable,
  spend,
  wallet,
} from "./economy.js";
import { characterState, ownCharacter, saveState } from "./characters.js";
import { profileByNick, profileOf } from "./members.js";
import { postReadable } from "./boards.js";
import type { PostRow } from "./boards.js";
import type { MutationCtx, QueryCtx } from "./naru-types.js";
import type { SqlCtx } from "./access.js";

type Ctx = MutationCtx;

/** Who a post or comment speaks as (speakerOf). */
export interface Speaker {
  character: string;
  name: string;
  type: string;
  title: string | null;
  titleImage: string | null;
  portrait: string | null;
}

/** A member a text calls with [[nick]]. */
export interface Recipient {
  id: string;
  nick: string;
}

/** An item used in a post or comment, as the post keeps it (useInPost). */
export interface UsedItem {
  type: "use";
  item: string;
  name: string;
  image: string | null;
  effect: string | null;
  stat?: string;
  amount?: number;
  prize?: { item: string; name: string } | null;
  description?: string;
}

const https = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("https://") ? value : null;

/**
 * Who a post speaks as: one of the caller's own, non-deleted characters, with
 * its displayed title and worn outfit at the time of posting (as the original
 * stored ch_id, ti_id and ma_id with each post). Null posts as the nickname.
 */
export async function speakerOf(
  ctx: Ctx,
  id: unknown,
): Promise<Speaker | null> {
  if (id === undefined || id === null) return null;
  const character = await ownCharacter(ctx, id);
  if (!character)
    ctx.fail("ACCESS_DENIED", "내 캐릭터로만 쓸 수 있습니다.", {
      reason: "not_owned",
    });
  // The title it shows, if it still holds it and it is in use (ti_use is
  // shown nowhere otherwise, extend/title.lib.php:7).
  const title = await one<{ name: string; image: string | null }>(
    ctx,
    `SELECT titles.name, titles.image FROM characters
     JOIN character_titles ON character_titles.character_id = characters.id
       AND character_titles.title_id = characters.active_title
     JOIN titles ON titles.id = character_titles.title_id
     WHERE characters.id = ? AND titles.enabled != 0`,
    [character.id],
  );
  return {
    character: String(character.id),
    name: character.name,
    type: character.type ?? "main",
    title: title?.name ?? null,
    titleImage: https(title?.image),
    // The 두상: an outfit dresses the 전신 only (member/viewer.php:76).
    portrait: https(character.image),
  };
}

/** Two six-sided dice from the server's random source, fixed once posted. */
export function rollDice(): number[] {
  return [0, 1].map(() => 1 + Math.floor(Math.random() * 6));
}

const CALL = /\[\[([^[\]\r\n]{1,20})\]\]/g;
/**
 * The original calls everyone a text names. Each call here takes four
 * statements (the nickname, the member's access, the board, the notice) of
 * a call's 100, beside the post, its reward and its 조합 or 탐색 and item,
 * so a text calls at most this many members: more than a scene names.
 */
export const MAX_CALLS = 10;

/** The distinct nicknames a text calls, in order, at most MAX_CALLS. */
export function calledNicks(text: unknown): string[] {
  const nicks: string[] = [];
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
export async function resolveCalls(
  ctx: Ctx,
  text: string,
  before = "",
  called: unknown = [],
): Promise<{ text: string; recipients: Recipient[]; called: string[] }> {
  const already = calledNicks(before);
  // Who this post or comment has called before: an edit that removes a
  // [[name]] and puts it back does not call them again.
  const earlier = Array.isArray(called)
    ? called.filter((id): id is string => typeof id === "string")
    : [];
  const recipients: Recipient[] = [];
  let saved = text;
  for (const nick of calledNicks(text)) {
    if (already.includes(nick)) continue;
    const found = await profileByNick(ctx, nick);
    if (!found) saved = saved.split(`[[${nick}]]`).join("[[???]]");
    else if (
      found.id !== ctx.member?.id &&
      !earlier.includes(found.id) &&
      !recipients.some((row) => row.id === found.id)
    )
      recipients.push({ id: found.id, nick });
  }
  return {
    text: saved,
    recipients,
    called: [...earlier, ...recipients.map((row) => row.id)].slice(-200),
  };
}

/**
 * Records calls and the comment notice after a post or comment is saved. A
 * member who could not read the post is not told about it; the post's
 * author may turn comment notices off (profile.commentAlerts). Members see
 * them by subscribing to community/inbox:status.
 */
export async function deliverCalls(
  ctx: Ctx,
  {
    post,
    comment = null,
    text,
    speaker,
    recipients,
    notifyAuthor = false,
    guest = null,
    anonymous = false,
  }: {
    post: PostRow;
    /** The comment's ID, for a comment. */
    comment?: number | null;
    text: string;
    speaker: Speaker | null;
    recipients: Recipient[];
    notifyAuthor?: boolean;
    /** A guest writer's name. */
    guest?: string | null;
    anonymous?: boolean;
  },
): Promise<string[]> {
  const from = ctx.member?.id ?? null;
  const me = from && !anonymous ? await profileOf(ctx, from) : null;
  const preview = text.replace(/\[\[|\]\]/g, "").slice(0, 100);
  const sent = new Set<string>();
  const send = async (to: string, kind: "call" | "comment") => {
    if (sent.has(to) || to === from) return;
    if (!(await postReadable(ctx, post, await communityAccess(ctx, to), to)))
      return;
    sent.add(to);
    // A 익명 writer's notice names no one (view_comment.skin.php: 익명의 누군가).
    await ctx.sql`INSERT INTO calls (recipient, sender, nick, speaker, kind, board, post_id, comment_id, preview, at)
      VALUES (${to}, ${anonymous ? null : from}, ${
        anonymous
          ? "익명의 누군가"
          : (me?.data.nick ?? (guest ? `${guest} (손님)` : ""))
      }, ${anonymous ? null : (speaker?.name ?? null)}, ${kind}, ${post.board}, ${post.id}, ${comment}, ${preview}, ${ctx.now})`;
  };
  for (const recipient of recipients) await send(recipient.id, "call");
  const owner = post.owner;
  if (notifyAuthor && owner && !sent.has(owner)) {
    const profile = await profileOf(ctx, owner);
    if (profile && profile.data.commentAlerts !== false)
      await send(owner, "comment");
  }
  return [...sent];
}

/** Whether the member has calls newer than they last looked (profile.callsSeenAt). */
export async function callsUnread(ctx: SqlCtx): Promise<boolean> {
  return Boolean(
    await one(
      ctx,
      `SELECT 1 FROM calls WHERE recipient = ?
       AND at > coalesce((SELECT calls_seen_at FROM profiles WHERE member = ?), 0) LIMIT 1`,
      [ctx.member.id, ctx.member.id],
    ),
  );
}

/**
 * Exploration (탐색): an approved character, up to the configured number of
 * times a Korean day, counted on request rather than reset by a job. A drop is
 * drawn from the explore table by weight; a miss is a row without an item.
 */
export async function explore(ctx: Ctx, speaker: Speaker | null) {
  if (!speaker)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const limit = amount(
    (await communitySettings(ctx)).exploreLimit ?? 0,
    "Explore limit",
  );
  if (!limit)
    ctx.fail("CONFLICT", "지금은 탐색할 수 없습니다.", {
      reason: "explore_closed",
    });
  const state = await characterState(ctx, speaker.character);
  if (!state.data.approved)
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
  const outcome = await draw(ctx, null, "explore");
  const prize = outcome.prize;
  if (prize) await give(ctx, prize, "explore", speaker.character);
  await saveState(ctx, speaker.character, {
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
 * Fails unless the speaking character is approved: the mmb skin offers its
 * actions and items only to a character with ch_state 승인
 * (write.skin.php:196,290).
 */
async function requireApproved(ctx: Ctx, speaker: Speaker) {
  if (!(await characterState(ctx, speaker.character)).data.approved)
    ctx.fail("CONFLICT", "승인된 캐릭터만 할 수 있습니다.", {
      reason: "not_approved",
    });
}

/**
 * An item used in a post (wr_item_log), from the speaking character's own
 * inventory (write.skin.php:68). Only a draw ticket does anything here, rolling
 * its own table; any other item is shown as used and spent, effect or not, as
 * write_update.inc.php:106-131 logs it (recovery and tickets take effect only
 * from the inventory). A post needs an approved character; a comment's item
 * list does not ask (write_comment.php:23), so `approved` is false there.
 */
export async function useInPost(
  ctx: Ctx,
  inventory: unknown,
  speaker: Speaker | null,
  { approved = true }: { approved?: boolean } = {},
): Promise<UsedItem> {
  if (!speaker)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const owned = await ownedItem(ctx, inventory);
  if (!owned)
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  const item = await itemById(ctx, owned.data.item);
  // it_use_mmb_able: an item the owner keeps out of posts is used elsewhere.
  if (!item || item.data.usable === false || item.data.usableInPosts !== true)
    ctx.fail("CONFLICT", "사용할 수 없는 아이템입니다.", {
      reason: "not_usable",
    });
  const character = speaker.character;
  if (owned.data.character !== character)
    ctx.fail("CONFLICT", "이 아이템을 가진 캐릭터를 선택해 주세요.", {
      reason: "wrong_character",
    });
  if (approved) await requireApproved(ctx, speaker);
  await requireUsable(ctx, item, character);
  const effect = item.data.effect?.type ?? null;
  const used: UsedItem = {
    type: "use",
    item: item.id,
    name: owned.data.name,
    image: https(item.data.image),
    effect,
  };
  if (effect === "draw") {
    const outcome = await draw(ctx, item.id);
    if (!outcome.configured)
      ctx.fail("CONFLICT", "아직 뽑을 것이 없습니다.", { reason: "empty" });
    if (outcome.prize) await give(ctx, outcome.prize, "item", character);
    used.prize = outcome.prize
      ? { item: outcome.prize.id, name: outcome.prize.data.name }
      : null;
  } else used.description = String(item.data.description ?? "").slice(0, 200);
  if (item.data.reusable !== true) await spend(ctx, [owned]);
  await record(ctx, "use", {
    item: item.id,
    inventory: owned.id,
    character,
    effect: effect === "draw" ? "draw" : "post",
  });
  return used;
}

/** At most this many materials go into one combination, as make_1…make_3. */
export const MAX_MATERIALS = 3;

/**
 * Combination (조합, action H): one to three of the speaking character's items
 * (write.skin.php:238 lists that character's inventory), for an approved
 * character, matched against the recipes by item, ignoring order. A match makes the
 * recipe's item for the character and charges its cost; a miss still uses up
 * the materials, as the original did. Reusable items are never consumed.
 */
export async function combineInPost(
  ctx: Ctx,
  materials: unknown,
  speaker: Speaker | null,
) {
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
  const owned = await ownedItems(ctx, materials);
  if (owned.some((row) => !row || row.data.character !== speaker.character))
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  await requireApproved(ctx, speaker);
  // it_use_recepi: only craft materials go into 조합.
  const catalogue = await itemsByIds(
    ctx,
    owned.map((row) => row.data.item),
  );
  for (const row of owned)
    if (catalogue.get(row.data.item)?.data.craftMaterial !== true)
      ctx.fail("INVALID_REQUEST", "조합 재료로 쓸 수 없는 아이템입니다.", {
        reason: "not_material",
      });
  const key = owned
    .map((row) => row.data.item)
    .sort()
    .join("||");
  const recipe = (await openRecipes(ctx)).find((row) => {
    const needed = [];
    for (const ingredient of row.data.ingredients)
      for (let n = 0; n < (ingredient.count ?? 0) && needed.length < 4; n++)
        needed.push(ingredient.item);
    return needed.sort().join("||") === key;
  });
  const prize = recipe ? await itemById(ctx, recipe.data.item) : null;
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
  await spend(
    ctx,
    owned.filter((row) => catalogue.get(row.data.item)?.data.reusable !== true),
  );
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
