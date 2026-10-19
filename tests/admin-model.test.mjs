import { test } from "node:test";
import assert from "node:assert/strict";
// The admin's forms and their checks (buildRecord), which the owner's
// mutations run on the server (tests/admin.test.mjs), and the page's menu.
import {
  buildRecord,
  formValues,
  models,
  memberSummary,
} from "../dist/admin/forms.js";
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
    { id: "seed", data: { name: "Seed", craftMaterial: true } },
    { id: "tree", data: { name: "Tree" } },
  ],
};
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
    { data: { legacy: "existing" } },
    references,
  ).data;
  assert.deepEqual(data.effect, { type: "restore", stat: "hp", amount: 2 });
  assert.deepEqual(data.requirements.sides, ["forest", "city"]);
  assert.deepEqual(data.requirements.items, [
    { item: "seed", count: 2, consume: true },
  ]);
  assert.equal(data.stock, undefined);
  // What the form does not show is kept.
  assert.equal(data.legacy, "existing");
  assert.equal(data.category, "general");
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
  // Only craft materials, and no combination another recipe has
  // (adm/recipi_update.php:14-30, 48-51); saving a recipe again is no clash.
  assert.throws(
    () =>
      buildRecord(
        "recipes",
        { ...values, ingredients: [{ item: "tree", count: "1" }] },
        null,
        references,
      ),
    /Tree은\(는\) 조합 재료로/,
  );
  const withRecipes = {
    ...references,
    recipes: [
      {
        id: "recipe",
        data: {
          name: "Tree recipe",
          ingredients: [{ item: "seed", count: 2 }],
        },
      },
    ],
  };
  buildRecord("recipes", values, null, withRecipes);
  assert.throws(
    () => buildRecord("recipes", { ...values, id: "again" }, null, withRecipes),
    /이미 등록된 레시피 조합입니다: Tree recipe/,
  );
  buildRecord(
    "recipes",
    { ...values, id: "again", ingredients: [{ item: "seed", count: "3" }] },
    null,
    withRecipes,
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
  for (const change of [
    { endsAt: "2029-12-31T09:00" },
    { startsAt: "2030-02-30T09:00" },
    { images: "javascript:alert(1)" },
    { images: "https://user:pass@example.com/a.png" },
  ])
    assert.throws(() =>
      buildRecord("quests", { ...values, ...change }, null, references),
    );
  // 수행가능 is picked from the 소속 list once there is one.
  const sides = [{ id: "s1", data: { name: "숲" } }];
  assert.equal(
    buildRecord("quests", { ...values, side: "숲" }, null, {
      ...references,
      sides,
    }).data.side,
    "숲",
  );
  assert.throws(() =>
    buildRecord("quests", values, null, { ...references, sides }),
  );
  assert.equal(
    buildRecord("quests", { ...values, side: "" }, null, {
      ...references,
      sides,
    }).data.side,
    "",
  );
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

test("content pages are everyone's by default, as the original's have no read level", () => {
  assert.equal(
    models.content.fields.find((field) => field.key === "readLevel").default,
    1,
  );
});

test("the design's background colour is a #rrggbb code or blank, its repeat and position listed", () => {
  const values = {
    ...formValues("design", null),
    enabled: true,
    font: "sans",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center top",
    backgroundColor: "#102030",
  };
  const row = buildRecord("design", values, null, references);
  assert.equal(row.data.backgroundColor, "#102030");
  assert.equal(row.data.backgroundPosition, "center top");
  assert.equal(
    buildRecord("design", { ...values, backgroundColor: "" }, null, references)
      .data.backgroundColor,
    "",
  );
  for (const change of [
    { backgroundColor: "red;}" },
    { backgroundRepeat: "space" },
    { backgroundPosition: "middle" },
  ])
    assert.throws(() =>
      buildRecord("design", { ...values, ...change }, null, references),
    );
});

test("디자인 설정's styles take colours, pixels and listed choices, kept by part", () => {
  const values = {
    ...formValues("design", null),
    useHeader: false,
    menuPosition: "top",
    menuHeight: "70",
    "styles.notice.background": "rgba(0, 0, 0, .5)",
    "styles.notice.borderStyle": "dashed",
    "styles.notice.borderWidth": "1",
    "styles.notice.borderSides": ["bottom", "top"],
    "styles.button.hoverBackground": "#222",
    "styles.input.topLeft": "4",
    "styles.menu.image": "https://cdn.example/menu.png",
  };
  const { data } = buildRecord("design", values, null, references);
  assert.equal(data.useHeader, false);
  assert.equal(data.menuPosition, "top");
  assert.equal(data.menuHeight, 70);
  assert.deepEqual(data.styles.notice, {
    background: "rgba(0, 0, 0, .5)",
    color: "",
    borderColor: "",
    borderStyle: "dashed",
    borderWidth: 1,
    // In the original's order, 상·하·좌·우.
    borderSides: ["top", "bottom"],
  });
  assert.equal(data.styles.button.hoverBackground, "#222");
  assert.equal(data.styles.input.topLeft, 4);
  assert.equal(data.styles.menu.image, "https://cdn.example/menu.png");
  // A form saved again keeps the same record.
  assert.deepEqual(
    buildRecord("design", formValues("design", data), { data }, references)
      .data,
    data,
  );
  for (const change of [
    { "styles.notice.background": "red; } body { display: none" },
    { "styles.notice.borderStyle": "groove" },
    { "styles.notice.borderSides": ["middle"] },
    { "styles.menu.image": "http://cdn.example/menu.png" },
    { menuPosition: "right" },
  ])
    assert.throws(
      () => buildRecord("design", { ...values, ...change }, null, references),
      JSON.stringify(change),
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
        suffix: "",
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
    suffix: "",
    order: 2,
    visibility: "owner",
    required: true,
  });
  // ar_text: a one-line field's unit.
  assert.equal(
    field({ id: "height", type: "text", suffix: "cm" }).data.suffix,
    "cm",
  );
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
});

test("the admin menu has every section once, in the original's groups and names", async () => {
  const { menu, sectionLabel } = await import("../dist/admin/forms.js");
  const { NAME_DEFAULTS } = await import("../dist/app/names.js");
  const listed = menu.flatMap((group) => group.sections);
  assert.deepEqual([...listed].sort(), Object.keys(models).sort());
  assert.equal(new Set(listed).size, listed.length);
  const names = { ...NAME_DEFAULTS, moneyName: "골드", rankName: "레벨" };
  assert.equal(sectionLabel("wallets", names), "골드 관리");
  assert.equal(sectionLabel("levels", names), "레벨 설정");
  assert.equal(sectionLabel("sides", names), "소속 관리");
});

test("a board's form starts from the original's defaults and keeps its limits in order", () => {
  const defaults = Object.fromEntries(
    models.boards.fields
      .filter((field) => field.key)
      .map((field) => [field.key, field.default ?? ""]),
  );
  // bo_gallery_height 600, bo_page_rows 15, bo_count_modify 1.
  assert.equal(defaults.foldHeight, 600);
  assert.equal(defaults.pageRows, 15);
  assert.equal(defaults.editLock, 1);
  const values = {
    ...defaults,
    id: "free",
    name: "자유",
    kind: "image",
    secret: "optional",
    group: "",
    categories: "",
  };
  const board = buildRecord("boards", values, null, { groups: [] });
  assert.equal(board.data.writeReward, 0);
  assert.throws(
    () =>
      buildRecord("boards", { ...values, pageRows: 0 }, null, { groups: [] }),
    /한 페이지 글 수/,
  );
  assert.throws(
    () =>
      buildRecord("boards", { ...values, writeMin: 10, writeMax: 5 }, null, {
        groups: [],
      }),
    /최소 글자 수/,
  );
});

test("a balance needs a member and a reason, and keeps what the form does not show", () => {
  const previous = { data: { balance: 10, purchases: { seed: 2 } } };
  const record = buildRecord(
    "wallets",
    { id: "member-a", balance: "25", lastDaily: "", note: "이벤트 보상" },
    previous,
    references,
  );
  assert.deepEqual(record.data, {
    balance: 25,
    lastDaily: "",
    purchases: { seed: 2 },
  });
  for (const change of [{ note: "" }, { id: "missing" }, { balance: "-1" }])
    assert.throws(() =>
      buildRecord(
        "wallets",
        { id: "member-a", balance: "25", lastDaily: "", note: "x", ...change },
        previous,
        references,
      ),
    );
  assert.throws(
    () => buildRecord("history", { id: "h" }, null, references),
    /기록은 수정할 수 없습니다/,
  );
});

test("a record's form values build the same record again, so a save may send only some", () => {
  const values = {
    ...blank("items"),
    id: "potion",
    name: "Potion",
    price: "10",
    "display.weekdays": "월, 화",
    "requirements.items": [{ item: "seed", count: "2", consume: true }],
  };
  const saved = buildRecord("items", values, null, references);
  const again = buildRecord(
    "items",
    { ...formValues("items", saved.data, references), id: "potion" },
    saved,
    references,
  );
  assert.deepEqual(again.data, saved.data);
  // A new record's values are its defaults: a new item starts hidden.
  assert.equal(formValues("items", null).hidden, true);
  assert.equal(formValues("items", { name: "x" }).hidden, false);
  assert.equal(
    formValues("quests", { images: ["https://a.example/1.png", "b"] }).images,
    "https://a.example/1.png\nb",
  );
  const state = formValues(
    "character_state",
    { stats: { hp: { allocated: 2, max: 12, current: 9, damage: 3 } } },
    references,
  );
  assert.equal(state["allocated:hp"], 2);
  assert.equal(state["damage:hp"], 3);
});

test("회원 관리 shows each member's level, role, warnings, leaving and last visit", () => {
  assert.match(
    memberSummary({
      row: { data: { level: 3, role: "moderator", warnings: 2 } },
      lastSeen: Date.parse("2030-01-01T00:00:00Z"),
    }),
    /^등급 3 · 게시물 운영자 · 경고 2회 · 최종 접속 /,
  );
  assert.match(
    memberSummary({
      row: { data: { role: "member", left: "2030-01-02" } },
      lastSeen: 1,
    }),
    /^등급 2 · 회원 · 탈퇴 2030-01-02 · 최종 접속 /,
  );
  assert.equal(
    memberSummary({ row: { data: {} }, lastSeen: null }),
    "등급 2 · 회원 · 최종 접속 기록 없음",
  );
});

test("no page or server code names a collection: the site declares none", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const files = [];
  for (const name of await readdir(new URL("../dist/admin", import.meta.url)))
    if (name.endsWith(".js")) files.push(`admin/${name}`);
  for (const name of await readdir(new URL("../dist/app", import.meta.url)))
    files.push(`app/${name}`);
  for (const dir of ["modules", "queries", "mutations"])
    for (const entry of await readdir(
      new URL(`../dist/_naru/${dir}`, import.meta.url),
      { recursive: true },
    ))
      if (entry.endsWith(".js")) files.push(`_naru/${dir}/${entry}`);
  for (const file of files) {
    const source = await readFile(
      new URL(`../dist/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /neo_avocado_|\.collection\(|\.batch\(/, file);
  }
  await assert.rejects(
    readFile(new URL("../dist/_naru/collections.json", import.meta.url)),
  );
});
