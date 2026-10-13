import {
  PREFIX,
  BOARDS,
  saveImage,
  communityAccess,
  READ_LIMITS,
  author,
  boardOf,
  boardAllowed,
  logReadable,
  deleteCommunityDocument,
  text,
  imageUrl,
  failure,
} from "../../modules/shared.js";

/** Native collection permissions must be admin/admin. This gate owns app authorization. */
export function communityData(
  ctx,
  { collection, operation, id, data, options = {} } = {},
) {
  const access = communityAccess(ctx);
  const kind =
    typeof collection === "string" && collection.startsWith(PREFIX)
      ? collection.slice(PREFIX.length)
      : "";
  if (!Object.hasOwn(READ_LIMITS, kind)) return failure("access_denied");
  if (operation === "getMany") {
    if (!["profiles", "items"].includes(kind)) return failure("access_denied");
    if (
      !Array.isArray(options.ids) ||
      options.ids.length > 50 ||
      options.ids.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id),
      )
    )
      return failure("invalid_input");
    return {
      ok: true,
      documents: ctx
        .getMany(collection, options.ids)
        .map((row) => (row?.data.deleted ? null : row)),
    };
  }
  if (operation === "list") {
    const query = {
      filter: options.filter,
      sort: options.sort,
      size: Math.min(options.size ?? READ_LIMITS[kind], READ_LIMITS[kind]),
      after: options.after ?? null,
    };
    if (["wallets", "character_state", "settings"].includes(kind))
      return failure("access_denied");
    if (kind === "inventory")
      query.filter = { ...query.filter, owner: ctx.member.id };
    if (kind === "logs") {
      const selected = options.board ?? query.filter?.board ?? "default";
      const board = boardOf(ctx, selected);
      if (!boardAllowed(board, access, "list")) return failure("access_denied");
      query.filter = { ...query.filter, board: selected };
    }
    if (kind === "comments") {
      const logId = query.filter?.logId;
      const log =
        typeof logId === "string" ? ctx.get(`${PREFIX}logs`, logId) : null;
      if (!logReadable(ctx, log, access)) return failure("document_not_found");
    }
    const page = ctx.list(collection, query);
    let documents = page.documents.filter((row) => !row.data.deleted);
    if (kind === "boards") {
      documents = documents.filter((row) => boardAllowed(row, access, "list"));
      if (!options.after && !ctx.get(BOARDS, "default"))
        documents.unshift(boardOf(ctx));
    }
    if (kind === "logs")
      documents = documents.map((row) =>
        logReadable(ctx, row, access)
          ? {
              ...row,
              data: {
                owner: author(row),
                board: row.data.board,
                title: row.data.title ?? "",
                category: row.data.category ?? "",
                image: row.data.image ?? null,
                secret: row.data.secret === true,
                text: (row.data.text ?? "").slice(0, 150),
                truncated: (row.data.text ?? "").length > 150,
              },
            }
          : {
              id: row.id,
              createdAt: row.createdAt,
              createdBy: row.createdBy,
              data: {
                owner: author(row),
                title: row.data.title ?? "비밀글",
                locked: true,
                secret: Boolean(row.data.secret),
              },
            },
      );
    return {
      ok: true,
      ...page,
      documents,
    };
  }
  const previous =
    typeof id === "string"
      ? kind === "boards"
        ? boardOf(ctx, id)
        : ctx.get(collection, id)
      : null;
  if (operation === "get") {
    if (!previous || previous.data.deleted)
      return failure("document_not_found");
    if (kind === "boards" && !boardAllowed(previous, access, "list"))
      return failure("access_denied");
    if (kind === "logs" && !logReadable(ctx, previous, access))
      return failure("access_denied");
    if (kind === "comments") {
      const log = ctx.get(`${PREFIX}logs`, previous.data.logId);
      if (!logReadable(ctx, log, access)) return failure("document_not_found");
    }
    if (
      (kind === "wallets" && id !== ctx.member.id) ||
      (kind === "inventory" && previous.data.owner !== ctx.member.id)
    )
      return failure("access_denied");
    if (kind === "settings")
      return id === "community"
        ? {
            ok: true,
            document: {
              ...previous,
              data: {
                initialStatPoints: previous.data.initialStatPoints ?? 0,
                messageCost: previous.data.messageCost ?? 0,
              },
            },
          }
        : failure("access_denied");
    if (kind === "character_state") {
      const { purchases, ...publicState } = previous.data;
      return { ok: true, document: { ...previous, data: publicState } };
    }
    return { ok: true, document: previous };
  }
  if (
    !["profiles", "characters", "logs", "comments"].includes(kind) ||
    !["add", "set", "delete"].includes(operation)
  )
    return failure("access_denied");
  if (kind === "profiles" && (operation !== "set" || id !== ctx.member.id))
    return failure("access_denied");
  if (operation !== "add" && !previous) return failure("document_not_found");
  if (
    previous &&
    author(previous) !== ctx.member.id &&
    !(access.role === "moderator" && ["logs", "comments"].includes(kind))
  )
    return failure("not_owned");
  if (
    options.condition?.revision &&
    previous?.revision !== options.condition.revision
  )
    return failure("conflict");
  if (options.condition?.absent && previous) return failure("conflict");
  if (operation === "delete")
    return deleteCommunityDocument(ctx, collection, kind, previous);
  if (previous?.data.deleted) return failure("document_not_found");
  if (
    kind === "logs" &&
    !boardAllowed(
      boardOf(ctx, previous?.data.board ?? data?.board ?? "default"),
      access,
      "write",
    )
  )
    return failure("access_denied");
  let value = {
    ...previous?.data,
    owner: previous ? author(previous) : ctx.member.id,
  };
  if (kind === "profiles")
    value = {
      ...value,
      nick: text(data.nick, 20, true),
      acceptMessages: data.acceptMessages !== false,
    };
  if (kind === "characters") {
    value = {
      ...value,
      name: text(data.name, 40, true),
      side: text(data.side ?? "", 40),
      profile: text(data.profile ?? "", 4000),
    };
    if (data.image !== previous?.data.image)
      value.image = data.image ? imageUrl(data.image) : null;
  }
  if (kind === "logs") {
    const boardId = previous?.data.board ?? data.board ?? "default";
    const board = boardOf(ctx, boardId);
    const secret =
      board.data.secret === "required" ||
      (Object.hasOwn(data, "secret")
        ? data.secret === true
        : Boolean(previous?.data.secret));
    if (secret && board.data.secret === "off" && !previous?.data.secret)
      return failure("invalid_input");
    value.board = boardId;
    value.secret = secret;
    value.title = text(data.title ?? previous?.data.title ?? "", 120);
    value.category = text(data.category ?? previous?.data.category ?? "", 40);
    if (
      value.category &&
      !(board.data.categories ?? []).includes(value.category)
    )
      return failure("invalid_input");
    value.text = text(data.text ?? "", 2000);
    value.image =
      data.image === previous?.data.image
        ? data.image
        : data.image
          ? imageUrl(data.image)
          : null;
    if (board.data.kind === "image" && !value.image)
      return failure("invalid_input");
    if (!value.image && !value.text) return failure("invalid_input");
  }
  if (kind === "comments") {
    const logId = previous?.data.logId ?? data.logId;
    const log =
      typeof logId === "string" ? ctx.get(`${PREFIX}logs`, logId) : null;
    if (!logReadable(ctx, log, access)) return failure("document_not_found");
    if (
      !boardAllowed(
        boardOf(ctx, log.data.board ?? "default"),
        access,
        "comment",
      )
    )
      return failure("access_denied");
    value = {
      ...value,
      logId,
      text: text(data.text ?? "", 500),
      dice: previous?.data.dice ?? data.dice === true,
    };
    if (!value.text && !value.dice) return failure("invalid_input");
  }
  return {
    ok: true,
    mediaCleanup: Boolean(
      previous?.data.imageId &&
      (data.imageId !== undefined
        ? data.imageId !== previous.data.imageId
        : value.image !== previous.data.image),
    ),
    document: ["logs", "characters"].includes(kind)
      ? saveImage(
          ctx,
          collection,
          previous,
          value,
          data,
          operation === "add" ? undefined : id,
        )
      : operation === "add"
        ? ctx.add(collection, value)
        : ctx.set(collection, id, value),
  };
}
