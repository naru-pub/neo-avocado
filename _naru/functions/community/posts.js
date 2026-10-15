import {
  PREFIX,
  PROFILES,
  CHARACTER_STATE,
  HISTORY,
  WALLETS,
  author,
  amount,
  characterState,
  communityAccess,
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
// guests with a name and password; they search, and on Q&A boards
// (skin/board/qna) list questions and open their own secret ones.
export const visitors = ["write", "remove", "search", "questions", "open"];
export const readOnly = ["search", "questions", "open"];

const LOGS = `${PREFIX}logs`;
const COMMENTS = `${PREFIX}comments`;

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
  // A processed settlement (skin/board/caculate) stays as it was settled.
  if (previous?.data.settlement?.state && access.role !== "moderator")
    ctx.fail("CONFLICT", "이미 처리된 정산글은 고칠 수 없습니다.", {
      reason: "settled",
    });
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
  // A guest could never read their secret post back, so they cannot write
  // one; on a Q&A board they open it again with their password.
  if (secret && guest && board.data.kind !== "qna")
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
  const { access, previous } = await startWrite(ctx, LOGS, {
    id,
    guest,
    guests: true,
    moderated: true,
  });
  if (previous.data.settlement?.state && access.role !== "moderator")
    ctx.fail("CONFLICT", "이미 처리된 정산글은 지울 수 없습니다.", {
      reason: "settled",
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

/** A post as a reader who may not read its body sees it: a locked entry. */
const locked = (row) => ({
  id: row.id,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  data: {
    owner: author(row),
    number: row.data.number ?? null,
    board: row.data.board,
    ...(row.data.guest ? { guest: row.data.guest } : {}),
    secret: true,
    locked: true,
  },
});
const readableBy = (ctx, access) => (row) =>
  !row.data.secret ||
  access.role === "moderator" ||
  Boolean(ctx.member && author(row) === ctx.member.id);

/** The board, if the caller may list and read it. */
async function readableBoard(ctx, id) {
  const access = await communityAccess(ctx);
  const board = typeof id === "string" ? await boardOf(ctx, id) : null;
  if (
    !boardAllowed(board, access, "list") ||
    !boardAllowed(board, access, "read")
  )
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  return { access, board };
}

/**
 * Searches a board (the skins' 검색) over all its posts, 500 at a time:
 * those the caller may read whose title, text, speaker, guest name or
 * author's nickname holds `text`, newest first. `after` continues where the
 * last call's scan stopped (`nextCursor`, null at the board's first post).
 */
export async function search(
  ctx,
  { board: id, text: wanted, after: from = null } = {},
) {
  if (from !== null && typeof from !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (typeof wanted !== "string" || !wanted.trim() || wanted.length > 40)
    ctx.fail("INVALID_REQUEST", "검색어를 1~40자로 입력해 주세요.", {
      reason: "invalid_input",
    });
  const { access } = await readableBoard(ctx, id);
  const needle = wanted.trim().toLowerCase();
  const visible = readableBy(ctx, access);
  const rows = [];
  let after = from;
  for (let page = 0; page < 5; page += 1) {
    const result = await ctx.list(LOGS, {
      filter: { board: id },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size: 100,
      after,
    });
    rows.push(
      ...result.documents.filter((row) => !row.data.deleted && visible(row)),
    );
    after = result.nextCursor;
    if (!after) break;
  }
  const owners = [...new Set(rows.map(author).filter(Boolean))].slice(0, 60);
  const nicks = new Map(
    (owners.length ? await ctx.getMany(PROFILES, owners) : [])
      .filter(Boolean)
      .map((row) => [row.id, row.data.nick]),
  );
  const found = rows.filter((row) =>
    [
      row.data.title,
      row.data.format === "html"
        ? plainText(row.data.text ?? "")
        : row.data.text,
      row.data.speaker?.name,
      row.data.guest?.name,
      nicks.get(author(row)),
    ].some(
      (value) =>
        typeof value === "string" && value.toLowerCase().includes(needle),
    ),
  );
  return { documents: found, nextCursor: after };
}

/**
 * A Q&A board's questions (skin/board/qna), ten to a page, newest first:
 * whole, except others' secret questions, which show locked until opened
 * with their password.
 */
export async function questions(ctx, { board: id, after = null } = {}) {
  const { access, board } = await readableBoard(ctx, id);
  if (board.data.kind !== "qna")
    ctx.fail("INVALID_REQUEST", "질문 게시판이 아닙니다.", {
      reason: "invalid_input",
    });
  if (after !== null && typeof after !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const query = { filter: { board: id }, where: { ne: ["deleted", true] } };
  const page = await ctx.list(LOGS, {
    ...query,
    sort: [
      ["notice", "desc"],
      [{ metadata: "createdAt" }, "desc"],
    ],
    size: 10,
    after,
  });
  const total = await ctx.count(LOGS, query);
  const visible = readableBy(ctx, access);
  return {
    documents: page.documents.map((row) => (visible(row) ? row : locked(row))),
    nextCursor: page.nextCursor,
    totalCount: total,
  };
}

/**
 * Opens a guest's secret question with the password it was asked with
 * (skin/board/qna/password.php).
 */
export async function open(ctx, { id, password } = {}) {
  const row = typeof id === "string" ? await ctx.get(LOGS, id) : null;
  if (!row || row.data.deleted)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  await readableBoard(ctx, row.data.board);
  if (
    typeof password !== "string" ||
    !row.data.guest ||
    !(await ctx.secretMatches(LOGS, row.id, password))
  )
    ctx.fail("ACCESS_DENIED", "비밀번호를 확인해 주세요. (4~64자)", {
      reason: "guest_password",
    });
  return { document: row };
}

/**
 * Settles a request on a settlement board (skin/board/caculate's admin
 * reply): its state (완료, 반려…), experience for the character it speaks
 * as and money for its author, and a reply saying so. Moderators and the
 * owner settle; after that the author can no longer change it.
 */
export async function settle(
  ctx,
  { id, state, exp = 0, money = 0, memo = "" } = {},
) {
  const access = await communityAccess(ctx);
  if (!ctx.owner && access.role !== "moderator")
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  const row = typeof id === "string" ? await ctx.get(LOGS, id) : null;
  if (!row || row.data.deleted)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  const board = await boardOf(ctx, row.data.board ?? "default");
  if (board?.data.kind !== "settlement")
    ctx.fail("INVALID_REQUEST", "정산 게시판이 아닙니다.", {
      reason: "invalid_input",
    });
  const settled = text(state, 10, true);
  amount(exp, "Experience");
  amount(money, "Money");
  const note = text(memo ?? "", 500);
  const owner = author(row);
  const character = row.data.character ?? null;
  if (exp > 0) {
    if (!character)
      ctx.fail(
        "INVALID_REQUEST",
        "캐릭터로 쓴 정산글에만 경험치를 줄 수 있습니다.",
        { reason: "no_character" },
      );
    const current = await characterState(ctx, character, owner);
    const total = (current.data.exp ?? 0) + exp;
    await ctx.set(CHARACTER_STATE, character, { ...current.data, exp: total });
    await ctx.add(HISTORY, {
      owner: current.data.owner ?? owner,
      kind: "exp",
      at: ctx.now,
      character,
      expDelta: exp,
      exp: total,
      memo: note || `정산: ${settled}`,
      actor: "settlement",
    });
  }
  if (money > 0) {
    if (!owner)
      ctx.fail("INVALID_REQUEST", "회원이 쓴 정산글에만 지급할 수 있습니다.", {
        reason: "invalid_input",
      });
    const wallet = await ctx.get(WALLETS, owner);
    const balance = (wallet?.data.balance ?? 0) + money;
    await ctx.set(WALLETS, owner, { ...wallet?.data, balance });
    await ctx.add(HISTORY, {
      owner,
      kind: "settle",
      at: ctx.now,
      delta: money,
      balance,
      memo: note || `정산: ${settled}`,
    });
  }
  const document = await ctx.set(LOGS, row.id, {
    ...row.data,
    settlement: { state: settled, at: ctx.now, exp, money },
  });
  await ctx.add(COMMENTS, {
    logId: row.id,
    owner: ctx.member?.id ?? null,
    text: [
      `[${settled}]`,
      exp ? `경험치 +${exp}` : "",
      money ? `+${money} 아보` : "",
      note,
    ]
      .filter(Boolean)
      .join(" "),
    dice: false,
    settlement: true,
  });
  return { document };
}
