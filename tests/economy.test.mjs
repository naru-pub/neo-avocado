// 실행: npm test
// The economy's queries and mutations on a real SQLite database with the
// site's migrations (tests/sql-ctx.mjs): the shop and the gacha, what
// members hold and do with it, money sent and its ledger, the owner's
// grants, items following a deleted or moved character, and the 쪽지 a
// gift sends. The owner's admin is tests/admin.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testSite } from "./sql-ctx.mjs";
import { onDisplay } from "../dist/_naru/modules/display.js";
import { GACHA_COST } from "../dist/_naru/modules/economy.js";

/** What the tabs say of community/inbox:status. */
const tabs = ({ messages, calls }) => ({ messages, calls });

const M1 = { member: "m-1" };
const M2 = { member: "m-2" };
const OWNER = { owner: true };
const P = "neo_avocado_";

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
const setSettings = (site, key, value) =>
  site.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
/** A row made directly, objects as JSON; answers its key as a string. */
function insert(site, table, row) {
  const values = Object.values(row).map((value) =>
    value !== null && typeof value === "object" ? JSON.stringify(value) : value,
  );
  const columns = Object.keys(row);
  const { lastInsertRowid } = site.run(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...values,
  );
  return String(row.id ?? lastInsertRowid);
}
const profile = (site, member, nick) =>
  insert(site, "profiles", { member, nick });
const wallet = (site, member, balance) =>
  site.run(
    "INSERT INTO wallets (member, balance) VALUES (?, ?) ON CONFLICT (member) DO UPDATE SET balance = excluded.balance",
    member,
    balance,
  );
const balanceOf = (site, member) =>
  site.rows("SELECT balance FROM wallets WHERE member = ?", member)[0]?.balance;
const character = (site, data = {}) =>
  insert(site, "characters", {
    owner: "m-1",
    name: "Hero",
    created_at: site.now,
    ...data,
  });
const characterOf = (site, id) =>
  site.rows("SELECT * FROM characters WHERE id = ?", Number(id))[0];
const item = (site, id, data = {}) =>
  insert(site, "items", { id, name: id, ...data });
/** A copy m-1 holds unless `owner` says otherwise; answers its ID. */
const own = (site, data) =>
  insert(site, "inventory", { owner: "m-1", name: data.item_id, ...data });
const held = (site, id) =>
  site.rows("SELECT * FROM inventory WHERE id = ?", Number(id))[0];
const count = (site, table) =>
  site.rows(`SELECT count(*) AS n FROM ${table}`)[0].n;
function recipe(site, id, data, ingredients) {
  insert(site, "recipes", { id, name: id, ...data });
  for (const [item_id, n] of ingredients)
    insert(site, "recipe_ingredients", { recipe_id: id, item_id, count: n });
}
const mutate = (site, name, args, who = M1) =>
  site.mutate(`economy/${name}`, args, who);
/** Runs `action` with the host's roll fixed at `roll`. */
async function rolling(roll, action) {
  const random = Math.random;
  Math.random = () => roll;
  try {
    return await action();
  } finally {
    Math.random = random;
  }
}

test("item use conditions are checked against official state before consuming tickets", async () => {
  const site = await testSite();
  const hero = character(site, {
    state: "approved",
    side: "forest",
    class: "elf",
    exp: 5,
    points: 0,
  });
  insert(site, "character_titles", {
    character_id: Number(hero),
    title_id: "winner",
  });
  item(site, "ticket", {
    name: "Ticket",
    effect: { type: "create" },
    use_requirements: {
      approved: true,
      sides: ["forest"],
      classes: ["elf"],
      exp: 10,
      title: "winner",
    },
  });
  const ticket = own(site, { item_id: "ticket", name: "Ticket" });
  const use = () =>
    mutate(site, "inventory:useItem", {
      inventory: ticket,
      character: hero,
      data: {
        name: "Medal",
        description: "A medal",
        image: "https://example.com/medal.png",
      },
    });
  assert.equal(await refusal(use()), "not_enough_exp");
  assert.ok(held(site, ticket));
  site.run("UPDATE characters SET exp = 10, class = 'human'");
  // 소속 and 종족 are the sheet's (ch_side, ch_class).
  assert.equal(await refusal(use()), "restricted_character");
  site.run("UPDATE characters SET class = 'elf'");
  await use();
  assert.equal(held(site, ticket), undefined);
});

test("character-linked purchases, exchanges and limits use official state and preserve inventory ownership", async () => {
  const site = await testSite();
  const hero = character(site, {
    side: "forest",
    class: "elf",
    exp: 20,
    points: 0,
    active_title: "winner",
  });
  insert(site, "character_titles", {
    character_id: Number(hero),
    title_id: "winner",
  });
  const friend = character(site, { owner: "m-2", name: "Friend's" });
  profile(site, "m-2", "Friend");
  wallet(site, "m-1", 100);
  item(site, "sword", {
    name: "Sword",
    price: 20,
    stock: 2,
    requirements: {
      approved: true,
      sides: ["forest"],
      classes: ["elf"],
      exp: 10,
      consumeExp: true,
      title: "winner",
      consumeTitle: true,
      limit: 1,
      items: [{ item: "seed", count: 1, consume: true }],
    },
  });
  const seed = own(site, { item_id: "seed", character_id: Number(hero) });
  const args = { item: "sword", character: hero, materials: [seed] };
  const buy = (args) => mutate(site, "shop:buy", args);
  assert.equal(await refusal(buy(args)), "not_approved");
  site.run("UPDATE characters SET state = 'approved' WHERE id = ?", hero);
  // The sheet's own 소속 decides.
  site.run("UPDATE characters SET side = 'city' WHERE id = ?", hero);
  assert.equal(await refusal(buy(args)), "restricted_character");
  site.run("UPDATE characters SET side = 'forest' WHERE id = ?", hero);
  assert.equal(
    await refusal(buy({ ...args, materials: [seed, seed] })),
    "invalid_materials",
  );
  assert.equal(balanceOf(site, "m-1"), 100);
  const result = await buy(args);
  assert.equal(result.owned.data.character, hero);
  assert.equal(result.balance, 80);
  // The seed went into it (a table may number a new row as one it deleted).
  assert.deepEqual(
    site.rows("SELECT item_id FROM inventory").map((row) => row.item_id),
    ["sword"],
  );
  assert.equal(characterOf(site, hero).exp, 10);
  assert.equal(characterOf(site, hero).active_title, null);
  assert.equal(count(site, "character_titles"), 0);
  assert.deepEqual(JSON.parse(characterOf(site, hero).purchases), {
    sword: 1,
  });
  site.run(
    "UPDATE items SET requirements = ? WHERE id = 'sword'",
    JSON.stringify({ limit: 1 }),
  );
  assert.equal(
    await refusal(buy({ item: "sword", character: hero })),
    "purchase_limit",
  );
  assert.equal(
    await refusal(
      mutate(site, "inventory:gift", {
        inventory: result.owned.id,
        recipient: "m-2",
        character: hero,
      }),
    ),
    "no_character",
  );
  await mutate(site, "inventory:gift", {
    inventory: result.owned.id,
    recipient: "m-2",
    character: friend,
  });
  assert.equal(held(site, result.owned.id).character_id, Number(friend));
  assert.equal(held(site, result.owned.id).owner, "m-2");
  assert.equal(
    await refusal(
      mutate(site, "inventory:assignInventory", {
        inventory: result.owned.id,
        character: hero,
      }),
    ),
    "not_owned",
  );
});

test("history is the member's own, newest first, a page or one kind at a time", async () => {
  const site = await testSite();
  for (const [owner, kind, at] of [
    ["m-1", "daily", 1],
    ["m-2", "buy", 2],
    ["m-1", "buy", 3],
    ["m-1", "exp", 4],
  ])
    insert(site, "history", { owner, kind, at });
  const history = (args, who = M1) =>
    site.query("economy/history:history", args, who);
  // A caller's owner is ignored.
  const first = await history({ owner: "m-2", size: 1 });
  assert.equal(first.documents[0].data.kind, "exp");
  assert.equal(
    (await history({ after: first.nextCursor, size: 1 })).documents[0].data
      .kind,
    "buy",
  );
  assert.deepEqual(
    (await history({ kind: "buy" })).documents.map((row) => row.data.at),
    [3],
  );
  // Asked with nothing, a query is given null.
  assert.equal((await history(null)).documents.length, 3);
  assert.equal(await refusal(history({ size: 21 })), "invalid_input");
  assert.equal(await refusal(history({ kind: 5 })), "invalid_input");
  assert.equal(await refusal(history(null, {})), "sign_in");
});

test("recovery uses the catalog effect, caps health, consumes once and refuses foreign characters", async () => {
  const site = await testSite();
  insert(site, "stats", { id: "hp", name: "HP", initial: 10, max: 100 });
  const hero = character(site, {
    points: 0,
    stats: { hp: { allocated: 0, max: 10, current: 3, damage: 7 } },
  });
  const theirs = character(site, { owner: "m-2" });
  item(site, "potion", {
    name: "물약",
    effect: { type: "restore", stat: "hp", amount: 4 },
  });
  const hp = () => JSON.parse(characterOf(site, hero).stats).hp.current;
  const use = (inventory, character, data) =>
    mutate(site, "inventory:useItem", { inventory, character, data });
  const p1 = own(site, { item_id: "potion", name: "물약" });
  assert.equal(await refusal(use(p1, theirs)), "not_owned");
  assert.ok(held(site, p1));
  const used = await use(p1, hero, { amount: 99999 });
  assert.equal(used.document.id, hero);
  assert.equal(hp(), 7);
  assert.equal(await refusal(use(p1, hero)), "not_owned");
  site.run("UPDATE items SET reusable = 1");
  const p2 = own(site, { item_id: "potion", name: "물약" });
  await use(p2, hero);
  assert.equal(hp(), 10);
  assert.ok(held(site, p2));
  // At full health it is still used, and the stat stays at its maximum
  // (set_status clamps; use_item.php consumes regardless).
  site.run("UPDATE items SET reusable = 0");
  await use(p2, hero);
  assert.equal(hp(), 10);
  assert.equal(held(site, p2), undefined);
});

test("draw tickets use their own odds, including misses, rather than the general table", async () => {
  const site = await testSite();
  item(site, "ticket", { name: "티켓", effect: { type: "draw" } });
  item(site, "prize", { name: "상" });
  insert(site, "gacha", { id: "general", item_id: "missing", weight: 100 });
  insert(site, "gacha", {
    id: "ticket-prize",
    source: "ticket",
    item_id: "prize",
    weight: 1,
  });
  const t1 = own(site, { item_id: "ticket", name: "티켓" });
  const first = await mutate(site, "inventory:useItem", { inventory: t1 });
  assert.equal(first.owned.data.item, "prize");
  assert.equal(first.owned.data.from, "item");
  assert.equal(held(site, t1), undefined);
  site.run("DELETE FROM gacha WHERE id = 'ticket-prize'");
  insert(site, "gacha", { id: "ticket-miss", source: "ticket", weight: 1 });
  const t2 = own(site, { item_id: "ticket", name: "티켓" });
  assert.equal(
    (await mutate(site, "inventory:useItem", { inventory: t2 })).owned,
    null,
  );
  assert.equal(held(site, t2), undefined);
  // A ticket with no table of its own has nothing to draw.
  site.run("DELETE FROM gacha WHERE source = 'ticket'");
  const t3 = own(site, { item_id: "ticket", name: "티켓" });
  assert.equal(
    await refusal(mutate(site, "inventory:useItem", { inventory: t3 })),
    "empty",
  );
  assert.ok(held(site, t3));
});

test("personal-item tickets cannot inject privileged catalog fields", async () => {
  const site = await testSite();
  item(site, "create", {
    name: "제작권",
    reusable: 1,
    effect: { type: "create" },
  });
  const ticket = own(site, { item_id: "create", name: "제작권" });
  // The original's form asks for a name, a description and an image.
  for (const data of [
    { name: "메달", description: "", image: "https://example.com/m.png" },
    { name: "메달", description: "메달" },
  ])
    assert.equal(
      await refusal(
        mutate(site, "inventory:useItem", { inventory: ticket, data }),
      ),
      "invalid_input",
    );
  const result = await mutate(site, "inventory:useItem", {
    inventory: ticket,
    data: {
      name: "메달",
      description: "메달",
      image: "https://example.com/m.png",
      effect: { type: "restore", amount: 999 },
      sellPrice: 999,
      price: -1,
    },
  });
  const [personal] = site.rows(
    "SELECT * FROM items WHERE id = ?",
    result.owned.data.item,
  );
  assert.match(personal.id, /^personal-/);
  assert.equal(personal.name, "메달");
  assert.equal(personal.image, "https://example.com/m.png");
  assert.deepEqual(
    [
      personal.sellable,
      personal.hidden,
      personal.personal,
      personal.price,
      personal.effect,
      personal.sell_price,
    ],
    [0, 1, 1, 0, null, null],
  );
  assert.equal(result.owned.data.from, "personal");
  assert.equal(held(site, ticket), undefined);
});

test("a profile ticket opens the whole sheet of an approved character once while editing is closed", async () => {
  const site = await testSite();
  setSettings(site, "community", {
    characterEditing: false,
    characterLimit: 0,
  });
  insert(site, "character_fields", {
    id: "age",
    label: "나이",
    type: "select",
    options: ["17"],
  });
  const old = character(site, { name: "Old", state: "approved", type: "sub" });
  const other = character(site, { name: "Other", state: "approved" });
  item(site, "profile", { name: "수정권", effect: { type: "profile" } });
  item(site, "potion", {
    name: "물약",
    effect: { type: "restore", stat: "hp", amount: 1 },
  });
  const ticket = own(site, { item_id: "profile", name: "수정권" });
  const bound = own(site, {
    item_id: "profile",
    character_id: Number(other),
  });
  const potion = own(site, { item_id: "potion" });
  const theirs = own(site, { item_id: "profile", owner: "m-2" });
  const save = (ticket, data = {}) =>
    site.mutate(
      "characters/sheet:save",
      {
        id: old,
        data: { name: "New", ...data },
        ...(ticket ? { ticket } : {}),
      },
      M1,
    );
  // The ticket is spent by the sheet it opens, not from the inventory.
  assert.equal(
    await refusal(
      mutate(site, "inventory:useItem", {
        inventory: ticket,
        character: old,
        data: { name: "New" },
      }),
    ),
    "use_from_sheet",
  );
  assert.equal(await refusal(save(null)), "editing_closed");
  for (const wrong of [potion, theirs, bound, "999"])
    assert.equal(await refusal(save(wrong)), "invalid_ticket");
  // The sheet is checked as any save: a bad field keeps the ticket.
  assert.equal(
    await refusal(save(ticket, { fields: { age: "99" } })),
    "invalid_field",
  );
  assert.ok(held(site, ticket));
  const saved = await save(ticket, {
    fields: { age: "17" },
    owner: "m-2",
    type: "main",
    state: "editing",
  });
  assert.equal(saved.document.data.name, "New");
  const row = characterOf(site, old);
  assert.deepEqual(
    [row.name, row.owner, row.state, row.type, JSON.parse(row.fields)],
    ["New", "m-1", "approved", "sub", { age: "17" }],
  );
  assert.equal(held(site, ticket), undefined);
  assert.deepEqual(
    site
      .rows("SELECT * FROM history WHERE kind = 'use'")
      .map((entry) => [entry.item_id, entry.character_id, entry.details]),
    [["profile", old, JSON.stringify({ effect: "profile" })]],
  );
  assert.equal(await refusal(save(ticket)), "invalid_ticket");
  // A lasting ticket (it_use_ever) stays.
  site.run("UPDATE items SET reusable = 1 WHERE id = 'profile'");
  const lasting = own(site, { item_id: "profile" });
  await save(lasting, { name: "Again" });
  assert.equal(characterOf(site, old).name, "Again");
  assert.ok(held(site, lasting));
});

test("prices and balances cannot create money through invalid arithmetic", async () => {
  const site = await testSite();
  // The table keeps only whole, non-negative prices, stock and sale prices,
  // and draw weights that are numbers from 0. (SQLite reads "10" as 10.)
  for (const price of [-1, 1.5, Infinity, null])
    assert.throws(() => item(site, "bad", { price }));
  for (const stock of [-1, 0.5])
    assert.throws(() => item(site, "bad", { stock }));
  assert.throws(() => item(site, "bad", { sell_price: -3 }));
  for (const weight of [-1, "x", 1e300])
    assert.throws(() => insert(site, "gacha", { id: "bad", weight }));
  assert.equal(count(site, "items"), 0);
  wallet(site, "m-1", Number.MAX_SAFE_INTEGER);
  profile(site, "m-1", "부자");
  setSettings(site, "community", { loginReward: 1 });
  await assert.rejects(
    site.mutate("community/presence:seen", { where: "home" }, M1),
    /Balance/,
  );
  assert.equal(balanceOf(site, "m-1"), Number.MAX_SAFE_INTEGER);
});

test("selling checks ownership and server price and cannot pay twice", async () => {
  const site = await testSite();
  item(site, "seed", { name: "씨앗", sell_price: 12 });
  const mine = own(site, { item_id: "seed", name: "씨앗" });
  const theirs = own(site, { item_id: "seed", name: "씨앗", owner: "m-2" });
  const sell = (inventory) =>
    mutate(site, "inventory:sell", { inventory, sellPrice: 10000 });
  assert.equal(await refusal(sell(theirs)), "not_owned");
  assert.equal(count(site, "wallets"), 0);
  assert.deepEqual(await sell(mine), { balance: 12, name: "씨앗" });
  assert.equal(held(site, mine), undefined);
  assert.equal(await refusal(sell(mine)), "not_owned");
  assert.equal(balanceOf(site, "m-1"), 12);
  // Not for sale back: no sale price, or the owner's 판매 허용 off.
  item(site, "keepsake", { sell_price: 5, sellable: 0 });
  item(site, "rock");
  for (const item_id of ["keepsake", "rock"])
    assert.equal(await refusal(sell(own(site, { item_id }))), "not_sellable");
});

test("gifts go to a character, another member's or one's own, keep who sent them and tell the recipient", async () => {
  const site = await testSite();
  profile(site, "m-1", "나");
  profile(site, "m-2", "친구");
  item(site, "seed", { name: "씨앗" });
  const mine = own(site, { item_id: "seed", name: "씨앗", origin: "shop" });
  for (const recipient of ["missing", "m-1", null]) {
    assert.equal(
      await refusal(
        mutate(site, "inventory:gift", { inventory: mine, recipient }),
      ),
      "no_recipient",
    );
    assert.equal(held(site, mine).owner, "m-1");
  }
  const sent = await mutate(site, "inventory:gift", {
    inventory: mine,
    recipient: "m-2",
    memo: "선물",
  });
  const expected = {
    owner: "m-2",
    item: "seed",
    name: "씨앗",
    from: "shop",
    sender: "m-1",
    senderName: "나",
    memo: "선물",
    receivedAt: site.now,
    character: null,
  };
  assert.deepEqual(sent, { owned: { id: mine, data: expected }, notice: true });
  assert.deepEqual(
    (await site.query("economy/inventory:inventory", null, M2)).inventory,
    [{ id: mine, data: expected }],
  );
  // Both sides' history.
  assert.deepEqual(
    site
      .rows("SELECT owner, kind FROM history ORDER BY id")
      .map((row) => [row.owner, row.kind]),
    [
      ["m-1", "gift"],
      ["m-2", "giftReceived"],
    ],
  );
  // The recipient's 쪽지 (send_memo) is written with it, as a gift's note,
  // not a 쪽지 the sender wrote; their inbox status counts it.
  const notes = () => site.rows("SELECT * FROM messages ORDER BY id");
  assert.equal(notes().length, 1);
  const [note] = notes();
  assert.deepEqual(
    [note.sender, note.recipient, note.sent_at, note.read_at],
    ["m-1", "m-2", site.now, null],
  );
  assert.deepEqual(JSON.parse(note.gift), { kind: "item", inventory: mine });
  assert.match(note.body, /나님이 보내신 《씨앗》 아이템이 도착/);
  assert.deepEqual(tabs(await site.query("community/inbox:status", null, M2)), {
    messages: 1,
    calls: false,
  });
  assert.equal(
    await refusal(
      mutate(site, "inventory:gift", { inventory: mine, recipient: "m-2" }),
    ),
    "not_owned",
  );
  assert.equal(
    await refusal(mutate(site, "inventory:sell", { inventory: mine })),
    "not_owned",
  );
  // To one of the sender's own characters: no 쪽지.
  const five = character(site, { name: "내캐" });
  const again = own(site, { item_id: "seed", name: "씨앗" });
  const kept = await mutate(site, "inventory:gift", {
    inventory: again,
    recipient: "m-1",
    character: five,
  });
  assert.equal(kept.notice, false);
  assert.equal(held(site, again).character_id, Number(five));
  assert.equal(notes().length, 1);
  // Not one the owner keeps from gifts, nor to a member taking no 쪽지.
  item(site, "bound", { giftable: 0 });
  assert.equal(
    await refusal(
      mutate(site, "inventory:gift", {
        inventory: own(site, { item_id: "bound" }),
        recipient: "m-2",
      }),
    ),
    "not_giftable",
  );
  site.run("UPDATE profiles SET accept_messages = 0 WHERE member = 'm-2'");
  const quiet = await mutate(site, "inventory:gift", {
    inventory: own(site, { item_id: "seed" }),
    recipient: "m-2",
  });
  assert.equal(quiet.notice, false);
  assert.equal(notes().length, 1);
});

test("crafting rejects duplicate, foreign, extra and insufficient materials before spending", async () => {
  const site = await testSite();
  wallet(site, "m-1", 100);
  recipe(site, "recipe", { item_id: "tree", cost: 20 }, [["seed", 2]]);
  item(site, "tree", { name: "나무" });
  item(site, "seed", { name: "씨앗", craft_material: 1 });
  const a = own(site, { item_id: "seed" });
  const b = own(site, { item_id: "seed" });
  const foreign = own(site, { item_id: "seed", owner: "m-2" });
  const craft = (recipe, materials) =>
    mutate(site, "inventory:craft", { recipe, materials, cost: 0 });
  for (const materials of [
    [a],
    [a, a],
    [a, b, b],
    [a, foreign],
    [a, "999"],
    [7],
    null,
  ]) {
    assert.notEqual(await refusal(craft("recipe", materials)), null);
    assert.equal(count(site, "inventory"), 3);
    assert.equal(balanceOf(site, "m-1"), 100);
  }
  const result = await craft("recipe", [a, b]);
  assert.equal(result.balance, 80);
  assert.equal(result.owned.data.item, "tree");
  assert.equal(result.owned.data.from, "craft");
  assert.equal(held(site, a), undefined);
  assert.equal(held(site, b), undefined);
  assert.ok(held(site, foreign));
  assert.notEqual(await refusal(craft("recipe", [a, b])), null);
  assert.equal(balanceOf(site, "m-1"), 80);
  // Only craft materials go in (it_use_recepi), and a reusable one stays.
  recipe(site, "tool", { item_id: "tree" }, [
    ["seed", 1],
    ["shovel", 1],
  ]);
  item(site, "shovel", { name: "삽", reusable: 1 });
  const c = own(site, { item_id: "seed" });
  const s = own(site, { item_id: "shovel" });
  assert.equal(await refusal(craft("tool", [c, s])), "not_material");
  site.run("UPDATE items SET craft_material = 1 WHERE id = 'shovel'");
  await craft("tool", [c, s]);
  assert.equal(held(site, c), undefined);
  assert.ok(held(site, s));
  // A hidden recipe (숨기기) cannot be crafted.
  site.run("UPDATE recipes SET hidden = 1 WHERE id = 'tool'");
  assert.equal(
    await refusal(craft("tool", [own(site, { item_id: "seed" }), s])),
    "no_recipe",
  );
});

test("gacha picks by weight with the server's roll, and costs what it says", async () => {
  const prize = async (roll) => {
    const site = await testSite();
    wallet(site, "m-1", GACHA_COST);
    item(site, "common", { name: "흔한 씨앗" });
    item(site, "rare", { name: "황금 아보카도" });
    insert(site, "gacha", { id: "g1", item_id: "common", weight: 9 });
    insert(site, "gacha", { id: "g2", item_id: "rare", weight: 1 });
    insert(site, "gacha", { id: "g3", item_id: "rare", weight: 0 });
    const result = await rolling(roll, () => mutate(site, "shop:gacha", null));
    assert.equal(result.balance, 0);
    assert.equal(count(site, "inventory"), 1);
    return result.owned.data.name;
  };
  assert.equal(await prize(0), "흔한 씨앗");
  assert.equal(await prize(0.89), "흔한 씨앗");
  assert.equal(await prize(0.9), "황금 아보카도");
  assert.equal(await prize(0.999), "황금 아보카도");
  const site = await testSite();
  assert.equal(await refusal(mutate(site, "shop:gacha", null)), "not_enough");
  wallet(site, "m-1", GACHA_COST);
  assert.equal(await refusal(mutate(site, "shop:gacha", null)), "empty");
  // A draw ticket's table is not the paid gacha's.
  item(site, "ticket");
  insert(site, "gacha", { id: "t", source: "ticket", item_id: "ticket" });
  assert.equal(await refusal(mutate(site, "shop:gacha", null)), "empty");
  // For one of the member's characters, or none; a miss is no item.
  const hero = character(site);
  const theirs = character(site, { owner: "m-2" });
  assert.equal(
    await refusal(mutate(site, "shop:gacha", { character: theirs })),
    "no_character",
  );
  insert(site, "gacha", { id: "miss", weight: 1 });
  const missed = await mutate(site, "shop:gacha", { character: hero });
  assert.deepEqual(missed, { balance: 0, owned: null });
  // A table naming an item the shop does not have is the owner's mistake,
  // and fails the call, which then keeps nothing.
  wallet(site, "m-1", GACHA_COST);
  site.run("UPDATE gacha SET item_id = 'gone' WHERE id = 'miss'");
  await assert.rejects(mutate(site, "shop:gacha", null), /gone/);
  assert.equal(balanceOf(site, "m-1"), GACHA_COST);
});

test("buying checks the item, its stock and the balance before taking anything", async () => {
  const site = await testSite();
  const hero = character(site, { state: "approved" });
  item(site, "sword", { name: "검", price: 80, stock: 1 });
  item(site, "potion", { name: "물약", price: 10 });
  item(site, "secret", { name: "비밀", price: 1, hidden: 1 });
  const buy = (item) => mutate(site, "shop:buy", { item, character: hero });
  assert.equal(await refusal(buy("sword")), "not_enough");
  assert.equal(count(site, "wallets"), 0);
  wallet(site, "m-1", 100);
  const bought = await buy("sword");
  assert.equal(bought.balance, 20);
  assert.deepEqual(bought.owned.data, {
    owner: "m-1",
    item: "sword",
    name: "검",
    from: "shop",
    character: hero,
  });
  assert.equal(
    site.rows("SELECT stock FROM items WHERE id = 'sword'")[0].stock,
    0,
  );
  assert.equal(await refusal(buy("sword")), "sold_out");
  // No stock is no limit.
  await buy("potion");
  assert.equal(
    site.rows("SELECT stock FROM items WHERE id = 'potion'")[0].stock,
    null,
  );
  for (const item of ["secret", "missing", undefined, 7])
    assert.equal(await refusal(buy(item)), "no_item");
  const [entry] = site.rows("SELECT * FROM history WHERE kind = 'buy'");
  assert.deepEqual(
    [
      entry.owner,
      entry.item_id,
      entry.character_id,
      entry.delta,
      entry.balance,
    ],
    ["m-1", "sword", hero, -80, 20],
  );
});

test("buying takes an approved character of the member's own, and limits count per character", async () => {
  const site = await testSite();
  wallet(site, "m-1", 100);
  item(site, "cake", { name: "케이크", price: 1, requirements: { limit: 1 } });
  const buy = (character) =>
    mutate(site, "shop:buy", {
      item: "cake",
      ...(character ? { character } : {}),
    });
  // shop/_ajax.shop_update.php:4: no character, or one not approved, buys
  // nothing; nor does someone else's.
  assert.equal(await refusal(buy(null)), "no_character");
  const draft = character(site, { state: "submitted" });
  assert.equal(await refusal(buy(draft)), "not_approved");
  const theirs = character(site, { owner: "m-2", state: "approved" });
  assert.equal(await refusal(buy(theirs)), "no_character");
  assert.equal(balanceOf(site, "m-1"), 100);
  // The limit is each character's (_ajax.shop_update.php:89), not the wallet's.
  const first = character(site, { state: "approved" });
  const second = character(site, { state: "approved" });
  await buy(first);
  assert.equal(await refusal(buy(first)), "purchase_limit");
  await buy(second);
  assert.equal(balanceOf(site, "m-1"), 98);
  assert.deepEqual(JSON.parse(characterOf(site, first).purchases), {
    cake: 1,
  });
  assert.equal(await refusal(site.mutate("economy/shop:buy", null)), "sign_in");
});

test("shop items show and sell only within their dates, hours and weekdays, in Korea", async () => {
  // 2030-01-04 is a Friday; 15:30 UTC is 00:30 Saturday 01-05 in Korea.
  const at = Date.parse("2030-01-04T15:30:00Z");
  assert.equal(onDisplay(undefined, at), true);
  assert.equal(onDisplay({ from: "2030-01-05" }, at), true);
  assert.equal(onDisplay({ until: "2030-01-04" }, at), false);
  assert.equal(onDisplay({ fromHour: 1 }, at), false);
  assert.equal(onDisplay({ untilHour: 0 }, at), true);
  assert.equal(onDisplay({ weekdays: ["토", "일"] }, at), true);
  assert.equal(onDisplay({ weekdays: ["금"] }, at), false);
  const site = await testSite({ now: at });
  const hero = character(site, { state: "approved" });
  wallet(site, "m-1", 100);
  item(site, "lunch", {
    name: "점심",
    price: 1,
    display: { fromHour: 11, untilHour: 14 },
  });
  const buy = () =>
    mutate(site, "shop:buy", { item: "lunch", character: hero });
  assert.equal(await refusal(buy()), "not_on_display");
  site.now = Date.parse("2030-01-05T03:00:00Z"); // 12:00 in Korea
  assert.equal(await refusal(buy()), null);
});

test("a character's page shows its inventory when the owner allows", async () => {
  const site = await testSite();
  const hero = character(site, { owner: "m-2", name: "용사" });
  const other = character(site, { owner: "m-2", name: "다른" });
  own(site, {
    owner: "m-2",
    item_id: "potion",
    name: "",
    character_id: Number(hero),
  });
  own(site, { owner: "m-2", item_id: "potion", character_id: Number(other) });
  item(site, "potion", { name: "물약", image: "https://example.com/p.png" });
  const sheet = (who = M1) =>
    site.query(
      "characters/progression:characterSheet",
      { character: hero },
      who,
    );
  assert.equal((await sheet()).inventory, null);
  setSettings(site, "community", { viewerInventory: true });
  assert.deepEqual((await sheet()).inventory, [
    { name: "물약", image: "https://example.com/p.png" },
  ]);
  // A later page of the history carries no inventory.
  assert.equal(
    Object.hasOwn(
      await site.query(
        "characters/progression:characterSheet",
        { character: hero, after: "1" },
        M1,
      ),
      "inventory",
    ),
    false,
  );
  setSettings(site, "community", { viewerInventory: true, siteOpen: false });
  assert.equal(await refusal(sheet({})), "site_closed");
});

test("화폐관리 sends money to a character's owner, records both sides and tells them", async () => {
  const site = await testSite();
  profile(site, "m-1", "나");
  profile(site, "m-2", "친구");
  const theirs = character(site, { owner: "m-2", name: "친구캐" });
  const mine = character(site, { name: "내캐" });
  wallet(site, "m-1", 1500);
  const send = (character, amount) =>
    mutate(site, "money:send", { character, amount });
  assert.equal(await refusal(send(theirs, 2000)), "not_enough");
  assert.equal(await refusal(send(mine, 10)), "no_recipient");
  assert.equal(await refusal(send(theirs, 0)), "invalid_input");
  assert.deepEqual(await send(theirs, 1000), {
    balance: 500,
    nick: "친구",
    notice: true,
  });
  assert.equal(balanceOf(site, "m-2"), 1000);
  // The 쪽지 is written with it.
  const [note] = site.rows("SELECT * FROM messages");
  assert.deepEqual(
    [note.sender, note.recipient, note.body, JSON.parse(note.gift)],
    [
      "m-1",
      "m-2",
      "나님이 1,000 아보 보냈습니다.",
      { kind: "money", amount: 1000 },
    ],
  );
  // The ledger shows money only: 획득 and 사용.
  insert(site, "history", { owner: "m-1", kind: "exp", at: 1, exp_delta: 5 });
  const ledger = (who) => site.query("economy/money:ledger", null, who);
  assert.deepEqual(
    (await ledger(M1)).documents.map((row) => [row.data.kind, row.data.delta]),
    [["moneySent", -1000]],
  );
  assert.deepEqual(
    (await ledger(M2)).documents.map((row) => row.data.memo),
    ["[받음] 나님"],
  );
  assert.equal(await refusal(ledger({})), "sign_in");
  // A member taking no 쪽지 gets the money without one.
  site.run("UPDATE profiles SET accept_messages = 0 WHERE member = 'm-2'");
  assert.equal((await send(theirs, 1)).notice, false);
  assert.equal(count(site, "messages"), 1);
});

test("the owner grants money and experience to one or all, and ranks add their bonus points", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  wallet(site, "m-2", 5);
  const hero = character(site, { name: "용사", state: "approved" });
  const draft = character(site, { owner: "m-2", name: "초안" });
  insert(site, "levels", { id: "lv1", name: "견습", exp: 0, bonus_points: 0 });
  insert(site, "levels", {
    id: "lv2",
    name: "숙련",
    exp: 100,
    bonus_points: 3,
  });
  const grant = (args, who = OWNER) =>
    site.mutate("economy/grants:grant", { memo: "이벤트", ...args }, who);
  assert.equal(
    await refusal(grant({ kind: "money", target: "all", value: 10 }, M1)),
    "owner_only",
  );
  // Everyone's money, but never below nothing: one call for them all.
  assert.deepEqual(await grant({ kind: "money", target: "all", value: -10 }), {
    done: true,
    granted: 0,
    skipped: 2,
  });
  await grant({ kind: "money", target: "all", value: 10 });
  assert.equal(balanceOf(site, "m-1"), 10);
  assert.equal(balanceOf(site, "m-2"), 15);
  await grant({ kind: "money", target: "one", name: "둘", value: -15 });
  assert.equal(balanceOf(site, "m-2"), 0);
  assert.equal(
    await refusal(
      grant({ kind: "money", target: "one", name: "둘", value: -1 }),
    ),
    "not_enough",
  );
  assert.equal(
    await refusal(
      grant({ kind: "money", target: "one", name: "없음", value: 1 }),
    ),
    "no_member",
  );
  // Experience to every approved character: reaching 숙련 adds 3 points,
  // falling back takes them away.
  assert.deepEqual(await grant({ kind: "exp", target: "all", value: 120 }), {
    done: true,
    granted: 1,
    skipped: 0,
  });
  assert.deepEqual(
    [characterOf(site, hero).exp, characterOf(site, hero).points],
    [120, 3],
  );
  assert.equal(characterOf(site, draft).exp, 0);
  await grant({ kind: "exp", target: "one", name: "용사", value: -50 });
  assert.deepEqual(
    [characterOf(site, hero).exp, characterOf(site, hero).points],
    [70, 0],
  );
  assert.deepEqual(await grant({ kind: "exp", target: "all", value: -80 }), {
    done: true,
    granted: 0,
    skipped: 1,
  });
  assert.equal(characterOf(site, hero).exp, 70);
  const rows = site.rows(
    "SELECT * FROM history WHERE actor = 'grant' ORDER BY id",
  );
  assert.ok(rows.every((row) => row.memo === "이벤트"));
  assert.deepEqual(
    rows.map((row) => [row.owner, row.kind, row.delta ?? row.exp_delta]),
    [
      ["m-1", "adjust", 10],
      ["m-2", "adjust", 10],
      ["m-2", "adjust", -15],
      ["m-1", "exp", 120],
      ["m-1", "exp", -50],
    ],
  );
  assert.deepEqual(
    rows.slice(0, 2).map((row) => row.balance),
    [10, 15],
  );
  assert.equal(rows[3].character_id, hero);
  assert.equal(rows[3].exp, 120);
});

test("money to everyone leaves out level-1 members, and items go to one or every approved character", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  // adm/point_update.php:18 gives to mb_level > 1 only.
  insert(site, "members", { member: "m-2", level: 1 });
  const grant = (args) => site.mutate("economy/grants:grant", args, OWNER);
  const money = await grant({ kind: "money", target: "all", value: 10 });
  assert.deepEqual([money.granted, money.skipped], [1, 0]);
  assert.equal(balanceOf(site, "m-1"), 10);
  assert.equal(balanceOf(site, "m-2"), undefined);

  const a = character(site, { name: "캐릭a", state: "approved" });
  const b = character(site, { owner: "m-2", name: "캐릭b", state: "approved" });
  const c = character(site, { owner: "m-2", name: "캐릭c", state: "editing" });
  item(site, "gem", { name: "보석" });
  const give = (args) =>
    grant({ kind: "item", item: "gem", memo: "선물", ...args });
  for (const value of [0, 101, 1.5])
    assert.equal(
      await refusal(give({ target: "one", name: "캐릭a", value })),
      "invalid_input",
    );
  assert.equal(
    await refusal(give({ target: "one", name: "캐릭a", value: 1, item: "x" })),
    "no_item",
  );
  assert.equal(
    await refusal(give({ target: "one", name: "없음", value: 1 })),
    "no_character",
  );
  const owned = (character) =>
    site.rows(
      "SELECT * FROM inventory WHERE item_id = 'gem' AND character_id = ?",
      Number(character),
    );
  assert.deepEqual(await give({ target: "one", name: "캐릭a", value: 30 }), {
    done: true,
    granted: 1,
    skipped: 0,
  });
  assert.equal(owned(a).length, 30);
  const [first] = owned(a);
  assert.deepEqual(
    [first.owner, first.name, first.origin, first.gift],
    ["m-1", "보석", "admin", "{}"],
  );
  // To every approved character, 15 each, in one call.
  assert.deepEqual(await give({ target: "all", value: 15 }), {
    done: true,
    granted: 2,
    skipped: 0,
  });
  assert.equal(owned(a).length, 45);
  assert.equal(owned(b).length, 15);
  assert.equal(owned(c).length, 0);
  assert.deepEqual(
    site
      .rows("SELECT * FROM history WHERE kind = 'grant' ORDER BY id")
      .map((row) => [
        row.owner,
        row.character_id,
        row.item_id,
        JSON.parse(row.details).count,
        JSON.parse(row.details).name,
        row.memo,
      ]),
    [
      ["m-1", a, "gem", 30, "보석", "선물"],
      ["m-1", a, "gem", 15, "보석", "선물"],
      ["m-2", b, "gem", 15, "보석", "선물"],
    ],
  );
});

test("a deleted character's items go back to their owners, a moved one's go with it", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const gone = character(site, { name: "Gone" });
  const moved = character(site, { name: "Moved" });
  const paid = own(site, { item_id: "sword", character_id: Number(gone) });
  const loose = own(site, { item_id: "sword" });
  const linked = own(site, { item_id: "cake", character_id: Number(moved) });
  await site.mutate("characters/sheet:remove", { id: gone }, M1);
  assert.deepEqual(
    [held(site, paid).owner, held(site, paid).character_id],
    ["m-1", null],
  );
  await site.mutate("characters/sheet:move", { id: moved, nick: "둘" }, OWNER);
  assert.deepEqual(
    [held(site, linked).owner, held(site, linked).character_id],
    ["m-2", Number(moved)],
  );
  assert.equal(held(site, loose).owner, "m-1");
});

test("the shop and inventory read what the member may see, in one call", async () => {
  const site = await testSite();
  item(site, "sword", { name: "검" });
  item(site, "prize", { name: "경품", hidden: 1 });
  item(site, "elixir", { name: "비약", hidden: 1 });
  item(site, "secret", { name: "비밀", hidden: 1 });
  item(site, "mine", { name: "내 것", hidden: 1 });
  recipe(site, "open", { item_id: "elixir", cost: 3 }, [["sword", 1]]);
  recipe(site, "closed", { item_id: "secret", hidden: 1 }, [["prize", 2]]);
  const hero = character(site);
  const theirs = character(site, { owner: "m-2" });
  const loose = own(site, { item_id: "mine", name: "내 것" });
  const kept = own(site, { item_id: "sword", character_id: Number(hero) });
  const shop = (args, who = M1) => site.query("economy/shop:shop", args, who);
  // Shop items, the reader's own, and those of a recipe they can see; the
  // owner's hidden recipes are no one's to read.
  const mine = await shop(null);
  assert.deepEqual(
    mine.items.map((row) => row.id),
    ["elixir", "mine", "sword"],
  );
  assert.deepEqual(mine.recipes, [
    {
      id: "open",
      data: {
        name: "open",
        description: "",
        item: "elixir",
        cost: 3,
        hidden: false,
        ingredients: [{ item: "sword", count: 1 }],
      },
    },
  ]);
  assert.deepEqual(
    mine.inventory.map((row) => row.id),
    [loose],
  );
  assert.deepEqual(
    (await shop({ character: hero })).inventory.map((row) => row.id),
    [kept],
  );
  assert.deepEqual(
    (await shop(null, M2)).items.map((row) => row.id),
    ["elixir", "sword"],
  );
  assert.deepEqual(
    (await shop(null, M1)).items.find((row) => row.id === "sword").data,
    {
      name: "검",
      description: "",
      effectDescription: "",
      shopTalk: "",
      shopCategory: "",
      category: "general",
      price: 0,
      order: 0,
      hidden: false,
      sellable: true,
      giftable: true,
      usable: true,
      usableInPosts: false,
      craftMaterial: false,
      reusable: false,
      requirements: {},
      useRequirements: {},
    },
  );
  assert.equal(await refusal(shop({ character: theirs })), "no_character");
  assert.equal(await refusal(shop(null, {})), "sign_in");
  // The inventory alone: one character's, none's, or all of it, with its
  // items, hidden ones too.
  const inventory = (args) =>
    site.query("economy/inventory:inventory", args, M1);
  const all = await inventory({ all: true });
  assert.deepEqual(
    all.inventory.map((row) => row.id),
    [loose, kept],
  );
  assert.deepEqual(all.items.map((row) => row.id).sort(), ["mine", "sword"]);
  assert.deepEqual(
    (await inventory(null)).inventory.map((row) => row.id),
    [loose],
  );
  assert.equal(await refusal(inventory({ character: theirs })), "no_character");
  // Moving a copy between the member's own characters.
  await mutate(site, "inventory:assignInventory", {
    inventory: loose,
    character: hero,
  });
  assert.equal(held(site, loose).character_id, Number(hero));
  await mutate(site, "inventory:assignInventory", { inventory: loose });
  assert.equal(held(site, loose).character_id, null);
  assert.equal(
    await refusal(
      mutate(site, "inventory:assignInventory", {
        inventory: loose,
        character: theirs,
      }),
    ),
    "no_character",
  );
});

test("상점 진열 sells an item again on its own terms: its price, stock, category and 구매 한도", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  const hero = character(site, { state: "approved" });
  wallet(site, "m-1", 100);
  // Hidden from the shop itself, sold through two entries.
  item(site, "cake", { name: "케이크", price: 50, hidden: 1 });
  insert(site, "shop_entries", {
    id: "cake-event",
    item_id: "cake",
    shop_category: "이벤트",
    price: 10,
    stock: 1,
    requirements: { limit: 1 },
  });
  insert(site, "shop_entries", {
    id: "cake-off",
    item_id: "cake",
    enabled: 0,
    price: 1,
  });
  const shop = await site.query("economy/shop:shop", {}, M1);
  assert.deepEqual(
    shop.offers.map((offer) => [offer.id, offer.item, offer.data.price]),
    [["cake-event", "cake", 10]],
  );
  // The hidden item is read for its entry's sake.
  assert.ok(shop.items.some((row) => row.id === "cake"));
  const buy = (args) =>
    site.mutate("economy/shop:buy", { character: hero, ...args }, M1);
  assert.equal(await refusal(buy({ item: "cake" })), "no_item");
  assert.equal(
    await refusal(buy({ item: "cake", entry: "cake-off" })),
    "no_item",
  );
  const bought = await buy({ item: "cake", entry: "cake-event" });
  assert.equal(bought.balance, 90);
  assert.equal(bought.owned.data.item, "cake");
  assert.equal(
    site.rows("SELECT stock FROM shop_entries WHERE id = 'cake-event'")[0]
      .stock,
    0,
  );
  assert.equal(
    await refusal(buy({ item: "cake", entry: "cake-event" })),
    "sold_out",
  );
  // The entry's 구매 한도 is its own.
  site.run("UPDATE shop_entries SET stock = NULL WHERE id = 'cake-event'");
  assert.equal(
    await refusal(buy({ item: "cake", entry: "cake-event" })),
    "purchase_limit",
  );
});
