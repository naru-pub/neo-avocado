// For the time being: the owner's admin page reads the site's tables
// as the documents it knows (modules/documents.ts), until the admin area is
// ported to queries of its own.
import {
  documentsOf,
  getDocument,
  ownerMapping,
  selectOf,
} from "../../modules/documents.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

/** One document, or null. */
export const get = (
  ctx: QueryCtx,
  args: { collection?: string; id?: string } = {},
) => getDocument(ctx, args);

/**
 * A page of documents, 100 at most, in key order (history newest first);
 * `filter` matches fields with columns of their own.
 */
export async function list(
  ctx: QueryCtx,
  {
    collection,
    size = 50,
    after = null,
    filter = {},
  }: {
    collection?: string;
    size?: number;
    after?: string | null;
    filter?: Record<string, SqlValue>;
  } = {},
) {
  const map = ownerMapping(ctx, collection);
  const offset = after === null ? 0 : Number(after);
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  if (map.settings && map.settings !== true) {
    clauses.push("key = ?");
    values.push(map.settings.key);
  }
  for (const [field, value] of Object.entries(filter ?? {})) {
    const column = map.columns.find(([name]) => name === field);
    if (!column)
      ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
        reason: "invalid_input",
      });
    clauses.push(`${column[1]} = ?`);
    values.push(
      typeof value === "boolean"
        ? value
          ? 1
          : 0
        : column[2] === "ref"
          ? Number(value)
          : value,
    );
  }
  values.push(size + 1, offset);
  const { rows } = await ctx.sql(
    `${selectOf(map)}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY ${map.order} LIMIT ? OFFSET ?`,
    values,
  );
  return {
    documents: await documentsOf(ctx, map, rows.slice(0, size)),
    nextCursor: rows.length > size ? String(offset + size) : null,
  };
}
