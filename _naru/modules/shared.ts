// Shared collection identifiers and transactional domain helpers.
export { IMAGE_SLOTS, imageSlotsOf, viewerOf } from "./images.js";
import type { Ctx, Data, Filter, NaruDocument, ReadCtx } from "./naru-types.js";
import { amount, communitySettings, names, text } from "./access.js";
import type { Access, Names } from "./access.js";
import { addHistory, saveWallet, walletOf } from "./members.js";
import {
  characterRow,
  characterState as recordOf,
  ownCharacter as ownRow,
  saveState,
  sheetOf,
} from "./characters.js";
import type {
  Character,
  CharacterRow,
  Progress,
  StatDefinition,
} from "./characters.js";
// What moved to the site's tables (access.js, members.js), for the code
// that still imports it from here.
export {
  CLOSED_ACCESS,
  GUEST_ACCESS,
  NAME_DEFAULTS,
  RESERVED_NICKS,
  communityAccess,
  communityAmount,
  kstDay,
  kstStamp,
  names,
  namesOf,
  reservedNick,
  scheduled,
  siteOpen,
  text,
  imageUrl,
  amount,
} from "./access.js";
export type { Access, Names } from "./access.js";
export { loginReward } from "./members.js";
export const PREFIX = "neo_avocado_";

export const INVENTORY = `${PREFIX}inventory`;

export const ITEMS = `${PREFIX}items`;

export const GACHA = `${PREFIX}gacha`;

export const RECIPES = `${PREFIX}recipes`;

export const MESSAGES = `${PREFIX}messages`;

export const BOARDS = `${PREFIX}boards`;

export const CALLS = `${PREFIX}calls`;

export const EXPLORE = `${PREFIX}explore`;

/** Each board's next log number (wr_num), one document per board. */
export const COUNTERS = `${PREFIX}counters`;
/** Board groups (adm/boardgroup_list). */
export const BOARD_GROUPS = `${PREFIX}board_groups`;

/** Takes the board's next log number, as GnuBoard's wr_num. */
export async function nextNumber(ctx: Ctx, board: string) {
  const counter = await ctx.get(COUNTERS, board);
  const number = Number.isSafeInteger(counter?.data.next)
    ? counter.data.next
    : 1;
  await ctx.set(COUNTERS, board, { next: number + 1 });
  return number;
}

/** Body limits: plain logs as before, HTML posts like content pages. */
export const TEXT_LIMIT = 2000;
export const HTML_LIMIT = 12000;

/** A rough text view of an HTML body, for previews, tags and calls. */
export const plainText = (value: unknown): string =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const MAX_TAGS = 5;
const TAG = /#([0-9a-zA-Z가-힣_]{1,30})/g;

/** A log's hashtags (mmb autolink's #tag), at most five, searched with `has`. */
export function tagFields(text: unknown) {
  const tags = [];
  for (const match of String(text ?? "").matchAll(TAG))
    if (!tags.includes(match[1]) && tags.length < MAX_TAGS) tags.push(match[1]);
  return { tags };
}

/** A word with its subject particle: 아보가, 경험치가, 포인트가, 골드가. */
export function subject(word: string) {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}이(가)`;
  return `${word}${(last - 0xac00) % 28 ? "이" : "가"}`;
}
/** "아보가 모자랍니다." in the owner's name for money or experience. */
export async function lacking(ctx: ReadCtx, key: keyof Names) {
  return `${subject((await names(ctx))[key])} 모자랍니다.`;
}
/** What a restricted character is refused for, in the owner's names. */
export function restrictedFor(named: Names, verb: string) {
  const kinds = [named.sideTitle, named.classTitle].filter(Boolean);
  return `이 캐릭터의 ${kinds.join("·") || "조건"}으로는 ${verb} 수 없습니다.`;
}

export function author(row: NaruDocument | null | undefined) {
  return row?.createdBy ?? row?.data.owner;
}

/**
 * A post or comment as its reader sees it (skin/board/mmb/list.log.skin.php).
 * 멤버공개 shows a visitor only its number, category and marks; 익명 hides
 * who wrote it from all but its author and the staff, as "익명의 누군가".
 * The rule's present() and the functions that return others' posts use it.
 */
export function presentPost(
  row: NaruDocument,
  {
    member = null,
    staff = false,
  }: { member?: string | null; staff?: boolean } = {},
): Data {
  let data = row.data;
  if (
    data.anonymous === true &&
    !staff &&
    !(member && author(row) === member)
  ) {
    data = { ...data, owner: null };
    for (const key of ["speaker", "character", "guest"]) delete data[key];
  }
  if (data.membersOnly === true && !member && !staff) {
    const shown = {};
    for (const key of [
      "logId",
      "board",
      "number",
      "category",
      "notice",
      "membersOnly",
      "adult",
      "anonymous",
      "settlement",
    ])
      if (Object.hasOwn(data, key)) shown[key] = data[key];
    data = { ...shown, owner: null, locked: true };
  }
  return data;
}

/**
 * A board the owner made, or null: as in the original, a site has no boards
 * until its admin creates them (adm/board_form.php). A post without a board
 * names "default", which is a board only once the owner makes one with that ID.
 */
export async function boardOf(
  ctx: ReadCtx,
  id: unknown = "default",
): Promise<NaruDocument | null> {
  const found = typeof id === "string" ? await ctx.get(BOARDS, id) : null;
  return found ? withGroup(ctx, found) : null;
}

/**
 * A board in a members-only group (gr_use_access) carries the group's ID as
 * `membersOnly`, for boardAllowed; `groups` is the site's groups, when the
 * caller has read them already.
 */
export async function withGroup(
  ctx: ReadCtx,
  board: NaruDocument,
  groups?: NaruDocument[],
): Promise<NaruDocument> {
  const id = board.data.group;
  if (typeof id !== "string" || !id) return board;
  const group = groups
    ? groups.find((row) => row.id === id)
    : await ctx.get(BOARD_GROUPS, id);
  return group?.data.membersOnly && !group.data.deleted
    ? { ...board, data: { ...board.data, membersOnly: id } }
    : board;
}

/** What a board's levels govern: listing, reading, posting, commenting. */
export type BoardAction = "list" | "read" | "write" | "comment";

export function boardAllowed(
  board: NaruDocument | null,
  access: Access,
  action: BoardAction,
): boolean {
  if (!board) return false;
  // A members-only group's boards are its members' (and moderators').
  if (
    board.data.membersOnly &&
    access.role !== "moderator" &&
    !(access.groups ?? []).includes(board.data.membersOnly)
  )
    return false;
  if (access.role === "moderator")
    return (
      action === "read" || action === "list" || board.data.enabled !== false
    );
  return (
    board.data.enabled !== false &&
    access.level >= (board.data[`${action}Level`] ?? 2)
  );
}

/** Whether `viewer` (by default the caller) with `access` may read the post. */
export async function logReadable(
  ctx: ReadCtx,
  row: NaruDocument | null,
  access: Access,
  viewer: string | null | undefined = ctx.member?.id,
): Promise<boolean> {
  return (
    row &&
    !row.data.deleted &&
    // 멤버공개 (wr_secret): a visitor sees it locked, with no comments.
    (row.data.membersOnly !== true || Boolean(viewer)) &&
    boardAllowed(
      await boardOf(ctx, row.data.board ?? "default"),
      access,
      "read",
    ) &&
    (!row.data.secret || author(row) === viewer || access.role === "moderator")
  );
}

/**
 * Deletes a log with its comments in bounded batches: a call writes at most
 * 25 times, so a large one is marked deleted and finished by calling again.
 * Its uploads stay: Naru deletes media only when asked, and marks
 * unreferenced uploads in its library. (A character is deleted at once by
 * the characters/sheet:remove mutation.)
 */
export async function deleteCommunityDocument(
  ctx: Ctx,
  collection: string,
  kind: string,
  row: NaruDocument,
): Promise<{ done: boolean }> {
  if (kind !== "logs") {
    await ctx.delete(collection, row.id);
    return { done: true };
  }
  if (!row.data.deleted)
    await ctx.set(collection, row.id, { ...row.data, deleted: true });
  let unfinished = false;
  // 25 writes (a quarter of a call's 100 operations), less the marker and
  // the parent's delete, and two kept spare: what the children may spend.
  let remaining = 25 - 1 - 1 - 2;
  // A comment's reward is taken back as it goes (bbs/delete.php:100-104):
  // up to two writes more for each.
  const remove = async (
    target: string,
    filter: Filter,
    detach = false,
    each: ((child: NaruDocument) => Promise<number>) | null = null,
  ) => {
    const most = each ? 3 : 1;
    if (remaining < most) {
      unfinished = true;
      return;
    }
    const page = await ctx.list(target, {
      filter,
      size: Math.min(10, Math.floor(remaining / most)),
    });
    unfinished ||= Boolean(page.nextCursor);
    for (const child of page.documents) {
      if (remaining < most) {
        unfinished = true;
        break;
      }
      remaining--;
      if (each) remaining -= await each(child);
      if (detach)
        await ctx.set(target, child.id, { ...child.data, character: null });
      else await ctx.delete(target, child.id);
    }
  };
  const board = (await ctx.get(BOARDS, row.data.board ?? "default"))?.data;
  await remove(`${PREFIX}comments`, { logId: row.id }, false, (child) =>
    takeBackReward(
      ctx,
      child,
      `${board?.name ?? "게시판"} ${row.data.number ?? ""} 댓글삭제`,
    ),
  );
  if (!unfinished) await ctx.delete(collection, row.id);
  return { done: !unfinished };
}

export async function record(
  ctx: Ctx,
  kind: string,
  details: Data,
  owner: string = ctx.member.id,
) {
  await addHistory(ctx, { owner, kind, at: ctx.now, ...details });
}

/**
 * One of the caller's own characters as a document ({ id, data }, as old
 * code reads it), or null.
 */
export async function ownCharacter(
  ctx: ReadCtx,
  id: unknown,
): Promise<Character | null> {
  const row = await ownRow(ctx, id);
  return row ? sheetOf(row) : null;
}

export async function weightedRows(
  ctx: ReadCtx,
  collection: string,
  filter?: Filter,
): Promise<NaruDocument[]> {
  const rows = [];
  let after = null;
  do {
    const page = await ctx.list(collection, { size: 100, after, filter });
    rows.push(...page.documents);
    after = page.nextCursor;
    if (rows.length > 2000)
      throw new Error("A draw table may contain at most 2000 entries.");
  } while (after);
  return rows;
}

export const GACHA_COST = 50;

/** The caller's wallet: { balance, lastDaily }. */
export async function wallet(ctx: ReadCtx): Promise<Data> {
  const current = await walletOf(ctx, ctx.member.id);
  amount(current.balance, "Balance");
  return current;
}

export async function pay(
  ctx: Ctx,
  current: Data,
  amount: number,
  changes: Data = {},
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

/**
 * Pays a member the board's reward for a post or comment (insert_point with
 * bo_write_point or bo_comment_point, bbs/write_update.php:309,
 * write_comment_update.php:200) in the community's money, with a history
 * row; returns what was paid, which the post or comment keeps as `reward`.
 */
export async function payReward(
  ctx: Ctx,
  reward: unknown,
  memo: string,
): Promise<number> {
  const paid = Number.isSafeInteger(reward) && (reward as number) > 0;
  if (!paid || !ctx.member) return 0;
  const current = await wallet(ctx);
  const balance = current.balance + (reward as number);
  if (!Number.isSafeInteger(balance))
    throw new Error("Balance is outside its allowed range.");
  await saveWallet(ctx, ctx.member.id, balance);
  await record(ctx, "board", { delta: reward, balance, memo });
  return reward as number;
}

/**
 * Takes back the reward a post or comment was paid, from its author, when it
 * is deleted (bbs/delete.php:78, delete_comment.php:63), down to nothing:
 * a balance never goes below zero here. Returns the writes it spent.
 */
export async function takeBackReward(
  ctx: Ctx,
  row: NaruDocument,
  memo: string,
): Promise<number> {
  const reward = row.data.reward;
  const owner = author(row);
  if (!Number.isSafeInteger(reward) || reward <= 0 || !owner) return 0;
  const before = (await walletOf(ctx, owner)).balance;
  const taken = Math.min(reward, before);
  if (!taken) return 0;
  const balance = before - taken;
  await saveWallet(ctx, owner, balance);
  await record(ctx, "board", { delta: -taken, balance, memo }, owner);
  return 2;
}

export async function give(
  ctx: Ctx,
  item: NaruDocument,
  from: string,
  character: string | null = null,
) {
  return await ctx.add(INVENTORY, {
    owner: ctx.member.id,
    item: item.id,
    name: item.data.name,
    from,
    ...(character ? { character } : {}),
  });
}

export async function draw(
  ctx: ReadCtx,
  source: string | null = null,
  collection: string = GACHA,
): Promise<{ configured: boolean; prize: NaruDocument | null }> {
  const table = (
    await weightedRows(ctx, collection, source ? { source } : undefined)
  ).filter((row) => {
    if ((row.data.source ?? null) !== source) return false;
    if (
      typeof row.data.weight !== "number" ||
      !Number.isFinite(row.data.weight) ||
      row.data.weight < 0
    )
      throw new Error("Draw weights must be finite non-negative numbers.");
    return row.data.weight > 0;
  });
  if (!table.length) return { configured: false, prize: null };
  const total = table.reduce((sum, row) => sum + row.data.weight, 0);
  if (!Number.isFinite(total)) throw new Error("Draw weights are too large.");
  let roll = Math.random() * total;
  const won =
    table.find((row) => (roll -= row.data.weight) < 0) ?? table.at(-1);
  if (won.data.item === null) return { configured: true, prize: null };
  const prize =
    typeof won.data.item === "string"
      ? await ctx.get(ITEMS, won.data.item)
      : null;
  if (!prize)
    throw new Error(`뽑기의 아이템 ${won.data.item}이 상점에 없습니다.`);
  return { configured: true, prize };
}

export async function ownedItem(
  ctx: ReadCtx,
  id: unknown,
): Promise<NaruDocument | null> {
  const owned = typeof id === "string" ? await ctx.get(INVENTORY, id) : null;
  return owned?.data.owner === ctx.member.id ? owned : null;
}

/**
 * A character's official record (characters.js's characterState) for the
 * old code: its row, the stat definitions and the record's data. Old code
 * writes it back with saveState.
 */
export async function characterState(
  ctx: Ctx | ReadCtx,
  character: string,
): Promise<{
  existing: CharacterRow;
  definitions: StatDefinition[];
  data: Progress;
}> {
  return await recordOf(ctx as Ctx, character);
}

/** Why `character` may not use `item` under its catalog conditions, or null. */
/** Fails the call unless `character` meets the item's use requirements. */
export async function requireUsable(
  ctx: Ctx,
  item: NaruDocument,
  character: string | null,
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
  ]) {
    if (
      requirements[key] !== undefined &&
      (!Array.isArray(requirements[key]) ||
        requirements[key].some((value) => typeof value !== "string"))
    )
      throw new Error("Use restrictions must be lists of identifiers.");
    if (
      requirements[key]?.length &&
      // The sheet's own 소속 and 종족 (ch_side, ch_class).
      !requirements[key].includes(sheet.data[field])
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
export async function restoreStat(ctx: Ctx, effect: Data, character: string) {
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
