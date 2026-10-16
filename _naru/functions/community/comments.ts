import {
  PREFIX,
  boardOf,
  boardAllowed,
  logReadable,
  deleteCommunityDocument,
  text,
} from "../../modules/shared.js";
import { notDeleted, startValue, startWrite } from "../../modules/community.js";
import {
  speakerOf,
  rollDice,
  resolveCalls,
  deliverCalls,
  explore,
  useInPost,
} from "../../modules/roleplay.js";
import type { Ctx, GuestCredentials } from "../../modules/naru-types.js";

// Comments under posts. Visitors comment where the board lets level 1, as
// guests with a name and password.
export const visitors = ["write", "remove"];

const COMMENTS = `${PREFIX}comments`;
/** A comment's length: a textarea, as the original's (mmb/write_comment.php). */
const COMMENT_LIMIT = 2000;

/**
 * Writes a new comment (no `id`, with `data.logId`) or edits one. A new
 * comment may roll dice, explore or use an item, as the board allows
 * (mmb/write_comment.php: 조합 is a post's); it tells the post's author and
 * anyone it calls.
 */
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
}

export async function write(
  ctx: Ctx,
  {
    id = null,
    data = {},
    revision = null,
    guest: credentials,
  }: {
    id?: string | null;
    data?: CommentInput;
    revision?: string | null;
    guest?: GuestCredentials;
  } = {},
) {
  const { access, previous, guest } = await startWrite(ctx, COMMENTS, {
    id,
    guest: credentials,
    revision,
    guests: true,
    moderated: true,
  });
  notDeleted(ctx, previous);
  if (!data || typeof data !== "object")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (guest) data = { ...data, character: undefined };
  let value = startValue(ctx, previous, guest);
  let speaker = previous?.data.speaker ?? null;
  let calls = null;
  let board = null;
  let parent = null;
  const logId = previous?.data.logId ?? data.logId;
  const log =
    typeof logId === "string" ? await ctx.get(`${PREFIX}logs`, logId) : null;
  if (!(await logReadable(ctx, log, access)))
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  board = await boardOf(ctx, log.data.board ?? "default");
  if (!boardAllowed(board, access, "comment"))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
      reason: "access_denied",
    });
  // On a Q&A board only the staff answer (skin/board/qna/list.skin.php:85-87
  // shows the reply link to $is_admin alone).
  if (board.data.kind === "qna" && !ctx.owner && access.role !== "moderator")
    ctx.fail(
      "ACCESS_DENIED",
      "질문 답변 게시판은 운영진만 답변할 수 있습니다.",
      {
        reason: "answers_staff_only",
      },
    );
  value = {
    ...value,
    logId,
    text: text(data.text ?? "", COMMENT_LIMIT),
    dice: previous?.data.dice ?? data.dice === true,
    // 익명 (wr_noname) where the board allows it, for members; kept on edit.
    anonymous:
      previous?.data.anonymous ??
      (!guest && board.data.anonymous === true && data.anonymous === true),
  };
  const acting =
    !previous && (data.action === "explore" || data.item !== undefined);
  if (acting && (guest || board.data.actions !== true))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
      reason: "access_denied",
    });
  if (
    (data.action !== undefined && data.action !== "explore") ||
    (data.item !== undefined && typeof data.item !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (!value.text && !value.dice && !acting)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  calls = guest
    ? { text: value.text, recipients: [] }
    : await resolveCalls(ctx, value.text, previous?.data.text ?? "");
  value.text = calls.text;
  if (!previous) {
    speaker = await speakerOf(ctx, data.character);
    if (speaker) {
      value.character = speaker.character;
      value.speaker = speaker;
    }
    if (value.dice) value.rolls = rollDice();
    const actions = [];
    if (data.action === "explore") actions.push(await explore(ctx, speaker));
    if (data.item !== undefined)
      actions.push(await useInPost(ctx, data.item, speaker));
    if (actions.length) value.actions = actions;
  }
  parent = log;
  const document = previous
    ? await ctx.set(COMMENTS, previous.id, value)
    : await ctx.add(COMMENTS, value, guest ? { secret: guest.secret } : {});
  await deliverCalls(ctx, {
    log: parent,
    comment: document,
    text: document.data.text,
    speaker,
    recipients: calls.recipients,
    notifyAuthor: !previous,
    guest: guest?.name ?? null,
    anonymous: value.anonymous,
  });
  return { document };
}

/** Deletes a comment. */
export async function remove(
  ctx: Ctx,
  { id, guest }: { id?: string; guest?: GuestCredentials } = {},
) {
  const { previous } = await startWrite(ctx, COMMENTS, {
    id,
    guest,
    guests: true,
    moderated: true,
  });
  return await deleteCommunityDocument(ctx, COMMENTS, "comments", previous);
}
