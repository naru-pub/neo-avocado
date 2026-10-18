// 데이터 백업 (adm/data_backup_update.php): a category's rows, a table and a
// page at a time, which the page joins into one file to keep.
import { invalid } from "../../modules/admin.js";
import { ownerOnly } from "../../modules/access.js";
import { BACKUP, BACKUP_ROWS } from "../../modules/backup.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** The categories and their tables, as the page offers them. */
export const categories = ownerOnly(async function categories() {
  return Object.entries(BACKUP).map(([id, { label, parts }]) => ({
    id,
    label,
    tables: parts.length,
  }));
});

export const rows = ownerOnly(async function rows(
  ctx: QueryCtx,
  {
    category,
    part = 0,
    after = 0,
  }: { category?: string; part?: number; after?: number } = {},
) {
  const entry = typeof category === "string" ? BACKUP[category] : undefined;
  if (
    !entry ||
    !Number.isInteger(part) ||
    !entry.parts[part] ||
    !Number.isSafeInteger(after)
  )
    invalid(ctx);
  const { table, where, columns } = entry.parts[part];
  const { rows: found } = await ctx.sql(
    `SELECT rowid AS backup_rowid, ${columns.join(", ")} FROM ${table}
     WHERE (${where}) AND rowid > ? ORDER BY rowid LIMIT ?`,
    [after, BACKUP_ROWS + 1],
  );
  const page = found.slice(0, BACKUP_ROWS);
  return {
    table,
    rows: page.map(({ backup_rowid, ...row }) => row),
    next: found.length > BACKUP_ROWS ? Number(page.at(-1).backup_rowid) : null,
  };
});
