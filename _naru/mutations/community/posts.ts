// Posts (logs) on the boards: writing and deleting them, 관심, and the
// staff's settlements. Visitors post on boards open to level 1, as guests
// with a name and password.
import {
  amount,
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
  TEXT_LIMIT,
  accessOf,
  boardOf,
  isStaff,
  memoOf,
  payReward,
  plainText,
  postOf,
  postRow,
  readablePost,
  requireBoard,
  saveTags,
  tagsOf,
  takeBackReward,
} from "../../modules/boards.js";
import type { PostRow } from "../../modules/boards.js";
import {
  checkBannedWords,
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
}

const invalid = (ctx: MutationCtx) =>
  ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });

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
  const staff = isStaff(access);
  const before = previous ? postOf(previous).data : null;
  // A processed settlement (skin/board/caculate) stays as it was settled.
  if (before?.settlement?.state && !staff)
    ctx.fail("CONFLICT", "이미 처리된 정산글은 고칠 수 없습니다.", {
      reason: "settled",
    });
  if (!given || typeof given !== "object") invalid(ctx);
  // Guests post as themselves, never as a character.
  const data: PostInput = guest ? { ...given, character: undefined } : given;
  const boardId = previous?.board ?? data.board ?? "default";
  const board = await boardOf(ctx, boardId);
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
  if (data.action === "combine")
    actions.push(await combineInPost(ctx, data.materials, speaker));
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
  const staff = isStaff(access);
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
  const board = await boardOf(ctx, previous.board);
  // 글쓰기 포인트 goes back (bbs/delete.php:78), then each commenter's
  // 댓글쓰기 포인트, theirs together, down to nothing.
  await takeBackReward(ctx, previous, memoOf(board, previous.number, "글삭제"));
  const taken = `min(wallets.balance, (SELECT sum(reward) FROM comments
    WHERE comments.post_id = ? AND comments.owner = wallets.member AND comments.reward > 0))`;
  await ctx.sql(
    `INSERT INTO history (owner, kind, at, delta, balance, memo)
     SELECT member, 'board', ?, -${taken}, balance - ${taken}, ?
     FROM wallets WHERE member IN (SELECT owner FROM comments WHERE post_id = ? AND reward > 0)
       AND ${taken} > 0`,
    [
      ctx.now,
      previous.id,
      previous.id,
      memoOf(board, previous.number, "댓글삭제"),
      previous.id,
      previous.id,
    ],
  );
  await ctx.sql(
    `UPDATE wallets SET balance = balance - ${taken}
     WHERE member IN (SELECT owner FROM comments WHERE post_id = ? AND reward > 0)`,
    [previous.id, previous.id],
  );
  await ctx.sql`DELETE FROM comments WHERE post_id = ${previous.id}`;
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
  if (!isStaff(access))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  const row = await postRow(ctx, id);
  if (!row)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  const board = await boardOf(ctx, row.board);
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
  await ctx.sql`INSERT INTO comments (post_id, owner, body, settlement, created_at, updated_at)
    VALUES (${row.id}, ${ctx.member?.id ?? null}, ${reply}, 1, ${ctx.now}, ${ctx.now})`;
  return {
    document: postOf(
      (await ctx.sql<PostRow>(`${POST_SELECT} WHERE id = ?`, [saved.id]))
        .rows[0],
    ),
  };
}
