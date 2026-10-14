import {
  CHARACTERS,
  CHARACTER_STATE,
  author,
  characterState,
  failure,
} from "../../modules/shared.js";
import {
  CHARACTER_STATES,
  CHARACTER_TYPES,
  MAX_FIELD_TEXT,
  fieldCatalogue,
} from "../../modules/characters.js";

/**
 * The site owner's review of a character application (adm/character_form):
 * state editing/submitted/approved, main/sub/NPC type and admin-only fields.
 * Approval and the official record's `approved` flag change together, so shop
 * and item conditions agree with the applicant list.
 */
export async function reviewCharacter(
  ctx,
  { character, state, type, fields, revision } = {},
) {
  if (!ctx.owner) ctx.fail("ACCESS_DENIED", "Only the site owner reviews.");
  const row =
    typeof character === "string" ? await ctx.get(CHARACTERS, character) : null;
  if (!row || row.data.deleted) return failure("no_character");
  if (revision !== undefined && revision !== row.revision)
    return failure("conflict");
  if (state !== undefined && !CHARACTER_STATES.includes(state))
    return failure("invalid_input");
  if (type !== undefined && !CHARACTER_TYPES.includes(type))
    return failure("invalid_input");
  const values = { ...(row.data.fields ?? {}) };
  if (fields !== undefined) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields))
      return failure("invalid_input");
    const admin = new Map(
      (await fieldCatalogue(ctx))
        .filter((definition) => definition.visibility === "admin")
        .map((definition) => [definition.code, definition]),
    );
    for (const [code, value] of Object.entries(fields)) {
      const definition = admin.get(code);
      if (!definition || typeof value !== "string" || value.length > 2000)
        return failure("invalid_input");
      if (value.trim()) values[code] = value.trim();
      else delete values[code];
    }
    if (
      Object.values(values).reduce(
        (total, value) => total + String(value).length,
        0,
      ) > MAX_FIELD_TEXT
    )
      return failure("fields_too_long");
  }
  const document = await ctx.set(CHARACTERS, row.id, {
    ...row.data,
    fields: values,
    ...(state !== undefined ? { state } : {}),
    ...(type !== undefined ? { type } : {}),
  });
  if (state !== undefined) {
    const official = await characterState(ctx, row.id, author(row));
    if ((official.data.approved === true) !== (state === "approved"))
      await ctx.set(CHARACTER_STATE, row.id, {
        ...official.data,
        approved: state === "approved",
      });
  }
  return { ok: true, document };
}
