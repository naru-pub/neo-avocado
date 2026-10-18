// What is written across the boards: 최근게시물 (bbs/new.php), the newest
// posts and comments on every board the reader may read, and 전체검색
// (bbs/search.php), a search of them all. Visitors read what level 1 may
// while the site is open (사이트공개).
import {
  communitySettings,
  containing,
  kstDay,
  one,
} from "../../modules/access.js";
import type { Access } from "../../modules/access.js";
import {
  FULL_TEXT_MIN,
  POST_SELECT,
  accessOf,
  boardAllowed,
  boardsOf,
  boardsViewable,
  commentOf,
  excerpt,
  isStaff,
  phrase,
  postOf,
  presentPost,
  readerOf,
} from "../../modules/boards.js";
import type {
  Board,
  CommentRow,
  PostRow,
  Written,
} from "../../modules/boards.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

const invalid = (ctx: QueryCtx): never =>
  ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });

/**
 * The boards the reader may list and read (of a 그룹, when one is named),
 * by ID, and the SQL every list across them shares: which boards, and of
 * their posts only those the reader may see whole: secret ones only their
 * own and on boards they are staff of, 멤버공개 ones not to visitors.
 */
async function readable(ctx: QueryCtx, group: string) {
  await boardsViewable(ctx);
  const access = await accessOf(ctx);
  const boards = new Map(
    (await boardsOf(ctx))
      .filter(
        (board) =>
          boardAllowed(board, access, "list") &&
          boardAllowed(board, access, "read") &&
          (!group || board.data.group === group),
      )
      .map((board): [string, Board] => [board.id, board]),
  );
  const viewer = ctx.member?.id ?? null;
  const staffed = [...boards.values()]
    .filter((board) => isStaff(access, board))
    .map((board) => board.id);
  const ids = JSON.stringify([...boards.keys()]);
  const staffIds = JSON.stringify(staffed);
  // A visitor's own are none: a guest's secret question opens by password.
  const visible = {
    text: `posts.board IN (SELECT value FROM json_each(?))
      AND (posts.secret = 0${viewer ? " OR posts.owner = ?" : ""} OR posts.board IN (SELECT value FROM json_each(?)))
      ${viewer ? "" : "AND posts.members_only = 0"}`,
    values: [ids, ...(viewer ? [viewer] : []), staffIds] as SqlValue[],
  };
  return { access, boards, viewer, staffIds, visible };
}

/** A post or comment on `board` as the reader sees it (익명, 멤버공개). */
const shown = (
  ctx: QueryCtx,
  access: Access,
  row: Written,
  board: Board | undefined,
) => presentPost(row, readerOf(ctx, access, board));

/** 최근게시물's rows a page: cf_new_rows, 15 as installed. */
function newRows(settings: Record<string, any>) {
  const value = settings.newRows;
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, 50) : 15;
}

/**
 * 최근게시물 (bbs/new.php): the newest posts and comments on the boards the
 * reader may read, newest first, cf_new_rows a page, of one 그룹 (gr_id),
 * only posts or only comments (view w, c), or one member's by nickname
 * (mb_id; not where they wrote 익명, but for the staff and themselves).
 * Each entry has its post, its board and, for a comment, the comment; and
 * how many there are, for the page numbers.
 */
export async function recent(
  ctx: QueryCtx,
  args: { group?: string; view?: string; nick?: string; page?: number },
) {
  const { group = "", view = "", nick = "", page = 1 } = args ?? {};
  if (
    typeof group !== "string" ||
    group.length > 64 ||
    !["", "posts", "comments"].includes(view) ||
    typeof nick !== "string" ||
    nick.length > 20 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000
  )
    invalid(ctx);
  const settings = await communitySettings(ctx);
  const size = newRows(settings);
  // 최근게시물 기간 (cf_new_del): from the Korean day that many days ago.
  const days = Number.isSafeInteger(settings.newDays) ? settings.newDays : 0;
  const since =
    days > 0
      ? Date.parse(`${kstDay(ctx.now - days * 86_400_000)}T00:00:00+09:00`)
      : 0;
  const { access, boards, viewer, staffIds, visible } = await readable(
    ctx,
    group,
  );
  if (!boards.size) return { entries: [], total: 0, size };
  let author: string | null = null;
  if (nick.trim()) {
    const found = await one<{ member: string }>(
      ctx,
      "SELECT member FROM profiles WHERE nick = ? AND deleted_at IS NULL",
      [nick.trim()],
    );
    if (!found) return { entries: [], total: 0, size };
    author = found.member;
  }
  // One member's, but not their 익명 ones to others.
  const by = (table: string) =>
    author
      ? {
          text: `AND ${table}.owner = ? AND (${table}.anonymous = 0${author === viewer ? " OR 1" : ""} OR posts.board IN (SELECT value FROM json_each(?)))`,
          values: [author, staffIds] as SqlValue[],
        }
      : { text: "", values: [] as SqlValue[] };
  const postsBy = by("posts");
  const commentsBy = by("comments");
  const parts: { text: string; values: SqlValue[] }[] = [];
  if (view !== "comments")
    parts.push({
      text: `SELECT 'post' AS kind, posts.id AS id, posts.created_at AS at
        FROM posts WHERE ${visible.text} ${postsBy.text} AND posts.created_at >= ?`,
      values: [...visible.values, ...postsBy.values, since],
    });
  if (view !== "posts")
    parts.push({
      text: `SELECT 'comment' AS kind, comments.id AS id, comments.created_at AS at
        FROM comments JOIN posts ON posts.id = comments.post_id
        WHERE ${visible.text} ${commentsBy.text} AND comments.created_at >= ?`,
      values: [...visible.values, ...commentsBy.values, since],
    });
  const union = parts.map((part) => part.text).join(" UNION ALL ");
  const values = parts.flatMap((part) => part.values);
  const { total } = await one<{ total: number }>(
    ctx,
    `SELECT count(*) AS total FROM (${union})`,
    values,
  );
  const { rows: listed } = await ctx.sql<{
    kind: "post" | "comment";
    id: number;
  }>(`${union} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`, [
    ...values,
    size,
    (page - 1) * size,
  ]);
  const commentIds = listed
    .filter((row) => row.kind === "comment")
    .map((row) => row.id);
  const comments = new Map(
    commentIds.length
      ? (
          await ctx.sql<CommentRow>(
            "SELECT * FROM comments WHERE id IN (SELECT value FROM json_each(?))",
            [JSON.stringify(commentIds)],
          )
        ).rows.map((row): [number, CommentRow] => [row.id, row])
      : [],
  );
  const postIds = [
    ...new Set(
      listed.map((row) =>
        row.kind === "post" ? row.id : comments.get(row.id)?.post_id,
      ),
    ),
  ].filter((id) => id !== undefined);
  const posts = new Map(
    postIds.length
      ? (
          await ctx.sql<PostRow>(
            `${POST_SELECT} WHERE id IN (SELECT value FROM json_each(?))`,
            [JSON.stringify(postIds)],
          )
        ).rows.map((row): [number, PostRow] => [row.id, row])
      : [],
  );
  const entries = [];
  for (const row of listed) {
    const comment = row.kind === "comment" ? comments.get(row.id) : null;
    const post = posts.get(comment ? comment.post_id : row.id);
    if (!post || (row.kind === "comment" && !comment)) continue;
    const board = boards.get(post.board);
    entries.push({
      kind: row.kind,
      board: { id: board.id, name: board.data.name },
      group: board.data.group ?? null,
      post: shown(ctx, access, excerpt(postOf(post)), board),
      ...(comment
        ? {
            comment: shown(ctx, access, excerpt(commentOf(comment)), board),
          }
        : {}),
    });
  }
  return { entries, total, size };
}

/** 전체검색's results a page (srows, 10 as the original shows). */
const SEARCH_PAGE = 10;
/** Where a search's cursor turns from posts to comments. */
const COMMENT_PHASE = "comments:";
/** 검색조건 (sfl): 제목+내용, 제목, 내용, 회원 (닉네임), 이름. */
const FIELDS = ["content", "title", "body", "nick", "name"];

/**
 * 전체검색 (bbs/search.php): the posts on the boards the reader may read
 * (of one 그룹, or one board: onetable) whose 제목+내용, 제목 or 내용 hold
 * the words, or whose writer is the member of that 닉네임 or the 이름 (a
 * guest's name or a member's nickname; not 익명 posts, but for the staff),
 * all of up to two words (AND) or any (OR); then, as the original searches
 * comments too, the other posts whose comments do. 10 a page, newest
 * first; `after` is the last page's nextCursor. With the first page, how
 * many each board has (the original's board list with counts). Each post
 * shows 300 characters.
 */
export async function everything(
  ctx: QueryCtx,
  args: {
    text?: string;
    field?: string;
    operator?: string;
    group?: string;
    board?: string;
    after?: string | null;
  },
) {
  const {
    text: wanted,
    field = "content",
    operator = "and",
    group = "",
    board: only = "",
    after = null,
  } = args ?? {};
  const words =
    typeof wanted === "string"
      ? wanted.trim().split(/\s+/).filter(Boolean)
      : [];
  // 검색어는 두글자 이상, 공백은 한개만 (search.skin.php's fsearch_submit).
  if (
    typeof wanted !== "string" ||
    wanted.trim().length < 2 ||
    wanted.length > 20 ||
    words.length > 2
  )
    ctx.fail(
      "INVALID_REQUEST",
      "검색어는 두 글자 이상, 공백은 한 개까지 입력해 주세요.",
      { reason: "invalid_search" },
    );
  if (
    !FIELDS.includes(field) ||
    !["and", "or"].includes(operator) ||
    typeof group !== "string" ||
    typeof only !== "string" ||
    (after !== null && typeof after !== "string")
  )
    invalid(ctx);
  const { access, boards, viewer, staffIds, visible } = await readable(
    ctx,
    group,
  );
  const join = ` ${operator === "or" ? "OR" : "AND"} `;
  // The words in a table: its full-text rows (3 characters or more), LIKE
  // (shorter), or its writer's nickname or name.
  const matching = (table: "posts" | "comments") => {
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    for (const word of words) {
      if (field === "nick" || field === "name") {
        clauses.push(
          `(${field === "name" ? `${table}.guest_name = ? OR ` : ""}${table}.owner IN (SELECT member FROM profiles WHERE nick = ?))`,
        );
        values.push(...(field === "name" ? [word, word] : [word]));
        continue;
      }
      const full = [...word].length >= FULL_TEXT_MIN;
      if (table === "comments") {
        clauses.push(
          full
            ? "comments.id IN (SELECT rowid FROM comments_search WHERE comments_search MATCH ?)"
            : "comments.body LIKE ? ESCAPE '\\'",
        );
        values.push(full ? phrase(word) : containing(word));
        continue;
      }
      const columns =
        field === "title"
          ? ["title"]
          : field === "body"
            ? ["body"]
            : ["title", "body"];
      if (full) {
        clauses.push(
          "posts.id IN (SELECT rowid FROM posts_search WHERE posts_search MATCH ?)",
        );
        values.push(
          columns.length === 2
            ? phrase(word)
            : `${columns[0]} : ${phrase(word)}`,
        );
      } else {
        clauses.push(
          `(${columns.map((column) => `posts.${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`,
        );
        values.push(...columns.map(() => containing(word)));
      }
    }
    // A writer is found only where shown: not 익명, but for the staff.
    const named =
      field === "nick" || field === "name"
        ? ` AND (${table}.anonymous = 0 OR posts.board IN (SELECT value FROM json_each(?)))`
        : "";
    return {
      text: `(${clauses.join(join)})${named}`,
      values: [...values, ...(named ? [staffIds] : [])],
    };
  };
  if (!boards.size || (only && !boards.has(only)))
    return { documents: [], nextCursor: null, counts: [] };
  const scope = only
    ? {
        text: `${visible.text} AND posts.board = ?`,
        values: [...visible.values, only],
      }
    : visible;
  const inPosts = matching("posts");
  // Comments are searched for what they say and who wrote them, not by 제목.
  const inComments = field === "title" ? null : matching("comments");
  // The boards with how many each has, on the first page (search.php's list).
  let counts: { id: string; name: string; count: number }[] = [];
  if (after === null) {
    const found = new Map<string, number>();
    const { rows: posted } = await ctx.sql<{ board: string; n: number }>(
      `SELECT posts.board, count(*) AS n FROM posts
       WHERE ${visible.text} AND ${inPosts.text} GROUP BY posts.board`,
      [...visible.values, ...inPosts.values],
    );
    for (const row of posted) found.set(row.board, row.n);
    if (inComments) {
      const { rows: commented } = await ctx.sql<{ board: string; n: number }>(
        `SELECT posts.board, count(*) AS n FROM comments JOIN posts ON posts.id = comments.post_id
         WHERE ${visible.text} AND ${inComments.text} GROUP BY posts.board`,
        [...visible.values, ...inComments.values],
      );
      for (const row of commented)
        found.set(row.board, (found.get(row.board) ?? 0) + row.n);
    }
    counts = [...boards.values()]
      .filter((board) => found.has(board.id))
      .map((board) => ({
        id: board.id,
        name: board.data.name,
        count: found.get(board.id),
      }));
  }
  const commentPhase = after?.startsWith(COMMENT_PHASE) ?? false;
  const offset = Number(
    commentPhase ? after.slice(COMMENT_PHASE.length) : (after ?? 0),
  );
  if (!Number.isSafeInteger(offset) || offset < 0) invalid(ctx);
  const found: PostRow[] = [];
  let nextCursor: string | null = null;
  if (!commentPhase) {
    const { rows } = await ctx.sql<PostRow>(
      `${POST_SELECT} WHERE ${scope.text} AND ${inPosts.text}
       ORDER BY posts.id DESC LIMIT ? OFFSET ?`,
      [...scope.values, ...inPosts.values, SEARCH_PAGE + 1, offset],
    );
    found.push(...rows.slice(0, SEARCH_PAGE));
    if (rows.length > SEARCH_PAGE) nextCursor = String(offset + SEARCH_PAGE);
  }
  if (!nextCursor && inComments) {
    const from = commentPhase ? offset : 0;
    const room = SEARCH_PAGE - found.length;
    const { rows } = await ctx.sql<PostRow>(
      `SELECT posts.*, (SELECT json_group_array(tag) FROM post_tags WHERE post_tags.post_id = posts.id) AS tags,
         max(comments.id) AS found
       FROM comments JOIN posts ON posts.id = comments.post_id
       WHERE ${scope.text} AND NOT ${inPosts.text} AND ${inComments.text}
       GROUP BY posts.id ORDER BY found DESC LIMIT ? OFFSET ?`,
      [
        ...scope.values,
        ...inPosts.values,
        ...inComments.values,
        room + 1,
        from,
      ],
    );
    found.push(...rows.slice(0, room));
    if (rows.length > room) nextCursor = `${COMMENT_PHASE}${from + room}`;
  }
  return {
    documents: found.map((row) => {
      const board = boards.get(row.board);
      const document = shown(ctx, access, excerpt(postOf(row)), board);
      return { ...document, boardName: board?.data.name ?? row.board };
    }),
    nextCursor,
    counts,
  };
}
