// 알림 (ajax/board_call.php): the member's calls ([[nick]]) and comment
// notices, and whether any is new.
import { invalid, signedIn } from "../../modules/access.js";
import type { Board, PostRow } from "../../modules/boards.js";
import {
  accessOf,
  boardOf,
  postReadable,
  rowKey,
} from "../../modules/boards.js";
import { profileOf } from "../../modules/members.js";
import type { QueryCtx } from "../../modules/naru-types.js";
import { callsUnread } from "../../modules/roleplay.js";

interface CallRow {
  id: number;
  recipient: string;
  sender: string | null;
  nick: string;
  speaker: string | null;
  kind: string;
  board: string;
  post_id: number;
  comment_id: number | null;
  preview: string;
  at: number;
}

/**
 * The member's calls and comment notices, newest first, `size` (at most
 * 20) after `after` (the last one's ID), as ajax/board_call.php's alarm
 * table. A post the member can no longer read (deleted, made secret, or
 * above their level) is left out.
 */
export async function callHistory(
  ctx: QueryCtx,
  args: { after?: string | null; size?: number },
) {
  const { after = null, size = 20 } = args ?? {};
  const member = signedIn(ctx);
  const cursor = after === null ? null : rowKey(after);
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && cursor === null)
  )
    invalid(ctx);
  const seen = (await profileOf(ctx, member))?.data.callsSeenAt ?? 0;
  const { rows } = await ctx.sql<CallRow>(
    `SELECT * FROM calls WHERE recipient = ?${cursor === null ? "" : " AND id < ?"}
     ORDER BY id DESC LIMIT ?`,
    [member, ...(cursor === null ? [] : [cursor]), size + 1],
  );
  const page = rows.slice(0, size);
  const ids = [...new Set(page.map((row) => row.post_id))];
  const posts = new Map(
    (ids.length
      ? (
          await ctx.sql<PostRow>(
            `SELECT * FROM posts WHERE id IN (${ids.map(() => "?").join(", ")})`,
            ids,
          )
        ).rows
      : []
    ).map((row): [number, PostRow] => [row.id, row]),
  );
  const access = await accessOf(ctx);
  const boards = new Map<string, Board | null>();
  const documents = [];
  for (const row of page) {
    const post = posts.get(row.post_id) ?? null;
    if (post && !boards.has(post.board))
      boards.set(post.board, await boardOf(ctx, post.board));
    if (
      !(await postReadable(ctx, post, access, member, boards.get(post?.board)))
    )
      continue;
    documents.push({
      id: String(row.id),
      data: {
        kind: row.kind,
        from: row.sender,
        nick: row.nick,
        speaker: row.speaker,
        board: row.board,
        logId: String(row.post_id),
        commentId: row.comment_id === null ? null : String(row.comment_id),
        preview: row.preview,
        at: row.at,
        unread: row.at > seen,
      },
    });
  }
  return {
    documents,
    nextCursor: rows.length > size ? String(page.at(-1).id) : null,
    unread: await callsUnread(ctx),
  };
}
