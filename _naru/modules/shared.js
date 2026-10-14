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

export const CHARACTER_FIELDS = `${PREFIX}character_fields`;

export const CALLS = `${PREFIX}calls`;

export const EXPLORE = `${PREFIX}explore`;

/** Each board's next log number (wr_num), one document per board. */
export const COUNTERS = `${PREFIX}counters`;

/** Takes the board's next log number, as GnuBoard's wr_num. */
export async function nextNumber(ctx, board) {
  const counter = await ctx.get(COUNTERS, board);
  const number = Number.isSafeInteger(counter?.data.next)
    ? counter.data.next
    : 1;
  await ctx.set(COUNTERS, board, { next: number + 1 });
  return number;
}

export const MAX_TAGS = 5;
const TAG = /#([0-9a-zA-Z가-힣_]{1,30})/g;

/**
 * A log's hashtags (mmb autolink's #tag), also copied to tag0…tag4: `where`
 * cannot test array membership, so each tag needs a field of its own.
 */
export function tagFields(text) {
  const tags = [];
  for (const match of String(text ?? "").matchAll(TAG))
    if (!tags.includes(match[1]) && tags.length < MAX_TAGS) tags.push(match[1]);
  const fields = { tags };
  for (let index = 0; index < MAX_TAGS; index++)
    fields[`tag${index}`] = tags[index] ?? null;
  return fields;
}

/** A predicate matching logs with `tag`, over the tag0…tag4 fields. */
export const tagWhere = (tag) => ({
  any: Array.from({ length: MAX_TAGS }, (_, index) => ({
    eq: [`tag${index}`, tag],
  })),
});

/** Guest posts' password hashes, kept apart so member reads of posts never see them. */
export const GUEST_KEYS = `${PREFIX}guest_keys`;

export const guestKey = (collection, id) =>
  `${collection.slice(PREFIX.length)}-${id}`;

/** A visitor's access: level 1, as GnuBoard gives a guest. */
export const GUEST_ACCESS = Object.freeze({ level: 1, role: "guest" });

export const mediaId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Abort the call, rolling back its writes, with a reason the page maps to text. */
export function fail(ctx, code, reason, message = reason) {
  ctx.fail(code, message, { reason });
}

/** Forget the ledger row and queue the upload's deletion in the same commit. */
export async function dropMedia(ctx, id) {
  await ctx.delete(MEDIA, id);
  await ctx.media.delete(id);
}

/** Writes releaseMedia may make: a ledger update, or a drop (row + upload). */
export const RELEASE_WRITES = 2;

export async function releaseMedia(ctx, collection, document) {
  const id = document?.data.imageId;
  const asset = mediaId(id) ? await ctx.get(MEDIA, id) : null;
  if (!asset) return;
  const refs = asset.data.refs.filter(
    (key) => key !== `${collection}/${document.id}`,
  );
  if (!refs.length) return await dropMedia(ctx, id);
  await ctx.set(MEDIA, id, { ...asset.data, refs, status: "active" });
}

export async function saveImage(
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
    const asset = mediaId(imageId) ? await ctx.get(MEDIA, imageId) : null;
    const preserving =
      before?.data.imageId === imageId && before.data.image === value.image;
    if (
      !asset ||
      asset.data.url !== value.image ||
      asset.data.status === "deleting" ||
      (!preserving && asset.data.owner !== ctx.member.id)
    )
      fail(
        ctx,
        "CONFLICT",
        "media_unavailable",
        "Media is unavailable or not owned.",
      );
    data.imageId = imageId;
  } else delete data.imageId;
  const document = id
    ? await ctx.set(collection, id, data)
    : await ctx.add(collection, data);
  if (before?.data.imageId && before.data.imageId !== imageId)
    await releaseMedia(ctx, collection, before);
  if (imageId) {
    const asset = await ctx.get(MEDIA, imageId);
    const key = `${collection}/${document.id}`;
    if (!asset.data.refs.includes(key)) {
      if (asset.data.refs.length >= 50)
        fail(
          ctx,
          "INVALID_REQUEST",
          "media_ref_limit",
          "Media reference limit reached.",
        );
      await ctx.set(MEDIA, imageId, {
        ...asset.data,
        refs: [...asset.data.refs, key],
        status: "active",
        cleanup: false,
      });
    }
  }
  return document;
}

export async function communityAccess(ctx, id = ctx.member?.id) {
  if (!id) return GUEST_ACCESS;
  const row = await ctx.get(MEMBERS, id);
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
  character_fields: 50,
};

export function author(row) {
  return row?.createdBy ?? row?.data.owner;
}

export async function boardOf(ctx, id = "default") {
  const found = typeof id === "string" ? await ctx.get(BOARDS, id) : null;
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
          actions: true,
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

/** Whether `viewer` (by default the caller) with `access` may read the post. */
export async function logReadable(ctx, row, access, viewer = ctx.member?.id) {
  return (
    row &&
    !row.data.deleted &&
    boardAllowed(
      await boardOf(ctx, row.data.board ?? "default"),
      access,
      "read",
    ) &&
    (!row.data.secret || author(row) === viewer || access.role === "moderator")
  );
}

export async function deleteCommunityDocument(ctx, collection, kind, row) {
  if (!["logs", "characters"].includes(kind)) {
    await ctx.delete(collection, row.id);
    await forgetGuestKey(ctx, collection, row);
    return { ok: true, done: true };
  }
  if (!row.data.deleted)
    await ctx.set(collection, row.id, { ...row.data, deleted: true });
  let unfinished = false;
  let remaining = 10;
  // 25 writes, less the marker, the parent's own release and delete, and the
  // character's state and profile fix-ups: what the children may spend.
  let writes = 25 - 2 - RELEASE_WRITES - 2;
  const remove = async (target, filter, detach = false) => {
    if (remaining === 0) {
      unfinished = true;
      return;
    }
    const page = await ctx.list(target, {
      filter,
      size: Math.min(5, remaining),
    });
    unfinished ||= Boolean(page.nextCursor);
    for (const child of page.documents) {
      const cost = detach
        ? 1
        : 1 +
          (mediaId(child.data.imageId) ? RELEASE_WRITES : 0) +
          (child.data.guest ? 1 : 0);
      if (cost > writes) {
        unfinished = true;
        return;
      }
      remaining--;
      writes -= cost;
      if (detach)
        await ctx.set(target, child.id, { ...child.data, character: null });
      else {
        await releaseMedia(ctx, target, child);
        await ctx.delete(target, child.id);
        await forgetGuestKey(ctx, target, child);
      }
    }
  };
  if (kind === "logs") await remove(`${PREFIX}comments`, { logId: row.id });
  else {
    await remove(RELATIONS, { character: row.id });
    await remove(RELATIONS, { target: row.id });
    await remove(WARDROBE, { character: row.id });
    await remove(INVENTORY, { character: row.id }, true);
    await remove(`${PREFIX}couples`, { first: row.id });
    await remove(`${PREFIX}couples`, { second: row.id });
    if (await ctx.get(CHARACTER_STATE, row.id))
      await ctx.delete(CHARACTER_STATE, row.id);
    const profile = await ctx.get(PROFILES, author(row));
    if (profile?.data.mainCharacter === row.id)
      await ctx.set(PROFILES, profile.id, {
        ...profile.data,
        mainCharacter: null,
      });
  }
  if (!unfinished) {
    await releaseMedia(ctx, collection, row);
    await ctx.delete(collection, row.id);
    // A log has no character fix-ups, so its key fits in their two writes.
    await forgetGuestKey(ctx, collection, row);
  }
  return { ok: true, done: !unfinished };
}

/** Deletes a guest post's password hash along with the post. */
export async function forgetGuestKey(ctx, collection, row) {
  if (row.data.guest)
    await ctx.delete(GUEST_KEYS, guestKey(collection, row.id));
}

export async function record(ctx, kind, details, owner = ctx.member.id) {
  await ctx.add(HISTORY, { owner, kind, at: ctx.now, ...details });
}

export async function ownCharacter(ctx, id) {
  const character =
    typeof id === "string" ? await ctx.get(CHARACTERS, id) : null;
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

export async function weightedRows(ctx, collection, filter) {
  const rows = [];
  let after = null;
  do {
    const page = await ctx.list(collection, { size: 100, after, filter });
    rows.push(...page.documents);
    after = page.nextCursor;
    if (rows.length > 2000)
      throw new Error("A draw table may contain at most 2000 entries.");
  } while (after);
  return rows;
}

export const DAILY_REWARD = 100;

export const GACHA_COST = 50;

/** A Korean local "YYYY-MM-DDTHH:mm[:ss]" as milliseconds; null if blank, NaN if malformed. */
export function kstStamp(value) {
  if (!value) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)
  )
    return NaN;
  const stamp = Date.parse(`${value}+09:00`);
  return Number.isFinite(stamp) &&
    new Date(stamp + 9 * 3600000).toISOString().slice(0, value.length) === value
    ? stamp
    : NaN;
}

/** Whether `now` is inside a row's optional startsAt (inclusive) and endsAt (exclusive). */
export function scheduled(data, now) {
  const start = kstStamp(data.startsAt),
    end = kstStamp(data.endsAt);
  return (
    (!data.startsAt || (Number.isFinite(start) && now >= start)) &&
    (!data.endsAt || (Number.isFinite(end) && now < end))
  );
}

export const kstDay = (now) =>
  new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

export async function wallet(ctx) {
  const found = await ctx.get(WALLETS, ctx.member.id);
  const current = found ? found.data : { balance: 0, lastDaily: null };
  amount(current.balance, "Balance");
  return current;
}

export async function pay(ctx, current, amount, changes = {}) {
  const balance = current.balance - amount;
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error("Balance is outside its allowed range.");
  await ctx.set(WALLETS, ctx.member.id, {
    ...current,
    ...changes,
    balance,
  });
  return balance;
}

export async function give(ctx, item, from, character = null) {
  return await ctx.add(INVENTORY, {
    owner: ctx.member.id,
    item: item.id,
    name: item.data.name,
    from,
    ...(character ? { character } : {}),
  });
}

export async function draw(ctx, source = null, collection = GACHA) {
  const table = (
    await weightedRows(ctx, collection, source ? { source } : undefined)
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
    typeof won.data.item === "string"
      ? await ctx.get(ITEMS, won.data.item)
      : null;
  if (!prize)
    throw new Error(`뽑기의 아이템 ${won.data.item}이 상점에 없습니다.`);
  return { configured: true, prize };
}

export async function ownedItem(ctx, id) {
  const owned = typeof id === "string" ? await ctx.get(INVENTORY, id) : null;
  return owned?.data.owner === ctx.member.id ? owned : null;
}

export async function characterState(ctx, character, owner = ctx.member.id) {
  const definitions = await weightedRows(ctx, STAT_CONFIG);
  if (definitions.length > 20)
    throw new Error("At most 20 stats may be configured.");
  const existing = await ctx.get(CHARACTER_STATE, character);
  const current = existing?.data ?? {
    owner,
    character,
    points: amount(
      (await ctx.get(SETTINGS, "community"))?.data.initialStatPoints ?? 0,
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

/** Why `character` may not use `item` under its catalog conditions, or null. */
export async function useRestriction(ctx, item, character) {
  const requirements = item.data.useRequirements ?? {};
  if (
    !requirements.approved &&
    !requirements.sides?.length &&
    !requirements.classes?.length &&
    !requirements.exp &&
    !requirements.title
  )
    return null;
  if (!(await ownCharacter(ctx, character))) return "no_character";
  const official = (await characterState(ctx, character)).data;
  if (requirements.approved && official.approved !== true)
    return "not_approved";
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
      return "restricted_character";
  }
  if (official.exp < amount(requirements.exp ?? 0, "Use experience"))
    return "not_enough_exp";
  if (
    requirements.title &&
    (!official.titles?.includes(requirements.title) ||
      (await ctx.get(TITLES, requirements.title))?.data.deleted)
  )
    return "missing_title";
  return null;
}

/** Applies a recovery effect to an owned character; null when already full. */
export async function restoreStat(ctx, effect, character) {
  const state = await characterState(ctx, character);
  if (
    typeof effect.stat !== "string" ||
    !Object.hasOwn(state.data.stats, effect.stat)
  )
    throw new Error("Recovery stat does not exist.");
  const recovery = amount(effect.amount, "Recovery amount");
  if (!recovery) throw new Error("Recovery amount must be positive.");
  const stat = state.data.stats[effect.stat];
  if (stat.current === stat.max) return null;
  stat.damage = Math.max(0, stat.damage - recovery);
  stat.current = Math.max(0, stat.max - stat.damage);
  return await ctx.set(CHARACTER_STATE, character, state.data);
}

export async function contentReadable(ctx, row) {
  return (
    row &&
    row.data.enabled !== false &&
    !row.data.deleted &&
    (await communityAccess(ctx)).level >= (row.data.readLevel ?? 2)
  );
}
