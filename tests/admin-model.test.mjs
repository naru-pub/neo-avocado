import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRecord,
  scopes,
  models,
  walletWrites,
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
