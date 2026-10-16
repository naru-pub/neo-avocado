import test from "node:test";
import assert from "node:assert/strict";
import { applyTitles, deleteTitle } from "../dist/admin-titles.js";
const P = "neo_avocado_";
function fixture(count = 45) {
  const db = new Map(),
    batches = [];
  const table = (name) => {
    if (!db.has(name)) db.set(name, new Map());
    return db.get(name);
  };
  const put = (name, id, data) =>
    table(P + name).set(id, { id, data, revision: "r1" });
  put("titles", "award", { name: "Award" });
  for (let i = 0; i < count; i++) {
    put("characters", `c${i}`, {
      owner: "member",
      name: `Hero ${i}`,
      state: i !== 0 ? "approved" : "editing",
    });
    put("character_state", `c${i}`, {
      owner: "member",
      character: `c${i}`,
      approved: i !== 0,
      exp: 100,
      points: 5,
      stats: { hp: { max: 10, current: 7 } },
      titles: ["old"],
      activeTitle: "old",
    });
  }
  let failAt = null,
    sequence = 1;
  const owner = {
    collection: (name) => ({
      get: async (id) => {
        const row = table(name).get(id);
        if (!row)
          throw Object.assign(new Error("missing"), { code: "NOT_FOUND" });
        return structuredClone(row);
      },
      delete: async (id, { condition }) => {
        assert.equal(table(name).get(id)?.revision, condition.revision);
        table(name).delete(id);
        // The site's tables take a title from its holders with it.
        if (name === P + "titles")
          for (const row of table(P + "character_state").values()) {
            row.data.titles = row.data.titles.filter((title) => title !== id);
            if (row.data.activeTitle === id) row.data.activeTitle = null;
          }
      },
      set: async (id, data, { condition }) => {
        assert.equal(table(name).get(id)?.revision, condition.revision);
        table(name).set(id, {
          id,
          data: structuredClone(data),
          revision: `r${++sequence}`,
        });
      },
      async *pages({ filter = {} }) {
        yield {
          documents: structuredClone(
            [...table(name).values()].filter((row) =>
              Object.entries(filter).every(
                ([key, value]) => row.data[key] === value,
              ),
            ),
          ),
        };
      },
    }),
    batch: async (operations) => {
      if (batches.length === failAt)
        throw Object.assign(new Error("changed"), { code: "CONFLICT" });
      for (const { collection, set, delete: remove } of operations) {
        const write = set ?? remove;
        const row = table(collection).get(write.id);
        if (write.condition.absent) assert.equal(row, undefined);
        else assert.equal(row?.revision, write.condition.revision);
      }
      batches.push(operations);
      for (const { collection, set, delete: remove } of operations)
        if (remove) table(collection).delete(remove.id);
        else
          table(collection).set(set.id, {
            id: set.id,
            data: structuredClone(set.data),
            revision: `r${++sequence}`,
          });
    },
  };
  return {
    owner,
    table,
    batches,
    fail: (index) => {
      failAt = index;
    },
  };
}
test("all-approved grants are deduplicated across chunks and preserve official progression", async () => {
  const f = fixture();
  assert.equal(
    (
      await applyTitles(f.owner, "award", {
        action: "grant",
        allApproved: true,
      })
    ).completed,
    44,
  );
  assert.equal(f.batches.length, 3);
  assert.ok(f.batches.every((batch) => batch.length <= 41));
  assert.deepEqual(f.table(P + "character_state").get("c0").data.titles, [
    "old",
  ]);
  await applyTitles(f.owner, "award", { action: "grant", allApproved: true });
  const data = f.table(P + "character_state").get("c1").data;
  assert.deepEqual(data.titles, ["old", "award"]);
  assert.equal(data.exp, 100);
  assert.deepEqual(data.stats, { hp: { max: 10, current: 7 } });
  assert.equal(data.activeTitle, "old");
});
test("selected revocation clears equipped title and creates no missing progression", async () => {
  const f = fixture(2);
  const row = f.table(P + "character_state").get("c1");
  row.data.titles.push("award");
  row.data.activeTitle = "award";
  f.table(P + "character_state").delete("c0");
  await applyTitles(f.owner, "award", {
    action: "revoke",
    characterIds: ["c0", "c1", "c1"],
  });
  assert.equal(f.table(P + "character_state").has("c0"), false);
  assert.deepEqual(f.table(P + "character_state").get("c1").data.titles, [
    "old",
  ]);
  assert.equal(f.table(P + "character_state").get("c1").data.activeTitle, null);
});
test("a later conflict reports committed progress and a rerun safely finishes", async () => {
  const f = fixture(25);
  f.fail(1);
  await assert.rejects(
    applyTitles(f.owner, "award", { action: "grant", allApproved: true }),
    /20\/24명 처리 후 중단/,
  );
  assert.equal(
    f
      .table(P + "character_state")
      .get("c21")
      .data.titles.includes("award"),
    false,
  );
  f.fail(null);
  await applyTitles(f.owner, "award", { action: "grant", allApproved: true });
  for (let i = 1; i < 25; i++)
    assert.deepEqual(f.table(P + "character_state").get(`c${i}`).data.titles, [
      "old",
      "award",
    ]);
});

test("deleting a title counts its holders and leaves them their other titles and progression", async () => {
  const f = fixture(25);
  for (const row of f.table(P + "character_state").values()) {
    row.data.titles.push("award");
    row.data.activeTitle = "award";
  }
  const heard = [];
  assert.deepEqual(
    await deleteTitle(f.owner, "award", (status) => heard.push(status)),
    { completed: 25 },
  );
  assert.deepEqual(heard, [{ completed: 25, done: true }]);
  assert.equal(f.table(P + "titles").has("award"), false);
  for (const row of f.table(P + "character_state").values()) {
    assert.deepEqual(row.data.titles, ["old"]);
    assert.equal(row.data.activeTitle, null);
    assert.equal(row.data.exp, 100);
    assert.equal(row.data.stats.hp.current, 7);
  }
});
