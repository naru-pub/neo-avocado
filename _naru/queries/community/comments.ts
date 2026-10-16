// A post's comments as readers see them, oldest first.
import {
  accessOf,
  boardOf,
  commentOf,
  postReadable,
  postRow,
  presentPost,
  readerOf,
} from "../../modules/boards.js";
import type { CommentRow } from "../../modules/boards.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** Comments a page reads at a time. */
const COMMENT_PAGE = 50;

/**
 * A post's comments, oldest first, 50 at a time after the last one read
 * (`after`, a comment's ID): none of a post the reader may not read whole
 * (a secret post not theirs, a 멤버공개 one for a visitor). 익명 comments
 * name no one but to their writer and the staff.
 */
export async function list(
  ctx: QueryCtx,
  args: { post?: string; after?: string | null },
) {
  const { post: id, after = null } = args ?? {};
  const cursor = after === null ? 0 : Number(after);
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const access = await accessOf(ctx);
  const post = await postRow(ctx, id);
  if (
    !post ||
    !(await postReadable(
      ctx,
      post,
      access,
      ctx.member?.id,
      await boardOf(ctx, post.board),
    ))
  )
    return { documents: [], nextCursor: null };
  const { rows } = await ctx.sql<CommentRow>`SELECT * FROM comments
    WHERE post_id = ${post.id} AND id > ${cursor} ORDER BY id LIMIT ${COMMENT_PAGE + 1}`;
  const documents = rows
    .slice(0, COMMENT_PAGE)
    .map((row) => presentPost(commentOf(row), readerOf(ctx, access)));
  return {
    documents,
    nextCursor: rows.length > COMMENT_PAGE ? documents.at(-1).id : null,
  };
}
