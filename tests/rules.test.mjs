import test from "node:test";
import assert from "node:assert/strict";
import * as boards from "../dist/_naru/rules/boards.js";
import * as own from "../dist/_naru/rules/own.js";
import * as characterFields from "../dist/_naru/rules/character-fields.js";
import * as shown from "../dist/_naru/rules/shown.js";
import * as characters from "../dist/_naru/rules/characters.js";
import { matches } from "./where.mjs";
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

test("own: a member reads their own inventory, a visitor nothing", () => {
  assert.deepEqual(
    own.readable(rulesCtx("m-1"), { collection: `${P}inventory` }),
    { eq: ["owner", "m-1"] },
  );
  assert.equal(
    own.readable(rulesCtx(null), { collection: `${P}inventory` }),
    false,
  );
});

test("character fields and catalogues hide what members may not see", async () => {
  assert.deepEqual(await characterFields.readable(rulesCtx("m-1")), {
    all: [{ ne: ["deleted", true] }, { ne: ["visibility", "admin"] }],
  });
  assert.deepEqual(
    await shown.readable(rulesCtx("m-1"), { collection: `${P}titles` }),
    { all: [{ ne: ["deleted", true] }, { ne: ["enabled", false] }] },
  );
});

test("사이트공개 off: visitors read no characters, fields or catalogues; members read on", async () => {
  const closed = { [`${P}settings`]: { community: { siteOpen: false } } };
  for (const [rule, collection] of [
    [characters, "characters"],
    [characterFields, "character_fields"],
    [shown, "sides"],
    [shown, "classes"],
    [shown, "titles"],
    [shown, "relations"],
    [shown, "wardrobe"],
    [shown, "couples"],
    [shown, "emoticons"],
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

test("hidden recipes are no one's to read; hidden items only where the original shows them", async () => {
  const tables = {
    [`${P}items`]: {
      sword: { name: "검" },
      prize: { name: "경품", hidden: true },
      elixir: { name: "비약", hidden: true },
      secret: { name: "비밀", hidden: true },
      mine: { name: "내 것", hidden: true },
      gone: { name: "지운 것", deleted: true },
    },
    [`${P}recipes`]: {
      open: { item: "elixir", ingredients: [{ item: "sword", count: 1 }] },
      closed: { item: "secret", ingredients: [], hidden: true },
    },
    [`${P}inventory`]: { a: { owner: "m-1", item: "mine" } },
  };
  // A ctx whose lists apply their filter and where, as Naru's do.
  const base = rulesCtx("m-1", tables);
  const ctx = {
    ...base,
    list: async (name, { filter = {}, where } = {}) => ({
      documents: (await base.list(name)).documents.filter(
        (row) =>
          Object.entries(filter).every(
            ([key, value]) => row.data[key] === value,
          ) && matches(row, where),
      ),
      nextCursor: null,
    }),
  };
  const read = async (collection, member = "m-1") => {
    const scope = await shown.readable(
      { ...ctx, member: member ? { id: member } : null },
      { collection },
    );
    return Object.entries(tables[collection])
      .map(([id, data]) => ({ id, data }))
      .filter((row) => matches(row, scope))
      .map((row) => row.id);
  };
  assert.deepEqual(await read(`${P}recipes`), ["open"]);
  // Shop items, the reader's own, and those of a recipe they can see.
  assert.deepEqual(await read(`${P}items`), ["sword", "elixir", "mine"]);
  assert.deepEqual(await read(`${P}items`, "m-2"), ["sword", "elixir"]);
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
