import {
  PREFIX,
  PROFILES,
  CHARACTERS,
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
  names,
  presentPost,
  logReadable,
} from "../../modules/shared.js";
import { notDeleted, startValue, startWrite } from "../../modules/community.js";
import {
  speakerOf,
  rollDice,
  resolveCalls,
  deliverCalls,
  useInPost,
  combineInPost,
} from "../../modules/roleplay.js";

// Posts (logs) on the boards. Visitors post on boards open to level 1, as
// guests with a name and password; they search, and on Q&A boards
// (skin/board/qna) list questions and open their own secret ones.
export const visitors = ["write", "remove", "search", "questions", "open"];
export const readOnly = ["search", "questions", "open", "mine", "favorites"];

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
  // The mmb skin's options (write.skin.php:327-349): 멤버공개 and 19금 for
  // members, 리플창 아래로 and 로그접기 for anyone, and 익명 for members
  // where the board allows it (bo_use_noname).
  const option = (key) =>
    Object.hasOwn(data, key)
      ? data[key] === true
      : previous?.data[key] === true;
  value.membersOnly = !guest && option("membersOnly");
  value.adult = !guest && option("adult");
  value.wide = option("wide");
  value.fold = option("fold");
  value.anonymous =
    !guest && board.data.anonymous === true && option("anonymous");
  const acting =
    !previous && (data.action === "combine" || data.item !== undefined);
  if (
    (data.action !== undefined && data.action !== "combine") ||
    (data.item !== undefined && typeof data.item !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  // 조합 and item use are a post's (write.skin.php:230-300), on boards that
  // allow actions, for members.
  if (acting && (guest || board.data.actions !== true))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (!previous) {
    speaker = await speakerOf(ctx, data.character);
    if (speaker) {
      value.character = speaker.character;
      value.speaker = speaker;
    }
    if (data.dice === true) {
      value.dice = true;
      value.rolls = rollDice();
    }
    const actions = [];
    if (data.action === "combine")
      actions.push(await combineInPost(ctx, data.materials, speaker));
    if (data.item !== undefined)
      actions.push(await useInPost(ctx, data.item, speaker));
    if (actions.length) value.actions = actions;
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
  // Uploads are managed (SDK 1.1.0): Naru records which documents name them.
  delete value.imageId;
  const document = previous
    ? await ctx.set(LOGS, previous.id, value)
    : await ctx.add(LOGS, value, guest ? { secret: guest.secret } : {});
  // A guest's post is not announced: guests may post without signing in,
  // and a burst of them would reach every open page (up to 1,000 a site).
  // The original has no live updates; members' posts keep theirs.
  if (!previous && !guest) await announcePost(ctx, document);
  await deliverCalls(ctx, {
    log: document,
    comment: null,
    text: document.data.text,
    speaker,
    recipients: calls.recipients,
    notifyAuthor: false,
    guest: guest?.name ?? null,
    anonymous: value.anonymous,
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
  // A settled request stays (caculate/list.skin.php:109: 삭제 while wr_10 is empty).
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
  createdBy: row.data.anonymous ? null : row.createdBy,
  data: {
    owner: row.data.anonymous ? null : author(row),
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
 * Searches a board (the skins' 검색) over all its posts, 20 a page, newest
 * first: those the caller may read whose title or text holds `text`, or
 * whose author's nickname or character's name does. `after` is the last
 * page's nextCursor. Naru does the matching (`contains`), so a search reads
 * only what it finds.
 */
export async function search(
  ctx,
  { board: id, text: wanted, after = null } = {},
) {
  if (after !== null && typeof after !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (typeof wanted !== "string" || !wanted.trim() || wanted.length > 40)
    ctx.fail("INVALID_REQUEST", "검색어를 1~40자로 입력해 주세요.", {
      reason: "invalid_input",
    });
  const { access } = await readableBoard(ctx, id);
  const text = wanted.trim();
  // The members and characters named so, up to 100 each.
  const [members, characters] = await Promise.all([
    ctx.list(PROFILES, { where: { contains: ["nick", text] }, size: 100 }),
    ctx.list(CHARACTERS, { where: { contains: ["name", text] }, size: 100 }),
  ]);
  const ids = (page) => page.documents.map((row) => row.id);
  const found = [
    { contains: ["title", text] },
    { contains: ["text", text] },
    // An author's name finds only posts that show it: not 익명 ones.
    ...(members.documents.length || characters.documents.length
      ? [
          {
            all: [
              access.role === "moderator" ? true : { ne: ["anonymous", true] },
              {
                any: [
                  ...(members.documents.length
                    ? [
                        { in: ["owner", ids(members)] },
                        { in: [{ metadata: "createdBy" }, ids(members)] },
                      ]
                    : []),
                  ...(characters.documents.length
                    ? [{ in: ["character", ids(characters)] }]
                    : []),
                ],
              },
            ],
          },
        ]
      : []),
  ];
  const page = await ctx.list(LOGS, {
    filter: { board: id },
    where: {
      all: [
        { ne: ["deleted", true] },
        readable(ctx, access),
        // 멤버공개: a visitor's search does not look inside them.
        ctx.member ? true : { ne: ["membersOnly", true] },
        { any: found },
      ],
    },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: 20,
    after,
  });
  // 300 characters of each, as the original's search shows (bbs/search.php):
  // whole posts could pass a function's 64 KiB result.
  return {
    ...page,
    documents: page.documents.map((row) => shown(ctx, access, excerpt(row))),
  };
}

/** A post as this caller sees it: 멤버공개 and 익명 (presentPost). */
const shown = (ctx, access, row) => ({
  ...row,
  data: presentPost(row, {
    member: ctx.member?.id ?? null,
    staff: access.role === "moderator",
  }),
});

/** 관심로그 (mmb's 관심, mypage/log/log_favorite.php): at most 200. */
const FAVORITE_LIMIT = 200;

/** Marks a post 관심, or unmarks it; the newest first. */
export async function favorite(ctx, { id } = {}) {
  const access = await communityAccess(ctx);
  const row = typeof id === "string" ? await ctx.get(LOGS, id) : null;
  if (!(await logReadable(ctx, row, access)))
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  const profile = await ctx.get(PROFILES, ctx.member.id);
  if (!profile)
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  const current = Array.isArray(profile.data.favorites)
    ? profile.data.favorites.filter((entry) => typeof entry === "string")
    : [];
  const marked = !current.includes(id);
  const favorites = marked
    ? [id, ...current].slice(0, FAVORITE_LIMIT)
    : current.filter((entry) => entry !== id);
  await ctx.set(PROFILES, profile.id, { ...profile.data, favorites });
  return { favorite: marked };
}

/** The member's 관심 posts they may still read, in the order marked, 20 a page. */
export async function favorites(ctx, { page = 1 } = {}) {
  if (!Number.isInteger(page) || page < 1 || page > 10)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const access = await communityAccess(ctx);
  const profile = ctx.member ? await ctx.get(PROFILES, ctx.member.id) : null;
  const ids = Array.isArray(profile?.data.favorites)
    ? profile.data.favorites
    : [];
  const slice = ids.slice((page - 1) * 20, page * 20);
  const rows = slice.length ? await ctx.getMany(LOGS, slice) : [];
  const documents = [];
  for (const row of rows)
    if (await logReadable(ctx, row, access))
      documents.push(shown(ctx, access, excerpt(row)));
  return { documents, total: ids.length };
}

/**
 * 로그내역 (mypage): the member's own posts, newest first, 30 of them, on
 * the boards they may still read. Readers cannot ask by author themselves,
 * which would find others' 익명 posts.
 */
export async function mine(ctx) {
  if (!ctx.member)
    ctx.fail("AUTH_REQUIRED", "로그인해 주세요.", { reason: "sign_in" });
  const access = await communityAccess(ctx);
  const page = await ctx.list(LOGS, {
    filter: { owner: ctx.member.id },
    where: { ne: ["deleted", true] },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: 50,
  });
  const documents = [];
  for (const row of page.documents) {
    const board = await boardOf(ctx, row.data.board ?? "default");
    if (boardAllowed(board, access, "read")) documents.push(excerpt(row));
    if (documents.length === 30) break;
  }
  return { documents };
}

/** A post with its text cut to 300 plain characters; 더 보기 reads the rest. */
function excerpt(row) {
  const raw = row.data.text ?? "";
  if (raw.length <= 300 && row.data.format !== "html") return row;
  const text = plainText(raw);
  return {
    ...row,
    data: {
      ...row.data,
      text: text.length > 300 ? `${text.slice(0, 300)}…` : text,
      truncated: true,
    },
  };
}

/** readableBy as a predicate: for a list, which posts the caller may read. */
const readable = (ctx, access) =>
  access.role === "moderator"
    ? true
    : ctx.member
      ? {
          any: [
            { ne: ["secret", true] },
            { eq: ["owner", ctx.member.id] },
            { eq: [{ metadata: "createdBy" }, ctx.member.id] },
          ],
        }
      : { ne: ["secret", true] };

/**
 * A Q&A board's questions (skin/board/qna), ten to a page, newest first:
 * whole, except others' secret questions, which show locked until opened
 * with their password.
 */
export async function questions(
  ctx,
  { board: id, after = null, size = 10, cursorOnly = false } = {},
) {
  const { access, board } = await readableBoard(ctx, id);
  if (board.data.kind !== "qna")
    ctx.fail("INVALID_REQUEST", "질문 게시판이 아닙니다.", {
      reason: "invalid_input",
    });
  if (
    (after !== null && typeof after !== "string") ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 100
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const query = { filter: { board: id }, where: { ne: ["deleted", true] } };
  const list = (count) =>
    ctx.list(LOGS, {
      ...query,
      sort: [
        ["notice", "desc"],
        [{ metadata: "createdAt" }, "desc"],
      ],
      size: count,
      after,
    });
  // Skipping to a later page: only where it starts.
  if (cursorOnly) return { nextCursor: (await list(size)).nextCursor };
  const page = await list(Math.min(size, 10));
  const visible = readableBy(ctx, access);
  const documents = page.documents.map((row) =>
    visible(row) ? shown(ctx, access, row) : locked(row),
  );
  // Whole questions, as the qna skin lists them, as many as fit in a
  // function's result; the rest start the next page.
  let fits = 0;
  let bytes = 0;
  for (const row of documents) {
    bytes += JSON.stringify(row).length * 3;
    if (fits && bytes > RESULT_BUDGET) break;
    fits += 1;
  }
  return {
    documents: documents.slice(0, fits),
    nextCursor:
      fits < documents.length ? (await list(fits)).nextCursor : page.nextCursor,
    totalCount: await ctx.count(LOGS, query),
  };
}

/** Bytes of documents a list function returns: under the 64 KiB result. */
const RESULT_BUDGET = 56 * 1024;

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
  // 정산완료 or 반려, as the admin's reply offers (caculate/write_comment.php:28).
  if (!["정산완료", "반려"].includes(state))
    ctx.fail("INVALID_REQUEST", "처리 상태는 정산완료 또는 반려입니다.", {
      reason: "invalid_input",
    });
  const settled = state;
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
  const named = await names(ctx);
  await ctx.add(COMMENTS, {
    logId: row.id,
    owner: ctx.member?.id ?? null,
    text: [
      `[${settled}]`,
      exp ? `${named.expName} +${exp}${named.expUnit}` : "",
      money ? `+${money} ${named.moneyUnit}` : "",
      note,
    ]
      .filter(Boolean)
      .join(" "),
    dice: false,
    settlement: true,
  });
  return { document };
}
