import {
  PREFIX,
  SIDES,
  CLASSES,
  deleteCommunityDocument,
  text,
  imageUrl,
} from "../../modules/shared.js";
import { notDeleted, startValue, startWrite } from "../../modules/community.js";
import { memberSheet, presentCharacter } from "../../modules/characters.js";

// A member's character sheets: name, side, profile, picture and the custom
// fields the admin defines. Members read them natively (rules/characters.js).

const CHARACTERS = `${PREFIX}characters`;

/**
 * Registers a character (no `id`) or edits one of the member's own (`id`,
 * with the `revision` it was read at). Custom fields are checked against
 * their definitions, and the sheet's type and state against the review.
 */
/**
 * A value from the owner's list (소속 or 종족), or any short text while the
 * list is empty. A value the character already has stays, so deleting it
 * from the list does not stop the member editing the rest.
 */
async function listed(ctx, collection, value, kept, label) {
  const chosen = text(value ?? "", 40);
  if (!chosen || chosen === kept) return chosen;
  const { documents } = await ctx.list(collection, { size: 100 });
  const names = documents
    .filter((row) => !row.data.deleted)
    .map((row) => row.data.name);
  if (names.length && !names.includes(chosen))
    ctx.fail("INVALID_REQUEST", `${label}을(를) 목록에서 골라 주세요.`, {
      reason: "invalid_input",
    });
  return chosen;
}

export async function save(
  ctx,
  { id = null, data = {}, revision = null } = {},
) {
  const { previous } = await startWrite(ctx, CHARACTERS, { id, revision });
  notDeleted(ctx, previous);
  if (!data || typeof data !== "object")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  let value = startValue(ctx, previous, null);
  const sheet = await memberSheet(ctx, previous, data);
  const catalogue = sheet.catalogue;
  value = {
    ...value,
    name: text(data.name, 40, true),
    side: await listed(ctx, SIDES, data.side, previous?.data.side, "소속"),
    class: await listed(
      ctx,
      CLASSES,
      data.class,
      previous?.data.class,
      "종족",
    ),
    profile: text(data.profile ?? "", 4000),
    type: sheet.type,
    state: sheet.state,
    fields: sheet.fields,
  };
  delete value.fieldMedia;
  if (data.image !== previous?.data.image)
    value.image = data.image ? imageUrl(data.image) : null;
  delete value.imageId;
  const document = previous
    ? await ctx.set(CHARACTERS, previous.id, value)
    : await ctx.add(CHARACTERS, value);
  return { document: await presentCharacter(ctx, document, { catalogue }) };
}

/**
 * Deletes one of the member's characters with what hangs off it, in bounded
 * steps: call again until it answers `done`.
 */
export async function remove(ctx, { id } = {}) {
  const { previous } = await startWrite(ctx, CHARACTERS, { id });
  return await deleteCommunityDocument(ctx, CHARACTERS, "characters", previous);
}
