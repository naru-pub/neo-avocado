// 실행: npm test
// 서버 함수를 나루가 부르는 그대로 부른다: ctx 하나와 인자. ctx는 메모리에
// 있는 가짜이고, 나루에서처럼 함수가 쓴 문서에는 작성자가 붙지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sendMessage,
  conversations,
  conversation,
  readMessage,
  removeMessage,
  messageStatus,
  posts,
  comments,
  callHistory,
  seeCalls,
  commentCounts,
  moderatePost,
} from "../dist/_naru/modules/index.js";
import { readable, canWrite } from "../dist/_naru/rules/community-board.js";
import { matches } from "./where.mjs";
import { nativeRead } from "./native-read.mjs";
import { onDisplay } from "../dist/_naru/modules/display.js";
// The foundation's queries and mutations, which the old functions' tests
// still use to join, visit and read the site's frame.
import { membership } from "../dist/_naru/queries/community/membership.js";
import { join, leave } from "../dist/_naru/mutations/community/membership.js";
import { seen } from "../dist/_naru/mutations/community/presence.js";
import { online } from "../dist/_naru/queries/community/presence.js";
import { site } from "../dist/_naru/queries/content/site.js";
import { nicks } from "../dist/_naru/queries/community/profiles.js";
import { wallet } from "../dist/_naru/queries/economy/wallet.js";
import {
  dataOf,
  keyOf as documentKey,
  mappingOf,
  rolesOfData,
  selectOf,
  writeStatements,
} from "../dist/_naru/modules/documents.js";
import { database, migrations, sqlOf } from "./sql-ctx.mjs";
// The characters' mutations, which the old functions' tests call beside them.
import { save as saveSheet } from "../dist/_naru/mutations/characters/sheet.js";

const presence = { seen, online };
const P = "neo_avocado_";
const MIGRATIONS = await migrations();

/**
 * One of the foundation's tables as the Map of documents the old tests
 * set up and inspect: get and set whole documents, keyed by ID. History
 * numbers its own rows, whatever ID a test gives.
 */
function tableView(db, roles, map) {
  const keyOf = (id) => documentKey(map, id);
  const where = map.settings && map.settings !== true ? ` WHERE key = ?` : "";
  const scope = map.settings && map.settings !== true ? [map.settings.key] : [];
  const idOf = (row) =>
    map.settings
      ? map.settings === true
        ? row.key
        : map.settings.id
      : String(row[map.key]);
  const document = (row) => {
    const id = idOf(row);
    const data = dataOf(map, row, roles.get(id) ?? []);
    if (map.table === "profiles") {
      // As profiles:own shows it: no 대표 is null.
      data.mainCharacter ??= null;
      const favorites = db
        .prepare("SELECT post FROM favorites WHERE member = ? ORDER BY id DESC")
        .all(id)
        .map((entry) => entry.post);
      if (favorites.length) data.favorites = favorites;
    }
    return data;
  };
  const all = () =>
    db.prepare(`${selectOf(map)}${where} ORDER BY rowid`).all(...scope);
  const view = {
    get(id) {
      const key = keyOf(id);
      const row =
        key === null
          ? undefined
          : db.prepare(`${selectOf(map)} WHERE ${map.key} = ?`).get(key);
      return row ? document(row) : undefined;
    },
    has: (id) => view.get(id) !== undefined,
    set(id, data) {
      // As the admin bridge writes it (modules/documents.js).
      const { write, after } = writeStatements(
        map,
        map.generated ? 0 : keyOf(id),
        data,
        Date.now(),
      );
      db.prepare(write.text).all(...write.values);
      for (const next of after) db.prepare(next.text).run(...next.values);
      if (map.roles) roles.set(id, rolesOfData(data, roles.get(id) ?? []));
      if (map.table === "profiles" && Array.isArray(data.favorites)) {
        db.prepare("DELETE FROM favorites WHERE member = ?").run(id);
        for (const post of [...data.favorites].reverse())
          db.prepare("INSERT INTO favorites (member, post) VALUES (?, ?)").run(
            id,
            post,
          );
      }
      return view;
    },
    delete(id) {
      for (const next of map.cascade?.(keyOf(id)) ?? [])
        db.prepare(next.text).run(...next.values);
      db.prepare(`DELETE FROM ${map.table} WHERE ${map.key} = ?`).run(
        keyOf(id),
      );
      if (map.roles) roles.set(id, rolesOfData({}, roles.get(id) ?? []));
      return true;
    },
    get size() {
      return all().length;
    },
    keys: () => all().map(idOf)[Symbol.iterator](),
    values: () => all().map(document)[Symbol.iterator](),
    entries: () =>
      all()
        .map((row) => [idOf(row), document(row)])
        [Symbol.iterator](),
    [Symbol.iterator]: () => view.entries(),
  };
  return view;
}

function fakeCtx({ now = Date.parse("2030-01-01T03:00:00Z"), roll = 0 } = {}) {
  // Functions roll with Math.random, the host's on Naru.
  Math.random = () => roll;
  const store = new Map();
  let added = 0;
  // The site's tables, and members' roles, as Naru keeps them.
  const db = database(MIGRATIONS);
  const roles = new Map();
  const table = (name) => {
    if (!store.has(name)) {
      const map = mappingOf(name);
      store.set(name, map ? tableView(db, roles, map) : new Map());
    }
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
    sql: sqlOf(db),
    rolesOf: async (ids) =>
      Object.fromEntries(ids.map((id) => [id, roles.get(id) ?? []])),
    setRoles: async (member, list) => {
      roles.set(member, [...new Set(list)].sort());
      return null;
    },
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
  const set = settingsTable.set;
  settingsTable.set = (id, data) =>
    set(id, id === "community" ? { characterLimit: 0, ...data } : data);
  settingsTable.set("community", {});
  return { ctx, table, sent, released };
}

/**
 * A page's write, by collection and operation: posts and comments through
 * their site functions. Nothing else is written by pages as documents.
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
  const functions = { logs: posts, comments };
  if (functions[kind])
    return operation === "delete"
      ? functions[kind].remove(ctx, args)
      : (functions[kind].write ?? functions[kind].save)(ctx, args);
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
  table(`${P}members`).set("m-2", { role: "moderator" });
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
  table(`${P}characters`).set("1", {
    owner: "m-1",
    name: "Hero",
    image: "https://example.com/hero.png",
    state: "approved",
  });
  table(`${P}characters`).set("2", { owner: "m-2", name: "Rival" });
  table(`${P}titles`).set("brave", {
    name: "Brave",
    image: "https://example.com/brave.png",
  });
  table(`${P}character_state`).set("1", {
    owner: "m-1",
    character: "1",
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
        character: "1",
      },
    })
  ).document;
  assert.deepEqual(log.data.speaker, {
    character: "1",
    name: "Hero",
    type: "main",
    title: "Brave",
    titleImage: "https://example.com/brave.png",
    portrait: "https://example.com/hero.png",
  });
  for (const character of ["2", "3", "missing", 7])
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
      data: { logId: "thread", text: "hi", character: "1" },
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
        character: "2",
        speaker: { name: "Forged" },
      },
    })
  ).document;
  assert.equal(edited.data.speaker.name, "Hero");
  assert.equal(edited.data.character, "1");
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

test("exploration is limited per character per Korean day and drops configured items", async () => {
  const { ctx, table } = roleplayWorld({ roll: 0.1 });
  const explore = (data = {}) =>
    gate(ctx, "comments", "add", {
      data: {
        logId: "thread",
        text: "",
        character: "1",
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
    [["herb", "1", "explore"]],
  );
  Math.random = () => 0.9;
  assert.equal((await explore()).document.data.actions[0].item, null);
  assert.equal(await reasonOf(explore()), "explore_limit");
  // 2030-01-01 15:00 UTC is midnight in Korea: a new day, counted on request.
  ctx.now = Date.parse("2030-01-01T15:00:00Z");
  assert.equal((await explore()).document.data.actions[0].remaining, 1);
  assert.deepEqual(table(`${P}character_state`).get("1").explore, {
    day: "2030-01-02",
    count: 1,
  });
  // Approval is the sheet's state, which the review changes.
  table(`${P}characters`).set("1", {
    ...table(`${P}characters`).get("1"),
    state: "submitted",
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
      character: "1",
      ...extra,
    });
  own("101", "letter");
  own("102", "box");
  own("103", "ticket");
  own("104", "charm");
  // Held by no character: the original's inventory is a character's.
  own("105", "letter", { character: undefined });
  table(`${P}inventory`).set("106", {
    owner: "m-2",
    item: "letter",
    character: "2",
  });
  const use = (item, character = "1") =>
    gate(ctx, "comments", "add", {
      data: { logId: "thread", text: "uses", item, character },
    });
  assert.equal(await reasonOf(use("106")), "not_owned");
  assert.equal(await reasonOf(use("105")), "wrong_character");
  assert.equal(await reasonOf(use("102", null)), "no_character");
  const letter = (await use("101")).document;
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
  assert.equal(table(`${P}inventory`).has("101"), false);
  const box = (await use("102")).document;
  assert.deepEqual(box.data.actions[0].prize, { item: "prize", name: "Prize" });
  assert.equal(
    [...table(`${P}inventory`).values()].some(
      (row) => row.item === "prize" && row.character === "1",
    ),
    true,
  );
  // A ticket is only shown used and spent: tickets work from the inventory
  // (write_update.inc.php:126-129 logs any item but 뽑기).
  const ticket = (await use("103")).document;
  assert.equal(ticket.data.actions[0].effect, "create");
  assert.equal(table(`${P}inventory`).has("103"), false);
  // A reusable item (it_use_ever) stays.
  await use("104");
  assert.equal(table(`${P}inventory`).has("104"), true);
  // A post's item needs an approved character; a comment's does not.
  // Approval is the sheet's state, which the review changes.
  table(`${P}characters`).set("1", {
    ...table(`${P}characters`).get("1"),
    state: "submitted",
  });
  assert.equal((await use("104")).document.data.actions.length, 1);
  const post = (data) =>
    gate(ctx, "logs", "add", {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "1",
        ...data,
      },
    });
  assert.equal(await reasonOf(post({ item: "104" })), "not_approved");
});

test("recovery in a post is logged, not applied: it heals from the inventory only", async () => {
  const { ctx, table } = roleplayWorld();
  table(`${P}stat_config`).set("hp", { name: "HP", initial: 10, max: 100 });
  table(`${P}character_state`).set("1", {
    ...table(`${P}character_state`).get("1"),
    stats: { hp: { allocated: 0, max: 10, current: 3, damage: 7 } },
  });
  table(`${P}items`).set("potion", {
    usableInPosts: true,
    craftMaterial: true,
    name: "Potion",
    effect: { type: "restore", stat: "hp", amount: 3 },
  });
  table(`${P}inventory`).set("107", {
    owner: "m-1",
    item: "potion",
    name: "Potion",
    character: "1",
  });
  const posted = (
    await gate(ctx, "logs", "add", {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "1",
        item: "107",
      },
    })
  ).document;
  assert.equal(posted.data.actions[0].effect, "restore");
  assert.equal(posted.data.actions[0].amount, undefined);
  assert.equal(table(`${P}inventory`).has("107"), false);
  assert.equal(table(`${P}character_state`).get("1").stats.hp.damage, 7);
});

test("[[nick]] calls and comment notices reach members who can read the post", async () => {
  const { ctx, table, sent } = roleplayWorld();
  table(`${P}profiles`).set("m-3", { owner: "m-3", nick: "세번째" });
  const comment = (
    await gate(ctx, "comments", "add", {
      data: {
        logId: "thread",
        text: "[[세번째]] [[없는사람]] [[아보]] 안녕",
        character: "1",
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
  // Nicknames reach visitors; nothing else from a profile does, nor a wallet.
  assert.deepEqual(await nicks(ctx, { ids: ["m-1"] }), {
    nicks: { "m-1": "회원" },
  });
  assert.equal(await refusal(wallet(ctx)), "sign_in");
  assert.equal(
    await refusal(read({ collection: `${P}messages`, operation: "list" })),
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
      character: "1",
      ...extra,
    });
  own("108", "herb");
  // Held by no character: not the speaker's (write.skin.php:238).
  own("105", "herb", { character: undefined });
  own("109", "water", { character: "1" });
  own("110", "pot");
  own("111", "herb", { character: "99" });
  // 조합 is a post's (mmb/write.skin.php), not a comment's.
  assert.equal(
    await reasonOf(
      gate(ctx, "comments", "add", {
        data: {
          logId: "thread",
          text: "",
          action: "combine",
          materials: ["108"],
          character: "1",
        },
      }),
    ),
    "invalid_input",
  );
  const combine = (materials, character = "1") =>
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
  assert.equal(await reasonOf(combine(["108"], null)), "no_character");
  assert.equal(await reasonOf(combine(["111"])), "not_owned");
  assert.equal(await reasonOf(combine(["105"])), "not_owned");
  assert.equal(await reasonOf(combine(["108", "108"])), "invalid_materials");
  const made = (await combine(["110", "108", "109"])).document;
  assert.equal(made.data.actions[0].success, true);
  assert.equal(made.data.actions[0].name, "Potion");
  assert.equal(table(`${P}wallets`).get("m-1").balance, 0);
  assert.equal(table(`${P}inventory`).has("108"), false);
  assert.equal(table(`${P}inventory`).has("110"), true); // reusable
  assert.ok(
    [...table(`${P}inventory`).values()].some(
      (row) => row.item === "potion" && row.character === "1",
    ),
  );
  own("112", "herb");
  const missed = (await combine(["112", "110"])).document;
  assert.equal(missed.data.actions[0].success, false);
  assert.equal(table(`${P}inventory`).has("112"), false);
  // Only an approved character combines (write.skin.php:196).
  // Approval is the sheet's state, which the review changes.
  table(`${P}characters`).set("1", {
    ...table(`${P}characters`).get("1"),
    state: "submitted",
  });
  own("113", "herb");
  assert.equal(await reasonOf(combine(["113"])), "not_approved");
});

test("사이트공개: visitors read the boards and nicknames while the site is open, and nothing once it is closed", async () => {
  const { ctx, table } = fakeCtx();
  table(`${P}boards`).set("free", PUBLIC_BOARD);
  table(`${P}profiles`).set("m-1", { nick: "회원" });
  table(`${P}logs`).set("post", {
    board: "free",
    text: "공개 글",
    owner: "m-1",
  });
  ctx.member = null;
  const ids = async (collection, options) =>
    (
      await nativeRead(ctx, {
        collection: `${P}${collection}`,
        operation: "list",
        options,
      })
    ).documents.map((row) => row.id);
  // Open (the default): the boards a visitor may list.
  assert.deepEqual(await ids("boards"), ["free"]);
  assert.equal((await site(ctx)).open, true);
  // Closed: visitors read no characters, boards, posts or nicknames, and
  // the viewer's functions refuse them, as the original sends them to log in.
  table(`${P}settings`).set("community", { siteOpen: false });
  assert.equal((await site(ctx)).open, false);
  assert.deepEqual(await ids("boards"), []);
  assert.deepEqual(await nicks(ctx, { ids: ["m-1"] }), { nicks: {} });
  assert.deepEqual(await ids("logs", { filter: { board: "free" } }), []);
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
  assert.deepEqual(await ids("boards"), ["default", "free"]);
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
  table(`${P}members`).set("m-1", { groups: ["staff"] });
  assert.deepEqual(await listed(), ["plans"]);
  await posts.write(ctx, { data: { board: "plans", text: "안녕" } });
  // Moderators reach every group; an open group is everyone's.
  table(`${P}members`).set("m-1", { level: 2, role: "moderator" });
  assert.deepEqual(await listed(), ["plans"]);
  table(`${P}board_groups`).get("staff").membersOnly = false;
  table(`${P}members`).set("m-1", { level: 2, role: "member" });
  assert.deepEqual(await listed(), ["plans"]);
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
  table(`${P}characters`).set("1", { owner: "m-1", name: "용사" });
  table(`${P}members`).set("m-1", { level: 2, role: "member" });
  const request = (
    await posts.write(ctx, {
      data: {
        board: "calc",
        category: "이벤트",
        text: "참여했어요",
        character: "1",
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
  assert.equal(table(`${P}character_state`).get("1").exp, 5);
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
  table(`${P}characters`).set("9", { name: "보물찾기단" });
  for (let n = 0; n < 650; n += 1)
    table(`${P}logs`).set(`p${n}`, {
      board: "free",
      owner: "m-1",
      text: n === 649 ? "아주 오래된 보물" : n < 25 ? `조개 ${n}` : `글 ${n}`,
      ...(n === 300 ? { character: "9" } : {}),
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

test("기타 항목명 설정 names money, experience, 소속 and 종족 for pages and refusals", async () => {
  const { NAME_DEFAULTS, subject, lacking } =
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
  assert.equal(await lacking(ctx, "moneyName"), "골드가 모자랍니다.");
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
    await post({ text: "누가 썼을까", anonymous: true, character: "1" })
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
  // They are the member's own: another's nicknames carry none.
  assert.deepEqual(await nicks(ctx, { ids: ["m-1"] }), {
    nicks: { "m-1": table(`${P}profiles`).get("m-1").nick },
  });
  assert.deepEqual(await posts.favorite(ctx, { id: "thread" }), {
    favorite: false,
  });
  assert.deepEqual((await posts.favorites(ctx)).documents, []);
  assert.equal(
    await refusal(posts.favorite(ctx, { id: "missing" })),
    "document_not_found",
  );
});

test("items stay out of posts or 조합 as the owner marks them", async () => {
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
  table(`${P}inventory`).set("114", {
    owner: "m-1",
    item: "plain",
    character: "1",
    name: "평범",
  });
  table(`${P}inventory`).set("115", {
    owner: "m-1",
    item: "note",
    character: "1",
    name: "쪽지",
  });
  table(`${P}inventory`).set("116", {
    owner: "m-1",
    item: "stone",
    character: "1",
    name: "돌",
  });
  const post = (data) =>
    gate(ctx, "logs", "add", {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "1",
        ...data,
      },
    });
  assert.equal(await reasonOf(post({ item: "115" })), "not_usable");
  assert.equal(await reasonOf(post({ item: "114" })), "not_usable");
  assert.equal(
    await reasonOf(post({ action: "combine", materials: ["114"] })),
    "not_material",
  );
  assert.equal(
    await reasonOf(post({ action: "combine", materials: ["116"] })),
    "not_material",
  );
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
  table(`${P}inventory`).set("101", {
    owner: "m-1",
    item: "letter",
    name: "Letter",
    character: "1",
  });
  const post = (data) =>
    posts.write(ctx, {
      data: {
        board: "default",
        image: "https://example.com/p.png",
        text: "",
        character: "1",
        ...data,
      },
    });
  const explored = (await post({ action: "explore" })).document;
  assert.equal(explored.data.actions[0].type, "explore");
  assert.equal(explored.data.actions[0].item, "herb");
  assert.equal(await reasonOf(posts.remove(ctx, { id: explored.id })), "acted");
  // An item's use alone (wr_item_log) does not keep a post.
  const used = (await post({ item: "101" })).document;
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
      character: "1",
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
      character: "1",
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
  table(`${P}characters`).set("1", { owner: "m-1", name: "용사" });
  table(`${P}members`).set("m-2", { level: 2, role: "moderator" });
  const request = (
    await posts.write(ctx, {
      data: {
        board: "calc",
        category: "이벤트",
        text: "참여",
        character: "1",
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
