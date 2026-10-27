// 데이터 복원하기 (adm/data_restore_update.php): a category's rows from a
// backup put back, a table at a time: the first call (`clear`) empties the
// category's rows of that table, and each writes up to 200 rows, of its
// columns alone.

import { ownerOnly } from "../../modules/access.js";
import { invalid } from "../../modules/admin.js";
import { BACKUP, BACKUP_ROWS } from "../../modules/backup.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export const restore = ownerOnly(async function restore(
  ctx: MutationCtx,
  {
    category,
    part = 0,
    clear = false,
    rows = [],
  }: {
    category?: string;
    part?: number;
    clear?: boolean;
    rows?: Record<string, unknown>[];
  } = {},
) {
  const entry = typeof category === "string" ? BACKUP[category] : undefined;
  if (
    !entry ||
    !Number.isInteger(part) ||
    !entry.parts[part] ||
    typeof clear !== "boolean" ||
    !Array.isArray(rows) ||
    rows.length > BACKUP_ROWS
  )
    invalid(ctx);
  const { table, where, columns } = entry.parts[part];
  for (const row of rows)
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !columns.includes(key)) ||
      Object.values(row).some(
        (value) =>
          value !== null &&
          !["string", "number", "boolean"].includes(typeof value),
      )
    )
      ctx.fail("INVALID_REQUEST", "백업 파일의 행을 확인해 주세요.", {
        reason: "invalid_row",
      });
  let cleared = 0;
  if (clear)
    cleared = (await ctx.sql(`DELETE FROM ${table} WHERE ${where}`)).changes;
  let written = 0;
  if (rows.length)
    written = (
      await ctx.sql(
        `INSERT OR REPLACE INTO ${table} (${columns.join(", ")})
         SELECT ${columns.map((column) => `json_extract(value, '$.${column}')`).join(", ")}
         FROM json_each(?)`,
        [JSON.stringify(rows)],
      )
    ).changes;
  return { cleared, written };
});
