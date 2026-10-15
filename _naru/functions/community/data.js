import {
  PREFIX,
  BOARDS,
  communityAccess,
  READ_LIMITS,
  author,
  boardOf,
  boardAllowed,
  logReadable,
  deleteCommunityDocument,
  text,
  imageUrl,
  nextNumber,
  tagFields,
  tagWhere,
  TEXT_LIMIT,
  HTML_LIMIT,
  plainText,
  preview,
} from "../../modules/shared.js";
import { memberSheet, presentCharacter } from "../../modules/characters.js";
import {
  speakerOf,
  rollDice,
  resolveCalls,
  deliverCalls,
  explore,
  useInPost,
  combineInPost,
} from "../../modules/roleplay.js";

export const readOnly = ["communityRead"];
// Visitors read public boards and post on boards open to level 1, as guests.
export const visitors = ["communityRead", "communityData"];

/** What a visitor may reach: public boards, their posts and authors' nicknames. */
const GUEST_KINDS = ["boards", "logs", "comments", "profiles", "emoticons"];

/** Collections whose list rows the gate returns unredacted, so `where` is safe. */
const WHERE_KINDS = [
  "profiles",
  "characters",
  "titles",
  "couples",
  "relations",
  "wardrobe",
  "recipes",
  "emoticons",
];

/** The gate's reads, declared read-only: they cannot write and use the read budget. */
export async function communityRead(ctx, args = {}) {
  if (!["get", "getMany", "list"].includes(args?.operation))
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  return communityData(ctx, args);
}

/** Native collection permissions must be admin/admin. This gate owns app authorization. */
export async function communityData(
  ctx,
  { collection, operation, id, data, options = {} } = {},
) {
  const access = await communityAccess(ctx);
  const visitor = !ctx.member;
  const kind =
    typeof collection === "string" && collection.startsWith(PREFIX)
      ? collection.slice(PREFIX.length)
      : "";
  if (!Object.hasOwn(READ_LIMITS, kind))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (visitor && !GUEST_KINDS.includes(kind))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (operation === "getMany") {
    if (!["profiles", "items"].includes(kind))
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (
      !Array.isArray(options.ids) ||
      options.ids.length > 50 ||
      options.ids.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id),
      )
    )
      ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
        reason: "invalid_input",
      });
    return {
      documents: (await ctx.getMany(collection, options.ids)).map((row) =>
        row?.data.deleted
          ? null
          : visitor && row
            ? { ...row, data: { nick: row.data.nick } }
            : row,
      ),
    };
  }
  if (operation === "list") {
    const query = {
      filter: options.filter,
      sort: options.sort,
      size: Math.min(options.size ?? READ_LIMITS[kind], READ_LIMITS[kind]),
      after: options.after ?? null,
    };
    if (
      ["wallets", "character_state", "settings"].includes(kind) ||
      (visitor && kind === "profiles")
    )
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (options.where !== undefined) {
      // A predicate can probe fields this gate redacts or hides (secret log
      // bodies, deleted rows), so it is only for collections returned whole,
      // and never reaches deleted rows.
      if (!WHERE_KINDS.includes(kind))
        ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
          reason: "invalid_input",
        });
      query.where = { all: [options.where, { ne: ["deleted", true] }] };
    }
    if (kind === "inventory")
      query.filter = { ...query.filter, owner: ctx.member.id };
    if (kind === "logs") {
      const selected = options.board ?? query.filter?.board ?? "default";
      const board = await boardOf(ctx, selected);
      if (!boardAllowed(board, access, "list"))
        ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
          reason: "access_denied",
        });
      query.filter = { ...query.filter, board: selected };
      // Tag search builds its own predicate; it never matches secret posts,
      // whose tags come from bodies the caller may not read.
      if (options.tag !== undefined) {
        if (typeof options.tag !== "string" || options.tag.length > 30)
          ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
            reason: "invalid_input",
          });
        query.where = {
          all: [tagWhere(options.tag), { ne: ["secret", true] }],
        };
      }
    }
    if (kind === "comments") {
      const logId = query.filter?.logId;
      const log =
        typeof logId === "string"
          ? await ctx.get(`${PREFIX}logs`, logId)
          : null;
      if (!(await logReadable(ctx, log, access)))
        ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
          reason: "document_not_found",
        });
    }
    const page = await ctx.list(collection, query);
    let documents = page.documents.filter((row) => !row.data.deleted);
    if (kind === "characters")
      documents = await Promise.all(
        documents.map((row) => presentCharacter(ctx, row, { list: true })),
      );
    // Admin-only definitions describe values members never see.
    if (kind === "character_fields")
      documents = documents.filter((row) => row.data.visibility !== "admin");
    if (kind === "boards") {
      documents = documents.filter((row) => boardAllowed(row, access, "list"));
      if (!options.after && !(await ctx.get(BOARDS, "default"))) {
        const fallback = await boardOf(ctx);
        if (boardAllowed(fallback, access, "list")) documents.unshift(fallback);
      }
    }
    if (kind === "logs")
      documents = await Promise.all(
        documents.map(async (row) =>
          (await logReadable(ctx, row, access))
            ? {
                ...row,
                data: {
                  owner: author(row),
                  number: row.data.number ?? null,
                  notice: row.data.notice === true,
                  tags: row.data.tags ?? [],
                  ...(row.data.guest ? { guest: row.data.guest } : {}),
                  ...(row.data.speaker ? { speaker: row.data.speaker } : {}),
                  ...(row.data.dice
                    ? { dice: true, rolls: row.data.rolls ?? null }
                    : {}),
                  board: row.data.board,
                  title: row.data.title ?? "",
                  category: row.data.category ?? "",
                  image: row.data.image ?? null,
                  secret: row.data.secret === true,
                  format: row.data.format === "html" ? "html" : "text",
                  ...preview(row.data),
                },
              }
            : {
                id: row.id,
                createdAt: row.createdAt,
                createdBy: row.createdBy,
                data: {
                  owner: author(row),
                  number: row.data.number ?? null,
                  title: row.data.title ?? "비밀글",
                  locked: true,
                  secret: Boolean(row.data.secret),
                },
              },
        ),
      );
    return {
      ...page,
      documents,
    };
  }
  const previous =
    typeof id === "string"
      ? kind === "boards"
        ? await boardOf(ctx, id)
        : await ctx.get(collection, id)
      : null;
  if (operation === "get") {
    if (!previous || previous.data.deleted)
      ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
        reason: "document_not_found",
      });
    if (kind === "boards" && !boardAllowed(previous, access, "list"))
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (kind === "logs" && !(await logReadable(ctx, previous, access)))
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (kind === "comments") {
      const log = await ctx.get(`${PREFIX}logs`, previous.data.logId);
      if (!(await logReadable(ctx, log, access)))
        ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
          reason: "document_not_found",
        });
    }
    if (
      (kind === "wallets" && id !== ctx.member.id) ||
      (kind === "inventory" && previous.data.owner !== ctx.member.id)
    )
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (kind === "settings")
      return id === "community"
        ? {
            document: {
              ...previous,
              data: {
                initialStatPoints: previous.data.initialStatPoints ?? 0,
                messageCost: previous.data.messageCost ?? 0,
              },
            },
          }
        : ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
            reason: "access_denied",
          });
    if (kind === "characters")
      return { document: await presentCharacter(ctx, previous) };
    if (kind === "character_fields" && previous.data.visibility === "admin")
      ctx.fail("ACCESS_DENIED", "권한이 없습니다.", {
        reason: "access_denied",
      });
    if (kind === "character_state") {
      const { purchases, ...publicState } = previous.data;
      return { document: { ...previous, data: publicState } };
    }
    return { document: previous };
  }
  if (
    !["profiles", "characters", "logs", "comments"].includes(kind) ||
    !["add", "set", "delete"].includes(operation)
  )
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (visitor && !["logs", "comments"].includes(kind))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (kind === "profiles" && (operation !== "set" || id !== ctx.member.id))
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (operation !== "add" && !previous)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  // A guest proves a post is theirs with its password (bbs/password_check.php).
  let guest = null;
  if (visitor) {
    const name = options.guest?.name;
    const password = options.guest?.password;
    if (
      typeof password !== "string" ||
      password.length < 4 ||
      password.length > 64
    )
      ctx.fail("ACCESS_DENIED", "비밀번호를 확인해 주세요. (4~64자)", {
        reason: "guest_password",
      });
    // The post keeps the password as its write secret (SDK 1.1.0): Naru
    // stores a hash nobody can read and checks it here.
    if (previous) {
      if (
        !previous.data.guest ||
        !(await ctx.secretMatches(collection, previous.id, password))
      )
        ctx.fail("ACCESS_DENIED", "비밀번호를 확인해 주세요. (4~64자)", {
          reason: "guest_password",
        });
      guest = { name: previous.data.guest.name, secret: password };
    } else {
      if (typeof name !== "string" || !name.trim() || name.length > 20)
        ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
          reason: "invalid_input",
        });
      guest = { name: name.trim(), secret: password };
    }
    if (data) {
      data = { ...data };
      delete data.character;
    }
  } else if (
    previous &&
    author(previous) !== ctx.member.id &&
    !(access.role === "moderator" && ["logs", "comments"].includes(kind))
  )
    ctx.fail("ACCESS_DENIED", "내가 가진 아이템이 아닙니다.", {
      reason: "not_owned",
    });
  if (
    options.condition?.revision &&
    previous?.revision !== options.condition.revision
  )
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
  if (options.condition?.absent && previous)
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
  if (operation === "delete")
    return await deleteCommunityDocument(ctx, collection, kind, previous);
  if (previous?.data.deleted)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  if (
    kind === "logs" &&
    !boardAllowed(
      await boardOf(ctx, previous?.data.board ?? data?.board ?? "default"),
      access,
      "write",
    )
  )
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  let value = {
    ...previous?.data,
    owner: previous ? author(previous) : (ctx.member?.id ?? null),
  };
  if (guest) value.guest = { name: guest.name };
  if (kind === "profiles")
    value = {
      ...value,
      nick: text(data.nick, 20, true),
      acceptMessages: data.acceptMessages !== false,
      commentAlerts: data.commentAlerts !== false,
    };
  let catalogue = null;
  if (kind === "characters") {
    const sheet = await memberSheet(ctx, previous, data);
    catalogue = sheet.catalogue;
    value = {
      ...value,
      name: text(data.name, 40, true),
      side: text(data.side ?? "", 40),
      profile: text(data.profile ?? "", 4000),
      type: sheet.type,
      state: sheet.state,
      fields: sheet.fields,
    };
    delete value.fieldMedia;
    if (data.image !== previous?.data.image)
      value.image = data.image ? imageUrl(data.image) : null;
  }
  // Posting as a character, dice and calls (skin/board/mmb). The speaker and
  // the dice are fixed when a post is made; edits keep them.
  let speaker = previous?.data.speaker ?? null;
  let calls = null;
  let board = null;
  let parent = null;
  if (kind === "logs") {
    const boardId = previous?.data.board ?? data.board ?? "default";
    board = await boardOf(ctx, boardId);
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
    if (
      value.category &&
      !(board.data.categories ?? []).includes(value.category)
    )
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
  }
  if (kind === "comments") {
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
      if (value.dice) value.rolls = rollDice(ctx);
      const actions = [];
      if (data.action === "explore") actions.push(await explore(ctx, speaker));
      if (data.action === "combine")
        actions.push(await combineInPost(ctx, data.materials, speaker));
      if (data.item !== undefined)
        actions.push(await useInPost(ctx, data.item, speaker));
      if (actions.length) value.actions = actions;
    }
    parent = log;
  }
  // Uploads are managed (SDK 1.1.0): a document that names one keeps it.
  delete value.imageId;
  const document =
    operation === "add"
      ? await ctx.add(collection, value, guest ? { secret: guest.secret } : {})
      : await ctx.set(collection, id, value);
  if (kind === "logs" && operation === "add") await announcePost(ctx, document);
  if (calls && ["logs", "comments"].includes(kind))
    await deliverCalls(ctx, {
      log: kind === "logs" ? document : parent,
      comment: kind === "comments" ? document : null,
      text: document.data.text,
      speaker,
      recipients: calls.recipients,
      notifyAuthor: kind === "comments" && operation === "add",
      guest: guest?.name ?? null,
    });
  return {
    document:
      kind === "characters"
        ? await presentCharacter(ctx, document, { catalogue })
        : document,
  };
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
