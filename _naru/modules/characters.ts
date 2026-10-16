// Character sheets: the owner's custom profile fields, their visibility, the
// application state flow (editing → submitted → approved) and character types.
// Mirrors adm/character_article_list.php and mypage/character/character_form*.
import {
  CHARACTER_FIELDS,
  CHARACTER_STATE,
  PROFILES,
  author,
  characterState,
  imageUrl,
  weightedRows,
} from "./shared.js";
import type { Ctx, Data, NaruDocument, ReadCtx } from "./naru-types.js";

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

/** All custom values of one character together, so a sheet fits a function result. */
export const MAX_FIELD_TEXT = 6000;

export const MAX_FIELDS = 50;

const fieldCode = (code: unknown) =>
  typeof code === "string" &&
  /^[a-z][a-z0-9_]{0,31}$/.test(code) &&
  !["constructor", "prototype"].includes(code);

/** A custom profile field the owner defines (fieldCatalogue). */
export interface FieldDefinition {
  code: string;
  label: string;
  type: string;
  options: string[];
  help: string;
  order: number;
  visibility: string;
  required: boolean;
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

/** Valid definitions in display order. Malformed rows are skipped, not trusted. */
export async function fieldCatalogue(ctx: ReadCtx): Promise<FieldDefinition[]> {
  const rows = await weightedRows(ctx, CHARACTER_FIELDS);
  if (rows.length > MAX_FIELDS)
    throw new Error(`At most ${MAX_FIELDS} profile fields may be configured.`);
  return rows
    .filter(
      (row) =>
        fieldCode(row.id) &&
        !row.data.deleted &&
        FIELD_TYPES.includes(row.data.type ?? "text"),
    )
    .map((row) => ({
      code: row.id,
      label: typeof row.data.label === "string" ? row.data.label : row.id,
      type: row.data.type ?? "text",
      options: Array.isArray(row.data.options)
        ? row.data.options.filter((option) => typeof option === "string")
        : [],
      help: typeof row.data.help === "string" ? row.data.help : "",
      order: Number.isFinite(row.data.order) ? row.data.order : 0,
      visibility: FIELD_VISIBILITY.includes(row.data.visibility)
        ? row.data.visibility
        : "public",
      required: row.data.required === true,
    }))
    .sort((a, b) => a.order - b.order || (a.code < b.code ? -1 : 1));
}

/** Whether the caller may see a field of `row`. The site owner sees everything. */
export function fieldVisible(
  ctx: ReadCtx,
  definition: FieldDefinition,
  row: NaruDocument,
): boolean {
  if (ctx.owner) return true;
  if (definition.visibility === "public") return true;
  return (
    definition.visibility === "owner" &&
    Boolean(ctx.member) &&
    author(row) === ctx.member.id
  );
}

/**
 * What the caller may see of a character. Lists omit custom values entirely
 * (a page of sheets would not fit a function result); single reads keep only
 * the values of current definitions the caller may see.
 */
export async function presentCharacter(
  ctx: ReadCtx,
  row: NaruDocument | null,
  {
    list = false,
    catalogue = null,
  }: { list?: boolean; catalogue?: FieldDefinition[] | null } = {},
): Promise<NaruDocument | null> {
  if (!row || ctx.owner) return row;
  const { fields, fieldMedia, ...data } = row.data;
  if (list || !fields || typeof fields !== "object") return { ...row, data };
  const definitions = catalogue ?? (await fieldCatalogue(ctx));
  const visible = {};
  for (const definition of definitions)
    if (
      Object.hasOwn(fields, definition.code) &&
      fieldVisible(ctx, definition, row)
    )
      visible[definition.code] = fields[definition.code];
  return { ...row, data: { ...data, fields: visible } };
}

function fieldValue(
  ctx: Ctx,
  definition: FieldDefinition,
  value: unknown,
): string | null {
  if (typeof value !== "string" || value.length > FIELD_LIMITS[definition.type])
    ctx.fail(
      "INVALID_REQUEST",
      `프로필 항목 "${definition.label || definition.code}"을(를) 확인해 주세요.`,
      { reason: "invalid_field" },
    );
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (definition.type === "select" && !definition.options.includes(trimmed))
    ctx.fail(
      "INVALID_REQUEST",
      `프로필 항목 "${definition.label || definition.code}"을(를) 확인해 주세요.`,
      { reason: "invalid_field" },
    );
  if (definition.type === "url" || definition.type === "image") {
    try {
      return imageUrl(trimmed);
    } catch {
      ctx.fail(
        "INVALID_REQUEST",
        `프로필 항목 "${definition.label || definition.code}"을(를) 확인해 주세요.`,
        { reason: "invalid_field" },
      );
    }
  }
  if (definition.type === "text" && /[\r\n]/.test(trimmed))
    ctx.fail(
      "INVALID_REQUEST",
      `프로필 항목 "${definition.label || definition.code}"을(를) 확인해 주세요.`,
      { reason: "invalid_field" },
    );
  return trimmed;
}

/** Characters saved before the state flow are approved if their official record is. */
export async function currentState(
  ctx: ReadCtx,
  row: NaruDocument | null,
): Promise<string | null> {
  if (!row) return null;
  if (CHARACTER_STATES.includes(row.data.state)) return row.data.state;
  return (await ctx.get(CHARACTER_STATE, row.id))?.data.approved === true
    ? "approved"
    : "editing";
}

/**
 * The sheet fields a member may write: custom values they may see (never the
 * site owner's admin-only fields, which are kept), main/sub type (an NPC stays
 * an NPC) and editing/submitted state (an approved character stays approved).
 * Submitting requires every required field the member can fill.
 *
 * The site owner writes every field, type and state, with no required
 * fields, as the original's admin form (adm/character_form.php:112-423).
 */
export async function memberSheet(
  ctx: Ctx,
  previous: NaruDocument | null,
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
  const before =
    previous?.data.fields && typeof previous.data.fields === "object"
      ? previous.data.fields
      : {};
  const fields = {};
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
  const was = previous?.data.type;
  const kept = CHARACTER_TYPES.includes(was) ? was : "main";
  const type = was === "npc" && !owner ? "npc" : (data.type ?? kept);
  if (
    !CHARACTER_TYPES.includes(type) ||
    (type === "npc" && was !== "npc" && !owner)
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const prior = await currentState(ctx, previous);
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
 * Approval and the official record's `approved` flag change together, so
 * shop and item conditions agree with the applicant list.
 */
export async function syncApproval(ctx: Ctx, row: NaruDocument, state: string) {
  const official = await characterState(ctx, row.id, author(row));
  if ((official.data.approved === true) !== (state === "approved"))
    await ctx.set(CHARACTER_STATE, row.id, {
      ...official.data,
      approved: state === "approved",
    });
}

/**
 * The member the site owner names by nickname, as the admin form names the
 * owner by ID (adm/character_form_update.php:9-13).
 */
export async function memberByNick(
  ctx: Ctx,
  nick: unknown,
): Promise<NaruDocument> {
  const found =
    typeof nick === "string" && nick.trim()
      ? (await ctx.list(PROFILES, { filter: { nick: nick.trim() }, size: 1 }))
          .documents[0]
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
  ctx: Ctx,
  profile: NaruDocument,
  character: string,
) {
  if (!profile.data.mainCharacter)
    await ctx.set(PROFILES, profile.id, {
      ...profile.data,
      mainCharacter: character,
    });
}
