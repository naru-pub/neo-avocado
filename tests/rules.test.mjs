import test from "node:test";
import assert from "node:assert/strict";
import * as boards from "../dist/_naru/rules/boards.js";
import * as shown from "../dist/_naru/rules/shown.js";
import { database, migrations, sqlOf } from "./sql-ctx.mjs";
import {
  mappingOf,
  rolesOfData,
  rowOf,
} from "../dist/_naru/modules/documents.js";

const P = "neo_avocado_";
const MIGRATIONS = await migrations();
/**
 * A rule's ctx: reads over `tables`, as `member` (null for a visitor). The
 * collections the foundation moved (settings, members) are its tables, read
 * through ctx.sql as Naru lets a rule; a rule's member carries no roles.
 */
function rulesCtx(member, tables = {}) {
  const db = database(MIGRATIONS);
  const roles = {};
  for (const [name, documents] of Object.entries(tables)) {
    const map = mappingOf(name);
    if (!map) continue;
    for (const [id, data] of Object.entries(documents)) {
      const row = {
        [map.key]: map.settings ? id : id,
        ...rowOf(map, data, 0),
      };
      const columns = Object.keys(row);
      db.prepare(
        `INSERT INTO ${map.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      ).run(...Object.values(row));
      if (map.roles) roles[id] = rolesOfData(data);
    }
  }
  const rows = (name) =>
    Object.entries(tables[name] ?? {}).map(([id, data]) => ({ id, data }));
  return {
    member: member ? { id: member, roles: [] } : null,
    get: async (name, id) => rows(name).find((row) => row.id === id) ?? null,
    list: async (name) => ({ documents: rows(name), nextCursor: null }),
    sql: sqlOf(db, "query"),
    rolesOf: async (ids) =>
      Object.fromEntries(ids.map((id) => [id, roles[id] ?? []])),
  };
}

test("boards: each level lists only the boards it may", async () => {
  const tables = {
    [`${P}boards`]: {
      open: { listLevel: 1 },
      members: { listLevel: 2 },
      staff: { listLevel: 5 },
      closed: { listLevel: 1, enabled: false },
    },
    [`${P}members`]: { senior: { level: 5 }, mod: { role: "moderator" } },
  };
  const ids = async (member) =>
    (await boards.readable(rulesCtx(member, tables))).in?.[1] ?? [];
  assert.deepEqual(await ids(null), ["open"]);
  assert.deepEqual(await ids("m-1"), ["open", "members"]);
  assert.deepEqual(await ids("senior"), ["open", "members", "staff"]);
  // A moderator is the Naru role staff, which a rule asks Naru for.
  assert.deepEqual(await ids("mod"), ["open", "members", "staff", "closed"]);
  assert.equal(
    await boards.readable(rulesCtx(null, { [`${P}boards`]: {} })),
    false,
  );
  assert.equal(boards.canWrite(), false);
});

test("사이트공개 off: visitors read no catalogues or boards; members read on", async () => {
  const closed = { [`${P}settings`]: { community: { siteOpen: false } } };
  for (const [rule, collection] of [
    [shown, "emoticons"],
    [shown, "board_groups"],
  ]) {
    const scope = (member, tables) =>
      rule.readable(rulesCtx(member, tables), {
        collection: `${P}${collection}`,
      });
    assert.equal(await scope(null, closed), false, collection);
    assert.notEqual(await scope(null, {}), false, collection);
    assert.notEqual(await scope("m-1", closed), false, collection);
  }
  // The boards rule (and with it posts) has the closed site's level 0.
  const boardsOf = (tables) =>
    boards.readable(
      rulesCtx(null, {
        [`${P}boards`]: { open: { listLevel: 1 } },
        ...tables,
      }),
    );
  assert.equal(await boardsOf(closed), false);
  assert.deepEqual(await boardsOf({}), { in: [{ metadata: "id" }, ["open"]] });
});

test("the declaration names a rule file for every rule it uses", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const { collections } = JSON.parse(
    await readFile(
      new URL("../dist/_naru/collections.json", import.meta.url),
      "utf8",
    ),
  );
  const files = await readdir(new URL("../dist/_naru/rules", import.meta.url));
  for (const [name, entry] of Object.entries(collections))
    if (entry.rules)
      assert.ok(files.includes(`${entry.rules}.js`), `${name}: ${entry.rules}`);
});
