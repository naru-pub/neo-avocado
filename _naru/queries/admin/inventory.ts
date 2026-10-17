// 아이템 지급·보유 현황 (adm/inventory_list.php): every copy members and their
// characters hold, a page at a time, each with its owner's nickname and its
// character's name, and one copy.
import {
  PAGE,
  TABLES,
  getRecord,
  offsetOf,
  pageOf,
  recordOf,
} from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import type { QueryCtx } from "../../modules/naru-types.js";

export const list = ownerOnly(async function list(
  ctx: QueryCtx,
  { after = null }: { after?: string | null } = {},
) {
  const offset = offsetOf(ctx, after);
  const { rows } = await ctx.sql(
    `SELECT inventory.*, profiles.nick AS owner_nick, characters.name AS character_name
     FROM inventory
     LEFT JOIN profiles ON profiles.member = inventory.owner
     LEFT JOIN characters ON characters.id = inventory.character_id
     ORDER BY inventory.id LIMIT ? OFFSET ?`,
    [PAGE + 1, offset],
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
