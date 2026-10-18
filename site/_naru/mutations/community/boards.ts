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
import type { PostRow } from "../../modules/boards.js";
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
 * 복사 (bbs/move.php?sw=copy): a copy of a post on another board (or its
 * own), at that board's next number, with its tags, comments and 조회수,
 * the copy's line added, paying and taking back nothing. A copied 답변글
 * stands alone. For the same staff as a move.
 */
export async function copyPost(
  ctx: MutationCtx,
  args: { id?: string; board?: string },
) {
  const { id, board } = args ?? {};
  const access = await accessOf(ctx);
  const row = await postRow(ctx, id);
  if (!isStaff(access, row ? await boardOf(ctx, row.board) : null))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  const target = await destination(ctx, access, row, board);
  const body = await withMoveLog(ctx, row, "복사");
  const kept = POST_COPY_COLUMNS.filter(
    (column) =>
      !["number", "category", "body", "reply_path", "notice"].includes(column),
  );
  const copy = (
    await ctx.sql<PostRow>(
      `INSERT INTO posts (board, number, category, body, ${kept.join(", ")}, reward)
       SELECT ?, ?, ?, ?, ${kept.join(", ")}, 0 FROM posts WHERE id = ? RETURNING *`,
      [target.board.id, target.number, target.category, body, row.id],
    )
  ).rows[0];
  await ctx.sql`INSERT INTO post_tags (post_id, tag)
    SELECT ${copy.id}, tag FROM post_tags WHERE post_id = ${row.id}`;
  await ctx.sql`INSERT INTO post_hits (post_id, hits)
    SELECT ${copy.id}, hits FROM post_hits WHERE post_id = ${row.id}`;
  await savePostSearch(ctx, copy, true);
  await ctx.sql(
    `INSERT INTO comments (post_id, ${COMMENT_COPY_COLUMNS.join(", ")}, reward)
     SELECT ?, ${COMMENT_COPY_COLUMNS.join(", ")}, 0 FROM comments
     WHERE post_id = ? ORDER BY id`,
    [copy.id, row.id],
  );
  await ctx.sql`INSERT INTO comments_search (rowid, body)
    SELECT id, body FROM comments WHERE post_id = ${copy.id}`;
  return {
    document: postOf(
      (await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [copy.id]))
        .rows[0],
    ),
  };
}

/**
 * Pins a post as a notice or moves it to another board, where it takes the
 * next number. Moderators may move only to boards they could post on, and a
 * board's 게시판·그룹 관리자 only to boards they administer too (bbs/move.php
 * lists those); the owner (admin.call) may do either.
 */
export async function moderatePost(
  ctx: MutationCtx,
  args: { id?: string; notice?: boolean; board?: string },
) {
  const { id, notice, board } = args ?? {};
  const access = await accessOf(ctx);
  const row = await postRow(ctx, id);
  if (!isStaff(access, row ? await boardOf(ctx, row.board) : null))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  let pinned = row.notice !== 0;
  if (notice !== undefined) {
    if (typeof notice !== "boolean") invalid(ctx);
    pinned = notice;
  }
  let target = row.board;
  let number = row.number;
  let category = row.category;
  let body = row.body;
  if (board !== undefined && board !== row.board) {
    ({ number, category } = await destination(ctx, access, row, board));
    target = board;
    body = await withMoveLog(ctx, row, "이동");
  }
  // A post moved to another board stands alone there: not a 답변글 of a
  // thread it left.
  const alone = target !== row.board;
  await ctx.sql`UPDATE posts SET notice = ${pinned}, board = ${target}, number = ${number},
    category = ${category}, body = ${body},
    thread = CASE WHEN ${alone} THEN NULL ELSE thread END,
    reply_path = CASE WHEN ${alone} THEN '' ELSE reply_path END,
    version = version + 1 WHERE id = ${row.id}`;
  if (body !== row.body) await savePostSearch(ctx, { ...row, body }, false);
  return {
    document: postOf(
      (await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [row.id])).rows[0],
    ),
  };
}
