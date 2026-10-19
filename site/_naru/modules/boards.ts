// Boards in the site's tables: the owner's boards and groups, posts and
// comments as readers see them, and who may do what on a board (the old
// community-board, boards and shown rules). Every board query and mutation
// starts from here, so a post reads the same everywhere. Posts and
// comments keep the shape pages know ({ id, data }); an ID is its row's
// number as a string.
import {
  communityAccess,
  communitySettings,
  lacking,
  one,
  parsed,
  siteOpen,
} from "./access.js";
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
  /** 게시판 관리자 (bo_admin): a member's ID, or null. */
  admin: string | null;
  /** The group's members_only and 그룹 관리자, from boardsOf/boardOf's join. */
  group_members_only?: number | null;
  group_admin?: string | null;
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
    /** 게시판 관리자 and its group's 그룹 관리자: members' IDs. */
    admin?: string;
    groupAdmin?: string;
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
  admin: "admin",
  // 출력 순서 (bo_order).
  order: "sort_order",
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
  if (row.group_id && row.group_admin) data.groupAdmin = row.group_admin;
  return { id: row.id, data: data as Board["data"] };
}

const BOARD_SELECT = `SELECT boards.*, board_groups.members_only AS group_members_only,
    board_groups.admin AS group_admin
  FROM boards LEFT JOIN board_groups ON board_groups.id = boards.group_id`;

/** Every board the owner made, in ID order. */
export async function boardsOf(ctx: SqlCtx): Promise<Board[]> {
  return (
    await ctx.sql<BoardRow>(
      `${BOARD_SELECT} ORDER BY boards.sort_order, boards.id`,
    )
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
export type BoardAction = "list" | "read" | "write" | "comment" | "reply";

export function boardAllowed(
  board: Board | null,
  access: Access,
  action: BoardAction,
): boolean {
  if (!board) return false;
  // A members-only group's boards are its members' (and the staff's).
  if (
    board.data.membersOnly &&
    !isStaff(access, board) &&
    !(access.groups ?? []).includes(board.data.membersOnly)
  )
    return false;
  if (isStaff(access, board))
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
  /** wr_link1 and wr_link2, and a plain board's further pictures: JSON lists. */
  links: string;
  files: string;
  /** 답변글: the thread's first post, and the reply's place in it. */
  thread: number | null;
  reply_path: string;
  tags?: string | null;
  /** 조회수 (post_hits), where read with TAGS. */
  hits?: number | null;
  /** 첨부파일: a JSON list of {url, name, size, type}. */
  attachments: string;
  /** Their 다운로드 counts by address (attachment_downloads), with TAGS. */
  downloads?: string | null;
  /** Its links' 연결 counts by address (link_hits), with TAGS. */
  link_hits?: string | null;
  /** 췩: still being written. */
  writing?: number;
  /** 추천 and 비추천 (post_votes), with TAGS. */
  good?: number;
  nogood?: number;
  comment_count?: number;
}

/**
 * A post's columns a copy keeps (adm/board_copy.php): all but its id, its
 * board and its reward, which a copy does not pay.
 */
export const POST_COPY_COLUMNS = [
  "number",
  "owner",
  "character_id",
  "title",
  "category",
  "format",
  "body",
  "image",
  "secret",
  "members_only",
  "adult",
  "wide",
  "fold",
  "anonymous",
  "notice",
  "speaker",
  "dice",
  "rolls",
  "actions",
  "called",
  "settlement",
  "guest_name",
  "guest_hash",
  "created_at",
  "updated_at",
  "version",
  "links",
  "files",
  "reply_path",
  "attachments",
] as const;
/** A comment's columns a copy keeps: all but its id, its post and its reward. */
export const COMMENT_COPY_COLUMNS = [
  "owner",
  "body",
  "dice",
  "rolls",
  "anonymous",
  "character_id",
  "speaker",
  "actions",
  "called",
  "admin",
  "settlement",
  "secret",
  "guest_name",
  "guest_hash",
  "created_at",
  "updated_at",
  "version",
] as const;

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
  secret: number;
  /** 댓글 답변: the thread's first comment, and the reply's place in it. */
  thread: number | null;
  reply_path: string;
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
  "(SELECT json_group_array(tag) FROM post_tags WHERE post_tags.post_id = posts.id) AS tags, (SELECT hits FROM post_hits WHERE post_hits.post_id = posts.id) AS hits, (SELECT json_group_object(url, downloads) FROM attachment_downloads WHERE attachment_downloads.post_id = posts.id) AS downloads, (SELECT json_group_object(url, hits) FROM link_hits WHERE link_hits.post_id = posts.id) AS link_hits, (SELECT coalesce(sum(vote = 1), 0) FROM post_votes WHERE post_votes.post_id = posts.id) AS good, (SELECT coalesce(sum(vote = -1), 0) FROM post_votes WHERE post_votes.post_id = posts.id) AS nogood";
/** A post with its tags and 조회수. */
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
    // A post written as HTML before posts became plain text reads as its
    // text; no member's HTML reaches the page.
    format: "text",
    text: row.format === "html" ? htmlAsText(row.body) : row.body,
    image: row.image,
    secret: row.secret !== 0,
    membersOnly: row.members_only !== 0,
    adult: row.adult !== 0,
    wide: row.wide !== 0,
    fold: row.fold !== 0,
    notice: row.notice !== 0,
    ...(list(row.links).length ? { links: list(row.links) } : {}),
    ...(list(row.files).length ? { files: list(row.files) } : {}),
    ...(row.settlement !== null
      ? { settlement: parsed(row.settlement, null) }
      : {}),
    ...(row.tags !== undefined ? { tags: list(row.tags) } : {}),
    ...(row.hits !== undefined ? { hits: row.hits ?? 0 } : {}),
    ...(row.writing ? { writing: true } : {}),
    ...(row.good !== undefined
      ? { good: Number(row.good ?? 0), nogood: Number(row.nogood ?? 0) }
      : {}),
    ...(row.link_hits !== undefined && list(row.links).length
      ? {
          linkHits: list(row.links).map((url) =>
            Number(parsed<Record<string, number>>(row.link_hits, {})[url] ?? 0),
          ),
        }
      : {}),
    ...(list(row.attachments).length
      ? {
          attachments: list(row.attachments).map((file) => ({
            ...file,
            downloads: Number(
              parsed<Record<string, number>>(row.downloads, {})[file.url] ?? 0,
            ),
          })),
        }
      : {}),
    // 답변글: how deep a reply is (wr_reply's length), and what it answers.
    ...(row.reply_path
      ? {
          depth: row.reply_path.length / REPLY_DIGITS,
          thread: String(row.thread),
        }
      : {}),
  });
}

/** Digits a reply's path takes a level; and how deep replies go (wr_reply's 10). */
export const REPLY_DIGITS = 3;

/**
 * Where a reply goes under `parent` (wr_reply, wr_comment_reply): its
 * thread, the parent's own or the parent, and its path, the parent's and
 * its place among the parent's replies, the later below or (`above`,
 * bo_reply_order 0) above. Refused past `depth` levels or 999 replies.
 */
export async function replyPlace(
  ctx: SqlCtx & Pick<QueryCtx, "fail">,
  table: "posts" | "comments",
  parent: { id: number; thread: number | null; reply_path: string },
  depth: number,
  above = false,
): Promise<{ thread: number; replyPath: string }> {
  if (parent.reply_path.length / REPLY_DIGITS >= depth)
    ctx.fail("INVALID_REQUEST", "더 이상 답변하실 수 없습니다.", {
      reason: "reply_depth",
    });
  const thread = parent.thread ?? parent.id;
  const { n } = await one<{ n: number }>(
    ctx,
    `SELECT count(*) AS n FROM ${table} WHERE thread = ?
     AND length(reply_path) = ? AND substr(reply_path, 1, ?) = ?`,
    [
      thread,
      parent.reply_path.length + REPLY_DIGITS,
      parent.reply_path.length,
      parent.reply_path,
    ],
  );
  if (n >= 999)
    ctx.fail("INVALID_REQUEST", "더 이상 답변하실 수 없습니다.", {
      reason: "reply_count",
    });
  const place = above ? 998 - n : n + 1;
  return {
    thread,
    replyPath: parent.reply_path + String(place).padStart(REPLY_DIGITS, "0"),
  };
}
export const REPLY_DEPTH = 10;

/** A comment row as its document, whole. */
export function commentOf(row: CommentRow): Written {
  return writtenOf(row, {
    logId: String(row.post_id),
    text: row.body,
    ...(row.admin ? { admin: true } : {}),
    ...(row.settlement ? { settlement: true } : {}),
    ...(row.secret ? { secret: true } : {}),
    ...(row.reply_path
      ? {
          depth: row.reply_path.length / REPLY_DIGITS,
          thread: String(row.thread),
        }
      : {}),
  });
}

/** How deep comment replies go (G5's wr_comment_reply of 5). */
export const COMMENT_REPLY_DEPTH = 5;

/**
 * A comment as presentPost shows it, and a secret one (wr_option secret,
 * bbs/view_comment.php:39-56) without its text and dice but to the staff,
 * the post's writer and the comment's own: "비밀글 입니다." on the page.
 */
export function presentComment(
  row: Written,
  reader: { member?: string | null; staff?: boolean },
  postOwner: string | null,
): Written {
  const shown = presentPost(row, reader);
  if (
    row.data.secret !== true ||
    reader.staff ||
    (reader.member &&
      (row.data.owner === reader.member || postOwner === reader.member))
  )
    return shown;
  const { text, dice, rolls, actions, ...rest } = shown.data;
  return { ...shown, data: { ...rest, text: "", hidden: true } };
}

/**
 * Comments a reader may find by their text: not others' secret ones, but
 * for the staff of `staffBoards` (board IDs, or JSON of them; true: every
 * board). The statement joins the comment's post as `posts`.
 */
export function readableComments(
  viewer: string | null,
  staffBoards: string[] | string | true,
): { text: string; values: SqlValue[] } {
  if (staffBoards === true) return { text: "1", values: [] };
  return {
    text: `(comments.secret = 0${viewer ? " OR comments.owner = ? OR posts.owner = ?" : ""} OR posts.board IN (SELECT value FROM json_each(?)))`,
    values: [
      ...(viewer ? [viewer, viewer] : []),
      typeof staffBoards === "string"
        ? staffBoards
        : JSON.stringify(staffBoards),
    ],
  };
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

/**
 * Whether a member is the staff here: a moderator (the role staff)
 * anywhere, and on `board` its 게시판 관리자 or its group's 그룹 관리자, as
 * GnuBoard's is_admin is 'board' or 'group' there (lib/common.lib.php:794).
 */
export function isStaff(access: Access, board?: Board | null): boolean {
  if (access.role === "moderator") return true;
  if (!board || !access.member || access.left) return false;
  return (
    board.data.admin === access.member ||
    board.data.groupAdmin === access.member
  );
}

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
    download = true,
  }: { member?: string | null; staff?: boolean; download?: boolean } = {},
): Written {
  let data = row.data;
  // Below the board's 다운로드 등급, a file is its name and size: its address
  // is no reader's to have (bbs/download.php refuses them).
  if (!download && Array.isArray(data.attachments) && data.attachments.length)
    data = {
      ...data,
      attachments: data.attachments.map((file) => ({
        ...file,
        url: "",
        locked: true,
      })),
    };
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

/** What presentPost needs of the caller, on `board`. */
export const readerOf = (
  ctx: SqlCtx,
  access: Access,
  board?: Board | null,
) => ({
  member: ctx.member?.id ?? null,
  staff: isStaff(access, board),
  download: downloadable(access, board ?? null),
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

/** Whether a secret post is the reader's to read: their own, or the staff's of its board. */
export const secretReadable = (
  row: { secret: number; owner: string | null },
  access: Access,
  viewer: string | null | undefined,
  board?: Board | null,
) =>
  !row.secret ||
  isStaff(access, board) ||
  Boolean(viewer && row.owner === viewer);

/** The SQL condition secretReadable makes of a board's list: its text and value. */
export function secretClause(
  access: Access,
  viewer: string | null | undefined,
  table = "posts",
  board?: Board | null,
): { text: string; values: SqlValue[] } {
  if (isStaff(access, board)) return { text: "1", values: [] };
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
      (board = board === undefined ? await boardOf(ctx, row.board) : board),
      access,
      "read",
    ) &&
    secretReadable(row, access, viewer, board),
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

/**
 * A board's points setting (글읽기 포인트, 다운로드 포인트), 0 when unset or
 * while 포인트 사용 (cf_use_point) is off.
 */
export async function boardPoints(
  ctx: SqlCtx,
  board: Board,
  key: "readReward" | "downloadPoint",
): Promise<number> {
  const value = board.data[key];
  if (!Number.isSafeInteger(value) || !value) return 0;
  return (await communitySettings(ctx)).usePoint === false ? 0 : value;
}

/** Whether `access` may download a board's files (bo_download_level). */
export const downloadable = (access: Access, board: Board | null) =>
  isStaff(access, board) ||
  access.level >=
    (Number.isInteger(board?.data.downloadLevel)
      ? board.data.downloadLevel
      : 1);

/** Body limits: posts, and a post written as HTML before, as content pages. */
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

/**
 * A post written as HTML before posts became plain text, as its text: the
 * markup gone and the common entities read.
 */
export const htmlAsText = (value: unknown): string =>
  plainText(value).replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, name: string) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]!,
  );

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

/**
 * Keeps a post's full-text row (posts_search, by its id) its title and text
 * as plain text: a new post's (`made`) is added, an edited one's replaced.
 * Naru has no triggers, so every write of a post's title or text calls this.
 */
export async function savePostSearch(
  ctx: SqlCtx,
  row: Pick<PostRow, "id" | "title" | "body" | "format">,
  made: boolean,
) {
  const body = row.format === "html" ? plainText(row.body) : row.body;
  if (made)
    await ctx.sql`INSERT INTO posts_search (rowid, title, body) VALUES (${row.id}, ${row.title}, ${body})`;
  else
    await ctx.sql`UPDATE posts_search SET title = ${row.title}, body = ${body} WHERE rowid = ${row.id}`;
}

/** The same for a comment's text (comments_search). */
export async function saveCommentSearch(
  ctx: SqlCtx,
  row: Pick<CommentRow, "id" | "body">,
  made: boolean,
) {
  if (made)
    await ctx.sql`INSERT INTO comments_search (rowid, body) VALUES (${row.id}, ${row.body})`;
  else
    await ctx.sql`UPDATE comments_search SET body = ${row.body} WHERE rowid = ${row.id}`;
}

/** Terms this long or longer are found by the full-text tables (trigram). */
export const FULL_TEXT_MIN = 3;

/**
 * A full-text query finding `text` anywhere, as LIKE '%text%' would: one
 * phrase, its quotes doubled, so nothing in it is MATCH's syntax.
 */
export const phrase = (text: string) => `"${text.replace(/"/g, '""')}"`;

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
  if ((await communitySettings(ctx)).usePoint === false) return 0;
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
 * Refuses a writer deleting their own post or comment while they hold less
 * than the rewards it takes back (`owed`): else they could spend a reward
 * and delete what earned it, keeping the money, as takeBackReward stops at
 * zero. The staff deleting another's are not held to it.
 */
export async function canRepay(ctx: BoardCtx, member: string, owed: number) {
  if (owed > 0 && (await walletOf(ctx, member)).balance < owed)
    ctx.fail("CONFLICT", await lacking(ctx, "moneyName"), {
      reason: "not_enough",
    });
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
