import { invalid, ownerOnly } from "../../modules/access.js";
import type { CharacterRow } from "../../modules/characters.js";
import {
  CHARACTER_STATES,
  CHARACTER_TYPES,
  characterRow,
  checkRevision,
  fieldCatalogue,
  fieldsOf,
  MAX_FIELD_TEXT,
  presentCharacter,
  stateChanged,
} from "../../modules/characters.js";
import type { MutationCtx } from "../../modules/naru-types.js";

/**
 * The site owner's review of a character application (adm/character_form):
 * state editing/submitted/approved, or deleted (선택삭제) and back, main/sub/NPC
 * type and admin-only fields.
 * Approval is the sheet's state, so shop and item conditions agree with the
 * applicant list.
 */
export const reviewCharacter = ownerOnly(async function reviewCharacter(
  ctx: MutationCtx,
  {
    character,
    state,
    type,
    fields,
    revision,
  }: {
    character?: string;
    state?: string;
    type?: string;
    /** Admin-only field values, by field code. */
    fields?: Record<string, unknown>;
    revision?: string;
  } = {},
) {
  const row = await characterRow(ctx, character);
  if (!row)
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  checkRevision(ctx, row, revision);
  if (state !== undefined && !CHARACTER_STATES.includes(state)) invalid(ctx);
  if (type !== undefined && !CHARACTER_TYPES.includes(type)) invalid(ctx);
  const values: Record<string, string> = fieldsOf(row);
  if (fields !== undefined) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields))
      invalid(ctx);
    const admin = new Map(
      (await fieldCatalogue(ctx))
        .filter((definition) => definition.visibility === "admin")
        .map((definition) => [definition.code, definition]),
    );
    for (const [code, value] of Object.entries(fields)) {
      const definition = admin.get(code);
      if (!definition || typeof value !== "string" || value.length > 2000)
        invalid(ctx);
      if (value.trim()) values[code] = value.trim();
      else delete values[code];
    }
    if (
      Object.values(values).reduce(
        (total, value) => total + String(value).length,
        0,
      ) > MAX_FIELD_TEXT
    )
      ctx.fail(
        "INVALID_REQUEST",
        "추가 프로필 항목은 합쳐서 6,000자까지입니다.",
        { reason: "fields_too_long" },
      );
  }
  const saved = (
    await ctx.sql<CharacterRow>`
      UPDATE characters SET fields = ${JSON.stringify(values)},
        state = ${state ?? row.state}, type = ${type ?? row.type},
        version = version + 1
      WHERE id = ${row.id} RETURNING *`
  ).rows[0];
  await stateChanged(ctx, row, saved);
  return { document: await presentCharacter(ctx, saved) };
});
