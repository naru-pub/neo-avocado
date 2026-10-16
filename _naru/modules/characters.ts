// Characters in the site's tables: the sheets members register, the owner's
// custom profile fields and their visibility, the application state flow
// (editing → submitted → approved), character types, and each character's
// official record (experience, points, stats, titles, purchases). Mirrors
// adm/character_article_list.php and mypage/character/character_form*.
//
// The queries and mutations in characters/ use it, and so do the old site
// functions of the areas not ported yet (Naru hands them ctx.sql), so a
// character reads the same everywhere. A character keeps the shape pages
// know ({ id, data, revision }), its ID a string of its row's number.
import {
  communityAccess,
  communitySettings,
  amount,
  imageUrl,
  names,
  one,
  parsed,
  siteOpen,
  text,
} from "./access.js";
import type { SqlCtx } from "./access.js";
import { profileByNick, profileOf, setMainCharacter } from "./members.js";
import type { Profile } from "./members.js";
import type { QueryCtx, SqlValue } from "./naru-types.js";

/** What character code uses of a call's ctx: the caller, `sql`, `fail` and `now`. */
export type CharacterCtx = SqlCtx &
  Pick<QueryCtx, "fail"> & { readonly now: number };

export const CHARACTER_TYPES = ["main", "sub", "npc"];

export const CHARACTER_STATES = ["editing", "submitted", "approved"];

export const FIELD_TYPES = ["text", "textarea", "select", "url", "image"];

/** public: every member; owner: the character's owner and the site owner; admin: the site owner. */
export const FIELD_VISIBILITY = ["public", "owner", "admin"];

const FIELD_LIMITS = {
  text: 200,
  textarea: 2000,
  select: 100,
  url: 2000,
  image: 2000,
};

/** All custom values of one character together. */
export const MAX_FIELD_TEXT = 6000;

export const MAX_FIELDS = 50;

/** At most this many stats may be defined. */
export const MAX_STATS = 20;

/** Characters a member may have unless the owner sets another number. */
export const CHARACTER_LIMIT = 1;

const STAT_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const fieldCode = (code: unknown) =>
  typeof code === "string" &&
  STAT_KEY.test(code) &&
  !["constructor", "prototype"].includes(code);

/** A characters row. */
export interface CharacterRow {
  id: number;
  owner: string;
  name: string;
  side: string;
  class: string;
  profile: string;
  type: string;
  state: string;
  image: string | null;
  head: string | null;
  body: string | null;
  outfit: number | null;
  fields: string;
  exp: number;
  points: number | null;
  stats: string;
  active_title: string | null;
  purchases: string;
  explore_day: string | null;
  explore_count: number;
  created_at: number;
  version: number;
}

/** A character as pages and old code read it. */
export interface Character {
  id: string;
  data: {
    owner: string;
    name: string;
    side: string;
    class: string;
    profile: string;
    type: string;
    state: string;
    image: string | null;
    head: string | null;
    body: string | null;
    outfit: string | null;
    fields?: Record<string, string>;
  };
  revision: string;
  createdAt: string;
  createdBy: null;
}

/** A character's ID as its row's number, or null when it is none. */
export function characterKey(id: unknown): number | null {
  if (typeof id === "number")
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  return typeof id === "string" && /^[1-9]\d{0,14}$/.test(id)
    ? Number(id)
    : null;
}

/** A character's row, or null. */
export async function characterRow(
  ctx: SqlCtx,
  id: unknown,
): Promise<CharacterRow | null> {
  const key = characterKey(id);
  if (key === null) return null;
  return await one<CharacterRow>(ctx, "SELECT * FROM characters WHERE id = ?", [
    key,
  ]);
}

/** The custom values a row keeps, by field code. */
export const fieldsOf = (row: CharacterRow): Record<string, string> =>
  parsed(row.fields, {});

/**
 * A row as a character document. `fields` are the custom values to show;
 * left out, the document carries none (as lists show them).
 */
export function sheetOf(
  row: CharacterRow,
  fields?: Record<string, string>,
): Character {
  return {
    id: String(row.id),
    data: {
      owner: row.owner,
      name: row.name,
      side: row.side,
      class: row.class,
      profile: row.profile,
      type: row.type,
      state: row.state,
      image: row.image,
      head: row.head,
      body: row.body,
      outfit: row.outfit === null ? null : String(row.outfit),
      ...(fields ? { fields } : {}),
    },
    revision: String(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: null,
  };
}

/** A custom profile field the owner defines (fieldCatalogue). */
export interface FieldDefinition {
  code: string;
  label: string;
  type: string;
  options: string[];
  help: string;
  /** A unit shown after a one-line value (ar_text). */
  suffix: string;
  order: number;
  visibility: string;
  required: boolean;
}

interface FieldRow {
  id: string;
  label: string;
  type: string;
  options: string;
  help: string;
  suffix: string;
  sort_order: number;
  visibility: string;
  required: number;
}

/** Valid definitions in display order. Malformed rows are skipped, not trusted. */
export async function fieldCatalogue(ctx: SqlCtx): Promise<FieldDefinition[]> {
  const { rows } = await ctx.sql<FieldRow>(
    "SELECT * FROM character_fields ORDER BY sort_order, id",
  );
  if (rows.length > MAX_FIELDS)
    throw new Error(`At most ${MAX_FIELDS} profile fields may be configured.`);
  return rows
    .filter((row) => fieldCode(row.id) && FIELD_TYPES.includes(row.type))
    .map((row) => {
      const options = parsed<unknown[]>(row.options, []);
      return {
        code: row.id,
        label: row.label || row.id,
        type: row.type,
        options: Array.isArray(options)
          ? options.filter(
              (option): option is string => typeof option === "string",
            )
          : [],
        help: row.help,
        suffix: row.suffix,
        order: row.sort_order,
        visibility: FIELD_VISIBILITY.includes(row.visibility)
          ? row.visibility
          : "public",
        required: row.required !== 0,
      };
    });
}

/** A definition as pages read it: { id, data }. */
export const definitionDocument = (definition: FieldDefinition) => ({
  id: definition.code,
  data: {
    label: definition.label,
    type: definition.type,
    options: definition.options,
    help: definition.help,
    suffix: definition.suffix,
    order: definition.order,
    visibility: definition.visibility,
    required: definition.required,
  },
});

/** Whether the caller may see a field of `owner`'s character. The site owner sees everything. */
export function fieldVisible(
  ctx: SqlCtx,
  definition: FieldDefinition,
  owner: string,
): boolean {
  if (ctx.owner) return true;
  if (definition.visibility === "public") return true;
  return (
    definition.visibility === "owner" &&
    Boolean(ctx.member) &&
    owner === ctx.member.id
  );
}

/** The custom values of `row` the caller may see, of current definitions. */
export function visibleFields(
  ctx: SqlCtx,
  row: CharacterRow,
  catalogue: FieldDefinition[],
): Record<string, string> {
  const fields = fieldsOf(row);
  if (ctx.owner) return fields;
  const visible: Record<string, string> = {};
  for (const definition of catalogue)
    if (
      Object.hasOwn(fields, definition.code) &&
      fieldVisible(ctx, definition, row.owner)
    )
      visible[definition.code] = fields[definition.code];
  return visible;
}

/**
 * What the caller may see of a character: a list's carries no custom
 * values; a single one, those of current definitions the caller may see
 * (the site owner, all it keeps).
 */
export async function presentCharacter(
  ctx: SqlCtx,
  row: CharacterRow | null,
  {
    list = false,
    catalogue = null,
  }: { list?: boolean; catalogue?: FieldDefinition[] | null } = {},
): Promise<Character | null> {
  if (!row) return null;
  if (list) return sheetOf(row);
  return sheetOf(
    row,
    visibleFields(ctx, row, catalogue ?? (await fieldCatalogue(ctx))),
  );
}

/**
 * Refuses a visitor while the site is closed (사이트공개 off): the original
 * sends them to log in (extend/community.config.php).
 */
export async function viewable(ctx: SqlCtx & Pick<QueryCtx, "fail">) {
  if (!ctx.member && !ctx.owner && !(await siteOpen(ctx)))
    ctx.fail("ACCESS_DENIED", "회원 로그인 후 이용할 수 있습니다.", {
      reason: "site_closed",
    });
}

/** One of the caller's own characters, or null. */
export async function ownCharacter(
  ctx: SqlCtx,
  id: unknown,
): Promise<CharacterRow | null> {
  if (!ctx.member) return null;
  const row = await characterRow(ctx, id);
  return row?.owner === ctx.member.id ? row : null;
}

/** A row of the owner's 소속 or 종족 list. */
export interface ChoiceRow {
  id: string;
  name: string;
  image: string | null;
  level: number;
  sort_order: number;
}

/** 소속 and 종족 as pages read them: { id, data }, in the owner's order. */
export async function choicesOf(ctx: SqlCtx, table: "sides" | "classes") {
  const { rows } = await ctx.sql<ChoiceRow>(
    `SELECT * FROM ${table} ORDER BY sort_order, id`,
  );
  return rows.map((row) => ({
    id: row.id,
    data: {
      name: row.name,
      image: row.image,
      level: row.level,
      order: row.sort_order,
    },
  }));
}

function fieldValue(
  ctx: CharacterCtx,
  definition: FieldDefinition,
  value: unknown,
): string | null {
  const refuse = () =>
    ctx.fail(
      "INVALID_REQUEST",
      `프로필 항목 "${definition.label || definition.code}"을(를) 확인해 주세요.`,
      { reason: "invalid_field" },
    );
  if (typeof value !== "string" || value.length > FIELD_LIMITS[definition.type])
    refuse();
  const trimmed = (value as string).trim();
  if (!trimmed) return null;
  if (definition.type === "select" && !definition.options.includes(trimmed))
    refuse();
  if (definition.type === "url" || definition.type === "image") {
    try {
      return imageUrl(trimmed);
    } catch {
      refuse();
    }
  }
  if (definition.type === "text" && /[\r\n]/.test(trimmed)) refuse();
  return trimmed;
}

/** What a member or the owner sends to save a character sheet. */
export interface SheetInput {
  name?: string;
  side?: string;
  class?: string;
  profile?: string;
  image?: string | null;
  head?: string | null;
  body?: string | null;
  fields?: Record<string, unknown>;
  type?: string;
  state?: string;
}

/**
 * The sheet fields a member may write: custom values they may see (never the
 * site owner's admin-only fields, which are kept; nor the type, which stays,
 * main for a new character) and editing/submitted state (an approved
 * character stays approved). Submitting requires every required field the
 * member can fill.
 *
 * The site owner writes every field, type and state, with no required
 * fields, as the original's admin form (adm/character_form.php:112-423).
 */
export async function memberSheet(
  ctx: CharacterCtx,
  previous: CharacterRow | null,
  data: SheetInput,
) {
  const owner = ctx.owner === true;
  const catalogue = await fieldCatalogue(ctx);
  const input = data.fields ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    ctx.fail("INVALID_REQUEST", "프로필 항목을 확인해 주세요.", {
      reason: "invalid_field",
    });
  const editable = new Map(
    catalogue
      .filter((definition) => owner || definition.visibility !== "admin")
      .map((definition) => [definition.code, definition]),
  );
  for (const code of Object.keys(input))
    if (!editable.has(code))
      ctx.fail("INVALID_REQUEST", `고칠 수 없는 프로필 항목입니다: ${code}`, {
        reason: "invalid_field",
      });
  const before = previous ? fieldsOf(previous) : {};
  const fields: Record<string, string> = {};
  let size = 0;
  for (const definition of catalogue) {
    const value =
      editable.has(definition.code) && Object.hasOwn(input, definition.code)
        ? fieldValue(ctx, definition, input[definition.code])
        : Object.hasOwn(before, definition.code) &&
            typeof before[definition.code] === "string"
          ? before[definition.code]
          : null;
    if (value === null) continue;
    fields[definition.code] = value;
    size += value.length;
  }
  if (size > MAX_FIELD_TEXT)
    ctx.fail(
      "INVALID_REQUEST",
      "추가 프로필 항목은 합쳐서 6,000자까지입니다.",
      { reason: "fields_too_long" },
    );
  // 메인·서브·NPC (ch_type) is the admin's: a member's form keeps it hidden
  // and a new one is main (character_form.php:77,96), whatever they send.
  const kept = CHARACTER_TYPES.includes(previous?.type)
    ? previous.type
    : "main";
  const type = owner ? (data.type ?? kept) : kept;
  if (!CHARACTER_TYPES.includes(type))
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const prior = previous?.state ?? null;
  const state = owner
    ? (data.state ?? prior ?? "editing")
    : prior === "approved"
      ? "approved"
      : (data.state ?? prior ?? "editing");
  if (
    owner
      ? !CHARACTER_STATES.includes(state)
      : prior !== "approved" && !["editing", "submitted"].includes(state)
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  if (
    !owner &&
    state === "submitted" &&
    catalogue.some(
      (definition) =>
        definition.required &&
        editable.has(definition.code) &&
        !Object.hasOwn(fields, definition.code),
    )
  )
    ctx.fail(
      "INVALID_REQUEST",
      "신청하려면 필수 프로필 항목을 모두 채워 주세요.",
      { reason: "missing_fields" },
    );
  return { fields, type, state, catalogue };
}

/**
 * A value from the owner's list (소속 or 종족), or any short text while the
 * list is empty. A value the character already has stays, so deleting it
 * from the list does not stop the member editing the rest.
 */
async function listed(
  ctx: CharacterCtx,
  table: "sides" | "classes",
  value: unknown,
  kept: string | undefined,
  label: string,
) {
  const chosen = text(value ?? "", 40);
  if (!chosen || chosen === kept) return chosen;
  const rows = await choicesOf(ctx, table);
  // si_auth, cl_auth: a member picks only what their level reaches; the
  // site owner, any.
  const level = ctx.owner ? Infinity : (await communityAccess(ctx)).level;
  const allowed = rows
    .filter((row) => (Number(row.data.level) || 1) <= level)
    .map((row) => row.data.name);
  if (rows.length && !allowed.includes(chosen))
    ctx.fail("INVALID_REQUEST", `${label}을(를) 목록에서 골라 주세요.`, {
      reason: "invalid_input",
    });
  return chosen;
}

/** How many characters a member has. */
export async function characterCount(ctx: SqlCtx, member: string) {
  return (
    (
      await one<{ n: number }>(
        ctx,
        "SELECT count(*) AS n FROM characters WHERE owner = ?",
        [member],
      )
    )?.n ?? 0
  );
}

/**
 * The owner's switches, as the original's 캐릭터생성 가능 and 수정 가능
 * (cf_2, cf_3) and cf_character_count: a member registers only while
 * creation is open and below the limit, and edits an approved character only
 * while editing is, or with a 프로필수정 ticket (`opened`).
 */
async function checkPeriod(
  ctx: CharacterCtx,
  previous: CharacterRow | null,
  opened: boolean,
) {
  if (ctx.owner) return;
  const settings = await communitySettings(ctx);
  if (previous) {
    // An application can always be finished, as the original's viewer
    // offers 수정 on any unapproved character (viewer.php:101); a
    // 프로필수정 ticket opens an approved one (character_form.php:80-84).
    if (
      settings.characterEditing === false &&
      previous.state === "approved" &&
      !opened
    )
      ctx.fail("ACCESS_DENIED", "현재 캐릭터 수정 기간이 아닙니다.", {
        reason: "editing_closed",
      });
    return;
  }
  if (settings.characterCreation === false)
    ctx.fail("ACCESS_DENIED", "현재 캐릭터 생성 기간이 아닙니다.", {
      reason: "creation_closed",
    });
  const limit = Number.isSafeInteger(settings.characterLimit)
    ? settings.characterLimit
    : CHARACTER_LIMIT;
  if (limit > 0 && (await characterCount(ctx, ctx.member.id)) >= limit)
    ctx.fail("CONFLICT", `캐릭터는 ${limit}명까지 만들 수 있습니다.`, {
      reason: "character_limit",
      limit,
    });
}

/**
 * The member the site owner names by nickname, as the admin form names the
 * owner by ID (adm/character_form_update.php:9-13).
 */
export async function memberByNick(
  ctx: CharacterCtx,
  nick: unknown,
): Promise<Profile> {
  const found =
    typeof nick === "string" && nick.trim()
      ? await profileByNick(ctx, nick.trim())
      : null;
  if (!found)
    ctx.fail("INVALID_REQUEST", "존재하지 않는 회원 정보 입니다.", {
      reason: "no_member",
    });
  return found;
}

/**
 * A member with no main character gets this one, as the admin's save sets
 * the member's ch_id while it is empty (adm/character_form_update.php:84).
 */
export async function claimMain(
  ctx: SqlCtx,
  profile: Profile,
  character: number,
) {
  if (!profile.data.mainCharacter)
    await setMainCharacter(ctx, profile.id, String(character));
}

/**
 * A member whose 대표 goes (deleted, or given to another member) gets their
 * oldest remaining character instead, or none: the original picks the first
 * character whenever the member's ch_id names none (extend/character.lib.php:5-12).
 */
export async function replaceMain(
  ctx: SqlCtx,
  member: string,
  removed: number,
) {
  const next = await one<{ id: number }>(
    ctx,
    "SELECT id FROM characters WHERE owner = ? AND id != ? ORDER BY id LIMIT 1",
    [member, removed],
  );
  await setMainCharacter(ctx, member, next ? String(next.id) : null);
}

/** Refuses a write made from a page that read an older version. */
export function checkRevision(
  ctx: Pick<QueryCtx, "fail">,
  current: { version: number },
  revision: unknown,
) {
  if (
    revision !== null &&
    revision !== undefined &&
    String(revision) !== String(current.version)
  )
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
}

/**
 * Registers a character (no `id`) or edits one of the member's own (`id`,
 * with the `revision` it was read at). Custom fields are checked against
 * their definitions, and the sheet's type and state against the review.
 * The site owner also saves any member's character, with every field, type
 * and state, outside the periods and the limit, and registers one for the
 * member named by `nick`. `opened` is a 프로필수정 ticket's (economy).
 */
export async function saveSheet(
  ctx: CharacterCtx,
  {
    id = null,
    data = {},
    revision = null,
    nick = null,
  }: {
    id?: string | null;
    data?: SheetInput;
    revision?: string | null;
    nick?: string | null;
  } = {},
  { opened = false }: { opened?: boolean } = {},
): Promise<{ row: CharacterRow; catalogue: FieldDefinition[] }> {
  if (!ctx.member && !ctx.owner)
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (id !== null && typeof id !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const previous = id === null ? null : await characterRow(ctx, id);
  if (id !== null && !previous)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  if (previous && !ctx.owner && previous.owner !== ctx.member.id)
    ctx.fail("ACCESS_DENIED", "직접 쓴 것만 고치거나 지울 수 있습니다.", {
      reason: "not_owned",
    });
  if (previous) checkRevision(ctx, previous, revision);
  await checkPeriod(ctx, previous, opened);
  if (!data || typeof data !== "object")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  // A new character from the admin belongs to the member it names (mb_id).
  const member = ctx.owner && !previous ? await memberByNick(ctx, nick) : null;
  const sheet = await memberSheet(ctx, previous, data);
  const named = await names(ctx);
  const values: Record<string, SqlValue> = {
    name: text(data.name, 40, true),
    side: await listed(
      ctx,
      "sides",
      data.side,
      previous?.side,
      named.sideTitle || "소속",
    ),
    class: await listed(
      ctx,
      "classes",
      data.class,
      previous?.class,
      named.classTitle || "종족",
    ),
    profile: text(data.profile ?? "", 4000),
    type: sheet.type,
    state: sheet.state,
    fields: JSON.stringify(sheet.fields),
  };
  // 두상, 흉상, 전신 (ch_thumb, ch_head, ch_body): an address or an upload's.
  for (const key of ["image", "head", "body"])
    if (Object.hasOwn(data, key) && data[key] !== previous?.[key])
      values[key] = data[key] ? imageUrl(data[key]) : null;
  let row: CharacterRow;
  if (previous) {
    const columns = Object.keys(values);
    row = (
      await ctx.sql<CharacterRow>(
        `UPDATE characters SET ${columns.map((column) => `${column} = ?`).join(", ")}, version = version + 1 WHERE id = ? RETURNING *`,
        [...Object.values(values), previous.id],
      )
    ).rows[0];
  } else {
    // The starting points are the owner's (initialStatPoints) until the
    // record is first written; see characterState.
    const owner = member ? member.id : ctx.member.id;
    const columns = ["owner", "created_at", ...Object.keys(values)];
    row = (
      await ctx.sql<CharacterRow>(
        `INSERT INTO characters (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`,
        [owner, ctx.now, ...Object.values(values)],
      )
    ).rows[0];
  }
  if (member) await claimMain(ctx, member, row.id);
  else if (!previous && !ctx.owner) {
    // A member's first character is their 대표 (character_form_update.php:120).
    const profile = await profileOf(ctx, ctx.member.id);
    if (profile) await claimMain(ctx, profile, row.id);
  }
  return { row, catalogue: sheet.catalogue };
}

/**
 * Deletes a character with what hangs off it in the site's tables: its
 * relations either way, outfits, couples and titles (adm/character_delete.php).
 * Its owner's 대표 moves to their oldest remaining character. The items it
 * held go back to its owner's inventory (economy's, not ported yet).
 */
export async function removeCharacter(ctx: SqlCtx, row: CharacterRow) {
  await ctx.sql`DELETE FROM relations WHERE character_id = ${row.id}`;
  await ctx.sql`DELETE FROM relations WHERE target = ${row.id}`;
  await ctx.sql`DELETE FROM wardrobe WHERE character_id = ${row.id}`;
  await ctx.sql`DELETE FROM couples WHERE first = ${row.id}`;
  await ctx.sql`DELETE FROM couples WHERE second = ${row.id}`;
  await ctx.sql`DELETE FROM character_titles WHERE character_id = ${row.id}`;
  await ctx.sql`DELETE FROM characters WHERE id = ${row.id}`;
  const profile = await profileOf(ctx, row.owner);
  if (profile?.data.mainCharacter === String(row.id))
    await replaceMain(ctx, row.owner, row.id);
}

/**
 * Gives a character to `member`, as the admin form changes its mb_id
 * (adm/character_form.php:135), with what the original keeps by character:
 * its outfits and relations (and its items, economy's, not ported yet).
 */
export async function moveCharacter(
  ctx: SqlCtx,
  row: CharacterRow,
  member: Profile,
): Promise<CharacterRow> {
  if (row.owner === member.id) return row;
  const moved = (
    await ctx.sql<CharacterRow>`UPDATE characters SET owner = ${member.id}, version = version + 1 WHERE id = ${row.id} RETURNING *`
  ).rows[0];
  await ctx.sql`UPDATE wardrobe SET owner = ${member.id} WHERE character_id = ${row.id}`;
  await ctx.sql`UPDATE relations SET owner = ${member.id} WHERE character_id = ${row.id}`;
  const before = await profileOf(ctx, row.owner);
  if (before?.data.mainCharacter === String(row.id))
    await replaceMain(ctx, row.owner, row.id);
  await claimMain(ctx, member, row.id);
  return moved;
}

// The official record: experience, points, stats, titles and purchases.

/** A stat definition as pages read it: { id, data }. */
export interface StatDefinition {
  id: string;
  data: {
    name: string;
    initial: number;
    max: number;
    min: number;
    help: string;
  };
}

/** The owner's stat definitions (adm/status_list.php), by key. */
export async function statDefinitions(ctx: SqlCtx): Promise<StatDefinition[]> {
  const { rows } = await ctx.sql<{
    id: string;
    name: string;
    initial: number;
    max: number;
    min: number;
    help: string;
  }>("SELECT * FROM stats ORDER BY id");
  if (rows.length > MAX_STATS)
    throw new Error(`At most ${MAX_STATS} stats may be configured.`);
  return rows.map(({ id, ...data }) => ({ id, data }));
}

/** The rank table (adm/level_list.php), lowest first. */
export async function levelRows(ctx: SqlCtx) {
  return (
    await ctx.sql<{
      id: string;
      name: string;
      exp: number;
      bonus_points: number;
    }>("SELECT * FROM levels ORDER BY exp, id")
  ).rows;
}

/** The rank reached at `exp` (the highest at or below it), or "". */
export async function rankAt(ctx: SqlCtx, exp: number): Promise<string> {
  const row = await one<{ name: string }>(
    ctx,
    "SELECT name FROM levels WHERE exp <= ? ORDER BY exp DESC, id LIMIT 1",
    [exp],
  );
  return row?.name ?? "";
}

/**
 * The stat points the ranks reached at `exp` add (lv_add_state, summed as
 * extend/rank.lib.php's get_rank_exp does between two ranks).
 */
async function rankBonus(ctx: SqlCtx, exp: number) {
  return (
    (
      await one<{ total: number | null }>(
        ctx,
        "SELECT sum(bonus_points) AS total FROM levels WHERE exp <= ?",
        [exp],
      )
    )?.total ?? 0
  );
}

/** A character's official record, as old code and pages know it. */
export interface Progress {
  owner: string;
  character: string;
  points: number;
  exp: number;
  stats: Record<
    string,
    { allocated: number; max: number; damage: number; current: number }
  >;
  titles: string[];
  activeTitle: string | null;
  purchases: Record<string, number>;
  explore?: { day: string; count: number };
  approved: boolean;
}

/**
 * A character's official record with experience moved to `exp`: reaching a
 * rank adds its bonus points, falling below one takes them back
 * (extend/exp.lib.php's insert_exp), never below none.
 */
export async function withExp<T extends { exp?: number; points?: number }>(
  ctx: SqlCtx,
  current: T,
  exp: number,
): Promise<T> {
  amount(exp, "Experience");
  const before = current.exp ?? 0;
  const bonus = (await rankBonus(ctx, exp)) - (await rankBonus(ctx, before));
  return {
    ...current,
    exp,
    points: Math.max(0, (current.points ?? 0) + bonus),
  };
}

/** The titles a character holds, in the order given. */
export async function titlesOf(ctx: SqlCtx, id: number): Promise<string[]> {
  return (
    await ctx.sql<{
      title_id: string;
    }>`SELECT title_id FROM character_titles WHERE character_id = ${id} ORDER BY id`
  ).rows.map((row) => row.title_id);
}

/**
 * A character's official record: its points (the owner's starting points
 * until first written), experience, stats checked against the definitions,
 * titles and purchases. Fails when there is no such character.
 */
export async function characterState(
  ctx: SqlCtx & Pick<QueryCtx, "fail">,
  id: unknown,
): Promise<{
  existing: CharacterRow;
  definitions: StatDefinition[];
  data: Progress;
  revision: string;
}> {
  const row = await characterRow(ctx, id);
  if (!row)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const definitions = await statDefinitions(ctx);
  const points =
    row.points ??
    amount(
      (await communitySettings(ctx)).initialStatPoints ?? 0,
      "Initial stat points",
    );
  amount(points, "Stat points");
  amount(row.exp, "Experience");
  const saved = parsed(row.stats, {});
  const stats = {};
  for (const definition of definitions) {
    const key = definition.id;
    if (!fieldCode(key)) throw new Error("Invalid stat identifier.");
    const base = amount(definition.data.initial, "Initial stat value");
    const limit = amount(definition.data.max, "Stat maximum");
    if (base > limit) throw new Error("Initial stat exceeds maximum.");
    const entry = Object.hasOwn(saved, key) ? saved[key] : null;
    const allocated = amount(entry?.allocated ?? 0, "Allocated points");
    const max = base + allocated;
    if (!Number.isSafeInteger(max) || max > limit)
      throw new Error("Stat exceeds maximum.");
    const value = amount(entry?.current ?? max, "Current stat");
    if (value > max) throw new Error("Current stat exceeds maximum.");
    const damage = amount(entry?.damage ?? max - value, "Stat damage");
    stats[key] = { allocated, max, damage, current: Math.max(0, max - damage) };
  }
  return {
    existing: row,
    definitions,
    revision: String(row.version),
    data: {
      owner: row.owner,
      character: String(row.id),
      points,
      exp: row.exp,
      stats,
      titles: await titlesOf(ctx, row.id),
      activeTitle: row.active_title,
      purchases: parsed(row.purchases, {}),
      ...(row.explore_day
        ? { explore: { day: row.explore_day, count: row.explore_count } }
        : {}),
      approved: row.state === "approved",
    },
  };
}

/**
 * Writes a character's official record: experience, points, stats, the
 * shown title, purchases and the day's exploration, and its titles when
 * given. Approval is the sheet's state, changed by the review only.
 */
export async function saveState(
  ctx: SqlCtx,
  id: unknown,
  data: Partial<Progress>,
): Promise<CharacterRow> {
  const key = characterKey(id);
  if (key === null) throw new Error("No such character.");
  const exp = amount(data.exp ?? 0, "Experience");
  const points = amount(data.points ?? 0, "Stat points");
  const row = (
    await ctx.sql<CharacterRow>(
      `UPDATE characters SET exp = ?, points = ?, stats = ?, active_title = ?, purchases = ?, explore_day = ?, explore_count = ?, version = version + 1 WHERE id = ? RETURNING *`,
      [
        exp,
        points,
        JSON.stringify(data.stats ?? {}),
        data.activeTitle ?? null,
        JSON.stringify(data.purchases ?? {}),
        data.explore?.day ?? null,
        data.explore?.count ?? 0,
        key,
      ],
    )
  ).rows[0];
  if (!row) throw new Error("No such character.");
  if (Array.isArray(data.titles)) await setTitles(ctx, key, data.titles);
  return row;
}

/** Makes a character's titles these, keeping the order of those it had. */
export async function setTitles(ctx: SqlCtx, id: number, titles: unknown[]) {
  const wanted = [
    ...new Set(titles.filter((title) => typeof title === "string")),
  ] as string[];
  const held = await titlesOf(ctx, id);
  const removed = held.filter((title) => !wanted.includes(title));
  if (removed.length)
    await ctx.sql(
      `DELETE FROM character_titles WHERE character_id = ? AND title_id IN (${removed.map(() => "?").join(", ")})`,
      [id, ...removed],
    );
  for (const title of wanted.filter((title) => !held.includes(title)))
    await ctx.sql`INSERT INTO character_titles (character_id, title_id) VALUES (${id}, ${title})`;
}

/** A title, or null; `shown` only one in use (ti_use, extend/title.lib.php:7). */
export async function titleRow(ctx: SqlCtx, id: unknown) {
  if (typeof id !== "string") return null;
  return await one<{
    id: string;
    name: string;
    enabled: number;
    image: string | null;
    description: string;
  }>(ctx, "SELECT * FROM titles WHERE id = ?", [id]);
}
