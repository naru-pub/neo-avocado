// For the time being: the owner's admin page writes the site's tables
// as the documents it knows (modules/documents.ts), until the admin area is
// ported to mutations of its own.
import {
  getDocument,
  keyOf,
  ownerMapping,
  rolesOfData,
  writeStatements,
} from "../../modules/documents.js";
import type { Mapping } from "../../modules/documents.js";
import type { MutationCtx } from "../../modules/naru-types.js";

type Condition = { revision?: string; absent?: boolean } | null | undefined;
type Write =
  | {
      collection: string;
      set: { id: string; data: Record<string, any>; condition?: Condition };
    }
  | { collection: string; delete: { id: string } };

async function check(
  ctx: MutationCtx,
  collection: string,
  id: string,
  condition: Condition,
) {
  if (!condition) return;
  const current = await getDocument(ctx, { collection, id });
  if (
    (condition.absent && current) ||
    (condition.revision !== undefined &&
      current?.revision !== condition.revision)
  )
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
}

async function write(
  ctx: MutationCtx,
  map: Mapping,
  id: string,
  data: Record<string, any>,
) {
  const key = map.generated ? 0 : keyOf(map, id);
  if (
    typeof id !== "string" ||
    !id ||
    (key === null && !map.numbered) ||
    data === null ||
    typeof data !== "object"
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  // History is only added to: a new row, whatever ID the page made up; an
  // inventory row is added for an ID that names none.
  const { write: statement, after } = writeStatements(map, key, data, ctx.now);
  const { rows } = await ctx.sql(statement.text, statement.values);
  // A partial row (a character's official record) is its character's.
  if (!rows.length)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  for (const next of after) await ctx.sql(next.text, next.values);
  if (map.roles) {
    const before = (await ctx.rolesOf([id]))[id] ?? [];
    const roles = rolesOfData(data, before);
    if (roles.join() !== [...before].sort().join())
      await ctx.setRoles(id, roles);
  }
  return await getDocument(ctx, {
    collection: map.collection,
    id: map.generated || map.numbered ? String(rows[0][map.key]) : id,
  });
}

/** Creates or replaces a document, if `condition` still holds. */
export async function set(
  ctx: MutationCtx,
  {
    collection,
    id,
    data,
    condition,
  }: {
    collection?: string;
    id?: string;
    data?: Record<string, any>;
    condition?: Condition;
  } = {},
) {
  const map = ownerMapping(ctx, collection);
  await check(ctx, collection, id, condition);
  return await write(ctx, map, id, data);
}

/** Deletes a document; one already gone is fine. */
export async function remove(
  ctx: MutationCtx,
  { collection, id }: { collection?: string; id?: string } = {},
) {
  const map = ownerMapping(ctx, collection);
  const key = keyOf(map, id);
  if (key === null || map.partial)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  for (const statement of map.cascade?.(key) ?? [])
    await ctx.sql(statement.text, statement.values);
  await ctx.sql(`DELETE FROM ${map.table} WHERE ${map.key} = ?`, [key]);
  if (map.roles) {
    const before = (await ctx.rolesOf([id]))[id] ?? [];
    const after = rolesOfData({}, before);
    if (after.join() !== [...before].sort().join())
      await ctx.setRoles(id, after);
  }
  return null;
}

/** Several writes in one transaction, as the SDK's batch: each one's document, or null. */
export async function batch(
  ctx: MutationCtx,
  { writes }: { writes?: Write[] } = {},
) {
  if (!Array.isArray(writes) || writes.length > 20)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const results = [];
  for (const entry of writes)
    if ("set" in entry)
      results.push(
        await set(ctx, { collection: entry.collection, ...entry.set }),
      );
    else
      results.push(
        await remove(ctx, {
          collection: entry.collection,
          id: entry.delete?.id,
        }),
      );
  return results;
}
