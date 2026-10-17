// 실행: npm test
// The owner's admin (admin/) on a real SQLite database with the site's
// migrations (tests/sql-ctx.mjs): each section's owner-only queries and
// mutations, saves checked as the forms check them, members' Naru roles,
// balances and records saved with their history, titles given and taken
// back in one call, and the reports' SQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { testSite } from "./sql-ctx.mjs";

const M1 = { member: "m-1" };
const OWNER = { owner: true };

/** The reason a call refused with (its ctx.fail details), its code, or null. */
const refusal = (call) =>
  call.then(
    () => null,
    (error) => {
      if (error.details?.reason) return error.details.reason;
      if (error.code) return error.code;
      throw error;
    },
  );
/** A call's refusal message, or null. */
const refusedWith = (call) =>
  call.then(
    () => null,
    (error) => error.message,
  );
const query = (site, name, args = {}) =>
  site.query(`admin/${name}`, args, OWNER);
const mutate = (site, name, args = {}) =>
  site.mutate(`admin/${name}`, args, OWNER);
/** Saves a new entry of a section from its form's values. */
const create = (site, section, id, values) =>
  mutate(site, `${section}:save`, { id, values, create: true });
const update = (site, section, id, values) =>
  mutate(site, `${section}:save`, { id, values });
const profile = (site, member, nick, main = null) =>
  site.run(
    "INSERT INTO profiles (member, nick, main_character) VALUES (?, ?, ?)",
    member,
    nick,
    main,
  );
/** A character row made directly; answers its ID as pages know it. */
function character(site, data = {}) {
  const row = { owner: "m-1", name: "Hero", created_at: site.now, ...data };
  const columns = Object.keys(row);
  const { lastInsertRowid } = site.run(
    `INSERT INTO characters (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return String(lastInsertRowid);
}
const history = (site) => site.rows("SELECT * FROM history ORDER BY id");

/**
 * Every admin query and mutation, by "admin/<module>:<export>", with its
 * function; and the owner's own calls outside admin/.
 */
async function adminCalls(folder) {
  const root = new URL(`../dist/_naru/${folder}/admin/`, import.meta.url);
  const calls = [];
  for (const file of await readdir(root)) {
    const module = await import(new URL(file, root).href);
    for (const [name, fn] of Object.entries(module))
      calls.push([`admin/${file.replace(/\.js$/, "")}:${name}`, fn]);
  }
  const others = {
    queries: [],
    mutations: [
      "economy/grants:grant",
      "characters/review:reviewCharacter",
      "characters/sheet:move",
    ],
  }[folder];
  for (const call of others) {
    const [module, name] = call.split(":");
    const exports = await import(
      new URL(`../dist/_naru/${folder}/${module}.js`, import.meta.url).href
    );
    calls.push([call, exports[name]]);
  }
  return calls;
}

test("every admin query and mutation is ownerOnly's, and refuses members, moderators and visitors", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  site.setRoles("m-2", ["staff"]);
  const queries = await adminCalls("queries");
  const mutations = await adminCalls("mutations");
  assert.ok(queries.length > 20 && mutations.length > 20);
  // Made by ownerOnly (modules/access.ts), so the check comes first.
  for (const [call, fn] of [...queries, ...mutations])
    assert.equal(fn.ownerOnly, true, call);
  for (const who of [M1, { member: "m-2" }, {}]) {
    for (const [call] of queries)
      assert.equal(
        await refusal(site.query(call, {}, who)),
        "owner_only",
        call,
      );
    for (const [call] of mutations)
      assert.equal(
        await refusal(site.mutate(call, {}, who)),
        "owner_only",
        call,
      );
  }
  // Nothing was written by the refused calls.
  assert.deepEqual(site.rows("SELECT * FROM settings"), []);
});

test("settings are one form each, checked as the form is, and a save may change only some", async () => {
  const site = await testSite();
  assert.equal(
    await query(site, "settings:get", { section: "settings" }),
    null,
  );
  assert.equal(
    await refusal(query(site, "settings:get", { section: "members" })),
    "invalid_input",
  );
  const saved = await mutate(site, "settings:save", {
    section: "settings",
    values: { loginReward: 100 },
  });
  assert.equal(saved.id, "community");
  // The rest are the form's defaults, as a first save from the form keeps.
  assert.equal(saved.data.loginReward, 100);
  assert.equal(saved.data.moneyName, "아보");
  assert.equal(saved.data.siteOpen, true);
  assert.equal(saved.data.messageDailyLimit, 100);
  await mutate(site, "settings:save", {
    section: "settings",
    values: { shopGreeting: "어서 오세요" },
  });
  const settings = await query(site, "settings:get", { section: "settings" });
  assert.equal(settings.data.loginReward, 100);
  assert.equal(settings.data.shopGreeting, "어서 오세요");
  assert.equal(
    (await site.query("content/site:settings", null, M1)).shopGreeting,
    "어서 오세요",
  );
  // The form's checks: a negative amount, a bad colour.
  assert.equal(
    await refusedWith(
      mutate(site, "settings:save", {
        section: "settings",
        values: { loginReward: -1 },
      }),
    ),
    "숫자는 0 이상의 정수여야 합니다.",
  );
  assert.equal(
    await refusedWith(
      mutate(site, "settings:save", {
        section: "design",
        values: { backgroundColor: "red;}" },
      }),
    ),
    "배경 색상코드는 #000000 꼴로 입력하세요.",
  );
  assert.equal(
    await refusal(
      mutate(site, "settings:save", { section: "design", values: "x" }),
    ),
    "invalid_input",
  );
  // The design is its own row, read by every page.
  const design = await mutate(site, "settings:save", {
    section: "design",
    values: { title: "아보", backgroundColor: "#102030" },
  });
  assert.equal(design.id, "site");
  assert.equal((await site.query("content/site:site")).design.title, "아보");
  await mutate(site, "settings:save", {
    section: "character_images",
    values: { bodyUse: true },
  });
  assert.equal(
    (await query(site, "settings:get", { section: "character_images" })).data
      .bodyUse,
    true,
  );
});

test("boards and groups are saved as their forms check them, and members see them so", async () => {
  const site = await testSite();
  await create(site, "board_groups", "g", { name: "그룹", membersOnly: true });
  const board = {
    name: "자유",
    kind: "text",
    group: "g",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    commentLevel: 1,
    categories: "잡담, 잡담, 질문",
    html: true,
    description: "<b>안내</b>",
    writeReward: 5,
    secret: "off",
  };
  const saved = await create(site, "boards", "free", board);
  assert.deepEqual(saved, {
    id: "free",
    data: {
      name: "자유",
      description: "<b>안내</b>",
      kind: "text",
      enabled: true,
      group: "g",
      listLevel: 1,
      readLevel: 1,
      writeLevel: 1,
      commentLevel: 1,
      categories: ["잡담", "질문"],
      html: true,
      actions: false,
      rss: false,
      anonymous: false,
      foldHeight: 600,
      pageRows: 15,
      // A new board lists titles only, as the original's starts.
      sortField: "",
      newHours: 24,
      listContent: false,
      uploadCount: 1,
      imageWidth: 600,
      editLock: 1,
      writeReward: 5,
      commentReward: 0,
      insertContent: "",
      writeMin: 0,
      writeMax: 0,
      commentMin: 0,
      commentMax: 0,
      secret: "off",
    },
  });
  site.setRoles("m-1", ["group-g"]);
  const [listed] = (await site.query("community/boards:boards", null, M1))
    .boards;
  assert.deepEqual(listed.data, { ...saved.data, membersOnly: "g" });
  // A taken ID is not made again; a gone one is not saved.
  assert.equal(
    await refusal(create(site, "boards", "free", board)),
    "conflict",
  );
  assert.equal(
    await refusal(update(site, "boards", "gone", board)),
    "conflict",
  );
  // The form's checks hold on the server.
  for (const [change, message] of [
    [{ pageRows: 0 }, "한 페이지 글 수는 1~100입니다."],
    [
      { writeMin: 10, writeMax: 5 },
      "최소 글자 수는 최대 글자 수보다 클 수 없습니다.",
    ],
    [{ group: "nothing" }, "게시판 그룹을(를) 선택하세요."],
    [{ listLevel: 11 }, "게시판 등급은 1~10입니다."],
  ])
    assert.equal(
      await refusedWith(update(site, "boards", "free", change)),
      message,
    );
  // A save sends only what changes.
  await update(site, "boards", "free", { name: "자유게시판" });
  const read = await query(site, "boards:get", { id: "free" });
  assert.equal(read.data.name, "자유게시판");
  assert.deepEqual(read.data.categories, ["잡담", "질문"]);
  assert.deepEqual(
    (await query(site, "boards:list")).documents.map((row) => row.id),
    ["free"],
  );
  await mutate(site, "boards:remove", { id: "free" });
  assert.equal(await query(site, "boards:get", { id: "free" }), null);
});

test("content, menus, banners, quests and emoticons keep the forms' rules", async () => {
  const site = await testSite();
  await create(site, "content", "guide", { name: "안내", body: "<p>안내</p>" });
  assert.equal(
    (await query(site, "content:get", { id: "guide" })).data.readLevel,
    1,
  );
  assert.equal(
    await refusedWith(update(site, "content", "guide", { readLevel: 11 })),
    "읽기 등급은 1~10입니다.",
  );
  assert.equal(
    await refusedWith(
      create(site, "content", "bad id", { name: "x", body: "x" }),
    ),
    "ID는 영문·숫자·밑줄·하이픈 1~64자로 입력하세요.",
  );
  await create(site, "menus", "home", { name: "홈", link: "tab:members" });
  assert.equal(
    await refusedWith(update(site, "menus", "home", { link: "javascript:1" })),
    "연결은 board:ID, content:ID, tab:이름 또는 https:// 주소입니다.",
  );
  assert.equal(
    await refusedWith(update(site, "menus", "home", { parent: "home" })),
    "자기 자신은 상위 메뉴가 될 수 없습니다.",
  );
  await create(site, "banners", "b1", {
    image: "https://example.com/b.png",
    startsAt: "2030-01-01T09:00",
  });
  assert.equal(
    await refusedWith(
      update(site, "banners", "b1", { endsAt: "2029-01-01T09:00" }),
    ),
    "종료는 시작보다 늦어야 합니다.",
  );
  assert.equal(
    await refusedWith(
      update(site, "banners", "b1", { image: "https://u:p@example.com/b.png" }),
    ),
    "이미지는 인증 정보 없는 HTTPS 주소여야 합니다.",
  );
  // A quest's 소속 is one of the list once there is one.
  await create(site, "sides", "forest", { name: "숲" });
  await create(site, "quests", "q", {
    name: "일일",
    side: "숲",
    images: "https://example.com/1.png\nhttps://example.com/2.png",
  });
  assert.deepEqual((await query(site, "quests:get", { id: "q" })).data, {
    name: "일일",
    type: "daily",
    side: "숲",
    images: ["https://example.com/1.png", "https://example.com/2.png"],
  });
  assert.equal(
    await refusedWith(update(site, "quests", "q", { side: "바다" })),
    "수행 가능 소속 (비우면 공통)을(를) 선택하세요.",
  );
  await create(site, "emoticons", "smile", {
    name: ":웃음:",
    image: "https://example.com/s.png",
  });
  assert.deepEqual((await query(site, "emoticons:get", { id: "smile" })).data, {
    name: ":웃음:",
    image: "https://example.com/s.png",
  });
});

test("a member's level, warnings and note are a row; their role and groups are Naru roles", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  await create(site, "board_groups", "writers", { name: "작가" });
  site.setRoles("m-1", ["keep"]);
  const saved = await create(site, "members", "m-1", {
    level: 4,
    role: "moderator",
    groups: ["writers"],
    left: "",
  });
  assert.deepEqual(saved.data, {
    level: 4,
    role: "moderator",
    groups: ["writers"],
    adult: false,
    warnings: 0,
    warningNote: "",
    left: "",
    blocked: "",
    note: "",
  });
  assert.deepEqual(site.roles("m-1"), ["group-writers", "keep", "staff"]);
  assert.equal(
    await refusedWith(update(site, "members", "m-1", { groups: ["nothing"] })),
    "그룹 회원 (그룹 회원만 쓰는 게시판 그룹, 여러 개 선택 가능)을(를) 확인하세요.",
  );
  assert.equal(
    await refusedWith(update(site, "members", "m-1", { level: 0 })),
    "회원 등급은 1~10입니다.",
  );
  // 활동량 관리 saves the warnings alone: the rest stays.
  await update(site, "members", "m-1", { warnings: 2, warningNote: "도배" });
  const member = await query(site, "members:get", { id: "m-1" });
  assert.deepEqual(
    [member.data.level, member.data.role, member.data.warnings],
    [4, "moderator", 2],
  );
  assert.deepEqual(site.roles("m-1"), ["group-writers", "keep", "staff"]);
  // A member without a record yet keeps the roles they have.
  site.setRoles("m-2", ["staff"]);
  await create(site, "members", "m-2", { warnings: 1 });
  assert.deepEqual(site.roles("m-2"), ["staff"]);
  assert.equal(
    await refusal(create(site, "members", "m-2", { warnings: 1 })),
    "conflict",
  );
  // The list: newest visit first, found by nickname or member number.
  site.run("INSERT INTO presence (member, place, at) VALUES ('m-2', '', 5)");
  const listed = await query(site, "members:list");
  assert.deepEqual(
    listed.documents.map((row) => [row.id, row.nick, row.lastSeen]),
    [
      ["m-2", "둘", 5],
      ["m-1", "하나", null],
    ],
  );
  assert.equal(listed.documents[1].data.role, "moderator");
  assert.deepEqual(
    (await query(site, "members:list", { search: "하" })).documents.map(
      (row) => row.id,
    ),
    ["m-1"],
  );
  assert.deepEqual(
    (await query(site, "members:list", { search: "M-2" })).documents.map(
      (row) => row.id,
    ),
    ["m-2"],
  );
  // Deleting the record takes the role and groups, and keeps the others.
  await mutate(site, "members:remove", { id: "m-1" });
  assert.equal(await query(site, "members:get", { id: "m-1" }), null);
  assert.deepEqual(site.roles("m-1"), ["keep"]);
});

test("a balance and its reason are saved with the adjustment in the member's history", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  site.run("INSERT INTO wallets (member, balance) VALUES ('m-1', 10)");
  const saved = await update(site, "wallets", "m-1", {
    balance: 25,
    note: " 이벤트 보상 ",
  });
  assert.deepEqual(saved, {
    id: "m-1",
    data: { balance: 25 },
  });
  assert.deepEqual(
    history(site).map((row) => [
      row.owner,
      row.kind,
      row.delta,
      row.balance,
      row.memo,
      row.actor,
      row.at,
    ]),
    [["m-1", "adjust", 15, 25, "이벤트 보상", "site-owner", site.now]],
  );
  // The reason is asked; the member must exist; a failed save keeps nothing.
  assert.equal(
    await refusedWith(update(site, "wallets", "m-1", { balance: 30 })),
    "잔액 조정 사유을(를) 입력하세요.",
  );
  assert.equal(
    await refusedWith(
      create(site, "wallets", "m-9", { balance: 30, note: "x" }),
    ),
    "존재하는 회원을 선택하세요.",
  );
  assert.equal(history(site).length, 1);
  const { documents } = await query(site, "wallets:list");
  assert.deepEqual(
    documents.map((row) => [row.id, row.label, row.data.balance]),
    [["m-1", "하나", 25]],
  );
});

test("the owner gives an item to a member's character, named from the catalogue", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const hero = character(site, { owner: "m-1" });
  const theirs = character(site, { owner: "m-2", name: "Other" });
  await create(site, "items", "cake", { name: "케이크" });
  const given = await create(site, "inventory", "inventory_ab12", {
    owner: "m-1",
    character: hero,
    item: "cake",
    memo: "보상",
  });
  assert.match(given.id, /^\d+$/);
  assert.deepEqual(given.data, {
    owner: "m-1",
    item: "cake",
    name: "케이크",
    from: "admin",
    character: hero,
    memo: "보상",
  });
  assert.equal(
    await refusedWith(
      create(site, "inventory", "x", {
        owner: "m-1",
        character: theirs,
        item: "cake",
      }),
    ),
    "선택한 회원의 캐릭터가 아닙니다.",
  );
  await update(site, "inventory", given.id, { character: "" });
  const { documents } = await query(site, "inventory:list");
  assert.deepEqual(
    documents.map((row) => [row.id, row.ownerNick, row.characterName]),
    [[given.id, "하나", null]],
  );
  assert.equal(documents[0].data.memo, "보상");
  await mutate(site, "inventory:remove", { id: given.id });
  assert.deepEqual(site.rows("SELECT * FROM inventory"), []);
});

test("items, recipes, draws and exploration keep the forms' rules", async () => {
  const site = await testSite();
  await create(site, "stat_config", "hp", { name: "HP", initial: 10, max: 20 });
  await create(site, "items", "egg", { name: "달걀", craftMaterial: true });
  await create(site, "items", "milk", { name: "우유" });
  const cake = await create(site, "items", "cake", {
    name: "케이크",
    price: 3,
    stock: "2",
    "display.fromHour": "9",
    "effect.type": "restore",
    "effect.stat": "hp",
    "effect.amount": "2",
    "requirements.sides": "숲, 숲, 도시",
    "requirements.items": [{ item: "egg", count: "2", consume: true }],
  });
  assert.deepEqual(
    [
      cake.data.hidden,
      cake.data.stock,
      cake.data.display.fromHour,
      cake.data.effect,
      cake.data.requirements.sides,
      cake.data.requirements.items,
    ],
    [
      true,
      2,
      9,
      { type: "restore", stat: "hp", amount: 2 },
      ["숲", "도시"],
      [{ item: "egg", count: 2, consume: true }],
    ],
  );
  for (const [change, message] of [
    [{ price: -1 }, "숫자는 0 이상의 정수여야 합니다."],
    [{ "effect.amount": "0" }, "회복할 능력치와 양을 설정하세요."],
    [{ "effect.stat": "mp" }, "회복할 능력치을(를) 선택하세요."],
    [
      { "display.weekdays": "월, 휴일" },
      "진열 요일은 일, 월, 화, 수, 목, 금, 토 중에서 적어 주세요.",
    ],
  ])
    assert.equal(
      await refusedWith(update(site, "items", "cake", change)),
      message,
    );
  // A recipe's materials are rows of their own: craft materials, a
  // combination no other recipe has.
  await create(site, "recipes", "bake", {
    name: "굽기",
    item: "cake",
    cost: 5,
    ingredients: [{ item: "egg", count: 2 }],
  });
  assert.deepEqual(
    (await query(site, "recipes:get", { id: "bake" })).data.ingredients,
    [{ item: "egg", count: 2 }],
  );
  assert.equal(
    await refusedWith(
      create(site, "recipes", "again", {
        name: "또",
        item: "cake",
        ingredients: [{ item: "egg", count: 2 }],
      }),
    ),
    "이미 등록된 레시피 조합입니다: 굽기.",
  );
  assert.equal(
    await refusedWith(
      update(site, "recipes", "bake", {
        ingredients: [{ item: "milk", count: 1 }],
      }),
    ),
    "우유은(는) 조합 재료로 사용 가능하게 설정되지 않은 아이템입니다.",
  );
  await mutate(site, "recipes:remove", { id: "bake" });
  assert.deepEqual(site.rows("SELECT * FROM recipe_ingredients"), []);
  // A draw's miss keeps no item; weights are numbers.
  await create(site, "gacha", "miss", {
    source: "cake",
    item: "",
    weight: "0.5",
  });
  assert.deepEqual((await query(site, "gacha:get", { id: "miss" })).data, {
    source: "cake",
    weight: 0.5,
  });
  assert.equal(
    await refusedWith(update(site, "gacha", "miss", { item: "nothing" })),
    "결과 아이템 (빈칸: 꽝)을(를) 선택하세요.",
  );
  await create(site, "explore", "herb", { item: "cake", weight: 2 });
  assert.deepEqual(site.rows("SELECT * FROM explore"), [
    { id: "herb", item_id: "cake", weight: 2 },
  ]);
});

test("profile fields, stats, levels, sides and couples are saved as their forms check them", async () => {
  const site = await testSite();
  await create(site, "character_fields", "age", {
    label: "나이",
    type: "select",
    options: "17, 18",
    required: true,
  });
  assert.deepEqual((await site.query("characters/sheet:choices")).fields[0], {
    id: "age",
    data: {
      label: "나이",
      type: "select",
      options: ["17", "18"],
      help: "",
      suffix: "",
      order: 0,
      visibility: "public",
      required: true,
    },
  });
  assert.equal(
    await refusedWith(
      create(site, "character_fields", "Age", { label: "x", type: "text" }),
    ),
    "항목 ID는 영문 소문자로 시작하는 영문 소문자·숫자·밑줄 32자 이하입니다.",
  );
  for (let i = 0; i < 20; i++)
    await create(site, "stat_config", `s${i}`, { name: `S${i}` });
  assert.equal(
    await refusedWith(create(site, "stat_config", "s20", { name: "S20" })),
    "능력치는 최대 20개입니다.",
  );
  await create(site, "levels", "one", { name: "하나", exp: 5, bonusPoints: 2 });
  assert.deepEqual((await query(site, "levels:get", { id: "one" })).data, {
    name: "하나",
    exp: 5,
    bonusPoints: 2,
  });
  const a = character(site);
  const b = character(site, { name: "Other" });
  await create(site, "couples", "pair", {
    first: a,
    second: b,
    since: "2030-01-01",
  });
  assert.deepEqual((await query(site, "couples:get", { id: "pair" })).data, {
    first: a,
    second: b,
    since: "2030-01-01",
    order: 0,
  });
  for (const [change, message] of [
    [{ second: a }, "서로 다른 캐릭터를 선택하세요."],
    [{ first: "999" }, "존재하는 캐릭터를 선택하세요."],
    [{ since: "2030-02-30" }, "날짜를 확인하세요."],
  ])
    assert.equal(
      await refusedWith(update(site, "couples", "pair", change)),
      message,
    );
});

test("a character's record is saved at its version, with an experience change in its owner's history", async () => {
  const site = await testSite();
  const hero = character(site, { state: "approved" });
  await create(site, "stat_config", "hp", { name: "HP", initial: 10, max: 20 });
  await create(site, "titles", "brave", { name: "Brave" });
  const record = await query(site, "character_state:get", { id: hero });
  assert.deepEqual(record, {
    id: hero,
    label: "Hero",
    revision: "1",
    data: {
      exp: 0,
      stats: {},
      purchases: {},
      owner: "m-1",
      character: hero,
      approved: true,
      titles: [],
    },
  });
  const saved = await mutate(site, "character_state:save", {
    id: hero,
    revision: record.revision,
    values: {
      exp: 30,
      expNote: " 이벤트 ",
      points: 5,
      titles: ["brave"],
      "allocated:hp": 5,
      "damage:hp": 3,
    },
  });
  assert.deepEqual(
    [saved.revision, saved.data.exp, saved.data.points, saved.data.titles],
    ["2", 30, 5, ["brave"]],
  );
  assert.deepEqual(saved.data.stats, {
    hp: { allocated: 5, max: 15, damage: 3, current: 12 },
  });
  assert.deepEqual(
    history(site).map((row) => [
      row.owner,
      row.kind,
      row.character_id,
      row.exp_delta,
      row.exp,
      row.memo,
      row.actor,
    ]),
    [["m-1", "exp", hero, 30, 30, "이벤트", "site-owner"]],
  );
  // Opened at an older version: refused. Over budget: refused, nothing kept.
  assert.equal(
    await refusal(
      mutate(site, "character_state:save", {
        id: hero,
        revision: "1",
        values: { exp: 40 },
      }),
    ),
    "conflict",
  );
  assert.equal(
    await refusedWith(
      mutate(site, "character_state:save", {
        id: hero,
        values: { points: 4 },
      }),
    ),
    "배분한 능력치가 총 포인트를 넘습니다.",
  );
  // A record is its character's: none is made alone.
  assert.equal(
    await refusal(
      mutate(site, "character_state:save", {
        id: hero,
        values: {},
        create: true,
      }),
    ),
    "conflict",
  );
  // Unchanged experience writes no history.
  await mutate(site, "character_state:save", {
    id: hero,
    values: { points: 6 },
  });
  assert.equal(history(site).length, 1);
  assert.deepEqual(
    (await query(site, "character_state:list")).documents.map((row) => [
      row.id,
      row.label,
      row.data.points,
    ]),
    [[hero, "Hero", 6]],
  );
});

test("a title is given and taken back in one call, and deleting it takes it from its holders", async () => {
  const site = await testSite();
  const approved = Array.from({ length: 120 }, (_, i) =>
    character(site, { name: `C${i}`, state: "approved" }),
  );
  const editing = character(site, { name: "Editing" });
  await create(site, "titles", "award", { name: "Award" });
  await create(site, "titles", "old", { name: "Old" });
  site.run(
    "INSERT INTO character_titles (character_id, title_id) VALUES (?, 'old')",
    Number(approved[0]),
  );
  const grant = (args) =>
    mutate(site, "titles:grant", { title: "award", ...args });
  assert.deepEqual(await grant({ action: "grant", allApproved: true }), {
    completed: 120,
  });
  // Again changes nothing.
  await grant({ action: "grant", allApproved: true });
  const holders = () =>
    site.rows(
      "SELECT character_id FROM character_titles WHERE title_id = 'award' ORDER BY character_id",
    ).length;
  assert.equal(holders(), 120);
  // In the order given, not the titles' order.
  assert.deepEqual(
    (await query(site, "character_state:get", { id: approved[0] })).data.titles,
    ["old", "award"],
  );
  // The selected, once each; a hundred at once, bound as one JSON array.
  assert.deepEqual(
    await grant({ action: "grant", characters: [editing, editing] }),
    { completed: 1 },
  );
  assert.equal(holders(), 121);
  site.run(
    "UPDATE characters SET active_title = 'award' WHERE id = ?",
    Number(approved[1]),
  );
  assert.deepEqual(
    await grant({ action: "revoke", characters: approved.slice(0, 100) }),
    { completed: 100 },
  );
  assert.equal(holders(), 21);
  assert.equal(
    site.rows(
      "SELECT active_title FROM characters WHERE id = ?",
      Number(approved[1]),
    )[0].active_title,
    null,
  );
  // A missing character or title is refused, and nothing is kept.
  assert.equal(
    await refusal(grant({ action: "grant", characters: [editing, "999"] })),
    "no_character",
  );
  assert.equal(
    await refusal(
      mutate(site, "titles:grant", {
        title: "none",
        action: "grant",
        characters: [editing],
      }),
    ),
    "no_title",
  );
  assert.equal(
    await refusedWith(grant({ action: "give", characters: [editing] })),
    "지급 또는 회수를 선택하세요.",
  );
  assert.equal(
    await refusedWith(grant({ action: "grant", characters: [] })),
    "대상 캐릭터가 없습니다.",
  );
  // 타이틀 보유·착용 현황: every holding, found by name.
  site.run(
    "UPDATE characters SET active_title = 'award' WHERE id = ?",
    Number(approved[119]),
  );
  const found = await query(site, "title_holdings:list", { search: "c119" });
  assert.deepEqual(found.documents, [
    {
      characterId: approved[119],
      titleId: "award",
      character: "C119",
      title: "Award",
      image: null,
      active: true,
    },
  ]);
  // A page at a time: 21 hold the award, one the old title.
  const all = await query(site, "title_holdings:list");
  assert.equal(all.documents.length, 22);
  assert.equal(all.nextCursor, null);
  // Deleting the title takes it from the 21 holding or showing it.
  assert.deepEqual(await mutate(site, "titles:remove", { id: "award" }), {
    completed: 21,
  });
  assert.equal(holders(), 0);
  assert.deepEqual(
    site.rows("SELECT id FROM characters WHERE active_title IS NOT NULL"),
    [],
  );
  assert.equal(await query(site, "titles:get", { id: "award" }), null);
  assert.deepEqual(
    (await query(site, "title_holdings:list", { search: "old" })).documents.map(
      (row) => row.characterId,
    ),
    [approved[0]],
  );
});

test("the review searches by name or owner, filters 소속·종족 and state, and counts states", async () => {
  const site = await testSite();
  profile(site, "member-a", "A");
  profile(site, "member-b", "B");
  const at = (n) => site.now + n;
  const hero = character(site, {
    owner: "member-a",
    name: "Hero",
    state: "approved",
    side: "forest",
    class: "elf",
    created_at: at(1),
  });
  const herald = character(site, {
    owner: "member-b",
    name: "Herald",
    state: "submitted",
    side: "city",
    created_at: at(2),
  });
  const mage = character(site, {
    owner: "member-a",
    name: "Mage",
    state: "editing",
    side: "forest",
    fields: JSON.stringify({ memo: "운영자" }),
    created_at: at(3),
  });
  const ids = (result) => result.documents.map((row) => row.id);
  const review = (args = {}) => query(site, "character_review:list", args);
  const all = await review();
  assert.deepEqual(ids(all), [mage, herald, hero]);
  assert.deepEqual(all.counts, {
    all: 3,
    editing: 1,
    submitted: 1,
    approved: 1,
    deleted: 0,
  });
  assert.deepEqual(all.sides, ["city", "forest"]);
  assert.deepEqual(all.classes, ["elf"]);
  assert.equal(all.documents[0].nick, "A");
  assert.deepEqual(all.documents[0].data.fields, { memo: "운영자" });
  assert.equal(all.documents[0].revision, "1");
  assert.deepEqual(ids(await review({ text: "HER" })), [herald, hero]);
  assert.deepEqual(ids(await review({ field: "nick", text: "a" })), [
    mage,
    hero,
  ]);
  assert.deepEqual(
    ids(await review({ field: "nick", text: "A", state: "editing" })),
    [mage],
  );
  const forest = await review({ side: "forest", state: "approved" });
  assert.deepEqual(ids(forest), [hero]);
  assert.equal(forest.counts.all, 2);
  assert.deepEqual(ids(await review({ kind: "elf" })), [hero]);
  assert.deepEqual(ids(await review({ state: "deleted" })), []);
  assert.equal(await refusal(review({ state: "removed" })), "invalid_input");
  assert.equal(
    (await query(site, "character_review:get", { id: mage })).data.fields.memo,
    "운영자",
  );
});

test("visits are totalled for a range and broken down as the original's tabs, and old days pruned", async () => {
  const site = await testSite();
  const day = (date, data) =>
    site.run(
      "INSERT INTO visits (day, total, guests, members, hours, browsers) VALUES (?, ?, ?, ?, ?, ?)",
      date,
      data.total,
      data.guests,
      JSON.stringify(data.members ?? {}),
      JSON.stringify(data.hours ?? {}),
      JSON.stringify(data.browsers ?? {}),
    );
  day("2029-12-31", { total: 1, guests: 1 });
  day("2030-01-05", {
    total: 3,
    guests: 1,
    members: { a: 2 },
    hours: { 9: 2, 21: 1 },
    browsers: { Chrome: 2, Safari: 1 },
  });
  day("2030-01-06", {
    total: 2,
    guests: 0,
    members: { a: 1, b: 1 },
    hours: { 9: 2 },
    browsers: { Chrome: 2 },
  });
  day("2030-02-01", { total: 7, guests: 7 });
  const report = (args) => query(site, "visits:report", args);
  const january = await report({
    from: "2030-01-01",
    to: "2030-01-31",
    by: "day",
  });
  assert.deepEqual(january, {
    total: 5,
    guests: 1,
    members: 2,
    rows: [
      { label: "2030-01-05", count: 3 },
      { label: "2030-01-06", count: 2 },
    ],
    older: 1,
  });
  assert.deepEqual((await report({ from: "2030-01-01", by: "hour" })).rows, [
    { label: "09시", count: 4 },
    { label: "21시", count: 1 },
  ]);
  // 2030-01-05 is a Saturday, 01-06 a Sunday: Sunday first, as in Korea.
  assert.deepEqual(
    (await report({ from: "2030-01-01", to: "2030-01-31", by: "week" })).rows,
    [
      { label: "일", count: 2 },
      { label: "토", count: 3 },
    ],
  );
  assert.deepEqual((await report({ by: "browsers" })).rows, [
    { label: "Chrome", count: 4 },
    { label: "Safari", count: 1 },
  ]);
  assert.deepEqual((await report({ from: "2030-01-01", by: "month" })).rows, [
    { label: "2030-01", count: 5 },
    { label: "2030-02", count: 7 },
  ]);
  assert.equal(await refusal(report({ by: "minutes" })), "invalid_input");
  assert.deepEqual(
    await mutate(site, "visits:prune", { before: "2030-01-06" }),
    { deleted: 2 },
  );
  assert.deepEqual(
    site.rows("SELECT day FROM visits ORDER BY day").map((row) => row.day),
    ["2030-01-06", "2030-02-01"],
  );
});

test("a report sums every day in its range, past a statement's 1,000 rows, and counts only numbers", async () => {
  const site = await testSite();
  const start = Date.parse("2030-01-01T00:00:00Z");
  for (let i = 0; i < 1200; i++)
    site.run(
      "INSERT INTO visits (day, total, members, hours, domains) VALUES (?, 1, ?, ?, ?)",
      new Date(start + i * 24 * 3600 * 1000).toISOString().slice(0, 10),
      JSON.stringify({ [`m-${i % 1100}`]: 1 }),
      JSON.stringify({ 9: 1, 10: i === 0 ? "x" : 0 }),
      JSON.stringify(i === 0 ? { "b.example": 2, "a.example": 2 } : {}),
    );
  const report = (args) => query(site, "visits:report", args);
  const hours = await report({ by: "hour" });
  assert.deepEqual([hours.total, hours.members], [1200, 1100]);
  assert.deepEqual(hours.rows, [
    { label: "09시", count: 1200 },
    { label: "10시", count: 0 },
  ]);
  // Most first, then by name.
  assert.deepEqual((await report({ by: "domains" })).rows, [
    { label: "a.example", count: 2 },
    { label: "b.example", count: 2 },
  ]);
  assert.equal((await report({ by: "year" })).rows.length, 4);
});

test("activity counts each member's posts and comments on a board in a Korean date range", async () => {
  const site = await testSite();
  const main = character(site, { owner: "a", name: "초록" });
  profile(site, "a", "가", main);
  profile(site, "b", "나");
  site.run(
    "INSERT INTO members (member, warnings, warning_note) VALUES ('b', 2, '도배')",
  );
  site.run("INSERT INTO presence (member, place, at) VALUES ('a', '', 1234)");
  for (const board of ["free", "notice"])
    site.run("INSERT INTO boards (id, name) VALUES (?, ?)", board, board);
  const post = (board, owner, at) =>
    Number(
      site.run(
        "INSERT INTO posts (board, number, owner, created_at, updated_at) VALUES (?, (SELECT coalesce(max(number), 0) + 1 FROM posts WHERE board = ?), ?, ?, ?)",
        board,
        board,
        owner,
        Date.parse(at),
        Date.parse(at),
      ).lastInsertRowid,
    );
  const reply = (post, owner, at) =>
    site.run(
      "INSERT INTO comments (post_id, owner, created_at, updated_at) VALUES (?, ?, ?, ?)",
      post,
      owner,
      Date.parse(at),
      Date.parse(at),
    );
  // 2030-01-01T15:30Z is 01-02 in Korea; 01-31T15:30Z is 02-01.
  const l1 = post("free", "a", "2030-01-01T15:30:00Z");
  const l2 = post("notice", "b", "2030-01-01T10:00:00Z");
  post("free", "a", "2030-01-31T15:30:00Z");
  reply(l1, "b", "2030-01-02T01:00:00Z");
  reply(l2, "b", "2030-01-02T01:00:00Z");
  const report = (args) => query(site, "activity:report", args);
  assert.deepEqual(
    await report({ board: "free", from: "2030-01-02", to: "2030-01-31" }),
    [
      {
        id: "a",
        nick: "가",
        mainCharacter: "초록",
        logs: 1,
        comments: 0,
        lastSeen: 1234,
        warnings: 0,
        warningNote: "",
        member: false,
      },
      {
        id: "b",
        nick: "나",
        mainCharacter: "",
        logs: 0,
        comments: 1,
        lastSeen: null,
        warnings: 2,
        warningNote: "도배",
        member: true,
      },
    ],
  );
  const everything = await report({});
  assert.deepEqual(
    everything.map((row) => [row.id, row.logs, row.comments]),
    [
      ["b", 1, 2],
      ["a", 2, 0],
    ],
  );
  assert.equal(await refusal(report({ from: "어제" })), "invalid_input");
});

test("the history reads newest first, and the grants' log by its actor", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  site.run(
    "INSERT INTO history (owner, kind, at, delta, actor, details) VALUES ('m-1', 'adjust', 1, 10, 'site-owner', '{\"note\":\"x\"}')",
  );
  await site.mutate(
    "economy/grants:grant",
    { kind: "money", target: "one", name: "하나", value: 7, memo: "수고" },
    OWNER,
  );
  const all = await query(site, "history:list");
  assert.deepEqual(
    all.documents.map((row) => [row.data.kind, row.data.actor]),
    [
      ["adjust", "grant"],
      ["adjust", "site-owner"],
    ],
  );
  assert.equal(all.documents[1].data.note, "x");
  const grants = await query(site, "history:list", {
    actor: "grant",
    size: 20,
  });
  assert.deepEqual(
    grants.documents.map((row) => [
      row.data.owner,
      row.data.delta,
      row.data.memo,
    ]),
    [["m-1", 7, "수고"]],
  );
  assert.equal(
    await refusal(query(site, "history:list", { size: 1000 })),
    "invalid_input",
  );
});

test("the forms' pick lists come in one read", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  const hero = character(site);
  await create(site, "items", "egg", { name: "달걀", craftMaterial: true });
  await create(site, "sides", "s", { name: "숲", order: 2 });
  await create(site, "board_groups", "g", { name: "그룹" });
  await create(site, "boards", "free", { name: "자유" });
  const references = await query(site, "references:references");
  assert.deepEqual(references.characters, [
    { id: hero, data: { name: "Hero", owner: "m-1" } },
  ]);
  assert.deepEqual(references.profiles, [
    { id: "m-1", data: { nick: "하나" } },
  ]);
  assert.deepEqual(references.items, [
    { id: "egg", data: { name: "달걀", craftMaterial: true } },
  ]);
  assert.deepEqual(references.sides, [
    { id: "s", data: { name: "숲", order: 2 } },
  ]);
  assert.deepEqual(references.groups, [{ id: "g", data: { name: "그룹" } }]);
  assert.deepEqual(references.boards, [{ id: "free", data: { name: "자유" } }]);
  assert.deepEqual(
    [
      references.titles,
      references.stats,
      references.classes,
      references.fields,
    ],
    [[], [], [], []],
  );
});

test("pick lists page past a statement's 1,000 rows, in their order", async () => {
  const site = await testSite();
  for (let i = 0; i < 2500; i++) {
    const id = `t${String(i).padStart(4, "0")}`;
    site.run("INSERT INTO titles (id, name) VALUES (?, ?)", id, id);
    // Ordered by sort_order, then ID: odd ones first.
    site.run(
      "INSERT INTO sides (id, name, sort_order) VALUES (?, ?, ?)",
      id,
      id,
      i % 2 ? 0 : 1,
    );
  }
  const references = await query(site, "references:references");
  assert.equal(references.titles.length, 2500);
  assert.deepEqual(
    [references.titles[0].id, references.titles[2499].id],
    ["t0000", "t2499"],
  );
  const sides = references.sides.map((side) => side.id);
  assert.equal(new Set(sides).size, 2500);
  assert.deepEqual(
    [sides[0], sides[1249], sides[1250], sides[2499]],
    ["t0001", "t2499", "t0000", "t2498"],
  );
});

test("게시판 복사 makes a board with the same settings, and with 구조와 데이터 its posts", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  await create(site, "boards", "free", {
    name: "자유",
    kind: "text",
    categories: "잡담",
    writeReward: 5,
    admin: "m-1",
  });
  for (const number of [1, 2]) {
    const { lastInsertRowid } = site.run(
      "INSERT INTO posts (board, number, owner, title, body, notice, reward, created_at, updated_at) VALUES ('free', ?, 'm-1', ?, '본문', ?, 5, 0, 0)",
      number,
      `글 ${number}`,
      number === 2 ? 1 : 0,
    );
    site.run(
      "INSERT INTO posts_search (rowid, title, body) VALUES (?, ?, '본문')",
      lastInsertRowid,
      `글 ${number}`,
    );
    site.run(
      "INSERT INTO post_tags (post_id, tag) VALUES (?, '봄')",
      lastInsertRowid,
    );
    site.run(
      "INSERT INTO comments (post_id, owner, body, reward, created_at, updated_at) VALUES (?, 'm-1', '댓글', 3, 0, 0)",
      lastInsertRowid,
    );
  }
  const copy = (args) => mutate(site, "boards:copy", { id: "free", ...args });
  assert.deepEqual(await copy({ target: "plain", name: "[복사본] 자유" }), {
    id: "plain",
    posts: 0,
  });
  const plain = await query(site, "boards:get", { id: "plain" });
  assert.equal(plain.data.name, "[복사본] 자유");
  assert.deepEqual(plain.data.categories, ["잡담"]);
  assert.equal(plain.data.writeReward, 5);
  assert.equal(plain.data.admin, "m-1");
  assert.equal(
    site.rows("SELECT count(*) AS n FROM posts WHERE board = 'plain'")[0].n,
    0,
  );
  assert.equal(
    (await copy({ target: "full", name: "전체", data: true })).posts,
    2,
  );
  const posts = site.rows(
    "SELECT * FROM posts WHERE board = 'full' ORDER BY number",
  );
  assert.deepEqual(
    posts.map((row) => [row.number, row.title, row.notice, row.reward]),
    [
      [1, "글 1", 0, 0],
      [2, "글 2", 1, 0],
    ],
  );
  // Their comments, tags and full-text rows come with them; no rewards.
  for (const row of posts) {
    assert.deepEqual(
      site.rows("SELECT body, reward FROM comments WHERE post_id = ?", row.id),
      [{ body: "댓글", reward: 0 }],
    );
    assert.deepEqual(
      site.rows("SELECT tag FROM post_tags WHERE post_id = ?", row.id),
      [{ tag: "봄" }],
    );
  }
  assert.equal(
    (
      await site.query(
        "community/posts:search",
        { board: "full", text: "댓글" },
        OWNER,
      )
    ).documents.length,
    2,
  );
  assert.equal(
    (
      await site.query(
        "community/posts:search",
        { board: "full", text: "글 2" },
        OWNER,
      )
    ).documents.length,
    1,
  );
  // The originals keep theirs.
  assert.equal(
    site.rows("SELECT count(*) AS n FROM posts WHERE board = 'free'")[0].n,
    2,
  );
  for (const [args, reason] of [
    [{ target: "full", name: "다시" }, "conflict"],
    [{ target: "free", name: "같은" }, "invalid_input"],
    [{ target: "bad id", name: "띄어쓰기" }, "invalid_input"],
    [{ target: "nameless", name: "" }, "invalid_input"],
    [{ id: "none", target: "x", name: "없는" }, "document_not_found"],
  ])
    assert.equal(await refusal(copy(args)), reason, JSON.stringify(args));
});

test("회원관리 counts the blocked and the left, blocks from a day, and deletes a member's data", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  profile(site, "m-3", "셋");
  for (const member of ["m-1", "m-2", "m-3"])
    site.run("INSERT INTO members (member) VALUES (?)", member);
  await update(site, "members", "m-2", { blocked: "2026-10-16" });
  await update(site, "members", "m-3", {
    left: "2026-10-01",
    blocked: "2030-01-01",
  });
  const listed = await query(site, "members:list");
  assert.deepEqual(listed.counts, { total: 3, blocked: 2, left: 1 });
  // A block holds from its day: m-2 now, m-3 not yet (still only left).
  const standing = async (member) =>
    await site.query("community/membership:membership", null, { member });
  assert.equal((await standing("m-2")).blocked, true);
  assert.equal((await standing("m-2")).level, 1);
  assert.equal((await standing("m-3")).blocked, undefined);
  assert.equal((await standing("m-3")).left, true);
  assert.equal(
    await refusal(
      site.mutate(
        "community/membership:join",
        { nick: "둘" },
        { member: "m-2" },
      ),
    ),
    "blocked",
  );
  // 회원 삭제: the nickname stays, the member's data goes.
  site.setRoles("m-1", ["staff", "group-g", "keep"]);
  site.run("INSERT INTO wallets (member, balance) VALUES ('m-1', 50)");
  site.run(
    "INSERT INTO history (owner, kind, at, delta, balance) VALUES ('m-1', 'daily', 0, 50, 50)",
  );
  site.run(
    "INSERT INTO messages (sender, recipient, body, sent_at) VALUES ('m-1', 'm-2', 'a', 0), ('m-2', 'm-1', 'b', 0), ('m-2', 'm-3', 'c', 0)",
  );
  site.run("INSERT INTO favorites (member, post) VALUES ('m-1', 1)");
  site.run(
    "INSERT INTO boards (id, name, admin) VALUES ('free', '자유', 'm-1')",
  );
  site.run(
    "INSERT INTO board_groups (id, name, admin) VALUES ('g', '그룹', 'm-1')",
  );
  site.run(
    "INSERT INTO posts (board, number, owner, body, created_at, updated_at) VALUES ('free', 1, 'm-1', '남는 글', 0, 0)",
  );
  site.run(
    "INSERT INTO characters (owner, name, created_at) VALUES ('m-1', 'Hero', 0)",
  );
  assert.deepEqual(await mutate(site, "members:deleteMember", { id: "m-1" }), {
    id: "m-1",
    deleted: true,
  });
  const [record] = site.rows(
    "SELECT level, note FROM members WHERE member = 'm-1'",
  );
  assert.equal(record.level, 1);
  assert.equal(record.note, "20261016 삭제함");
  assert.equal(
    site.rows(
      "SELECT nick FROM profiles WHERE member = 'm-1' AND deleted_at IS NOT NULL",
    )[0].nick,
    "하나",
  );
  for (const [table, where] of [
    ["wallets", "member = 'm-1'"],
    ["history", "owner = 'm-1'"],
    ["messages", "sender = 'm-1' OR recipient = 'm-1'"],
    ["favorites", "member = 'm-1'"],
    ["boards", "admin = 'm-1'"],
    ["board_groups", "admin = 'm-1'"],
  ])
    assert.equal(
      site.rows(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)[0].n,
      0,
      table,
    );
  assert.equal(site.rows("SELECT count(*) AS n FROM messages")[0].n, 1);
  assert.deepEqual(site.roles("m-1"), ["keep"]);
  // Posts and characters stay; the nickname is no one's to take.
  assert.equal(site.rows("SELECT count(*) AS n FROM posts")[0].n, 1);
  assert.equal(site.rows("SELECT count(*) AS n FROM characters")[0].n, 1);
  assert.equal((await standing("m-1")).deleted, true);
  assert.equal(
    await refusal(
      site.mutate("community/membership:join", { nick: "다시" }, M1),
    ),
    "deleted",
  );
  assert.equal(
    await refusal(
      site.mutate(
        "community/membership:join",
        { nick: "하나" },
        { member: "m-9" },
      ),
    ),
    "nick_taken",
  );
  assert.equal(
    (await query(site, "members:list")).documents.find(
      (row) => row.id === "m-1",
    ).deleted,
    true,
  );
  // Once is enough; a stranger is not found.
  assert.deepEqual(await mutate(site, "members:deleteMember", { id: "m-1" }), {
    id: "m-1",
    deleted: false,
  });
  assert.equal(
    await refusal(mutate(site, "members:deleteMember", { id: "m-404" })),
    "document_not_found",
  );
});

test("추천인: a new member names one who joined before, who is paid, and repaid when the member is deleted", async () => {
  const site = await testSite();
  const join = (member, args) =>
    site.mutate("community/membership:join", args, { member });
  await join("m-1", { nick: "하나" });
  // Off, a recommender is not asked for, and not kept.
  await join("m-2", { nick: "둘", recommender: "하나" });
  assert.equal(
    site.rows("SELECT recommender FROM members WHERE member = 'm-2'")[0]
      .recommender,
    null,
  );
  await mutate(site, "settings:save", {
    section: "settings",
    values: { useRecommend: true, recommendReward: 30 },
  });
  for (const [args, reason] of [
    [{ nick: "셋", recommender: "없는사람" }, "no_recommender"],
    [{ nick: "셋", recommender: "셋" }, "no_recommender"],
  ])
    assert.equal(await refusal(join("m-3", args)), reason);
  await join("m-3", { nick: "셋", recommender: "하나" });
  assert.equal(
    site.rows("SELECT recommender FROM members WHERE member = 'm-3'")[0]
      .recommender,
    "m-1",
  );
  assert.deepEqual(
    site.rows("SELECT balance FROM wallets WHERE member = 'm-1'"),
    [{ balance: 30 }],
  );
  assert.equal(
    site.rows("SELECT memo FROM history WHERE owner = 'm-1'")[0].memo,
    "셋의 추천인",
  );
  // Joining again (a new nickname) names no one again.
  await join("m-3", { nick: "셋셋", recommender: "둘" });
  assert.equal(
    site.rows("SELECT recommender FROM members WHERE member = 'm-3'")[0]
      .recommender,
    "m-1",
  );
  assert.equal(
    (await query(site, "members:list")).documents.find(
      (row) => row.id === "m-3",
    ).recommender,
    "하나",
  );
  // Deleting the member takes the points back, as member_delete does.
  await mutate(site, "members:deleteMember", { id: "m-3" });
  assert.deepEqual(
    site.rows("SELECT balance FROM wallets WHERE member = 'm-1'"),
    [{ balance: 0 }],
  );
  assert.equal(
    site.rows(
      "SELECT memo FROM history WHERE owner = 'm-1' ORDER BY id DESC",
    )[0].memo,
    "셋셋님의 회원자료 삭제로 인한 추천인 포인트 반환",
  );
});

test("아이템 분류 files items as 일반, 개인 or 출석, the list by one, and 상세이미지 shows in their detail", async () => {
  const site = await testSite({ pending: "0011" });
  // Personal items made before the migration are filed as 개인 by it.
  site.run(
    "INSERT INTO items (id, name, personal) VALUES ('old-personal', '옛 개인', 1), ('old', '옛', 0)",
  );
  site.migrate();
  await create(site, "items", "daily", {
    name: "출석 보상",
    category: "attendance",
    detailImage: "https://media.example/big.png",
  });
  const ids = async (category) =>
    (await query(site, "items:list", { category })).documents.map(
      (row) => row.id,
    );
  assert.deepEqual(await ids(""), ["daily", "old", "old-personal"]);
  assert.deepEqual(await ids("personal"), ["old-personal"]);
  assert.deepEqual(await ids("attendance"), ["daily"]);
  assert.deepEqual(await ids("general"), ["old"]);
  assert.equal(
    await refusal(query(site, "items:list", { category: "other" })),
    "invalid_input",
  );
  const saved = await query(site, "items:get", { id: "daily" });
  assert.equal(saved.data.category, "attendance");
  assert.equal(saved.data.detailImage, "https://media.example/big.png");
  assert.equal(
    await refusal(
      update(site, "items", "daily", {
        detailImage: "http://media.example/x.png",
      }),
    ),
    "invalid_input",
  );
  // The shop shows members the detail picture of what it sells.
  profile(site, "m-1", "하나");
  await update(site, "items", "daily", { hidden: false });
  const shop = await site.query("economy/shop:shop", null, M1);
  const item = shop.items.find((row) => row.id === "daily");
  assert.equal(item.data.detailImage, "https://media.example/big.png");
  assert.equal(item.data.category, "attendance");
});
