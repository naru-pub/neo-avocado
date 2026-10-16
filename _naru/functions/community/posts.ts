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
  withExp,
  payReward,
  takeBackReward,
} from "../../modules/shared.js";
import {
  checkBannedWords,
  checkEditable,
  checkLength,
} from "../../modules/board-options.js";
import type { Access } from "../../modules/shared.js";
import { notDeleted, startValue, startWrite } from "../../modules/community.js";
import {
  speakerOf,
  rollDice,
  resolveCalls,
  deliverCalls,
  useInPost,
  combineInPost,
  explore,
} from "../../modules/roleplay.js";
import type {
  Ctx,
  GuestCredentials,
  ListOptions,
  NaruDocument,
  Page,
  Where,
} from "../../modules/naru-types.js";

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
/** What a writer sends for a post. */
export interface PostInput {
  board?: string;
  title?: string;
  category?: string;
  text?: string;
  image?: string | null;
  secret?: boolean;
  membersOnly?: boolean;
  adult?: boolean;
  wide?: boolean;
  fold?: boolean;
  anonymous?: boolean;
  character?: string | null;
  dice?: boolean;
  /** 탐색 (S) or 조합 (H): one a post (write.skin.php:205-210). */
  action?: "combine" | "explore";
  /** Owned inventory rows to combine (조합). */
  materials?: string[];
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
    data?: PostInput;
    revision?: string | null;
    guest?: GuestCredentials;
  } = {},
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
  const staff = access.role === "moderator";
  if (previous) await checkEditable(ctx, previous, board, access);
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
  // An HTML board has no length limits, as the original's editor (write.php:207).
  if (value.format !== "html")
    checkLength(
      ctx,
      value.text,
      { min: board.data.writeMin, max: board.data.writeMax },
      staff,
    );
  await checkBannedWords(ctx, value.title, value.text);
  // The mmb skin's options (write.skin.php:327-349): 멤버공개 and 19금 for
  // members, 리플창 아래로 and 로그접기 for anyone, and 익명 for members
  // where the board allows it (bo_use_noname).
  const option = (key: keyof PostInput) =>
    Object.hasOwn(data, key)
      ? data[key] === true
      : previous?.data[key] === true;
  value.membersOnly = !guest && option("membersOnly");
  value.adult = !guest && option("adult");
  value.wide = option("wide");
  value.fold = option("fold");
  value.anonymous =
    !guest && board.data.anonymous === true && option("anonymous");
  // 탐색 or 조합 (wr_log) and item use (wr_item_log). A post without them
  // takes them when edited, as the form offers them again while wr_log and
  // wr_item_log are empty (write.skin.php:196,290; write_update.inc.php:92).
  const before = Array.isArray(previous?.data.actions)
    ? previous.data.actions
    : [];
  const logged = before.some(
    (action) => action?.type === "explore" || action?.type === "combine",
  );
  const itemLogged = before.some((action) => action?.type === "use");
  if (
    (data.action !== undefined &&
      data.action !== "combine" &&
      data.action !== "explore") ||
    (data.item !== undefined && typeof data.item !== "string")
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (
    (data.action !== undefined && logged) ||
    (data.item !== undefined && itemLogged)
  )
    ctx.fail("CONFLICT", "이미 행동을 기록한 글입니다.", {
      reason: "already_acted",
    });
  const acting = data.action !== undefined || data.item !== undefined;
  // 조합, 탐색 and item use are a post's (write.skin.php:196-300), on boards
  // that allow actions, for members; on an edit, the writer's own.
  if (
    acting &&
    (guest ||
      board.data.actions !== true ||
      (previous && author(previous) !== ctx.member?.id))
  )
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (!previous) {
    speaker = await speakerOf(ctx, data.character);
    if (speaker) {
      value.character = speaker.character;
      value.speaker = speaker;
    }
  } else if (acting)
    // The post's character must still be the writer's to act for it.
    await speakerOf(ctx, previous.data.character ?? null);
  // Dice once a post: on an edit only while it has none (write.skin.php:319).
  if (data.dice === true && !previous?.data.dice) {
    value.dice = true;
    value.rolls = rollDice();
  }
  if (acting) {
    const actions = [...before];
    if (data.action === "combine")
      actions.push(await combineInPost(ctx, data.materials, speaker));
    if (data.action === "explore") actions.push(await explore(ctx, speaker));
    if (data.item !== undefined)
      actions.push(await useInPost(ctx, data.item, speaker));
    value.actions = actions;
  }
  calls = guest
    ? { text: value.text, recipients: [] }
    : await resolveCalls(
        ctx,
        value.text,
        previous?.data.text ?? "",
        previous?.data.called,
      );
  value.text = calls.text;
  if (!guest) value.called = calls.called;
  Object.assign(
    value,
    tagFields(value.format === "html" ? plainText(value.text) : value.text),
  );
  if (!previous) {
    value.number = await nextNumber(ctx, boardId);
    // 글쓰기 포인트 (bo_write_point), for members; a delete takes it back.
    const reward = guest
      ? 0
      : await payReward(
          ctx,
          board.data.writeReward,
          `${board.data.name ?? boardId} ${value.number} 글쓰기`,
        );
    if (reward) value.reward = reward;
  }
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
export async function remove(
  ctx: Ctx,
  { id, guest }: { id?: string; guest?: GuestCredentials } = {},
) {
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
  // A post that recorded 탐색 or 조합 (wr_log) stays, but for the staff
  // (mmb/list.log.skin.php:9); an item's use alone does not keep it.
  if (
    access.role !== "moderator" &&
    (Array.isArray(previous.data.actions) ? previous.data.actions : []).some(
      (action) => action?.type === "explore" || action?.type === "combine",
    )
  )
    ctx.fail("CONFLICT", "탐색·조합을 기록한 글은 지울 수 없습니다.", {
      reason: "acted",
    });
  // 글쓰기 포인트 goes back once, as the deletion starts (bbs/delete.php:78).
  if (!previous.data.deleted && previous.data.reward > 0)
    await takeBackReward(
      ctx,
      previous,
      `${(await boardOf(ctx, previous.data.board ?? "default"))?.data.name ?? "게시판"} ${previous.data.number ?? ""} 글삭제`,
    );
  return await deleteCommunityDocument(ctx, LOGS, "logs", previous);
}

/** Topic on which new posts are announced to open pages (app/live.js listens). */
const POSTS_TOPIC = `${PREFIX}logs`;
const BASE_ACCESS: Access = { level: 2, role: "member" };

/**
 * Broadcasts reach anyone listening, visitors included, so only a post a
 * base-level member could list and read is announced, by board and ID only.
 */
async function announcePost(ctx: Ctx, { id, data: log }: NaruDocument) {
  if (log.secret) return;
  const board = await boardOf(ctx, log.board);
  if (
    boardAllowed(board, BASE_ACCESS, "list") &&
    boardAllowed(board, BASE_ACCESS, "read")
  )
    ctx.broadcast(POSTS_TOPIC, { board: log.board, id });
}

/** A post as a reader who may not read its body sees it: a locked entry. */
const locked = (row: NaruDocument): NaruDocument => ({
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
const readableBy = (ctx: Ctx, access: Access) => (row: NaruDocument) =>
  !row.data.secret ||
  access.role === "moderator" ||
  Boolean(ctx.member && author(row) === ctx.member.id);

/** The board, if the caller may list and read it. */
async function readableBoard(ctx: Ctx, id: unknown) {
  const access = await communityAccess(ctx);
  const board = typeof id === "string" ? await boardOf(ctx, id) : null;
  if (
    !boardAllowed(board, access, "list") ||
    !boardAllowed(board, access, "read")
  )
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  return { access, board };
}

/** Where a search's cursor turns from posts to comments. */
const COMMENT_PHASE = "comments:";

/**
 * Searches a board (the skins' 검색) over all its posts, 20 a page, newest
 * first: those the caller may read whose title or text holds `text`, or
 * whose author's nickname or character's name does. Then, as the original
 * also searches comments (코멘트, 오너(코): bbs/list.mmb.php:44-46), the
 * posts whose comments hold it or were written by those so named, newest
 * comment first. `after` is the last page's nextCursor. Naru does the
 * matching (`contains`), so a search reads only what it finds.
 */
export async function search(
  ctx: Ctx,
  {
    board: id,
    text: wanted,
    after = null,
  }: { board?: string; text?: string; after?: string | null } = {},
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
  const ids = (page: Page) => page.documents.map((row) => row.id);
  const memberIds = ids(members);
  const characterIds = ids(characters);
  // An author's name finds only what shows it: not 익명 posts or comments.
  const named: Where[] =
    memberIds.length || characterIds.length
      ? [
          {
            all: [
              access.role === "moderator" ? true : { ne: ["anonymous", true] },
              {
                any: [
                  ...(memberIds.length
                    ? ([
                        { in: ["owner", memberIds] },
                        { in: [{ metadata: "createdBy" }, memberIds] },
                      ] satisfies Where[])
                    : []),
                  ...(characterIds.length
                    ? ([{ in: ["character", characterIds] }] satisfies Where[])
                    : []),
                ],
              },
            ],
          },
        ]
      : [];
  const found: Where = {
    any: [
      { contains: ["title", text] },
      { contains: ["text", text] },
      ...named,
    ],
  };
  const documents: NaruDocument[] = [];
  let nextCursor: string | null = null;
  let commentsFrom: string | null = null;
  if (!after?.startsWith(COMMENT_PHASE)) {
    const page = await ctx.list(LOGS, {
      filter: { board: id },
      where: {
        all: [
          { ne: ["deleted", true] },
          readable(ctx, access),
          // 멤버공개: a visitor's search does not look inside them.
          ctx.member ? true : { ne: ["membersOnly", true] },
          found,
        ],
      },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size: 20,
      after,
    });
    documents.push(...page.documents);
    nextCursor = page.nextCursor;
  } else commentsFrom = after.slice(COMMENT_PHASE.length) || null;
  // Once the posts are done, their comments, filling the page up to 20.
  if (!nextCursor) {
    const comments = await ctx.list(COMMENTS, {
      where: { any: [{ contains: ["text", text] }, ...named] },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size: Math.max(1, 20 - documents.length),
      after: commentsFrom,
    });
    const parents = [
      ...new Set(
        comments.documents
          .map((row) => row.data.logId)
          .filter((logId) => typeof logId === "string"),
      ),
    ];
    const visible = readableBy(ctx, access);
    const lower = text.toLowerCase();
    // A post that matched itself was listed with the posts already.
    const matchedItself = (row: NaruDocument) =>
      [row.data.title, row.data.text].some(
        (value) =>
          typeof value === "string" && value.toLowerCase().includes(lower),
      ) ||
      ((access.role === "moderator" || row.data.anonymous !== true) &&
        (memberIds.includes(row.data.owner) ||
          memberIds.includes(row.createdBy) ||
          characterIds.includes(row.data.character)));
    for (const row of parents.length ? await ctx.getMany(LOGS, parents) : [])
      if (
        row &&
        (row.data.board ?? "default") === id &&
        !row.data.deleted &&
        visible(row) &&
        (ctx.member || row.data.membersOnly !== true) &&
        !matchedItself(row)
      )
        documents.push(row);
    nextCursor = comments.nextCursor
      ? `${COMMENT_PHASE}${comments.nextCursor}`
      : null;
  }
  // 300 characters of each, as the original's search shows (bbs/search.php):
  // whole posts could pass a function's 64 KiB result.
  return {
    documents: documents.map((row) => shown(ctx, access, excerpt(row))),
    nextCursor,
  };
}

/** A post as this caller sees it: 멤버공개 and 익명 (presentPost). */
const shown = (ctx: Ctx, access: Access, row: NaruDocument) => ({
  ...row,
  data: presentPost(row, {
    member: ctx.member?.id ?? null,
    staff: access.role === "moderator",
  }),
});

/** 관심로그 (mmb's 관심, mypage/log/log_favorite.php): at most 200. */
const FAVORITE_LIMIT = 200;

/** Marks a post 관심, or unmarks it; the newest first. */
export async function favorite(ctx: Ctx, { id }: { id?: string } = {}) {
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
export async function favorites(
  ctx: Ctx,
  { page = 1 }: { page?: number } = {},
) {
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
export async function mine(ctx: Ctx) {
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
function excerpt(row: NaruDocument): NaruDocument {
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
const readable = (ctx: Ctx, access: Access): Where =>
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
  ctx: Ctx,
  {
    board: id,
    after = null,
    size = 10,
    category = null,
    cursorOnly = false,
  }: {
    board?: string;
    after?: string | null;
    size?: number;
    /** 분류 (sca): only this category's questions. */
    category?: string | null;
    /** Only where the page starts: its nextCursor. */
    cursorOnly?: boolean;
  } = {},
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
    size > 100 ||
    (category !== null &&
      (typeof category !== "string" || category.length > 40))
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const query: ListOptions = {
    filter: { board: id, ...(category ? { category } : {}) },
    where: { ne: ["deleted", true] },
  };
  const list = (count: number) =>
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
export async function open(
  ctx: Ctx,
  { id, password }: { id?: string; password?: string } = {},
) {
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
  ctx: Ctx,
  {
    id,
    state,
    exp = 0,
    money = 0,
    memo = "",
  }: {
    id?: string;
    /** 정산완료 or 반려. */
    state?: string;
    exp?: number;
    money?: number;
    memo?: string;
  } = {},
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
  // A request is paid once: settling it again only changes its state
  // (caculate/write_comment_update.skin.php pays on a new reply, w != cu).
  if (row.data.settlement?.state && (exp > 0 || money > 0))
    ctx.fail("CONFLICT", "이미 처리된 정산글에는 다시 지급할 수 없습니다.", {
      reason: "settled",
    });
  // A moderator does not pay their own request; the site owner may.
  if (!ctx.owner && owner === ctx.member?.id && (exp > 0 || money > 0))
    ctx.fail("ACCESS_DENIED", "자기 정산글에는 지급할 수 없습니다.", {
      reason: "own_settlement",
    });
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
    await ctx.set(
      CHARACTER_STATE,
      character,
      await withExp(ctx, current.data, total),
    );
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
    if (!Number.isSafeInteger(balance))
      ctx.fail("INVALID_REQUEST", "지급할 수 있는 금액을 넘었습니다.", {
        reason: "invalid_input",
      });
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
