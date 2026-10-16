// Shared collection identifiers and transactional domain helpers.
export { IMAGE_SLOTS, imageSlotsOf, viewerOf } from "./images.js";
import type { Ctx, Data, Filter, NaruDocument, ReadCtx } from "./naru-types.js";
import type { Access } from "./access.js";
import { saveWallet, walletOf } from "./members.js";
import { record, wallet } from "./economy.js";
import {
  characterState as recordOf,
  ownCharacter as ownRow,
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
  subject,
  lacking,
  restrictedFor,
} from "./access.js";
export type { Access, Names } from "./access.js";
export { loginReward } from "./members.js";
// The economy's helpers (economy.js), for the old code that imports them
// from here.
export { pay, record, wallet } from "./economy.js";
export const PREFIX = "neo_avocado_";

export const MESSAGES = `${PREFIX}messages`;

export const BOARDS = `${PREFIX}boards`;

export const CALLS = `${PREFIX}calls`;

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
