// 네오 아보카도의 서버 함수. 나루가 이 파일을 회원의 브라우저가 아니라 서버에서,
// 한 트랜잭션 안에서 돌린다. 함수가 오류를 내면 그동안 쓴 것은 모두 없던 일이
// 된다. 페이지는 member.call("neo-avocado/<함수>", 인자)로 부른다.
//
// 여기서 쓰는 지갑·인벤토리·상점·뽑기 컬렉션은 쓰기가 ‘관리자만’이라 회원이
// 직접 고칠 수 없고, 이 함수들만 바꾼다. 함수가 쓴 문서에는 회원 작성자가
// 붙지 않는다.
const PREFIX = "neo_avocado_";
const WALLETS = `${PREFIX}wallets`;
const INVENTORY = `${PREFIX}inventory`;
const ITEMS = `${PREFIX}items`;
const GACHA = `${PREFIX}gacha`;
const PROFILES = `${PREFIX}profiles`;
const RECIPES = `${PREFIX}recipes`;
const CHARACTERS = `${PREFIX}characters`;
const RELATIONS = `${PREFIX}relations`;
const WARDROBE = `${PREFIX}wardrobe`;
const CHARACTER_STATE = `${PREFIX}character_state`;
const STAT_CONFIG = `${PREFIX}stat_config`;
const SETTINGS = `${PREFIX}settings`;
const LEVELS = `${PREFIX}levels`;
const TITLES = `${PREFIX}titles`;
const HISTORY = `${PREFIX}history`;
const MESSAGES = `${PREFIX}messages`;
const MEMBERS = `${PREFIX}members`;
const BOARDS = `${PREFIX}boards`;

// Naru rejects pending and banned callers before entering any site function.
// This collection contains only application roles and board levels.
function communityAccess(ctx, id = ctx.member.id) {
  const row = ctx.get(MEMBERS, id);
  return {
    level:
      Number.isInteger(row?.data.level) &&
      row.data.level >= 1 &&
      row.data.level <= 10
        ? row.data.level
        : 2,
    role: row?.data.role === "moderator" ? "moderator" : "member",
  };
}
export function membership(ctx) {
  const access = communityAccess(ctx);
  return {
    ok: true,
    ...access,
    memberId: ctx.member.id,
    profile: ctx.get(PROFILES, ctx.member.id),
  };
}
export function join(ctx, { nick, acceptMessages = true } = {}) {
  const access = communityAccess(ctx);
  const old = ctx.get(PROFILES, ctx.member.id);
  const profile = ctx.set(PROFILES, ctx.member.id, {
    ...old?.data,
    owner: ctx.member.id,
    nick: text(nick, 20, true),
    acceptMessages: acceptMessages !== false,
  });
  if (!ctx.get(MEMBERS, ctx.member.id))
    ctx.set(MEMBERS, ctx.member.id, {
      role: "member",
      requestedAt: ctx.now,
    });
  return { ok: true, profile, ...access };
}

const READ_LIMITS = {
  boards: 5,
  profiles: 100,
  characters: 10,
  logs: 10,
  comments: 20,
  wallets: 1,
  inventory: 50,
  items: 10,
  recipes: 10,
  relations: 10,
  wardrobe: 20,
  character_state: 5,
  titles: 10,
  couples: 100,
  settings: 1,
  gacha: 100,
};
function author(row) {
  return row?.createdBy ?? row?.data.owner;
}
function boardOf(ctx, id = "default") {
  const found = typeof id === "string" ? ctx.get(BOARDS, id) : null;
  if (found) return found;
  return id === "default"
    ? {
        id,
        data: {
          name: "로그",
          description: "",
          kind: "image",
          listLevel: 2,
          readLevel: 2,
          writeLevel: 2,
          commentLevel: 2,
          secret: "optional",
          categories: [],
          enabled: true,
        },
      }
    : null;
}
function boardAllowed(board, access, action) {
  if (!board) return false;
  if (access.role === "moderator")
    return (
      action === "read" || action === "list" || board.data.enabled !== false
    );
  return (
    board.data.enabled !== false &&
    access.level >= (board.data[`${action}Level`] ?? 2)
  );
}
function logReadable(ctx, row, access) {
  return (
    row &&
    !row.data.deleted &&
    boardAllowed(boardOf(ctx, row.data.board ?? "default"), access, "read") &&
    (!row.data.secret ||
      author(row) === ctx.member.id ||
      access.role === "moderator")
  );
}

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
    document:
      operation === "add"
        ? ctx.add(collection, value)
        : ctx.set(collection, id, value),
  };
}

function deleteCommunityDocument(ctx, collection, kind, row) {
  if (!["logs", "characters"].includes(kind)) {
    ctx.delete(collection, row.id);
    return { ok: true, done: true };
  }
  if (!row.data.deleted)
    ctx.set(collection, row.id, { ...row.data, deleted: true });
  let unfinished = false;
  let remaining = 20;
  const remove = (target, filter, detach = false) => {
    if (remaining === 0) {
      unfinished = true;
      return;
    }
    const page = ctx.list(target, { filter, size: Math.min(5, remaining) });
    unfinished ||= Boolean(page.nextCursor);
    for (const child of page.documents) {
      remaining--;
      if (detach) ctx.set(target, child.id, { ...child.data, character: null });
      else ctx.delete(target, child.id);
    }
  };
  if (kind === "logs") remove(`${PREFIX}comments`, { logId: row.id });
  else {
    remove(RELATIONS, { character: row.id });
    remove(RELATIONS, { target: row.id });
    remove(WARDROBE, { character: row.id });
    remove(INVENTORY, { character: row.id }, true);
    remove(`${PREFIX}couples`, { first: row.id });
    remove(`${PREFIX}couples`, { second: row.id });
    if (ctx.get(CHARACTER_STATE, row.id)) ctx.delete(CHARACTER_STATE, row.id);
    const profile = ctx.get(PROFILES, author(row));
    if (profile?.data.mainCharacter === row.id)
      ctx.set(PROFILES, profile.id, { ...profile.data, mainCharacter: null });
  }
  if (!unfinished) ctx.delete(collection, row.id);
  return { ok: true, done: !unfinished };
}

/** Message storage is admin-only; every public operation checks the parties. */
export function sendMessage(ctx, { recipients, body } = {}) {
  if (
    !Array.isArray(recipients) ||
    !recipients.length ||
    recipients.length > 20 ||
    recipients.some((id) => typeof id !== "string") ||
    new Set(recipients).size !== recipients.length
  )
    return failure("invalid_recipients");
  const message = text(body, 5000, true);
  if (!ctx.get(PROFILES, ctx.member.id)) return failure("no_profile");
  for (const id of recipients) {
    const recipient = ctx.get(PROFILES, id);
    if (
      id === ctx.member.id ||
      !recipient ||
      recipient.data.acceptMessages === false
    )
      return failure("no_recipient");
  }
  const cost = amount(
    ctx.get(SETTINGS, "community")?.data.messageCost ?? 0,
    "Message cost",
  );
  const total = cost * recipients.length;
  if (!Number.isSafeInteger(total)) throw new Error("Message cost overflow.");
  const current = wallet(ctx);
  if (current.balance < total) return failure("not_enough");
  const balance = cost ? pay(ctx, current, total) : current.balance;
  const ids = recipients.map(
    (to) =>
      ctx.add(MESSAGES, {
        from: ctx.member.id,
        to,
        body: message,
        sentAt: ctx.now,
        readAt: null,
      }).id,
  );
  if (cost) record(ctx, "message", { recipients, delta: -total, balance });
  return { ok: true, ids, balance };
}

export function mailbox(ctx, { box = "inbox", after = null, size = 20 } = {}) {
  if (
    !["inbox", "sent"].includes(box) ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string")
  )
    return failure("invalid_input");
  const page = ctx.list(MESSAGES, {
    filter: { [box === "inbox" ? "to" : "from"]: ctx.member.id },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size,
    after,
  });
  return {
    ok: true,
    unread: messageStatus(ctx).unread,
    nextCursor: page.nextCursor,
    documents: page.documents.map((row) => ({
      id: row.id,
      data: {
        from: row.data.from,
        to: row.data.to,
        preview: row.data.body.slice(0, 150),
        sentAt: row.data.sentAt,
        readAt: row.data.readAt,
      },
    })),
  };
}

export function readMessage(ctx, { id } = {}) {
  let message = typeof id === "string" ? ctx.get(MESSAGES, id) : null;
  if (
    !message ||
    (message.data.from !== ctx.member.id && message.data.to !== ctx.member.id)
  )
    return failure("message_not_found");
  if (message.data.to === ctx.member.id && message.data.readAt === null)
    message = ctx.set(MESSAGES, message.id, {
      ...message.data,
      readAt: ctx.now,
    });
  return { ok: true, document: message, unread: messageStatus(ctx).unread };
}

export function removeMessage(ctx, { id } = {}) {
  const message = typeof id === "string" ? ctx.get(MESSAGES, id) : null;
  if (
    !message ||
    (message.data.from !== ctx.member.id && message.data.to !== ctx.member.id)
  )
    return failure("message_not_found");
  ctx.delete(MESSAGES, message.id);
  return { ok: true };
}

export function messageStatus(ctx) {
  const page = ctx.list(MESSAGES, {
    filter: { to: ctx.member.id, readAt: null },
    size: 1,
  });
  return { ok: true, unread: page.documents.length > 0 };
}

function record(ctx, kind, details, owner = ctx.member.id) {
  ctx.add(HISTORY, { owner, kind, at: ctx.now, ...details });
}
export function history(ctx, { after = null, size = 20 } = {}) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 20 ||
    (after !== null && typeof after !== "string")
  )
    return failure("invalid_input");
  return {
    ok: true,
    ...ctx.list(HISTORY, {
      filter: { owner: ctx.member.id },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size,
      after,
    }),
  };
}

function ownCharacter(ctx, id) {
  const character = typeof id === "string" ? ctx.get(CHARACTERS, id) : null;
  return character &&
    (character.createdBy ?? character.data.owner) === ctx.member.id &&
    !character.data.deleted
    ? character
    : null;
}
function text(value, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error("Invalid text input.");
  return value.trim();
}
function imageUrl(value) {
  const url = text(value, 2000, true);
  // QuickJS has no URL constructor. Browser images must use HTTPS, with no
  // credentials, whitespace, data payloads or script schemes.
  if (!/^https:\/\/[^\s/@?#:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(url))
    throw new Error("An image must have an HTTPS address.");
  return url;
}

const failure = (reason) => ({ ok: false, reason });
function amount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}
function weightedRows(ctx, collection, filter) {
  const rows = [];
  let after = null;
  do {
    const page = ctx.list(collection, { size: 100, after, filter });
    rows.push(...page.documents);
    after = page.nextCursor;
    if (rows.length > 2000)
      throw new Error("A draw table may contain at most 2000 entries.");
  } while (after);
  return rows;
}

/** 출석 보상과 뽑기 한 번의 값. */
export const DAILY_REWARD = 100;
export const GACHA_COST = 50;

const kstDay = (now) =>
  new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

function wallet(ctx) {
  const found = ctx.get(WALLETS, ctx.member.id);
  const current = found ? found.data : { balance: 0, lastDaily: null };
  amount(current.balance, "Balance");
  return current;
}
function pay(ctx, current, amount, changes = {}) {
  const balance = current.balance - amount;
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error("Balance is outside its allowed range.");
  ctx.set(WALLETS, ctx.member.id, {
    ...current,
    ...changes,
    balance,
  });
  return balance;
}
function give(ctx, item, from, character = null) {
  return ctx.add(INVENTORY, {
    owner: ctx.member.id,
    item: item.id,
    name: item.data.name,
    from,
    ...(character ? { character } : {}),
  });
}

/** 하루 한 번, 한국 시간으로 날이 바뀌면 받는 출석 보상. */
export function daily(ctx) {
  const current = wallet(ctx);
  const today = kstDay(ctx.now);
  if (current.lastDaily === today) return { ok: false, reason: "already" };
  const balance = pay(ctx, current, -DAILY_REWARD, { lastDaily: today });
  record(ctx, "daily", { delta: DAILY_REWARD, balance });
  return { ok: true, balance };
}

/** 상점에서 하나 산다. 재고(stock)가 없으면 무제한이다. */
export function buy(ctx, { item, character = null, materials = [] } = {}) {
  const listing = typeof item === "string" ? ctx.get(ITEMS, item) : null;
  if (!listing || listing.data.hidden) return { ok: false, reason: "no_item" };
  const { price = 0, stock } = listing.data;
  amount(price, "Price");
  if (stock !== undefined) amount(stock, "Stock");
  if (typeof stock === "number" && stock < 1)
    return { ok: false, reason: "sold_out" };
  const current = wallet(ctx);
  if (current.balance < price) return { ok: false, reason: "not_enough" };
  const requirements = listing.data.requirements ?? {};
  const needsCharacter =
    character ||
    requirements.approved ||
    requirements.sides?.length ||
    requirements.classes?.length ||
    requirements.exp ||
    requirements.title;
  const ownedCharacter = needsCharacter ? ownCharacter(ctx, character) : null;
  if (needsCharacter && !ownedCharacter) return failure("no_character");
  const progression = ownedCharacter ? characterState(ctx, character) : null;
  if (requirements.approved && progression.data.approved !== true)
    return failure("not_approved");
  for (const [key, field] of [
    ["sides", "side"],
    ["classes", "class"],
  ]) {
    if (
      requirements[key] !== undefined &&
      (!Array.isArray(requirements[key]) ||
        requirements[key].some((value) => typeof value !== "string"))
    )
      throw new Error(
        "Shop character restrictions must be lists of identifiers.",
      );
    if (
      requirements[key]?.length &&
      !requirements[key].includes(progression.data[field])
    )
      return failure("restricted_character");
  }
  const expPrice = amount(requirements.exp ?? 0, "Required experience");
  if (expPrice && progression.data.exp < expPrice)
    return failure("not_enough_exp");
  if (
    requirements.title &&
    !progression.data.titles?.includes(requirements.title)
  )
    return failure("missing_title");
  const counts = {
    ...(progression ? progression.data.purchases : current.purchases),
  };
  const previous = amount(
    Object.hasOwn(counts, listing.id) ? counts[listing.id] : 0,
    "Purchase count",
  );
  if (
    requirements.limit !== undefined &&
    previous >= amount(requirements.limit, "Purchase limit")
  )
    return failure("purchase_limit");
  if (previous === Number.MAX_SAFE_INTEGER)
    throw new Error("Purchase count overflow.");
  Object.defineProperty(counts, listing.id, {
    value: previous + 1,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const exchanges = requirements.items ?? [];
  if (
    !Array.isArray(exchanges) ||
    !Array.isArray(materials) ||
    materials.length > 18 ||
    new Set(materials).size !== materials.length ||
    materials.some((id) => typeof id !== "string")
  )
    return failure("invalid_materials");
  const needed = new Map();
  for (const exchange of exchanges) {
    if (typeof exchange.item !== "string" || needed.has(exchange.item))
      throw new Error("Exchange items must have unique identifiers.");
    const count = amount(exchange.count, "Exchange count");
    if (!count) throw new Error("Exchange count must be positive.");
    needed.set(exchange.item, { count, consume: exchange.consume === true });
  }
  const supplied = materials.map((id) => ownedItem(ctx, id));
  if (
    supplied.some((row) => !row || (row.data.character ?? null) !== character)
  )
    return failure("not_owned");
  const provided = new Map();
  for (const row of supplied)
    provided.set(row.data.item, (provided.get(row.data.item) ?? 0) + 1);
  if (
    provided.size !== needed.size ||
    [...needed].some(([id, rule]) => provided.get(id) !== rule.count)
  )
    return failure("invalid_materials");
  const debit = requirements.consumeMoney === false ? 0 : price;
  const balance = pay(
    ctx,
    current,
    debit,
    progression ? {} : { purchases: counts },
  );
  if (progression) {
    const next = { ...progression.data, purchases: counts };
    if (requirements.consumeExp) next.exp -= expPrice;
    if (requirements.consumeTitle && requirements.title) {
      next.titles = next.titles.filter((id) => id !== requirements.title);
      if (next.activeTitle === requirements.title) next.activeTitle = null;
    }
    ctx.set(CHARACTER_STATE, character, next);
  }
  for (const row of supplied)
    if (needed.get(row.data.item).consume) ctx.delete(INVENTORY, row.id);
  if (typeof stock === "number")
    ctx.set(ITEMS, listing.id, { ...listing.data, stock: stock - 1 });
  const owned = give(ctx, listing, "shop", character);
  record(ctx, "buy", {
    character,
    item: listing.id,
    inventory: owned.id,
    delta: -debit,
    balance,
    expDelta: requirements.consumeExp ? -expPrice : 0,
  });
  return { ok: true, balance, owned };
}

/**
 * 뽑기 한 번. 뽑기 컬렉션의 항목마다 무게(weight)가 있고, 무게에 비례해
 * 하나가 나온다. 주사위는 서버가 굴린다.
 */
function draw(ctx, source = null) {
  const table = weightedRows(
    ctx,
    GACHA,
    source ? { source } : undefined,
  ).filter((row) => {
    if ((row.data.source ?? null) !== source) return false;
    if (
      typeof row.data.weight !== "number" ||
      !Number.isFinite(row.data.weight) ||
      row.data.weight < 0
    )
      throw new Error("Draw weights must be finite non-negative numbers.");
    return row.data.weight > 0;
  });
  if (!table.length) return { configured: false, prize: null };
  const total = table.reduce((sum, row) => sum + row.data.weight, 0);
  if (!Number.isFinite(total)) throw new Error("Draw weights are too large.");
  let roll = ctx.random() * total;
  const won =
    table.find((row) => (roll -= row.data.weight) < 0) ?? table.at(-1);
  if (won.data.item === null) return { configured: true, prize: null };
  const prize =
    typeof won.data.item === "string" ? ctx.get(ITEMS, won.data.item) : null;
  if (!prize)
    throw new Error(`뽑기의 아이템 ${won.data.item}이 상점에 없습니다.`);
  return { configured: true, prize };
}

export function gacha(ctx, args = {}) {
  const { character = null } = args ?? {};
  if (character && !ownCharacter(ctx, character))
    return failure("no_character");
  const current = wallet(ctx);
  if (current.balance < GACHA_COST) return failure("not_enough");
  const result = draw(ctx);
  if (!result.configured) return failure("empty");
  const balance = pay(ctx, current, GACHA_COST);
  const owned = result.prize
    ? give(ctx, result.prize, "gacha", character)
    : null;
  record(ctx, "gacha", {
    character,
    item: result.prize?.id ?? null,
    delta: -GACHA_COST,
    balance,
  });
  return {
    ok: true,
    balance,
    owned,
  };
}

function ownedItem(ctx, id) {
  const owned = typeof id === "string" ? ctx.get(INVENTORY, id) : null;
  return owned?.data.owner === ctx.member.id ? owned : null;
}

/** Selling consumes exactly one owned item; prices always come from the catalog. */
export function sell(ctx, { inventory } = {}) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  const item = ctx.get(ITEMS, owned.data.item);
  if (
    !item ||
    item.data.sellPrice === undefined ||
    item.data.sellable === false
  )
    return failure("not_sellable");
  const price = amount(item.data.sellPrice, "Sale price");
  const balance = pay(ctx, wallet(ctx), -price);
  ctx.delete(INVENTORY, owned.id);
  record(ctx, "sell", {
    character: owned.data.character ?? null,
    item: owned.data.item,
    inventory: owned.id,
    delta: price,
    balance,
  });
  return { ok: true, balance, name: owned.data.name };
}

/** The recipient must be an existing member profile, never a browser-supplied owner. */
export function gift(
  ctx,
  { inventory, recipient, character = null, memo = "" } = {},
) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  if (
    typeof recipient !== "string" ||
    recipient === ctx.member.id ||
    !ctx.get(PROFILES, recipient)
  )
    return failure("no_recipient");
  if (typeof memo !== "string" || memo.length > 500)
    return failure("invalid_input");
  const item = ctx.get(ITEMS, owned.data.item);
  if (!item || item.data.giftable === false) return failure("not_giftable");
  const target =
    typeof character === "string" ? ctx.get(CHARACTERS, character) : null;
  if (
    character &&
    (!target ||
      target.data.deleted ||
      (target.createdBy ?? target.data.owner) !== recipient)
  )
    return failure("no_character");
  if (owned.data.character && !target) return failure("no_character");
  const transferred = ctx.set(INVENTORY, owned.id, {
    ...owned.data,
    owner: recipient,
    sender: ctx.member.id,
    memo,
    receivedAt: ctx.now,
    character,
  });
  record(ctx, "gift", {
    item: owned.data.item,
    inventory: owned.id,
    recipient,
    character,
    memo,
  });
  record(
    ctx,
    "giftReceived",
    {
      item: owned.data.item,
      inventory: owned.id,
      sender: ctx.member.id,
      character,
      memo,
    },
    recipient,
  );
  return { ok: true, owned: transferred };
}

/** Selected materials are checked against the owner's recipe, then consumed atomically. */
export function craft(ctx, { recipe, materials, character = null } = {}) {
  if (character && !ownCharacter(ctx, character))
    return failure("no_character");
  const row = typeof recipe === "string" ? ctx.get(RECIPES, recipe) : null;
  if (!row || row.data.hidden) return failure("no_recipe");
  if (
    !Array.isArray(materials) ||
    materials.length > 20 ||
    materials.some((id) => typeof id !== "string") ||
    new Set(materials).size !== materials.length
  )
    return failure("invalid_materials");
  const ingredients = row.data.ingredients;
  if (
    !Array.isArray(ingredients) ||
    !ingredients.length ||
    ingredients.length > 20
  )
    throw new Error("Recipe ingredients must be a non-empty list.");
  const required = new Map();
  for (const ingredient of ingredients) {
    if (typeof ingredient.item !== "string")
      throw new Error("Recipe item is missing.");
    const count = amount(ingredient.count, "Ingredient count");
    if (!count) throw new Error("Ingredient count must be positive.");
    required.set(ingredient.item, (required.get(ingredient.item) ?? 0) + count);
  }
  const owned = materials.map((id) => ownedItem(ctx, id));
  if (
    owned.some((item) => !item || (item.data.character ?? null) !== character)
  )
    return failure("not_owned");
  const provided = new Map();
  for (const item of owned)
    provided.set(item.data.item, (provided.get(item.data.item) ?? 0) + 1);
  if (
    provided.size !== required.size ||
    [...required].some(([item, count]) => provided.get(item) !== count)
  )
    return failure("invalid_materials");
  const prize =
    typeof row.data.item === "string" ? ctx.get(ITEMS, row.data.item) : null;
  if (!prize) throw new Error("Recipe output item is missing.");
  const cost = amount(row.data.cost ?? 0, "Crafting cost");
  const current = wallet(ctx);
  if (current.balance < cost) return failure("not_enough");
  const balance = pay(ctx, current, cost);
  for (const item of owned) ctx.delete(INVENTORY, item.id);
  const output = give(ctx, prize, "craft", character);
  record(ctx, "craft", { character, item: prize.id, delta: -cost, balance });
  return { ok: true, balance, owned: output };
}

export function assignInventory(ctx, { inventory, character = null } = {}) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  if (character && !ownCharacter(ctx, character))
    return failure("no_character");
  return {
    ok: true,
    document: ctx.set(INVENTORY, owned.id, { ...owned.data, character }),
  };
}

export function equipTitle(ctx, { character, title = null } = {}) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const state = characterState(ctx, character);
  if (
    title !== null &&
    (typeof title !== "string" ||
      !state.data.titles?.includes(title) ||
      !ctx.get(TITLES, title))
  )
    return failure("missing_title");
  return {
    ok: true,
    document: ctx.set(CHARACTER_STATE, character, {
      ...state.data,
      activeTitle: title,
    }),
  };
}

/** A relation belongs to the source character; the target's owner cannot edit it. */
export function relation(
  ctx,
  {
    id,
    character,
    target,
    affinity = 0,
    memo = "",
    link = "",
    order = 0,
    revision,
  } = {},
) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const targetCharacter =
    typeof target === "string" ? ctx.get(CHARACTERS, target) : null;
  if (
    typeof target !== "string" ||
    target === character ||
    !targetCharacter ||
    targetCharacter.data.deleted
  )
    return failure("no_character");
  if (!Number.isInteger(affinity) || affinity < -100 || affinity > 100)
    return failure("invalid_input");
  amount(order, "Relation order");
  const previous = id ? ctx.get(RELATIONS, id) : null;
  if (
    id &&
    (!previous ||
      previous.data.owner !== ctx.member.id ||
      previous.data.character !== character)
  )
    return failure("not_owned");
  if (previous && previous.revision !== revision) return failure("conflict");
  const data = {
    owner: ctx.member.id,
    character,
    target,
    affinity,
    memo: text(memo, 2000),
    link: link ? imageUrl(link) : "",
    order,
  };
  return {
    ok: true,
    document: previous
      ? ctx.set(RELATIONS, id, data)
      : ctx.add(RELATIONS, data),
  };
}

export function removeRelation(ctx, { id } = {}) {
  const row = typeof id === "string" ? ctx.get(RELATIONS, id) : null;
  if (
    !row ||
    row.data.owner !== ctx.member.id ||
    !ownCharacter(ctx, row.data.character)
  )
    return failure("not_owned");
  ctx.delete(RELATIONS, row.id);
  return { ok: true };
}

export function outfit(ctx, { character, name, image } = {}) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const document = ctx.add(WARDROBE, {
    owner: ctx.member.id,
    character,
    name: text(name, 80, true),
    image: imageUrl(image),
  });
  return { ok: true, document };
}

export function wear(ctx, { character, outfit } = {}) {
  const owned = ownCharacter(ctx, character);
  if (!owned) return failure("not_owned");
  const clothing =
    typeof outfit === "string" ? ctx.get(WARDROBE, outfit) : null;
  if (
    outfit !== null &&
    (!clothing ||
      clothing.data.owner !== ctx.member.id ||
      clothing.data.character !== character)
  )
    return failure("not_owned");
  const document = ctx.set(CHARACTERS, owned.id, {
    ...owned.data,
    outfit: clothing?.id ?? null,
  });
  return { ok: true, document };
}

export function removeOutfit(ctx, { id } = {}) {
  const clothing = typeof id === "string" ? ctx.get(WARDROBE, id) : null;
  if (!clothing || clothing.data.owner !== ctx.member.id)
    return failure("not_owned");
  const character = ownCharacter(ctx, clothing.data.character);
  if (!character) return failure("not_owned");
  if (character.data.outfit === clothing.id) return failure("outfit_in_use");
  ctx.delete(WARDROBE, clothing.id);
  return { ok: true };
}

export function mainCharacter(ctx, { character } = {}) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  const profile = ctx.get(PROFILES, ctx.member.id);
  if (!profile) return failure("no_profile");
  return {
    ok: true,
    document: ctx.set(PROFILES, profile.id, {
      ...profile.data,
      mainCharacter: character,
    }),
  };
}

function characterState(ctx, character, owner = ctx.member.id) {
  const definitions = weightedRows(ctx, STAT_CONFIG);
  if (definitions.length > 20)
    throw new Error("At most 20 stats may be configured.");
  const existing = ctx.get(CHARACTER_STATE, character);
  const current = existing?.data ?? {
    owner,
    character,
    points: amount(
      ctx.get(SETTINGS, "community")?.data.initialStatPoints ?? 0,
      "Initial stat points",
    ),
    exp: 0,
    stats: {},
    titles: [],
  };
  amount(current.points, "Stat points");
  amount(current.exp, "Experience");
  const stats = {};
  for (const definition of definitions) {
    const key = definition.id;
    if (
      !/^[a-z][a-z0-9_]{0,31}$/.test(key) ||
      ["constructor", "prototype"].includes(key)
    )
      throw new Error("Invalid stat identifier.");
    const base = amount(definition.data.initial ?? 0, "Initial stat value");
    const limit = amount(definition.data.max ?? 999, "Stat maximum");
    if (base > limit) throw new Error("Initial stat exceeds maximum.");
    const saved = Object.hasOwn(current.stats, key) ? current.stats[key] : null;
    const allocated = amount(saved?.allocated ?? 0, "Allocated points");
    const max = base + allocated;
    if (!Number.isSafeInteger(max) || max > limit)
      throw new Error("Stat exceeds maximum.");
    const value = amount(saved?.current ?? max, "Current stat");
    if (value > max) throw new Error("Current stat exceeds maximum.");
    const damage = amount(saved?.damage ?? max - value, "Stat damage");
    stats[key] = { allocated, max, damage, current: Math.max(0, max - damage) };
  }
  return { existing, definitions, data: { ...current, stats } };
}

/** Public character progression is separate from member-editable profile fields. */
export function characterStatus(ctx, { character } = {}) {
  const profile =
    typeof character === "string" ? ctx.get(CHARACTERS, character) : null;
  if (!profile || profile.data.deleted) return failure("no_character");
  const state = characterState(
    ctx,
    character,
    profile.createdBy ?? profile.data.owner ?? null,
  );
  const levels = weightedRows(ctx, LEVELS)
    .filter((row) => {
      amount(row.data.exp, "Rank experience");
      return row.data.exp <= state.data.exp;
    })
    .sort((a, b) => b.data.exp - a.data.exp || a.id.localeCompare(b.id));
  return {
    ok: true,
    state: Object.fromEntries(
      Object.entries(state.data).filter(([key]) => key !== "purchases"),
    ),
    revision: state.existing?.revision ?? null,
    definitions: state.definitions,
    rank: levels[0]?.data.name ?? "",
  };
}

export function allocateStats(
  ctx,
  { character, allocation, revision = null } = {},
) {
  if (!ownCharacter(ctx, character)) return failure("not_owned");
  if (
    !allocation ||
    Array.isArray(allocation) ||
    typeof allocation !== "object"
  )
    return failure("invalid_input");
  const state = characterState(ctx, character);
  if ((state.existing?.revision ?? null) !== revision)
    return failure("conflict");
  if (
    Object.keys(allocation).length !== state.definitions.length ||
    state.definitions.some((row) => !Object.hasOwn(allocation, row.id))
  )
    return failure("invalid_input");
  const stats = {};
  let spent = 0;
  for (const definition of state.definitions) {
    const count = amount(allocation[definition.id], "Allocation");
    spent += count;
    const before = state.data.stats[definition.id];
    const max = (definition.data.initial ?? 0) + count;
    if (!Number.isSafeInteger(max) || max > (definition.data.max ?? 999))
      return failure("invalid_input");
    // Reallocation preserves damage, so reducing and raising a stat is not healing.
    const damage = before.damage;
    stats[definition.id] = {
      allocated: count,
      max,
      damage,
      current: Math.max(0, max - damage),
    };
  }
  if (!Number.isSafeInteger(spent) || spent > state.data.points)
    return failure("not_enough_points");
  const document = ctx.set(CHARACTER_STATE, character, {
    ...state.data,
    stats,
  });
  return { ok: true, document };
}

/** Four built-in item actions mirror inventory/use_item.php. */
export function useItem(ctx, { inventory, character, data = {} } = {}) {
  const owned = ownedItem(ctx, inventory);
  if (!owned) return failure("not_owned");
  const item = ctx.get(ITEMS, owned.data.item);
  if (!item?.data.effect || item.data.usable === false)
    return failure("not_usable");
  if (owned.data.character && owned.data.character !== character)
    return failure("wrong_character");
  if (owned.data.character && !ownCharacter(ctx, character))
    return failure("not_owned");
  const requirements = item.data.useRequirements ?? {};
  if (
    requirements.approved ||
    requirements.sides?.length ||
    requirements.classes?.length ||
    requirements.exp ||
    requirements.title
  ) {
    if (!ownCharacter(ctx, character)) return failure("no_character");
    const official = characterState(ctx, character).data;
    if (requirements.approved && official.approved !== true)
      return failure("not_approved");
    for (const [key, field] of [
      ["sides", "side"],
      ["classes", "class"],
    ]) {
      if (
        requirements[key] !== undefined &&
        (!Array.isArray(requirements[key]) ||
          requirements[key].some((value) => typeof value !== "string"))
      )
        throw new Error("Use restrictions must be lists of identifiers.");
      if (
        requirements[key]?.length &&
        !requirements[key].includes(official[field])
      )
        return failure("restricted_character");
    }
    if (official.exp < amount(requirements.exp ?? 0, "Use experience"))
      return failure("not_enough_exp");
    if (requirements.title && !official.titles?.includes(requirements.title))
      return failure("missing_title");
  }
  const effect = item.data.effect;
  let result = { ok: true, name: owned.data.name };
  if (effect.type === "restore") {
    if (!ownCharacter(ctx, character)) return failure("not_owned");
    const state = characterState(ctx, character);
    if (
      typeof effect.stat !== "string" ||
      !Object.hasOwn(state.data.stats, effect.stat)
    )
      throw new Error("Recovery stat does not exist.");
    const recovery = amount(effect.amount, "Recovery amount");
    if (!recovery) throw new Error("Recovery amount must be positive.");
    const stat = state.data.stats[effect.stat];
    if (stat.current === stat.max) return failure("already_full");
    stat.damage = Math.max(0, stat.damage - recovery);
    stat.current = Math.max(0, stat.max - stat.damage);
    result.document = ctx.set(CHARACTER_STATE, character, state.data);
  } else if (effect.type === "draw") {
    const outcome = draw(ctx, item.id);
    if (!outcome.configured) return failure("empty");
    result.owned = outcome.prize
      ? give(ctx, outcome.prize, "item", owned.data.character ?? null)
      : null;
  } else if (effect.type === "create") {
    const name = text(data.name, 80, true);
    const description = text(data.description ?? "", 2000);
    const image = data.image ? imageUrl(data.image) : null;
    const personal = ctx.add(ITEMS, {
      name,
      description,
      image,
      category: "personal",
      hidden: true,
      sellable: false,
    });
    result.owned = give(
      ctx,
      personal,
      "personal",
      owned.data.character ?? null,
    );
  } else if (effect.type === "profile") {
    const target = ownCharacter(ctx, character);
    if (!target) return failure("not_owned");
    if (data.revision !== target.revision) return failure("conflict");
    const profile = {
      ...target.data,
      name: text(data.name, 40, true),
      side: text(data.side ?? "", 40),
      profile: text(data.profile ?? "", 4000),
    };
    if (Object.hasOwn(data, "image"))
      profile.image = data.image ? imageUrl(data.image) : null;
    result.document = ctx.set(CHARACTERS, character, profile);
  } else return failure("not_usable");
  // The original personal-item creation form always consumes its ticket.
  if (item.data.reusable !== true || effect.type === "create")
    ctx.delete(INVENTORY, owned.id);
  record(ctx, "use", {
    item: item.id,
    inventory: owned.id,
    character: character ?? null,
    effect: effect.type,
  });
  return result;
}
