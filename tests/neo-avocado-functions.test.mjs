// 실행: npm test
// 서버 함수를 나루가 부르는 그대로 부른다: ctx 하나와 인자. ctx는 메모리에
// 있는 가짜이고, 나루에서처럼 함수가 쓴 문서에는 작성자가 붙지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buy,
  gacha,
  GACHA_COST,
  sell,
  gift,
  craft,
  relation,
  removeRelation,
  outfit,
  wear,
  removeOutfit,
  editOutfit,
  mainCharacter,
  characterStatus,
  characterSheet,
  allocateStats,
  useItem,
  assignInventory,
  equipTitle,
  history,
  sendMessage,
  conversations,
  conversation,
  readMessage,
  removeMessage,
  messageStatus,
  membership,
  join,
  leave,
  posts,
  comments,
  money,
  grants,
  sheet,
  presence,
  quests,
  contentPages,
  contentPage,
  callHistory,
  seeCalls,
  reviewCharacter,
  site,
  commentCounts,
  moderatePost,
} from "../dist/_naru/modules/index.js";
import { readable, canWrite } from "../dist/_naru/rules/community-board.js";
import * as characterRule from "../dist/_naru/rules/characters.js";
import * as profileRule from "../dist/_naru/rules/profiles.js";
import { matches } from "./where.mjs";
import { nativeRead } from "./native-read.mjs";
import { onDisplay } from "../dist/_naru/modules/display.js";

const P = "neo_avocado_";
function fakeCtx({ now = Date.parse("2030-01-01T03:00:00Z"), roll = 0 } = {}) {
  // Functions roll with Math.random, the host's on Naru.
  Math.random = () => roll;
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
      // Sorted by data fields; metadata keys keep the order written.
      for (const [key, direction] of [...(options.sort ?? [])].reverse())
        if (typeof key === "string")
          rows.sort((a, b) => {
            const [x, y] = [a.data[key], b.data[key]];
            const order = x < y ? -1 : x > y ? 1 : 0;
            return direction === "desc" ? -order : order;
          });
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
  // A 로그 board ("default"), as the owner would make one: the original
  // installs no boards. Tests that need others set them.
  table(`${P}boards`).set("default", {
    name: "로그",
    kind: "image",
    enabled: true,
    listLevel: 2,
    readLevel: 2,
    writeLevel: 2,
    commentLevel: 2,
    secret: "optional",
    categories: [],
    actions: true,
  });
  // Tests give one member several characters; the limit has its own test.
  const settingsTable = table(`${P}settings`);
  const set = settingsTable.set.bind(settingsTable);
  settingsTable.set = (id, data) =>
    set(id, id === "community" ? { characterLimit: 0, ...data } : data);
  settingsTable.set("community", {});
  return { ctx, table, sent, released };
}

/**
 * A page's write, by collection and operation: posts, comments and characters
 * through their site functions, profiles directly, as the profiles rule
 * allows. Nothing else is written by pages.
 */
async function communityWrite(
  ctx,
  { collection, operation, id, data, options = {} } = {},
) {
  const kind = collection.slice(P.length);
  const args = {
    ...(id !== undefined ? { id } : {}),
    ...(data !== undefined ? { data } : {}),
    revision: options.condition?.revision ?? null,
    ...(options.guest ? { guest: options.guest } : {}),
  };
  const functions = { logs: posts, comments, characters: sheet };
  if (functions[kind])
    return operation === "delete"
      ? functions[kind].remove(ctx, args)
      : (functions[kind].write ?? functions[kind].save)(ctx, args);
  if (kind === "profiles" && operation === "set") {
    const before = await ctx.get(collection, id);
    const after = { id, data };
    if (
      !before ||
      (await profileRule.canWrite(ctx, {
        collection,
        operation: "update",
        before,
        after,
      })) !== true
    )
      throw Object.assign(new Error("Denied."), { code: "ACCESS_DENIED" });
    return { document: await ctx.set(collection, id, data) };
  }
  throw Object.assign(new Error("No write path."), { code: "ACCESS_DENIED" });
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

test("the day's first visit pays the login reward once per Korean day, and joining the sign-up reward once", async () => {
  const { ctx, table } = fakeCtx();
  // The original installs both at 0: nothing is paid, and nothing recorded.
  await join(ctx, { nick: "앨리스" });
  await presence.seen(ctx, { where: "home" });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 0);
  assert.equal(table(`${P}history`).size, 0);
  table(`${P}settings`).set("community", {
    loginReward: 100,
    signupReward: 30,
  });
  // The day was already marked; the next Korean day pays.
  await presence.seen(ctx, { where: "home", visit: true });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 0);
  // 2030-01-01 15:00 UTC is already 2 January in Korea.
  ctx.now = Date.parse("2030-01-01T15:00:00Z");
  await presence.seen(ctx, { where: "home" });
  await presence.seen(ctx, { where: "shop", visit: true });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  assert.equal(table(`${P}wallets`).get("m-1").lastDaily, "2030-01-02");
  assert.deepEqual(
    [...table(`${P}history`).values()].map(({ kind, delta, memo }) => ({
      kind,
      delta,
      memo,
    })),
    [{ kind: "daily", delta: 100, memo: "2030-01-02 첫로그인" }],
  );
  // Changing the nickname is no new sign-up.
  await join(ctx, { nick: "앨리스2" });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  // A new member is paid on joining, once.
  ctx.member = { id: "m-2" };
  await presence.seen(ctx, { where: "home" });
  assert.equal(table(`${P}wallets`).get("m-2"), undefined);
  await join(ctx, { nick: "밥" });
  assert.equal(table(`${P}wallets`).get("m-2").balance, 30);
  await presence.seen(ctx, { where: "home" });
  assert.equal(table(`${P}wallets`).get("m-2").balance, 130);
  // A member who left is paid nothing.
  ctx.member = { id: "m-3" };
  await join(ctx, { nick: "캐럴" });
  table(`${P}members`).set("m-3", { role: "member", left: "2030-01-02" });
  await presence.seen(ctx, { where: "home" });
  assert.equal(table(`${P}wallets`).get("m-3").balance, 30);
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
    await communityWrite(ctx, {
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
      communityWrite(ctx, {
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
    await communityWrite(ctx, {
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
      communityWrite(ctx, {
        collection: `${P}logs`,
        operation: "add",
        data: { board: "notes", text: "x", category: "Unknown" },
      }),
    ),
    "invalid_input",
  );
  const saved = (
    await communityWrite(ctx, {
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
  const created = await communityWrite(ctx, {
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
      communityWrite(ctx, {
        collection: `${P}members`,
        operation: "set",
        id: "m-1",
        data: { role: "moderator" },
      }),
    ),
    // No page writes members: the collection is the admin's.
    "ACCESS_DENIED",
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

test("content ownership, parent checks, revisions and moderator boundaries hold for posts", async () => {
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
  assert.equal(await refusal(communityWrite(ctx, args)), "not_owned");
  table(`${P}members`).set("m-1", { status: "approved", role: "moderator" });
  assert.equal(
    await refusal(
      communityWrite(ctx, {
        ...args,
        options: { condition: { revision: "old" } },
      }),
    ),
    "conflict",
  );
  assert.equal((await communityWrite(ctx, args)).document.data.owner, "m-2");
  table(`${P}characters`).set("other", { owner: "m-2", name: "Other" });
  assert.equal(
    await refusal(
      communityWrite(ctx, {
        collection: `${P}characters`,
        operation: "delete",
        id: "other",
      }),
    ),
    "not_owned",
  );
  assert.equal(
    await refusal(
      communityWrite(ctx, {
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
    await communityWrite(ctx, {
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
      await communityWrite(ctx, {
        collection: `${P}characters`,
        operation: "delete",
        id: "hero",
      })
    ).done,
    true,
  );
  assert.equal(table(`${P}inventory`).get("paid").character, null);
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, null);
  // With characters left, the oldest remaining one becomes the 대표
  // (extend/character.lib.php:5-12); a deleted one is passed over.
  table(`${P}characters`).set("ghost", { owner: "m-1", deleted: true });
  table(`${P}characters`).set("elder", { owner: "m-1", name: "Elder" });
  table(`${P}characters`).set("hero", { owner: "m-1", name: "Hero" });
  table(`${P}characters`).set("other", { owner: "m-2", name: "Other" });
  table(`${P}profiles`).set("m-1", { owner: "m-1", mainCharacter: "hero" });
  await communityWrite(ctx, {
    collection: `${P}characters`,
    operation: "delete",
    id: "hero",
  });
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, "elder");
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
  // The sender's 쪽지함 has m-2's conversation, its last message theirs.
  const [entry] = (await conversations(ctx)).documents;
  assert.deepEqual(
    [entry.partner, entry.last.preview, entry.last.mine, entry.count],
    ["m-2", "private body", true, 1],
  );
  assert.equal((await readMessage(ctx, { id })).document.data.readAt, null);
  ctx.member.id = "m-3";
  assert.equal(await refusal(readMessage(ctx, { id })), "message_not_found");
  assert.equal(await refusal(removeMessage(ctx, { id })), "message_not_found");
  assert.equal((await conversations(ctx)).total, 0);
  ctx.member.id = "m-2";
  assert.equal((await conversations(ctx)).documents[0].unread, true);
  assert.equal((await messageStatus(ctx)).unread, true);
  assert.equal((await readMessage(ctx, { id })).document.data.readAt, ctx.now);
  assert.equal((await messageStatus(ctx)).unread, false);
  // The receipt tells the recipient's other tabs; a second read sends nothing.
  assert.deepEqual(live.at(-1), {
    member: "m-2",
    data: { unread: false, unreadCount: 0 },
  });
  await readMessage(ctx, { id });
  assert.equal(live.length, 2);
  // Removing it takes it from the recipient's box only; the sender keeps
  // theirs, so a sender cannot erase what was received, nor the reverse.
  await removeMessage(ctx, { id });
  assert.equal(await refusal(readMessage(ctx, { id })), "message_not_found");
  assert.equal((await conversations(ctx)).total, 0);
  ctx.member.id = "m-1";
  assert.equal((await readMessage(ctx, { id })).document.id, id);
  assert.equal((await conversations(ctx)).total, 1);
  await removeMessage(ctx, { id });
  assert.equal(table(`${P}messages`).has(id), false);
});

test("a member sends so many messages a day, as the original's captcha slowed them", async () => {
  const { ctx, table } = fakeCtx();
  for (const id of ["m-1", "m-2", "m-3", "m-4"])
    table(`${P}profiles`).set(id, { nick: id });
  table(`${P}settings`).set("community", { messageDailyLimit: 3 });
  await sendMessage(ctx, { recipients: ["m-2", "m-3"], body: "hi" });
  const refused = await sendMessage(ctx, {
    recipients: ["m-2", "m-4"],
    body: "again",
  }).catch((error) => error);
  assert.equal(refused.code, "RATE_LIMITED");
  assert.deepEqual(refused.details, { reason: "daily_limit", remaining: 1 });
  await sendMessage(ctx, { recipients: ["m-4"], body: "last" });
  // The next Korean day starts again.
  ctx.now += 24 * 3600 * 1000;
  await sendMessage(ctx, {
    recipients: ["m-2", "m-3", "m-4"],
    body: "new day",
  });
  // 0 lifts the limit.
  table(`${P}settings`).set("community", { messageDailyLimit: 0 });
  await sendMessage(ctx, { recipients: ["m-2"], body: "no limit" });
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
  const [entry] = (await conversations(ctx)).documents;
  assert.equal(entry.count, 3);
  assert.equal(entry.last.preview.length, 150);
});

test("a conversation shows both sides oldest first and reads what the other sent", async () => {
  const { ctx, table, sent: live } = fakeCtx();
  for (const id of ["m-1", "m-2", "m-3"])
    table(`${P}profiles`).set(id, { nick: id });
  await sendMessage(ctx, { recipients: ["m-2"], body: "안녕" });
  ctx.now += 1000;
  await sendMessage(ctx, { recipients: ["m-3"], body: "다른 사람" });
  ctx.member.id = "m-2";
  ctx.now += 1000;
  await sendMessage(ctx, { recipients: ["m-1"], body: "반가워" });
  ctx.member.id = "m-1";
  const listed = await conversations(ctx);
  assert.deepEqual(
    listed.documents.map((entry) => [entry.partner, entry.unread]),
    [
      ["m-2", true],
      ["m-3", false],
    ],
  );
  const talk = await conversation(ctx, { partner: "m-2" });
  assert.deepEqual(
    talk.documents.map((row) => row.data.body),
    ["안녕", "반가워"],
  );
  assert.equal(talk.unread, false);
  assert.deepEqual(live.at(-1), {
    member: "m-1",
    data: { unread: false, unreadCount: 0 },
  });
  assert.equal((await conversations(ctx)).documents[0].unread, false);
  assert.equal(
    await refusal(conversation(ctx, { partner: "m-1" })),
    "invalid_input",
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
    data: {
      name: "Medal",
      description: "A medal",
      image: "https://example.com/medal.png",
    },
  };
  assert.equal(await refusal(useItem(ctx, args)), "not_enough_exp");
  assert.equal(table(`${P}inventory`).has("ticket-a"), true);
  table(`${P}character_state`).get("hero").exp = 10;
  // 소속 and 종족 are the sheet's (ch_side, ch_class), whatever the record holds.
  table(`${P}characters`).get("hero").class = "human";
  assert.equal(await refusal(useItem(ctx, args)), "restricted_character");
  table(`${P}characters`).get("hero").class = "elf";
  table(`${P}character_state`).get("hero").class = "human";
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
  // The sheet's own 소속 decides, not a value kept in the official record.
  table(`${P}characters`).get("hero").side = "city";
  state.side = "forest";
  assert.equal(await refusal(buy(ctx, args)), "restricted_character");
  table(`${P}characters`).get("hero").side = "forest";
  state.side = "city";
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
  // A title out of use (ti_use) cannot be shown.
  table(`${P}titles`).get("winner").enabled = false;
  assert.equal(
    await refusal(equipTitle(ctx, { character: "hero", title: "winner" })),
    "missing_title",
  );
  table(`${P}titles`).get("winner").enabled = true;
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

test("an approved character only spends its points left, and no stat goes down", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", { owner: "m-1", state: "approved" });
  table(`${P}stat_config`).set("hp", { name: "HP", initial: 0, max: 100 });
  table(`${P}stat_config`).set("mp", { name: "MP", initial: 0, max: 100 });
  table(`${P}character_state`).set("hero", {
    owner: "m-1",
    character: "hero",
    points: 10,
    exp: 0,
    stats: {
      hp: { allocated: 4, max: 4, damage: 0, current: 4 },
      mp: { allocated: 2, max: 2, damage: 0, current: 2 },
    },
    titles: [],
    approved: true,
  });
  const allocate = (allocation) =>
    allocateStats(ctx, { character: "hero", allocation, revision: "r1" });
  // mypage/character/status.inc.php:17-25: approved, the form starts from
  // what each stat has (status_fix), and only the space point is spent.
  assert.equal(await refusal(allocate({ hp: 3, mp: 3 })), "approved_stats");
  assert.equal(await refusal(allocate({ hp: 6, mp: 5 })), "not_enough_points");
  await allocate({ hp: 6, mp: 4 });
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.max, 6);
  // Before approval the owner moves points freely.
  table(`${P}character_state`).get("hero").approved = false;
  await allocate({ hp: 0, mp: 10 });
  assert.equal(table(`${P}character_state`).get("hero").stats.mp.max, 10);
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
  // At full health it is still used, and the stat stays at its maximum
  // (set_status clamps; use_item.php consumes regardless).
  table(`${P}items`).get("potion").reusable = false;
  await useItem(ctx, { inventory: "p2", character: "hero" });
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.current, 10);
  assert.equal(table(`${P}inventory`).has("p2"), false);
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
  // The original's form asks for a name, a description and an image.
  for (const data of [
    { name: "메달", description: "", image: "https://example.com/m.png" },
    { name: "메달", description: "메달" },
  ])
    assert.equal(
      await refusal(useItem(ctx, { inventory: "ticket", data })),
      "invalid_input",
    );
  const result = await useItem(ctx, {
    inventory: "ticket",
    data: {
      name: "메달",
      description: "메달",
      image: "https://example.com/m.png",
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
});

test("a profile ticket opens the whole sheet of an approved character once while editing is closed", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}settings`).set("community", { characterEditing: false });
  table(`${P}character_fields`).set("age", {
    label: "나이",
    type: "select",
    options: ["17"],
  });
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    name: "Old",
    state: "approved",
    type: "sub",
    outfit: "keep",
  });
  table(`${P}characters`).set("other", {
    owner: "m-1",
    name: "Other",
    state: "approved",
  });
  table(`${P}items`).set("profile", {
    name: "수정권",
    effect: { type: "profile" },
  });
  table(`${P}items`).set("potion", {
    name: "물약",
    effect: { type: "restore", stat: "hp", amount: 1 },
  });
  table(`${P}inventory`).set("profile-ticket", {
    owner: "m-1",
    item: "profile",
    name: "수정권",
  });
  table(`${P}inventory`).set("bound", {
    owner: "m-1",
    item: "profile",
    name: "수정권",
    character: "other",
  });
  table(`${P}inventory`).set("potion", { owner: "m-1", item: "potion" });
  table(`${P}inventory`).set("theirs", { owner: "m-2", item: "profile" });
  const save = (ticket, data = {}) =>
    sheet.save(ctx, {
      id: "hero",
      revision: "r1",
      data: { name: "New", ...data },
      ...(ticket ? { ticket } : {}),
    });
  // The old partial edit is gone: the ticket is spent by the sheet.
  assert.equal(
    await refusal(
      useItem(ctx, {
        inventory: "profile-ticket",
        character: "hero",
        data: { name: "New" },
      }),
    ),
    "use_from_sheet",
  );
  assert.equal(await refusal(save(null)), "editing_closed");
  for (const ticket of ["potion", "theirs", "bound", "missing"])
    assert.equal(await refusal(save(ticket)), "invalid_ticket");
  // The sheet is checked as any save: a bad field keeps the ticket.
  assert.equal(
    await refusal(save("profile-ticket", { fields: { age: "99" } })),
    "invalid_field",
  );
  assert.equal(table(`${P}inventory`).has("profile-ticket"), true);
  await save("profile-ticket", {
    fields: { age: "17" },
    owner: "m-2",
    type: "main",
    state: "editing",
  });
  const saved = table(`${P}characters`).get("hero");
  assert.equal(saved.name, "New");
  assert.equal(saved.owner, "m-1");
  assert.equal(saved.state, "approved");
  assert.equal(saved.type, "sub");
  assert.deepEqual(saved.fields, { age: "17" });
  assert.equal(table(`${P}inventory`).has("profile-ticket"), false);
  assert.equal(await refusal(save("profile-ticket")), "invalid_ticket");
  // A lasting ticket (it_use_ever) stays.
  table(`${P}items`).get("profile").reusable = true;
  table(`${P}inventory`).set("lasting", { owner: "m-1", item: "profile" });
  await save("lasting", { name: "Again" });
  assert.equal(table(`${P}characters`).get("hero").name, "Again");
  assert.equal(table(`${P}inventory`).has("lasting"), true);
});

test("character relationships validate source ownership, targets, revisions and text", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("mine", {
    owner: "m-1",
    name: "내 캐릭터",
    state: "submitted",
  });
  table(`${P}characters`).set("other", { owner: "m-2", name: "상대" });
  const args = {
    character: "mine",
    target: "other",
    affinity: 3,
    memo: "친구",
    order: 1,
  };
  // Only an approved character has relations (viewer.php:157-196).
  assert.equal(await refusal(relation(ctx, args)), "not_approved");
  table(`${P}characters`).get("mine").state = "approved";
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
    await refusal(relation(ctx, { ...args, affinity: 6 })),
    "invalid_input",
  );
  assert.equal(
    await refusal(relation(ctx, { ...args, affinity: -1 })),
    "invalid_input",
  );
  await assert.rejects(
    async () =>
      await relation(ctx, {
        ...args,
        link: "https://example.com/a\njavascript:alert(1)",
      }),
    /HTTPS/,
  );
  await assert.rejects(
    async () => await relation(ctx, { ...args, link: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.equal(table(`${P}relations`).size, 0);
  // Several links, one per line (rm_link); blank lines drop.
  const created = (
    await relation(ctx, {
      ...args,
      link: " https://example.com/a \n\nhttps://example.com/b",
    })
  ).document;
  assert.equal(created.data.owner, "m-1");
  assert.equal(
    created.data.link,
    "https://example.com/a\nhttps://example.com/b",
  );
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
  // cloest_path_update.php: the owner renames it or changes its address.
  await editOutfit(ctx, {
    id: clothing.id,
    name: "정장",
    image: "https://media.naru.pub/suit.png",
  });
  assert.equal(table(`${P}wardrobe`).get(clothing.id).name, "정장");
  assert.equal(
    table(`${P}wardrobe`).get(clothing.id).image,
    "https://media.naru.pub/suit.png",
  );
  await assert.rejects(
    async () =>
      await editOutfit(ctx, {
        id: clothing.id,
        name: "정장",
        image: "javascript:alert(1)",
      }),
    /HTTPS/,
  );
  ctx.member.id = "m-2";
  assert.equal(
    await refusal(
      editOutfit(ctx, {
        id: clothing.id,
        name: "뺏기",
        image: "https://media.naru.pub/x.png",
      }),
    ),
    "not_owned",
  );
  ctx.member.id = "m-1";
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
  table(`${P}profiles`).set("m-1", { nick: "부자" });
  table(`${P}settings`).set("community", { loginReward: 1 });
  await assert.rejects(
    async () => await presence.seen(ctx, { where: "home" }),
    /Balance/,
  );
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

test("gifts go to a character, another member's or one's own, keep who sent them and tell the recipient", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}profiles`).set("m-1", { nick: "나" });
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
    senderName: "나",
    memo: "선물",
    receivedAt: ctx.now,
    character: null,
  });
  // The recipient hears of it by 쪽지 (send_memo), not counted as written.
  const [notice] = [...table(`${P}messages`).values()];
  assert.equal(notice.to, "m-2");
  assert.equal(notice.gift, true);
  assert.match(notice.body, /나님이 보내신 《씨앗》 아이템이 도착/);
  assert.equal(
    await refusal(gift(ctx, { inventory: "mine", recipient: "m-2" })),
    "not_owned",
  );
  assert.equal(await refusal(sell(ctx, { inventory: "mine" })), "not_owned");
  // To one of the sender's own characters: no 쪽지.
  table(`${P}characters`).set("own", { owner: "m-1", name: "내캐" });
  table(`${P}inventory`).set("again", {
    owner: "m-1",
    item: "seed",
    name: "씨앗",
  });
  await gift(ctx, { inventory: "again", recipient: "m-1", character: "own" });
  assert.equal(table(`${P}inventory`).get("again").character, "own");
  assert.equal(table(`${P}messages`).size, 1);
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
  table(`${P}items`).set("seed", { name: "씨앗", craftMaterial: true });
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
  // Only craft materials go in (it_use_recepi), and a reusable one stays.
  table(`${P}recipes`).set("tool", {
    item: "tree",
    ingredients: [
      { item: "seed", count: 1 },
      { item: "shovel", count: 1 },
    ],
  });
  table(`${P}items`).set("shovel", { name: "삽", reusable: true });
  table(`${P}inventory`).set("c", { owner: "m-1", item: "seed" });
  table(`${P}inventory`).set("s", { owner: "m-1", item: "shovel" });
  assert.equal(
    await refusal(craft(ctx, { recipe: "tool", materials: ["c", "s"] })),
    "not_material",
  );
  table(`${P}items`).get("shovel").craftMaterial = true;
  await craft(ctx, { recipe: "tool", materials: ["c", "s"] });
  assert.equal(table(`${P}inventory`).has("c"), false);
  assert.equal(table(`${P}inventory`).has("s"), true);
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

/** One of m-1's characters, approved as the owner's review approves it. */
function approvedCharacter(table, id = "hero", official = {}) {
  table(`${P}characters`).set(id, {
    owner: "m-1",
    name: id,
    state: "approved",
  });
  table(`${P}character_state`).set(id, {
    owner: "m-1",
    character: id,
    points: 0,
    exp: 0,
    stats: {},
    titles: [],
    approved: true,
    ...official,
  });
}

test("buying checks the item, its stock and the balance before taking anything", async () => {
  const { ctx, table } = fakeCtx();
  approvedCharacter(table);
  const character = "hero";
  table(`${P}items`).set("sword", { name: "검", price: 80, stock: 1 });
  table(`${P}items`).set("potion", { name: "물약", price: 10 });
  table(`${P}items`).set("secret", { name: "비밀", price: 1, hidden: true });
  assert.equal(
    await refusal(buy(ctx, { item: "sword", character })),
    "not_enough",
  );
  assert.equal(table(`${P}wallets`).size, 0);
  table(`${P}wallets`).set("m-1", { balance: 100 });
  const bought = await buy(ctx, { item: "sword", character });
  assert.equal(bought.balance, 20);
  assert.deepEqual(bought.owned.data, {
    owner: "m-1",
    item: "sword",
    name: "검",
    from: "shop",
    character,
  });
  assert.equal(table(`${P}items`).get("sword").stock, 0);
  assert.equal(
    await refusal(buy(ctx, { item: "sword", character })),
    "sold_out",
  );
  // No stock is no limit.
  await buy(ctx, { item: "potion", character });
  assert.equal(table(`${P}items`).get("potion").stock, undefined);
  for (const item of ["secret", "missing", undefined, 7])
    assert.equal(await refusal(buy(ctx, { item, character })), "no_item");
});

test("buying takes an approved character of the member's own, and limits count per character", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}wallets`).set("m-1", { balance: 100 });
  table(`${P}items`).set("cake", {
    name: "케이크",
    price: 1,
    requirements: { limit: 1 },
  });
  // shop/_ajax.shop_update.php:4: no character, or one not approved, buys
  // nothing; nor does someone else's.
  assert.equal(await refusal(buy(ctx, { item: "cake" })), "no_character");
  table(`${P}characters`).set("draft", { owner: "m-1", state: "submitted" });
  assert.equal(
    await refusal(buy(ctx, { item: "cake", character: "draft" })),
    "not_approved",
  );
  approvedCharacter(table, "theirs");
  table(`${P}characters`).get("theirs").owner = "m-2";
  assert.equal(
    await refusal(buy(ctx, { item: "cake", character: "theirs" })),
    "no_character",
  );
  assert.equal(table(`${P}wallets`).get("m-1").balance, 100);
  // The limit is each character's (_ajax.shop_update.php:89), not the wallet's.
  approvedCharacter(table, "hero");
  approvedCharacter(table, "sidekick");
  await buy(ctx, { item: "cake", character: "hero" });
  assert.equal(
    await refusal(buy(ctx, { item: "cake", character: "hero" })),
    "purchase_limit",
  );
  await buy(ctx, { item: "cake", character: "sidekick" });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 98);
  assert.equal(table(`${P}wallets`).get("m-1").purchases, undefined);
  assert.deepEqual(table(`${P}character_state`).get("hero").purchases, {
    cake: 1,
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
      await communityWrite(ctx, {
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
  await communityWrite(ctx, {
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
  // Asking for another member's secret body is refused: posts are queried
  // only on what every reader may see (the rule's queryable).
  assert.equal(
    await refusal(
      list("logs", {
        all: [{ eq: ["board", "default"] }, { eq: ["text", "guess"] }],
      }),
    ),
    "INVALID_REQUEST",
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
    await readable(ctx, { ...list, filter: { board: "default" } }),
    false,
  );
  // A batch read is held to the list level too, as it was when it came
  // as a list (SDK 1.1.0 names it getMany).
  assert.equal(
    await readable(ctx, {
      collection: `${P}logs`,
      operation: "getMany",
      ids: ["a"],
      filter: {},
    }),
    false,
  );
  ctx.member = null;
  assert.equal(await readable(ctx, { ...list, filter: {} }), false);
  assert.equal(
    await canWrite(ctx, { collection: `${P}logs`, before: null, after: log }),
    false,
  );
  ctx.member = { id: "m-1" };
  table(`${P}boards`).set("default", { listLevel: 2, readLevel: 2 });
  assert.deepEqual(
    await readable(ctx, { ...list, filter: { board: "default" } }),
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
  assert.equal(await readable(ctx, comments), false);
  table(`${P}logs`).set("log", log.data);
  assert.deepEqual(await readable(ctx, comments), { eq: ["logId", "log"] });
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
  (["get", "getMany", "list"].includes(operation)
    ? nativeRead
    : communityWrite)(ctx, {
    collection: `${P}${collection}`,
    operation,
    ...rest,
  });
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
    portrait: "https://example.com/hero.png",
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
  Math.random = () => 0;
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
  Math.random = () => 0.5;
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
  // 메인·서브 is the admin's: what a member sends is ignored, a new one is main.
  assert.equal((await add({ type: "npc" })).document.data.type, "main");
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
  assert.equal(created.data.type, "main");
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
  Math.random = () => 0.9;
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

test("items used in a post are the speaker's own, logged and spent; only a draw does anything", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}items`).set("letter", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Letter",
    description: "A note",
    usableInPosts: true,
  });
  table(`${P}items`).set("box", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Box",
    effect: { type: "draw" },
    usableInPosts: true,
  });
  table(`${P}items`).set("prize", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Prize",
  });
  table(`${P}items`).set("ticket", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Ticket",
    effect: { type: "create" },
    usableInPosts: true,
  });
  table(`${P}items`).set("charm", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Charm",
    description: "Kept",
    reusable: true,
  });
  table(`${P}gacha`).set("in-box", { source: "box", item: "prize", weight: 1 });
  const own = (id, item, extra = {}) =>
    table(`${P}inventory`).set(id, {
      owner: "m-1",
      item,
      name: item,
      character: "hero",
      ...extra,
    });
  own("i-letter", "letter");
  own("i-box", "box");
  own("i-ticket", "ticket");
  own("i-charm", "charm");
  // Held by no character: the original's inventory is a character's.
  own("i-loose", "letter", { character: undefined });
  table(`${P}inventory`).set("i-theirs", {
    owner: "m-2",
    item: "letter",
    character: "rival",
  });
  const use = (item, character = "hero") =>
    gate(ctx, "comments", "add", {
      data: { logId: "thread", text: "uses", item, character },
    });
  assert.equal(await reasonOf(use("i-theirs")), "not_owned");
  assert.equal(await reasonOf(use("i-loose")), "wrong_character");
  assert.equal(await reasonOf(use("i-box", null)), "no_character");
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
  // A ticket is only shown used and spent: tickets work from the inventory
  // (write_update.inc.php:126-129 logs any item but 뽑기).
  const ticket = (await use("i-ticket")).document;
  assert.equal(ticket.data.actions[0].effect, "create");
  assert.equal(table(`${P}inventory`).has("i-ticket"), false);
  // A reusable item (it_use_ever) stays.
  await use("i-charm");
  assert.equal(table(`${P}inventory`).has("i-charm"), true);
  // A post's item needs an approved character; a comment's does not.
  table(`${P}character_state`).set("hero", {
    ...table(`${P}character_state`).get("hero"),
    approved: false,
  });
  assert.equal((await use("i-charm")).document.data.actions.length, 1);
  const post = (data) =>
    gate(ctx, "logs", "add", {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "hero",
        ...data,
      },
    });
  assert.equal(await reasonOf(post({ item: "i-charm" })), "not_approved");
});

test("recovery in a post is logged, not applied: it heals from the inventory only", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}stat_config`).set("hp", { name: "HP", initial: 10, max: 100 });
  table(`${P}character_state`).set("hero", {
    ...table(`${P}character_state`).get("hero"),
    stats: { hp: { allocated: 0, max: 10, current: 3, damage: 7 } },
  });
  table(`${P}items`).set("potion", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Potion",
    effect: { type: "restore", stat: "hp", amount: 3 },
  });
  table(`${P}inventory`).set("i-potion", {
    owner: "m-1",
    item: "potion",
    name: "Potion",
    character: "hero",
  });
  const posted = (
    await gate(ctx, "logs", "add", {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "hero",
        item: "i-potion",
      },
    })
  ).document;
  assert.equal(posted.data.actions[0].effect, "restore");
  assert.equal(posted.data.actions[0].amount, undefined);
  assert.equal(table(`${P}inventory`).has("i-potion"), false);
  assert.equal(table(`${P}character_state`).get("hero").stats.hp.damage, 7);
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
  const member = await communityWrite(ctx, {
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
  for (const collection of ["wallets", "inventory", "messages"])
    assert.equal(
      await refusal(
        read({ collection: `${P}${collection}`, operation: "list" }),
      ),
      "ACCESS_DENIED",
    );
  // A guest must name themselves and give a password; no secrets or actions.
  const post = (data, guest) =>
    communityWrite(ctx, {
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
    communityWrite(ctx, {
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
  const comment = await communityWrite(ctx, {
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
      communityWrite(ctx, {
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
      await communityWrite(ctx, {
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
    mobileBackground: "http://cdn.example/m.png",
    mobileLogo: "https://cdn.example/m-logo.png",
    backgroundColor: "red;}",
    backgroundRepeat: "space;}",
    backgroundPosition: "center bottom",
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
    // 디자인 사용 is off unless the owner turns it on.
    enabled: false,
    title: "아보카도",
    description: "",
    favicon: null,
    logo: null,
    mobileLogo: "https://cdn.example/m-logo.png",
    background: "https://cdn.example/bg.png",
    // Only HTTPS pictures, a #rrggbb colour and the listed choices.
    mobileBackground: null,
    backgroundColor: null,
    backgroundRepeat: "repeat",
    backgroundPosition: "center bottom",
    headerBackground: null,
    font: "sans",
    colors: { accent: "#123456" },
  });
  assert.deepEqual(
    frame.menus.map((menu) => menu.id),
    ["b", "a"],
  );
  // No background music until the owner sets a YouTube link; only its ID
  // reaches pages.
  assert.equal(frame.bgm, null);
  table(`${P}settings`).set("community", {
    bgm: "https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  });
  assert.deepEqual((await site(ctx)).bgm, {
    list: "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  });
  table(`${P}settings`).set("community", { bgm: "javascript:alert(1)" });
  assert.equal((await site(ctx)).bgm, null);
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
      await communityWrite(ctx, {
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
  const edited = await communityWrite(ctx, {
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
    await communityWrite(ctx, {
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
    communityWrite(ctx, {
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

test("a post's 조합 matches recipes by item, charges cost and consumes even on a miss; comments do not combine", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}items`).set("herb", { name: "Herb", craftMaterial: true });
  table(`${P}items`).set("water", { name: "Water", craftMaterial: true });
  table(`${P}items`).set("pot", {
    name: "Pot",
    reusable: true,
    craftMaterial: true,
  });
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
      character: "hero",
      ...extra,
    });
  own("i-herb", "herb");
  // Held by no character: not the speaker's (write.skin.php:238).
  own("i-loose", "herb", { character: undefined });
  own("i-water", "water", { character: "hero" });
  own("i-pot", "pot");
  own("i-other", "herb", { character: "someone-else" });
  // 조합 is a post's (mmb/write.skin.php), not a comment's.
  assert.equal(
    await reasonOf(
      gate(ctx, "comments", "add", {
        data: {
          logId: "thread",
          text: "",
          action: "combine",
          materials: ["i-herb"],
          character: "hero",
        },
      }),
    ),
    "invalid_input",
  );
  const combine = (materials, character = "hero") =>
    gate(ctx, "logs", "add", {
      data: {
        board: "default",
        image: "https://example.com/log.png",
        text: "",
        action: "combine",
        materials,
        character,
      },
    });
  assert.equal(await reasonOf(combine(["i-herb"], null)), "no_character");
  assert.equal(await reasonOf(combine(["i-other"])), "not_owned");
  assert.equal(await reasonOf(combine(["i-loose"])), "not_owned");
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
  // Only an approved character combines (write.skin.php:196).
  table(`${P}character_state`).set("hero", {
    ...table(`${P}character_state`).get("hero"),
    approved: false,
  });
  own("i-herb-3", "herb");
  assert.equal(await reasonOf(combine(["i-herb-3"])), "not_approved");
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
  // Hidden fields cannot be queried; visitors see the public ones only.
  assert.ok(!characterRule.queryable.includes("fields"));
  assert.deepEqual(
    (
      await characterRule.present(
        { ...ctx, member: null },
        { collection: `${P}characters`, document: sheet },
      )
    ).fields,
    { age: "17" },
  );
});

test("사이트공개: visitors read characters and the viewer while the site is open, and nothing once it is closed", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("free", PUBLIC_BOARD);
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    name: "Hero",
    state: "approved",
    fields: { age: "17", diary: "secret" },
  });
  table(`${P}character_fields`).set("age", { label: "나이" });
  table(`${P}character_fields`).set("diary", {
    label: "일기",
    visibility: "owner",
  });
  table(`${P}sides`).set("forest", { name: "숲" });
  table(`${P}profiles`).set("m-1", { nick: "회원" });
  table(`${P}logs`).set("post", {
    board: "free",
    text: "공개 글",
    owner: "m-1",
  });
  ctx.member = null;
  const read = (collection, operation = "list", id) =>
    nativeRead(ctx, { collection: `${P}${collection}`, operation, id });
  const ids = async (collection, options) =>
    (
      await nativeRead(ctx, {
        collection: `${P}${collection}`,
        operation: "list",
        options,
      })
    ).documents.map((row) => row.id);
  // Open (the default): the lists, the viewer and its functions.
  assert.deepEqual(await ids("characters"), ["hero"]);
  assert.deepEqual((await read("characters", "get", "hero")).document.data, {
    owner: "m-1",
    name: "Hero",
    state: "approved",
    fields: { age: "17" },
  });
  for (const collection of ["character_fields", "sides"])
    assert.equal((await ids(collection)).length > 0, true, collection);
  assert.equal(
    (await characterStatus(ctx, { character: "hero" })).state.owner,
    "m-1",
  );
  assert.deepEqual((await characterSheet(ctx, { character: "hero" })).exp, []);
  assert.equal((await site(ctx)).open, true);
  // Closed: visitors read no characters, boards, posts or nicknames, and
  // the viewer's functions refuse them, as the original sends them to log in.
  table(`${P}settings`).set("community", { siteOpen: false });
  assert.equal((await site(ctx)).open, false);
  for (const collection of [
    "characters",
    "character_fields",
    "sides",
    "boards",
    "profiles",
  ])
    assert.deepEqual(await ids(collection), [], collection);
  assert.deepEqual(await ids("logs", { filter: { board: "free" } }), []);
  assert.equal(
    await refusal(characterStatus(ctx, { character: "hero" })),
    "site_closed",
  );
  assert.equal(
    await refusal(characterSheet(ctx, { character: "hero" })),
    "site_closed",
  );
  assert.deepEqual((await site(ctx)).menus, []);
  assert.equal(
    await refusal(
      communityWrite(ctx, {
        collection: `${P}logs`,
        operation: "add",
        data: { board: "free", image: null, text: "손님 글" },
        options: { guest: { name: "길손", password: "1234" } },
      }),
    ),
    "access_denied",
  );
  // Members read on as before.
  ctx.member = { id: "m-2" };
  assert.deepEqual(await ids("characters"), ["hero"]);
  assert.equal(
    (await characterStatus(ctx, { character: "hero" })).state.owner,
    "m-1",
  );
});

test("the viewer's experience history comes a page at a time (member/exp.php)", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", { owner: "m-1", name: "Hero" });
  for (let n = 0; n < 25; n++)
    table(`${P}history`).set(`e${n}`, {
      owner: "m-1",
      kind: "exp",
      character: "hero",
      at: n,
      expDelta: 1,
      exp: n + 1,
    });
  const first = await characterSheet(ctx, { character: "hero" });
  assert.equal(first.exp.length, 20);
  assert.ok(first.expCursor);
  assert.equal(first.inventory, null);
  const second = await characterSheet(ctx, {
    character: "hero",
    after: first.expCursor,
  });
  assert.equal(second.exp.length, 5);
  assert.equal(second.expCursor, null);
  assert.equal(Object.hasOwn(second, "inventory"), false);
  assert.equal(
    await refusal(characterSheet(ctx, { character: "hero", size: 51 })),
    "invalid_input",
  );
});

test("a member who leaves becomes a guest until the owner clears the date", async () => {
  const { ctx, table } = fakeCtx({ now: Date.parse("2030-01-01T16:00:00Z") });
  await join(ctx, { nick: "떠날이" });
  table(`${P}members`).get("m-1").level = 5;
  assert.equal(await refusal(leave(ctx, {})), "invalid_input");
  assert.deepEqual(await leave(ctx, { confirm: true }), { left: true });
  // The date is Korea's: 01:00 the next day there.
  assert.equal(table(`${P}members`).get("m-1").left, "2030-01-02");
  const left = await membership(ctx);
  assert.equal(left.left, true);
  assert.equal(left.level, 1);
  assert.equal(await refusal(leave(ctx, { confirm: true })), "left");
  assert.equal(await refusal(join(ctx, { nick: "다시" })), "left");
  // Their profile stays; the owner clears the date to let them back.
  assert.equal(table(`${P}profiles`).get("m-1").nick, "떠날이");
  delete table(`${P}members`).get("m-1").left;
  assert.equal((await membership(ctx)).level, 5);
});

test("history narrows to one kind, as the experience list asks", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}history`).set("h1", { owner: "m-1", kind: "buy", at: 1 });
  table(`${P}history`).set("h2", {
    owner: "m-1",
    kind: "exp",
    at: 2,
    expDelta: 5,
    exp: 5,
  });
  table(`${P}history`).set("h3", {
    owner: "m-2",
    kind: "exp",
    at: 3,
    expDelta: 9,
    exp: 9,
  });
  assert.deepEqual(
    (await history(ctx, { kind: "exp" })).documents.map((row) => row.id),
    ["h2"],
  );
  assert.equal((await history(ctx, {})).documents.length, 2);
  assert.equal(await refusal(history(ctx, { kind: 5 })), "invalid_input");
});

test("visits record where members are and count each Korean day, bounded", async () => {
  const { ctx, table } = fakeCtx({ now: Date.parse("2030-01-01T15:30:00Z") });
  await join(ctx, { nick: "앨리스" });
  await presence.seen(ctx, {
    where: "상점",
    visit: true,
    browser: "Chrome",
    os: "macOS",
    device: "PC",
    domain: "twitter.com",
  });
  await presence.seen(ctx, {
    where: "로그",
    visit: true,
    browser: "<script>",
    os: "x".repeat(500),
  });
  assert.deepEqual(table(`${P}presence`).get("m-1"), {
    nick: "앨리스",
    where: "로그",
    at: Date.parse("2030-01-01T15:30:00Z"),
  });
  // 15:30 UTC is 00:30 the next day in Korea.
  const day = table(`${P}visits`).get("2030-01-02");
  assert.equal(day.total, 2);
  assert.deepEqual(day.members, { "m-1": 2 });
  assert.deepEqual(day.hours, { 0: 2 });
  assert.deepEqual(day.browsers, { Chrome: 1, 기타: 1 });
  assert.deepEqual(day.os, { macOS: 1, 기타: 1 });
  assert.deepEqual(day.domains, { "twitter.com": 1 });
  // Moving between pages says where a member is, and counts nothing.
  await presence.seen(ctx, { where: "마이페이지" });
  assert.equal(table(`${P}presence`).get("m-1").where, "마이페이지");
  assert.equal(table(`${P}visits`).get("2030-01-02").total, 2);
  // A visitor counts as a guest and is not listed as here.
  ctx.member = null;
  await presence.seen(ctx, { visit: true });
  await presence.seen(ctx, {});
  assert.equal(table(`${P}visits`).get("2030-01-02").guests, 1);
  assert.deepEqual(
    (await presence.online(ctx)).members.map((member) => member.nick),
    ["앨리스"],
  );
  ctx.now += 11 * 60 * 1000;
  assert.deepEqual((await presence.online(ctx)).members, []);
  // Who is here is for members: Naru refuses visitors an export not listed.
  assert.deepEqual(presence.visitors, ["seen"]);
  assert.equal(
    await refusal(presence.seen(ctx, { where: 5 })),
    "invalid_input",
  );
});

test("the owner's switches open and close creating and editing characters, and limit them", async () => {
  const { ctx, table } = fakeCtx();
  const data = { name: "하나", type: "main", state: "editing" };
  // The original's install default: one character a member.
  table(`${P}settings`).set("community", { characterLimit: 1 });
  const first = await sheet.save(ctx, { data });
  assert.equal(
    await refusal(sheet.save(ctx, { data: { ...data, name: "둘" } })),
    "character_limit",
  );
  table(`${P}settings`).set("community", { characterCreation: false });
  assert.equal(
    await refusal(sheet.save(ctx, { data: { ...data, name: "둘" } })),
    "creation_closed",
  );
  table(`${P}settings`).set("community", { characterEditing: false });
  // An application can still be finished; an approved sheet waits.
  const finished = await sheet.save(ctx, {
    id: first.document.id,
    revision: first.document.revision,
    data: { ...data, profile: "신청 중 고침" },
  });
  assert.equal(finished.document.data.profile, "신청 중 고침");
  table(`${P}characters`).set(first.document.id, {
    ...table(`${P}characters`).get(first.document.id),
    state: "approved",
  });
  assert.equal(
    await refusal(
      sheet.save(ctx, {
        id: first.document.id,
        revision: first.document.revision,
        data: { ...data, profile: "고침" },
      }),
    ),
    "editing_closed",
  );
  // A deleted character no longer counts.
  table(`${P}settings`).set("community", { characterLimit: 1 });
  table(`${P}characters`).set(first.document.id, {
    ...table(`${P}characters`).get(first.document.id),
    deleted: true,
  });
  await sheet.save(ctx, { data: { ...data, name: "둘" } });
});

test("characters choose 소속 and 종족 from the owner's lists once there are any", async () => {
  const { ctx, table } = fakeCtx();
  const data = { name: "하나", type: "main", state: "editing" };
  const free = await sheet.save(ctx, { data: { ...data, side: "아무거나" } });
  assert.equal(free.document.data.side, "아무거나");
  table(`${P}sides`).set("a", { name: "빛" });
  table(`${P}classes`).set("x", { name: "인간" });
  assert.equal(
    await refusal(sheet.save(ctx, { data: { ...data, side: "어둠" } })),
    "invalid_input",
  );
  const chosen = await sheet.save(ctx, {
    data: { ...data, side: "빛", class: "인간" },
  });
  assert.deepEqual(
    [chosen.document.data.side, chosen.document.data.class],
    ["빛", "인간"],
  );
  // A value the character already has stays when the list changes.
  table(`${P}sides`).delete("a");
  table(`${P}sides`).set("b", { name: "그림자" });
  const kept = await sheet.save(ctx, {
    id: chosen.document.id,
    data: { ...data, name: "둘", side: "빛", class: "인간" },
  });
  assert.equal(kept.document.data.side, "빛");
});

test("a 소속 or 종족 with a level is picked only by members of that level (si_auth)", async () => {
  const { ctx, table } = fakeCtx();
  const data = { name: "하나", type: "main", state: "editing" };
  table(`${P}sides`).set("a", { name: "빛" });
  table(`${P}sides`).set("b", { name: "왕실", level: 5 });
  // A member is level 2 until the owner sets another.
  assert.equal(
    await refusal(sheet.save(ctx, { data: { ...data, side: "왕실" } })),
    "invalid_input",
  );
  table(`${P}members`).set("m-1", { level: 5 });
  const royal = await sheet.save(ctx, { data: { ...data, side: "왕실" } });
  assert.equal(royal.document.data.side, "왕실");
});

test("a member's first character is their 대표, with its 두상·흉상·전신, deleted only before approval", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}profiles`).set("m-1", { nick: "앨리스" });
  const data = {
    name: "하나",
    type: "main",
    state: "editing",
    image: "https://example.com/thumb.png",
    head: "https://example.com/head.png",
    body: "https://example.com/body.png",
  };
  const first = await sheet.save(ctx, { data });
  assert.equal(
    table(`${P}profiles`).get("m-1").mainCharacter,
    first.document.id,
  );
  assert.deepEqual(
    ["image", "head", "body"].map((key) => first.document.data[key]),
    [data.image, data.head, data.body],
  );
  // The second does not take the 대표 over.
  await sheet.save(ctx, { data: { ...data, name: "둘" } });
  assert.equal(
    table(`${P}profiles`).get("m-1").mainCharacter,
    first.document.id,
  );
  // A sheet that leaves a picture out keeps it.
  const { image, head, body, ...rest } = data;
  const kept = await sheet.save(ctx, {
    id: first.document.id,
    revision: first.document.revision,
    data: rest,
  });
  assert.equal(kept.document.data.body, body);
  table(`${P}characters`).set(first.document.id, {
    ...table(`${P}characters`).get(first.document.id),
    state: "approved",
  });
  assert.equal(
    await refusal(sheet.remove(ctx, { id: first.document.id })),
    "approved",
  );
});

test("a members-only board group keeps its boards to its members and moderators", async () => {
  const { ctx, table } = fakeCtx();
  // Only the group's board, not the site's 로그.
  table(`${P}boards`).delete("default");
  table(`${P}board_groups`).set("staff", { name: "운영", membersOnly: true });
  table(`${P}boards`).set("plans", {
    name: "계획",
    kind: "text",
    group: "staff",
    listLevel: 2,
    readLevel: 2,
    writeLevel: 2,
    commentLevel: 2,
  });
  table(`${P}members`).set("m-1", { level: 2, role: "member" });
  const listed = async () =>
    (
      await nativeRead(ctx, { collection: `${P}boards`, operation: "list" })
    ).documents.map((row) => row.id);
  assert.deepEqual(await listed(), []);
  assert.equal(
    await refusal(posts.write(ctx, { data: { board: "plans", text: "안녕" } })),
    "access_denied",
  );
  table(`${P}members`).get("m-1").groups = ["staff"];
  assert.deepEqual(await listed(), ["plans"]);
  await posts.write(ctx, { data: { board: "plans", text: "안녕" } });
  // Moderators reach every group; an open group is everyone's.
  table(`${P}members`).set("m-1", { level: 2, role: "moderator" });
  assert.deepEqual(await listed(), ["plans"]);
  table(`${P}board_groups`).get("staff").membersOnly = false;
  table(`${P}members`).set("m-1", { level: 2, role: "member" });
  assert.deepEqual(await listed(), ["plans"]);
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
  const { ctx, table } = fakeCtx({ now: at });
  approvedCharacter(table);
  table(`${P}wallets`).set("m-1", { balance: 100 });
  table(`${P}items`).set("lunch", {
    name: "점심",
    price: 1,
    display: { fromHour: 11, untilHour: 14 },
  });
  const args = { item: "lunch", character: "hero" };
  assert.equal(await refusal(buy(ctx, args)), "not_on_display");
  ctx.now = Date.parse("2030-01-05T03:00:00Z"); // 12:00 in Korea
  assert.equal(await refusal(buy(ctx, args)), null);
});

test("a character's viewer shows its experience to members, and its inventory and money when the owner allows", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}characters`).set("hero", { owner: "m-2", name: "용사" });
  table(`${P}history`).set("h1", {
    owner: "m-2",
    kind: "exp",
    character: "hero",
    at: 5,
    expDelta: 10,
    exp: 10,
    memo: "첫 모험",
  });
  table(`${P}history`).set("h2", {
    owner: "m-2",
    kind: "exp",
    character: "other",
    at: 6,
    expDelta: 3,
    exp: 3,
  });
  table(`${P}history`).set("h3", {
    owner: "m-2",
    kind: "buy",
    character: "hero",
    at: 7,
  });
  table(`${P}inventory`).set("i1", {
    owner: "m-2",
    item: "potion",
    character: "hero",
  });
  table(`${P}items`).set("potion", {
    name: "물약",
    image: "https://example.com/p.png",
  });
  table(`${P}wallets`).set("m-2", { balance: 42 });
  const hidden = await characterSheet(ctx, { character: "hero" });
  assert.deepEqual(hidden.exp, [
    { at: 5, delta: 10, exp: 10, memo: "첫 모험" },
  ]);
  assert.equal(hidden.inventory, null);
  assert.equal(hidden.balance, null);
  table(`${P}settings`).set("community", {
    viewerInventory: true,
    viewerMoney: true,
  });
  const shown = await characterSheet(ctx, { character: "hero" });
  assert.deepEqual(shown.inventory, [
    { name: "물약", image: "https://example.com/p.png" },
  ]);
  assert.equal(shown.balance, 42);
  assert.equal(
    await refusal(characterSheet(ctx, { character: "nobody" })),
    "no_character",
  );
});

test("a board search finds titles, text and nicknames among posts the reader may read", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  table(`${P}profiles`).set("m-2", { nick: "보라돌이" });
  table(`${P}logs`).set("a", {
    board: "free",
    owner: "m-2",
    title: "봄 소풍",
    text: "",
  });
  table(`${P}logs`).set("b", {
    board: "free",
    owner: "m-2",
    text: "여름 바다",
  });
  table(`${P}logs`).set("c", {
    board: "free",
    owner: "m-2",
    text: "봄 비밀",
    secret: true,
  });
  const found = async (text) =>
    (await posts.search(ctx, { board: "free", text })).documents
      .map((row) => row.id)
      .sort();
  assert.deepEqual(await found("봄"), ["a"]);
  assert.deepEqual(await found("바다"), ["b"]);
  assert.deepEqual(await found("보라"), ["a", "b"]);
  assert.equal(
    await refusal(posts.search(ctx, { board: "free", text: " " })),
    "invalid_input",
  );
});

test("members' new posts are announced to open pages, guests' are not", async () => {
  const { ctx, table, sent } = fakeCtx();
  table(`${P}boards`).set("free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    secret: "optional",
  });
  await join(ctx, { nick: "앨리스" });
  await posts.write(ctx, { data: { board: "free", text: "회원 글" } });
  assert.deepEqual(
    sent
      .filter((message) => message.topic)
      .map((message) => message.data.board),
    ["free"],
  );
  ctx.member = null;
  await posts.write(ctx, {
    data: { board: "free", text: "손님 글" },
    guest: { name: "길손", password: "pass1234" },
  });
  assert.equal(sent.filter((message) => message.topic).length, 1);
});

test("long questions and search results stay within a function's 64 KiB result", async () => {
  const { ctx, table } = fakeCtx();
  for (const [id, kind] of [
    ["qna", "qna"],
    ["free", "text"],
  ])
    table(`${P}boards`).set(id, {
      name: id,
      kind,
      listLevel: 1,
      readLevel: 1,
    });
  const long = `<p>${"가".repeat(11_000)}</p>`;
  for (let n = 0; n < 12; n++) {
    table(`${P}logs`).set(`q${n}`, {
      board: "qna",
      owner: "m-1",
      title: `질문 ${n}`,
      format: "html",
      text: long,
    });
    table(`${P}logs`).set(`f${n}`, {
      board: "free",
      owner: "m-1",
      title: `바다 ${n}`,
      format: "html",
      text: long,
    });
  }
  const size = (value) => Buffer.byteLength(JSON.stringify(value));
  // Whole questions, as many as fit; the next page starts where it stopped.
  const seen = [];
  let after = null;
  do {
    const page = await posts.questions(ctx, { board: "qna", after });
    assert.ok(size(page) < 64 * 1024, `${size(page)} bytes`);
    assert.ok(page.documents.length >= 1);
    assert.ok(page.documents.every((row) => row.data.text === long));
    seen.push(...page.documents.map((row) => row.id));
    after = page.nextCursor;
  } while (after);
  assert.equal(new Set(seen).size, 12);
  // Skipping ahead keeps only the cursor.
  assert.deepEqual(
    Object.keys(
      await posts.questions(ctx, { board: "qna", size: 20, cursorOnly: true }),
    ),
    ["nextCursor"],
  );
  // Search shows 300 characters of each, as the original's search does.
  const found = await posts.search(ctx, { board: "free", text: "바다" });
  assert.equal(found.documents.length, 12);
  assert.ok(size(found) < 64 * 1024);
  for (const row of found.documents) {
    assert.ok(row.data.text.length <= 301);
    assert.equal(row.data.truncated, true);
  }
});

test("a Q&A board lets guests ask in secret and open their question with its password", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("qna", {
    name: "문의",
    kind: "qna",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    commentLevel: 9,
    secret: "optional",
  });
  table(`${P}boards`).set("free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    secret: "optional",
  });
  ctx.member = null;
  const guest = { name: "길손", password: "pass1234" };
  assert.equal(
    await refusal(
      posts.write(ctx, {
        data: { board: "free", text: "?", secret: true },
        guest,
      }),
    ),
    "guest_secret",
  );
  const asked = (
    await posts.write(ctx, {
      data: { board: "qna", text: "환불되나요?", secret: true },
      guest,
    })
  ).document;
  const listed = (await posts.questions(ctx, { board: "qna" })).documents;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].data.locked, true);
  assert.equal(listed[0].data.text, undefined);
  assert.equal(
    await refusal(posts.open(ctx, { id: asked.id, password: "wrong" })),
    "guest_password",
  );
  const opened = await posts.open(ctx, { id: asked.id, password: "pass1234" });
  assert.equal(opened.document.data.text, "환불되나요?");
  assert.equal(
    await refusal(posts.questions(ctx, { board: "free" })),
    "invalid_input",
  );
});

test("on a Q&A board only moderators and the owner answer", async () => {
  const { ctx, table } = fakeCtx();
  // Comments open to everyone, so only the board's kind keeps them out.
  table(`${P}boards`).set("qna", {
    name: "문의",
    kind: "qna",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    commentLevel: 1,
    secret: "optional",
  });
  table(`${P}logs`).set("ask", { board: "qna", text: "환불되나요?" });
  const answer = (guest) =>
    comments.write(ctx, {
      data: { logId: "ask", text: "답변" },
      ...(guest ? { guest } : {}),
    });
  // skin/board/qna/list.skin.php:85-87: the reply link is $is_admin's.
  assert.equal(await refusal(answer()), "answers_staff_only");
  ctx.member = null;
  assert.equal(
    await refusal(answer({ name: "길손", password: "pass1234" })),
    "answers_staff_only",
  );
  ctx.member = { id: "m-1" };
  table(`${P}members`).set("m-1", { role: "moderator" });
  assert.equal((await answer()).document.data.text, "답변");
  table(`${P}members`).set("m-1", { role: "member" });
  ctx.owner = true;
  assert.equal((await answer()).document.data.text, "답변");
});

test("a settlement is settled by a moderator, granting experience and money, then stays", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("calc", {
    name: "정산",
    kind: "settlement",
    categories: ["이벤트"],
  });
  table(`${P}characters`).set("hero", { owner: "m-1", name: "용사" });
  table(`${P}members`).set("m-1", { level: 2, role: "member" });
  const request = (
    await posts.write(ctx, {
      data: {
        board: "calc",
        category: "이벤트",
        text: "참여했어요",
        character: "hero",
      },
    })
  ).document;
  assert.equal(
    await refusal(
      posts.settle(ctx, { id: request.id, state: "정산완료", exp: 5 }),
    ),
    "access_denied",
  );
  table(`${P}members`).set("m-2", { level: 2, role: "moderator" });
  ctx.member = { id: "m-2" };
  await posts.settle(ctx, {
    id: request.id,
    state: "정산완료",
    exp: 5,
    money: 30,
    memo: "수고하셨습니다",
  });
  assert.deepEqual(
    table(`${P}logs`).get(request.id).settlement.state,
    "정산완료",
  );
  assert.equal(table(`${P}character_state`).get("hero").exp, 5);
  assert.equal(table(`${P}wallets`).get("m-1").balance, 30);
  const kinds = [...table(`${P}history`).values()]
    .map((row) => row.kind)
    .sort();
  assert.deepEqual(kinds, ["exp", "settle"]);
  // The reply says what was given.
  assert.match(
    [...table(`${P}comments`).values()][0].text,
    /\[정산완료\] 경험치 \+5 \+30 아보 수고하셨습니다/,
  );
  // The author can no longer change or delete it.
  ctx.member = { id: "m-1" };
  assert.equal(
    await refusal(
      posts.write(ctx, {
        id: request.id,
        data: { ...request.data, text: "고침" },
      }),
    ),
    "settled",
  );
  assert.equal(await refusal(posts.remove(ctx, { id: request.id })), "settled");
  // Only the original's two states (caculate/write_comment.php).
  ctx.member = { id: "m-2" };
  assert.equal(
    await refusal(posts.settle(ctx, { id: request.id, state: "보류" })),
    "invalid_input",
  );
});

test("a board search reaches every post at once and pages what it finds", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  table(`${P}characters`).set("c-1", { name: "보물찾기단" });
  for (let n = 0; n < 650; n += 1)
    table(`${P}logs`).set(`p${n}`, {
      board: "free",
      owner: "m-1",
      text: n === 649 ? "아주 오래된 보물" : n < 25 ? `조개 ${n}` : `글 ${n}`,
      ...(n === 300 ? { character: "c-1" } : {}),
    });
  const ids = (page) => page.documents.map((row) => row.id).sort();
  // The oldest post, and one written as a character named so.
  assert.deepEqual(
    ids(await posts.search(ctx, { board: "free", text: "보물" })),
    ["p300", "p649"],
  );
  // 25 finds: 20, then 5.
  const first = await posts.search(ctx, { board: "free", text: "조개" });
  assert.equal(first.documents.length, 20);
  const second = await posts.search(ctx, {
    board: "free",
    text: "조개",
    after: first.nextCursor,
  });
  assert.equal(second.documents.length, 5);
  assert.equal(second.nextCursor, null);
});

test("the owner edits any character fully, outside the member's periods and limit", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}settings`).set("community", {
    characterCreation: false,
    characterEditing: false,
    characterLimit: 1,
  });
  table(`${P}sides`).set("east", { name: "동쪽" });
  for (const [code, data] of [
    ["age", { label: "나이", type: "select", options: ["10", "20"] }],
    ["diary", { label: "일기", type: "textarea", visibility: "owner" }],
    ["memo", { label: "메모", type: "text", visibility: "admin" }],
    ["art", { label: "전신", type: "image", required: true }],
  ])
    table(`${P}character_fields`).set(code, data);
  const owner = { ...ctx, member: null, owner: true };
  // adm/character_form_update.php saves every field, type and state.
  const saved = await sheet.save(owner, {
    id: "rival",
    data: {
      name: "새 이름",
      side: "동쪽",
      class: "",
      profile: "운영자가 고침",
      image: "https://example.com/rival.png",
      type: "npc",
      state: "submitted",
      fields: { age: "20", diary: "비밀", memo: "확인" },
    },
  });
  assert.deepEqual(table(`${P}characters`).get("rival"), {
    owner: "m-2",
    name: "새 이름",
    side: "동쪽",
    class: "",
    profile: "운영자가 고침",
    image: "https://example.com/rival.png",
    type: "npc",
    state: "submitted",
    fields: { age: "20", diary: "비밀", memo: "확인" },
  });
  assert.equal(saved.document.data.fields.memo, "확인");
  // Approving from the form approves the official record too.
  await sheet.save(owner, {
    id: "rival",
    data: { name: "새 이름", state: "approved" },
  });
  assert.equal(table(`${P}character_state`).get("rival").approved, true);
  assert.equal(table(`${P}character_state`).get("rival").owner, "m-2");
  assert.equal(table(`${P}characters`).get("rival").fields.memo, "확인");
  // Values are checked as a member's: options, the 소속 list, lengths.
  for (const data of [
    { name: "x", fields: { age: "30" } },
    { name: "x", fields: { missing: "1" } },
    { name: "x", state: "deleted" },
    { name: "x", type: "test" },
  ])
    assert.notEqual(
      await refusal(sheet.save(owner, { id: "rival", data })),
      null,
    );
  assert.equal(
    await refusal(
      sheet.save(owner, { id: "rival", data: { name: "x", side: "서쪽" } }),
    ),
    "invalid_input",
  );
  await assert.rejects(sheet.save(owner, { id: "rival", data: { name: "" } }));
  // A member still edits only their own.
  assert.equal(
    await refusal(sheet.save(ctx, { id: "rival", data: { name: "탈취" } })),
    "not_owned",
  );
  assert.equal(await refusal(sheet.remove(ctx, { id: "rival" })), "not_owned");
});

test("the owner registers a character for a member named by nickname", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}settings`).set("community", {
    characterCreation: false,
    characterLimit: 1,
  });
  const owner = { ...ctx, member: null, owner: true };
  const data = { name: "선물", type: "main", state: "approved" };
  for (const nick of ["없는사람", "", null])
    assert.equal(await refusal(sheet.save(owner, { nick, data })), "no_member");
  // 카도 already has Rival and creation is closed: neither stops the owner.
  const { document } = await sheet.save(owner, { nick: "카도", data });
  assert.equal(table(`${P}characters`).get(document.id).owner, "m-2");
  assert.equal(table(`${P}character_state`).get(document.id).approved, true);
  assert.equal(table(`${P}character_state`).get(document.id).owner, "m-2");
  // Their first: it becomes their main character, as ch_id is set.
  assert.equal(table(`${P}profiles`).get("m-2").mainCharacter, document.id);
  table(`${P}profiles`).set("m-1", { nick: "아보", mainCharacter: "hero" });
  await sheet.save(owner, { nick: "아보", data });
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, "hero");
  // Members still meet the switches.
  assert.equal(
    await refusal(sheet.save(ctx, { data: { name: "몰래" } })),
    "creation_closed",
  );
});

test("the owner deletes any character with what character_delete.php removes", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}profiles`).set("m-1", { nick: "아보", mainCharacter: "hero" });
  for (let n = 0; n < 30; n++)
    table(`${P}wardrobe`).set(`w${n}`, { owner: "m-1", character: "hero" });
  table(`${P}relations`).set("r", {
    owner: "m-2",
    character: "rival",
    target: "hero",
  });
  table(`${P}inventory`).set("cake", {
    owner: "m-1",
    item: "cake",
    character: "hero",
  });
  table(`${P}couples`).set("c", { first: "hero", second: "rival" });
  const owner = { ...ctx, member: null, owner: true };
  const first = await sheet.remove(owner, { id: "hero" });
  assert.equal(first.done, false);
  assert.equal(table(`${P}characters`).get("hero").deleted, true);
  let steps = 1;
  while (!(await sheet.remove(owner, { id: "hero" })).done) steps++;
  assert.ok(steps < 5);
  assert.equal(table(`${P}characters`).has("hero"), false);
  assert.equal(
    [...table(`${P}wardrobe`).values()].some((row) => row.character === "hero"),
    false,
  );
  assert.equal(table(`${P}relations`).has("r"), false);
  assert.equal(table(`${P}couples`).has("c"), false);
  assert.equal(table(`${P}character_state`).has("hero"), false);
  assert.equal(table(`${P}inventory`).get("cake").character, null);
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, null);
  assert.equal(table(`${P}characters`).has("rival"), true);
});

test("the owner moves a character to another member, with what it keeps", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}settings`).set("community", { characterLimit: 1 });
  table(`${P}profiles`).set("m-1", { nick: "아보", mainCharacter: "hero" });
  for (let n = 0; n < 20; n++)
    table(`${P}wardrobe`).set(`w${n}`, { owner: "m-1", character: "hero" });
  table(`${P}relations`).set("r", {
    owner: "m-1",
    character: "hero",
    target: "rival",
  });
  table(`${P}inventory`).set("linked", {
    owner: "m-1",
    item: "cake",
    character: "hero",
  });
  table(`${P}inventory`).set("loose", {
    owner: "m-1",
    item: "cake",
    character: null,
  });
  const owner = { ...ctx, member: null, owner: true };
  assert.equal(
    await refusal(sheet.move(ctx, { id: "hero", nick: "카도" })),
    "access_denied",
  );
  assert.equal(
    await refusal(sheet.move(owner, { id: "hero", nick: "없는사람" })),
    "no_member",
  );
  assert.equal(
    await refusal(sheet.move(owner, { id: "gone", nick: "카도" })),
    "document_not_found",
  );
  // 카도 already has Rival: the owner is not held to the limit.
  const first = await sheet.move(owner, { id: "hero", nick: "카도" });
  assert.equal(first.done, false);
  assert.equal(first.document.data.owner, "m-2");
  assert.equal(
    (await sheet.move(owner, { id: "hero", nick: "카도" })).done,
    true,
  );
  assert.equal(table(`${P}characters`).get("hero").owner, "m-2");
  assert.equal(table(`${P}character_state`).get("hero").owner, "m-2");
  assert.ok(
    [...table(`${P}wardrobe`).values()].every((row) => row.owner === "m-2"),
  );
  assert.equal(table(`${P}relations`).get("r").owner, "m-2");
  assert.equal(table(`${P}inventory`).get("linked").owner, "m-2");
  assert.equal(table(`${P}inventory`).get("loose").owner, "m-1");
  assert.equal(table(`${P}profiles`).get("m-1").mainCharacter, null);
  assert.equal(table(`${P}profiles`).get("m-2").mainCharacter, "hero");
  // The new owner uses it; the former one no longer can.
  assert.equal(
    await refusal(
      outfit(ctx, {
        character: "hero",
        name: "옷",
        image: "https://example.com/o.png",
      }),
    ),
    "not_owned",
  );
  ctx.member = { id: "m-2" };
  await wear(ctx, { character: "hero", outfit: "w0" });
  assert.equal(table(`${P}characters`).get("hero").outfit, "w0");
});

test("기타 항목명 설정 names money, experience, 소속 and 종족 for pages and refusals", async () => {
  const { NAME_DEFAULTS, subject } =
    await import("../dist/_naru/modules/shared.js");
  const pages = await import("../dist/app/names.js");
  // The pages show the same defaults before the site's frame arrives.
  assert.deepEqual(pages.NAME_DEFAULTS, NAME_DEFAULTS);
  const { ctx, table } = fakeCtx();
  assert.deepEqual((await site(ctx)).names, NAME_DEFAULTS);
  table(`${P}settings`).set("community", {
    moneyName: "골드",
    moneyUnit: "G",
    expName: "포인트",
    sideTitle: "",
    classTitle: "  ",
    rankName: " ",
  });
  const { names } = await site(ctx);
  assert.equal(names.moneyUnit, "G");
  // An empty 소속 or 종족 hides it; an empty name for the rest is the default.
  assert.equal(names.sideTitle, "");
  assert.equal(names.classTitle, "");
  assert.equal(names.rankName, "랭킹");
  assert.equal(
    await gacha(ctx).catch((error) => error.message),
    "골드가 모자랍니다.",
  );
  assert.equal(subject("포인트"), "포인트가");
  assert.equal(subject("경험"), "경험이");
  assert.equal(subject("XP"), "XP이(가)");
  assert.equal(
    pages.rename("경험치·아보 지급 (네오 아보카도)", names),
    "포인트·골드 지급 (네오 아보카도)",
  );
});

test("멤버공개 is locked for visitors, and 익명 hides its author from all but them and the staff", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}boards`).set("default", {
    ...table(`${P}boards`).get("default"),
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    anonymous: true,
  });
  const post = (data) =>
    posts.write(ctx, {
      data: { board: "default", image: "https://example.com/a.png", ...data },
    });
  const hidden = (
    await post({ text: "멤버만", membersOnly: true, adult: true, fold: true })
  ).document;
  const masked = (
    await post({ text: "누가 썼을까", anonymous: true, character: "hero" })
  ).document;
  await comments.write(ctx, { data: { logId: hidden.id, text: "댓글" } });
  // A visitor: the 멤버공개 post shows its number and marks, locked.
  ctx.member = null;
  const seen = (await gate(ctx, "logs", "get", { id: hidden.id })).document
    .data;
  assert.equal(seen.locked, true);
  assert.equal(seen.adult, true);
  assert.equal(seen.image, undefined);
  assert.equal(seen.text, undefined);
  assert.equal(seen.owner, null);
  // ...and none of its comments.
  assert.deepEqual(
    (
      await gate(ctx, "comments", "list", {
        options: { filter: { logId: hidden.id } },
      })
    ).documents,
    [],
  );
  // Another member: the 익명 post names no one.
  ctx.member = { id: "m-2" };
  const other = (await gate(ctx, "logs", "get", { id: masked.id })).document
    .data;
  assert.deepEqual(
    [other.owner, other.speaker, other.character],
    [null, undefined, undefined],
  );
  assert.equal(other.anonymous, true);
  // Nor can they ask which posts m-1 wrote, nor find it by name.
  assert.equal(
    await refusal(
      gate(ctx, "logs", "list", {
        options: {
          filter: { board: "default" },
          where: { eq: ["owner", "m-1"] },
        },
      }),
    ),
    "INVALID_REQUEST",
  );
  const found = await posts.search(ctx, { board: "default", text: "아보" });
  assert.equal(
    found.documents.some((row) => row.id === masked.id),
    false,
  );
  // Its author sees it as theirs, and lists it in 로그내역.
  ctx.member = { id: "m-1" };
  const own = (await gate(ctx, "logs", "get", { id: masked.id })).document.data;
  assert.equal(own.owner, "m-1");
  assert.deepEqual(
    (await posts.mine(ctx)).documents.map((row) => row.id).sort(),
    [hidden.id, masked.id].sort(),
  );
  // A guest cannot post 멤버공개, 19금 or 익명.
  ctx.member = null;
  const guest = (
    await posts.write(ctx, {
      guest: { name: "손님", password: "secret-1" },
      data: {
        board: "default",
        image: "https://example.com/g.png",
        membersOnly: true,
        anonymous: true,
      },
    })
  ).document;
  assert.deepEqual(
    [guest.data.membersOnly, guest.data.anonymous],
    [false, false],
  );
});

test("화폐관리 sends money to a character's owner, records both sides and tells them", async () => {
  const { ctx, table, sent: live } = fakeCtx();
  table(`${P}profiles`).set("m-1", { nick: "나" });
  table(`${P}profiles`).set("m-2", { nick: "친구" });
  table(`${P}characters`).set("theirs", { owner: "m-2", name: "친구캐" });
  table(`${P}characters`).set("mine", { owner: "m-1", name: "내캐" });
  table(`${P}wallets`).set("m-1", { balance: 1500 });
  assert.equal(
    await refusal(money.send(ctx, { character: "theirs", amount: 2000 })),
    "not_enough",
  );
  assert.equal(
    await refusal(money.send(ctx, { character: "mine", amount: 10 })),
    "no_recipient",
  );
  assert.equal(
    await refusal(money.send(ctx, { character: "theirs", amount: 0 })),
    "invalid_input",
  );
  const result = await money.send(ctx, { character: "theirs", amount: 1000 });
  assert.deepEqual(result, { balance: 500, nick: "친구" });
  assert.equal(table(`${P}wallets`).get("m-2").balance, 1000);
  const [notice] = [...table(`${P}messages`).values()];
  assert.equal(notice.body, "나님이 1,000 아보 보냈습니다.");
  assert.deepEqual(live.at(-1), { member: "m-2", data: { unread: true } });
  // The ledger shows money only: 획득 and 사용.
  table(`${P}history`).set("exp-only", {
    owner: "m-1",
    kind: "exp",
    at: 1,
    expDelta: 5,
  });
  const ledger = await money.ledger(ctx);
  assert.deepEqual(
    ledger.documents.map((row) => [row.data.kind, row.data.delta]),
    [["moneySent", -1000]],
  );
  ctx.member.id = "m-2";
  assert.deepEqual(
    (await money.ledger(ctx)).documents.map((row) => row.data.memo),
    ["[받음] 나님"],
  );
});

test("관심 keeps a member's favourite posts, theirs alone, and 경고내역 shows their warnings", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}members`).set("m-1", { warnings: 2, warningNote: "도배" });
  const status = await membership(ctx);
  assert.deepEqual([status.warnings, status.warningNote], [2, "도배"]);
  assert.deepEqual(await posts.favorite(ctx, { id: "thread" }), {
    favorite: true,
  });
  assert.deepEqual(
    (await posts.favorites(ctx)).documents.map((row) => row.id),
    ["thread"],
  );
  // Another member reads the profile without them.
  const shown = profileRule.present(
    { member: { id: "m-2" } },
    { document: { id: "m-1", data: table(`${P}profiles`).get("m-1") } },
  );
  assert.equal(shown.favorites, undefined);
  assert.deepEqual(await posts.favorite(ctx, { id: "thread" }), {
    favorite: false,
  });
  assert.deepEqual((await posts.favorites(ctx)).documents, []);
  assert.equal(
    await refusal(posts.favorite(ctx, { id: "missing" })),
    "document_not_found",
  );
});

test("the site's frame says what a character's page shows, and the owner is not 현재접속자", async () => {
  const { ctx, table } = fakeCtx();
  assert.deepEqual((await site(ctx)).viewer, {
    exp: true,
    rank: true,
    stats: true,
    titles: true,
    closet: true,
  });
  table(`${P}settings`).set("profile", { showStats: false, showCloset: false });
  assert.deepEqual((await site(ctx)).viewer, {
    exp: true,
    rank: true,
    stats: false,
    titles: true,
    closet: false,
  });
  table(`${P}profiles`).set("m-1", { nick: "운영자" });
  ctx.owner = true;
  await presence.seen(ctx, { where: "home" });
  assert.deepEqual((await presence.online(ctx)).members, []);
  ctx.owner = false;
  await presence.seen(ctx, { where: "home" });
  assert.equal((await presence.online(ctx)).members.length, 1);
});

test("the owner grants money and experience to one or all, and ranks add their bonus points", async () => {
  const { ctx, table } = fakeCtx();
  for (const [id, nick] of [
    ["m-1", "하나"],
    ["m-2", "둘"],
  ])
    table(`${P}profiles`).set(id, { nick });
  table(`${P}wallets`).set("m-2", { balance: 5 });
  table(`${P}characters`).set("hero", {
    owner: "m-1",
    name: "용사",
    state: "approved",
  });
  table(`${P}characters`).set("draft", {
    owner: "m-2",
    name: "초안",
    state: "editing",
  });
  table(`${P}levels`).set("lv1", { name: "견습", exp: 0, bonusPoints: 0 });
  table(`${P}levels`).set("lv2", { name: "숙련", exp: 100, bonusPoints: 3 });
  const call = (args) => grants.grant(ctx, { memo: "이벤트", ...args });
  assert.equal(
    await refusal(call({ kind: "money", target: "all", value: 10 })),
    "owner_only",
  );
  ctx.owner = true;
  // Everyone's money, but never below nothing.
  const all = await call({ kind: "money", target: "all", value: -10 });
  assert.deepEqual([all.done, all.granted, all.skipped], [true, 0, 2]);
  await call({ kind: "money", target: "all", value: 10 });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 10);
  assert.equal(table(`${P}wallets`).get("m-2").balance, 15);
  await call({ kind: "money", target: "one", name: "둘", value: -15 });
  assert.equal(table(`${P}wallets`).get("m-2").balance, 0);
  assert.equal(
    await refusal(
      call({ kind: "money", target: "one", name: "없음", value: 1 }),
    ),
    "no_member",
  );
  // Experience to every approved character: reaching 숙련 adds 3 points,
  // falling back takes them away.
  await call({ kind: "exp", target: "all", value: 120 });
  assert.equal(table(`${P}character_state`).get("hero").exp, 120);
  assert.equal(table(`${P}character_state`).get("hero").points, 3);
  assert.equal(table(`${P}character_state`).has("draft"), false);
  await call({ kind: "exp", target: "one", name: "용사", value: -50 });
  assert.equal(table(`${P}character_state`).get("hero").points, 0);
  const memos = [...table(`${P}history`).values()].filter(
    (row) => row.actor === "grant",
  );
  assert.ok(memos.every((row) => row.memo === "이벤트"));
});

test("money to everyone leaves out level-1 members, and items go out by count a part at a time", async () => {
  const { ctx, table } = fakeCtx();
  ctx.owner = true;
  for (const [id, nick] of [
    ["m-1", "하나"],
    ["m-2", "둘"],
  ])
    table(`${P}profiles`).set(id, { nick });
  // adm/point_update.php:18 gives to mb_level > 1 only.
  table(`${P}members`).set("m-2", { role: "member", level: 1 });
  const money = await grants.grant(ctx, {
    kind: "money",
    target: "all",
    value: 10,
  });
  assert.deepEqual([money.granted, money.skipped], [1, 0]);
  assert.equal(table(`${P}wallets`).get("m-1").balance, 10);
  assert.equal(table(`${P}wallets`).has("m-2"), false);

  for (const [id, owner, state] of [
    ["a", "m-1", "approved"],
    ["b", "m-2", "approved"],
    ["c", "m-2", "editing"],
  ])
    table(`${P}characters`).set(id, { owner, name: `캐릭${id}`, state });
  table(`${P}items`).set("gem", { name: "보석" });
  const item = (args) =>
    grants.grant(ctx, { kind: "item", item: "gem", memo: "선물", ...args });
  for (const args of [
    { target: "one", name: "캐릭a", value: 0 },
    { target: "one", name: "캐릭a", value: 101 },
    { target: "one", name: "캐릭a", value: 2, after: "x" },
  ])
    assert.equal(await refusal(item(args)), "invalid_input");
  assert.equal(
    await refusal(item({ target: "one", name: "캐릭a", value: 1, item: "x" })),
    "no_item",
  );
  assert.equal(
    await refusal(item({ target: "one", name: "없음", value: 1 })),
    "no_character",
  );
  const owned = (character) =>
    [...table(`${P}inventory`).values()].filter(
      (row) => row.item === "gem" && row.character === character,
    );
  // To one character: 30 take two calls inside the write budget.
  let result = await item({ target: "one", name: "캐릭a", value: 30 });
  assert.equal(result.done, false);
  assert.equal(owned("a").length, 19);
  result = await item({
    target: "one",
    name: "캐릭a",
    value: 30,
    after: result.after,
  });
  assert.deepEqual([result.done, result.granted], [true, 1]);
  assert.equal(owned("a").length, 30);
  assert.deepEqual(owned("a")[0], {
    owner: "m-1",
    item: "gem",
    name: "보석",
    from: "admin",
    character: "a",
  });
  // To every approved character, 15 each, across calls.
  let after = null;
  let granted = 0;
  for (let calls = 0; ; calls += 1) {
    assert.ok(calls < 5);
    result = await item({ target: "all", value: 15, after });
    granted += result.granted;
    if (result.done) break;
    after = result.after;
  }
  assert.equal(granted, 2);
  assert.equal(owned("a").length, 45);
  assert.equal(owned("b").length, 15);
  assert.equal(owned("c").length, 0);
  const history = [...table(`${P}history`).values()].filter(
    (row) => row.kind === "grant",
  );
  assert.deepEqual(
    history.map((row) => [row.owner, row.character, row.count, row.memo]),
    [
      ["m-1", "a", 30, "선물"],
      ["m-1", "a", 15, "선물"],
      ["m-2", "b", 15, "선물"],
    ],
  );
});

test("items stay out of posts or 조합 as the owner marks them, and stats keep their minimum", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}items`).set("note", {
    name: "쪽지",
    effect: { type: "draw" },
    usableInPosts: false,
  });
  table(`${P}items`).set("stone", { name: "돌", craftMaterial: false });
  // Both flags start off (adm/item_form.php:217): an item without them is
  // kept out too.
  table(`${P}items`).set("plain", { name: "평범", effect: { type: "draw" } });
  table(`${P}inventory`).set("i-plain", {
    owner: "m-1",
    item: "plain",
    character: "hero",
    name: "평범",
  });
  table(`${P}inventory`).set("i-note", {
    owner: "m-1",
    item: "note",
    character: "hero",
    name: "쪽지",
  });
  table(`${P}inventory`).set("i-stone", {
    owner: "m-1",
    item: "stone",
    character: "hero",
    name: "돌",
  });
  const post = (data) =>
    gate(ctx, "logs", "add", {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "hero",
        ...data,
      },
    });
  assert.equal(await reasonOf(post({ item: "i-note" })), "not_usable");
  assert.equal(await reasonOf(post({ item: "i-plain" })), "not_usable");
  assert.equal(
    await reasonOf(post({ action: "combine", materials: ["i-plain"] })),
    "not_material",
  );
  assert.equal(
    await reasonOf(post({ action: "combine", materials: ["i-stone"] })),
    "not_material",
  );
  // A fresh character: st_min keeps a stat from starting below it.
  const fresh = fakeCtx();
  fresh.table(`${P}characters`).set("hero", { owner: "m-1", name: "Hero" });
  fresh.table(`${P}settings`).set("community", { initialStatPoints: 5 });
  fresh.table(`${P}stat_config`).set("hp", {
    name: "체력",
    initial: 0,
    max: 10,
    min: 3,
  });
  assert.equal(
    await refusal(
      allocateStats(fresh.ctx, { character: "hero", allocation: { hp: 1 } }),
    ),
    "below_minimum",
  );
  await allocateStats(fresh.ctx, { character: "hero", allocation: { hp: 3 } });
});

test("a readable site_main page takes the home's place, and is not an 안내 page", async () => {
  const { ctx, table } = fakeCtx();
  assert.equal((await site(ctx)).main, false);
  // Without a read level a page is everyone's, as the original's have none.
  table(`${P}content`).set("site_main", {
    name: "메인",
    body: "<p>환영합니다</p>",
  });
  table(`${P}content`).set("rules", {
    name: "규칙",
    body: "...",
    readLevel: 1,
  });
  assert.equal((await site(ctx)).main, true);
  assert.deepEqual(
    (await contentPages(ctx)).documents.map((row) => row.id),
    ["rules"],
  );
  ctx.member = null;
  assert.equal((await site(ctx)).main, true);
  assert.equal(
    (await contentPage(ctx, { id: "site_main" })).page.body,
    "<p>환영합니다</p>",
  );
});

test("joining refuses reserved nicknames and asks agreement to the owner's rules", async () => {
  const { ctx, table } = fakeCtx();
  // The original's cf_prohibit_id until the owner writes their own.
  assert.equal(await refusal(join(ctx, { nick: "운영자" })), "reserved_nick");
  assert.equal(await refusal(join(ctx, { nick: "ADMIN" })), "reserved_nick");
  table(`${P}settings`).set("community", {
    reservedNicks: "별, 달",
    stipulation: "서로 존중합니다.",
    characterNotice: "",
  });
  assert.equal(await refusal(join(ctx, { nick: "달" })), "reserved_nick");
  assert.equal(await refusal(join(ctx, { nick: "아보" })), "not_agreed");
  assert.equal(table(`${P}profiles`).has("m-1"), false);
  ctx.now += 1000;
  await join(ctx, { nick: "운영자", agreed: true });
  assert.equal(table(`${P}profiles`).get("m-1").nick, "운영자");
  assert.deepEqual(table(`${P}members`).get("m-1"), {
    role: "member",
    requestedAt: ctx.now,
    agreedAt: ctx.now,
  });
  // The site's owner may take a reserved word.
  ctx.member.id = "m-2";
  ctx.owner = true;
  table(`${P}settings`).set("community", { reservedNicks: "별" });
  await join(ctx, { nick: "별" });
  assert.equal(table(`${P}members`).get("m-2").agreedAt, undefined);
});

test("mail beyond a hundred messages stays in the 쪽지함, and a conversation pages back", async () => {
  const { ctx, table } = fakeCtx();
  const start = ctx.now;
  // 130 from m-2 long ago, then one each from 150 others.
  for (let n = 0; n < 130; n++)
    table(`${P}messages`).set(`old-${n}`, {
      from: "m-2",
      to: "m-1",
      body: `옛 쪽지 ${n}`,
      sentAt: start + n,
      readAt: null,
    });
  for (let n = 0; n < 150; n++)
    table(`${P}messages`).set(`new-${n}`, {
      from: `other-${n}`,
      to: "m-1",
      body: "안녕",
      sentAt: start + 1000 + n,
      readAt: start,
    });
  const listed = await conversations(ctx, { page: 31 });
  assert.equal(listed.total, 151);
  assert.deepEqual(
    listed.documents.map((entry) => [entry.partner, entry.count]),
    [["m-2", 130]],
  );
  assert.equal(listed.unreadCount, 130);
  assert.equal((await messageStatus(ctx)).unreadCount, 130);
  // The newest 50, oldest first; the newest 20 unread are read.
  const first = await conversation(ctx, { partner: "m-2" });
  assert.equal(first.documents.length, 50);
  assert.equal(first.documents[0].data.body, "옛 쪽지 80");
  assert.equal(first.documents.at(-1).data.body, "옛 쪽지 129");
  assert.equal(first.more, true);
  assert.equal(first.unreadCount, 110);
  assert.equal(first.documents.at(-1).data.readAt, ctx.now);
  assert.equal(first.documents.at(-21).data.readAt, null);
  const second = await conversation(ctx, {
    partner: "m-2",
    before: first.documents[0].data.sentAt,
  });
  assert.equal(second.documents[0].data.body, "옛 쪽지 30");
  assert.equal(second.documents.at(-1).data.body, "옛 쪽지 79");
  const third = await conversation(ctx, {
    partner: "m-2",
    before: second.documents[0].data.sentAt,
  });
  assert.equal(third.documents.length, 30);
  assert.equal(third.more, false);
  assert.equal(
    await refusal(conversation(ctx, { partner: "m-2", before: "soon" })),
    "invalid_input",
  );
});

test("a post may 탐색, and one that recorded 탐색 or 조합 stays but for the staff", async () => {
  const { ctx, table } = roleplayWorld({ roll: 0.1 });
  table(`${P}settings`).set("community", { exploreLimit: 3 });
  table(`${P}items`).set("herb", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Herb",
  });
  table(`${P}explore`).set("found", { item: "herb", weight: 1 });
  table(`${P}items`).set("letter", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Letter",
  });
  table(`${P}inventory`).set("i-letter", {
    owner: "m-1",
    item: "letter",
    name: "Letter",
    character: "hero",
  });
  const post = (data) =>
    posts.write(ctx, {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "hero",
        ...data,
      },
    });
  const explored = (await post({ action: "explore" })).document;
  assert.equal(explored.data.actions[0].type, "explore");
  assert.equal(explored.data.actions[0].item, "herb");
  assert.equal(await reasonOf(posts.remove(ctx, { id: explored.id })), "acted");
  // An item's use alone (wr_item_log) does not keep a post.
  const used = (await post({ item: "i-letter" })).document;
  assert.deepEqual(await posts.remove(ctx, { id: used.id }), { done: true });
  table(`${P}members`).set("m-1", { role: "moderator" });
  assert.deepEqual(await posts.remove(ctx, { id: explored.id }), {
    done: true,
  });
});

test("an edit adds dice and actions a post has none of yet, once", async () => {
  const { ctx, table } = roleplayWorld({ roll: 0.1 });
  table(`${P}settings`).set("community", { exploreLimit: 3 });
  table(`${P}items`).set("herb", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Herb",
  });
  table(`${P}explore`).set("found", { item: "herb", weight: 1 });
  const { document: plain } = await posts.write(ctx, {
    data: {
      board: "default",
      image: "https://example.com/p.png",
      text: "",
      character: "hero",
    },
  });
  const edit = async (row, data) =>
    (
      await posts.write(ctx, {
        id: row.id,
        data: { ...row.data, ...data },
      })
    ).document;
  const diced = await edit(plain, { dice: true });
  assert.equal(diced.data.dice, true);
  assert.deepEqual(diced.data.rolls, [1, 1]);
  Math.random = () => 0.9;
  assert.deepEqual((await edit(diced, { dice: true })).data.rolls, [1, 1]);
  Math.random = () => 0.1;
  const explored = await edit(diced, { action: "explore" });
  assert.equal(explored.data.actions[0].type, "explore");
  assert.equal(
    await reasonOf(edit(explored, { action: "explore" })),
    "already_acted",
  );
  // Another's post: a moderator edits it, but acts for no one.
  const { document: theirs } = await posts.write(ctx, {
    data: {
      board: "default",
      image: "https://example.com/p.png",
      text: "",
      character: "hero",
    },
  });
  table(`${P}members`).set("m-2", { role: "moderator" });
  ctx.member = { id: "m-2" };
  assert.equal(
    await reasonOf(edit(theirs, { action: "explore" })),
    "access_denied",
  );
  assert.equal((await edit(theirs, { dice: true })).data.dice, true);
});

test("a post with others' comments is no longer edited but by the staff (bo_count_modify)", async () => {
  const { ctx, table } = roleplayWorld();
  const { document: log } = await posts.write(ctx, {
    data: { board: "default", image: "https://example.com/p.png", text: "a" },
  });
  const edit = () =>
    posts.write(ctx, { id: log.id, data: { ...log.data, text: "b" } });
  await comments.write(ctx, { data: { logId: log.id, text: "mine" } });
  assert.equal(await reasonOf(edit()), "ok");
  ctx.member = { id: "m-2" };
  await comments.write(ctx, { data: { logId: log.id, text: "theirs" } });
  ctx.member = { id: "m-1" };
  assert.equal(await reasonOf(edit()), "commented");
  table(`${P}boards`).set("default", {
    ...table(`${P}boards`).get("default"),
    editLock: 2,
  });
  assert.equal(await reasonOf(edit()), "ok");
  table(`${P}boards`).set("default", {
    ...table(`${P}boards`).get("default"),
    editLock: 1,
  });
  table(`${P}members`).set("m-1", { role: "moderator" });
  assert.equal(await reasonOf(edit()), "ok");
});

test("boards pay for posts and comments, and take it back when they are deleted", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}boards`).set("default", {
    ...table(`${P}boards`).get("default"),
    name: "로그",
    writeReward: 10,
    commentReward: 3,
  });
  const { document: log } = await posts.write(ctx, {
    data: { board: "default", image: "https://example.com/p.png", text: "a" },
  });
  assert.equal(log.data.reward, 10);
  assert.equal(table(`${P}wallets`).get("m-1").balance, 10);
  ctx.member = { id: "m-2" };
  const { document: comment } = await comments.write(ctx, {
    data: { logId: log.id, text: "hi" },
  });
  await comments.write(ctx, { data: { logId: log.id, text: "again" } });
  assert.equal(table(`${P}wallets`).get("m-2").balance, 6);
  // An edit pays nothing more.
  await comments.write(ctx, {
    id: comment.id,
    data: { ...comment.data, text: "edited" },
  });
  assert.equal(table(`${P}wallets`).get("m-2").balance, 6);
  await comments.remove(ctx, { id: comment.id });
  assert.equal(table(`${P}wallets`).get("m-2").balance, 3);
  ctx.member = { id: "m-1" };
  await posts.remove(ctx, { id: log.id });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 0);
  // The remaining comment's reward went back with the post.
  assert.equal(table(`${P}wallets`).get("m-2").balance, 0);
  const memos = [...table(`${P}history`).values()]
    .filter((row) => row.kind === "board")
    .map((row) => [row.owner, row.delta, row.memo]);
  assert.deepEqual(memos, [
    ["m-1", 10, `로그 ${log.data.number} 글쓰기`],
    ["m-2", 3, `로그 ${log.data.number} 댓글쓰기`],
    ["m-2", 3, `로그 ${log.data.number} 댓글쓰기`],
    ["m-2", -3, `로그 ${log.data.number} 댓글삭제`],
    ["m-1", -10, `로그 ${log.data.number} 글삭제`],
    ["m-2", -3, `로그 ${log.data.number} 댓글삭제`],
  ]);
  // Guests are paid nothing.
  ctx.member = null;
  table(`${P}boards`).set("default", {
    ...table(`${P}boards`).get("default"),
    writeLevel: 1,
    listLevel: 1,
    readLevel: 1,
  });
  const { document: guestLog } = await posts.write(ctx, {
    data: { board: "default", image: "https://example.com/p.png", text: "g" },
    guest: { name: "길손", password: "pass1234" },
  });
  assert.equal(guestLog.data.reward, undefined);
});

test("a board search also finds posts by their comments' text and writers", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  table(`${P}boards`).set("other", {
    name: "다른",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  table(`${P}profiles`).set("m-2", { nick: "보라돌이" });
  table(`${P}logs`).set("a", { board: "free", owner: "m-3", text: "봄" });
  table(`${P}logs`).set("b", { board: "free", owner: "m-3", text: "여름" });
  table(`${P}logs`).set("c", {
    board: "free",
    owner: "m-3",
    text: "가을",
    secret: true,
  });
  table(`${P}logs`).set("d", { board: "other", owner: "m-3", text: "겨울" });
  table(`${P}logs`).set("e", { board: "free", owner: "m-3", text: "바다" });
  table(`${P}comments`).set("ca", { logId: "a", owner: "m-3", text: "바다" });
  table(`${P}comments`).set("cb", { logId: "b", owner: "m-2", text: "hi" });
  table(`${P}comments`).set("cc", { logId: "c", owner: "m-3", text: "바다" });
  table(`${P}comments`).set("cd", { logId: "d", owner: "m-3", text: "바다" });
  table(`${P}comments`).set("ce", { logId: "e", owner: "m-3", text: "바다" });
  table(`${P}comments`).set("cx", {
    logId: "b",
    owner: "m-2",
    text: "익명",
    anonymous: true,
  });
  const found = async (text) =>
    (await posts.search(ctx, { board: "free", text })).documents.map(
      (row) => row.id,
    );
  // e matched itself; c is secret; d is another board's.
  assert.deepEqual(await found("바다"), ["e", "a"]);
  assert.deepEqual(await found("보라"), ["b"]);
  // Comments are read 20 at a time after the posts, with their own cursor.
  for (let n = 0; n < 25; n += 1)
    table(`${P}comments`).set(`many-${n}`, {
      logId: "b",
      owner: "m-3",
      text: "파도",
    });
  const first = await posts.search(ctx, { board: "free", text: "파도" });
  assert.deepEqual(
    first.documents.map((row) => row.id),
    ["b"],
  );
  assert.match(first.nextCursor, /^comments:/);
  const second = await posts.search(ctx, {
    board: "free",
    text: "파도",
    after: first.nextCursor,
  });
  assert.deepEqual(
    second.documents.map((row) => row.id),
    ["b"],
  );
  assert.equal(second.nextCursor, null);
});

test("boards bound post and comment lengths, and the site's banned words are refused", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}boards`).set("default", {
    ...table(`${P}boards`).get("default"),
    writeMin: 3,
    writeMax: 10,
    commentMin: 2,
    commentMax: 5,
  });
  const post = (text, title = "") =>
    posts.write(ctx, {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        title,
        text,
      },
    });
  assert.equal(await reasonOf(post("ab")), "length");
  assert.equal(await reasonOf(post("01234567890")), "length");
  assert.equal(await reasonOf(post("abc")), "ok");
  const comment = (text) =>
    comments.write(ctx, { data: { logId: "thread", text } });
  assert.equal(await reasonOf(comment("a")), "length");
  assert.equal(await reasonOf(comment("abcdef")), "length");
  assert.equal(await reasonOf(comment("abc")), "ok");
  table(`${P}settings`).set("community", { bannedWords: "바보, Spam" });
  assert.equal(await reasonOf(post("hello", "바보야")), "banned_word");
  assert.equal(await reasonOf(post("buy SPAM")), "banned_word");
  assert.equal(await reasonOf(comment("spam")), "banned_word");
  // The staff are held to the words, not the lengths.
  table(`${P}members`).set("m-1", { role: "moderator" });
  assert.equal(await reasonOf(comment("a")), "ok");
  assert.equal(await reasonOf(comment("spam")), "banned_word");
});

test("the owner's comments carry the admin mark, and adult members are told so", async () => {
  const { ctx, table } = roleplayWorld();
  ctx.owner = true;
  const { document: marked } = await comments.write(ctx, {
    data: { logId: "thread", text: "공지" },
  });
  assert.equal(marked.data.admin, true);
  ctx.owner = false;
  const { document: plain } = await comments.write(ctx, {
    data: { logId: "thread", text: "회원" },
  });
  assert.equal(plain.data.admin, undefined);
  assert.equal((await membership(ctx)).adult, false);
  table(`${P}members`).set("m-1", { adult: true });
  assert.equal((await membership(ctx)).adult, true);
});

test("the board rule lets comments as long as the comments function does", async () => {
  const { ctx } = roleplayWorld();
  const write = (text) =>
    canWrite(ctx, {
      collection: `${P}comments`,
      operation: "create",
      before: null,
      after: {
        id: "c-new",
        data: { logId: "thread", owner: "m-1", text, dice: false },
      },
    });
  assert.equal(await write("가".repeat(2000)), true);
  assert.equal(await write("가".repeat(2001)), false);
});

test("a settlement pays once and not its own moderator; calls reach a member once a post; tags don't reveal 멤버공개", async () => {
  const { ctx, table, sent } = fakeCtx();
  table(`${P}boards`).set("calc", {
    name: "정산",
    kind: "settlement",
    categories: ["이벤트"],
  });
  table(`${P}characters`).set("hero", { owner: "m-1", name: "용사" });
  table(`${P}members`).set("m-2", { level: 2, role: "moderator" });
  const request = (
    await posts.write(ctx, {
      data: {
        board: "calc",
        category: "이벤트",
        text: "참여",
        character: "hero",
      },
    })
  ).document;
  ctx.member = { id: "m-2" };
  await posts.settle(ctx, { id: request.id, state: "정산완료", money: 10 });
  assert.equal(
    await refusal(
      posts.settle(ctx, { id: request.id, state: "정산완료", money: 10 }),
    ),
    "settled",
  );
  // Changing only the state is still the staff's.
  await posts.settle(ctx, { id: request.id, state: "반려" });
  assert.equal(table(`${P}wallets`).get("m-1").balance, 10);
  const own = (
    await posts.write(ctx, {
      data: { board: "calc", category: "이벤트", text: "내 것" },
    })
  ).document;
  assert.equal(
    await refusal(
      posts.settle(ctx, { id: own.id, state: "정산완료", money: 5 }),
    ),
    "own_settlement",
  );

  // [[name]] removed and put back does not call them again.
  table(`${P}profiles`).set("m-1", { nick: "하나" });
  table(`${P}profiles`).set("m-3", { nick: "셋" });
  ctx.member = { id: "m-1" };
  const post = (
    await posts.write(ctx, {
      data: {
        board: "default",
        image: "https://example.com/a.png",
        text: "[[셋]] 안녕",
      },
    })
  ).document;
  const calls = () =>
    [...table(`${P}calls`).values()].filter((row) => row.to === "m-3").length;
  assert.equal(calls(), 1);
  let current = post;
  for (const text of ["안녕", "[[셋]] 다시"]) {
    current = (
      await posts.write(ctx, {
        id: current.id,
        revision: current.revision,
        data: { ...current.data, text },
      })
    ).document;
  }
  assert.equal(calls(), 1);
  void sent;
});
