import {
  PREFIX,
  boardOf,
  boardAllowed,
  deleteCommunityDocument,
  text,
  imageUrl,
  nextNumber,
  tagFields,
  TEXT_LIMIT,
  HTML_LIMIT,
  plainText,
} from "../../modules/shared.js";
import { notDeleted, startValue, startWrite } from "../../modules/community.js";
import {
  speakerOf,
  rollDice,
  resolveCalls,
  deliverCalls,
} from "../../modules/roleplay.js";

// Posts (logs) on the boards. Visitors post on boards open to level 1, as
// guests with a name and password.
export const visitors = ["write", "remove"];

const LOGS = `${PREFIX}logs`;

/**
 * Writes a new post (no `id`) or edits one (`id`, with the `revision` it was
 * read at). The board decides who may post, whether posts are secret, HTML
 * or pictures; a new post gets its number, its speaker and its dice.
 */
export async function write(
  ctx,
  { id = null, data = {}, revision = null, guest: credentials } = {},
) {
  const { access, previous, guest } = await startWrite(ctx, LOGS, {
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
  // Guests post as themselves, never as a character.
  if (guest) data = { ...data, character: undefined };
  const boardId = previous?.data.board ?? data.board ?? "default";
  const board = await boardOf(ctx, boardId);
  if (!boardAllowed(board, access, "write"))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  const value = startValue(ctx, previous, guest);
  // Posting as a character, dice and calls (skin/board/mmb). The speaker and
  // the dice are fixed when a post is made; edits keep them.
  let speaker = previous?.data.speaker ?? null;
  let calls = null;

  const secret =
    board.data.secret === "required" ||
    (Object.hasOwn(data, "secret")
      ? data.secret === true
      : Boolean(previous?.data.secret));
  if (secret && board.data.secret === "off" && !previous?.data.secret)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  // A guest could never read their secret post back, so they cannot write one.
  if (secret && guest)
    ctx.fail("ACCESS_DENIED", "손님은 비밀글을 쓸 수 없습니다.", {
      reason: "guest_secret",
    });
  value.board = boardId;
  value.secret = secret;
  value.title = text(data.title ?? previous?.data.title ?? "", 120);
  value.category = text(data.category ?? previous?.data.category ?? "", 40);
  if (value.category && !(board.data.categories ?? []).includes(value.category))
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  // Boards with HTML on (bo_use_dhtml_editor) take sanitized-on-display HTML.
  value.format =
    previous?.data.format ?? (board.data.html === true ? "html" : "text");
  value.text = text(
    data.text ?? "",
    value.format === "html" ? HTML_LIMIT : TEXT_LIMIT,
  );
  value.image =
    data.image === previous?.data.image
      ? data.image
      : data.image
        ? imageUrl(data.image)
        : null;
  if (board.data.kind === "image" && !value.image)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (!value.image && !value.text)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (!previous) {
    speaker = await speakerOf(ctx, data.character);
    if (speaker) {
      value.character = speaker.character;
      value.speaker = speaker;
    }
    if (data.dice === true) {
      value.dice = true;
      value.rolls = rollDice(ctx);
    }
  }
  calls = guest
    ? { text: value.text, recipients: [] }
    : await resolveCalls(ctx, value.text, previous?.data.text ?? "");
  value.text = calls.text;
  Object.assign(
    value,
    tagFields(value.format === "html" ? plainText(value.text) : value.text),
  );
  if (!previous) value.number = await nextNumber(ctx, boardId);
  // Uploads are managed (SDK 1.1.0): a document that names one keeps it.
  delete value.imageId;
  const document = previous
    ? await ctx.set(LOGS, previous.id, value)
    : await ctx.add(LOGS, value, guest ? { secret: guest.secret } : {});
  if (!previous) await announcePost(ctx, document);
  await deliverCalls(ctx, {
    log: document,
    comment: null,
    text: document.data.text,
    speaker,
    recipients: calls.recipients,
    notifyAuthor: false,
    guest: guest?.name ?? null,
  });
  return { document };
}

/**
 * Deletes a post with its comments, in bounded steps: call again until it
 * answers `done`.
 */
export async function remove(ctx, { id, guest } = {}) {
  const { previous } = await startWrite(ctx, LOGS, {
    id,
    guest,
    guests: true,
    moderated: true,
  });
  return await deleteCommunityDocument(ctx, LOGS, "logs", previous);
}

/** Topic on which new posts are announced to open pages (app/live.js listens). */
const POSTS_TOPIC = `${PREFIX}logs`;
const BASE_ACCESS = { level: 2, role: "member" };

/**
 * Broadcasts reach anyone listening, visitors included, so only a post a
 * base-level member could list and read is announced, by board and ID only.
 */
async function announcePost(ctx, { id, data: log }) {
  if (log.secret) return;
  const board = await boardOf(ctx, log.board);
  if (
    boardAllowed(board, BASE_ACCESS, "list") &&
    boardAllowed(board, BASE_ACCESS, "read")
  )
    ctx.broadcast(POSTS_TOPIC, { board: log.board, id });
}
