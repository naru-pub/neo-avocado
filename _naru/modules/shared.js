// Shared collection identifiers and transactional domain helpers.
export { IMAGE_SLOTS, imageSlotsOf } from "./images.js";
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

export const CHARACTER_FIELDS = `${PREFIX}character_fields`;

export const CALLS = `${PREFIX}calls`;

export const EXPLORE = `${PREFIX}explore`;

/** Each board's next log number (wr_num), one document per board. */
export const COUNTERS = `${PREFIX}counters`;
/** The owner's lists of affiliations and races (adm/side_list, class_list). */
export const SIDES = `${PREFIX}sides`;
export const CLASSES = `${PREFIX}classes`;
/** Board groups (adm/boardgroup_list). */
export const BOARD_GROUPS = `${PREFIX}board_groups`;
/** Who is here now, and each day's visits (current_connect, visit_list). */
export const PRESENCE = `${PREFIX}presence`;
export const VISITS = `${PREFIX}visits`;

/** Takes the board's next log number, as GnuBoard's wr_num. */
export async function nextNumber(ctx, board) {
  const counter = await ctx.get(COUNTERS, board);
  const number = Number.isSafeInteger(counter?.data.next)
    ? counter.data.next
    : 1;
  await ctx.set(COUNTERS, board, { next: number + 1 });
  return number;
}

/** Body limits: plain logs as before, HTML posts like content pages. */
export const TEXT_LIMIT = 2000;
export const HTML_LIMIT = 12000;

/** A rough text view of an HTML body, for previews, tags and calls. */
export const plainText = (value) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const MAX_TAGS = 5;
const TAG = /#([0-9a-zA-Z가-힣_]{1,30})/g;

/** A log's hashtags (mmb autolink's #tag), at most five, searched with `has`. */
export function tagFields(text) {
  const tags = [];
  for (const match of String(text ?? "").matchAll(TAG))
    if (!tags.includes(match[1]) && tags.length < MAX_TAGS) tags.push(match[1]);
  return { tags };
}

/** A visitor's access: level 1, as GnuBoard gives a guest. */
export const GUEST_ACCESS = Object.freeze({ level: 1, role: "guest" });

/**
 * 사이트공개 (cf_open): whether visitors who are not signed in may see the
 * community. On unless the owner turns it off (the original's install starts
 * with it off, extend/community.config.php sending guests to the login page).
 */
export async function siteOpen(ctx) {
  return (await ctx.get(SETTINGS, "community"))?.data.siteOpen !== false;
}

/**
 * The owner's names (기타 항목명 설정: cf_money, cf_money_pice, cf_exp_name,
 * cf_exp_pice, cf_rank_name, cf_side_title, cf_class_title), the template's
 * own until changed. An empty 소속 or 종족 title hides it, as in the original.
 * names.js keeps the same defaults for the pages.
 */
export const NAME_DEFAULTS = Object.freeze({
  moneyName: "아보",
  moneyUnit: "아보",
  expName: "경험치",
  expUnit: "",
  rankName: "랭킹",
  sideTitle: "소속",
  classTitle: "종족",
});
export function namesOf(settings = {}) {
  const names = {};
  for (const [key, fallback] of Object.entries(NAME_DEFAULTS)) {
    const value = settings[key];
    names[key] =
      typeof value === "string" &&
      (value.trim() || ["expUnit", "sideTitle", "classTitle"].includes(key))
        ? value.trim().slice(0, 20)
        : fallback;
  }
  return names;
}
export async function names(ctx) {
  return namesOf((await ctx.get(SETTINGS, "community"))?.data);
}
/** A word with its subject particle: 아보가, 경험치가, 포인트가, 골드가. */
export function subject(word) {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}이(가)`;
  return `${word}${(last - 0xac00) % 28 ? "이" : "가"}`;
}
/** "아보가 모자랍니다." in the owner's name for money or experience. */
export async function lacking(ctx, key) {
  return `${subject((await names(ctx))[key])} 모자랍니다.`;
}
/** What a restricted character is refused for, in the owner's names. */
export function restrictedFor(named, verb) {
  const kinds = [named.sideTitle, named.classTitle].filter(Boolean);
  return `이 캐릭터의 ${kinds.join("·") || "조건"}으로는 ${verb} 수 없습니다.`;
}

/** A visitor of a closed site: below every board's and page's level 1. */
export const CLOSED_ACCESS = Object.freeze({
  level: 0,
  role: "guest",
  closed: true,
});

export async function communityAccess(ctx, id = ctx.member?.id) {
  // A closed site (cf_open off) shows visitors nothing, as the original
  // sends them to log in from every page (check_site_auth).
  if (!id) return (await siteOpen(ctx)) ? GUEST_ACCESS : CLOSED_ACCESS;
  const row = await ctx.get(MEMBERS, id);
  // A member who left (bbs/member_leave.php) is a guest until the owner
  // clears their leave date.
  if (row?.data.left) return { ...GUEST_ACCESS, role: "member", left: true };
  return {
    // The board groups whose members-only boards they may use.
    groups: Array.isArray(row?.data.groups)
      ? row.data.groups.filter((id) => typeof id === "string")
      : [],
    level:
      Number.isInteger(row?.data.level) &&
      row.data.level >= 1 &&
      row.data.level <= 10
        ? row.data.level
        : 2,
    role: row?.data.role === "moderator" ? "moderator" : "member",
  };
}

export function author(row) {
  return row?.createdBy ?? row?.data.owner;
}

/**
 * A post or comment as its reader sees it (skin/board/mmb/list.log.skin.php).
 * 멤버공개 shows a visitor only its number, category and marks; 익명 hides
 * who wrote it from all but its author and the staff, as "익명의 누군가".
 * The rule's present() and the functions that return others' posts use it.
 */
export function presentPost(row, { member = null, staff = false } = {}) {
  let data = row.data;
  if (
    data.anonymous === true &&
    !staff &&
    !(member && author(row) === member)
  ) {
    data = { ...data, owner: null };
    for (const key of ["speaker", "character", "guest"]) delete data[key];
  }
  if (data.membersOnly === true && !member && !staff) {
    const shown = {};
    for (const key of [
      "logId",
      "board",
      "number",
      "category",
      "notice",
      "membersOnly",
      "adult",
      "anonymous",
      "settlement",
    ])
      if (Object.hasOwn(data, key)) shown[key] = data[key];
    data = { ...shown, owner: null, locked: true };
  }
  return data;
}

/**
 * A board the owner made, or null: as in the original, a site has no boards
 * until its admin creates them (adm/board_form.php). A post without a board
 * names "default", which is a board only once the owner makes one with that ID.
 */
export async function boardOf(ctx, id = "default") {
  const found = typeof id === "string" ? await ctx.get(BOARDS, id) : null;
  return found ? withGroup(ctx, found) : null;
}

/**
 * A board in a members-only group (gr_use_access) carries the group's ID as
 * `membersOnly`, for boardAllowed; `groups` is the site's groups, when the
 * caller has read them already.
 */
export async function withGroup(ctx, board, groups) {
  const id = board.data.group;
  if (typeof id !== "string" || !id) return board;
  const group = groups
    ? groups.find((row) => row.id === id)
    : await ctx.get(BOARD_GROUPS, id);
  return group?.data.membersOnly && !group.data.deleted
    ? { ...board, data: { ...board.data, membersOnly: id } }
    : board;
}

export function boardAllowed(board, access, action) {
  if (!board) return false;
  // A members-only group's boards are its members' (and moderators').
  if (
    board.data.membersOnly &&
    access.role !== "moderator" &&
    !(access.groups ?? []).includes(board.data.membersOnly)
  )
    return false;
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
    // 멤버공개 (wr_secret): a visitor sees it locked, with no comments.
    (row.data.membersOnly !== true || Boolean(viewer)) &&
    boardAllowed(
      await boardOf(ctx, row.data.board ?? "default"),
      access,
      "read",
    ) &&
    (!row.data.secret || author(row) === viewer || access.role === "moderator")
  );
}

/**
 * Deletes a log with its comments, or a character with what hangs off it, in
 * bounded batches: a call writes at most 25 times, so a large one is marked
 * deleted and finished by calling again. Their uploads stay: Naru deletes
 * media only when asked, and marks unreferenced uploads in its library.
 */
export async function deleteCommunityDocument(ctx, collection, kind, row) {
  if (!["logs", "characters"].includes(kind)) {
    await ctx.delete(collection, row.id);
    return { done: true };
  }
  if (!row.data.deleted)
    await ctx.set(collection, row.id, { ...row.data, deleted: true });
  let unfinished = false;
  // 25 writes, less the marker, the parent's delete and the character's
  // state and profile fix-ups: what the children may spend.
  let remaining = 25 - 1 - 1 - 2;
  const remove = async (target, filter, detach = false) => {
    if (remaining === 0) {
      unfinished = true;
      return;
    }
    const page = await ctx.list(target, {
      filter,
      size: Math.min(10, remaining),
    });
    unfinished ||= Boolean(page.nextCursor);
    for (const child of page.documents) {
      remaining--;
      if (detach)
        await ctx.set(target, child.id, { ...child.data, character: null });
      else await ctx.delete(target, child.id);
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
  if (!unfinished) await ctx.delete(collection, row.id);
  return { done: !unfinished };
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
  let roll = Math.random() * total;
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
/** Fails the call unless `character` meets the item's use requirements. */
export async function requireUsable(ctx, item, character) {
  const requirements = item.data.useRequirements ?? {};
  if (
    !requirements.approved &&
    !requirements.sides?.length &&
    !requirements.classes?.length &&
    !requirements.exp &&
    !requirements.title
  )
    return;
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const official = (await characterState(ctx, character)).data;
  if (requirements.approved && official.approved !== true)
    ctx.fail("CONFLICT", "승인된 캐릭터만 할 수 있습니다.", {
      reason: "not_approved",
    });
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
      ctx.fail("CONFLICT", restrictedFor(await names(ctx), "사용할"), {
        reason: "restricted_character",
      });
  }
  if (official.exp < amount(requirements.exp ?? 0, "Use experience"))
    ctx.fail("CONFLICT", await lacking(ctx, "expName"), {
      reason: "not_enough_exp",
    });
  if (
    requirements.title &&
    (!official.titles?.includes(requirements.title) ||
      (await ctx.get(TITLES, requirements.title))?.data.deleted)
  )
    ctx.fail("CONFLICT", "필요한 타이틀이 없습니다.", {
      reason: "missing_title",
    });
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

/**
 * The background music the owner set: a YouTube playlist (`list=…`, or the
 * bare ID) or a single video (`v=…`, youtu.be/…), else null. Only the ID
 * reaches pages, which embed it themselves.
 */
export function backgroundMusic(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const id = /^[\w-]{10,64}$/;
  const list = text.match(/[?&]list=([\w-]{10,64})/)?.[1];
  if (list) return { list };
  const video =
    text.match(/[?&]v=([\w-]{11})/)?.[1] ??
    text.match(/youtu\.be\/([\w-]{11})/)?.[1];
  if (video) return { video };
  if (!id.test(text)) return null;
  return text.length === 11 ? { video: text } : { list: text };
}
