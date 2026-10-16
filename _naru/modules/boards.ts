// Boards in the site's tables: the owner's boards and groups, posts and
// comments as readers see them, and who may do what on a board (the old
// community-board, boards and shown rules). Every board query and mutation
// starts from here, so a post reads the same everywhere. Posts and
// comments keep the shape pages know ({ id, data }); an ID is its row's
// number as a string.
import { communityAccess, one, parsed, siteOpen } from "./access.js";
import type { Access, SqlCtx } from "./access.js";
import { addHistory, saveWallet, walletOf } from "./members.js";
import type { QueryCtx, SqlValue } from "./naru-types.js";

/** What board code uses of a call's ctx: the caller, `sql`, `fail` and `now`. */
export type BoardCtx = SqlCtx &
  Pick<QueryCtx, "fail"> & { readonly now: number };

/** A boards row, with its group's members_only when read with it. */
export interface BoardRow {
  id: string;
  name: string;
  group_id: string | null;
  kind: string;
  enabled: number;
  list_level: number;
  read_level: number;
  write_level: number;
  comment_level: number;
  anonymous: number;
  secret: string;
  write_reward: number;
  comment_reward: number;
  write_min: number;
  write_max: number;
  comment_min: number;
  comment_max: number;
  edit_lock: number;
  page_rows: number;
  fold_height: number;
  options: string;
  /** The group's members_only, from boardsOf/boardOf's join. */
  group_members_only?: number | null;
}

/** A board as pages read it: the admin's fields by their names. */
export interface Board {
  id: string;
  data: Record<string, any> & {
    name: string;
    kind: string;
    enabled: boolean;
    secret: string;
    /** A members-only group's ID (gr_use_access), for boardAllowed. */
    membersOnly?: string;
    categories?: string[];
  };
}

/** A board's columns, by the names the admin and pages use. */
export const BOARD_COLUMNS = {
  name: "name",
  group: "group_id",
  kind: "kind",
  enabled: "enabled",
  listLevel: "list_level",
  readLevel: "read_level",
  writeLevel: "write_level",
  commentLevel: "comment_level",
  anonymous: "anonymous",
  secret: "secret",
  writeReward: "write_reward",
  commentReward: "comment_reward",
  writeMin: "write_min",
  writeMax: "write_max",
  commentMin: "comment_min",
  commentMax: "comment_max",
  editLock: "edit_lock",
  pageRows: "page_rows",
  foldHeight: "fold_height",
} as const;
const BOARD_FLAGS = new Set(["enabled", "anonymous"]);

export function boardOfRow(row: BoardRow): Board {
  const data: Record<string, any> = parsed(row.options, {});
  for (const [field, column] of Object.entries(BOARD_COLUMNS)) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    data[field] = BOARD_FLAGS.has(field) ? value !== 0 : value;
  }
  // A board in a members-only group (gr_use_access) carries the group's ID.
  if (row.group_id && row.group_members_only) data.membersOnly = row.group_id;
  return { id: row.id, data: data as Board["data"] };
}

const BOARD_SELECT = `SELECT boards.*, board_groups.members_only AS group_members_only
  FROM boards LEFT JOIN board_groups ON board_groups.id = boards.group_id`;

/** Every board the owner made, in ID order. */
export async function boardsOf(ctx: SqlCtx): Promise<Board[]> {
  return (
    await ctx.sql<BoardRow>(`${BOARD_SELECT} ORDER BY boards.id`)
  ).rows.map(boardOfRow);
}

/**
 * A board the owner made, or null: as in the original, a site has no boards
 * until its admin creates them (adm/board_form.php). A post names its board.
 */
export async function boardOf(ctx: SqlCtx, id: unknown): Promise<Board | null> {
  if (typeof id !== "string" || !id) return null;
  const row = await one<BoardRow>(ctx, `${BOARD_SELECT} WHERE boards.id = ?`, [
    id,
  ]);
  return row ? boardOfRow(row) : null;
}

/** What a board's levels govern: listing, reading, posting, commenting. */
export type BoardAction = "list" | "read" | "write" | "comment";

export function boardAllowed(
  board: Board | null,
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

/** Refuses what the caller may not do on a board. */
export function requireBoard(
  ctx: Pick<QueryCtx, "fail">,
  board: Board | null,
  access: Access,
  ...actions: BoardAction[]
) {
  if (!actions.every((action) => boardAllowed(board, access, action)))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
}

/** A posts row, with its tags when read with them (TAGS). */
export interface PostRow {
  id: number;
  board: string;
  number: number;
  owner: string | null;
  character_id: number | null;
  title: string;
  category: string;
  format: string;
  body: string;
  image: string | null;
  secret: number;
  members_only: number;
  adult: number;
  wide: number;
  fold: number;
  anonymous: number;
  notice: number;
  speaker: string | null;
  dice: number;
  rolls: string | null;
  actions: string;
  called: string;
  reward: number;
  settlement: string | null;
  guest_name: string | null;
  guest_hash: string | null;
  created_at: number;
  updated_at: number;
  version: number;
  tags?: string | null;
  comment_count?: number;
}

/** A comments row. */
export interface CommentRow {
  id: number;
  post_id: number;
  owner: string | null;
  body: string;
  dice: number;
  rolls: string | null;
  anonymous: number;
  character_id: number | null;
  speaker: string | null;
  actions: string;
  called: string;
  reward: number;
  admin: number;
  settlement: number;
  guest_name: string | null;
  guest_hash: string | null;
  created_at: number;
  updated_at: number;
  version: number;
}

/** A post or comment as pages read it. */
export interface Written {
  id: string;
  data: Record<string, any>;
  revision: string;
  createdAt: string;
  createdBy: null;
}

/** A post's tags, as a column of a SELECT from posts. */
export const TAGS =
  "(SELECT json_group_array(tag) FROM post_tags WHERE post_tags.post_id = posts.id) AS tags";
/** A post with its tags. */
export const POST_SELECT = `SELECT posts.*, ${TAGS} FROM posts`;

const list = (text: unknown): any[] => {
  const value = parsed<any>(text, []);
  return Array.isArray(value) ? value : [];
};

/** What posts and comments share, as pages read them. */
function writtenOf(
  row: PostRow | CommentRow,
  data: Record<string, any>,
): Written {
  const actions = list(row.actions);
  Object.assign(data, {
    owner: row.owner,
    dice: row.dice !== 0,
    anonymous: row.anonymous !== 0,
    ...(row.character_id !== null
      ? { character: String(row.character_id) }
      : {}),
    ...(row.speaker !== null ? { speaker: parsed(row.speaker, null) } : {}),
    ...(row.rolls !== null ? { rolls: list(row.rolls) } : {}),
    ...(actions.length ? { actions } : {}),
    ...(row.reward > 0 ? { reward: row.reward } : {}),
    ...(row.guest_name !== null ? { guest: { name: row.guest_name } } : {}),
  });
  return {
    id: String(row.id),
    data,
    revision: String(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: null,
  };
}

/** A post row as its document, whole. */
export function postOf(row: PostRow): Written {
  return writtenOf(row, {
    board: row.board,
    number: row.number,
    title: row.title,
    category: row.category,
    format: row.format,
    text: row.body,
    image: row.image,
    secret: row.secret !== 0,
    membersOnly: row.members_only !== 0,
    adult: row.adult !== 0,
    wide: row.wide !== 0,
    fold: row.fold !== 0,
    notice: row.notice !== 0,
    ...(row.settlement !== null
      ? { settlement: parsed(row.settlement, null) }
      : {}),
    ...(row.tags !== undefined ? { tags: list(row.tags) } : {}),
  });
}

/** A comment row as its document, whole. */
export function commentOf(row: CommentRow): Written {
  return writtenOf(row, {
    logId: String(row.post_id),
    text: row.body,
    ...(row.admin ? { admin: true } : {}),
    ...(row.settlement ? { settlement: true } : {}),
  });
}

/** A post's or comment's ID as its row's number, or null when it is none. */
export function rowKey(id: unknown): number | null {
  if (typeof id === "number")
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  return typeof id === "string" && /^[1-9]\d{0,14}$/.test(id)
    ? Number(id)
    : null;
}

/** A post's row, with its tags, or null. */
export async function postRow(
  ctx: SqlCtx,
  id: unknown,
): Promise<PostRow | null> {
  const key = rowKey(id);
  return key === null
    ? null
    : await one<PostRow>(ctx, `${POST_SELECT} WHERE id = ?`, [key]);
}

/** A comment's row, or null. */
export async function commentRow(
  ctx: SqlCtx,
  id: unknown,
): Promise<CommentRow | null> {
  const key = rowKey(id);
  return key === null
    ? null
    : await one<CommentRow>(ctx, "SELECT * FROM comments WHERE id = ?", [key]);
}

/** The site's owner on the boards: the staff, at the highest level. */
export const OWNER_ACCESS: Access = Object.freeze({
  level: 10,
  role: "moderator",
});

/**
 * The caller's access on the boards: a member's or a visitor's
 * (communityAccess), and the site's owner's (admin.call) as the staff's.
 */
export const accessOf = async (ctx: SqlCtx): Promise<Access> =>
  ctx.owner ? OWNER_ACCESS : await communityAccess(ctx);

/** Whether a member is the staff here: a moderator (the role staff). */
export const isStaff = (access: Access) => access.role === "moderator";

/**
 * A post or comment as its reader sees it (skin/board/mmb/list.log.skin.php).
 * 멤버공개 shows a visitor only its number, category and marks; 익명 hides
 * who wrote it from all but its author and the staff, as "익명의 누군가".
 */
export function presentPost(
  row: Written,
  {
    member = null,
    staff = false,
  }: { member?: string | null; staff?: boolean } = {},
): Written {
  let data = row.data;
  if (data.anonymous === true && !staff && !(member && data.owner === member)) {
    data = { ...data, owner: null };
    for (const key of ["speaker", "character", "guest"]) delete data[key];
  }
  if (data.membersOnly === true && !member && !staff) {
    const shown = {};
    for (const key of [
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
  return { ...row, data };
}

/** What presentPost needs of the caller. */
export const readerOf = (ctx: SqlCtx, access: Access) => ({
  member: ctx.member?.id ?? null,
  staff: isStaff(access),
});

/**
 * A post as a reader who may not read its body sees it: a locked entry (a
 * Q&A board's others' secret questions).
 */
export function lockedPost(row: PostRow): Written {
  const anonymous = row.anonymous !== 0;
  return {
    id: String(row.id),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: null,
    revision: String(row.version),
    data: {
      owner: anonymous ? null : row.owner,
      number: row.number,
      board: row.board,
      ...(row.guest_name !== null ? { guest: { name: row.guest_name } } : {}),
      secret: true,
      locked: true,
    },
  };
}

/** Whether a secret post is the reader's to read: their own, or the staff's. */
export const secretReadable = (
  row: { secret: number; owner: string | null },
  access: Access,
  viewer: string | null | undefined,
) => !row.secret || isStaff(access) || Boolean(viewer && row.owner === viewer);

/** The SQL condition secretReadable makes of a list: its text and value. */
export function secretClause(
  access: Access,
  viewer: string | null | undefined,
  table = "posts",
): { text: string; values: SqlValue[] } {
  if (isStaff(access)) return { text: "1", values: [] };
  if (viewer)
    return {
      text: `(${table}.secret = 0 OR ${table}.owner = ?)`,
      values: [viewer],
    };
  return { text: `${table}.secret = 0`, values: [] };
}

/**
 * Whether `viewer` (by default the caller) with `access` may read the post
 * whole: its board's read level, 멤버공개 for members (a visitor sees it
 * locked, with no comments), and a secret post its author's and the staff's.
 * `board` is the post's, when read already.
 */
export async function postReadable(
  ctx: SqlCtx,
  row: PostRow | null,
  access: Access,
  viewer: string | null | undefined = ctx.member?.id,
  board?: Board | null,
): Promise<boolean> {
  return Boolean(
    row &&
    (!row.members_only || Boolean(viewer)) &&
    boardAllowed(
      board === undefined ? await boardOf(ctx, row.board) : board,
      access,
      "read",
    ) &&
    secretReadable(row, access, viewer),
  );
}

/** The caller's access and the post, when they may read it whole; else NOT_FOUND. */
export async function readablePost(
  ctx: BoardCtx,
  id: unknown,
): Promise<{ access: Access; row: PostRow; board: Board }> {
  const access = await accessOf(ctx);
  const row = await postRow(ctx, id);
  const board = row ? await boardOf(ctx, row.board) : null;
  if (!(await postReadable(ctx, row, access, ctx.member?.id, board)))
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  return { access, row, board };
}

/** Body limits: plain logs as before, HTML posts like content pages. */
export const TEXT_LIMIT = 2000;
export const HTML_LIMIT = 12000;
/** A comment's length: a textarea, as the original's (mmb/write_comment.php). */
export const COMMENT_LIMIT = 2000;

/** A rough text view of an HTML body, for previews, tags and calls. */
export const plainText = (value: unknown): string =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const MAX_TAGS = 5;
const TAG = /#([0-9a-zA-Z가-힣_]{1,30})/g;

/** A post's hashtags (mmb autolink's #tag), at most five. */
export function tagsOf(text: unknown): string[] {
  const tags = [];
  for (const match of String(text ?? "").matchAll(TAG))
    if (!tags.includes(match[1]) && tags.length < MAX_TAGS) tags.push(match[1]);
  return tags;
}

/** Makes a post's tags these. */
export async function saveTags(ctx: SqlCtx, post: number, tags: string[]) {
  await ctx.sql`DELETE FROM post_tags WHERE post_id = ${post}`;
  if (tags.length)
    await ctx.sql(
      `INSERT INTO post_tags (post_id, tag) VALUES ${tags.map(() => "(?, ?)").join(", ")}`,
      tags.flatMap((tag) => [post, tag]),
    );
}

/** A post with its text cut to 300 plain characters; 더 보기 reads the rest. */
export function excerpt(row: Written): Written {
  const raw = row.data.text ?? "";
  if (raw.length <= 300 && row.data.format !== "html") return row;
  const text = plainText(raw);
  return {
    ...row,
    data: {
      ...row.data,
      text: text.length > 300 ? `${text.slice(0, 300)}…` : text,
      truncated: true,
    },
  };
}

/**
 * Refuses a visitor while the site is closed (사이트공개 off), whose boards
 * are none: the original sends them to log in.
 */
export async function boardsViewable(ctx: SqlCtx & Pick<QueryCtx, "fail">) {
  if (!ctx.member && !ctx.owner && !(await siteOpen(ctx)))
    ctx.fail("ACCESS_DENIED", "회원 로그인 후 이용할 수 있습니다.", {
      reason: "site_closed",
    });
}

/** A board's name for a history memo: "로그 12 글쓰기". */
export const memoOf = (board: Board | null, number: unknown, what: string) =>
  `${board?.data.name ?? "게시판"} ${number ?? ""} ${what}`;

/**
 * Pays a member the board's reward for a post or comment (insert_point with
 * bo_write_point or bo_comment_point, bbs/write_update.php:309,
 * write_comment_update.php:200) in the community's money, with a history
 * row; returns what was paid, which the post or comment keeps as `reward`.
 */
export async function payReward(
  ctx: BoardCtx,
  reward: unknown,
  memo: string,
): Promise<number> {
  const paid = Number.isSafeInteger(reward) && (reward as number) > 0;
  if (!paid || !ctx.member) return 0;
  const member = ctx.member.id;
  const balance = (await walletOf(ctx, member)).balance + (reward as number);
  if (!Number.isSafeInteger(balance))
    throw new Error("Balance is outside its allowed range.");
  await saveWallet(ctx, member, balance);
  await addHistory(ctx, {
    owner: member,
    kind: "board",
    at: ctx.now,
    delta: reward,
    balance,
    memo,
  });
  return reward as number;
}

/**
 * Takes back the reward a post or comment was paid, from its author, when it
 * is deleted (bbs/delete.php:78, delete_comment.php:63), down to nothing:
 * a balance never goes below zero here.
 */
export async function takeBackReward(
  ctx: BoardCtx,
  row: { owner: string | null; reward: number },
  memo: string,
) {
  if (!Number.isSafeInteger(row.reward) || row.reward <= 0 || !row.owner)
    return;
  const before = (await walletOf(ctx, row.owner)).balance;
  const taken = Math.min(row.reward, before);
  if (!taken) return;
  const balance = before - taken;
  await saveWallet(ctx, row.owner, balance);
  await addHistory(ctx, {
    owner: row.owner,
    kind: "board",
    at: ctx.now,
    delta: -taken,
    balance,
    memo,
  });
}
