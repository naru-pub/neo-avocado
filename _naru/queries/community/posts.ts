// Posts as readers see them: a board's page (with its comment counts), one
// post, the board search, a guest's secret question opened with its
// password, 관심로그, 로그내역, and a board's newest post for the page's
// 새 글 notice. Visitors read the boards open to level 1 while the site is
// open (사이트공개).
import { containing, one } from "../../modules/access.js";
import type { Access } from "../../modules/access.js";
import {
  FULL_TEXT_MIN,
  POST_SELECT,
  TAGS,
  accessOf,
  boardAllowed,
  boardOf,
  boardsOf,
  excerpt,
  isStaff,
  lockedPost,
  phrase,
  postOf,
  postReadable,
  postRow,
  presentPost,
  readerOf,
  requireBoard,
  secretClause,
  secretReadable,
} from "../../modules/boards.js";
import type { Board, PostRow, Written } from "../../modules/boards.js";
import {
  boardNumber,
  listsContent,
  sortOf,
} from "../../modules/board-options.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

const invalid = (ctx: QueryCtx) =>
  ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });

/** The board, if the caller may list and read it; else ACCESS_DENIED. */
async function readableBoard(ctx: QueryCtx, id: unknown) {
  const access = await accessOf(ctx);
  const board = await boardOf(ctx, id);
  requireBoard(ctx, board, access, "list", "read");
  return { access, board };
}

/** A post on `board` as this caller sees it: 멤버공개 and 익명 (presentPost). */
const shown = (
  ctx: QueryCtx,
  access: Access,
  row: Written,
  board: Board | null | undefined,
) => presentPost(row, readerOf(ctx, access, board));

/** Questions on a Q&A board show at most this many a page, whole. */
const QUESTION_PAGE = 10;

/**
 * A page of a board's posts (bbs/list.php), notices first, newest first,
 * as many as the board shows a page (bo_page_rows; a Q&A board's whole
 * questions ten at most), with how many there are, the board itself and
 * each readable post's comment count: the board page in one read. `category`
 * narrows it to a 분류 (sca), `tag` to the posts with a #tag. On a Q&A board
 * (skin/board/qna) others' secret questions show locked, to be opened with
 * their password; elsewhere they are left out.
 */
export async function page(
  ctx: QueryCtx,
  args: {
    board?: string;
    page?: number;
    category?: string | null;
    tag?: string | null;
    upTo?: number | null;
  },
) {
  const {
    board: id,
    page = 1,
    category = null,
    tag = null,
    upTo = null,
  } = args ?? {};
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    (upTo !== null && (!Number.isSafeInteger(upTo) || upTo < 1)) ||
    (category !== null &&
      (typeof category !== "string" || category.length > 40)) ||
    (tag !== null && (typeof tag !== "string" || tag.length > 30))
  )
    invalid(ctx);
  const { access, board } = await readableBoard(ctx, id);
  const questions = board.data.kind === "qna" && !tag;
  const rows = Math.min(
    100,
    Math.max(1, boardNumber(board, "pageRows")),
    questions ? QUESTION_PAGE : 100,
  );
  const viewer = ctx.member?.id ?? null;
  const clauses = ["posts.board = ?"];
  const values: SqlValue[] = [board.id];
  if (category) {
    clauses.push("posts.category = ?");
    values.push(category);
  }
  // 로그번호 (get_sql_search_mmb's wr_num >= -N): log N and those before it.
  if (upTo !== null) {
    clauses.push("posts.number <= ?");
    values.push(upTo);
  }
  if (!questions) {
    const secret = secretClause(access, viewer, "posts", board);
    clauses.push(secret.text);
    values.push(...secret.values);
  }
  // A visitor asking by #tag is not shown a 멤버공개 post's: its tags are
  // its hidden body's, and a match alone would tell them.
  if (tag && !viewer && !isStaff(access, board))
    clauses.push("posts.members_only = 0");
  const from = tag
    ? "post_tags JOIN posts ON posts.id = post_tags.post_id"
    : "posts";
  if (tag) {
    clauses.unshift("post_tags.tag = ?");
    values.unshift(tag);
  }
  const where = clauses.join(" AND ");
  const { total } = await one<{ total: number }>(
    ctx,
    `SELECT count(*) AS total FROM ${from} WHERE ${where}`,
    values,
  );
  const { rows: found } = await ctx.sql<PostRow>(
    `SELECT posts.*, ${TAGS},
       (SELECT count(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
     FROM ${from} WHERE ${where}
     ORDER BY ${sortOf(board)} LIMIT ? OFFSET ?`,
    [...values, rows, (page - 1) * rows],
  );
  const counts: Record<string, number> = {};
  // 목록에서 내용 사용 off: titles only; 본문 보기 reads the post.
  const content = listsContent(board);
  const documents = found.map((row) => {
    if (!secretReadable(row, access, viewer, board)) return lockedPost(row);
    let document = shown(ctx, access, postOf(row), board);
    if (!document.data.locked) counts[document.id] = row.comment_count;
    if (!content && !document.data.locked && document.data.text)
      document = {
        ...document,
        data: { ...document.data, text: "", truncated: true },
      };
    return document;
  });
  return { board, documents, total, size: rows, counts };
}

/**
 * One post, whole, as the reader sees it: by its ID, or by its board's
 * number (?log=N, which lists the board as well). A post the reader may not
 * read is NOT_FOUND; a 멤버공개 one shows a visitor locked.
 */
export async function post(
  ctx: QueryCtx,
  args: { id?: string; board?: string; number?: number },
) {
  const { id, board: boardId, number } = args ?? {};
  const access = await accessOf(ctx);
  let row: PostRow | null = null;
  if (id !== undefined) row = await postRow(ctx, id);
  else if (typeof boardId === "string" && Number.isSafeInteger(number))
    row = await one<PostRow>(
      ctx,
      `${POST_SELECT} WHERE board = ? AND number = ?`,
      [boardId, number],
    );
  const board = row ? await boardOf(ctx, row.board) : null;
  if (
    !row ||
    !boardAllowed(board, access, "read") ||
    (id === undefined && !boardAllowed(board, access, "list")) ||
    !secretReadable(row, access, ctx.member?.id, board)
  )
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  return { document: shown(ctx, access, postOf(row), board) };
}

/** A search's results a page. */
const SEARCH_PAGE = 20;
/** Where a search's cursor turns from posts to comments. */
const COMMENT_PHASE = "comments:";

/**
 * Searches a board (the skins' 검색) over all its posts, 20 a page, newest
 * first: those the caller may read whose title or text holds `text`, or
 * whose author's nickname or character's name does (not a 익명 one's, but
 * for the staff). Then, as the original also searches comments (코멘트,
 * 오너(코): bbs/list.mmb.php:44-46), the other posts whose comments hold it
 * or were written by those so named, newest comment first. `after` is the
 * last page's nextCursor. Each shows 300 characters, as the original's
 * search (bbs/search.php).
 *
 * A term of 3 characters or more is found in the full-text tables
 * (posts_search, comments_search: trigram) as one phrase; a shorter one,
 * which trigram cannot find, by LIKE on the board's posts and on comments,
 * as before them. Either finds the term anywhere, case aside.
 */
export async function search(
  ctx: QueryCtx,
  args: { board?: string; text?: string; after?: string | null },
) {
  const { board: id, text: wanted, after = null } = args ?? {};
  if (after !== null && typeof after !== "string") invalid(ctx);
  if (typeof wanted !== "string" || !wanted.trim() || wanted.length > 40)
    ctx.fail("INVALID_REQUEST", "검색어를 1~40자로 입력해 주세요.", {
      reason: "invalid_input",
    });
  const { access, board } = await readableBoard(ctx, id);
  const term = wanted.trim();
  const full = [...term].length >= FULL_TEXT_MIN;
  const like = containing(term);
  const viewer = ctx.member?.id ?? null;
  // An author's name finds only what shows it: not 익명 posts or comments.
  const named = (table: string) => ({
    text: `(${isStaff(access, board) ? "1" : `${table}.anonymous = 0`} AND (
      ${table}.owner IN (SELECT member FROM profiles WHERE nick LIKE ? ESCAPE '\\' LIMIT 100)
      OR ${table}.character_id IN (SELECT id FROM characters WHERE name LIKE ? ESCAPE '\\' LIMIT 100)))`,
    values: [like, like],
  });
  // Its text: the full-text table's rows holding the phrase, or LIKE.
  const holding = (table: "posts" | "comments", columns: string[]) =>
    full
      ? {
          text: `${table}.id IN (SELECT rowid FROM ${table}_search WHERE ${table}_search MATCH ?)`,
          values: [phrase(term)],
        }
      : {
          text: `(${columns.map((column) => `${table}.${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`,
          values: columns.map(() => like),
        };
  const own = named("posts");
  const said = holding("posts", ["title", "body"]);
  const matches = {
    text: `(${said.text} OR ${own.text})`,
    values: [...said.values, ...own.values],
  };
  const secret = secretClause(access, viewer, "posts", board);
  // 멤버공개: a visitor's search does not look inside them.
  const visible = {
    text: `posts.board = ? AND ${secret.text}${viewer ? "" : " AND posts.members_only = 0"}`,
    values: [board.id, ...secret.values],
  };
  const inComments = after?.startsWith(COMMENT_PHASE) ?? false;
  const offset = Number(
    inComments ? after.slice(COMMENT_PHASE.length) : (after ?? 0),
  );
  if (!Number.isSafeInteger(offset) || offset < 0) invalid(ctx);
  const found: PostRow[] = [];
  let nextCursor: string | null = null;
  if (!inComments) {
    const { rows } = await ctx.sql<PostRow>(
      `${POST_SELECT} WHERE ${visible.text} AND ${matches.text}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...visible.values, ...matches.values, SEARCH_PAGE + 1, offset],
    );
    found.push(...rows.slice(0, SEARCH_PAGE));
    if (rows.length > SEARCH_PAGE) nextCursor = String(offset + SEARCH_PAGE);
  }
  // Once the posts are done, those found by their comments, filling the page.
  if (!nextCursor) {
    const from = inComments ? offset : 0;
    const room = SEARCH_PAGE - found.length;
    const writer = named("comments");
    const commented = holding("comments", ["body"]);
    const { rows } = await ctx.sql<PostRow>(
      `SELECT posts.*, ${TAGS}, max(comments.id) AS found
       FROM comments JOIN posts ON posts.id = comments.post_id
       WHERE ${visible.text} AND NOT ${matches.text}
         AND (${commented.text} OR ${writer.text})
       GROUP BY posts.id ORDER BY found DESC LIMIT ? OFFSET ?`,
      [
        ...visible.values,
        ...matches.values,
        ...commented.values,
        ...writer.values,
        room + 1,
        from,
      ],
    );
    found.push(...rows.slice(0, room));
    if (rows.length > room) nextCursor = `${COMMENT_PHASE}${from + room}`;
  }
  return {
    documents: found.map((row) =>
      shown(ctx, access, excerpt(postOf(row)), board),
    ),
    nextCursor,
  };
}

/**
 * Opens a guest's secret question with the password it was asked with
 * (skin/board/qna/password.php).
 */
export async function open(
  ctx: QueryCtx,
  args: { id?: string; password?: string },
) {
  const { id, password } = args ?? {};
  const row = await postRow(ctx, id);
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  await readableBoard(ctx, row.board);
  if (
    typeof password !== "string" ||
    !password ||
    password.length > 64 ||
    !row.guest_hash ||
    !(await ctx.passwords.verify(password, row.guest_hash, `post:${row.id}`))
  )
    ctx.fail("ACCESS_DENIED", "비밀번호를 확인해 주세요. (4~64자)", {
      reason: "guest_password",
    });
  return { document: postOf(row) };
}

/** The boards `access` may read, by ID. */
const readableBoards = async (ctx: QueryCtx, access: Access) =>
  new Map(
    (await boardsOf(ctx))
      .filter((board) => boardAllowed(board, access, "read"))
      .map((board): [string, Board] => [board.id, board]),
  );

/** The member's 관심 posts they may still read, in the order marked, 20 a page. */
export async function favorites(
  ctx: QueryCtx,
  args: { page?: number; size?: number },
) {
  const { page = 1, size = 20 } = args ?? {};
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > Math.ceil(200 / size)
  )
    invalid(ctx);
  if (!ctx.member) return { documents: [], total: 0 };
  const access = await accessOf(ctx);
  const { total } = await one<{ total: number }>(
    ctx,
    "SELECT count(*) AS total FROM favorites WHERE member = ?",
    [ctx.member.id],
  );
  const { rows } = await ctx.sql<PostRow>(
    `SELECT posts.*, ${TAGS} FROM favorites JOIN posts ON posts.id = favorites.post
     WHERE favorites.member = ? ORDER BY favorites.id DESC LIMIT ? OFFSET ?`,
    [ctx.member.id, size, (page - 1) * size],
  );
  const boards = await readableBoards(ctx, access);
  const documents = [];
  for (const row of rows)
    if (
      await postReadable(ctx, row, access, ctx.member.id, boards.get(row.board))
    )
      documents.push(
        shown(ctx, access, excerpt(postOf(row)), boards.get(row.board)),
      );
  return { documents, total };
}

/**
 * 로그내역 (mypage): the member's own posts, newest first, 30 of them, on
 * the boards they may still read. Readers cannot ask by author otherwise,
 * which would find others' 익명 posts.
 */
export async function mine(ctx: QueryCtx) {
  if (!ctx.member)
    ctx.fail("AUTH_REQUIRED", "로그인해 주세요.", { reason: "sign_in" });
  const access = await accessOf(ctx);
  const boards = [...(await readableBoards(ctx, access)).keys()];
  if (!boards.length) return { documents: [] };
  const { rows } = await ctx.sql<PostRow>(
    `${POST_SELECT} WHERE owner = ?
     AND board IN (SELECT value FROM json_each(?))
     ORDER BY id DESC LIMIT 30`,
    [ctx.member.id, JSON.stringify(boards)],
  );
  return { documents: rows.map((row) => excerpt(postOf(row))) };
}

/**
 * The newest post on a board the reader may see, by a member (a guest's
 * is not announced), for the board page's 새 글 notice: pages subscribe to
 * it, as they listened for new posts before. Null when there is none or
 * the reader may not list the board.
 */
export async function latest(ctx: QueryCtx, args: { board?: string }) {
  const access = await accessOf(ctx);
  const board = await boardOf(ctx, args?.board);
  if (
    !boardAllowed(board, access, "list") ||
    !boardAllowed(board, access, "read")
  )
    return { id: null };
  const secret = secretClause(access, ctx.member?.id, "posts", board);
  const row = await one<{ id: number }>(
    ctx,
    `SELECT id FROM posts WHERE board = ? AND owner IS NOT NULL AND ${secret.text}
     ORDER BY id DESC LIMIT 1`,
    [board.id, ...secret.values],
  );
  return { id: row ? String(row.id) : null };
}
