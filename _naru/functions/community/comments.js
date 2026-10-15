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
  combineInPost,
} from "../../modules/roleplay.js";

// Comments under posts. Visitors comment where the board lets level 1, as
// guests with a name and password.
export const visitors = ["write", "remove"];

const COMMENTS = `${PREFIX}comments`;

/**
 * Writes a new comment (no `id`, with `data.logId`) or edits one. A new
 * comment may roll dice, explore, combine or use an item, as the board
 * allows; it tells the post's author and anyone it calls.
 */
export async function write(
  ctx,
  { id = null, data = {}, revision = null, guest: credentials } = {},
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
  value = {
    ...value,
    logId,
    text: text(data.text ?? "", 500),
    dice: previous?.data.dice ?? data.dice === true,
  };
  const acting =
    !previous &&
    (["explore", "combine"].includes(data.action) || data.item !== undefined);
  if (acting && (guest || board.data.actions !== true))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
      reason: "access_denied",
    });
  if (
    (data.action !== undefined &&
      !["explore", "combine"].includes(data.action)) ||
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
    if (data.action === "combine")
      actions.push(await combineInPost(ctx, data.materials, speaker));
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
  });
  return { document };
}

/** Deletes a comment. */
export async function remove(ctx, { id, guest } = {}) {
  const { previous } = await startWrite(ctx, COMMENTS, {
    id,
    guest,
    guests: true,
    moderated: true,
  });
  return await deleteCommunityDocument(ctx, COMMENTS, "comments", previous);
}
