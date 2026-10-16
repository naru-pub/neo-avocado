import test from "node:test";
import assert from "node:assert/strict";
import { resumeCleanup } from "../dist/admin-cleanup.js";
const P = "neo_avocado_";
function fixture() {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const put = (name, id, data) =>
    table(P + name).set(id, { id, revision: "r1", data });
  const batches = [];
  let conflict = false;
  const owner = {
    collection: (name) => ({
      get: async (id) => {
        const row = table(name).get(id);
        if (!row)
          throw Object.assign(new Error("missing"), { code: "NOT_FOUND" });
        return structuredClone(row);
      },
      list: async ({ filter, size }) => {
        const rows = [...table(name).values()].filter((row) =>
          Object.entries(filter).every(
            ([key, value]) => row.data[key] === value,
          ),
        );
        return {
          documents: structuredClone(rows.slice(0, size)),
          nextCursor: rows.length > size ? "next" : null,
        };
      },
    }),
    batch: async (operations) => {
      batches.push(structuredClone(operations));
      if (conflict)
        throw Object.assign(new Error("conflict"), { code: "CONFLICT" });
      for (const operation of operations) {
        const write = operation.set ?? operation.delete;
        assert.equal(
          table(operation.collection).get(write.id)?.revision,
          write.condition.revision,
        );
      }
      for (const operation of operations) {
        if (operation.set)
          table(operation.collection).set(operation.set.id, {
            ...operation.set,
            revision: "r2",
          });
        else table(operation.collection).delete(operation.delete.id);
      }
    },
  };
  return {
    owner,
    table,
    put,
    batches,
    conflict: () => {
      conflict = true;
    },
  };
}
test("recovery refuses active documents and a conflict leaves durable cleanup for retry", async () => {
  const f = fixture();
  f.put("logs", "l1", { deleted: false });
  await assert.rejects(resumeCleanup(f.owner, "logs", "l1"));
  assert.equal(f.batches.length, 0);
  f.put("logs", "l1", { deleted: true });
  f.put("comments", "x", { logId: "l1", text: "keep on conflict" });
  f.conflict();
  await assert.rejects(resumeCleanup(f.owner, "logs", "l1"), {
    code: "CONFLICT",
  });
  assert.equal(f.table(P + "comments").size, 1);
  assert.equal(f.table(P + "logs").get("l1").data.deleted, true);
});
