// Posts (logs) on the boards: writing and deleting them, 관심, and the
// staff's settlements. Visitors post on boards open to level 1, as guests
// with a name and password.
import {
  amount,
  communitySettings,
  imageUrl,
  names,
  one,
  parsed,
  signedIn,
  text,
} from "../../modules/access.js";
import {
  HTML_LIMIT,
  POST_SELECT,
  REPLY_DEPTH,
  REPLY_DIGITS,
  TEXT_LIMIT,
  accessOf,
  boardOf,
  isStaff,
  memoOf,
  payReward,
  plainText,
  postOf,
  postReadable,
  postRow,
  readablePost,
  requireBoard,
  saveCommentSearch,
  savePostSearch,
  saveTags,
  tagsOf,
  takeBackReward,
} from "../../modules/boards.js";
import type { PostRow } from "../../modules/boards.js";
import {
  boardNumber,
  checkBannedWords,
  checkDelay,
  checkEditable,
  checkLength,
} from "../../modules/board-options.js";
import { startWrite } from "../../modules/community.js";
import {
  characterState,
  saveState,
  withExp,
} from "../../modules/characters.js";
import {
  FAVORITE_LIMIT,
  addHistory,
  profileOf,
  saveWallet,
  walletOf,
} from "../../modules/members.js";
import {
  combineInPost,
  deliverCalls,
  explore,
  resolveCalls,
  rollDice,
  speakerOf,
  useInPost,
} from "../../modules/roleplay.js";
import type { Speaker } from "../../modules/roleplay.js";
import type {
  GuestCredentials,
  MutationCtx,
  SqlValue,
} from "../../modules/naru-types.js";

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
  /** 링크 #1 and #2 (wr_link1, wr_link2): http(s) addresses. */
  links?: string[];
  /** A plain board's pictures after the first (bo_upload_count). */
  files?: string[];
  /** 답변 (bbs/write.php w=r): the post this one answers, on a new post. */
  replyTo?: string;
}

/** G5_LINK_COUNT: a post's links. */
const LINK_COUNT = 2;
/** The most pictures a board may let a post take. */
const UPLOAD_LIMIT = 10;

const invalid = (ctx: MutationCtx) =>
  ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });

/** A post's links as sent: at most two http(s) addresses, blanks dropped. */
function linksOf(ctx: MutationCtx, value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LINK_COUNT) invalid(ctx);
  const links = [];
  for (const entry of value as unknown[]) {
    if (entry === null || entry === "") continue;
    if (
      typeof entry !== "string" ||
      entry.length > 2000 ||
      !/^https?:\/\/[^\s/@?#:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(
        entry.trim(),
      )
    )
      ctx.fail(
        "INVALID_REQUEST",
        "링크는 http:// 또는 https:// 주소로 적어 주세요.",
        {
          reason: "invalid_link",
        },
      );
    links.push(entry.trim());
  }
  return links;
}

/** A plain board's further pictures: HTTPS addresses, at most UPLOAD_LIMIT. */
function filesOf(ctx: MutationCtx, value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length >= UPLOAD_LIMIT) invalid(ctx);
  try {
    return (value as unknown[]).map((entry) => imageUrl(entry));
  } catch {
    return invalid(ctx);
  }
}

/** A post's actions, as its row keeps them. */
const actionsOf = (row: PostRow | null): any[] => {
  const list = parsed<any>(row?.actions, []);
  return Array.isArray(list) ? list : [];
};

/**
 * Writes a new post (no `id`) or edits one (`id`, with the `revision` it was
 * read at). The board decides who may post, whether posts are secret, HTML
 * or pictures; a new post gets its number, its speaker and its dice.
 */
export async function write(
  ctx: MutationCtx,
  args: {
    id?: string | null;
    data?: PostInput;
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
  const { access, previous, guest } = await startWrite(ctx, "post", {
    id,
    guest: credentials,
    revision,
  });
  const before = previous ? postOf(previous).data : null;
  if (!given || typeof given !== "object") invalid(ctx);
  // Guests post as themselves, never as a character.
  const data: PostInput = guest ? { ...given, character: undefined } : given;
  const boardId = previous?.board ?? data.board ?? "default";
  const board = await boardOf(ctx, boardId);
  const staff = isStaff(access, board);
  // A processed settlement (skin/board/caculate) stays as it was settled.
  if (before?.settlement?.state && !staff)
    ctx.fail("CONFLICT", "이미 처리된 정산글은 고칠 수 없습니다.", {
      reason: "settled",
    });
  requireBoard(ctx, board, access, "write");
  if (previous) await checkEditable(ctx, previous, board, access);
  // Posting as a character, dice and calls (skin/board/mmb). The speaker and
  // the dice are fixed when a post is made; edits keep them.
  let speaker: Speaker | null = before?.speaker ?? null;
  const secret =
    board.data.secret === "required" ||
    (Object.hasOwn(data, "secret")
      ? data.secret === true
      : Boolean(before?.secret));
  if (secret && board.data.secret === "off" && !before?.secret) invalid(ctx);
  // A guest could never read their secret post back, so they cannot write
  // one; on a Q&A board they open it again with their password.
  if (secret && guest && board.data.kind !== "qna")
    ctx.fail("ACCESS_DENIED", "손님은 비밀글을 쓸 수 없습니다.", {
      reason: "guest_secret",
    });
  const title = text(data.title ?? before?.title ?? "", 120);
  const category = text(data.category ?? before?.category ?? "", 40);
  if (category && !(board.data.categories ?? []).includes(category))
    invalid(ctx);
  // Boards with HTML on (bo_use_dhtml_editor) take sanitized-on-display HTML.
  const format = before?.format ?? (board.data.html === true ? "html" : "text");
  let body = text(data.text ?? "", format === "html" ? HTML_LIMIT : TEXT_LIMIT);
  const image =
    data.image === before?.image
      ? (data.image ?? null)
      : data.image
        ? imageUrl(data.image)
        : null;
  if (board.data.kind === "image" && !image) invalid(ctx);
  // wr_link1 and wr_link2: up to two web addresses, shown as LINK.
  const links = Object.hasOwn(data, "links")
    ? linksOf(ctx, data.links)
    : parsed<string[]>(previous?.links, []);
  // bo_upload_count: a plain board's post takes that many pictures, the
  // first its image (0: none); a picture log takes its one picture.
  const files =
    Object.hasOwn(data, "files") &&
    JSON.stringify(data.files ?? []) !== (previous?.files ?? "[]")
      ? filesOf(ctx, data.files)
      : parsed<string[]>(previous?.files, []);
  if (board.data.kind !== "text" && files.length) invalid(ctx);
  if (
    board.data.kind === "text" &&
    (image !== (before?.image ?? null) || files.length) &&
    (image ? 1 : 0) + files.length > boardNumber(board, "uploadCount")
  )
    ctx.fail(
      "INVALID_REQUEST",
      boardNumber(board, "uploadCount")
        ? `이 게시판은 그림을 ${boardNumber(board, "uploadCount")}개까지 올릴 수 있습니다.`
        : "이 게시판은 그림을 올릴 수 없습니다.",
      { reason: "upload_count" },
    );
  if (!image && !body) invalid(ctx);
  // An HTML board has no length limits, as the original's editor (write.php:207).
  if (format !== "html")
    checkLength(
      ctx,
      body,
      { min: board.data.writeMin, max: board.data.writeMax },
      staff,
    );
  await checkBannedWords(ctx, title, body);
  if (!previous) await checkDelay(ctx, staff);
  // The mmb skin's options (write.skin.php:327-349): 멤버공개 and 19금 for
  // members, 리플창 아래로 and 로그접기 for anyone, and 익명 for members
  // where the board allows it (bo_use_noname).
  const option = (key: keyof PostInput) =>
    Object.hasOwn(data, key) ? data[key] === true : before?.[key] === true;
  const membersOnly = !guest && option("membersOnly");
  const adult = !guest && option("adult");
  const wide = option("wide");
  const fold = option("fold");
  const anonymous =
    !guest && board.data.anonymous === true && option("anonymous");
  // 탐색 or 조합 (wr_log) and item use (wr_item_log). A post without them
  // takes them when edited, as the form offers them again while wr_log and
  // wr_item_log are empty (write.skin.php:196,290; write_update.inc.php:92).
  const done = actionsOf(previous);
  const logged = done.some(
    (action) => action?.type === "explore" || action?.type === "combine",
  );
  const itemLogged = done.some((action) => action?.type === "use");
  if (
    (data.action !== undefined &&
      data.action !== "combine" &&
      data.action !== "explore") ||
    (data.item !== undefined && typeof data.item !== "string")
  )
    invalid(ctx);
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
      !ctx.member ||
      board.data.actions !== true ||
      (previous && previous.owner !== ctx.member.id))
  )
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (!previous) speaker = await speakerOf(ctx, data.character);
  else if (acting)
    // The post's character must still be the writer's to act for it.
    await speakerOf(ctx, before.character ?? null);
  // Dice once a post: on an edit only while it has none (write.skin.php:319).
  const dice = Boolean(before?.dice) || data.dice === true;
  const rolls =
    data.dice === true && !before?.dice ? rollDice() : (before?.rolls ?? null);
  const actions = [...done];
  if (data.action === "combine") {
    // 조합(레시피)사용 (cf_5) off: no 조합 in posts.
    if ((await communitySettings(ctx)).recipes === false)
      ctx.fail("ACCESS_DENIED", "조합을 사용하지 않는 커뮤니티입니다.", {
        reason: "recipes_off",
      });
    actions.push(await combineInPost(ctx, data.materials, speaker));
  }
  if (data.action === "explore") actions.push(await explore(ctx, speaker));
  if (data.item !== undefined)
    actions.push(await useInPost(ctx, data.item, speaker));
  const calls = guest
    ? { text: body, recipients: [], called: [] }
    : await resolveCalls(
        ctx,
        body,
        before?.text ?? "",
        parsed(previous?.called, []),
      );
  body = calls.text;
  const tags = tagsOf(format === "html" ? plainText(body) : body);
  const columns: Record<string, SqlValue> = {
    title,
    category,
    format,
    body,
    image,
    secret,
    members_only: membersOnly,
    adult,
    wide,
    fold,
    anonymous,
    dice,
    rolls: rolls ? JSON.stringify(rolls) : null,
    actions: JSON.stringify(actions),
    called: JSON.stringify(calls.called),
    links: JSON.stringify(links),
    files: JSON.stringify(files),
    updated_at: ctx.now,
  };
  let row: PostRow;
  if (previous) {
    row = (
      await ctx.sql<PostRow>(
        `UPDATE posts SET ${Object.keys(columns)
          .map((column) => `${column} = ?`)
          .join(", ")}, version = version + 1 WHERE id = ? RETURNING *`,
        [...Object.values(columns), previous.id],
      )
    ).rows[0];
  } else {
    // The board's next number (wr_num): its highest plus one.
    const { next } = await one<{ next: number }>(
      ctx,
      "SELECT coalesce(max(number), 0) + 1 AS next FROM posts WHERE board = ?",
      [boardId],
    );
    // 답변 (write.php w=r, write_update.php:150-175): on a plain board, at
    // 글답변 권한, to a post the writer may read, ten replies deep at most.
    // Its path is its parent's and its place among them: the later below
    // (bo_reply_order 1, as installed) or above (0).
    let thread: number | null = null;
    let replyPath = "";
    if (data.replyTo !== undefined) {
      const parent = await postRow(ctx, data.replyTo);
      if (
        !parent ||
        parent.board !== boardId ||
        board.data.kind !== "text" ||
        !(await postReadable(ctx, parent, access, ctx.member?.id, board))
      )
        invalid(ctx);
      requireBoard(ctx, board, access, "reply");
      if (parent.reply_path.length / REPLY_DIGITS >= REPLY_DEPTH)
        ctx.fail("INVALID_REQUEST", "더 이상 답변하실 수 없습니다.", {
          reason: "reply_depth",
        });
      thread = parent.thread ?? parent.id;
      const { n } = await one<{ n: number }>(
        ctx,
        `SELECT count(*) AS n FROM posts WHERE thread = ?
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
      const place = String(board.data.replyOrder) === "0" ? 998 - n : n + 1;
      replyPath = parent.reply_path + String(place).padStart(REPLY_DIGITS, "0");
    }
    // 글쓰기 포인트 (bo_write_point), for members; a delete takes it back.
    const reward = guest
      ? 0
      : await payReward(
          ctx,
          board.data.writeReward,
          memoOf(board, next, "글쓰기"),
        );
    Object.assign(columns, {
      board: boardId,
      number: next,
      owner: ctx.member?.id ?? null,
      character_id: speaker ? Number(speaker.character) : null,
      speaker: speaker ? JSON.stringify(speaker) : null,
      reward,
      guest_name: guest?.name ?? null,
      guest_hash: guest?.hash ?? null,
      created_at: ctx.now,
      thread,
      reply_path: replyPath,
    });
    row = (
      await ctx.sql<PostRow>(
        `INSERT INTO posts (${Object.keys(columns).join(", ")}) VALUES (${Object.keys(
          columns,
        )
          .map(() => "?")
          .join(", ")}) RETURNING *`,
        Object.values(columns),
      )
    ).rows[0];
  }
  await saveTags(ctx, row.id, tags);
  await savePostSearch(ctx, row, !previous);
  await deliverCalls(ctx, {
    post: row,
    text: body,
    speaker,
    recipients: calls.recipients,
    notifyAuthor: false,
    guest: guest?.name ?? null,
    anonymous,
  });
  return { document: postOf({ ...row, tags: JSON.stringify(tags) }) };
}

/**
 * Deletes a post with its comments, tags, calls and 관심 marks, taking back
 * what the post and its comments were paid (bbs/delete.php), in one call.
 * Its uploads stay: Naru deletes media only when asked, and marks
 * unreferenced uploads in its library.
 */
export async function remove(
  ctx: MutationCtx,
  args: { id?: string; guest?: GuestCredentials },
) {
  const { id, guest } = args ?? {};
  const { access, previous } = await startWrite(ctx, "post", {
    id: id ?? "",
    guest,
  });
  const board = await boardOf(ctx, previous.board);
  const staff = isStaff(access, board);
  // A settled request stays (caculate/list.skin.php:109: 삭제 while wr_10 is empty).
  if (parsed<any>(previous.settlement, {})?.state && !staff)
    ctx.fail("CONFLICT", "이미 처리된 정산글은 지울 수 없습니다.", {
      reason: "settled",
    });
  // A post that recorded 탐색 or 조합 (wr_log) stays, but for the staff
  // (mmb/list.log.skin.php:9); an item's use alone does not keep it.
  if (
    !staff &&
    actionsOf(previous).some(
      (action) => action?.type === "explore" || action?.type === "combine",
    )
  )
    ctx.fail("CONFLICT", "탐색·조합을 기록한 글은 지울 수 없습니다.", {
      reason: "acted",
    });
  // 이 글과 관련된 답변글이 존재하므로 삭제 할 수 없습니다 (bbs/delete.php:46),
  // but for the staff, whose deleting leaves the replies in their place.
  if (
    !staff &&
    (await one(
      ctx,
      `SELECT 1 FROM posts WHERE thread = ? AND length(reply_path) > ?
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
      "이 글과 관련된 답변글이 존재하므로 삭제 할 수 없습니다.",
      { reason: "has_replies" },
    );
  // 글쓰기 포인트 goes back (bbs/delete.php:78), then each commenter's
  // 댓글쓰기 포인트, theirs together, down to nothing.
  await takeBackReward(ctx, previous, memoOf(board, previous.number, "글삭제"));
  // The rewards are summed per commenter first, then each commenter's wallet
  // found once by its key: Naru's plan rule refuses reading the post's
  // comments again for every wallet.
  const rewards = `WITH rewards AS MATERIALIZED (
    SELECT owner, sum(reward) AS reward FROM comments
    WHERE post_id = ? AND reward > 0 GROUP BY owner)`;
  const taken = "min(wallets.balance, rewards.reward)";
  await ctx.sql(
    `${rewards}
     INSERT INTO history (owner, kind, at, delta, balance, memo)
     SELECT wallets.member, 'board', ?, -${taken}, wallets.balance - ${taken}, ?
     FROM rewards JOIN wallets ON wallets.member = rewards.owner
     WHERE ${taken} > 0 ORDER BY wallets.member`,
    [previous.id, ctx.now, memoOf(board, previous.number, "댓글삭제")],
  );
  await ctx.sql(
    `${rewards}
     UPDATE wallets SET balance = balance - min(balance, rewards.reward)
     FROM rewards WHERE wallets.member = rewards.owner`,
    [previous.id],
  );
  // Their full-text rows go with them (posts_search, comments_search).
  await ctx.sql`DELETE FROM comments_search WHERE rowid IN (SELECT id FROM comments WHERE post_id = ${previous.id})`;
  await ctx.sql`DELETE FROM comments WHERE post_id = ${previous.id}`;
  await ctx.sql`DELETE FROM posts_search WHERE rowid = ${previous.id}`;
  await ctx.sql`DELETE FROM post_tags WHERE post_id = ${previous.id}`;
  await ctx.sql`DELETE FROM calls WHERE post_id = ${previous.id}`;
  await ctx.sql`DELETE FROM favorites WHERE post = ${previous.id}`;
  await ctx.sql`DELETE FROM posts WHERE id = ${previous.id}`;
  return null;
}

/** Marks a post 관심, or unmarks it; the newest first. */
export async function favorite(ctx: MutationCtx, args: { id?: string }) {
  const member = signedIn(ctx);
  const { row } = await readablePost(ctx, args?.id);
  if (!(await profileOf(ctx, member)))
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  const marked = !(
    await ctx.sql`SELECT 1 FROM favorites WHERE member = ${member} AND post = ${row.id}`
  ).rows.length;
  if (marked) {
    await ctx.sql`INSERT INTO favorites (member, post) VALUES (${member}, ${row.id})`;
    // The oldest go past the limit.
    await ctx.sql`DELETE FROM favorites WHERE member = ${member} AND id NOT IN (SELECT id FROM favorites WHERE member = ${member} ORDER BY id DESC LIMIT ${FAVORITE_LIMIT})`;
  } else
    await ctx.sql`DELETE FROM favorites WHERE member = ${member} AND post = ${row.id}`;
  return { favorite: marked };
}

/**
 * Settles a request on a settlement board (skin/board/caculate's admin
 * reply): its state (완료, 반려…), experience for the character it speaks
 * as and money for its author, and a reply saying so. Moderators and the
 * owner settle; after that the author can no longer change it.
 */
export async function settle(
  ctx: MutationCtx,
  args: {
    id?: string;
    /** 정산완료 or 반려. */
    state?: string;
    exp?: number;
    money?: number;
    memo?: string;
  },
) {
  const { id, state, exp = 0, money = 0, memo = "" } = args ?? {};
  const access = await accessOf(ctx);
  const row = await postRow(ctx, id);
  const board = row ? await boardOf(ctx, row.board) : null;
  // The staff, and the board's own 게시판·그룹 관리자 (caculate's $is_admin).
  if (!isStaff(access, board))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  if (board?.data.kind !== "settlement")
    ctx.fail("INVALID_REQUEST", "정산 게시판이 아닙니다.", {
      reason: "invalid_input",
    });
  // 정산완료 or 반려, as the admin's reply offers (caculate/write_comment.php:28).
  if (!["정산완료", "반려"].includes(state))
    ctx.fail("INVALID_REQUEST", "처리 상태는 정산완료 또는 반려입니다.", {
      reason: "invalid_input",
    });
  amount(exp, "Experience");
  amount(money, "Money");
  const note = text(memo ?? "", 500);
  const owner = row.owner;
  // A request is paid once: settling it again only changes its state
  // (caculate/write_comment_update.skin.php pays on a new reply, w != cu).
  if (parsed<any>(row.settlement, {})?.state && (exp > 0 || money > 0))
    ctx.fail("CONFLICT", "이미 처리된 정산글에는 다시 지급할 수 없습니다.", {
      reason: "settled",
    });
  // A moderator does not pay their own request; the site owner may.
  if (!ctx.owner && owner === ctx.member?.id && (exp > 0 || money > 0))
    ctx.fail("ACCESS_DENIED", "자기 정산글에는 지급할 수 없습니다.", {
      reason: "own_settlement",
    });
  const character = row.character_id === null ? null : String(row.character_id);
  if (exp > 0) {
    if (!character)
      ctx.fail(
        "INVALID_REQUEST",
        "캐릭터로 쓴 정산글에만 경험치를 줄 수 있습니다.",
        { reason: "no_character" },
      );
    const current = await characterState(ctx, character);
    const total = current.data.exp + exp;
    await saveState(ctx, character, await withExp(ctx, current.data, total));
    await addHistory(ctx, {
      owner: current.data.owner,
      kind: "exp",
      at: ctx.now,
      character,
      expDelta: exp,
      exp: total,
      memo: note || `정산: ${state}`,
      actor: "settlement",
    });
  }
  if (money > 0) {
    if (!owner)
      ctx.fail("INVALID_REQUEST", "회원이 쓴 정산글에만 지급할 수 있습니다.", {
        reason: "invalid_input",
      });
    const balance = (await walletOf(ctx, owner)).balance + money;
    if (!Number.isSafeInteger(balance))
      ctx.fail("INVALID_REQUEST", "지급할 수 있는 금액을 넘었습니다.", {
        reason: "invalid_input",
      });
    await saveWallet(ctx, owner, balance);
    await addHistory(ctx, {
      owner,
      kind: "settle",
      at: ctx.now,
      delta: money,
      balance,
      memo: note || `정산: ${state}`,
    });
  }
  const saved = (
    await ctx.sql<PostRow>(
      `UPDATE posts SET settlement = ?, updated_at = ?, version = version + 1 WHERE id = ? RETURNING *`,
      [JSON.stringify({ state, at: ctx.now, exp, money }), ctx.now, row.id],
    )
  ).rows[0];
  const named = await names(ctx);
  const reply = [
    `[${state}]`,
    exp ? `${named.expName} +${exp}${named.expUnit}` : "",
    money ? `+${money} ${named.moneyUnit}` : "",
    note,
  ]
    .filter(Boolean)
    .join(" ");
  const answer = (
    await ctx.sql<{
      id: number;
    }>`INSERT INTO comments (post_id, owner, body, settlement, created_at, updated_at)
    VALUES (${row.id}, ${ctx.member?.id ?? null}, ${reply}, 1, ${ctx.now}, ${ctx.now}) RETURNING id`
  ).rows[0];
  await saveCommentSearch(ctx, { id: answer.id, body: reply }, true);
  return {
    document: postOf(
      (await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [saved.id]))
        .rows[0],
    ),
  };
}
