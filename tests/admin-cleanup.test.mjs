import test from "node:test";
import assert from "node:assert/strict";
import { resumeCleanup } from "../admin-cleanup.js";
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
test("owner recovery finishes large character cleanup in guarded batches and preserves assets", async () => {
  const f = fixture();
  f.put("characters", "c1", { owner: "m1", deleted: true });
  f.put("profiles", "m1", { nick: "Member", mainCharacter: "c1" });
  f.put("character_state", "c1", { titles: [] });
  f.put("wallets", "m1", { balance: 100 });
  f.put("history", "h1", { owner: "m1", delta: 100 });
  for (let i = 0; i < 12; i++) {
    f.put("relations", `r${i}`, { character: "c1", target: "other" });
    f.put("wardrobe", `w${i}`, { character: "c1" });
    f.put("inventory", `i${i}`, {
      character: "c1",
      owner: "m1",
      item: "sword",
      memo: "Keep",
    });
    f.put("couples", `a${i}`, { first: "c1", second: "other" });
    f.put("couples", `b${i}`, { first: "other", second: "c1" });
  }
  let done = false,
    calls = 0;
  while (!done && calls++ < 20)
    done = (await resumeCleanup(f.owner, "characters", "c1")).done;
  assert.equal(done, true);
  assert.ok(calls > 1);
  assert.ok(f.batches.every((batch) => batch.length <= 23));
  assert.equal(f.table(P + "characters").size, 0);
  for (const name of ["relations", "wardrobe", "couples", "character_state"])
    assert.equal(f.table(P + name).size, 0);
  assert.equal(f.table(P + "profiles").get("m1").data.mainCharacter, null);
  assert.equal(f.table(P + "inventory").size, 12);
  assert.ok(
    [...f.table(P + "inventory").values()].every(
      (row) => row.data.character === null && row.data.memo === "Keep",
    ),
  );
  assert.equal(f.table(P + "wallets").get("m1").data.balance, 100);
  assert.equal(f.table(P + "history").size, 1);
});
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

test("owner cascade releases managed media references in the guarded document batch", async () => {
  const f = fixture();
  const id = "0190f1a2-0000-7000-8000-000000000001";
  f.put("characters", "hero", { owner: "me", deleted: true, imageId: id });
  f.put("wardrobe", "outfit", { character: "hero", imageId: id });
  f.put("media_assets", id, {
    owner: "me",
    status: "active",
    cleanup: false,
    refs: [`${P}characters/hero`, `${P}wardrobe/outfit`],
  });
  await resumeCleanup(f.owner, "characters", "hero");
  assert.equal(f.table(`${P}characters`).has("hero"), false);
  assert.deepEqual(f.table(`${P}media_assets`).get(id).data.refs, []);
  assert.equal(f.table(`${P}media_assets`).get(id).data.cleanup, true);
  assert.equal(f.batches.length, 1);
});
