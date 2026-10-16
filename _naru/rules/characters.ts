// Publish as _naru/rules/characters.js and enable it on neo_avocado_characters
// (world read, admin write): members, and visitors while the site is open
// (사이트공개), read character sheets natively, and see only the custom
// fields they may (public, or owner-visible on their own). Writes go through
// the characters/sheet site function.
import { PREFIX, siteOpen } from "../modules/shared.js";
import { fieldCatalogue, fieldVisible } from "../modules/characters.js";
import type { FieldDefinition } from "../modules/characters.js";
import type {
  Data,
  PresentArgs,
  ReadArgs,
  ReadCtx,
  Where,
} from "../modules/naru-types.js";

const CHARACTERS = `${PREFIX}characters`;

/** Fields members may filter and sort on: none that present() hides. */
export const queryable = ["owner", "name", "side", "state", "type", "deleted"];

export async function readable(
  ctx: ReadCtx,
  { collection }: ReadArgs,
): Promise<Where> {
  if (collection !== CHARACTERS) return false;
  // A closed site sends visitors to log in (extend/community.config.php).
  if (!ctx.member && !(await siteOpen(ctx))) return false;
  return { ne: ["deleted", true] };
}

// One rule call presents a whole page: read the definitions once for it.
let catalogue: FieldDefinition[] | undefined;
export async function present(
  ctx: ReadCtx,
  { document }: PresentArgs,
): Promise<Data> {
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

export function canWrite(): boolean {
  return false;
}
