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
} from "../dist/_naru/modules/index.js";
import { matches } from "./where.mjs";
import { nativeRead } from "./native-read.mjs";
// The foundation's queries and mutations, which the old functions' tests
// still use to join, visit and read the site's frame.
import { membership } from "../dist/_naru/queries/community/membership.js";
import { join } from "../dist/_naru/mutations/community/membership.js";
import { site } from "../dist/_naru/queries/content/site.js";
import {
  dataOf,
  keyOf as documentKey,
  mappingOf,
  rolesOfData,
  selectOf,
  writeStatements,
} from "../dist/_naru/modules/documents.js";
import { database, migrations, sqlOf } from "./sql-ctx.mjs";

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
  // Tests give one member several characters; the limit has its own test.
  const settingsTable = table(`${P}settings`);
  const set = settingsTable.set;
  settingsTable.set = (id, data) =>
    set(id, id === "community" ? { characterLimit: 0, ...data } : data);
  settingsTable.set("community", {});
  return { ctx, table, sent, released };
}

/**
 * A page's write to a collection: none is a page's now (posts and comments
 * are the boards' mutations, tests/boards.test.mjs), so Naru refuses it.
 */
async function communityWrite() {
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
