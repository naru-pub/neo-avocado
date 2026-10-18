// Comments under posts. Visitors comment where the board lets level 1, as
// guests with a name and password.
import { one, parsed, text } from "../../modules/access.js";
import {
  COMMENT_LIMIT,
  COMMENT_REPLY_DEPTH,
  REPLY_DIGITS,
  commentRow,
  boardOf,
  commentOf,
  isStaff,
  memoOf,
  payReward,
  postReadable,
  postRow,
  requireBoard,
  saveCommentSearch,
  takeBackReward,
} from "../../modules/boards.js";
import type { CommentRow } from "../../modules/boards.js";
import {
  checkBannedWords,
  checkDelay,
  checkLength,
} from "../../modules/board-options.js";
import { startWrite } from "../../modules/community.js";
import {
  deliverCalls,
  explore,
  resolveCalls,
  rollDice,
  speakerOf,
  useInPost,
} from "../../modules/roleplay.js";
import type {
  GuestCredentials,
  MutationCtx,
} from "../../modules/naru-types.js";

/** What a writer sends for a comment. */
export interface CommentInput {
  logId?: string;
  text?: string;
  dice?: boolean;
  anonymous?: boolean;
  character?: string | null;
  action?: "explore";
  /** An owned inventory row to use. */
  item?: string;
  /** 비밀글 (wr_secret): only the staff and the two writers read it. */
  secret?: boolean;
  /** 답변 (basic/view_comment.skin.php): the comment a new one answers. */
  replyTo?: string;
}

const invalid = (ctx: MutationCtx) =>
  ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });

/**
 * Writes a new comment (no `id`, with `data.logId`) or edits one. A new
 * comment may roll dice, explore or use an item, as the board allows
 * (mmb/write_comment.php: 조합 is a post's); it tells the post's author and
 * anyone it calls.
 */
export async function write(
  ctx: MutationCtx,
  args: {
    id?: string | null;
    data?: CommentInput;
    revision?: string | null;
    guest?: GuestCredentials;
  },
) {
  const {
    id = null,
    data: given = {},
    revision = null,
    guest: credentials,
  } = args ?? {};
  const { access, previous, guest } = await startWrite(ctx, "comment", {
    id,
    guest: credentials,
    revision,
  });
  if (!given || typeof given !== "object") invalid(ctx);
  const data: CommentInput = guest ? { ...given, character: undefined } : given;
  const post = await postRow(ctx, previous?.post_id ?? data.logId);
  const board = post ? await boardOf(ctx, post.board) : null;
  if (!(await postReadable(ctx, post, access, ctx.member?.id, board)))
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  requireBoard(ctx, board, access, "comment");
  // On a Q&A board only the staff answer (skin/board/qna/list.skin.php:85-87
  // shows the reply link to $is_admin alone).
  if (board.data.kind === "qna" && !isStaff(access, board))
    ctx.fail(
      "ACCESS_DENIED",
      "질문 답변 게시판은 운영진만 답변할 수 있습니다.",
      { reason: "answers_staff_only" },
    );
  let body = text(data.text ?? "", COMMENT_LIMIT);
  const dice = previous ? previous.dice !== 0 : data.dice === true;
  // 익명 (wr_noname) where the board allows it, for members; kept on edit.
  const anonymous = previous
    ? previous.anonymous !== 0
    : !guest &&
      Boolean(ctx.member) &&
      board.data.anonymous === true &&
      data.anonymous === true;
  const acting =
    !previous && (data.action === "explore" || data.item !== undefined);
  if (acting && (guest || !ctx.member || board.data.actions !== true))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (
    (data.action !== undefined && data.action !== "explore") ||
    (data.item !== undefined && typeof data.item !== "string")
  )
    invalid(ctx);
  if (!body && !dice && !acting) invalid(ctx);
  // 비밀글 (view_comment.skin.php's wr_secret), set or cleared on edit too.
  // A guest could not read theirs back.
  if (data.secret !== undefined && typeof data.secret !== "boolean")
    invalid(ctx);
  const secret =
    data.secret === undefined ? previous?.secret === 1 : data.secret;
  if (secret && guest)
    ctx.fail("ACCESS_DENIED", "손님은 비밀 댓글을 쓸 수 없습니다.", {
      reason: "guest_secret",
    });
  if (body)
    checkLength(
      ctx,
      body,
      { min: board.data.commentMin, max: board.data.commentMax },
      isStaff(access, board),
    );
  await checkBannedWords(ctx, body);
  if (!previous) await checkDelay(ctx, isStaff(access, board));
  const calls = guest
    ? { text: body, recipients: [], called: [] }
    : await resolveCalls(
        ctx,
        body,
        previous?.body ?? "",
        parsed(previous?.called, []),
      );
  body = calls.text;
  let row: CommentRow;
  let speaker = previous ? parsed<any>(previous.speaker, null) : null;
  if (previous)
    row = (
      await ctx.sql<CommentRow>`UPDATE comments SET body = ${body}, called = ${JSON.stringify(calls.called)},
        secret = ${secret}, updated_at = ${ctx.now}, version = version + 1 WHERE id = ${previous.id} RETURNING *`
    ).rows[0];
  else {
    // 댓글 답변 (write_comment_update.php w=c): on a plain board, to a
    // comment of the same post, five deep at most; the later below.
    let thread: number | null = null;
    let replyPath = "";
    if (data.replyTo !== undefined) {
      const parent = await commentRow(ctx, data.replyTo);
      if (!parent || parent.post_id !== post.id || board.data.kind !== "text")
        invalid(ctx);
      if (parent.reply_path.length / REPLY_DIGITS >= COMMENT_REPLY_DEPTH)
        ctx.fail("INVALID_REQUEST", "더 이상 답변하실 수 없습니다.", {
          reason: "reply_depth",
        });
      thread = parent.thread ?? parent.id;
      const { n } = await one<{ n: number }>(
        ctx,
        `SELECT count(*) AS n FROM comments WHERE thread = ?
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
      replyPath = parent.reply_path + String(n + 1).padStart(REPLY_DIGITS, "0");
    }
    speaker = await speakerOf(ctx, data.character);
    const actions = [];
    if (data.action === "explore") actions.push(await explore(ctx, speaker));
    if (data.item !== undefined)
      actions.push(
        await useInPost(ctx, data.item, speaker, { approved: false }),
      );
    // 댓글쓰기 포인트 (bo_comment_point), for members; a delete takes it back.
    const reward = guest
      ? 0
      : await payReward(
          ctx,
          board.data.commentReward,
          memoOf(board, post.number, "댓글쓰기"),
        );
    row = (
      await ctx.sql<CommentRow>`INSERT INTO comments (post_id, owner, body, dice, rolls, anonymous,
        character_id, speaker, actions, called, reward, admin, secret, thread, reply_path, guest_name, guest_hash, created_at, updated_at)
        VALUES (${post.id}, ${ctx.member?.id ?? null}, ${body}, ${dice}, ${dice ? JSON.stringify(rollDice()) : null},
        ${anonymous}, ${speaker ? Number(speaker.character) : null}, ${speaker ? JSON.stringify(speaker) : null},
        ${JSON.stringify(actions)}, ${JSON.stringify(calls.called)}, ${reward},
        ${ctx.owner === true && !anonymous}, ${secret}, ${thread}, ${replyPath}, ${guest?.name ?? null}, ${guest?.hash ?? null}, ${ctx.now}, ${ctx.now})
        RETURNING *`
    ).rows[0];
  }
  await saveCommentSearch(ctx, row, !previous);
  await deliverCalls(ctx, {
    post,
    comment: row.id,
    text: body,
    speaker,
    recipients: calls.recipients,
    notifyAuthor: !previous,
    guest: guest?.name ?? null,
    anonymous,
    secret,
  });
  return { document: commentOf(row) };
}

/** Deletes a comment, taking back what it was paid. */
export async function remove(
  ctx: MutationCtx,
  args: { id?: string; guest?: GuestCredentials },
) {
  const { id, guest } = args ?? {};
  const { access, previous } = await startWrite(ctx, "comment", {
    id: id ?? "",
    guest,
  });
  const post = await postRow(ctx, previous.post_id);
  const board = post ? await boardOf(ctx, post.board) : null;
  // 이 코멘트와 관련된 답변코멘트가 존재하므로 삭제 할 수 없습니다
  // (bbs/delete_comment.php:41), but for the staff.
  if (
    !isStaff(access, board) &&
    (await one(
      ctx,
      `SELECT 1 FROM comments WHERE thread = ? AND length(reply_path) > ?
       AND substr(reply_path, 1, ?) = ? LIMIT 1`,
      [
        previous.thread ?? previous.id,
        previous.reply_path.length,
        previous.reply_path.length,
        previous.reply_path,
      ],
    ))
  )
    ctx.fail(
      "CONFLICT",
      "이 코멘트와 관련된 답변코멘트가 존재하므로 삭제 할 수 없습니다.",
      { reason: "has_replies" },
    );
  // 댓글쓰기 포인트 goes back (bbs/delete_comment.php:63).
  if (previous.reward > 0) {
    await takeBackReward(
      ctx,
      previous,
      memoOf(board, post?.number, "댓글삭제"),
    );
  }
  await ctx.sql`DELETE FROM comments_search WHERE rowid = ${previous.id}`;
  await ctx.sql`DELETE FROM comments WHERE id = ${previous.id}`;
  return null;
}
