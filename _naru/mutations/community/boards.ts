// The staff's tools on a board: notices and moves (GnuBoard's bo_notice and
// bbs/move.php), for moderators and the board's own 게시판·그룹 관리자.
import { one } from "../../modules/access.js";
import {
  POST_SELECT,
  accessOf,
  boardAllowed,
  boardOf,
  isStaff,
  postOf,
  postRow,
} from "../../modules/boards.js";
import type { PostRow } from "../../modules/boards.js";
import type { MutationCtx } from "../../modules/naru-types.js";

const invalid = (ctx: MutationCtx) =>
  ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });

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
  if (board !== undefined && board !== row.board) {
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
    if (category && !(moved.data.categories ?? []).includes(category))
      category = "";
    target = board;
    number = (
      await one<{ next: number }>(
        ctx,
        "SELECT coalesce(max(number), 0) + 1 AS next FROM posts WHERE board = ?",
        [board],
      )
    ).next;
  }
  await ctx.sql`UPDATE posts SET notice = ${pinned}, board = ${target}, number = ${number},
    category = ${category}, version = version + 1 WHERE id = ${row.id}`;
  return {
    document: postOf(
      (await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [row.id])).rows[0],
    ),
  };
}
