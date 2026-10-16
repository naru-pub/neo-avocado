// For the time being: the owner's admin page writes the foundation's tables
// as the documents it knows (modules/documents.ts), until the admin area is
// ported to mutations of its own.
import {
  documentsOf,
  getDocument,
  ownerMapping,
  rolesOfData,
  rowOf,
  settingsKey,
} from "../../modules/documents.js";
import type { Mapping } from "../../modules/documents.js";
import type { MutationCtx, SqlValue } from "../../modules/naru-types.js";

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
  if (
    typeof id !== "string" ||
    !id ||
    data === null ||
    typeof data !== "object"
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const row = rowOf(map, data, ctx.now);
  const columns = Object.keys(row);
  const values: SqlValue[] = Object.values(row);
  if (map.generated) {
    // History is only added to: a new row, whatever ID the page made up.
    const { rows } = await ctx.sql(
      `INSERT INTO ${map.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`,
      values,
    );
    return (await documentsOf(ctx, map, rows))[0];
  }
  const key = map.settings ? settingsKey(map, id) : id;
  const { rows } = await ctx.sql(
    `INSERT INTO ${map.table} (${map.key}, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})
     ON CONFLICT (${map.key}) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}
     RETURNING *`,
    [key, ...values],
  );
  if (map.roles) {
    const before = (await ctx.rolesOf([id]))[id] ?? [];
    const after = rolesOfData(data, before);
    if (after.join() !== [...before].sort().join())
      await ctx.setRoles(id, after);
  }
  return (await documentsOf(ctx, map, rows))[0];
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
  if (typeof id !== "string" || (map.generated && !/^\d{1,15}$/.test(id)))
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const key = map.settings
    ? settingsKey(map, id)
    : map.generated
      ? Number(id)
      : id;
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
