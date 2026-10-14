// Character sheets: the owner's custom profile fields, their visibility, the
// application state flow (editing → submitted → approved) and character types.
// Mirrors adm/character_article_list.php and mypage/character/character_form*.
import {
  CHARACTER_FIELDS,
  CHARACTER_STATE,
  MAX_FIELD_MEDIA,
  MEDIA,
  attachRef,
  author,
  fail,
  fieldMediaOf,
  fieldRef,
  imageUrl,
  mediaId,
  releaseRef,
  weightedRows,
} from "./shared.js";

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

const fieldCode = (code) =>
  typeof code === "string" &&
  /^[a-z][a-z0-9_]{0,31}$/.test(code) &&
  !["constructor", "prototype"].includes(code);

/** Valid definitions in display order. Malformed rows are skipped, not trusted. */
export async function fieldCatalogue(ctx) {
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
export function fieldVisible(ctx, definition, row) {
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
  ctx,
  row,
  { list = false, catalogue = null } = {},
) {
  if (!row || ctx.owner) return row;
  const { fields, fieldMedia, ...data } = row.data;
  // Upload IDs matter only to the character's owner, who edits the sheet.
  if (fieldMedia && ctx.member && author(row) === ctx.member.id)
    data.fieldMedia = fieldMedia;
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

function fieldValue(ctx, definition, value) {
  if (typeof value !== "string" || value.length > FIELD_LIMITS[definition.type])
    fail(
      ctx,
      "INVALID_REQUEST",
      "invalid_field",
      definition.label || definition.code,
    );
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (definition.type === "select" && !definition.options.includes(trimmed))
    fail(
      ctx,
      "INVALID_REQUEST",
      "invalid_field",
      definition.label || definition.code,
    );
  if (definition.type === "url" || definition.type === "image") {
    try {
      return imageUrl(trimmed);
    } catch {
      fail(
        ctx,
        "INVALID_REQUEST",
        "invalid_field",
        definition.label || definition.code,
      );
    }
  }
  if (definition.type === "text" && /[\r\n]/.test(trimmed))
    fail(
      ctx,
      "INVALID_REQUEST",
      "invalid_field",
      definition.label || definition.code,
    );
  return trimmed;
}

/** Characters saved before the state flow are approved if their official record is. */
export async function currentState(ctx, row) {
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
 */
export async function memberSheet(ctx, previous, data) {
  const catalogue = await fieldCatalogue(ctx);
  const input = data.fields ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(ctx, "INVALID_REQUEST", "invalid_field", "Invalid profile fields.");
  const editable = new Map(
    catalogue
      .filter((definition) => definition.visibility !== "admin")
      .map((definition) => [definition.code, definition]),
  );
  for (const code of Object.keys(input))
    if (!editable.has(code))
      fail(ctx, "INVALID_REQUEST", "invalid_field", `Unknown field ${code}.`);
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
    fail(ctx, "INVALID_REQUEST", "fields_too_long", "Profile is too long.");
  const was = previous?.data.type;
  const type =
    was === "npc"
      ? "npc"
      : (data.type ?? (CHARACTER_TYPES.includes(was) ? was : "main"));
  if (
    !["main", "sub", "npc"].includes(type) ||
    (type === "npc" && was !== "npc")
  )
    fail(ctx, "INVALID_REQUEST", "invalid_input", "Invalid character type.");
  const prior = await currentState(ctx, previous);
  let state =
    prior === "approved" ? "approved" : (data.state ?? prior ?? "editing");
  if (prior !== "approved" && !["editing", "submitted"].includes(state))
    fail(ctx, "INVALID_REQUEST", "invalid_input", "Invalid character state.");
  if (
    state === "submitted" &&
    catalogue.some(
      (definition) =>
        definition.required &&
        editable.has(definition.code) &&
        !Object.hasOwn(fields, definition.code),
    )
  )
    fail(ctx, "INVALID_REQUEST", "missing_fields", "Required fields missing.");
  return { fields, type, state, catalogue };
}

/**
 * Which uploads back the character's image fields. A new upload must be the
 * caller's and match the field's address; an unchanged address keeps its
 * upload. Reads only: references move in `moveFieldMedia` after the save.
 */
export async function fieldMedia(ctx, previous, fields, input, catalogue) {
  if (
    input !== undefined &&
    (!input || typeof input !== "object" || Array.isArray(input))
  )
    fail(ctx, "INVALID_REQUEST", "invalid_field", "Invalid field uploads.");
  const before = Object.fromEntries(fieldMediaOf(previous?.data));
  const result = {};
  for (const definition of catalogue) {
    if (definition.type !== "image") continue;
    const code = definition.code;
    const value = fields[code] ?? null;
    let id =
      value && value === previous?.data.fields?.[code]
        ? (before[code] ?? null)
        : null;
    if (input && Object.hasOwn(input, code)) {
      id = typeof input[code] === "string" ? input[code].toLowerCase() : null;
      // An old upload stays only while the field keeps its address.
      if (id && id === before[code] && value !== previous?.data.fields?.[code])
        id = null;
      if (id && id !== before[code]) {
        const asset = mediaId(id) ? await ctx.get(MEDIA, id) : null;
        if (
          !asset ||
          asset.data.url !== value ||
          asset.data.status === "deleting" ||
          asset.data.owner !== ctx.member?.id
        )
          fail(ctx, "CONFLICT", "media_unavailable", "Media is unavailable.");
      }
    }
    if (id && value) result[code] = id;
  }
  for (const code of Object.keys(input ?? {}))
    if (!catalogue.some((row) => row.code === code && row.type === "image"))
      fail(ctx, "INVALID_REQUEST", "invalid_field", `Unknown field ${code}.`);
  if (Object.keys(result).length > MAX_FIELD_MEDIA)
    fail(ctx, "INVALID_REQUEST", "field_media_limit", "Too many uploads.");
  return result;
}

/** Moves image-field references from the previous sheet to the saved one. */
export async function moveFieldMedia(ctx, collection, previous, saved) {
  const before = Object.fromEntries(fieldMediaOf(previous?.data));
  const after = Object.fromEntries(fieldMediaOf(saved.data));
  for (const [code, id] of Object.entries(before))
    if (after[code] !== id)
      await releaseRef(ctx, id, fieldRef(collection, saved.id, code));
  for (const [code, id] of Object.entries(after))
    if (before[code] !== id)
      await attachRef(ctx, id, fieldRef(collection, saved.id, code));
}
