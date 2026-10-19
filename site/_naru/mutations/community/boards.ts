// The staff's tools on a board: notices, moves and copies (GnuBoard's
// bo_notice and bbs/move.php), for moderators and the board's own 게시판·그룹
// 관리자.
import { one, invalid } from "../../modules/access.js";
import type { Access } from "../../modules/access.js";
import {
  COMMENT_COPY_COLUMNS,
  POST_COPY_COLUMNS,
  POST_SELECT,
  accessOf,
  boardAllowed,
  boardOf,
  isStaff,
  postOf,
  postRow,
  savePostSearch,
} from "../../modules/boards.js";
import { profileOf } from "../../modules/members.js";
import type { Board, PostRow } from "../../modules/boards.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * Where a moderator may move or copy `row` (bbs/move.php's list): a board
 * they could post on and moderate, or any for the owner; there it takes the
 * next number, and keeps its 분류 if the board has it.
 */
async function destination(
  ctx: MutationCtx,
  access: Access,
  row: PostRow,
  board: unknown,
) {
  const moved = typeof board === "string" ? await boardOf(ctx, board) : null;
  if (
    !moved ||
    (!ctx.owner &&
      (!boardAllowed(moved, access, "write") || !isStaff(access, moved)))
  )
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
      reason: "access_denied",
    });
  if (moved.data.kind === "image" && !row.image) invalid(ctx);
  const category =
    row.category && (moved.data.categories ?? []).includes(row.category)
      ? row.category
      : "";
  const { next } = await one<{ next: number }>(
    ctx,
    "SELECT coalesce(max(number), 0) + 1 AS next FROM posts WHERE board = ?",
    [moved.id],
  );
  return { board: moved, number: next, category };
}

/**
 * The post's text with move_update.php:47-56's line (cf_use_copy_log, on as
 * installed): "[이 게시물은 <nick>님에 의해 <time> <board>에서 이동 됨]".
 */
async function withMoveLog(ctx: MutationCtx, row: PostRow, verb: string) {
  const nick = ctx.member
    ? ((await profileOf(ctx, ctx.member.id))?.data.nick ?? "운영자")
    : "운영자";
  const from = (await boardOf(ctx, row.board))?.data.name ?? row.board;
  const kst = new Date(ctx.now + 9 * 60 * 60 * 1000).toISOString();
  const line = `[이 게시물은 ${nick}님에 의해 ${kst.slice(0, 10)} ${kst.slice(11, 19)} ${from}에서 ${verb} 됨]`;
  if (row.format === "html")
    return `${row.body}\n<div class="content_${verb === "복사" ? "copy" : "move"}">${line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</div>`;
  return `${row.body}\n\n${line}`;
}

/**
 * A post and its 답변글 (bbs/move_update.php works on every row of a
 * wr_num): the thread's first post, then its replies in their order.
 */
async function threadOf(ctx: MutationCtx, row: PostRow) {
  const root = row.thread ?? row.id;
  return (
    await ctx.sql<PostRow>(
      `${POST_SELECT} WHERE id = ? OR thread = ? ORDER BY thread IS NOT NULL, reply_path, id`,
      [root, root],
    )
  ).rows;
}

/** The next number on a board. */
async function nextNumber(ctx: MutationCtx, board: string) {
  return (
    await one<{ next: number }>(
      ctx,
      "SELECT coalesce(max(number), 0) + 1 AS next FROM posts WHERE board = ?",
      [board],
    )
  ).next;
}

/** A row's 분류 where the board has it, else none. */
const categoryOn = (board: Board, row: PostRow) =>
  row.category && (board.data.categories ?? []).includes(row.category)
    ? row.category
    : "";

/**
 * Copies a thread to a board, each post at its next number with its tags,
 * 조회수 and comments, the copy's line added, paying and taking back
 * nothing; the replies stay replies of the copied post. Returns the copy of
 * `first`.
 */
async function copyThread(
  ctx: MutationCtx,
  posts: PostRow[],
  board: Board,
  first: PostRow,
) {
  const kept = POST_COPY_COLUMNS.filter(
    (column) =>
      !["number", "category", "body", "reply_path", "notice"].includes(column),
  );
  let root: number | null = null;
  let copied: PostRow | null = null;
  for (const row of posts) {
    const body = await withMoveLog(ctx, row, "복사");
    const copy = (
      await ctx.sql<PostRow>(
        `INSERT INTO posts (board, number, category, body, ${kept.join(", ")}, reward, thread, reply_path)
         SELECT ?, ?, ?, ?, ${kept.join(", ")}, 0, ?, reply_path FROM posts WHERE id = ? RETURNING *`,
        [
          board.id,
          await nextNumber(ctx, board.id),
          categoryOn(board, row),
          body,
          row.thread === null ? null : root,
          row.id,
        ],
      )
    ).rows[0];
    if (row.thread === null) root = copy.id;
    if (row.id === first.id) copied = copy;
    await ctx.sql`INSERT INTO post_tags (post_id, tag)
      SELECT ${copy.id}, tag FROM post_tags WHERE post_id = ${row.id}`;
    await ctx.sql`INSERT INTO post_hits (post_id, hits)
      SELECT ${copy.id}, hits FROM post_hits WHERE post_id = ${row.id}`;
    await savePostSearch(ctx, copy, true);
    // The comments, their 댓글 답변 kept under the copies they answer.
    const comments = (
      await ctx.sql<{ id: number; thread: number | null }>(
        "SELECT id, thread FROM comments WHERE post_id = ? ORDER BY id",
        [row.id],
      )
    ).rows;
    const copies = new Map<number, number>();
    for (const comment of comments) {
      const made = (
        await ctx.sql<{ id: number }>(
          `INSERT INTO comments (post_id, ${COMMENT_COPY_COLUMNS.join(", ")}, reward, thread, reply_path)
           SELECT ?, ${COMMENT_COPY_COLUMNS.join(", ")}, 0, ?, reply_path FROM comments
           WHERE id = ? RETURNING id`,
          [
            copy.id,
            comment.thread === null
              ? null
              : (copies.get(comment.thread) ?? null),
            comment.id,
          ],
        )
      ).rows[0];
      copies.set(comment.id, made.id);
    }
    await ctx.sql`INSERT INTO comments_search (rowid, body)
      SELECT id, body FROM comments WHERE post_id = ${copy.id}`;
  }
  return copied as PostRow;
}

/** Moves a thread to a board, each post at its next number there. */
async function moveThread(ctx: MutationCtx, posts: PostRow[], board: Board) {
  for (const row of posts) {
    const body = await withMoveLog(ctx, row, "이동");
    await ctx.sql`UPDATE posts SET board = ${board.id},
      number = ${await nextNumber(ctx, board.id)},
      category = ${categoryOn(board, row)}, body = ${body},
      version = version + 1 WHERE id = ${row.id}`;
    await savePostSearch(ctx, { ...row, body }, false);
  }
}

/**
 * The posts a moderator asks to move or copy (`id`, or `ids` checked on a
 * list, bbs/move.php's chk_wr_id[]) and the boards to (`boards`, its
 * chk_bo_table[], or one `board`): each post with its 답변글, on boards the
 * moderator may move to (destination).
 */
async function transferArgs(
  ctx: MutationCtx,
  args: { id?: string; ids?: string[]; board?: string; boards?: string[] },
) {
  const { id, ids, board, boards } = args ?? {};
  const asked = ids ?? (id === undefined ? [] : [id]);
  const targets = boards ?? (board === undefined ? [] : [board]);
  if (
    !Array.isArray(asked) ||
    !Array.isArray(targets) ||
    !asked.length ||
    asked.length > TRANSFER_LIMIT ||
    !targets.length ||
    targets.length > TRANSFER_LIMIT ||
    new Set(targets).size !== targets.length
  )
    invalid(ctx);
  const access = await accessOf(ctx);
  const threads = new Map<number, { first: PostRow; posts: PostRow[] }>();
  for (const asking of asked) {
    const row = await postRow(ctx, asking);
    if (!isStaff(access, row ? await boardOf(ctx, row.board) : null))
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (!row)
      ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
        reason: "document_not_found",
      });
    const root = row.thread ?? row.id;
    if (!threads.has(root))
      threads.set(root, { first: row, posts: await threadOf(ctx, row) });
  }
  const destinations: Board[] = [];
  for (const target of targets)
    for (const { posts } of threads.values())
      for (const row of posts)
        destinations.push((await destination(ctx, access, row, target)).board);
  const unique = [
    ...new Map(destinations.map((row) => [row.id, row])).values(),
  ];
  return { threads: [...threads.values()], boards: unique };
}

/** How many posts or boards one move or copy takes (a list's page). */
const TRANSFER_LIMIT = 50;

/**
 * 복사 (bbs/move.php?sw=copy): copies of the posts asked, each with its
 * 답변글 and comments, on each board asked (its own too). For the same
 * staff as a move.
 */
export async function copyPost(
  ctx: MutationCtx,
  args: { id?: string; ids?: string[]; board?: string; boards?: string[] },
) {
  const { threads, boards } = await transferArgs(ctx, args);
  let document = null;
  for (const board of boards)
    for (const { first, posts } of threads) {
      const copy = await copyThread(ctx, posts, board, first);
      document ??= postOf(
        (await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [copy.id]))
          .rows[0],
      );
    }
  return { document };
}

/**
 * 이동 (bbs/move.php?sw=move): the posts asked, each with its 답변글, to
 * the first board asked, and copies to the others, as move_update.php
 * copies to every board checked and deletes the original. Moderators may
 * move only to boards they could post on, and a board's 게시판·그룹 관리자
 * only to boards they administer too (bbs/move.php lists those); the owner
 * (admin.call) may move anywhere.
 */
export async function movePosts(
  ctx: MutationCtx,
  args: { id?: string; ids?: string[]; board?: string; boards?: string[] },
) {
  const { threads, boards } = await transferArgs(ctx, args);
  const [first, ...others] = boards;
  for (const board of others)
    for (const thread of threads)
      await copyThread(ctx, thread.posts, board, thread.first);
  for (const { posts } of threads)
    if (posts[0].board !== first.id) await moveThread(ctx, posts, first);
  return {
    document: postOf(
      (
        await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [
          threads[0].first.id,
        ])
      ).rows[0],
    ),
  };
}

/**
 * Pins a post as a notice (공지), or unpins it; or moves it to another board
 * with its 답변글 (movePosts).
 */
export async function moderatePost(
  ctx: MutationCtx,
  args: { id?: string; notice?: boolean; board?: string },
) {
  const { id, notice, board } = args ?? {};
  if (board !== undefined) {
    const moved = await postRow(ctx, id);
    if (moved && board !== moved.board) await movePosts(ctx, { id, board });
  }
  const access = await accessOf(ctx);
  const row = await postRow(ctx, id);
  if (!isStaff(access, row ? await boardOf(ctx, row.board) : null))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  if (notice !== undefined) {
    if (typeof notice !== "boolean") invalid(ctx);
    await ctx.sql`UPDATE posts SET notice = ${notice}, version = version + 1
      WHERE id = ${row.id}`;
  }
  return {
    document: postOf(
      (await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [row.id])).rows[0],
    ),
  };
}
