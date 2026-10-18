// 아이템 지급·보유 현황 (adm/inventory_list.php): every copy members and their
// characters hold, a page at a time, each with its owner's nickname and its
// character's name, and one copy.
import {
  PAGE,
  TABLES,
  getRecord,
  invalid,
  offsetOf,
  pageOf,
  recordOf,
} from "../../modules/admin.js";
import { containing, ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

// Searched as adm/inventory_list.php: `field` (nick, character or item)
// holding `text`.
const FIELDS = {
  nick: "inventory.owner IN (SELECT member FROM profiles WHERE nick LIKE ? ESCAPE '\\' LIMIT 100)",
  character:
    "inventory.character_id IN (SELECT id FROM characters WHERE name LIKE ? ESCAPE '\\' LIMIT 100)",
  item: "inventory.name LIKE ? ESCAPE '\\'",
};

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  {
    after = null,
    field = "nick",
    text = "",
  }: { after?: string | null; field?: string; text?: string } = {},
) {
  if (
    !Object.hasOwn(FIELDS, field) ||
    typeof text !== "string" ||
    text.length > 40
  )
    invalid(ctx);
  const offset = offsetOf(ctx, after);
  const search = text.trim();
  const { rows } = await ctx.sql(
    `SELECT inventory.*, profiles.nick AS owner_nick, characters.name AS character_name
     FROM inventory
     LEFT JOIN profiles ON profiles.member = inventory.owner
     LEFT JOIN characters ON characters.id = inventory.character_id
     ${search ? `WHERE ${FIELDS[field]}` : ""}
     ORDER BY inventory.id LIMIT ? OFFSET ?`,
    [...(search ? [containing(search)] : []), PAGE + 1, offset],
  );
  return pageOf(
    rows.map((row) => ({
      ...recordOf(TABLES.inventory, row),
      ownerNick: row.owner_nick,
      characterName: row.character_name,
    })),
    offset,
  );
});

export const get = ownerOnly((ctx: QueryCtx, args: { id?: string }) =>
  getRecord(ctx, "inventory", args),
);
