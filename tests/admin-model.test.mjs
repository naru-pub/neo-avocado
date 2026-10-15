import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRecord,
  scopes,
  models,
  walletWrites,
  characterStateWrites,
  titleHoldings,
} from "../admin-model.js";
const references = {
  profiles: [
    { id: "member-a", data: { nick: "A" } },
    { id: "member-b", data: { nick: "B" } },
  ],
  characters: [
    { id: "hero", data: { name: "Hero" }, createdBy: "member-a" },
    { id: "other", data: { name: "Other" }, createdBy: "member-b" },
  ],
  titles: [{ id: "winner", data: { name: "Winner" } }],
  stats: [{ id: "hp", data: { name: "Health", initial: 10, max: 20 } }],
  items: [
    { id: "seed", data: { name: "Seed" } },
    { id: "tree", data: { name: "Tree" } },
  ],
};
test("owner balance adjustments preserve counts and guard balance and history in one batch", () => {
  const previous = {
    id: "member-a",
    revision: "r1.2",
    data: { balance: 10, purchases: { seed: 2 } },
  };
  const record = buildRecord(
    "wallets",
    { id: "member-a", balance: "25", lastDaily: "", note: "이벤트 보상" },
    previous,
    references,
  );
  assert.deepEqual(record.data.purchases, { seed: 2 });
  assert.equal(record.data.note, undefined);
  const writes = walletWrites(
    record,
    previous,
    "이벤트 보상",
    1234,
    "audit-id",
  );
  assert.deepEqual(writes[0].set.condition, { revision: "r1.2" });
  assert.deepEqual(writes[1].set.condition, { absent: true });
  assert.equal(writes[1].set.data.delta, 15);
  assert.equal(writes[1].set.data.owner, "member-a");
  assert.throws(() =>
    buildRecord(
      "wallets",
      { id: "member-a", balance: "25", lastDaily: "", note: "" },
      previous,
      references,
    ),
  );
  assert.throws(() => buildRecord("history", {}, null, references));
});
test("inventory grants validate the recipient's character and use catalog names", () => {
  const values = {
    id: "grant",
    owner: "member-a",
    character: "hero",
    item: "seed",
    memo: "보상",
  };
  const grant = buildRecord("inventory", values, null, references);
  assert.equal(grant.data.name, "Seed");
  assert.equal(grant.data.from, "admin");
  assert.throws(() =>
    buildRecord(
      "inventory",
      { ...values, character: "other" },
      null,
      references,
    ),
  );
  assert.throws(() =>
    buildRecord("inventory", { ...values, owner: "missing" }, null, references),
  );
});
const blank = (section) =>
  Object.fromEntries(
    models[section].fields.map((field) => [
      field.key,
      field.default ??
        (field.type === "checkbox"
          ? false
          : ["ingredients", "titles"].includes(field.type)
            ? []
            : field.type === "choice"
              ? field.options[0][0]
              : ""),
    ]),
  );
test("catalog forms produce nested rules and cannot save invalid prices or incomplete recovery effects", () => {
  const values = {
    ...blank("items"),
    id: "potion",
    name: "Potion",
    price: "10",
    "effect.type": "restore",
    "effect.stat": "hp",
    "effect.amount": "2",
    "requirements.sides": "forest, forest, city",
    "requirements.items": [{ item: "seed", count: "2", consume: true }],
  };
  const data = buildRecord(
    "items",
    values,
    { data: { category: "existing" } },
    references,
  ).data;
  assert.deepEqual(data.effect, { type: "restore", stat: "hp", amount: 2 });
  assert.deepEqual(data.requirements.sides, ["forest", "city"]);
  assert.deepEqual(data.requirements.items, [
    { item: "seed", count: 2, consume: true },
  ]);
  assert.equal(data.stock, undefined);
  assert.equal(data.category, "existing");
  for (const change of [
    { price: "-1" },
    { "effect.amount": "0" },
    { "effect.stat": "missing" },
    { "requirements.items": [{ item: "seed", count: 19, consume: true }] },
  ])
    assert.throws(() =>
      buildRecord("items", { ...values, ...change }, null, references),
    );
  assert.equal(
    buildRecord(
      "items",
      { ...values, "effect.type": "", "effect.amount": "" },
      null,
      references,
    ).data.effect,
    undefined,
  );
});
test("recipes validate material counts and gacha retains explicit misses and fractional weights", () => {
  const values = {
    ...blank("recipes"),
    id: "recipe",
    name: "Tree recipe",
    item: "tree",
    cost: "2",
    ingredients: [{ item: "seed", count: "2" }],
  };
  assert.deepEqual(
    buildRecord("recipes", values, null, references).data.ingredients,
    [{ item: "seed", count: 2 }],
  );
  for (const ingredients of [
    [],
    [{ item: "missing", count: 2 }],
    [{ item: "seed", count: 21 }],
    [
      { item: "seed", count: 1 },
      { item: "seed", count: 1 },
    ],
  ])
    assert.throws(() =>
      buildRecord("recipes", { ...values, ingredients }, null, references),
    );
  const draw = buildRecord(
    "gacha",
    { id: "miss", source: "", item: "", weight: "0.5" },
    null,
    references,
  );
  assert.deepEqual(draw.data, { source: null, item: null, weight: 0.5 });
  assert.throws(() =>
    buildRecord(
      "gacha",
      { id: "bad", source: "", item: "", weight: "Infinity" },
      null,
      references,
    ),
  );
});
test("couple administration rejects missing and identical characters and invalid dates", () => {
  const values = {
    id: "pair",
    first: "hero",
    second: "other",
    since: "2030-01-02",
    order: "0",
  };
  assert.equal(
    buildRecord("couples", values, null, references).data.second,
    "other",
  );
  for (const extra of [
    { second: "hero" },
    { first: "missing" },
    { since: "2030-02-30" },
  ])
    assert.throws(() =>
      buildRecord("couples", { ...values, ...extra }, null, references),
    );
});
test("official progression editing preserves purchase counts and validates title grants and stat budgets", () => {
  const previous = {
    data: { purchases: { sword: 2 }, activeTitle: "revoked" },
  };
  const values = {
    id: "hero",
    approved: true,
    side: "forest",
    class: "elf",
    exp: "100",
    points: "5",
    titles: ["winner"],
    "allocated:hp": "5",
    "damage:hp": "3",
  };
  const record = buildRecord("character_state", values, previous, references);
  assert.equal(record.data.owner, "member-a");
  assert.equal(record.data.stats.hp.current, 12);
  assert.equal(record.data.activeTitle, null);
  assert.deepEqual(record.data.purchases, { sword: 2 });
  assert.throws(() =>
    buildRecord(
      "character_state",
      { ...values, titles: ["unknown"] },
      previous,
      references,
    ),
  );
  assert.throws(() =>
    buildRecord(
      "character_state",
      { ...values, points: "4" },
      previous,
      references,
    ),
  );
  assert.throws(() =>
    buildRecord(
      "character_state",
      { ...values, exp: "-1" },
      previous,
      references,
    ),
  );
  assert.ok(scopes.includes("neo_avocado_character_state"));
});

test("quest forms validate Korean scheduling and multiline images", () => {
  const values = {
    id: "quest1",
    name: "Daily",
    type: "daily",
    side: "forest",
    startsAt: "2030-01-01T09:00",
    endsAt: "2030-01-02T09:00",
    images: "https://example.com/a.png\nhttps://example.com/b.png",
  };
  const row = buildRecord("quests", values, null, references);
  assert.deepEqual(row.data.images, [
    "https://example.com/a.png",
    "https://example.com/b.png",
  ]);
  assert.ok(scopes.includes("neo_avocado_quests"));
  for (const change of [
    { endsAt: "2029-12-31T09:00" },
    { startsAt: "2030-02-30T09:00" },
    { images: "javascript:alert(1)" },
    { images: "https://user:pass@example.com/a.png" },
  ])
    assert.throws(() =>
      buildRecord("quests", { ...values, ...change }, null, references),
    );
});

test("title ownership review searches all holders and retains equipped orphan references", () => {
  const rows = [
    {
      id: "hero",
      revision: "r1",
      data: { titles: ["winner", "winner"], activeTitle: "winner" },
    },
    { id: "missing", data: { titles: [], activeTitle: "gone" } },
  ];
  const holdings = titleHoldings(
    rows,
    references.characters,
    references.titles,
  );
  assert.equal(holdings.length, 2);
  assert.equal(holdings[0].active, true);
  assert.equal(holdings[1].titleId, "gone");
  assert.equal(
    titleHoldings(rows, references.characters, references.titles, "Winner")
      .length,
    1,
  );
  assert.equal(
    titleHoldings(rows, references.characters, references.titles, "Hero")
      .length,
    1,
  );
  assert.equal(
    titleHoldings(rows, references.characters, references.titles, "nothing")
      .length,
    0,
  );
  const many = Array.from({ length: 75 }, (_, i) => ({
    id: `c${i}`,
    data: { titles: ["winner"] },
  }));
  assert.equal(titleHoldings(many, [], references.titles, "c74").length, 1);
});

test("managed content validates body sizes, artwork and read levels", () => {
  const values = {
    id: "guide",
    name: "Guide",
    enabled: true,
    readLevel: "2",
    format: "html",
    body: "<p>Guide</p>",
    mobileBody: "",
    headerImage: "",
    footerImage: "",
  };
  assert.equal(
    buildRecord("content", values, null, references).data.body,
    "<p>Guide</p>",
  );
  for (const change of [
    { readLevel: "0" },
    { readLevel: "11" },
    { body: "x".repeat(12001) },
    { headerImage: "javascript:bad()" },
  ])
    assert.throws(() =>
      buildRecord("content", { ...values, ...change }, null, references),
    );
});

test("profile field definitions validate codes and options; explore misses store null", () => {
  const field = (values) =>
    buildRecord(
      "character_fields",
      {
        label: "성별",
        type: "select",
        options: "여성, 남성",
        help: "",
        order: "2",
        visibility: "owner",
        required: true,
        ...values,
      },
      null,
      references,
    );
  assert.deepEqual(field({ id: "gender" }).data, {
    label: "성별",
    type: "select",
    options: ["여성", "남성"],
    help: "",
    order: 2,
    visibility: "owner",
    required: true,
  });
  for (const id of ["Gender", "1st", "constructor", "has-dash"])
    assert.throws(() => field({ id }));
  assert.throws(() => field({ id: "gender", options: "" }));
  assert.throws(() => field({ id: "gender", visibility: "everyone" }));
  assert.deepEqual(
    field({ id: "age", type: "text", options: "ignored" }).data.options,
    [],
  );
  assert.equal(
    buildRecord(
      "explore",
      { id: "miss", item: "", weight: "3" },
      null,
      references,
    ).data.item,
    null,
  );
  assert.ok(scopes.includes("neo_avocado_character_fields"));
  assert.ok(scopes.includes("neo_avocado_explore"));
  assert.equal(models.character_review.collection, "neo_avocado_characters");
});

test("the site declares every collection it uses, and sign-in asks for them", async () => {
  const { scopes } = await import("../admin-model.js");
  const { readdir, readFile } = await import("node:fs/promises");
  const files = ["app.js", "admin.js"];
  for (const name of await readdir(new URL("../app", import.meta.url)))
    files.push(`app/${name}`);
  for (const dir of [
    "_naru/modules",
    "_naru/functions/community",
    "_naru/functions/economy",
    "_naru/functions/characters",
    "_naru/functions/content",
    "_naru/rules",
  ])
    for (const name of await readdir(new URL(`../${dir}`, import.meta.url)))
      files.push(`${dir}/${name}`);
  const used = new Set();
  for (const file of files) {
    const source = await readFile(
      new URL(`../${file}`, import.meta.url),
      "utf8",
    );
    for (const [, name] of source.matchAll(
      /(?:PREFIX\}|neo_avocado_)([a-z_]+)/g,
    ))
      used.add(`neo_avocado_${name}`);
  }
  assert.deepEqual(
    [...used].filter((name) => !scopes.includes(name)),
    [],
  );
  const { collections } = JSON.parse(
    await readFile(
      new URL("../_naru/collections.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(collections).sort(), [...scopes].sort());
  for (const [name, entry] of Object.entries(collections))
    assert.ok(entry.read && entry.write, `${name} states read and write`);
  assert.equal(collections.neo_avocado_logs.rules, "community-board");
  assert.deepEqual(collections.neo_avocado_profiles.unique, ["nick"]);
});

test("a character's experience change is recorded for its owner in the same batch", () => {
  const previous = { revision: "r1", data: { owner: "m-1", exp: 10 } };
  const record = { id: "hero", data: { owner: "m-1", exp: 25 } };
  const writes = characterStateWrites(record, previous, " 이벤트 ", 7, "h-1");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].set.condition, { revision: "r1" });
  assert.deepEqual(writes[1], {
    collection: "neo_avocado_history",
    set: {
      id: "h-1",
      data: {
        owner: "m-1",
        kind: "exp",
        at: 7,
        character: "hero",
        expDelta: 15,
        exp: 25,
        memo: "이벤트",
        actor: "site-owner",
      },
      condition: { absent: true },
    },
  });
  // Unchanged experience writes the record alone.
  assert.equal(
    characterStateWrites(
      { id: "hero", data: { owner: "m-1", exp: 10 } },
      previous,
      "",
      7,
      "h-2",
    ).length,
    1,
  );
});

test("visit reports total a date range and break it down as the original's tabs", async () => {
  const { visitReport } = await import("../admin-reports.js");
  const days = [
    {
      data: {
        day: "2030-01-05",
        total: 3,
        guests: 1,
        members: { a: 2 },
        hours: { 9: 2, 21: 1 },
        browsers: { Chrome: 2, Safari: 1 },
      },
    },
    {
      data: {
        day: "2030-01-06",
        total: 2,
        guests: 0,
        members: { a: 1, b: 1 },
        hours: { 9: 2 },
        browsers: { Chrome: 2 },
      },
    },
    { data: { day: "2030-02-01", total: 7, guests: 7, members: {} } },
  ];
  const january = visitReport(days, {
    from: "2030-01-01",
    to: "2030-01-31",
    by: "day",
  });
  assert.deepEqual([january.total, january.guests, january.members], [5, 1, 2]);
  assert.deepEqual(january.rows, [
    { label: "2030-01-05", count: 3 },
    { label: "2030-01-06", count: 2 },
  ]);
  assert.deepEqual(
    visitReport(days, { by: "hour" }).rows.map((row) => row.label),
    ["09시", "21시"],
  );
  // 2030-01-05 is a Saturday, 01-06 a Sunday: Sunday first, as in Korea.
  assert.deepEqual(visitReport(days, { to: "2030-01-31", by: "week" }).rows, [
    { label: "일", count: 2 },
    { label: "토", count: 3 },
  ]);
  assert.deepEqual(visitReport(days, { by: "browsers" }).rows, [
    { label: "Chrome", count: 4 },
    { label: "Safari", count: 1 },
  ]);
  assert.deepEqual(visitReport(days, { by: "month" }).rows, [
    { label: "2030-01", count: 5 },
    { label: "2030-02", count: 7 },
  ]);
});

test("activity counts each member's posts and comments on a board in a Korean date range", async () => {
  const { activityReport } = await import("../admin-reports.js");
  const at = (iso) => iso;
  const rows = activityReport(
    {
      profiles: [
        { id: "a", data: { nick: "가", mainCharacter: "c1" } },
        { id: "b", data: { nick: "나" } },
      ],
      members: [{ id: "b", data: { warnings: 2, warningNote: "도배" } }],
      characters: [{ id: "c1", data: { name: "초록" } }],
      logs: [
        {
          id: "l1",
          createdBy: "a",
          createdAt: at("2030-01-01T15:30:00Z"),
          data: { board: "free" },
        },
        {
          id: "l2",
          createdBy: "b",
          createdAt: at("2030-01-01T10:00:00Z"),
          data: { board: "notice" },
        },
        {
          id: "l3",
          createdBy: "a",
          createdAt: at("2030-01-05T00:00:00Z"),
          data: { board: "free", deleted: true },
        },
      ],
      comments: [
        {
          id: "m1",
          createdBy: "b",
          createdAt: at("2030-01-02T01:00:00Z"),
          data: { logId: "l1" },
        },
        {
          id: "m2",
          createdBy: "b",
          createdAt: at("2030-01-02T01:00:00Z"),
          data: { logId: "l2" },
        },
      ],
      presence: [{ id: "a", data: { at: 1234 } }],
    },
    // 2030-01-01T15:30Z is 01-02 in Korea.
    { board: "free", from: "2030-01-02", to: "2030-01-31" },
  );
  assert.deepEqual(
    rows.map((row) => [
      row.nick,
      row.mainCharacter,
      row.logs,
      row.comments,
      row.lastSeen,
      row.warnings,
      row.warningNote,
    ]),
    [
      ["가", "초록", 1, 0, 1234, 0, ""],
      ["나", "", 0, 1, null, 2, "도배"],
    ],
  );
});
