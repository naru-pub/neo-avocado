// A post's comments as readers see them, oldest first.
import {
  accessOf,
  boardOf,
  commentOf,
  postReadable,
  postRow,
  presentComment,
  readerOf,
} from "../../modules/boards.js";
import type { CommentRow } from "../../modules/boards.js";
import type { QueryCtx } from "../../modules/naru-types.js";
import { invalid } from "../../modules/access.js";

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
  // The last comment read, as "<thread>:<path>" (a bare number: a thread's
  // first comment), in the order threads and their replies list.
  const [root, path = ""] = String(after ?? "0").split(":");
  const cursor = Number(root);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !/^(?:\d{3})*$/.test(path))
    invalid(ctx);
  const access = await accessOf(ctx);
  const post = await postRow(ctx, id);
  const board = post ? await boardOf(ctx, post.board) : null;
  if (!post || !(await postReadable(ctx, post, access, ctx.member?.id, board)))
    return { documents: [], nextCursor: null };
  // wr_comment, wr_comment_reply: each thread in turn, its replies in place.
  const { rows } = await ctx.sql<CommentRow>`SELECT * FROM comments
    WHERE post_id = ${post.id}
      AND (coalesce(thread, id) > ${cursor}
        OR (coalesce(thread, id) = ${cursor} AND reply_path > ${path}))
    ORDER BY coalesce(thread, id), reply_path LIMIT ${COMMENT_PAGE + 1}`;
  const documents = rows
    .slice(0, COMMENT_PAGE)
    .map((row) =>
      presentComment(
        commentOf(row),
        readerOf(ctx, access, board),
        post.owner ?? null,
      ),
    );
  return {
    documents,
    nextCursor:
      rows.length > COMMENT_PAGE
        ? `${rows[COMMENT_PAGE - 1].thread ?? rows[COMMENT_PAGE - 1].id}:${rows[COMMENT_PAGE - 1].reply_path}`
        : null,
  };
}
