// 실행: npm test
// 서버 함수를 나루가 부르는 그대로 부른다: ctx 하나와 인자. ctx는 메모리에
// 있는 가짜이고, 나루에서처럼 함수가 쓴 문서에는 작성자가 붙지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buy,
  daily,
  gacha,
  DAILY_REWARD,
  GACHA_COST,
  sell,
  gift,
  craft,
  relation,
  removeRelation,
  outfit,
  wear,
  removeOutfit,
  mainCharacter,
  characterStatus,
  allocateStats,
  useItem,
  assignInventory,
  equipTitle,
  history,
  sendMessage,
  mailbox,
  readMessage,
  removeMessage,
  messageStatus,
  membership,
  join,
  communityData,
  quests,
  contentPages,
  contentPage,
} from "../_naru/functions/neo-avocado.js";

const P = "neo_avocado_";
function fakeCtx({ now = Date.parse("2030-01-01T03:00:00Z"), roll = 0 } = {}) {
  const store = new Map();
  let added = 0;
  const table = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const ctx = {
    member: { id: "m-1" },
    now,
    random: () => roll,
    get: (name, id) => {
      const data = table(name).get(id);
      return data === undefined
        ? null
        : { id, data: structuredClone(data), createdBy: null, revision: "r1" };
    },
    list: (name, options = {}) => {
      const rows = [...table(name)]
        .map(([id, data]) => ({ id, data }))
        .filter((row) =>
          Object.entries(options.filter ?? {}).every(
            ([key, value]) => row.data[key] === value,
          ),
        );
      const start = Number(options.after ?? 0);
      const end = start + (options.size ?? 50);
      return {
        documents: rows.slice(start, end),
        nextCursor: end < rows.length ? String(end) : null,
      };
    },
    set: (name, id, data) => {
      table(name).set(id, structuredClone(data));
      return { id, data, createdBy: null, revision: "r1" };
    },
    add: (name, data) => ctx.set(name, `added-${added++}`, data),
    delete: (name, id) => table(name).delete(id),
  };
  return { ctx, table };
}

test("the daily reward is once per day in Korea", () => {
  const { ctx, table } = fakeCtx();
  assert.deepEqual(daily(ctx), { ok: true, balance: DAILY_REWARD });
  assert.deepEqual(daily(ctx), { ok: false, reason: "already" });
  // 2030-01-01 15:00 UTC is already 2 January in Korea.
  ctx.now = Date.parse("2030-01-01T15:00:00Z");
  assert.deepEqual(daily(ctx), { ok: true, balance: 2 * DAILY_REWARD });
  assert.equal(table(`${P}wallets`).get("m-1").lastDaily, "2030-01-02");
});

test("boards enforce independent levels, secret bodies and parent comment access", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("notes", {
    name: "Notes",
    kind: "text",
    enabled: true,
    listLevel: 2,
    readLevel: 5,
    writeLevel: 2,
    commentLevel: 5,
    categories: ["Alpha"],
    secret: "optional",
  });
  const record = communityData(ctx, {
    collection: `${P}logs`,
    operation: "add",
    data: {
      board: "notes",
      title: "Title",
      text: "private level body",
      image: null,
      category: "Alpha",
    },
  }).document;
  assert.equal(record.data.board, "notes");
  assert.equal(
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "get",
      id: record.id,
    }).reason,
    "access_denied",
  );
  const list = communityData(ctx, {
    collection: `${P}logs`,
    operation: "list",
    options: { board: "notes" },
  });
  assert.equal(list.documents[0].data.locked, true);
  assert.equal(list.documents[0].data.text, undefined);
  assert.equal(
    communityData(ctx, {
      collection: `${P}comments`,
      operation: "add",
      data: { logId: record.id, text: "no" },
    }).reason,
    "document_not_found",
  );
  table(`${P}members`).set("m-1", {
    status: "approved",
    role: "member",
    level: 5,
  });
  assert.equal(
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "get",
      id: record.id,
    }).document.data.text,
    "private level body",
  );
  const secret = communityData(ctx, {
    collection: `${P}logs`,
    operation: "add",
    data: { board: "notes", text: "secret body", secret: true },
  }).document;
  table(`${P}members`).set("m-2", {
    status: "approved",
    role: "member",
    level: 5,
  });
  ctx.member.id = "m-2";
  assert.equal(
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "get",
      id: secret.id,
    }).reason,
    "access_denied",
  );
  assert.equal(
    communityData(ctx, {
      collection: `${P}comments`,
      operation: "list",
      options: { filter: { logId: secret.id } },
    }).reason,
    "document_not_found",
  );
  table(`${P}members`).get("m-2").role = "moderator";
  assert.equal(
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "get",
      id: secret.id,
    }).document.data.text,
    "secret body",
  );
});

test("board categories, required secrets and previews are validated without truncating stored posts", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("notes", {
    name: "Notes",
    kind: "text",
    enabled: true,
    secret: "required",
    categories: ["Alpha"],
  });
  assert.equal(
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "add",
      data: { board: "notes", text: "x", category: "Unknown" },
    }).reason,
    "invalid_input",
  );
  const saved = communityData(ctx, {
    collection: `${P}logs`,
    operation: "add",
    data: { board: "notes", text: "x".repeat(2000), category: "Alpha" },
  }).document;
  assert.equal(saved.data.secret, true);
  const preview = communityData(ctx, {
    collection: `${P}logs`,
    operation: "list",
    options: { board: "notes" },
  }).documents[0];
  assert.equal(preview.data.text.length, 150);
  assert.equal(preview.data.truncated, true);
  assert.equal(
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "get",
      id: saved.id,
    }).document.data.text.length,
    2000,
  );
});

test("legacy admission fields do not override platform access; profile and role forgery stay forbidden", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}settings`).set("community", { admission: "approval" });
  assert.equal(membership(ctx).status, undefined);
  assert.equal(join(ctx, { nick: "New" }).ok, true);
  assert.equal(table(`${P}members`).get("m-1").role, "member");
  assert.equal(table(`${P}members`).get("m-1").status, undefined);
  assert.equal(daily(ctx).ok, true);
  const created = communityData(ctx, {
    collection: `${P}characters`,
    operation: "add",
    data: {
      name: "Hero",
      profile: "intro",
      owner: "m-2",
      points: 999,
      role: "moderator",
    },
  });
  assert.equal(created.document.data.owner, "m-1");
  assert.equal(created.document.data.points, undefined);
  assert.equal(
    communityData(ctx, {
      collection: `${P}members`,
      operation: "set",
      id: "m-1",
      data: { role: "moderator" },
    }).reason,
    "access_denied",
  );
  table(`${P}wallets`).set("m-2", { balance: 999 });
  assert.equal(
    communityData(ctx, {
      collection: `${P}wallets`,
      operation: "get",
      id: "m-2",
    }).reason,
    "access_denied",
  );
  table(`${P}members`).get("m-1").status = "banned";
  assert.equal(messageStatus(ctx).ok, true);
  assert.equal(join(ctx, { nick: "Approved by platform" }).ok, true);
  assert.equal(table(`${P}profiles`).get("m-1").nick, "Approved by platform");
});

test("content ownership, parent checks, revisions and moderator boundaries hold at the gateway", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}logs`).set("log", {
    owner: "m-2",
    image: "https://example.com/x.png",
    text: "original",
  });
  const args = {
    collection: `${P}logs`,
    operation: "set",
    id: "log",
    data: { image: "https://example.com/x.png", text: "edit", owner: "m-1" },
    options: { condition: { revision: "r1" } },
  };
  assert.equal(communityData(ctx, args).reason, "not_owned");
  table(`${P}members`).set("m-1", { status: "approved", role: "moderator" });
  assert.equal(
    communityData(ctx, { ...args, options: { condition: { revision: "old" } } })
      .reason,
    "conflict",
  );
  assert.equal(communityData(ctx, args).document.data.owner, "m-2");
  table(`${P}characters`).set("other", { owner: "m-2", name: "Other" });
  assert.equal(
    communityData(ctx, {
      collection: `${P}characters`,
      operation: "delete",
      id: "other",
    }).reason,
    "not_owned",
  );
  assert.equal(
    communityData(ctx, {
      collection: `${P}comments`,
      operation: "add",
      data: { logId: "missing", text: "orphan" },
    }).reason,
    "document_not_found",
  );
});

test("deletion marks durable work, hides partial cleanup and preserves purchased inventory", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}logs`).set("log", { owner: "m-1", image: "x.png" });
  for (let i = 0; i < 12; i++)
    table(`${P}comments`).set(`comment-${i}`, {
      logId: "log",
      owner: "m-2",
      text: "reply",
    });
  const deleteLog = () =>
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "delete",
      id: "log",
    });
  assert.equal(deleteLog().done, false);
  assert.equal(table(`${P}logs`).get("log").deleted, true);
  assert.equal(
    communityData(ctx, {
      collection: `${P}comments`,
      operation: "get",
      id: "comment-8",
    }).reason,
    "document_not_found",
  );
  assert.equal(deleteLog().done, false);
  assert.equal(deleteLog().done, true);
  assert.equal(table(`${P}comments`).size, 0);
  assert.equal(table(`${P}logs`).size, 0);
  table(`${P}characters`).set("hero", { owner: "m-1", name: "Hero" });
  table(`${P}profiles`).set("m-1", { owner: "m-1", mainCharacter: "hero" });
  table(`${P}inventory`).set("paid", {
    owner: "m-1",
    character: "hero",
    item: "sword",
    name: "Sword",
  });
  assert.equal(
    communityData(ctx, {
      collection: `${P}characters`,
      operation: "delete",
      id: "hero",
    }).done,
    true,
  );
  assert.equal(table(`${P}inventory`).get("paid").character, null);
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, null);
});

test("private mail checks parties for listing, reading and deletion and marks only recipient reads", () => {
  const { ctx, table } = fakeCtx();
  for (const id of ["m-1", "m-2", "m-3"])
    table(`${P}profiles`).set(id, { nick: id });
  table(`${P}wallets`).set("m-1", { balance: 10 });
  table(`${P}settings`).set("community", { messageCost: 2 });
  const sent = sendMessage(ctx, { recipients: ["m-2"], body: "private body" });
  assert.equal(sent.balance, 8);
  const id = sent.ids[0];
  assert.equal(
    mailbox(ctx, { box: "sent" }).documents[0].data.preview,
    "private body",
  );
  assert.equal(
    mailbox(ctx, { box: "inbox", filter: { to: "m-2" } }).documents.length,
    0,
  );
  assert.equal(readMessage(ctx, { id }).document.data.readAt, null);
  ctx.member.id = "m-3";
  assert.equal(readMessage(ctx, { id }).reason, "message_not_found");
  assert.equal(removeMessage(ctx, { id }).reason, "message_not_found");
  assert.equal(mailbox(ctx, { box: "sent", owner: "m-1" }).documents.length, 0);
  ctx.member.id = "m-2";
  assert.equal(messageStatus(ctx).unread, true);
  assert.equal(readMessage(ctx, { id }).document.data.readAt, ctx.now);
  assert.equal(messageStatus(ctx).unread, false);
  assert.equal(removeMessage(ctx, { id }).ok, true);
  ctx.member.id = "m-1";
  assert.equal(readMessage(ctx, { id }).reason, "message_not_found");
});

test("bulk mail validates every recipient before charging and bounds previews and pagination", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}profiles`).set("m-1", { nick: "Sender" });
  table(`${P}profiles`).set("m-2", { nick: "Recipient" });
  table(`${P}profiles`).set("blocked", {
    nick: "Closed",
    acceptMessages: false,
  });
  table(`${P}wallets`).set("m-1", { balance: 100 });
  table(`${P}settings`).set("community", { messageCost: 2 });
  for (const recipients of [
    ["m-2", "blocked"],
    ["m-2", "missing"],
    ["m-2", "m-2"],
    ["m-1"],
    [],
  ]) {
    assert.equal(sendMessage(ctx, { recipients, body: "hello" }).ok, false);
    assert.equal(table(`${P}messages`).size, 0);
    assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  }
  assert.throws(() =>
    sendMessage(ctx, { recipients: ["m-2"], body: "x".repeat(5001) }),
  );
  for (let i = 0; i < 3; i++)
    sendMessage(ctx, { recipients: ["m-2"], body: "x".repeat(5000) });
  const page = mailbox(ctx, { box: "sent", size: 2 });
  assert.equal(page.documents.length, 2);
  assert.equal(page.documents[0].data.preview.length, 150);
  assert.equal(page.documents[0].data.body, undefined);
  assert.equal(
    mailbox(ctx, { box: "sent", after: page.nextCursor, size: 2 }).documents
      .length,
    1,
  );
});
test("item use conditions are checked against official state before consuming tickets", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    approved: true,
    side: "forest",
    class: "elf",
    exp: 100,
  });
  table(`${P}items`).set("ticket", {
    name: "Ticket",
    effect: { type: "create" },
    useRequirements: {
      approved: true,
      sides: ["forest"],
      classes: ["elf"],
      exp: 10,
      title: "winner",
    },
  });
  table(`${P}inventory`).set("ticket-a", {
    owner: "m-1",
    item: "ticket",
    name: "Ticket",
  });
  table(`${P}character_state`).set("hero", {
    owner: "m-1",
    points: 0,
    exp: 5,
    stats: {},
    titles: ["winner"],
    approved: true,
    side: "forest",
    class: "elf",
  });
  const args = {
    inventory: "ticket-a",
    character: "hero",
    data: { name: "Medal" },
  };
  assert.equal(useItem(ctx, args).reason, "not_enough_exp");
  assert.equal(table(`${P}inventory`).has("ticket-a"), true);
  table(`${P}character_state`).get("hero").exp = 10;
  assert.equal(useItem(ctx, args).ok, true);
  assert.equal(table(`${P}inventory`).has("ticket-a"), false);
});

test("character-linked purchases, exchanges and limits use official state and preserve inventory ownership", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    side: "forest",
    class: "elf",
    approved: true,
    exp: 999,
  });
  table(`${P}characters`).set("other", { owner: "m-2" });
  table(`${P}profiles`).set("m-2", { nick: "Friend" });
  table(`${P}wallets`).set("m-1", { balance: 100 });
  table(`${P}items`).set("sword", {
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
  table(`${P}inventory`).set("seed", {
    owner: "m-1",
    character: "hero",
    item: "seed",
  });
  table(`${P}character_state`).set("hero", {
    owner: "m-1",
    character: "hero",
    points: 0,
    exp: 20,
    stats: {},
    titles: ["winner"],
    activeTitle: "winner",
  });
  const args = { item: "sword", character: "hero", materials: ["seed"] };
  assert.equal(buy(ctx, args).reason, "not_approved");
  const state = table(`${P}character_state`).get("hero");
  state.approved = true;
  state.side = "city";
  state.class = "elf";
  assert.equal(buy(ctx, args).reason, "restricted_character");
  state.side = "forest";
  assert.equal(
    buy(ctx, { ...args, materials: ["seed", "seed"] }).reason,
    "invalid_materials",
  );
  assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  const result = buy(ctx, args);
  assert.equal(result.owned.data.character, "hero");
  assert.equal(result.balance, 80);
  assert.equal(table(`${P}inventory`).has("seed"), false);
  assert.equal(table(`${P}character_state`).get("hero").exp, 10);
  assert.deepEqual(table(`${P}character_state`).get("hero").titles, []);
  table(`${P}items`).get("sword").requirements = { limit: 1 };
  assert.equal(
    buy(ctx, { item: "sword", character: "hero" }).reason,
    "purchase_limit",
  );
  assert.equal(
    gift(ctx, {
      inventory: result.owned.id,
      recipient: "m-2",
      character: "hero",
    }).reason,
    "no_character",
  );
  assert.equal(
    gift(ctx, {
      inventory: result.owned.id,
      recipient: "m-2",
      character: "other",
    }).ok,
    true,
  );
  assert.equal(table(`${P}inventory`).get(result.owned.id).character, "other");
  assert.equal(
    assignInventory(ctx, { inventory: result.owned.id, character: "hero" })
      .reason,
    "not_owned",
  );
});

test("history ignores a caller's owner filter, paginates, and titles require actual grants", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", { owner: "m-1" });
  table(`${P}titles`).set("winner", { name: "Winner" });
  table(`${P}titles`).set("unearned", { name: "Unearned" });
  table(`${P}character_state`).set("hero", {
    owner: "m-1",
    character: "hero",
    points: 0,
    exp: 0,
    stats: {},
    titles: ["winner"],
  });
  assert.equal(
    equipTitle(ctx, { character: "hero", title: "unearned" }).reason,
    "missing_title",
  );
  assert.equal(
    equipTitle(ctx, { character: "hero", title: "winner" }).ok,
    true,
  );
  assert.equal(table(`${P}character_state`).get("hero").activeTitle, "winner");
  table(`${P}titles`).get("winner").deleted = true;
  assert.equal(
    equipTitle(ctx, { character: "hero", title: "winner" }).reason,
    "missing_title",
  );
  assert.equal(equipTitle(ctx, { character: "hero", title: null }).ok, true);
  table(`${P}history`).set("a", { owner: "m-1", kind: "daily" });
  table(`${P}history`).set("b", { owner: "m-2", memo: "private" });
  table(`${P}history`).set("c", { owner: "m-1", kind: "buy" });
  const first = history(ctx, { owner: "m-2", size: 1 });
  assert.equal(first.documents[0].id, "a");
  assert.equal(
    history(ctx, { after: first.nextCursor, size: 1 }).documents[0].id,
    "c",
  );
  assert.equal(history(ctx, { size: 21 }).reason, "invalid_input");
});

test("stat allocation is bounded by server points and preserves damage through zero and back", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    name: "Hero",
    exp: 99999,
    points: 99999,
  });
  table(`${P}settings`).set("community", { initialStatPoints: 10 });
  table(`${P}stat_config`).set("hp", { name: "HP", initial: 0, max: 100 });
  table(`${P}levels`).set("novice", { name: "초보", exp: 0 });
  table(`${P}levels`).set("expert", { name: "전문가", exp: 100 });
  const first = characterStatus(ctx, { character: "hero" });
  assert.equal(first.state.points, 10);
  assert.equal(first.state.exp, 0);
  assert.equal(first.rank, "초보");
  assert.equal(first.revision, null);
  assert.equal(
    allocateStats(ctx, { character: "hero", allocation: { hp: 11 } }).reason,
    "not_enough_points",
  );
  assert.equal(table(`${P}character_state`).size, 0);
  assert.equal(
    allocateStats(ctx, { character: "hero", allocation: { hp: 10 } }).ok,
    true,
  );
  const saved = table(`${P}character_state`).get("hero");
  saved.stats.hp.damage = 7;
  saved.stats.hp.current = 3;
  assert.equal(
    allocateStats(ctx, {
      character: "hero",
      allocation: { hp: 0 },
      revision: "r1",
    }).ok,
    true,
  );
  assert.equal(
    allocateStats(ctx, {
      character: "hero",
      allocation: { hp: 10 },
      revision: "r1",
    }).ok,
    true,
  );
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 3);
  assert.equal(
    allocateStats(ctx, {
      character: "hero",
      allocation: { hp: 2 },
      revision: "old",
    }).reason,
    "conflict",
  );
  assert.equal(
    allocateStats(ctx, {
      character: "hero",
      allocation: { hp: 2, invented: 0 },
      revision: "r1",
    }).reason,
    "invalid_input",
  );
  ctx.member.id = "m-2";
  assert.equal(
    allocateStats(ctx, {
      character: "hero",
      allocation: { hp: 2 },
      revision: "r1",
    }).reason,
    "not_owned",
  );
});

test("recovery uses the catalog effect, caps health, consumes once and refuses foreign characters", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", { owner: "m-1" });
  table(`${P}characters`).set("other", { owner: "m-2" });
  table(`${P}stat_config`).set("hp", { name: "HP", initial: 10, max: 100 });
  table(`${P}character_state`).set("hero", {
    owner: "m-1",
    character: "hero",
    points: 0,
    exp: 0,
    stats: { hp: { allocated: 0, max: 10, current: 3, damage: 7 } },
  });
  table(`${P}items`).set("potion", {
    name: "물약",
    effect: { type: "restore", stat: "hp", amount: 4 },
  });
  table(`${P}inventory`).set("p1", {
    owner: "m-1",
    item: "potion",
    name: "물약",
  });
  assert.equal(
    useItem(ctx, { inventory: "p1", character: "other" }).reason,
    "not_owned",
  );
  assert.equal(table(`${P}inventory`).has("p1"), true);
  assert.equal(
    useItem(ctx, {
      inventory: "p1",
      character: "hero",
      data: { amount: 99999 },
    }).ok,
    true,
  );
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 7);
  assert.equal(
    useItem(ctx, { inventory: "p1", character: "hero" }).reason,
    "not_owned",
  );
  table(`${P}items`).get("potion").reusable = true;
  table(`${P}inventory`).set("p2", {
    owner: "m-1",
    item: "potion",
    name: "물약",
  });
  assert.equal(useItem(ctx, { inventory: "p2", character: "hero" }).ok, true);
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 10);
  assert.equal(table(`${P}inventory`).has("p2"), true);
  assert.equal(
    useItem(ctx, { inventory: "p2", character: "hero" }).reason,
    "already_full",
  );
});

test("draw tickets use their own odds, including misses, rather than the general table", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}items`).set("ticket", { name: "티켓", effect: { type: "draw" } });
  table(`${P}items`).set("prize", { name: "상" });
  table(`${P}gacha`).set("general", { item: "missing", weight: 100 });
  table(`${P}gacha`).set("ticket-prize", {
    source: "ticket",
    item: "prize",
    weight: 1,
  });
  table(`${P}inventory`).set("t1", {
    owner: "m-1",
    item: "ticket",
    name: "티켓",
  });
  assert.equal(useItem(ctx, { inventory: "t1" }).owned.data.item, "prize");
  assert.equal(table(`${P}inventory`).has("t1"), false);
  table(`${P}gacha`).delete("ticket-prize");
  table(`${P}gacha`).set("ticket-miss", {
    source: "ticket",
    item: null,
    weight: 1,
  });
  table(`${P}inventory`).set("t2", {
    owner: "m-1",
    item: "ticket",
    name: "티켓",
  });
  assert.equal(useItem(ctx, { inventory: "t2" }).owned, null);
  assert.equal(table(`${P}inventory`).has("t2"), false);
});

test("personal-item and profile tickets cannot inject privileged catalog or character fields", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}items`).set("create", {
    name: "제작권",
    reusable: true,
    effect: { type: "create" },
  });
  table(`${P}inventory`).set("ticket", {
    owner: "m-1",
    item: "create",
    name: "제작권",
  });
  const result = useItem(ctx, {
    inventory: "ticket",
    data: {
      name: "메달",
      effect: { type: "restore", amount: 999 },
      sellPrice: 999,
      price: -1,
    },
  });
  const personal = table(`${P}items`).get(result.owned.data.item);
  assert.equal(personal.name, "메달");
  assert.equal(personal.sellable, false);
  assert.equal(personal.effect, undefined);
  assert.equal(personal.sellPrice, undefined);
  assert.equal(table(`${P}inventory`).has("ticket"), false);
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    name: "Old",
    outfit: "keep",
  });
  table(`${P}items`).set("profile", {
    name: "수정권",
    effect: { type: "profile" },
  });
  table(`${P}inventory`).set("profile-ticket", {
    owner: "m-1",
    item: "profile",
    name: "수정권",
  });
  assert.equal(
    useItem(ctx, {
      inventory: "profile-ticket",
      character: "hero",
      data: { name: "New", revision: "old" },
    }).reason,
    "conflict",
  );
  assert.equal(table(`${P}inventory`).has("profile-ticket"), true);
  assert.equal(
    useItem(ctx, {
      inventory: "profile-ticket",
      character: "hero",
      data: { name: "New", revision: "r1", owner: "m-2", points: 99999 },
    }).ok,
    true,
  );
  assert.deepEqual(table(`${P}characters`).get("hero"), {
    owner: "m-1",
    name: "New",
    side: "",
    profile: "",
    outfit: "keep",
  });
});

test("character relationships validate source ownership, targets, revisions and text", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("mine", { owner: "m-1", name: "내 캐릭터" });
  table(`${P}characters`).set("other", { owner: "m-2", name: "상대" });
  const args = {
    character: "mine",
    target: "other",
    affinity: 20,
    memo: "친구",
    order: 1,
  };
  assert.deepEqual(
    relation(ctx, { ...args, character: "other", target: "mine" }),
    { ok: false, reason: "not_owned" },
  );
  assert.deepEqual(relation(ctx, { ...args, target: "mine" }), {
    ok: false,
    reason: "no_character",
  });
  assert.deepEqual(relation(ctx, { ...args, affinity: 101 }), {
    ok: false,
    reason: "invalid_input",
  });
  assert.throws(
    () => relation(ctx, { ...args, link: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.equal(table(`${P}relations`).size, 0);
  const created = relation(ctx, args).document;
  assert.equal(created.data.owner, "m-1");
  assert.deepEqual(
    relation(ctx, {
      ...args,
      id: created.id,
      revision: "old",
      memo: "changed",
    }),
    { ok: false, reason: "conflict" },
  );
  assert.equal(table(`${P}relations`).get(created.id).memo, "친구");
  assert.equal(
    relation(ctx, { ...args, id: created.id, revision: "r1", memo: "새 관계" })
      .ok,
    true,
  );
  ctx.member.id = "m-2";
  assert.deepEqual(removeRelation(ctx, { id: created.id }), {
    ok: false,
    reason: "not_owned",
  });
  ctx.member.id = "m-1";
  assert.equal(removeRelation(ctx, { id: created.id }).ok, true);
  assert.equal(table(`${P}relations`).size, 0);
  // A member-written decorative owner field must not override actual authorship.
  const get = ctx.get;
  ctx.get = (name, id) => {
    const row = get(name, id);
    return name === `${P}characters` && id === "mine"
      ? { ...row, createdBy: "m-2" }
      : row;
  };
  assert.deepEqual(relation(ctx, args), { ok: false, reason: "not_owned" });
});

test("wardrobe protects characters, rejects unsafe addresses and keeps the active outfit", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("mine", { owner: "m-1", name: "내 캐릭터" });
  table(`${P}characters`).set("other", { owner: "m-2", name: "상대" });
  table(`${P}profiles`).set("m-1", { nick: "나" });
  for (const image of [
    "javascript:alert(1)",
    "data:image/png;base64,x",
    "http://example.com/image",
    "https://user:secret@example.com/image",
    "https://example.com/a b",
  ])
    assert.throws(
      () => outfit(ctx, { character: "mine", name: "외출복", image }),
      /HTTPS/,
    );
  assert.equal(table(`${P}wardrobe`).size, 0);
  const clothing = outfit(ctx, {
    character: "mine",
    name: "외출복",
    image: "https://media.naru.pub/outfit.png",
  }).document;
  assert.deepEqual(wear(ctx, { character: "other", outfit: clothing.id }), {
    ok: false,
    reason: "not_owned",
  });
  assert.equal(wear(ctx, { character: "mine", outfit: clothing.id }).ok, true);
  assert.equal(table(`${P}characters`).get("mine").outfit, clothing.id);
  assert.deepEqual(removeOutfit(ctx, { id: clothing.id }), {
    ok: false,
    reason: "outfit_in_use",
  });
  assert.equal(wear(ctx, { character: "mine", outfit: null }).ok, true);
  assert.equal(removeOutfit(ctx, { id: clothing.id }).ok, true);
  assert.equal(mainCharacter(ctx, { character: "mine" }).ok, true);
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, "mine");
  assert.deepEqual(mainCharacter(ctx, { character: "other" }), {
    ok: false,
    reason: "not_owned",
  });
});

test("catalog prices and balances cannot create money through invalid arithmetic", () => {
  for (const price of [
    -1,
    Infinity,
    NaN,
    "10",
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const { ctx, table } = fakeCtx();
    table(`${P}items`).set("bad", { name: "bad", price });
    table(`${P}wallets`).set("m-1", { balance: 100 });
    assert.throws(() => buy(ctx, { item: "bad" }), /Price/);
    assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
    assert.equal(table(`${P}inventory`).size, 0);
  }
  const { ctx, table } = fakeCtx();
  table(`${P}wallets`).set("m-1", { balance: Number.MAX_SAFE_INTEGER });
  assert.throws(() => daily(ctx), /Balance/);
  assert.equal(
    table(`${P}wallets`).get("m-1").balance,
    Number.MAX_SAFE_INTEGER,
  );
});

test("selling checks ownership and server price and cannot pay twice", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}items`).set("seed", { name: "씨앗", sellPrice: 12 });
  table(`${P}inventory`).set("mine", {
    owner: "m-1",
    item: "seed",
    name: "씨앗",
  });
  table(`${P}inventory`).set("theirs", {
    owner: "m-2",
    item: "seed",
    name: "씨앗",
  });
  assert.deepEqual(sell(ctx, { inventory: "theirs", sellPrice: 10000 }), {
    ok: false,
    reason: "not_owned",
  });
  assert.equal(table(`${P}wallets`).size, 0);
  assert.deepEqual(sell(ctx, { inventory: "mine", sellPrice: 10000 }), {
    ok: true,
    balance: 12,
    name: "씨앗",
  });
  assert.equal(table(`${P}inventory`).has("mine"), false);
  assert.deepEqual(sell(ctx, { inventory: "mine" }), {
    ok: false,
    reason: "not_owned",
  });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 12);
});

test("gifts transfer one item only to an existing other member and retain provenance", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}profiles`).set("m-2", { nick: "친구" });
  table(`${P}items`).set("seed", { name: "씨앗" });
  table(`${P}inventory`).set("mine", {
    owner: "m-1",
    item: "seed",
    name: "씨앗",
    from: "shop",
  });
  for (const recipient of ["missing", "m-1", null]) {
    assert.deepEqual(gift(ctx, { inventory: "mine", recipient }), {
      ok: false,
      reason: "no_recipient",
    });
    assert.equal(table(`${P}inventory`).get("mine").owner, "m-1");
  }
  assert.equal(
    gift(ctx, { inventory: "mine", recipient: "m-2", memo: "선물" }).ok,
    true,
  );
  assert.deepEqual(table(`${P}inventory`).get("mine"), {
    owner: "m-2",
    item: "seed",
    name: "씨앗",
    from: "shop",
    sender: "m-1",
    memo: "선물",
    receivedAt: ctx.now,
    character: null,
  });
  assert.deepEqual(gift(ctx, { inventory: "mine", recipient: "m-2" }), {
    ok: false,
    reason: "not_owned",
  });
  assert.deepEqual(sell(ctx, { inventory: "mine" }), {
    ok: false,
    reason: "not_owned",
  });
});

test("crafting rejects duplicate, foreign, extra and insufficient materials before spending", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}wallets`).set("m-1", { balance: 100 });
  table(`${P}recipes`).set("recipe", {
    item: "tree",
    cost: 20,
    ingredients: [{ item: "seed", count: 2 }],
  });
  table(`${P}items`).set("tree", { name: "나무" });
  table(`${P}inventory`).set("a", { owner: "m-1", item: "seed" });
  table(`${P}inventory`).set("b", { owner: "m-1", item: "seed" });
  table(`${P}inventory`).set("foreign", { owner: "m-2", item: "seed" });
  for (const materials of [
    ["a"],
    ["a", "a"],
    ["a", "b", "b"],
    ["a", "foreign"],
    ["a", "missing"],
    [7],
    null,
  ]) {
    assert.equal(craft(ctx, { recipe: "recipe", materials }).ok, false);
    assert.equal(table(`${P}inventory`).size, 3);
    assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  }
  const result = craft(ctx, {
    recipe: "recipe",
    materials: ["a", "b"],
    cost: 0,
  });
  assert.equal(result.balance, 80);
  assert.equal(result.owned.data.item, "tree");
  assert.equal(table(`${P}inventory`).has("a"), false);
  assert.equal(table(`${P}inventory`).has("b"), false);
  assert.equal(table(`${P}inventory`).has("foreign"), true);
  assert.equal(
    craft(ctx, { recipe: "recipe", materials: ["a", "b"] }).ok,
    false,
  );
  assert.equal(table(`${P}wallets`).get("m-1").balance, 80);
});

test("gacha follows every page and rejects corrupt weights rather than changing odds", () => {
  const { ctx, table } = fakeCtx({ roll: 0.75 });
  table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
  table(`${P}items`).set("later", { name: "다음 페이지" });
  table(`${P}items`).set("first", { name: "첫 페이지" });
  const calls = [];
  ctx.list = (name, options) => {
    calls.push(options.after);
    return options.after === "next"
      ? {
          documents: [{ data: { item: "later", weight: 1 } }],
          nextCursor: null,
        }
      : {
          documents: [{ data: { item: "first", weight: 1 } }],
          nextCursor: "next",
        };
  };
  assert.equal(gacha(ctx).owned.data.name, "다음 페이지");
  assert.deepEqual(calls, [null, "next"]);
  table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
  ctx.list = () => ({
    documents: [{ data: { item: "first", weight: Infinity } }],
    nextCursor: null,
  });
  assert.throws(() => gacha(ctx), /weights/);
  assert.equal(table(`${P}wallets`).get("m-1").balance, GACHA_COST);
});

test("buying checks the item, its stock and the balance before taking anything", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}items`).set("sword", { name: "검", price: 80, stock: 1 });
  table(`${P}items`).set("potion", { name: "물약", price: 10 });
  table(`${P}items`).set("secret", { name: "비밀", price: 1, hidden: true });
  assert.deepEqual(buy(ctx, { item: "sword" }), {
    ok: false,
    reason: "not_enough",
  });
  assert.equal(table(`${P}wallets`).size, 0);
  daily(ctx);
  const bought = buy(ctx, { item: "sword" });
  assert.equal(bought.ok, true);
  assert.equal(bought.balance, DAILY_REWARD - 80);
  assert.deepEqual(bought.owned.data, {
    owner: "m-1",
    item: "sword",
    name: "검",
    from: "shop",
  });
  assert.equal(table(`${P}items`).get("sword").stock, 0);
  assert.deepEqual(buy(ctx, { item: "sword" }), {
    ok: false,
    reason: "sold_out",
  });
  // No stock is no limit.
  assert.equal(buy(ctx, { item: "potion" }).ok, true);
  assert.equal(table(`${P}items`).get("potion").stock, undefined);
  for (const item of ["secret", "missing", undefined, 7])
    assert.deepEqual(buy(ctx, { item }), { ok: false, reason: "no_item" });
});

test("gacha picks by weight with the server's roll, and costs what it says", () => {
  const prize = (roll) => {
    const { ctx, table } = fakeCtx({ roll });
    table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
    table(`${P}items`).set("common", { name: "흔한 씨앗" });
    table(`${P}items`).set("rare", { name: "황금 아보카도" });
    table(`${P}gacha`).set("g1", { item: "common", weight: 9 });
    table(`${P}gacha`).set("g2", { item: "rare", weight: 1 });
    table(`${P}gacha`).set("g3", { item: "rare", weight: 0 });
    const result = gacha(ctx);
    assert.equal(result.balance, 0);
    assert.equal(table(`${P}inventory`).size, 1);
    return result.owned.data.name;
  };
  assert.equal(prize(0), "흔한 씨앗");
  assert.equal(prize(0.89), "흔한 씨앗");
  assert.equal(prize(0.9), "황금 아보카도");
  assert.equal(prize(0.999), "황금 아보카도");
  const { ctx, table } = fakeCtx();
  assert.deepEqual(gacha(ctx), { ok: false, reason: "not_enough" });
  table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
  assert.deepEqual(gacha(ctx), { ok: false, reason: "empty" });
  // A table naming an item the shop does not have is the owner's mistake,
  // and fails the call, which Naru then rolls back.
  table(`${P}gacha`).set("g", { item: "gone", weight: 1 });
  assert.throws(() => gacha(ctx), /gone/);
});

test("quest reads enforce Korean start/end boundaries, categories and pagination", () => {
  const { ctx, table } = fakeCtx();
  ctx.now = Date.parse("2030-01-01T00:00:00Z");
  table(`${P}quests`).set("active", {
    name: "Active",
    type: "daily",
    startsAt: "2030-01-01T09:00",
    endsAt: "2030-01-01T10:00",
    images: [],
  });
  table(`${P}quests`).set("future", {
    type: "daily",
    startsAt: "2030-01-01T10:00",
  });
  table(`${P}quests`).set("ended", {
    type: "daily",
    endsAt: "2030-01-01T09:00",
  });
  table(`${P}quests`).set("corrupt", {
    type: "daily",
    startsAt: "2030-02-30T09:00",
  });
  table(`${P}quests`).set("weekly", { type: "weekly", images: [] });
  assert.deepEqual(
    quests(ctx, { type: "daily" }).documents.map((row) => row.id),
    ["active"],
  );
  assert.deepEqual(
    quests(ctx, { type: "weekly" }).documents.map((row) => row.id),
    ["weekly"],
  );
  assert.equal(quests(ctx, { type: "bad" }).reason, "invalid_input");
  for (let i = 0; i < 60; i++)
    table(`${P}quests`).set(`extra${i}`, { type: "weekly" });
  const page = quests(ctx, { type: "weekly" });
  assert.equal(page.documents.length, 50);
  assert.equal(
    quests(ctx, { type: "weekly", after: page.nextCursor }).documents.length,
    11,
  );
});

test("content read levels and publication protect both metadata and selected bodies", () => {
  const { ctx, table } = fakeCtx();
  table(`${P}content`).set("guide", {
    name: "Guide",
    body: "Desktop",
    mobileBody: "Mobile",
    enabled: true,
    readLevel: 2,
    format: "html",
  });
  table(`${P}content`).set("restricted", {
    name: "Restricted",
    body: "Private",
    readLevel: 5,
  });
  table(`${P}content`).set("draft", {
    name: "Draft",
    body: "Secret",
    enabled: false,
  });
  assert.deepEqual(contentPages(ctx).documents, [
    { id: "guide", data: { name: "Guide" } },
  ]);
  assert.equal(contentPage(ctx, { id: "guide" }).page.body, "Desktop");
  assert.equal(
    contentPage(ctx, { id: "guide", mobile: true }).page.body,
    "Mobile",
  );
  assert.equal(
    contentPage(ctx, { id: "restricted" }).reason,
    "document_not_found",
  );
  assert.equal(contentPage(ctx, { id: "draft" }).reason, "document_not_found");
  table(`${P}members`).set("m-1", { level: 5 });
  assert.equal(contentPage(ctx, { id: "restricted" }).page.body, "Private");
});
