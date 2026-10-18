// 실행: npm test
// Mail's queries and mutations on a real SQLite database with the site's
// migrations (tests/sql-ctx.mjs): sending 쪽지 to 1–20 members with its cost
// and daily limit, each side's box, reading and removing, the 쪽지함 grouped
// by correspondent, a conversation, and what community/inbox:status tells a
// member's pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testSite } from "./sql-ctx.mjs";
import {
  M1,
  M2,
  M3,
  refusal,
  setSettings,
  profile,
  wallet,
  balanceOf,
} from "./helpers.mjs";

const messages = (site) => site.rows("SELECT * FROM messages ORDER BY id");
const send = (site, recipients, body, who = M1) =>
  site.mutate("community/messages:sendMessage", { recipients, body }, who);
/** What the tabs say: how many unread 쪽지, and whether a call is new. */
const status = async (site, who) => {
  const { messages, calls } = await site.query(
    "community/inbox:status",
    null,
    who,
  );
  return { messages, calls };
};
const boxes = (site, who, page = 1) =>
  site.query("community/messages:conversations", { page }, who);

async function people(...ids) {
  const site = await testSite();
  for (const id of ids) profile(site, id);
  return site;
}

test("a 쪽지 goes to members who take them, pays its cost for each, and tells them", async () => {
  const site = await people("m-1", "m-2", "m-3");
  profile(site, "closed", undefined, { accept_messages: 0 });
  wallet(site, "m-1", 10);
  setSettings(site, "community", { messageCost: 2 });
  // Each refusal leaves nothing written and nothing paid.
  for (const [recipients, reason] of [
    [["m-2", "closed"], "no_recipient"],
    [["m-2", "missing"], "no_recipient"],
    [["m-1"], "no_recipient"],
    [["m-2", "m-2"], "invalid_recipients"],
    [[], "invalid_recipients"],
    [Array.from({ length: 21 }, (_, n) => `m-${n}`), "invalid_recipients"],
    ["m-2", "invalid_recipients"],
  ]) {
    assert.equal(await refusal(send(site, recipients, "hello")), reason);
    assert.equal(messages(site).length, 0);
    assert.equal(balanceOf(site, "m-1"), 10);
  }
  await assert.rejects(send(site, ["m-2"], "x".repeat(5001)));
  await assert.rejects(send(site, ["m-2"], "   "));
  assert.equal(await refusal(send(site, ["m-2"], "hi", {})), "sign_in");
  assert.equal(
    await refusal(send(site, ["m-1"], "hi", { member: "new" })),
    "no_profile",
  );
  const sent = await send(site, ["m-2", "m-3"], " 안녕 ");
  assert.equal(sent.balance, 6);
  assert.equal(sent.ids.length, 2);
  assert.deepEqual(
    messages(site).map((row) => [
      String(row.id),
      row.sender,
      row.recipient,
      row.body,
      row.read_at,
      row.gift,
    ]),
    [
      [sent.ids[0], "m-1", "m-2", "안녕", null, null],
      [sent.ids[1], "m-1", "m-3", "안녕", null, null],
    ],
  );
  // Each recipient hears of theirs in the Naru app; refused sends told no one.
  assert.deepEqual(site.notifications, [
    {
      members: ["m-2"],
      title: "m1님의 쪽지",
      body: "안녕",
      path: `/messages/${sent.ids[0]}`,
    },
    {
      members: ["m-3"],
      title: "m1님의 쪽지",
      body: "안녕",
      path: `/messages/${sent.ids[1]}`,
    },
  ]);
  const [cost] = site.rows("SELECT * FROM history WHERE kind = 'message'");
  assert.deepEqual([cost.owner, cost.delta, cost.balance], ["m-1", -4, 6]);
  assert.deepEqual(await status(site, M2), { messages: 1, calls: false });
  assert.deepEqual(await status(site, M1), { messages: 0, calls: false });
  // A visitor (and the owner) has nothing new.
  assert.deepEqual(await status(site, {}), { messages: 0, calls: false });
  assert.deepEqual(await status(site, { owner: true }), {
    messages: 0,
    calls: false,
  });
  // Not enough money: nothing sent.
  setSettings(site, "community", { messageCost: 4 });
  assert.equal(
    await refusal(send(site, ["m-2", "m-3"], "again")),
    "not_enough",
  );
  assert.equal(messages(site).length, 2);
  assert.equal(site.notifications.length, 2);
});

test("a member sends so many a day, counted from the Korean midnight, and a gift's note is not one", async () => {
  const site = await people("m-1", "m-2", "m-3", "m-4");
  // 23:30 in Korea.
  site.now = Date.parse("2030-01-01T14:30:00Z");
  setSettings(site, "community", { messageDailyLimit: 3 });
  await send(site, ["m-2", "m-3"], "hi");
  // A gift's note the same day does not count.
  site.run(
    `INSERT INTO messages (sender, recipient, body, sent_at, gift) VALUES ('m-1', 'm-2', 'gift', ?, '{"kind":"money","amount":1}')`,
    site.now,
  );
  const refused = await send(site, ["m-2", "m-4"], "again").catch(
    (error) => error,
  );
  assert.equal(refused.code, "RATE_LIMITED");
  assert.deepEqual(refused.details, { reason: "daily_limit", remaining: 1 });
  await send(site, ["m-4"], "last");
  assert.equal(await refusal(send(site, ["m-4"], "more")), "daily_limit");
  // 00:00 in Korea starts the day again.
  site.now = Date.parse("2030-01-01T15:00:00Z");
  await send(site, ["m-2", "m-3", "m-4"], "new day");
  // 0 lifts the limit; none set is 100.
  setSettings(site, "community", { messageDailyLimit: 0 });
  await send(site, ["m-2"], "no limit");
  setSettings(site, "community", {});
  await send(site, ["m-3"], "default");
});

test("only the two sides read a message; reading marks the recipient's, and each side removes its own", async () => {
  const site = await people("m-1", "m-2", "m-3");
  const {
    ids: [id],
  } = await send(site, ["m-2"], "private body");
  const read = (who, given = id) =>
    site.mutate("community/messages:readMessage", { id: given }, who);
  const remove = (who) =>
    site.mutate("community/messages:removeMessage", { id }, who);
  // The sender reading it is no receipt.
  assert.equal((await read(M1)).document.data.readAt, null);
  assert.equal(await refusal(read(M3)), "message_not_found");
  assert.equal(await refusal(remove(M3)), "message_not_found");
  for (const wrong of ["x", "0", -1, null, "99"])
    assert.equal(await refusal(read(M2, wrong)), "message_not_found");
  assert.equal(await refusal(read({})), "sign_in");
  site.now += 1000;
  assert.deepEqual((await read(M2)).document, {
    id,
    data: {
      from: "m-1",
      to: "m-2",
      body: "private body",
      sentAt: site.now - 1000,
      readAt: site.now,
    },
  });
  assert.deepEqual(await status(site, M2), { messages: 0, calls: false });
  // Read once: a second read keeps the first time.
  site.now += 1000;
  assert.equal((await read(M2)).document.data.readAt, site.now - 1000);
  // Removing it takes it from the recipient's box only; the sender keeps
  // theirs, so a sender cannot erase what was received, nor the reverse.
  assert.equal(await remove(M2), null);
  assert.equal(await refusal(read(M2)), "message_not_found");
  assert.equal((await boxes(site, M2)).total, 0);
  assert.equal((await read(M1)).document.id, id);
  assert.equal((await boxes(site, M1)).total, 1);
  await remove(M1);
  assert.equal(messages(site).length, 0);
  // A removed message's number is never given again.
  const next = await send(site, ["m-2"], "again");
  assert.ok(Number(next.ids[0]) > Number(id));
  // An unread one removed by its recipient no longer counts.
  assert.equal((await status(site, M2)).messages, 1);
  await site.mutate(
    "community/messages:removeMessage",
    { id: next.ids[0] },
    M2,
  );
  assert.equal((await status(site, M2)).messages, 0);
});

test("the 쪽지함 has one entry a correspondent, newest first, with the last message, a count and N", async () => {
  const site = await people("m-1", "m-2", "m-3");
  await send(site, ["m-2"], "안녕");
  site.now += 1000;
  await send(site, ["m-3"], "x".repeat(5000));
  site.now += 1000;
  await send(site, ["m-1"], "반가워", M2);
  // m-2's main character shows with them (memo_view.skin.php's thumbnail).
  site.run(
    "INSERT INTO characters (id, owner, name, image, state, created_at) VALUES (9, 'm-2', '카도', 'https://e.com/k.png', 'approved', 0)",
  );
  site.run("UPDATE profiles SET main_character = '9' WHERE member = 'm-2'");
  const listed = await boxes(site, M1);
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.documents, [
    {
      partner: "m-2",
      character: { id: "9", name: "카도", image: "https://e.com/k.png" },
      last: {
        id: listed.documents[0].last.id,
        preview: "반가워",
        sentAt: site.now,
        mine: false,
      },
      count: 2,
      unread: true,
    },
    {
      partner: "m-3",
      character: null,
      last: {
        id: listed.documents[1].last.id,
        preview: "x".repeat(150),
        sentAt: site.now - 1000,
        mine: true,
      },
      count: 1,
      unread: false,
    },
  ]);
  // The other side sees theirs; anyone else nothing.
  assert.deepEqual(
    (await boxes(site, M2)).documents.map((entry) => [
      entry.partner,
      entry.count,
      entry.last.mine,
    ]),
    [["m-1", 2, true]],
  );
  assert.equal((await boxes(site, { member: "m-4" })).total, 0);
  for (const page of [0, 1.5, "1"])
    assert.equal(await refusal(boxes(site, M1, page)), "invalid_input");
  assert.equal(await refusal(boxes(site, {})), "sign_in");
});

test("a 쪽지함 of many correspondents pages by five, grouped over every message", async () => {
  const site = await people("m-1");
  const start = site.now;
  // 1,300 from m-2 long ago, then one each from 150 others: all counted.
  for (let n = 0; n < 1300; n++)
    site.run(
      "INSERT INTO messages (sender, recipient, body, sent_at) VALUES ('m-2', 'm-1', ?, ?)",
      `옛 쪽지 ${n}`,
      start + n,
    );
  for (let n = 0; n < 150; n++)
    site.run(
      "INSERT INTO messages (sender, recipient, body, sent_at, read_at) VALUES (?, 'm-1', '안녕', ?, ?)",
      `other-${n}`,
      start + 2000 + n,
      start,
    );
  const first = await boxes(site, M1);
  assert.equal(first.total, 151);
  assert.deepEqual(
    first.documents.map((entry) => [entry.partner, entry.unread]),
    [
      ["other-149", false],
      ["other-148", false],
      ["other-147", false],
      ["other-146", false],
      ["other-145", false],
    ],
  );
  const last = await boxes(site, M1, 31);
  assert.deepEqual(
    last.documents.map((entry) => [entry.partner, entry.count, entry.unread]),
    [["m-2", 1300, true]],
  );
  assert.equal(last.documents[0].last.preview, "옛 쪽지 1299");
  // Past the last page: none, and how many there are.
  assert.deepEqual(await boxes(site, M1, 40), { total: 151, documents: [] });
  assert.deepEqual(await status(site, M1), { messages: 1300, calls: false });
});

test("a conversation shows both sides oldest first, pages back by fifty, and opening it reads them all", async () => {
  const site = await people("m-1", "m-2", "m-3");
  setSettings(site, "community", { messageDailyLimit: 0 });
  await send(site, ["m-2"], "안녕");
  await send(site, ["m-3"], "다른 사람");
  for (let n = 0; n < 120; n++) {
    site.now += 1;
    await send(site, ["m-1"], `답 ${n}`, M2);
  }
  // Sent at the same moment: the ID keeps them in order.
  await send(site, ["m-2"], "같은 때 1");
  await send(site, ["m-2"], "같은 때 2");
  const talk = (who, args) =>
    site.query("community/messages:conversation", args, who);
  const first = await talk(M1, { partner: "m-2" });
  assert.equal(first.documents.length, 50);
  assert.equal(first.documents[0].data.body, "답 72");
  assert.deepEqual(
    first.documents.slice(-2).map((row) => row.data.body),
    ["같은 때 1", "같은 때 2"],
  );
  assert.equal(first.more, true);
  // Every unread one counts, not only the page's.
  assert.equal(first.unread, 120);
  const second = await talk(M1, {
    partner: "m-2",
    before: first.documents[0].id,
  });
  assert.equal(second.documents[0].data.body, "답 22");
  assert.equal(second.documents.at(-1).data.body, "답 71");
  const third = await talk(M1, {
    partner: "m-2",
    before: second.documents[0].id,
  });
  assert.deepEqual(
    third.documents.slice(0, 2).map((row) => row.data.body),
    ["안녕", "답 0"],
  );
  assert.equal(third.documents.length, 23);
  assert.equal(third.more, false);
  // Opening it reads everything m-2 sent, all 120 at once.
  site.now += 1000;
  assert.deepEqual(
    await site.mutate(
      "community/messages:readConversation",
      { partner: "m-2" },
      M1,
    ),
    { read: 120 },
  );
  assert.equal((await talk(M1, { partner: "m-2" })).unread, 0);
  assert.deepEqual(await status(site, M1), { messages: 0, calls: false });
  assert.equal((await boxes(site, M1)).documents[0].unread, false);
  // The other side's are not theirs to read: m-2 has three unread.
  assert.equal((await status(site, M2)).messages, 3);
  // A side's removed messages leave its conversation only.
  await site.mutate(
    "community/messages:removeMessage",
    { id: first.documents.at(-1).id },
    M1,
  );
  assert.equal(
    (await talk(M1, { partner: "m-2" })).documents.at(-1).data.body,
    "같은 때 1",
  );
  assert.equal(
    (await talk(M2, { partner: "m-1" })).documents.at(-1).data.body,
    "같은 때 2",
  );
  for (const args of [
    { partner: "m-1" },
    { partner: 5 },
    {},
    { partner: "m-2", before: "soon" },
    { partner: "m-2", before: 1.5 },
  ])
    assert.equal(await refusal(talk(M1, args)), "invalid_input");
  assert.equal(
    await refusal(
      site.mutate(
        "community/messages:readConversation",
        { partner: "m-1" },
        M1,
      ),
    ),
    "invalid_input",
  );
  assert.equal(await refusal(talk({}, { partner: "m-2" })), "sign_in");
});

test("the newest unread 쪽지 and the newest new call come with the tabs, for their popups", async () => {
  const site = await people("m-1", "m-2", "m-3");
  const inbox = (who) => site.query("community/inbox:status", null, who);
  assert.deepEqual(await inbox(M2), {
    messages: 0,
    calls: false,
    memo: null,
    call: null,
  });
  await send(site, ["m-2"], "첫 쪽지");
  site.now += 1000;
  const { ids } = await send(site, ["m-2"], "둘째 쪽지", M3);
  // mb_memo_call: who sent the newest one, and which it is.
  assert.deepEqual((await inbox(M2)).memo, { id: ids[0], nick: "m3" });
  await site.mutate("community/messages:readMessage", { id: ids[0] }, M2);
  assert.equal((await inbox(M2)).memo.nick, "m1");
  site.run(
    "INSERT INTO calls (recipient, sender, nick, kind, board, post_id, comment_id, at) VALUES ('m-2', 'm-1', '아보', 'call', 'free', 7, 9, ?), ('m-2', 'm-1', '아보', 'comment', 'free', 8, NULL, ?)",
    site.now - 10,
    site.now,
  );
  const { call } = await inbox(M2);
  assert.deepEqual(call, {
    id: call.id,
    kind: "comment",
    nick: "아보",
    post: "8",
    comment: null,
    count: 2,
  });
  // Seen calls are no longer new.
  await site.mutate("community/calls:seeCalls", null, M2);
  assert.equal((await inbox(M2)).call, null);
  assert.equal((await inbox(M1)).memo, null);
});
