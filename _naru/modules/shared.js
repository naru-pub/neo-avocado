// Shared collection identifiers and transactional domain helpers.
export const PREFIX = "neo_avocado_";

export const WALLETS = `${PREFIX}wallets`;

export const INVENTORY = `${PREFIX}inventory`;

export const ITEMS = `${PREFIX}items`;

export const GACHA = `${PREFIX}gacha`;

export const PROFILES = `${PREFIX}profiles`;

export const RECIPES = `${PREFIX}recipes`;

export const CHARACTERS = `${PREFIX}characters`;

export const RELATIONS = `${PREFIX}relations`;

export const WARDROBE = `${PREFIX}wardrobe`;

export const CHARACTER_STATE = `${PREFIX}character_state`;

export const STAT_CONFIG = `${PREFIX}stat_config`;

export const SETTINGS = `${PREFIX}settings`;

export const LEVELS = `${PREFIX}levels`;

export const TITLES = `${PREFIX}titles`;

export const HISTORY = `${PREFIX}history`;

export const MESSAGES = `${PREFIX}messages`;

export const MEMBERS = `${PREFIX}members`;

export const BOARDS = `${PREFIX}boards`;

export const MEDIA = `${PREFIX}media_assets`;

export const mediaId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function releaseMedia(ctx, collection, document) {
  const id = document?.data.imageId;
  const asset = mediaId(id) ? ctx.get(MEDIA, id) : null;
  if (!asset) return;
  const refs = asset.data.refs.filter(
    (key) => key !== `${collection}/${document.id}`,
  );
  ctx.set(MEDIA, id, {
    ...asset.data,
    refs,
    status: refs.length ? "active" : "pending",
    cleanup: refs.length === 0,
    cleanupAfter: ctx.now,
  });
}

export function saveImage(
  ctx,
  collection,
  before,
  value,
  input,
  id = before?.id,
) {
  let imageId =
    value.image === before?.data.image ? before?.data.imageId : null;
  if (Object.hasOwn(input, "imageId")) imageId = input.imageId;
  const data = { ...value };
  if (typeof imageId === "string") imageId = imageId.toLowerCase();
  if (imageId) {
    const asset = mediaId(imageId) ? ctx.get(MEDIA, imageId) : null;
    const preserving =
      before?.data.imageId === imageId && before.data.image === value.image;
    if (
      !asset ||
      asset.data.url !== value.image ||
      asset.data.status === "deleting" ||
      (!preserving && asset.data.owner !== ctx.member.id)
    )
      throw new Error("Media is unavailable or not owned.");
    data.imageId = imageId;
  } else delete data.imageId;
  const document = id
    ? ctx.set(collection, id, data)
    : ctx.add(collection, data);
  if (before?.data.imageId && before.data.imageId !== imageId)
    releaseMedia(ctx, collection, before);
  if (imageId) {
    const asset = ctx.get(MEDIA, imageId);
    const key = `${collection}/${document.id}`;
    if (!asset.data.refs.includes(key)) {
      if (asset.data.refs.length >= 50)
        throw new Error("Media reference limit reached.");
      ctx.set(MEDIA, imageId, {
        ...asset.data,
        refs: [...asset.data.refs, key],
        status: "active",
        cleanup: false,
      });
    }
  }
  return document;
}

export function communityAccess(ctx, id = ctx.member.id) {
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

export const READ_LIMITS = {
  emoticons: 50,
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

export function author(row) {
  return row?.createdBy ?? row?.data.owner;
}

export function boardOf(ctx, id = "default") {
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

export function boardAllowed(board, access, action) {
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

export function logReadable(ctx, row, access) {
  return (
    row &&
    !row.data.deleted &&
    boardAllowed(boardOf(ctx, row.data.board ?? "default"), access, "read") &&
    (!row.data.secret ||
      author(row) === ctx.member.id ||
      access.role === "moderator")
  );
}

export function deleteCommunityDocument(ctx, collection, kind, row) {
  if (!["logs", "characters"].includes(kind)) {
    ctx.delete(collection, row.id);
    return { ok: true, done: true };
  }
  if (!row.data.deleted)
    ctx.set(collection, row.id, { ...row.data, deleted: true });
  let unfinished = false;
  let remaining = 10;
  let mediaChanged = Boolean(row.data.imageId);
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
      else {
        if (child.data.imageId) mediaChanged = true;
        releaseMedia(ctx, target, child);
        ctx.delete(target, child.id);
      }
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
  if (!unfinished) {
    releaseMedia(ctx, collection, row);
    ctx.delete(collection, row.id);
  }
  return { ok: true, done: !unfinished, mediaCleanup: mediaChanged };
}

export function record(ctx, kind, details, owner = ctx.member.id) {
  ctx.add(HISTORY, { owner, kind, at: ctx.now, ...details });
}

export function ownCharacter(ctx, id) {
  const character = typeof id === "string" ? ctx.get(CHARACTERS, id) : null;
  return character &&
    (character.createdBy ?? character.data.owner) === ctx.member.id &&
    !character.data.deleted
    ? character
    : null;
}

export function text(value, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error("Invalid text input.");
  return value.trim();
}

export function imageUrl(value) {
  const url = text(value, 2000, true);
  // QuickJS has no URL constructor. Browser images must use HTTPS, with no
  // credentials, whitespace, data payloads or script schemes.
  if (!/^https:\/\/[^\s/@?#:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(url))
    throw new Error("An image must have an HTTPS address.");
  return url;
}

export const failure = (reason) => ({ ok: false, reason });

export function amount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

export function weightedRows(ctx, collection, filter) {
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

export const DAILY_REWARD = 100;

export const GACHA_COST = 50;

export const kstDay = (now) =>
  new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function wallet(ctx) {
  const found = ctx.get(WALLETS, ctx.member.id);
  const current = found ? found.data : { balance: 0, lastDaily: null };
  amount(current.balance, "Balance");
  return current;
}

export function pay(ctx, current, amount, changes = {}) {
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

export function give(ctx, item, from, character = null) {
  return ctx.add(INVENTORY, {
    owner: ctx.member.id,
    item: item.id,
    name: item.data.name,
    from,
    ...(character ? { character } : {}),
  });
}

export function draw(ctx, source = null) {
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

export function ownedItem(ctx, id) {
  const owned = typeof id === "string" ? ctx.get(INVENTORY, id) : null;
  return owned?.data.owner === ctx.member.id ? owned : null;
}

export function characterState(ctx, character, owner = ctx.member.id) {
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

export function contentReadable(ctx, row) {
  return (
    row &&
    row.data.enabled !== false &&
    !row.data.deleted &&
    communityAccess(ctx).level >= (row.data.readLevel ?? 2)
  );
}
