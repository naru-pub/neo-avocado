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
  site,
  commentCounts,
  moderatePost,
} from "../_naru/modules/index.js";
import { scope, canWrite } from "../_naru/rules/community-board.js";
import * as characterRule from "../_naru/rules/characters.js";
import { matches } from "./where.mjs";
import { nativeRead } from "./native-read.mjs";

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
  const secrets = new Map();
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
    // Document secrets (SDK 1.1.0), kept beside the documents as Naru does.
    secretMatches: async (name, id, secret) =>
      secrets.get(`${name}/${id}`) === secret,
    // Stands in for PBKDF2: what matters here is that only a hash is stored.
    password: {
      hash: (text) => `hash:${[...text].reverse().join("")}`,
      verify: (text, hash) => hash === `hash:${[...text].reverse().join("")}`,
    },
    get: async (name, id) => {
      const data = table(name).get(id);
      return data === undefined
        ? null
        : { id, data: structuredClone(data), createdBy: null, revision: "r1" };
    },
    count: async (name, options = {}) =>
      (await ctx.list(name, { ...options, size: 1e9 })).documents.length,
    getMany: async (name, ids) =>
      Promise.all(ids.map((id) => ctx.get(name, id))),
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
    add: async (name, data, options = {}) => {
      const id = `added-${added++}`;
      if (options.secret !== undefined)
        secrets.set(`${name}/${id}`, options.secret);
      return await ctx.set(name, id, data);
    },
    delete: async (name, id) => table(name).delete(id),
  };
  return { ctx, table, sent, released };
}

/**
 * The reason a function refused with (its ctx.fail details), the code Naru
 * refused a native read with (NOT_FOUND for a document a rule hides), or null.
 */
const refusal = (call) =>
  call.then(
    () => null,
    (error) => {
      if (error.details) return error.details.reason;
      if (error.code) return error.code;
      throw error;
    },
  );

test("the daily reward is once per day in Korea", async () => {
  const { ctx, table } = fakeCtx();
  assert.deepEqual(await daily(ctx), { balance: DAILY_REWARD });
  assert.equal(await refusal(daily(ctx)), "already");
  // 2030-01-01 15:00 UTC is already 2 January in Korea.
  ctx.now = Date.parse("2030-01-01T15:00:00Z");
  assert.deepEqual(await daily(ctx), { balance: 2 * DAILY_REWARD });
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
    await refusal(
      nativeRead(ctx, {
        collection: `${P}logs`,
        operation: "get",
        id: record.id,
      }),
    ),
    "NOT_FOUND",
  );
  const list = await nativeRead(ctx, {
    collection: `${P}logs`,
    operation: "list",
    options: { filter: { board: "notes" } },
  });
  // A post the reader may not read is left out of the list.
  assert.equal(list.documents.length, 0);
  assert.equal(
    await refusal(
      communityData(ctx, {
        collection: `${P}comments`,
        operation: "add",
        data: { logId: record.id, text: "no" },
      }),
    ),
    "document_not_found",
  );
  table(`${P}members`).set("m-1", {
    status: "approved",
    role: "member",
    level: 5,
  });
  assert.equal(
    (
      await nativeRead(ctx, {
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
    await refusal(
      nativeRead(ctx, {
        collection: `${P}logs`,
        operation: "get",
        id: secret.id,
      }),
    ),
    "NOT_FOUND",
  );
  // Its comments are hidden with it: the list comes back empty.
  assert.deepEqual(
    (
      await nativeRead(ctx, {
        collection: `${P}comments`,
        operation: "list",
        options: { filter: { logId: secret.id } },
      })
    ).documents,
    [],
  );
  table(`${P}members`).get("m-2").role = "moderator";
  assert.equal(
    (
      await nativeRead(ctx, {
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
    await refusal(
      communityData(ctx, {
        collection: `${P}logs`,
        operation: "add",
        data: { board: "notes", text: "x", category: "Unknown" },
      }),
    ),
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
    await nativeRead(ctx, {
      collection: `${P}logs`,
      operation: "list",
      options: { filter: { board: "notes" } },
    })
  ).documents[0];
  // Lists carry the whole post; the page shows the start of it.
  assert.equal(preview.data.text.length, 2000);
  assert.equal(
    (
      await nativeRead(ctx, {
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
  await join(ctx, { nick: "New" });
  assert.equal(table(`${P}members`).get("m-1").role, "member");
  assert.equal(table(`${P}members`).get("m-1").status, undefined);
  await daily(ctx);
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
    await refusal(
      communityData(ctx, {
        collection: `${P}members`,
        operation: "set",
        id: "m-1",
        data: { role: "moderator" },
      }),
    ),
    "access_denied",
  );
  table(`${P}wallets`).set("m-2", { balance: 999 });
  assert.equal(
    await refusal(
      nativeRead(ctx, {
        collection: `${P}wallets`,
        operation: "get",
        id: "m-2",
      }),
    ),
    "NOT_FOUND",
  );
  table(`${P}members`).get("m-1").status = "banned";
  await messageStatus(ctx);
  await join(ctx, { nick: "Approved by platform" });
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
  assert.equal(await refusal(communityData(ctx, args)), "not_owned");
  table(`${P}members`).set("m-1", { status: "approved", role: "moderator" });
  assert.equal(
    await refusal(
      communityData(ctx, {
        ...args,
        options: { condition: { revision: "old" } },
      }),
    ),
    "conflict",
  );
  assert.equal((await communityData(ctx, args)).document.data.owner, "m-2");
  table(`${P}characters`).set("other", { owner: "m-2", name: "Other" });
  assert.equal(
    await refusal(
      communityData(ctx, {
        collection: `${P}characters`,
        operation: "delete",
        id: "other",
      }),
    ),
    "not_owned",
  );
  assert.equal(
    await refusal(
      communityData(ctx, {
        collection: `${P}comments`,
        operation: "add",
        data: { logId: "missing", text: "orphan" },
      }),
    ),
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
    await refusal(
      nativeRead(ctx, {
        collection: `${P}comments`,
        operation: "get",
        id: "comment-8",
      }),
    ),
    "NOT_FOUND",
  );
  // Ten comments a call: the second finishes it.
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
  assert.equal(await refusal(readMessage(ctx, { id })), "message_not_found");
  assert.equal(await refusal(removeMessage(ctx, { id })), "message_not_found");
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
  await removeMessage(ctx, { id });
  ctx.member.id = "m-1";
  assert.equal(await refusal(readMessage(ctx, { id })), "message_not_found");
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
    assert.notEqual(
      await refusal(sendMessage(ctx, { recipients, body: "hello" })),
      null,
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
  assert.equal(await refusal(useItem(ctx, args)), "not_enough_exp");
  assert.equal(table(`${P}inventory`).has("ticket-a"), true);
  table(`${P}character_state`).get("hero").exp = 10;
  await useItem(ctx, args);
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
  assert.equal(await refusal(buy(ctx, args)), "not_approved");
  const state = table(`${P}character_state`).get("hero");
  state.approved = true;
  state.side = "city";
  state.class = "elf";
  assert.equal(await refusal(buy(ctx, args)), "restricted_character");
  state.side = "forest";
  assert.equal(
    await refusal(buy(ctx, { ...args, materials: ["seed", "seed"] })),
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
    await refusal(buy(ctx, { item: "sword", character: "hero" })),
    "purchase_limit",
  );
  assert.equal(
    await refusal(
      gift(ctx, {
        inventory: result.owned.id,
        recipient: "m-2",
        character: "hero",
      }),
    ),
    "no_character",
  );
  await gift(ctx, {
    inventory: result.owned.id,
    recipient: "m-2",
    character: "other",
  });
  assert.equal(table(`${P}inventory`).get(result.owned.id).character, "other");
  assert.equal(
    await refusal(
      assignInventory(ctx, {
        inventory: result.owned.id,
        character: "hero",
      }),
    ),
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
    await refusal(equipTitle(ctx, { character: "hero", title: "unearned" })),
    "missing_title",
  );
  await equipTitle(ctx, { character: "hero", title: "winner" });
  assert.equal(table(`${P}character_state`).get("hero").activeTitle, "winner");
  table(`${P}titles`).get("winner").deleted = true;
  assert.equal(
    await refusal(equipTitle(ctx, { character: "hero", title: "winner" })),
    "missing_title",
  );
  await equipTitle(ctx, { character: "hero", title: null });
  table(`${P}history`).set("a", { owner: "m-1", kind: "daily" });
  table(`${P}history`).set("b", { owner: "m-2", memo: "private" });
  table(`${P}history`).set("c", { owner: "m-1", kind: "buy" });
  const first = await history(ctx, { owner: "m-2", size: 1 });
  assert.equal(first.documents[0].id, "a");
  assert.equal(
    (await history(ctx, { after: first.nextCursor, size: 1 })).documents[0].id,
    "c",
  );
  assert.equal(await refusal(history(ctx, { size: 21 })), "invalid_input");
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
    await refusal(
      allocateStats(ctx, { character: "hero", allocation: { hp: 11 } }),
    ),
    "not_enough_points",
  );
  assert.equal(table(`${P}character_state`).size, 0);
  await allocateStats(ctx, { character: "hero", allocation: { hp: 10 } });
  const saved = table(`${P}character_state`).get("hero");
  saved.stats.hp.damage = 7;
  saved.stats.hp.current = 3;
  await allocateStats(ctx, {
    character: "hero",
    allocation: { hp: 0 },
    revision: "r1",
  });
  await allocateStats(ctx, {
    character: "hero",
    allocation: { hp: 10 },
    revision: "r1",
  });
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 3);
  assert.equal(
    await refusal(
      allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 2 },
        revision: "old",
      }),
    ),
    "conflict",
  );
  assert.equal(
    await refusal(
      allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 2, invented: 0 },
        revision: "r1",
      }),
    ),
    "invalid_input",
  );
  ctx.member.id = "m-2";
  assert.equal(
    await refusal(
      allocateStats(ctx, {
        character: "hero",
        allocation: { hp: 2 },
        revision: "r1",
      }),
    ),
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
    await refusal(useItem(ctx, { inventory: "p1", character: "other" })),
    "not_owned",
  );
  assert.equal(table(`${P}inventory`).has("p1"), true);
  await useItem(ctx, {
    inventory: "p1",
    character: "hero",
    data: { amount: 99999 },
  });
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 7);
  assert.equal(
    await refusal(useItem(ctx, { inventory: "p1", character: "hero" })),
    "not_owned",
  );
  table(`${P}items`).get("potion").reusable = true;
  table(`${P}inventory`).set("p2", {
    owner: "m-1",
    item: "potion",
    name: "물약",
  });
  await useItem(ctx, { inventory: "p2", character: "hero" });
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 10);
  assert.equal(table(`${P}inventory`).has("p2"), true);
  assert.equal(
    await refusal(useItem(ctx, { inventory: "p2", character: "hero" })),
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
    await refusal(
      useItem(ctx, {
        inventory: "profile-ticket",
        character: "hero",
        data: { name: "New", revision: "old" },
      }),
    ),
    "conflict",
  );
  assert.equal(table(`${P}inventory`).has("profile-ticket"), true);
  await useItem(ctx, {
    inventory: "profile-ticket",
    character: "hero",
    data: { name: "New", revision: "r1", owner: "m-2", points: 99999 },
  });
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
  assert.equal(
    await refusal(
      relation(ctx, { ...args, character: "other", target: "mine" }),
    ),
    "not_owned",
  );
  assert.equal(
    await refusal(relation(ctx, { ...args, target: "mine" })),
    "no_character",
  );
  assert.equal(
    await refusal(relation(ctx, { ...args, affinity: 101 })),
    "invalid_input",
  );
  await assert.rejects(
    async () => await relation(ctx, { ...args, link: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.equal(table(`${P}relations`).size, 0);
  const created = (await relation(ctx, args)).document;
  assert.equal(created.data.owner, "m-1");
  assert.equal(
    await refusal(
      relation(ctx, {
        ...args,
        id: created.id,
        revision: "old",
        memo: "changed",
      }),
    ),
    "conflict",
  );
  assert.equal(table(`${P}relations`).get(created.id).memo, "친구");
  await relation(ctx, {
    ...args,
    id: created.id,
    revision: "r1",
    memo: "새 관계",
  });
  ctx.member.id = "m-2";
  assert.equal(
    await refusal(removeRelation(ctx, { id: created.id })),
    "not_owned",
  );
  ctx.member.id = "m-1";
  await removeRelation(ctx, { id: created.id });
  assert.equal(table(`${P}relations`).size, 0);
  // A member-written decorative owner field must not override actual authorship.
  const get = ctx.get;
  ctx.get = (name, id) => {
    const row = get(name, id);
    return name === `${P}characters` && id === "mine"
      ? { ...row, createdBy: "m-2" }
      : row;
  };
  assert.equal(await refusal(relation(ctx, args)), "not_owned");
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
  assert.equal(
    await refusal(wear(ctx, { character: "other", outfit: clothing.id })),
    "not_owned",
  );
  await wear(ctx, { character: "mine", outfit: clothing.id });
  assert.equal(table(`${P}characters`).get("mine").outfit, clothing.id);
  assert.equal(
    await refusal(removeOutfit(ctx, { id: clothing.id })),
    "outfit_in_use",
  );
  await wear(ctx, { character: "mine", outfit: null });
  await removeOutfit(ctx, { id: clothing.id });
  await mainCharacter(ctx, { character: "mine" });
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, "mine");
  assert.equal(
    await refusal(mainCharacter(ctx, { character: "other" })),
    "not_owned",
  );
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
  assert.equal(
    await refusal(sell(ctx, { inventory: "theirs", sellPrice: 10000 })),
    "not_owned",
  );
  assert.equal(table(`${P}wallets`).size, 0);
  assert.deepEqual(await sell(ctx, { inventory: "mine", sellPrice: 10000 }), {
    balance: 12,
    name: "씨앗",
  });
  assert.equal(table(`${P}inventory`).has("mine"), false);
  assert.equal(await refusal(sell(ctx, { inventory: "mine" })), "not_owned");
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
    assert.equal(
      await refusal(gift(ctx, { inventory: "mine", recipient })),
      "no_recipient",
    );
    assert.equal(table(`${P}inventory`).get("mine").owner, "m-1");
  }
  await gift(ctx, { inventory: "mine", recipient: "m-2", memo: "선물" });
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
  assert.equal(
    await refusal(gift(ctx, { inventory: "mine", recipient: "m-2" })),
    "not_owned",
  );
  assert.equal(await refusal(sell(ctx, { inventory: "mine" })), "not_owned");
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
    assert.notEqual(
      await refusal(craft(ctx, { recipe: "recipe", materials })),
      null,
    );
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
  assert.notEqual(
    await refusal(craft(ctx, { recipe: "recipe", materials: ["a", "b"] })),
    null,
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
  assert.equal(await refusal(buy(ctx, { item: "sword" })), "not_enough");
  assert.equal(table(`${P}wallets`).size, 0);
  await daily(ctx);
  const bought = await buy(ctx, { item: "sword" });
  assert.equal(bought.balance, DAILY_REWARD - 80);
  assert.deepEqual(bought.owned.data, {
    owner: "m-1",
    item: "sword",
    name: "검",
    from: "shop",
  });
  assert.equal(table(`${P}items`).get("sword").stock, 0);
  assert.equal(await refusal(buy(ctx, { item: "sword" })), "sold_out");
  // No stock is no limit.
  await buy(ctx, { item: "potion" });
  assert.equal(table(`${P}items`).get("potion").stock, undefined);
  for (const item of ["secret", "missing", undefined, 7])
    assert.equal(await refusal(buy(ctx, { item })), "no_item");
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
  assert.equal(await refusal(gacha(ctx)), "not_enough");
  table(`${P}wallets`).set("m-1", { balance: GACHA_COST });
  assert.equal(await refusal(gacha(ctx)), "empty");
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
  assert.equal(await refusal(quests(ctx, { type: "bad" })), "invalid_input");
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
    await refusal(contentPage(ctx, { id: "restricted" })),
    "document_not_found",
  );
  assert.equal(
    await refusal(contentPage(ctx, { id: "draft" })),
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

test("a where predicate only narrows what the rules show: never deleted rows or others' secrets", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("mine", { owner: "m-1", name: "Mine" });
  table(`${P}characters`).set("theirs", { owner: "m-2", name: "Theirs" });
  table(`${P}characters`).set("gone", {
    owner: "m-1",
    name: "Gone",
    deleted: true,
  });
  table(`${P}logs`).set("hidden", {
    board: "default",
    owner: "m-2",
    secret: true,
    text: "guess",
  });
  const list = async (collection, where) =>
    (
      await nativeRead(ctx, {
        collection: `${P}${collection}`,
        operation: "list",
        options: { where },
      })
    ).documents.map((row) => row.id);
  assert.deepEqual(await list("characters", { eq: ["owner", "m-1"] }), [
    "mine",
  ]);
  // Asking for another member's secret body finds nothing.
  assert.deepEqual(
    await list("logs", {
      all: [{ eq: ["board", "default"] }, { eq: ["text", "guess"] }],
    }),
    [],
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

// Writes go through the community/data function; reads are the SDK's own,
// through the collection rules (tests/native-read.mjs).
const gate = (ctx, collection, operation, rest = {}) =>
  (["get", "getMany", "list"].includes(operation) ? nativeRead : communityData)(
    ctx,
    { collection: `${P}${collection}`, operation, ...rest },
  );
const reasonOf = async (promise) => {
  try {
    await promise;
    return "ok";
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
  // Lists show the same fields as gets; field definitions hide admin-only ones.
  const listed = (await gate(ctx, "characters", "list")).documents;
  assert.deepEqual(listed.find((row) => row.id === created.id).data.fields, {
    age: "17",
    gender: "M",
  });
  assert.deepEqual(
    (await gate(ctx, "character_fields", "list")).documents.map(
      (row) => row.id,
    ),
    ["age", "gender", "secret", "theme"],
  );
  assert.equal(
    await refusal(gate(ctx, "character_fields", "get", { id: "memo" })),
    "NOT_FOUND",
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
    await refusal(
      reviewCharacter(owner, {
        character: created.id,
        fields: { age: "1" },
      }),
    ),
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
  assert.equal(await refusal(callHistory(ctx, { size: 50 })), "invalid_input");
  sent.length = 0;
  ctx.now += 1000;
  await seeCalls(ctx);
  assert.deepEqual(sent, [{ member: "m-1", data: { calls: false } }]);
  assert.equal((await messageStatus(ctx)).calls, false);
  assert.equal((await callHistory(ctx, {})).documents[0].data.unread, false);
});

const PUBLIC_BOARD = {
  name: "자유",
  kind: "text",
  enabled: true,
  listLevel: 1,
  readLevel: 1,
  writeLevel: 1,
  commentLevel: 1,
  secret: "optional",
  categories: [],
  actions: true,
};

test("visitors read and post only on level-1 boards, as named guests with a password", async () => {
  const { ctx, table, sent } = fakeCtx();
  table(`${P}boards`).set("free", PUBLIC_BOARD);
  table(`${P}boards`).set("members", { ...PUBLIC_BOARD, listLevel: 2 });
  table(`${P}profiles`).set("m-1", { nick: "회원", acceptMessages: true });
  table(`${P}wallets`).set("m-1", { balance: 10 });
  const member = await communityData(ctx, {
    collection: `${P}logs`,
    operation: "add",
    data: { board: "free", text: "회원 글", image: null },
  });
  ctx.member = null;
  ctx.visitor = true;
  const read = (args) => nativeRead(ctx, args);
  // Boards a guest may list; the members-only board and the default stay hidden.
  const boards = await read({
    collection: `${P}boards`,
    operation: "list",
  });
  assert.deepEqual(
    boards.documents.map((row) => row.id),
    ["free"],
  );
  // The members-only board lists nothing for them.
  assert.deepEqual(
    (
      await read({
        collection: `${P}logs`,
        operation: "list",
        options: { filter: { board: "members" } },
      })
    ).documents,
    [],
  );
  // Nicknames reach visitors; nothing else from a profile does.
  assert.deepEqual(
    (
      await read({
        collection: `${P}profiles`,
        operation: "getMany",
        options: { ids: ["m-1"] },
      })
    ).documents[0].data,
    { nick: "회원" },
  );
  for (const collection of ["wallets", "inventory", "characters", "messages"])
    assert.equal(
      await refusal(
        read({ collection: `${P}${collection}`, operation: "list" }),
      ),
      "ACCESS_DENIED",
    );
  // A guest must name themselves and give a password; no secrets or actions.
  const post = (data, guest) =>
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "add",
      data: { board: "free", image: null, ...data },
      options: guest ? { guest } : {},
    });
  assert.equal(await refusal(post({ text: "x" })), "guest_password");
  assert.equal(
    await refusal(post({ text: "x" }, { name: " ", password: "1234" })),
    "invalid_input",
  );
  assert.equal(
    await refusal(
      post({ text: "x", secret: true }, { name: "길손", password: "1234" }),
    ),
    "guest_secret",
  );
  const saved = (
    await post(
      { text: "[[회원]] 안녕", character: "c-1", dice: true },
      { name: "길손", password: "1234" },
    )
  ).document;
  assert.deepEqual(saved.data.guest, { name: "길손" });
  assert.equal(saved.data.owner, null);
  assert.equal(saved.data.character, undefined);
  assert.equal(saved.data.text, "[[회원]] 안녕"); // guests do not call members
  assert.equal(saved.data.rolls.length, 2);
  // The password is the post's write secret: Naru keeps it, not the data.
  assert.equal(JSON.stringify(saved.data).includes("1234"), false);
  assert.equal(await ctx.secretMatches(`${P}logs`, saved.id, "1234"), true);
  // Editing needs the password; a member's post can never be a guest's.
  const edit = (id, password, text = "고침") =>
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "set",
      id,
      data: { text, image: null },
      options: { guest: { password } },
    });
  assert.equal(await refusal(edit(saved.id, "0000")), "guest_password");
  assert.equal(
    await refusal(edit(member.document.id, "1234")),
    "guest_password",
  );
  assert.equal((await edit(saved.id, "1234")).document.data.text, "고침");
  assert.deepEqual(table(`${P}logs`).get(saved.id).guest, { name: "길손" });
  // A guest comment tells the member author, as a guest.
  sent.length = 0;
  const comment = await communityData(ctx, {
    collection: `${P}comments`,
    operation: "add",
    data: { logId: member.document.id, text: "좋아요", action: undefined },
    options: { guest: { name: "길손", password: "abcd" } },
  });
  assert.deepEqual(sent, [{ member: "m-1", data: { calls: true } }]);
  const call = [...table(`${P}calls`).values()].at(-1);
  assert.equal(call.from, null);
  assert.equal(call.nick, "길손 (손님)");
  assert.equal(
    await refusal(
      communityData(ctx, {
        collection: `${P}comments`,
        operation: "add",
        data: { logId: member.document.id, action: "explore" },
        options: { guest: { name: "길손", password: "abcd" } },
      }),
    ),
    "access_denied",
  );
  // Deleting the post removes its comments' and its own keys.
  table(`${P}comments`).set("guest-comment", {
    logId: saved.id,
    text: "댓글",
    owner: null,
    guest: { name: "길손" },
  });
  assert.equal(
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "delete",
        id: saved.id,
        options: { guest: { password: "1234" } },
      })
    ).done,
    true,
  );
  assert.equal(table(`${P}logs`).has(saved.id), false);
  assert.equal(table(`${P}comments`).has("guest-comment"), false);
});

test("the site frame shows only safe design values and menus/banners a reader may see", async () => {
  const { ctx, table } = fakeCtx({ now: Date.parse("2030-01-01T03:00:00Z") });
  table(`${P}design`).set("site", {
    title: "아보카도",
    logo: "javascript:alert(1)",
    background: "https://cdn.example/bg.png",
    font: "comic",
    colors: { accent: "#123456", ink: "red;}" },
  });
  table(`${P}menus`).set("a", { name: "공지", link: "board:notice", order: 2 });
  table(`${P}menus`).set("b", {
    name: "소개",
    link: "content:about",
    order: 1,
  });
  table(`${P}menus`).set("c", { name: "운영", link: "tab:shop", level: 2 });
  table(`${P}menus`).set("d", { name: "나쁜", link: "javascript:alert(1)" });
  table(`${P}menus`).set("e", {
    name: "꺼짐",
    link: "board:x",
    enabled: false,
  });
  table(`${P}banners`).set("now", {
    image: "https://cdn.example/1.png",
    startsAt: "2030-01-01T11:00",
    endsAt: "2030-01-01T13:00",
  });
  table(`${P}banners`).set("later", {
    image: "https://cdn.example/2.png",
    startsAt: "2030-01-01T13:00",
  });
  table(`${P}banners`).set("intro", {
    image: "https://cdn.example/3.png",
    place: "intro",
  });
  ctx.member = null;
  const frame = await site(ctx);
  assert.deepEqual(frame.design, {
    title: "아보카도",
    logo: null,
    background: "https://cdn.example/bg.png",
    headerBackground: null,
    font: "sans",
    colors: { accent: "#123456" },
  });
  assert.deepEqual(
    frame.menus.map((menu) => menu.id),
    ["b", "a"],
  );
  assert.deepEqual(
    frame.banners.map((banner) => [banner.id, banner.place]),
    [
      ["intro", "intro"],
      ["now", "main"],
    ],
  );
  ctx.member = { id: "m-1" };
  assert.deepEqual(
    (await site(ctx)).menus.map((menu) => menu.id),
    ["c", "b", "a"],
  );
});

test("logs are numbered per board, tagged for search, counted and moderated", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("free", PUBLIC_BOARD);
  const add = async (data) =>
    (
      await communityData(ctx, {
        collection: `${P}logs`,
        operation: "add",
        data: { board: "free", image: null, ...data },
      })
    ).document;
  const first = await add({ text: "#봄 #꽃 #봄 산책" });
  const second = await add({ text: "두 번째 @1", secret: true });
  const third = await add({ text: "다른 #꽃" });
  assert.deepEqual(
    [first, second, third].map((log) => log.data.number),
    [1, 2, 3],
  );
  assert.deepEqual(first.data.tags, ["봄", "꽃"]);
  assert.equal(first.data.tag1, undefined); // tags are searched with has
  // Editing rewrites tags but keeps the number; members cannot pin.
  const edited = await communityData(ctx, {
    collection: `${P}logs`,
    operation: "set",
    id: first.id,
    data: { text: "#여름", image: null, notice: true, number: 99 },
  });
  assert.deepEqual(edited.document.data.tags, ["여름"]);
  assert.equal(edited.document.data.number, 1);
  assert.equal(edited.document.data.notice, undefined);
  // The gate's tag search never matches a secret post.
  await add({ text: "#꽃 비밀", secret: true });
  ctx.member = { id: "m-2" };
  const tagged = await nativeRead(ctx, {
    collection: `${P}logs`,
    operation: "list",
    options: { filter: { board: "free" }, where: { has: ["tags", "꽃"] } },
  });
  assert.deepEqual(
    tagged.documents.map((row) => row.id),
    [third.id],
  );
  // Counts only for readable logs.
  for (const n of [1, 2])
    table(`${P}comments`).set(`c-${n}`, { logId: third.id, text: "c" });
  table(`${P}comments`).set("c-3", { logId: second.id, text: "c" });
  assert.deepEqual(
    (await commentCounts(ctx, { ids: [third.id, second.id, "missing"] }))
      .counts,
    { [third.id]: 2 },
  );
  // Only moderators (and the owner) pin and move, and a move renumbers.
  assert.equal(
    await refusal(moderatePost(ctx, { id: third.id, notice: true })),
    "access_denied",
  );
  table(`${P}members`).set("m-2", { role: "moderator" });
  table(`${P}boards`).set("other", { ...PUBLIC_BOARD, name: "다른" });
  assert.equal(
    (await moderatePost(ctx, { id: third.id, notice: true })).document.data
      .notice,
    true,
  );
  const moved = await moderatePost(ctx, { id: third.id, board: "other" });
  assert.equal(moved.document.data.board, "other");
  assert.equal(moved.document.data.number, 1);
  ctx.member = null;
  ctx.owner = true;
  assert.equal(
    (await moderatePost(ctx, { id: third.id, notice: false })).document.data
      .notice,
    false,
  );
});

test("HTML boards store longer rich bodies, tag their text and preview it plainly", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("rich", { ...PUBLIC_BOARD, html: true });
  const body = `<p style="color:#fff">#소식 ${"가".repeat(3000)}</p>`;
  const saved = (
    await communityData(ctx, {
      collection: `${P}logs`,
      operation: "add",
      data: { board: "rich", text: body, image: null },
    })
  ).document;
  assert.equal(saved.data.format, "html");
  assert.deepEqual(saved.data.tags, ["소식"]);
  ctx.member = { id: "m-2" };
  const [row] = (
    await nativeRead(ctx, {
      collection: `${P}logs`,
      operation: "list",
      options: { filter: { board: "rich" } },
    })
  ).documents;
  // The whole body is read; the page previews its text.
  assert.equal(row.data.format, "html");
  assert.equal(row.data.text, saved.data.text);
  // Plain boards keep their 2,000-character limit.
  await assert.rejects(
    communityData(ctx, {
      collection: `${P}logs`,
      operation: "add",
      data: {
        board: "default",
        text: "x".repeat(2001),
        image: "https://a.b/c.png",
      },
    }),
  );
});

test("in-post combination matches recipes by item, charges cost and consumes even on a miss", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}items`).set("herb", { name: "Herb" });
  table(`${P}items`).set("water", { name: "Water" });
  table(`${P}items`).set("pot", { name: "Pot", reusable: true });
  table(`${P}items`).set("potion", { name: "Potion" });
  table(`${P}recipes`).set("brew", {
    name: "Brew",
    item: "potion",
    cost: 5,
    ingredients: [
      { item: "water", count: 1 },
      { item: "herb", count: 1 },
      { item: "pot", count: 1 },
    ],
  });
  table(`${P}wallets`).set("m-1", { balance: 5 });
  const own = (id, item, extra = {}) =>
    table(`${P}inventory`).set(id, {
      owner: "m-1",
      item,
      name: item,
      ...extra,
    });
  own("i-herb", "herb");
  own("i-water", "water", { character: "hero" });
  own("i-pot", "pot");
  own("i-other", "herb", { character: "someone-else" });
  const combine = (materials, character = "hero") =>
    gate(ctx, "comments", "add", {
      data: {
        logId: "thread",
        text: "",
        action: "combine",
        materials,
        character,
      },
    });
  assert.equal(await reasonOf(combine(["i-herb"], null)), "no_character");
  assert.equal(await reasonOf(combine(["i-other"])), "not_owned");
  assert.equal(
    await reasonOf(combine(["i-herb", "i-herb"])),
    "invalid_materials",
  );
  const made = (await combine(["i-pot", "i-herb", "i-water"])).document;
  assert.equal(made.data.actions[0].success, true);
  assert.equal(made.data.actions[0].name, "Potion");
  assert.equal(table(`${P}wallets`).get("m-1").balance, 0);
  assert.equal(table(`${P}inventory`).has("i-herb"), false);
  assert.equal(table(`${P}inventory`).has("i-pot"), true); // reusable
  assert.ok(
    [...table(`${P}inventory`).values()].some(
      (row) => row.item === "potion" && row.character === "hero",
    ),
  );
  own("i-herb-2", "herb");
  const missed = (await combine(["i-herb-2", "i-pot"])).document;
  assert.equal(missed.data.actions[0].success, false);
  assert.equal(table(`${P}inventory`).has("i-herb-2"), false);
});

test("the characters rule shows members only the custom fields they may see", async () => {
  const { ctx, table } = roleplayWorld();
  const define = (code, visibility) =>
    table(`${P}character_fields`).set(code, { label: code, visibility });
  define("age", "public");
  define("secret", "owner");
  define("memo", "admin");
  const sheet = {
    id: "hero",
    createdBy: null,
    data: {
      owner: "m-1",
      name: "Hero",
      fields: { age: "17", secret: "diary", memo: "staff note" },
      fieldMedia: { art: "old" },
    },
  };
  const present = (member) =>
    characterRule.present(
      { ...ctx, member: { id: member } },
      { collection: `${P}characters`, document: sheet },
    );
  assert.deepEqual((await present("m-1")).fields, {
    age: "17",
    secret: "diary",
  });
  assert.deepEqual((await present("m-2")).fields, { age: "17" });
  assert.equal((await present("m-2")).fieldMedia, undefined);
  // Hidden fields cannot be queried; visitors read nothing.
  assert.ok(!characterRule.queryable.includes("fields"));
  assert.equal(
    await characterRule.scope(
      { ...ctx, member: null },
      { collection: `${P}characters` },
    ),
    false,
  );
});
