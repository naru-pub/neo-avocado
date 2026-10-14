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
  callHistory,
  seeCalls,
  reviewCharacter,
} from "../_naru/modules/index.js";
import { scope, canWrite } from "../_naru/rules/community-board.js";
import { matches } from "./where.mjs";

const P = "neo_avocado_";
function fakeCtx({ now = Date.parse("2030-01-01T03:00:00Z"), roll = 0 } = {}) {
  const store = new Map();
  let added = 0;
  const table = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  // What ctx.notify/broadcast and ctx.media.delete sent or queued.
  const sent = [];
  const released = [];
  const ctx = {
    member: { id: "m-1" },
    now,
    random: () => roll,
    notify: (member, data) => sent.push({ member, data }),
    broadcast: (topic, data) => sent.push({ topic, data }),
    fail: (code, message, details) => {
      throw Object.assign(new Error(message), { code, details });
    },
    media: { delete: async (id) => released.push(id) },
    get: async (name, id) => {
      const data = table(name).get(id);
      return data === undefined
        ? null
        : { id, data: structuredClone(data), createdBy: null, revision: "r1" };
    },
    list: async (name, options = {}) => {
      const rows = [...table(name)]
        .map(([id, data]) => ({ id, data }))
        .filter(
          (row) =>
            Object.entries(options.filter ?? {}).every(
              ([key, value]) => row.data[key] === value,
            ) && matches(row, options.where),
        );
      const start = Number(options.after ?? 0);
      const end = start + (options.size ?? 50);
      return {
        documents: rows.slice(start, end),
        nextCursor: end < rows.length ? String(end) : null,
      };
    },
    set: async (name, id, data) => {
      table(name).set(id, structuredClone(data));
      return { id, data, createdBy: null, revision: "r1" };
    },
    add: async (name, data) => await ctx.set(name, `added-${added++}`, data),
    delete: async (name, id) => table(name).delete(id),
  };
  return { ctx, table, sent, released };
}

test("the daily reward is once per day in Korea", async () => {
  const { ctx, table } = fakeCtx();
  assert.deepEqual(await daily(ctx), { ok: true, balance: DAILY_REWARD });
  assert.deepEqual(await daily(ctx), { ok: false, reason: "already" });
  // 2030-01-01 15:00 UTC is already 2 January in Korea.
  ctx.now = Date.parse("2030-01-01T15:00:00Z");
  assert.deepEqual(await daily(ctx), { ok: true, balance: 2 * DAILY_REWARD });
  assert.equal(table(`${P}wallets`).get("m-1").lastDaily, "2030-01-02");
});

test("boards enforce independent levels, secret bodies and parent comment access", async () => {
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
  const record = (
    await communityData(ctx, {
      collection: `${P}logs`,
      operation: "add",
      data: {
        board: "notes",
        title: "Title",
        text: "private level body",
        image: null,
        category: "Alpha",
      },
    })
  ).document;
  assert.equal(record.data.board, "notes");
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "get",
        id: record.id,
      })
    ).reason,
    "access_denied",
  );
  const list = await communityData(ctx, {
    collection: `${P}logs`,
    operation: "list",
    options: { board: "notes" },
  });
  assert.equal(list.documents[0].data.locked, true);
  assert.equal(list.documents[0].data.text, undefined);
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}comments`,
        operation: "add",
        data: { logId: record.id, text: "no" },
      })
    ).reason,
    "document_not_found",
  );
  table(`${P}members`).set("m-1", {
    status: "approved",
    role: "member",
    level: 5,
  });
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "get",
        id: record.id,
      })
    ).document.data.text,
    "private level body",
  );
  const secret = (
    await communityData(ctx, {
      collection: `${P}logs`,
      operation: "add",
      data: { board: "notes", text: "secret body", secret: true },
    })
  ).document;
  table(`${P}members`).set("m-2", {
    status: "approved",
    role: "member",
    level: 5,
  });
  ctx.member.id = "m-2";
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "get",
        id: secret.id,
      })
    ).reason,
    "access_denied",
  );
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}comments`,
        operation: "list",
        options: { filter: { logId: secret.id } },
      })
    ).reason,
    "document_not_found",
  );
  table(`${P}members`).get("m-2").role = "moderator";
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "get",
        id: secret.id,
      })
    ).document.data.text,
    "secret body",
  );
});

test("board categories, required secrets and previews are validated without truncating stored posts", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("notes", {
    name: "Notes",
    kind: "text",
    enabled: true,
    secret: "required",
    categories: ["Alpha"],
  });
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "add",
        data: { board: "notes", text: "x", category: "Unknown" },
      })
    ).reason,
    "invalid_input",
  );
  const saved = (
    await communityData(ctx, {
      collection: `${P}logs`,
      operation: "add",
      data: { board: "notes", text: "x".repeat(2000), category: "Alpha" },
    })
  ).document;
  assert.equal(saved.data.secret, true);
  const preview = (
    await communityData(ctx, {
      collection: `${P}logs`,
      operation: "list",
      options: { board: "notes" },
    })
  ).documents[0];
  assert.equal(preview.data.text.length, 150);
  assert.equal(preview.data.truncated, true);
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "get",
        id: saved.id,
      })
    ).document.data.text.length,
    2000,
  );
});

test("legacy admission fields do not override platform access; profile and role forgery stay forbidden", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}settings`).set("community", { admission: "approval" });
  assert.equal((await membership(ctx)).status, undefined);
  assert.equal((await join(ctx, { nick: "New" })).ok, true);
  assert.equal(table(`${P}members`).get("m-1").role, "member");
  assert.equal(table(`${P}members`).get("m-1").status, undefined);
  assert.equal((await daily(ctx)).ok, true);
  const created = await communityData(ctx, {
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
    (
      await communityData(ctx, {
        collection: `${P}members`,
        operation: "set",
        id: "m-1",
        data: { role: "moderator" },
      })
    ).reason,
    "access_denied",
  );
  table(`${P}wallets`).set("m-2", { balance: 999 });
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}wallets`,
        operation: "get",
        id: "m-2",
      })
    ).reason,
    "access_denied",
  );
  table(`${P}members`).get("m-1").status = "banned";
  assert.equal((await messageStatus(ctx)).ok, true);
  assert.equal((await join(ctx, { nick: "Approved by platform" })).ok, true);
  assert.equal(table(`${P}profiles`).get("m-1").nick, "Approved by platform");
});

test("content ownership, parent checks, revisions and moderator boundaries hold at the gateway", async () => {
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
  assert.equal((await communityData(ctx, args)).reason, "not_owned");
  table(`${P}members`).set("m-1", { status: "approved", role: "moderator" });
  assert.equal(
    (
      await communityData(ctx, {
        ...args,
        options: { condition: { revision: "old" } },
      })
    ).reason,
    "conflict",
  );
  assert.equal((await communityData(ctx, args)).document.data.owner, "m-2");
  table(`${P}characters`).set("other", { owner: "m-2", name: "Other" });
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}characters`,
        operation: "delete",
        id: "other",
      })
    ).reason,
    "not_owned",
  );
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}comments`,
        operation: "add",
        data: { logId: "missing", text: "orphan" },
      })
    ).reason,
    "document_not_found",
  );
});

test("deletion marks durable work, hides partial cleanup and preserves purchased inventory", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}logs`).set("log", { owner: "m-1", image: "x.png" });
  for (let i = 0; i < 12; i++)
    table(`${P}comments`).set(`comment-${i}`, {
      logId: "log",
      owner: "m-2",
      text: "reply",
    });
  const deleteLog = async () =>
    await communityData(ctx, {
      collection: `${P}logs`,
      operation: "delete",
      id: "log",
    });
  assert.equal((await deleteLog()).done, false);
  assert.equal(table(`${P}logs`).get("log").deleted, true);
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}comments`,
        operation: "get",
        id: "comment-8",
      })
    ).reason,
    "document_not_found",
  );
  assert.equal((await deleteLog()).done, false);
  assert.equal((await deleteLog()).done, true);
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
    (
      await communityData(ctx, {
        collection: `${P}characters`,
        operation: "delete",
        id: "hero",
      })
    ).done,
    true,
  );
  assert.equal(table(`${P}inventory`).get("paid").character, null);
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, null);
});

test("private mail checks parties for listing, reading and deletion and marks only recipient reads", async () => {
  const { ctx, table, sent: live } = fakeCtx();
  for (const id of ["m-1", "m-2", "m-3"])
    table(`${P}profiles`).set(id, { nick: id });
  table(`${P}wallets`).set("m-1", { balance: 10 });
  table(`${P}settings`).set("community", { messageCost: 2 });
  const sent = await sendMessage(ctx, {
    recipients: ["m-2"],
    body: "private body",
  });
  assert.equal(sent.balance, 8);
  assert.deepEqual(live, [{ member: "m-2", data: { unread: true } }]);
  const id = sent.ids[0];
  assert.equal(
    (await mailbox(ctx, { box: "sent" })).documents[0].data.preview,
    "private body",
  );
  assert.equal(
    (await mailbox(ctx, { box: "inbox", filter: { to: "m-2" } })).documents
      .length,
    0,
  );
  assert.equal((await readMessage(ctx, { id })).document.data.readAt, null);
  ctx.member.id = "m-3";
  assert.equal((await readMessage(ctx, { id })).reason, "message_not_found");
  assert.equal((await removeMessage(ctx, { id })).reason, "message_not_found");
  assert.equal(
    (await mailbox(ctx, { box: "sent", owner: "m-1" })).documents.length,
    0,
  );
  ctx.member.id = "m-2";
  assert.equal((await messageStatus(ctx)).unread, true);
  assert.equal((await readMessage(ctx, { id })).document.data.readAt, ctx.now);
  assert.equal((await messageStatus(ctx)).unread, false);
  // The receipt tells the recipient's other tabs; a second read sends nothing.
  assert.deepEqual(live.at(-1), { member: "m-2", data: { unread: false } });
  await readMessage(ctx, { id });
  assert.equal(live.length, 2);
  assert.equal((await removeMessage(ctx, { id })).ok, true);
  ctx.member.id = "m-1";
  assert.equal((await readMessage(ctx, { id })).reason, "message_not_found");
});

test("bulk mail validates every recipient before charging and bounds previews and pagination", async () => {
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
    assert.equal(
      (await sendMessage(ctx, { recipients, body: "hello" })).ok,
      false,
    );
    assert.equal(table(`${P}messages`).size, 0);
    assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  }
  await assert.rejects(
    async () =>
      await sendMessage(ctx, { recipients: ["m-2"], body: "x".repeat(5001) }),
  );
  for (let i = 0; i < 3; i++)
    await sendMessage(ctx, { recipients: ["m-2"], body: "x".repeat(5000) });
  const page = await mailbox(ctx, { box: "sent", size: 2 });
  assert.equal(page.documents.length, 2);
  assert.equal(page.documents[0].data.preview.length, 150);
  assert.equal(page.documents[0].data.body, undefined);
  assert.equal(
    (await mailbox(ctx, { box: "sent", after: page.nextCursor, size: 2 }))
      .documents.length,
    1,
  );
});
test("item use conditions are checked against official state before consuming tickets", async () => {
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
  assert.equal((await useItem(ctx, args)).reason, "not_enough_exp");
  assert.equal(table(`${P}inventory`).has("ticket-a"), true);
  table(`${P}character_state`).get("hero").exp = 10;
  assert.equal((await useItem(ctx, args)).ok, true);
  assert.equal(table(`${P}inventory`).has("ticket-a"), false);
});

test("character-linked purchases, exchanges and limits use official state and preserve inventory ownership", async () => {
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
  assert.equal((await buy(ctx, args)).reason, "not_approved");
  const state = table(`${P}character_state`).get("hero");
  state.approved = true;
  state.side = "city";
  state.class = "elf";
  assert.equal((await buy(ctx, args)).reason, "restricted_character");
  state.side = "forest";
  assert.equal(
    (await buy(ctx, { ...args, materials: ["seed", "seed"] })).reason,
    "invalid_materials",
  );
  assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  const result = await buy(ctx, args);
  assert.equal(result.owned.data.character, "hero");
  assert.equal(result.balance, 80);
  assert.equal(table(`${P}inventory`).has("seed"), false);
  assert.equal(table(`${P}character_state`).get("hero").exp, 10);
  assert.deepEqual(table(`${P}character_state`).get("hero").titles, []);
  table(`${P}items`).get("sword").requirements = { limit: 1 };
  assert.equal(
    (await buy(ctx, { item: "sword", character: "hero" })).reason,
    "purchase_limit",
  );
  assert.equal(
    (
      await gift(ctx, {
        inventory: result.owned.id,
        recipient: "m-2",
        character: "hero",
      })
    ).reason,
    "no_character",
  );
  assert.equal(
    (
      await gift(ctx, {
        inventory: result.owned.id,
        recipient: "m-2",
        character: "other",
      })
    ).ok,
    true,
  );
  assert.equal(table(`${P}inventory`).get(result.owned.id).character, "other");
  assert.equal(
    (
      await assignInventory(ctx, {
        inventory: result.owned.id,
        character: "hero",
      })
    ).reason,
    "not_owned",
  );
});

test("history ignores a caller's owner filter, paginates, and titles require actual grants", async () => {
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
    (await equipTitle(ctx, { character: "hero", title: "unearned" })).reason,
    "missing_title",
  );
  assert.equal(
    (await equipTitle(ctx, { character: "hero", title: "winner" })).ok,
    true,
  );
  assert.equal(table(`${P}character_state`).get("hero").activeTitle, "winner");
  table(`${P}titles`).get("winner").deleted = true;
  assert.equal(
    (await equipTitle(ctx, { character: "hero", title: "winner" })).reason,
    "missing_title",
  );
  assert.equal(
    (await equipTitle(ctx, { character: "hero", title: null })).ok,
    true,
  );
  table(`${P}history`).set("a", { owner: "m-1", kind: "daily" });
  table(`${P}history`).set("b", { owner: "m-2", memo: "private" });
  table(`${P}history`).set("c", { owner: "m-1", kind: "buy" });
  const first = await history(ctx, { owner: "m-2", size: 1 });
  assert.equal(first.documents[0].id, "a");
  assert.equal(
    (await history(ctx, { after: first.nextCursor, size: 1 })).documents[0].id,
    "c",
  );
  assert.equal((await history(ctx, { size: 21 })).reason, "invalid_input");
});

test("stat allocation is bounded by server points and preserves damage through zero and back", async () => {
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
  const first = await characterStatus(ctx, { character: "hero" });
  assert.equal(first.state.points, 10);
  assert.equal(first.state.exp, 0);
  assert.equal(first.rank, "초보");
  assert.equal(first.revision, null);
  assert.equal(
    (await allocateStats(ctx, { character: "hero", allocation: { hp: 11 } }))
      .reason,
    "not_enough_points",
  );
  assert.equal(table(`${P}character_state`).size, 0);
  assert.equal(
    (await allocateStats(ctx, { character: "hero", allocation: { hp: 10 } }))
      .ok,
    true,
  );
  const saved = table(`${P}character_state`).get("hero");
  saved.stats.hp.damage = 7;
  saved.stats.hp.current = 3;
  assert.equal(
    (
      await allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 0 },
        revision: "r1",
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 10 },
        revision: "r1",
      })
    ).ok,
    true,
  );
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 3);
  assert.equal(
    (
      await allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 2 },
        revision: "old",
      })
    ).reason,
    "conflict",
  );
  assert.equal(
    (
      await allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 2, invented: 0 },
        revision: "r1",
      })
    ).reason,
    "invalid_input",
  );
  ctx.member.id = "m-2";
  assert.equal(
    (
      await allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 2 },
        revision: "r1",
      })
    ).reason,
    "not_owned",
  );
});

test("recovery uses the catalog effect, caps health, consumes once and refuses foreign characters", async () => {
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
    (await useItem(ctx, { inventory: "p1", character: "other" })).reason,
    "not_owned",
  );
  assert.equal(table(`${P}inventory`).has("p1"), true);
  assert.equal(
    (
      await useItem(ctx, {
        inventory: "p1",
        character: "hero",
        data: { amount: 99999 },
      })
    ).ok,
    true,
  );
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 7);
  assert.equal(
    (await useItem(ctx, { inventory: "p1", character: "hero" })).reason,
    "not_owned",
  );
  table(`${P}items`).get("potion").reusable = true;
  table(`${P}inventory`).set("p2", {
    owner: "m-1",
    item: "potion",
    name: "물약",
  });
  assert.equal(
    (await useItem(ctx, { inventory: "p2", character: "hero" })).ok,
    true,
  );
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 10);
  assert.equal(table(`${P}inventory`).has("p2"), true);
  assert.equal(
    (await useItem(ctx, { inventory: "p2", character: "hero" })).reason,
    "already_full",
  );
});

test("draw tickets use their own odds, including misses, rather than the general table", async () => {
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
  assert.equal(
    (await useItem(ctx, { inventory: "t1" })).owned.data.item,
    "prize",
  );
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
  assert.equal((await useItem(ctx, { inventory: "t2" })).owned, null);
  assert.equal(table(`${P}inventory`).has("t2"), false);
});

test("personal-item and profile tickets cannot inject privileged catalog or character fields", async () => {
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
  const result = await useItem(ctx, {
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
    (
      await useItem(ctx, {
        inventory: "profile-ticket",
        character: "hero",
        data: { name: "New", revision: "old" },
      })
    ).reason,
    "conflict",
  );
  assert.equal(table(`${P}inventory`).has("profile-ticket"), true);
  assert.equal(
    (
      await useItem(ctx, {
        inventory: "profile-ticket",
        character: "hero",
        data: { name: "New", revision: "r1", owner: "m-2", points: 99999 },
      })
    ).ok,
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

test("character relationships validate source ownership, targets, revisions and text", async () => {
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
    await relation(ctx, { ...args, character: "other", target: "mine" }),
    { ok: false, reason: "not_owned" },
  );
  assert.deepEqual(await relation(ctx, { ...args, target: "mine" }), {
    ok: false,
    reason: "no_character",
  });
  assert.deepEqual(await relation(ctx, { ...args, affinity: 101 }), {
    ok: false,
    reason: "invalid_input",
  });
  await assert.rejects(
    async () => await relation(ctx, { ...args, link: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.equal(table(`${P}relations`).size, 0);
  const created = (await relation(ctx, args)).document;
  assert.equal(created.data.owner, "m-1");
  assert.deepEqual(
    await relation(ctx, {
      ...args,
      id: created.id,
      revision: "old",
      memo: "changed",
    }),
    { ok: false, reason: "conflict" },
  );
  assert.equal(table(`${P}relations`).get(created.id).memo, "친구");
  assert.equal(
    (
      await relation(ctx, {
        ...args,
        id: created.id,
        revision: "r1",
        memo: "새 관계",
      })
    ).ok,
    true,
  );
  ctx.member.id = "m-2";
  assert.deepEqual(await removeRelation(ctx, { id: created.id }), {
    ok: false,
    reason: "not_owned",
  });
  ctx.member.id = "m-1";
  assert.equal((await removeRelation(ctx, { id: created.id })).ok, true);
  assert.equal(table(`${P}relations`).size, 0);
  // A member-written decorative owner field must not override actual authorship.
  const get = ctx.get;
  ctx.get = (name, id) => {
    const row = get(name, id);
    return name === `${P}characters` && id === "mine"
      ? { ...row, createdBy: "m-2" }
      : row;
  };
  assert.deepEqual(await relation(ctx, args), {
    ok: false,
    reason: "not_owned",
  });
});

test("wardrobe protects characters, rejects unsafe addresses and keeps the active outfit", async () => {
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
    await assert.rejects(
      async () =>
        await outfit(ctx, { character: "mine", name: "외출복", image }),
      /HTTPS/,
    );
  assert.equal(table(`${P}wardrobe`).size, 0);
  const clothing = (
    await outfit(ctx, {
      character: "mine",
      name: "외출복",
      image: "https://media.naru.pub/outfit.png",
    })
  ).document;
  assert.deepEqual(
    await wear(ctx, { character: "other", outfit: clothing.id }),
    {
      ok: false,
      reason: "not_owned",
    },
  );
  assert.equal(
    (await wear(ctx, { character: "mine", outfit: clothing.id })).ok,
    true,
  );
  assert.equal(table(`${P}characters`).get("mine").outfit, clothing.id);
  assert.deepEqual(await removeOutfit(ctx, { id: clothing.id }), {
    ok: false,
    reason: "outfit_in_use",
  });
  assert.equal((await wear(ctx, { character: "mine", outfit: null })).ok, true);
  assert.equal((await removeOutfit(ctx, { id: clothing.id })).ok, true);
  assert.equal((await mainCharacter(ctx, { character: "mine" })).ok, true);
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, "mine");
  assert.deepEqual(await mainCharacter(ctx, { character: "other" }), {
    ok: false,
    reason: "not_owned",
  });
});

test("catalog prices and balances cannot create money through invalid arithmetic", async () => {
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
    await assert.rejects(async () => await buy(ctx, { item: "bad" }), /Price/);
    assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
    assert.equal(table(`${P}inventory`).size, 0);
  }
  const { ctx, table } = fakeCtx();
  table(`${P}wallets`).set("m-1", { balance: Number.MAX_SAFE_INTEGER });
  await assert.rejects(async () => await daily(ctx), /Balance/);
  assert.equal(
    table(`${P}wallets`).get("m-1").balance,
    Number.MAX_SAFE_INTEGER,
  );
});

test("selling checks ownership and server price and cannot pay twice", async () => {
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
  assert.deepEqual(await sell(ctx, { inventory: "theirs", sellPrice: 10000 }), {
    ok: false,
    reason: "not_owned",
  });
  assert.equal(table(`${P}wallets`).size, 0);
  assert.deepEqual(await sell(ctx, { inventory: "mine", sellPrice: 10000 }), {
    ok: true,
    balance: 12,
    name: "씨앗",
  });
  assert.equal(table(`${P}inventory`).has("mine"), false);
  assert.deepEqual(await sell(ctx, { inventory: "mine" }), {
    ok: false,
    reason: "not_owned",
  });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 12);
});

test("gifts transfer one item only to an existing other member and retain provenance", async () => {
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
    assert.deepEqual(await gift(ctx, { inventory: "mine", recipient }), {
      ok: false,
      reason: "no_recipient",
    });
    assert.equal(table(`${P}inventory`).get("mine").owner, "m-1");
  }
  assert.equal(
    (await gift(ctx, { inventory: "mine", recipient: "m-2", memo: "선물" })).ok,
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
  assert.deepEqual(await gift(ctx, { inventory: "mine", recipient: "m-2" }), {
    ok: false,
    reason: "not_owned",
  });
  assert.deepEqual(await sell(ctx, { inventory: "mine" }), {
    ok: false,
    reason: "not_owned",
  });
});

test("crafting rejects duplicate, foreign, extra and insufficient materials before spending", async () => {
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
    assert.equal((await craft(ctx, { recipe: "recipe", materials })).ok, false);
    assert.equal(table(`${P}inventory`).size, 3);
    assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  }
  const result = await craft(ctx, {
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
    (await craft(ctx, { recipe: "recipe", materials: ["a", "b"] })).ok,
    false,
  );
  assert.equal(table(`${P}wallets`).get("m-1").balance, 80);
});

test("gacha follows every page and rejects corrupt weights rather than changing odds", async () => {
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
  assert.equal((await gacha(ctx)).owned.data.name, "다음 페이지");
  assert.deepEqual(calls, [null, "next"]);
  table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
  ctx.list = () => ({
    documents: [{ data: { item: "first", weight: Infinity } }],
    nextCursor: null,
  });
  await assert.rejects(async () => await gacha(ctx), /weights/);
  assert.equal(table(`${P}wallets`).get("m-1").balance, GACHA_COST);
});

test("buying checks the item, its stock and the balance before taking anything", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}items`).set("sword", { name: "검", price: 80, stock: 1 });
  table(`${P}items`).set("potion", { name: "물약", price: 10 });
  table(`${P}items`).set("secret", { name: "비밀", price: 1, hidden: true });
  assert.deepEqual(await buy(ctx, { item: "sword" }), {
    ok: false,
    reason: "not_enough",
  });
  assert.equal(table(`${P}wallets`).size, 0);
  await daily(ctx);
  const bought = await buy(ctx, { item: "sword" });
  assert.equal(bought.ok, true);
  assert.equal(bought.balance, DAILY_REWARD - 80);
  assert.deepEqual(bought.owned.data, {
    owner: "m-1",
    item: "sword",
    name: "검",
    from: "shop",
  });
  assert.equal(table(`${P}items`).get("sword").stock, 0);
  assert.deepEqual(await buy(ctx, { item: "sword" }), {
    ok: false,
    reason: "sold_out",
  });
  // No stock is no limit.
  assert.equal((await buy(ctx, { item: "potion" })).ok, true);
  assert.equal(table(`${P}items`).get("potion").stock, undefined);
  for (const item of ["secret", "missing", undefined, 7])
    assert.deepEqual(await buy(ctx, { item }), {
      ok: false,
      reason: "no_item",
    });
});

test("gacha picks by weight with the server's roll, and costs what it says", async () => {
  const prize = async (roll) => {
    const { ctx, table } = fakeCtx({ roll });
    table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
    table(`${P}items`).set("common", { name: "흔한 씨앗" });
    table(`${P}items`).set("rare", { name: "황금 아보카도" });
    table(`${P}gacha`).set("g1", { item: "common", weight: 9 });
    table(`${P}gacha`).set("g2", { item: "rare", weight: 1 });
    table(`${P}gacha`).set("g3", { item: "rare", weight: 0 });
    const result = await gacha(ctx);
    assert.equal(result.balance, 0);
    assert.equal(table(`${P}inventory`).size, 1);
    return result.owned.data.name;
  };
  assert.equal(await prize(0), "흔한 씨앗");
  assert.equal(await prize(0.89), "흔한 씨앗");
  assert.equal(await prize(0.9), "황금 아보카도");
  assert.equal(await prize(0.999), "황금 아보카도");
  const { ctx, table } = fakeCtx();
  assert.deepEqual(await gacha(ctx), { ok: false, reason: "not_enough" });
  table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
  assert.deepEqual(await gacha(ctx), { ok: false, reason: "empty" });
  // A table naming an item the shop does not have is the owner's mistake,
  // and fails the call, which Naru then rolls back.
  table(`${P}gacha`).set("g", { item: "gone", weight: 1 });
  await assert.rejects(async () => await gacha(ctx), /gone/);
});

test("quest reads enforce Korean start/end boundaries, categories and pagination", async () => {
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
    (await quests(ctx, { type: "daily" })).documents.map((row) => row.id),
    ["active"],
  );
  assert.deepEqual(
    (await quests(ctx, { type: "weekly" })).documents.map((row) => row.id),
    ["weekly"],
  );
  assert.equal((await quests(ctx, { type: "bad" })).reason, "invalid_input");
  for (let i = 0; i < 60; i++)
    table(`${P}quests`).set(`extra${i}`, { type: "weekly" });
  const page = await quests(ctx, { type: "weekly" });
  assert.equal(page.documents.length, 50);
  assert.equal(
    (await quests(ctx, { type: "weekly", after: page.nextCursor })).documents
      .length,
    11,
  );
});

test("content read levels and publication protect both metadata and selected bodies", async () => {
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
  assert.deepEqual((await contentPages(ctx)).documents, [
    { id: "guide", data: { name: "Guide" } },
  ]);
  assert.equal((await contentPage(ctx, { id: "guide" })).page.body, "Desktop");
  assert.equal(
    (await contentPage(ctx, { id: "guide", mobile: true })).page.body,
    "Mobile",
  );
  assert.equal(
    (await contentPage(ctx, { id: "restricted" })).reason,
    "document_not_found",
  );
  assert.equal(
    (await contentPage(ctx, { id: "draft" })).reason,
    "document_not_found",
  );
  table(`${P}members`).set("m-1", { level: 5 });
  assert.equal(
    (await contentPage(ctx, { id: "restricted" })).page.body,
    "Private",
  );
});

test("new posts are broadcast by board and ID only when a base member could list and read them", async () => {
  const { ctx, table, sent } = fakeCtx();
  table(`${P}boards`).set("staff", {
    name: "Staff",
    kind: "text",
    enabled: true,
    listLevel: 5,
    readLevel: 5,
    writeLevel: 2,
    commentLevel: 2,
    secret: "optional",
    categories: [],
  });
  table(`${P}boards`).set("free", {
    name: "Free",
    kind: "text",
    enabled: true,
    secret: "optional",
    categories: [],
  });
  const add = async (data) =>
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "add",
        data: { text: "hello", ...data },
      })
    ).document;
  const post = await add({ board: "free" });
  assert.deepEqual(sent, [
    { topic: `${P}logs`, data: { board: "free", id: post.id } },
  ]);
  await add({ board: "free", secret: true });
  await add({ board: "staff" });
  await communityData(ctx, {
    collection: `${P}logs`,
    operation: "set",
    id: post.id,
    data: { ...post.data, text: "edited" },
  });
  assert.equal(sent.length, 1);
});

test("the gate takes where predicates only for collections it returns whole, never reaching deleted rows", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("mine", { owner: "m-1", name: "Mine" });
  table(`${P}characters`).set("theirs", { owner: "m-2", name: "Theirs" });
  table(`${P}characters`).set("gone", {
    owner: "m-1",
    name: "Gone",
    deleted: true,
  });
  const list = (collection, where) =>
    communityData(ctx, {
      collection: `${P}${collection}`,
      operation: "list",
      options: { where },
    });
  assert.deepEqual(
    (await list("characters", { eq: ["owner", "m-1"] })).documents.map(
      (row) => row.id,
    ),
    ["mine"],
  );
  // Logs are redacted for locked secrets, so a predicate could probe bodies.
  assert.equal(
    (await list("logs", { eq: ["text", "guess"] })).reason,
    "invalid_input",
  );
  assert.equal(
    (await list("inventory", { eq: ["item", "x"] })).reason,
    "invalid_input",
  );
});

test("the board rule shares the gate's helpers: levels, moderators, secrets and comment parents", async () => {
  const { ctx, table } = fakeCtx();
  const log = {
    id: "log",
    createdBy: "m-1",
    data: {
      owner: "m-1",
      board: "default",
      secret: true,
      title: "Secret",
      category: "",
      text: "body",
      image: "https://example.com/a.png",
    },
  };
  table(`${P}boards`).set("default", { listLevel: 3, readLevel: 2 });
  const list = { collection: `${P}logs`, operation: "list" };
  assert.equal(
    await scope(ctx, { ...list, filter: { board: "default" } }),
    false,
  );
  ctx.member = null;
  assert.equal(await scope(ctx, { ...list, filter: {} }), false);
  assert.equal(
    await canWrite(ctx, { collection: `${P}logs`, before: null, after: log }),
    false,
  );
  ctx.member = { id: "m-1" };
  table(`${P}boards`).set("default", { listLevel: 2, readLevel: 2 });
  assert.deepEqual(
    await scope(ctx, { ...list, filter: { board: "default" } }),
    {
      all: [
        { eq: ["board", "default"] },
        { ne: ["deleted", true] },
        {
          any: [
            { ne: ["secret", true] },
            { eq: ["owner", "m-1"] },
            { eq: [{ metadata: "createdBy" }, "m-1"] },
          ],
        },
      ],
    },
  );
  table(`${P}boards`).set("default", {
    writeLevel: 2,
    secret: "required",
    kind: "image",
  });
  const write = (before, after, operation = "update") =>
    canWrite(ctx, { collection: `${P}logs`, before, after, operation });
  assert.equal(await write(null, log, "create"), true);
  assert.equal(
    await write(log, { ...log, data: { ...log.data, owner: "other" } }),
    false,
  );
  assert.equal(
    await write(log, { ...log, data: { ...log.data, board: "other" } }),
    false,
  );
  assert.equal(
    await write(log, { ...log, data: { ...log.data, secret: false } }),
    false,
  );
  assert.equal(await write(log, null, "delete"), false);
  assert.equal(await write({ ...log, createdBy: "other" }, log), false);
  const other = {
    ...log,
    createdBy: "other",
    data: { ...log.data, owner: "other" },
  };
  table(`${P}members`).set("m-1", { role: "moderator", level: 10 });
  assert.equal(await write(other, other), true);
  table(`${P}members`).delete("m-1");
  // Comments need a readable parent, the board's comment level and a fixed link.
  table(`${P}logs`).set("log", { ...log.data, owner: "other" });
  const comments = {
    collection: `${P}comments`,
    operation: "list",
    filter: { logId: "log" },
  };
  assert.equal(await scope(ctx, comments), false);
  table(`${P}logs`).set("log", log.data);
  assert.deepEqual(await scope(ctx, comments), { eq: ["logId", "log"] });
  const comment = {
    id: "comment",
    createdBy: "m-1",
    data: { owner: "m-1", logId: "log", text: "hi", dice: false },
  };
  const commentWrite = (after) =>
    canWrite(ctx, {
      collection: `${P}comments`,
      operation: "create",
      before: null,
      after,
    });
  table(`${P}boards`).set("default", { readLevel: 2, commentLevel: 3 });
  assert.equal(await commentWrite(comment), false);
  table(`${P}boards`).set("default", { readLevel: 2, commentLevel: 2 });
  assert.equal(await commentWrite(comment), true);
  assert.equal(
    await canWrite(ctx, {
      collection: `${P}comments`,
      operation: "update",
      before: comment,
      after: { ...comment, data: { ...comment.data, logId: "elsewhere" } },
    }),
    false,
  );
});

/* ------------------------------------------------------- roleplay core --- */

const gate = (ctx, collection, operation, rest = {}) =>
  communityData(ctx, { collection: `${P}${collection}`, operation, ...rest });
const reasonOf = async (promise) => {
  try {
    const result = await promise;
    return result.ok ? "ok" : result.reason;
  } catch (error) {
    return error.details?.reason ?? error.message;
  }
};
/** Two members with profiles, one character each, the first with title and outfit. */
function roleplayWorld(options) {
  const world = fakeCtx(options);
  const { table } = world;
  table(`${P}profiles`).set("m-1", { owner: "m-1", nick: "아보" });
  table(`${P}profiles`).set("m-2", { owner: "m-2", nick: "카도" });
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    name: "Hero",
    image: "https://example.com/hero.png",
    outfit: "coat",
  });
  table(`${P}characters`).set("rival", { owner: "m-2", name: "Rival" });
  table(`${P}characters`).set("gone", {
    owner: "m-1",
    name: "Gone",
    deleted: true,
  });
  table(`${P}wardrobe`).set("coat", {
    owner: "m-1",
    character: "hero",
    image: "https://example.com/coat.png",
  });
  table(`${P}titles`).set("brave", {
    name: "Brave",
    image: "https://example.com/brave.png",
  });
  table(`${P}character_state`).set("hero", {
    owner: "m-1",
    character: "hero",
    points: 0,
    exp: 0,
    stats: {},
    titles: ["brave"],
    activeTitle: "brave",
    approved: true,
  });
  table(`${P}logs`).set("thread", {
    owner: "m-2",
    board: "default",
    title: "",
    category: "",
    secret: false,
    image: "https://example.com/log.png",
    text: "Scene",
  });
  return world;
}

test("logs and comments speak as the member's own live character, fixed at posting", async () => {
  const { ctx } = roleplayWorld();
  const log = (
    await gate(ctx, "logs", "add", {
      data: {
        image: "https://example.com/a.png",
        text: "As Hero",
        character: "hero",
      },
    })
  ).document;
  assert.deepEqual(log.data.speaker, {
    character: "hero",
    name: "Hero",
    type: "main",
    title: "Brave",
    titleImage: "https://example.com/brave.png",
    portrait: "https://example.com/coat.png",
  });
  for (const character of ["rival", "gone", "missing", 7])
    assert.equal(
      await reasonOf(
        gate(ctx, "comments", "add", {
          data: { logId: "thread", text: "hi", character },
        }),
      ),
      "not_owned",
    );
  const comment = (
    await gate(ctx, "comments", "add", {
      data: { logId: "thread", text: "hi", character: "hero" },
    })
  ).document;
  assert.equal(comment.data.speaker.name, "Hero");
  // An edit cannot swap the speaker or forge one.
  const edited = (
    await gate(ctx, "comments", "set", {
      id: comment.id,
      data: {
        ...comment.data,
        text: "edited",
        character: "rival",
        speaker: { name: "Forged" },
      },
    })
  ).document;
  assert.equal(edited.data.speaker.name, "Hero");
  assert.equal(edited.data.character, "hero");
  // Without a character the post speaks as the nickname.
  const plain = (
    await gate(ctx, "comments", "add", { data: { logId: "thread", text: "x" } })
  ).document;
  assert.equal(plain.data.speaker, undefined);
});

test("dice are rolled by the server once and cannot be rerolled or forged by edits", async () => {
  const { ctx } = roleplayWorld({ roll: 0.99 });
  const comment = (
    await gate(ctx, "comments", "add", {
      data: { logId: "thread", text: "", dice: true, rolls: [1, 1] },
    })
  ).document;
  assert.deepEqual(comment.data.rolls, [6, 6]);
  ctx.random = () => 0;
  const edited = (
    await gate(ctx, "comments", "set", {
      id: comment.id,
      data: { ...comment.data, text: "now", dice: false, rolls: [1, 1] },
    })
  ).document;
  assert.deepEqual(edited.data.rolls, [6, 6]);
  assert.equal(edited.data.dice, true);
  const log = (
    await gate(ctx, "logs", "add", {
      data: { image: "https://example.com/a.png", text: "", dice: true },
    })
  ).document;
  assert.deepEqual(log.data.rolls, [1, 1]);
  ctx.random = () => 0.5;
  const kept = (
    await gate(ctx, "logs", "set", {
      id: log.id,
      data: { ...log.data, text: "t", dice: true, rolls: [6, 6] },
    })
  ).document;
  assert.deepEqual(kept.data.rolls, [1, 1]);
});

test("custom profile fields validate types and hide owner/admin values from other members", async () => {
  const { ctx, table } = roleplayWorld();
  const define = (code, data) =>
    table(`${P}character_fields`).set(code, { label: code, ...data });
  define("age", { type: "text", order: 1, required: true });
  define("gender", { type: "select", options: ["F", "M"], order: 2 });
  define("secret", { type: "textarea", visibility: "owner", order: 3 });
  define("memo", { type: "text", visibility: "admin", order: 4 });
  define("theme", { type: "url", order: 5 });
  const add = (data) =>
    gate(ctx, "characters", "add", { data: { name: "New", ...data } });
  for (const fields of [
    { gender: "X" },
    { memo: "self-approved" },
    { unknown: "x" },
    { theme: "javascript:alert(1)" },
    { age: "1\n2" },
    { age: 3 },
    [],
  ])
    assert.equal(await reasonOf(add({ fields })), "invalid_field");
  assert.equal(
    await reasonOf(add({ fields: { secret: "가".repeat(2001) } })),
    "invalid_field",
  );
  assert.equal(
    await reasonOf(add({ state: "submitted", fields: { gender: "F" } })),
    "missing_fields",
  );
  assert.equal(await reasonOf(add({ state: "approved" })), "invalid_input");
  assert.equal(await reasonOf(add({ type: "npc" })), "invalid_input");
  const created = (
    await add({
      type: "sub",
      state: "submitted",
      fields: { age: " 17 ", gender: "F", secret: "hidden past" },
    })
  ).document;
  assert.deepEqual(created.data.fields, {
    age: "17",
    gender: "F",
    secret: "hidden past",
  });
  assert.equal(created.data.state, "submitted");
  assert.equal(created.data.type, "sub");
  // The site owner keeps an admin-only memo the member never sees or erases.
  table(`${P}characters`).set(created.id, {
    ...table(`${P}characters`).get(created.id),
    fields: { ...created.data.fields, memo: "check age" },
  });
  const own = (await gate(ctx, "characters", "get", { id: created.id }))
    .document;
  assert.deepEqual(Object.keys(own.data.fields), ["age", "gender", "secret"]);
  await gate(ctx, "characters", "set", {
    id: created.id,
    data: { ...own.data, fields: { gender: "M" } },
  });
  assert.deepEqual(table(`${P}characters`).get(created.id).fields, {
    age: "17",
    gender: "M",
    secret: "hidden past",
    memo: "check age",
  });
  ctx.member = { id: "m-2" };
  const other = (await gate(ctx, "characters", "get", { id: created.id }))
    .document;
  assert.deepEqual(other.data.fields, { age: "17", gender: "M" });
  // Lists carry no custom values at all; field definitions hide admin-only ones.
  const listed = (await gate(ctx, "characters", "list")).documents;
  assert.ok(listed.every((row) => row.data.fields === undefined));
  assert.deepEqual(
    (await gate(ctx, "character_fields", "list")).documents.map(
      (row) => row.id,
    ),
    ["age", "gender", "secret", "theme"],
  );
  assert.equal(
    (await gate(ctx, "character_fields", "get", { id: "memo" })).reason,
    "access_denied",
  );
});

test("the owner's review moves editing → submitted → approved with the official record", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}character_fields`).set("memo", {
    label: "Memo",
    type: "text",
    visibility: "admin",
  });
  const created = (
    await gate(ctx, "characters", "add", {
      data: { name: "Applicant", state: "submitted" },
    })
  ).document;
  assert.equal(
    await reasonOf(
      reviewCharacter(ctx, { character: created.id, state: "approved" }),
    ),
    "Only the site owner reviews.",
  );
  const owner = { ...ctx, member: null, owner: true };
  assert.equal(
    (
      await reviewCharacter(owner, {
        character: created.id,
        state: "approved",
        type: "npc",
        fields: { memo: "ok" },
      })
    ).document.data.state,
    "approved",
  );
  assert.equal(table(`${P}character_state`).get(created.id).approved, true);
  assert.equal(table(`${P}character_state`).get(created.id).owner, "m-1");
  assert.equal(
    (
      await reviewCharacter(owner, {
        character: created.id,
        fields: { age: "1" },
      })
    ).reason,
    "invalid_input",
  );
  // The member's later edit cannot leave approval or the NPC type.
  const own = (await gate(ctx, "characters", "get", { id: created.id }))
    .document;
  const saved = (
    await gate(ctx, "characters", "set", {
      id: created.id,
      data: { ...own.data, state: "editing", type: "main" },
    })
  ).document;
  assert.equal(saved.data.state, "approved");
  assert.equal(saved.data.type, "npc");
  assert.equal(table(`${P}characters`).get(created.id).fields.memo, "ok");
  await reviewCharacter(owner, { character: created.id, state: "editing" });
  assert.equal(table(`${P}character_state`).get(created.id).approved, false);
  // A character saved before states existed counts as approved if official.
  table(`${P}characters`).set("legacy", { owner: "m-1", name: "Legacy" });
  table(`${P}character_state`).set("legacy", {
    owner: "m-1",
    approved: true,
    points: 0,
    exp: 0,
    stats: {},
  });
  assert.equal(
    (
      await gate(ctx, "characters", "set", {
        id: "legacy",
        data: { name: "Legacy" },
      })
    ).document.data.state,
    "approved",
  );
  // The public applicant list is a where on state.
  assert.deepEqual(
    (
      await gate(ctx, "characters", "list", {
        options: { where: { in: ["state", ["editing", "submitted"]] } },
      })
    ).documents.map((row) => row.id),
    [created.id],
  );
});

test("exploration is limited per character per Korean day and drops configured items", async () => {
  const { ctx, table } = roleplayWorld({ roll: 0.1 });
  const explore = (data = {}) =>
    gate(ctx, "comments", "add", {
      data: {
        logId: "thread",
        text: "",
        character: "hero",
        action: "explore",
        ...data,
      },
    });
  assert.equal(await reasonOf(explore()), "explore_closed");
  table(`${P}settings`).set("community", { exploreLimit: 2 });
  table(`${P}items`).set("herb", {
    name: "Herb",
    image: "https://example.com/herb.png",
  });
  table(`${P}explore`).set("found", { item: "herb", weight: 1 });
  table(`${P}explore`).set("miss", { item: null, weight: 3 });
  assert.equal(
    await reasonOf(explore({ character: undefined })),
    "no_character",
  );
  const first = (await explore()).document;
  assert.deepEqual(first.data.actions, [
    {
      type: "explore",
      item: "herb",
      name: "Herb",
      image: "https://example.com/herb.png",
      remaining: 1,
    },
  ]);
  const drops = [...table(`${P}inventory`).values()];
  assert.deepEqual(
    drops.map((row) => [row.item, row.character, row.from]),
    [["herb", "hero", "explore"]],
  );
  ctx.random = () => 0.9;
  assert.equal((await explore()).document.data.actions[0].item, null);
  assert.equal(await reasonOf(explore()), "explore_limit");
  // 2030-01-01 15:00 UTC is midnight in Korea: a new day, counted on request.
  ctx.now = Date.parse("2030-01-01T15:00:00Z");
  assert.equal((await explore()).document.data.actions[0].remaining, 1);
  assert.deepEqual(table(`${P}character_state`).get("hero").explore, {
    day: "2030-01-02",
    count: 1,
  });
  table(`${P}character_state`).set("hero", {
    ...table(`${P}character_state`).get("hero"),
    approved: false,
  });
  assert.equal(await reasonOf(explore()), "not_approved");
  // Actions belong to boards that allow them.
  table(`${P}boards`).set("default", { name: "Plain", secret: "optional" });
  assert.equal(await reasonOf(explore()), "access_denied");
});

test("items used in a post are consumed, logged and checked against the speaker", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}items`).set("letter", { name: "Letter", description: "A note" });
  table(`${P}items`).set("box", { name: "Box", effect: { type: "draw" } });
  table(`${P}items`).set("prize", { name: "Prize" });
  table(`${P}items`).set("ticket", {
    name: "Ticket",
    effect: { type: "create" },
  });
  table(`${P}gacha`).set("in-box", { source: "box", item: "prize", weight: 1 });
  const own = (id, item, extra = {}) =>
    table(`${P}inventory`).set(id, {
      owner: "m-1",
      item,
      name: item,
      ...extra,
    });
  own("i-letter", "letter");
  own("i-box", "box", { character: "hero" });
  own("i-ticket", "ticket");
  table(`${P}inventory`).set("i-theirs", { owner: "m-2", item: "letter" });
  const use = (item, character = "hero") =>
    gate(ctx, "comments", "add", {
      data: { logId: "thread", text: "uses", item, character },
    });
  assert.equal(await reasonOf(use("i-theirs")), "not_owned");
  assert.equal(await reasonOf(use("i-ticket")), "not_usable_here");
  assert.equal(await reasonOf(use("i-box", null)), "wrong_character");
  const letter = (await use("i-letter")).document;
  assert.deepEqual(letter.data.actions, [
    {
      type: "use",
      item: "letter",
      name: "letter",
      image: null,
      effect: null,
      description: "A note",
    },
  ]);
  assert.equal(table(`${P}inventory`).has("i-letter"), false);
  const box = (await use("i-box")).document;
  assert.deepEqual(box.data.actions[0].prize, { item: "prize", name: "Prize" });
  assert.equal(
    [...table(`${P}inventory`).values()].some(
      (row) => row.item === "prize" && row.character === "hero",
    ),
    true,
  );
  assert.equal(table(`${P}inventory`).has("i-ticket"), true);
});

test("[[nick]] calls and comment notices reach members who can read the post", async () => {
  const { ctx, table, sent } = roleplayWorld();
  table(`${P}profiles`).set("m-3", { owner: "m-3", nick: "세번째" });
  const comment = (
    await gate(ctx, "comments", "add", {
      data: {
        logId: "thread",
        text: "[[세번째]] [[없는사람]] [[아보]] 안녕",
        character: "hero",
      },
    })
  ).document;
  assert.equal(comment.data.text, "[[세번째]] [[???]] [[아보]] 안녕");
  assert.deepEqual(
    sent.filter((row) => row.member),
    [
      { member: "m-3", data: { calls: true } },
      { member: "m-2", data: { calls: true } },
    ],
  );
  const rows = [...table(`${P}calls`).values()];
  assert.deepEqual(
    rows.map((row) => [row.to, row.kind, row.speaker, row.logId]),
    [
      ["m-3", "call", "Hero", "thread"],
      ["m-2", "comment", "Hero", "thread"],
    ],
  );
  assert.equal(rows[0].preview, "세번째 ??? 아보 안녕");
  // Editing calls only the newly named members.
  sent.length = 0;
  await gate(ctx, "comments", "set", {
    id: comment.id,
    data: { ...comment.data, text: `${comment.data.text} [[카도]]` },
  });
  assert.deepEqual(
    sent.map((row) => row.member),
    ["m-2"],
  );
  // A secret post calls nobody who cannot read it, and authors may opt out.
  sent.length = 0;
  table(`${P}logs`).set("hidden", {
    owner: "m-1",
    board: "default",
    secret: true,
    text: "",
    image: "https://example.com/x.png",
  });
  await gate(ctx, "comments", "add", {
    data: { logId: "hidden", text: "[[카도]]" },
  });
  table(`${P}profiles`).set("m-2", {
    ...table(`${P}profiles`).get("m-2"),
    commentAlerts: false,
  });
  await gate(ctx, "comments", "add", { data: { logId: "thread", text: "hi" } });
  assert.deepEqual(sent, []);
  // A log body may call too.
  await gate(ctx, "logs", "add", {
    data: { image: "https://example.com/a.png", text: "[[카도]] 보세요" },
  });
  assert.deepEqual(
    sent.filter((row) => row.member),
    [{ member: "m-2", data: { calls: true } }],
  );
});

test("call history shows readable posts newest first and is cleared once seen", async () => {
  const { ctx, table, sent } = roleplayWorld();
  ctx.member = { id: "m-2" };
  await gate(ctx, "comments", "add", {
    data: { logId: "thread", text: "[[아보]] 여기요" },
  });
  table(`${P}logs`).set("later-secret", {
    owner: "m-2",
    board: "default",
    secret: false,
    text: "x",
    image: "https://example.com/x.png",
  });
  await gate(ctx, "comments", "add", {
    data: { logId: "later-secret", text: "[[아보]]" },
  });
  table(`${P}logs`).set("later-secret", {
    ...table(`${P}logs`).get("later-secret"),
    secret: true,
  });
  ctx.member = { id: "m-1" };
  assert.equal((await messageStatus(ctx)).calls, true);
  const history = await callHistory(ctx, {});
  assert.equal(history.unread, true);
  assert.deepEqual(
    history.documents.map((row) => [
      row.data.logId,
      row.data.nick,
      row.data.unread,
    ]),
    [["thread", "카도", true]],
  );
  assert.equal((await callHistory(ctx, { size: 50 })).reason, "invalid_input");
  sent.length = 0;
  ctx.now += 1000;
  assert.equal((await seeCalls(ctx)).ok, true);
  assert.deepEqual(sent, [{ member: "m-1", data: { calls: false } }]);
  assert.equal((await messageStatus(ctx)).calls, false);
  assert.equal((await callHistory(ctx, {})).documents[0].data.unread, false);
});
