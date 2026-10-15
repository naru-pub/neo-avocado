// Publish as _naru/rules/characters.js and enable it on neo_avocado_characters
// (member read, admin write): members read character sheets natively, and see
// only the custom fields they may (public, or owner-visible on their own).
// Writes go through the characters/sheet site function.
import { PREFIX } from "../modules/shared.js";
import { fieldCatalogue, fieldVisible } from "../modules/characters.js";

const CHARACTERS = `${PREFIX}characters`;

/** Fields members may filter and sort on: none that present() hides. */
export const queryable = ["owner", "name", "side", "state", "type", "deleted"];

export async function readable(ctx, { collection }) {
  if (!ctx.member || collection !== CHARACTERS) return false;
  return { ne: ["deleted", true] };
}

// One rule call presents a whole page: read the definitions once for it.
let catalogue;
export async function present(ctx, { document }) {
  catalogue ??= await fieldCatalogue(ctx);
  // fieldMedia and imageId belonged to the former upload ledger.
  const { fields, fieldMedia, imageId, ...data } = document.data;
  const visible = {};
  for (const definition of catalogue)
    if (
      fields &&
      typeof fields === "object" &&
      Object.hasOwn(fields, definition.code) &&
      fieldVisible(ctx, definition, document)
    )
      visible[definition.code] = fields[definition.code];
  return { ...data, fields: visible };
}

export function canWrite() {
  return false;
}
