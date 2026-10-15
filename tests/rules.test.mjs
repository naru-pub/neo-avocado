import test from "node:test";
import assert from "node:assert/strict";
import * as boards from "../_naru/rules/boards.js";
import * as profiles from "../_naru/rules/profiles.js";
import * as own from "../_naru/rules/own.js";
import * as settings from "../_naru/rules/settings.js";
import * as characterFields from "../_naru/rules/character-fields.js";
import * as shown from "../_naru/rules/shown.js";

const P = "neo_avocado_";
/** A rule's ctx: reads over `tables`, as `member` (null for a visitor). */
function rulesCtx(member, tables = {}) {
  const rows = (name) =>
    Object.entries(tables[name] ?? {}).map(([id, data]) => ({ id, data }));
  return {
    member: member ? { id: member } : null,
    get: async (name, id) => rows(name).find((row) => row.id === id) ?? null,
    list: async (name) => ({ documents: rows(name), nextCursor: null }),
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
    [`${P}members`]: { senior: { level: 5 } },
  };
  const ids = async (member) =>
    (await boards.scope(rulesCtx(member, tables))).in?.[1] ?? [];
  assert.deepEqual(await ids(null), ["open"]);
  assert.deepEqual(await ids("m-1"), ["open", "members"]);
  assert.deepEqual(await ids("senior"), ["open", "members", "staff"]);
  assert.equal(
    await boards.scope(rulesCtx(null, { [`${P}boards`]: {} })),
    false,
  );
  assert.equal(boards.canWrite(), false);
});

test("profiles: visitors read nicknames only, members the whole profile", () => {
  const document = {
    id: "m-1",
    data: { nick: "아보", acceptMessages: false, commentAlerts: true },
  };
  assert.deepEqual(profiles.present(rulesCtx(null), { document }), {
    nick: "아보",
  });
  assert.deepEqual(
    profiles.present(rulesCtx("m-2"), { document }),
    document.data,
  );
  assert.deepEqual(profiles.scope(), { ne: ["deleted", true] });
  assert.ok(!profiles.queryable.includes("commentAlerts"));
});

test("profiles: a member edits their own nickname and preferences, nothing else", () => {
  const before = {
    id: "m-1",
    data: {
      owner: "m-1",
      nick: "아보",
      acceptMessages: true,
      commentAlerts: true,
      mainCharacter: "hero",
    },
  };
  const write = (member, data, operation = "update", id = "m-1") =>
    profiles.canWrite(rulesCtx(member), {
      operation,
      before: { ...before, id },
      after: { id, data: { ...before.data, ...data } },
    });
  assert.equal(write("m-1", { nick: "카도", acceptMessages: false }), true);
  // Not someone else's, not by a visitor, not made or deleted directly.
  assert.equal(write("m-2", { nick: "카도" }, "update", "m-1"), false);
  assert.equal(write(null, { nick: "카도" }), false);
  assert.equal(write("m-1", {}, "create"), false);
  assert.equal(write("m-1", {}, "delete"), false);
  // Fields site functions keep stay as they were.
  assert.equal(write("m-1", { mainCharacter: "villain" }), false);
  assert.equal(write("m-1", { owner: "m-2" }), false);
  // A nickname is 1–20 characters without surrounding spaces.
  assert.equal(write("m-1", { nick: " 아보" }), false);
  assert.equal(write("m-1", { nick: "" }), false);
  assert.equal(write("m-1", { nick: "가".repeat(21) }), false);
  assert.equal(write("m-1", { commentAlerts: "yes" }), false);
});

test("own: a member reads their own wallet and inventory, a visitor nothing", () => {
  assert.deepEqual(own.scope(rulesCtx("m-1"), { collection: `${P}wallets` }), {
    eq: [{ metadata: "id" }, "m-1"],
  });
  assert.deepEqual(
    own.scope(rulesCtx("m-1"), { collection: `${P}inventory` }),
    { eq: ["owner", "m-1"] },
  );
  assert.equal(own.scope(rulesCtx(null), { collection: `${P}wallets` }), false);
});

test("settings: only the community settings, trimmed to what pages use", () => {
  assert.deepEqual(settings.scope(), {
    eq: [{ metadata: "id" }, "community"],
  });
  assert.deepEqual(
    settings.present(rulesCtx("m-1"), {
      document: { id: "community", data: { messageCost: 3, secretKey: "x" } },
    }),
    {
      initialStatPoints: 0,
      messageCost: 3,
      shopCategories: "일반, 이벤트",
      shopNpc: null,
      shopGreeting: "",
    },
  );
});

test("character fields and catalogues hide what members may not see", () => {
  assert.deepEqual(characterFields.scope(), {
    all: [{ ne: ["deleted", true] }, { ne: ["visibility", "admin"] }],
  });
  assert.deepEqual(shown.scope(), { ne: ["deleted", true] });
});

test("the declaration names a rule file for every rule it uses", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const { collections } = JSON.parse(
    await readFile(
      new URL("../_naru/collections.json", import.meta.url),
      "utf8",
    ),
  );
  const files = await readdir(new URL("../_naru/rules", import.meta.url));
  for (const [name, entry] of Object.entries(collections))
    if (entry.rules)
      assert.ok(files.includes(`${entry.rules}.js`), `${name}: ${entry.rules}`);
});
