// 실행: npm test
// The boards' queries and mutations on a real SQLite database with the
// site's migrations (tests/sql-ctx.mjs): who may read and write which
// board, posts and comments with their secrets, 멤버공개 and 익명, guests'
// posts and passwords, roleplay in posts (speakers, dice, 탐색, items,
// 조합, calls), the board page, search, Q&A and settlement boards, 관심
// and rewards. The owner's admin is tests/admin.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testSite } from "./sql-ctx.mjs";

/** What the tabs say of community/inbox:status. */
const tabs = ({ messages, calls }) => ({ messages, calls });

const M1 = { member: "m-1" };
const M2 = { member: "m-2" };
const M3 = { member: "m-3" };
const OWNER = { owner: true };
const VISITOR = {};
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
/** "ok", or the reason a call refused with. */
const reasonOf = async (call) => (await refusal(call)) ?? "ok";
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
const profile = (site, member, nick, extra = {}) =>
  insert(site, "profiles", { member, nick, ...extra });
const member = (site, id, data) =>
  site.run(
    `INSERT INTO members (member, level, adult, warnings, warning_note) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (member) DO UPDATE SET level = excluded.level, adult = excluded.adult,
     warnings = excluded.warnings, warning_note = excluded.warning_note`,
    id,
    data.level ?? 2,
    data.adult ? 1 : 0,
    data.warnings ?? 0,
    data.warningNote ?? "",
  );
const moderator = (site, id) => site.setRoles(id, ["staff"]);
const wallet = (site, id, balance) =>
  site.run(
    "INSERT INTO wallets (member, balance) VALUES (?, ?) ON CONFLICT (member) DO UPDATE SET balance = excluded.balance",
    id,
    balance,
  );
const balanceOf = (site, id) =>
  site.rows("SELECT balance FROM wallets WHERE member = ?", id)[0]?.balance;

/** A board the owner made: the admin's fields, the rest as options. */
function board(site, id, data = {}) {
  const {
    name = id,
    group = null,
    kind = "image",
    enabled = true,
    listLevel = 2,
    readLevel = 2,
    writeLevel = 2,
    commentLevel = 2,
    anonymous = false,
    secret = "optional",
    writeReward = 0,
    commentReward = 0,
    writeMin = 0,
    writeMax = 0,
    commentMin = 0,
    commentMax = 0,
    editLock = 1,
    pageRows = 15,
    foldHeight = 600,
    ...options
  } = data;
  site.run(`DELETE FROM boards WHERE id = ?`, id);
  insert(site, "boards", {
    id,
    name,
    group_id: group,
    kind,
    enabled: enabled ? 1 : 0,
    list_level: listLevel,
    read_level: readLevel,
    write_level: writeLevel,
    comment_level: commentLevel,
    anonymous: anonymous ? 1 : 0,
    secret,
    write_reward: writeReward,
    comment_reward: commentReward,
    write_min: writeMin,
    write_max: writeMax,
    comment_min: commentMin,
    comment_max: commentMax,
    edit_lock: editLock,
    page_rows: pageRows,
    fold_height: foldHeight,
    options,
  });
}
/** The 로그 board ("default") as the owner would make it. */
const LOG_BOARD = {
  name: "로그",
  kind: "image",
  categories: [],
  actions: true,
};
/** A board open to visitors (level 1) for everything. */
const PUBLIC_BOARD = {
  name: "자유",
  kind: "text",
  listLevel: 1,
  readLevel: 1,
  writeLevel: 1,
  commentLevel: 1,
  categories: [],
  actions: true,
};
/**
 * A post made directly, with its full-text row as the mutations keep it;
 * answers its ID.
 */
function post(site, data = {}) {
  const id = insert(site, "posts", {
    board: "default",
    number: site.rows(
      "SELECT coalesce(max(number), 0) + 1 AS n FROM posts WHERE board = ?",
      data.board ?? "default",
    )[0].n,
    created_at: site.now,
    updated_at: site.now,
    ...data,
  });
  site.run(
    "INSERT INTO posts_search (rowid, title, body) VALUES (?, ?, ?)",
    Number(id),
    data.title ?? "",
    data.body ?? "",
  );
  return id;
}
/** A comment made directly, the same way; answers its ID. */
function comment(site, data = {}) {
  const id = insert(site, "comments", {
    created_at: site.now,
    updated_at: site.now,
    ...data,
  });
  site.run(
    "INSERT INTO comments_search (rowid, body) VALUES (?, ?)",
    Number(id),
    data.body ?? "",
  );
  return id;
}
const write = (site, args, who = M1) =>
  site.mutate("community/posts:write", args, who);
const reply = (site, args, who = M1) =>
  site.mutate("community/comments:write", args, who);
const read = (site, args, who = M1) =>
  site.query("community/posts:post", args, who);
const listPage = (site, args, who = M1) =>
  site.query("community/posts:page", args, who);
const commentsOf = async (site, id, who = M1) =>
  (await site.query("community/comments:list", { post: id }, who)).documents;
const search = (site, args, who = M1) =>
  site.query("community/posts:search", args, who);
/** The posts a board search finds, by ID, sorted. */
const searched = async (site, board, text, who = M1) =>
  (await search(site, { board, text }, who)).documents
    .map((row) => row.id)
    .sort();
/** The rows of a full-text table holding `text`, by the id they key. */
const indexed = (site, table, text) =>
  site
    .rows(
      `SELECT rowid AS id FROM ${table} WHERE ${table} MATCH ?`,
      `"${text}"`,
    )
    .map((row) => String(row.id))
    .sort();
const count = (site, table) =>
  site.rows(`SELECT count(*) AS n FROM ${table}`)[0].n;
const callsTo = (site, id) =>
  site.rows("SELECT * FROM calls WHERE recipient = ? ORDER BY id", id);
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

/** A site with the 로그 board. */
async function boardSite() {
  const site = await testSite();
  board(site, "default", LOG_BOARD);
  return site;
}

/**
 * Two members with profiles, one character each, the first approved with
 * a title it shows, and a scene m-2 posted.
 */
async function roleplayWorld() {
  const site = await boardSite();
  profile(site, "m-1", "아보");
  profile(site, "m-2", "카도");
  insert(site, "titles", {
    id: "brave",
    name: "Brave",
    image: "https://example.com/brave.png",
  });
  insert(site, "characters", {
    owner: "m-1",
    name: "Hero",
    image: "https://example.com/hero.png",
    state: "approved",
    points: 0,
    active_title: "brave",
    created_at: site.now,
  });
  insert(site, "characters", {
    owner: "m-2",
    name: "Rival",
    created_at: site.now,
  });
  insert(site, "character_titles", { character_id: 1, title_id: "brave" });
  const thread = post(site, {
    owner: "m-2",
    image: "https://example.com/log.png",
    body: "Scene",
  });
  return { site, thread };
}

test("boards enforce independent levels, secret bodies and parent comment access", async () => {
  const site = await boardSite();
  board(site, "notes", {
    name: "Notes",
    kind: "text",
    readLevel: 5,
    commentLevel: 5,
    categories: ["Alpha"],
  });
  const { document: record } = await write(site, {
    data: {
      board: "notes",
      title: "Title",
      text: "private level body",
      image: null,
      category: "Alpha",
    },
  });
  assert.equal(record.data.board, "notes");
  assert.equal(record.data.number, 1);
  // Level 2 lists the board but may not read it.
  assert.equal(
    await refusal(read(site, { id: record.id })),
    "document_not_found",
  );
  assert.equal(
    await refusal(listPage(site, { board: "notes" })),
    "access_denied",
  );
  assert.equal(
    await refusal(reply(site, { data: { logId: record.id, text: "no" } })),
    "document_not_found",
  );
  member(site, "m-1", { level: 5 });
  assert.equal(
    (await read(site, { id: record.id })).document.data.text,
    "private level body",
  );
  const { document: secret } = await write(site, {
    data: { board: "notes", text: "secret body", secret: true },
  });
  member(site, "m-2", { level: 5 });
  assert.equal(
    await refusal(read(site, { id: secret.id }, M2)),
    "document_not_found",
  );
  // A post the reader may not read is left out of the page, and so are
  // its comments.
  await reply(site, { data: { logId: secret.id, text: "mine" } });
  assert.deepEqual(
    (await listPage(site, { board: "notes" }, M2)).documents.map(
      (row) => row.id,
    ),
    [record.id],
  );
  assert.deepEqual(await commentsOf(site, secret.id, M2), []);
  moderator(site, "m-2");
  assert.equal(
    (await read(site, { id: secret.id }, M2)).document.data.text,
    "secret body",
  );
  assert.equal((await commentsOf(site, secret.id, M2)).length, 1);
});

test("board categories, required secrets and previews are validated without truncating stored posts", async () => {
  const site = await boardSite();
  board(site, "notes", {
    name: "Notes",
    kind: "text",
    secret: "required",
    categories: ["Alpha"],
  });
  assert.equal(
    await refusal(
      write(site, { data: { board: "notes", text: "x", category: "Unknown" } }),
    ),
    "invalid_input",
  );
  const { document: saved } = await write(site, {
    data: { board: "notes", text: "x".repeat(2000), category: "Alpha" },
  });
  assert.equal(saved.data.secret, true);
  // The page carries the whole post; it shows the start of it.
  const [listed] = (await listPage(site, { board: "notes" })).documents;
  assert.equal(listed.data.text.length, 2000);
  assert.equal(
    (await read(site, { id: saved.id })).document.data.text.length,
    2000,
  );
  // A secret post is its author's: an off board refuses one.
  board(site, "open", { kind: "text", secret: "off" });
  assert.equal(
    await refusal(
      write(site, { data: { board: "open", text: "x", secret: true } }),
    ),
    "invalid_input",
  );
});

test("content ownership, parent checks, revisions and moderator boundaries hold for posts", async () => {
  const site = await boardSite();
  const log = post(site, {
    owner: "m-2",
    image: "https://example.com/x.png",
    body: "original",
  });
  const edit = (revision) =>
    write(site, {
      id: log,
      data: { image: "https://example.com/x.png", text: "edit" },
      revision,
    });
  assert.equal(await refusal(edit("1")), "not_owned");
  moderator(site, "m-1");
  assert.equal(await refusal(edit("old")), "conflict");
  const { document: edited } = await edit("1");
  // A moderator's edit keeps the author.
  assert.equal(edited.data.owner, "m-2");
  assert.equal(edited.revision, "2");
  assert.equal(await refusal(edit("1")), "conflict");
  assert.equal(
    await refusal(reply(site, { data: { logId: "999", text: "orphan" } })),
    "document_not_found",
  );
  assert.equal(
    await refusal(write(site, { id: "999", data: { text: "x" } })),
    "document_not_found",
  );
});

test("deleting a post takes its comments, tags, calls and 관심 in one call", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const { document: log } = await write(site, {
    data: { image: "https://example.com/x.png", text: "#봄 [[둘]]" },
  });
  for (let n = 0; n < 120; n += 1)
    comment(site, { post_id: Number(log.id), owner: "m-2", body: "reply" });
  await site.mutate("community/posts:favorite", { id: log.id }, M2);
  assert.equal(count(site, "post_tags"), 1);
  assert.equal(count(site, "calls"), 1);
  assert.equal(
    await refusal(site.mutate("community/posts:remove", { id: log.id }, M2)),
    "not_owned",
  );
  assert.equal(
    await site.mutate("community/posts:remove", { id: log.id }, M1),
    null,
  );
  for (const table of [
    "posts",
    "comments",
    "posts_search",
    "comments_search",
    "post_tags",
    "calls",
    "favorites",
  ])
    assert.equal(count(site, table), 0, table);
  // A deleted post's number is not given to another.
  const { document: next } = await write(site, {
    data: { image: "https://example.com/y.png", text: "다음" },
  });
  assert.notEqual(next.id, log.id);
});

test("logs and comments speak as the member's own live character, fixed at posting", async () => {
  const { site, thread } = await roleplayWorld();
  const { document: log } = await write(site, {
    data: {
      image: "https://example.com/a.png",
      text: "As Hero",
      character: "1",
    },
  });
  assert.deepEqual(log.data.speaker, {
    character: "1",
    name: "Hero",
    type: "main",
    title: "Brave",
    titleImage: "https://example.com/brave.png",
    portrait: "https://example.com/hero.png",
  });
  assert.equal(log.data.character, "1");
  for (const character of ["2", "3", "missing", 7])
    assert.equal(
      await refusal(
        reply(site, { data: { logId: thread, text: "hi", character } }),
      ),
      "not_owned",
    );
  const { document: said } = await reply(site, {
    data: { logId: thread, text: "hi", character: "1" },
  });
  assert.equal(said.data.speaker.name, "Hero");
  // An edit cannot swap the speaker or forge one.
  const { document: edited } = await reply(site, {
    id: said.id,
    data: {
      ...said.data,
      text: "edited",
      character: "2",
      speaker: { name: "Forged" },
    },
  });
  assert.equal(edited.data.speaker.name, "Hero");
  assert.equal(edited.data.character, "1");
  // Without a character the post speaks as the nickname.
  const { document: plain } = await reply(site, {
    data: { logId: thread, text: "x" },
  });
  assert.equal(plain.data.speaker, undefined);
});

test("dice are rolled by the server once and cannot be rerolled or forged by edits", async () => {
  const { site, thread } = await roleplayWorld();
  const { document: rolled } = await rolling(0.99, () =>
    reply(site, {
      data: { logId: thread, text: "", dice: true, rolls: [1, 1] },
    }),
  );
  assert.deepEqual(rolled.data.rolls, [6, 6]);
  const { document: edited } = await rolling(0, () =>
    reply(site, {
      id: rolled.id,
      data: { ...rolled.data, text: "now", dice: false, rolls: [1, 1] },
    }),
  );
  assert.deepEqual(edited.data.rolls, [6, 6]);
  assert.equal(edited.data.dice, true);
  const { document: log } = await rolling(0, () =>
    write(site, {
      data: { image: "https://example.com/a.png", text: "", dice: true },
    }),
  );
  assert.deepEqual(log.data.rolls, [1, 1]);
  const { document: kept } = await rolling(0.5, () =>
    write(site, {
      id: log.id,
      data: { ...log.data, text: "t", dice: true, rolls: [6, 6] },
    }),
  );
  assert.deepEqual(kept.data.rolls, [1, 1]);
});

test("exploration is limited per character per Korean day and drops configured items", async () => {
  const { site, thread } = await roleplayWorld();
  const explore = (data = {}) =>
    rolling(0.1, () =>
      reply(site, {
        data: {
          logId: thread,
          text: "",
          character: "1",
          action: "explore",
          ...data,
        },
      }),
    );
  assert.equal(await refusal(explore()), "explore_closed");
  // 탐색사용 without 탐색 수행 가능 (cf_4, cf_6): set up, not yet open.
  setSettings(site, "community", {
    exploreLimit: 2,
    exploring: true,
    exploreOpen: false,
  });
  assert.equal(await refusal(explore()), "explore_closed");
  setSettings(site, "community", { exploreLimit: 2 });
  insert(site, "items", {
    id: "herb",
    name: "Herb",
    image: "https://example.com/herb.png",
  });
  insert(site, "explore", { id: "found", item_id: "herb", weight: 1 });
  insert(site, "explore", { id: "miss", item_id: null, weight: 3 });
  assert.equal(
    await refusal(explore({ character: undefined })),
    "no_character",
  );
  const { document: first } = await explore();
  assert.deepEqual(first.data.actions, [
    {
      type: "explore",
      item: "herb",
      name: "Herb",
      image: "https://example.com/herb.png",
      remaining: 1,
    },
  ]);
  assert.deepEqual(
    site
      .rows("SELECT item_id, character_id, origin FROM inventory")
      .map((row) => [row.item_id, row.character_id, row.origin]),
    [["herb", 1, "explore"]],
  );
  const missed = await rolling(0.9, () =>
    reply(site, {
      data: { logId: thread, text: "", character: "1", action: "explore" },
    }),
  );
  assert.equal(missed.document.data.actions[0].item, null);
  assert.equal(await refusal(explore()), "explore_limit");
  // 2026-10-16 15:00 UTC is midnight in Korea: a new day, counted on request.
  site.now = Date.parse("2026-10-16T15:00:00Z");
  assert.equal((await explore()).document.data.actions[0].remaining, 1);
  const hero = site.rows("SELECT * FROM characters WHERE id = 1")[0];
  assert.deepEqual([hero.explore_day, hero.explore_count], ["2026-10-17", 1]);
  // Approval is the sheet's state, which the review changes.
  site.run("UPDATE characters SET state = 'submitted' WHERE id = 1");
  assert.equal(await refusal(explore()), "not_approved");
  // Actions belong to boards that allow them.
  board(site, "default", { name: "Plain" });
  assert.equal(await refusal(explore()), "access_denied");
});

test("items used in a post are the speaker's own, logged and spent; only a draw does anything", async () => {
  const { site, thread } = await roleplayWorld();
  const item = (id, data) =>
    insert(site, "items", {
      id,
      usable_in_posts: 1,
      craft_material: 1,
      ...data,
    });
  item("letter", { name: "Letter", description: "A note" });
  item("box", { name: "Box", effect: { type: "draw" } });
  item("prize", { name: "Prize" });
  item("ticket", { name: "Ticket", effect: { type: "create" } });
  item("charm", { name: "Charm", description: "Kept", reusable: 1 });
  insert(site, "gacha", {
    id: "in-box",
    source: "box",
    item_id: "prize",
    weight: 1,
  });
  const own = (id, item_id, extra = {}) =>
    insert(site, "inventory", {
      id,
      owner: "m-1",
      item_id,
      name: item_id,
      character_id: 1,
      ...extra,
    });
  own(101, "letter");
  own(102, "box");
  own(103, "ticket");
  own(104, "charm");
  // Held by no character: the original's inventory is a character's.
  own(105, "letter", { character_id: null });
  own(106, "letter", { owner: "m-2", character_id: 2 });
  const held = (id) =>
    site.rows("SELECT 1 FROM inventory WHERE id = ?", id).length > 0;
  const use = (item, character = "1") =>
    reply(site, { data: { logId: thread, text: "uses", item, character } });
  assert.equal(await refusal(use("106")), "not_owned");
  assert.equal(await refusal(use("105")), "wrong_character");
  assert.equal(await refusal(use("102", null)), "no_character");
  const { document: letter } = await use("101");
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
  assert.equal(held(101), false);
  const { document: box } = await use("102");
  assert.deepEqual(box.data.actions[0].prize, { item: "prize", name: "Prize" });
  assert.equal(
    site.rows(
      "SELECT 1 FROM inventory WHERE item_id = 'prize' AND character_id = 1",
    ).length,
    1,
  );
  // A ticket is only shown used and spent: tickets work from the inventory
  // (write_update.inc.php:126-129 logs any item but 뽑기).
  const { document: ticket } = await use("103");
  assert.equal(ticket.data.actions[0].effect, "create");
  assert.equal(held(103), false);
  // A reusable item (it_use_ever) stays.
  await use("104");
  assert.equal(held(104), true);
  // A post's item needs an approved character; a comment's does not.
  site.run("UPDATE characters SET state = 'submitted' WHERE id = 1");
  assert.equal((await use("104")).document.data.actions.length, 1);
  assert.equal(
    await refusal(
      write(site, {
        data: {
          image: "https://example.com/p.png",
          text: "",
          character: "1",
          item: "104",
        },
      }),
    ),
    "not_approved",
  );
});

test("recovery in a post is logged, not applied: it heals from the inventory only", async () => {
  const { site } = await roleplayWorld();
  insert(site, "stats", { id: "hp", name: "HP", initial: 10, max: 100 });
  site.run(
    "UPDATE characters SET stats = ? WHERE id = 1",
    JSON.stringify({ hp: { allocated: 0, max: 10, current: 3, damage: 7 } }),
  );
  insert(site, "items", {
    id: "potion",
    name: "Potion",
    usable_in_posts: 1,
    craft_material: 1,
    effect: { type: "restore", stat: "hp", amount: 3 },
  });
  insert(site, "inventory", {
    id: 107,
    owner: "m-1",
    item_id: "potion",
    name: "Potion",
    character_id: 1,
  });
  const { document: posted } = await write(site, {
    data: {
      image: "https://example.com/p.png",
      text: "",
      character: "1",
      item: "107",
    },
  });
  assert.equal(posted.data.actions[0].effect, "restore");
  assert.equal(posted.data.actions[0].amount, undefined);
  assert.equal(count(site, "inventory"), 0);
  assert.equal(
    JSON.parse(site.rows("SELECT stats FROM characters WHERE id = 1")[0].stats)
      .hp.damage,
    7,
  );
});

test("[[nick]] calls and comment notices reach members who can read the post", async () => {
  const { site, thread } = await roleplayWorld();
  profile(site, "m-3", "세번째");
  const { document: said } = await reply(site, {
    data: {
      logId: thread,
      text: "[[세번째]] [[없는사람]] [[아보]] 안녕",
      character: "1",
    },
  });
  assert.equal(said.data.text, "[[세번째]] [[???]] [[아보]] 안녕");
  const rows = site.rows("SELECT * FROM calls ORDER BY id");
  assert.deepEqual(
    rows.map((row) => [row.recipient, row.kind, row.speaker, row.post_id]),
    [
      ["m-3", "call", "Hero", Number(thread)],
      ["m-2", "comment", "Hero", Number(thread)],
    ],
  );
  assert.equal(rows[0].preview, "세번째 ??? 아보 안녕");
  assert.equal(rows[0].comment_id, Number(said.id));
  // What the called see: a new call on their 알림 tab.
  assert.deepEqual(tabs(await site.query("community/inbox:status", null, M3)), {
    messages: 0,
    calls: true,
  });
  assert.deepEqual(tabs(await site.query("community/inbox:status", null, M1)), {
    messages: 0,
    calls: false,
  });
  // Editing calls only the newly named members.
  await reply(site, {
    id: said.id,
    data: { ...said.data, text: `${said.data.text} [[카도]]` },
  });
  assert.deepEqual(
    site
      .rows("SELECT recipient FROM calls WHERE id > ?", rows.at(-1).id)
      .map((row) => row.recipient),
    ["m-2"],
  );
  // A secret post calls nobody who cannot read it, and authors may opt out.
  const before = count(site, "calls");
  const hidden = post(site, {
    owner: "m-1",
    secret: 1,
    image: "https://example.com/x.png",
  });
  await reply(site, { data: { logId: hidden, text: "[[카도]]" } });
  site.run("UPDATE profiles SET comment_alerts = 0 WHERE member = 'm-2'");
  await reply(site, { data: { logId: thread, text: "hi" } });
  assert.equal(count(site, "calls"), before);
  // A log body may call too.
  await write(site, {
    data: { image: "https://example.com/a.png", text: "[[카도]] 보세요" },
  });
  assert.equal(count(site, "calls"), before + 1);
});

test("call history shows readable posts newest first and is cleared once seen", async () => {
  const { site, thread } = await roleplayWorld();
  await reply(site, { data: { logId: thread, text: "[[아보]] 여기요" } }, M2);
  const later = post(site, {
    owner: "m-2",
    image: "https://example.com/x.png",
    body: "x",
  });
  await reply(site, { data: { logId: later, text: "[[아보]]" } }, M2);
  site.run("UPDATE posts SET secret = 1 WHERE id = ?", Number(later));
  assert.equal(
    (await site.query("community/inbox:status", null, M1)).calls,
    true,
  );
  const history = await site.query("community/calls:callHistory", {}, M1);
  assert.equal(history.unread, true);
  assert.deepEqual(
    history.documents.map((row) => [
      row.data.logId,
      row.data.nick,
      row.data.unread,
    ]),
    [[thread, "카도", true]],
  );
  assert.equal(
    await refusal(site.query("community/calls:callHistory", { size: 50 }, M1)),
    "invalid_input",
  );
  site.now += 1000;
  assert.equal(
    await site.mutate("community/calls:seeCalls", undefined, M1),
    null,
  );
  assert.equal(
    (await site.query("community/inbox:status", null, M1)).calls,
    false,
  );
  assert.equal(
    (await site.query("community/calls:callHistory", {}, M1)).documents[0].data
      .unread,
    false,
  );
  // Pages of history follow the last one's ID.
  for (let n = 0; n < 3; n += 1)
    await reply(site, { data: { logId: thread, text: "[[아보]]" } }, M2);
  const first = await site.query(
    "community/calls:callHistory",
    { size: 2 },
    M1,
  );
  assert.equal(first.documents.length, 2);
  const second = await site.query(
    "community/calls:callHistory",
    { size: 2, after: first.nextCursor },
    M1,
  );
  // The secret post's call is left out of its page.
  assert.equal(second.documents.length, 1);
  const third = await site.query(
    "community/calls:callHistory",
    { size: 2, after: second.nextCursor },
    M1,
  );
  assert.deepEqual([third.documents.length, third.nextCursor], [1, null]);
  assert.equal(
    await refusal(site.query("community/calls:callHistory", {})),
    "sign_in",
  );
});

test("visitors read and post only on level-1 boards, as named guests with a password", async () => {
  const site = await boardSite();
  board(site, "free", PUBLIC_BOARD);
  board(site, "members", { ...PUBLIC_BOARD, listLevel: 2 });
  profile(site, "m-1", "회원");
  const { document: own } = await write(site, {
    data: { board: "free", text: "회원 글", image: null },
  });
  // Boards a guest may list; the members-only board and the default stay hidden.
  assert.deepEqual(
    (await site.query("community/boards:boards", null, VISITOR)).boards.map(
      (row) => row.id,
    ),
    ["free"],
  );
  assert.equal(
    await refusal(listPage(site, { board: "members" }, VISITOR)),
    "access_denied",
  );
  // A guest must name themselves and give a password; no secrets or actions.
  const guestPost = (data, guest) =>
    write(
      site,
      {
        data: { board: "free", image: null, ...data },
        ...(guest ? { guest } : {}),
      },
      VISITOR,
    );
  assert.equal(await refusal(guestPost({ text: "x" })), "guest_password");
  assert.equal(
    await refusal(guestPost({ text: "x" }, { name: " ", password: "1234" })),
    "invalid_input",
  );
  // A guest may write a secret post: it lists locked, opened by password.
  assert.equal(
    await refusal(
      guestPost(
        { text: "x", secret: true },
        { name: "길손", password: "1234" },
      ),
    ),
    null,
  );
  site.run("DELETE FROM posts WHERE secret = 1");
  const { document: saved } = await guestPost(
    { text: "[[회원]] 안녕", character: "c-1", dice: true },
    { name: "길손", password: "1234" },
  );
  assert.deepEqual(saved.data.guest, { name: "길손" });
  assert.equal(saved.data.owner, null);
  assert.equal(saved.data.character, undefined);
  assert.equal(saved.data.text, "[[회원]] 안녕");
  // A guest calls a member too, signed with their name.
  assert.deepEqual(
    callsTo(site, "m-1").map((row) => [row.sender, row.nick, row.kind]),
    [[null, "길손 (손님)", "call"]],
  );
  assert.equal(saved.data.rolls.length, 2);
  // The row keeps the password's hash, never the password.
  const [row] = site.rows("SELECT * FROM posts WHERE id = ?", Number(saved.id));
  assert.equal(row.guest_hash, "hash:1234");
  assert.equal(JSON.stringify(saved).includes("1234"), false);
  // Editing needs the password; a member's post can never be a guest's.
  const edit = (id, password, text = "고침") =>
    write(
      site,
      { id, data: { text, image: null }, guest: { password } },
      VISITOR,
    );
  assert.equal(await refusal(edit(saved.id, "0000")), "guest_password");
  assert.equal(await refusal(edit(own.id, "1234")), "guest_password");
  assert.equal((await edit(saved.id, "1234")).document.data.text, "고침");
  assert.deepEqual(
    (await read(site, { id: saved.id }, VISITOR)).document.data.guest,
    { name: "길손" },
  );
  // A guest comment tells the member author, as a guest.
  const { document: guestComment } = await reply(
    site,
    {
      data: { logId: own.id, text: "좋아요" },
      guest: { name: "길손", password: "abcd" },
    },
    VISITOR,
  );
  const call = callsTo(site, "m-1").at(-1);
  assert.deepEqual(
    [call.sender, call.nick, call.kind],
    [null, "길손 (손님)", "comment"],
  );
  assert.equal(
    await refusal(
      reply(
        site,
        {
          data: { logId: own.id, action: "explore" },
          guest: { name: "길손", password: "abcd" },
        },
        VISITOR,
      ),
    ),
    "access_denied",
  );
  // A guest's comment is theirs by its password too.
  assert.equal(
    await refusal(
      site.mutate(
        "community/comments:remove",
        { id: guestComment.id, guest: { password: "wrong" } },
        VISITOR,
      ),
    ),
    "guest_password",
  );
  // Deleting the post removes its comments.
  comment(site, {
    post_id: Number(saved.id),
    body: "댓글",
    guest_name: "길손",
  });
  assert.equal(
    await site.mutate(
      "community/posts:remove",
      { id: saved.id, guest: { password: "1234" } },
      VISITOR,
    ),
    null,
  );
  assert.equal(
    site.rows("SELECT 1 FROM comments WHERE post_id = ?", Number(saved.id))
      .length,
    0,
  );
  assert.equal(
    await site.mutate(
      "community/comments:remove",
      { id: guestComment.id, guest: { password: "abcd" } },
      VISITOR,
    ),
    null,
  );
});

test("logs are numbered per board, tagged for search, counted and moderated", async () => {
  const site = await boardSite();
  board(site, "free", PUBLIC_BOARD);
  const add = async (data) =>
    (await write(site, { data: { board: "free", image: null, ...data } }))
      .document;
  const first = await add({ text: "#봄 #꽃 #봄 산책" });
  const second = await add({ text: "두 번째 @1", secret: true });
  const third = await add({ text: "다른 #꽃" });
  assert.deepEqual(
    [first, second, third].map((log) => log.data.number),
    [1, 2, 3],
  );
  assert.deepEqual(first.data.tags, ["봄", "꽃"]);
  // Editing rewrites tags but keeps the number; members cannot pin.
  const { document: edited } = await write(site, {
    id: first.id,
    data: { text: "#여름", image: null, notice: true, number: 99 },
  });
  assert.deepEqual(edited.data.tags, ["여름"]);
  assert.equal(edited.data.number, 1);
  assert.equal(edited.data.notice, false);
  // A tag lists its posts, never another's secret one.
  await add({ text: "#꽃 비밀", secret: true });
  const tagged = await listPage(site, { board: "free", tag: "꽃" }, M2);
  assert.deepEqual(
    tagged.documents.map((row) => row.id),
    [third.id],
  );
  assert.equal(tagged.total, 1);
  // Counts only for the posts the page shows.
  for (let n = 0; n < 2; n += 1)
    comment(site, { post_id: Number(third.id), body: "c" });
  comment(site, { post_id: Number(second.id), body: "c" });
  const listed = await listPage(site, { board: "free" }, M2);
  assert.deepEqual(listed.counts, { [third.id]: 2, [first.id]: 0 });
  assert.equal(listed.total, 2);
  // Only moderators (and the owner) pin and move, and a move renumbers.
  const moderate = (args, who = M2) =>
    site.mutate("community/boards:moderatePost", args, who);
  assert.equal(
    await refusal(moderate({ id: third.id, notice: true })),
    "access_denied",
  );
  moderator(site, "m-2");
  board(site, "other", { ...PUBLIC_BOARD, name: "다른" });
  assert.equal(
    (await moderate({ id: third.id, notice: true })).document.data.notice,
    true,
  );
  // Notices come first; the staff see the secret ones too.
  assert.deepEqual(
    (await listPage(site, { board: "free" }, M2)).documents.map(
      (row) => row.data.number,
    ),
    [3, 4, 2, 1],
  );
  const { document: moved } = await moderate({ id: third.id, board: "other" });
  assert.equal(moved.data.board, "other");
  assert.equal(moved.data.number, 1);
  assert.equal(
    (await moderate({ id: third.id, notice: false }, OWNER)).document.data
      .notice,
    false,
  );
  // ?log=N reads a post by its board's number.
  assert.equal(
    (await read(site, { board: "other", number: 1 })).document.id,
    third.id,
  );
});

test("a board page shows its rows a page, its 분류, and others' secret questions locked", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, pageRows: 2, categories: ["잡담"] });
  for (let n = 1; n <= 5; n += 1)
    post(site, {
      board: "free",
      owner: "m-2",
      body: `글 ${n}`,
      category: n % 2 ? "잡담" : "",
    });
  const page = (args) => listPage(site, { board: "free", ...args }, VISITOR);
  const first = await page({});
  assert.deepEqual(
    [first.size, first.total, first.documents.map((row) => row.data.text)],
    [2, 5, ["글 5", "글 4"]],
  );
  assert.equal(first.board.data.pageRows, 2);
  assert.deepEqual(
    (await page({ page: 3 })).documents.map((row) => row.data.text),
    ["글 1"],
  );
  assert.deepEqual((await page({ page: 4 })).documents, []);
  const sorted = await page({ category: "잡담" });
  assert.equal(sorted.total, 3);
  assert.deepEqual(
    sorted.documents.map((row) => row.data.text),
    ["글 5", "글 3"],
  );
  // A Q&A board: whole questions, ten a page at most, others' secret ones
  // locked to be opened with their password.
  board(site, "qna", { ...PUBLIC_BOARD, kind: "qna", pageRows: 15 });
  for (let n = 0; n < 12; n += 1)
    post(site, {
      board: "qna",
      owner: "m-2",
      body: `<p>${"가".repeat(11_000)}</p>`,
      format: "html",
      secret: n === 11 ? 1 : 0,
    });
  const questions = await listPage(site, { board: "qna" }, M1);
  assert.equal(questions.size, 10);
  assert.equal(questions.total, 12);
  assert.equal(questions.documents[0].data.locked, true);
  assert.equal(questions.documents[0].data.text, undefined);
  assert.equal(questions.documents[1].data.text.length, 11_007);
  assert.equal(questions.counts[questions.documents[0].id], undefined);
  assert.equal(
    (await listPage(site, { board: "qna", page: 2 }, M1)).documents.length,
    2,
  );
});

test("HTML boards store longer rich bodies, tag their text and preview it plainly", async () => {
  const site = await boardSite();
  board(site, "rich", { ...PUBLIC_BOARD, html: true });
  const body = `<p style="color:#fff">#소식 ${"가".repeat(3000)}</p>`;
  const { document: saved } = await write(site, {
    data: { board: "rich", text: body, image: null },
  });
  assert.equal(saved.data.format, "html");
  assert.deepEqual(saved.data.tags, ["소식"]);
  const [row] = (await listPage(site, { board: "rich" }, M2)).documents;
  // The whole body is read; the page previews its text.
  assert.equal(row.data.format, "html");
  assert.equal(row.data.text, saved.data.text);
  // Plain boards keep their 2,000-character limit.
  await assert.rejects(
    write(site, {
      data: { text: "x".repeat(2001), image: "https://a.b/c.png" },
    }),
  );
});

test("a post's 조합 matches recipes by item, charges cost and consumes even on a miss; comments do not combine", async () => {
  const { site, thread } = await roleplayWorld();
  insert(site, "items", { id: "herb", name: "Herb", craft_material: 1 });
  insert(site, "items", { id: "water", name: "Water", craft_material: 1 });
  insert(site, "items", {
    id: "pot",
    name: "Pot",
    reusable: 1,
    craft_material: 1,
  });
  insert(site, "items", { id: "potion", name: "Potion" });
  insert(site, "recipes", {
    id: "brew",
    name: "Brew",
    item_id: "potion",
    cost: 5,
  });
  for (const item_id of ["water", "herb", "pot"])
    insert(site, "recipe_ingredients", {
      recipe_id: "brew",
      item_id,
      count: 1,
    });
  wallet(site, "m-1", 5);
  const own = (id, item_id, extra = {}) =>
    insert(site, "inventory", {
      id,
      owner: "m-1",
      item_id,
      name: item_id,
      character_id: 1,
      ...extra,
    });
  const held = (id) =>
    site.rows("SELECT 1 FROM inventory WHERE id = ?", id).length > 0;
  own(108, "herb");
  // Held by no character: not the speaker's (write.skin.php:238).
  own(105, "herb", { character_id: null });
  own(109, "water");
  own(110, "pot");
  own(111, "herb", { character_id: 99 });
  // 조합 is a post's (mmb/write.skin.php), not a comment's.
  assert.equal(
    await refusal(
      reply(site, {
        data: {
          logId: thread,
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
    write(site, {
      data: {
        image: "https://example.com/log.png",
        text: "",
        action: "combine",
        materials,
        character,
      },
    });
  // 조합(레시피)사용 (cf_5) off: no 조합 at all; nothing is spent.
  setSettings(site, "community", { recipes: false });
  assert.equal(await refusal(combine(["108"])), "recipes_off");
  setSettings(site, "community", {});
  assert.equal(await refusal(combine(["108"], null)), "no_character");
  assert.equal(await refusal(combine(["111"])), "not_owned");
  assert.equal(await refusal(combine(["105"])), "not_owned");
  assert.equal(await refusal(combine(["108", "108"])), "invalid_materials");
  const { document: made } = await combine(["110", "108", "109"]);
  assert.equal(made.data.actions[0].success, true);
  assert.equal(made.data.actions[0].name, "Potion");
  assert.equal(balanceOf(site, "m-1"), 0);
  assert.equal(held(108), false);
  assert.equal(held(110), true); // reusable
  assert.equal(
    site.rows(
      "SELECT 1 FROM inventory WHERE item_id = 'potion' AND character_id = 1",
    ).length,
    1,
  );
  own(201, "herb");
  const { document: missed } = await combine(["201", "110"]);
  assert.equal(missed.data.actions[0].success, false);
  assert.equal(held(201), false);
  // Only an approved character combines (write.skin.php:196).
  site.run("UPDATE characters SET state = 'submitted' WHERE id = 1");
  own(202, "herb");
  assert.equal(await refusal(combine(["202"])), "not_approved");
});

test("사이트공개: visitors read the boards while the site is open, and nothing once it is closed", async () => {
  const site = await boardSite();
  board(site, "free", PUBLIC_BOARD);
  insert(site, "board_groups", { id: "g", name: "그룹" });
  insert(site, "emoticons", {
    id: "smile",
    name: ":웃음:",
    image: "https://example.com/s.png",
  });
  const open = post(site, { board: "free", owner: "m-1", body: "공개 글" });
  const boards = (who = VISITOR) =>
    site.query("community/boards:boards", null, who);
  const opened = await boards();
  assert.deepEqual(
    [
      opened.boards.map((row) => row.id),
      opened.groups.map((row) => row.id),
      opened.emoticons.map((row) => row.data.name),
    ],
    [["free"], ["g"], [":웃음:"]],
  );
  assert.equal(
    (await read(site, { id: open }, VISITOR)).document.data.text,
    "공개 글",
  );
  // Closed: visitors read no boards, posts or catalogues, and post nothing,
  // as the original sends them to log in.
  setSettings(site, "community", { siteOpen: false });
  assert.deepEqual(await boards(), { boards: [], groups: [], emoticons: [] });
  assert.equal(
    await refusal(read(site, { id: open }, VISITOR)),
    "document_not_found",
  );
  assert.equal(
    await refusal(listPage(site, { board: "free" }, VISITOR)),
    "access_denied",
  );
  assert.equal(
    await refusal(
      write(
        site,
        {
          data: { board: "free", image: null, text: "손님 글" },
          guest: { name: "길손", password: "1234" },
        },
        VISITOR,
      ),
    ),
    "access_denied",
  );
  // Members read on as before.
  assert.deepEqual(
    (await boards(M2)).boards.map((row) => row.id),
    ["default", "free"],
  );
});

test("a members-only board group keeps its boards to its members and moderators", async () => {
  const site = await testSite();
  insert(site, "board_groups", { id: "staff", name: "운영", members_only: 1 });
  board(site, "plans", { name: "계획", kind: "text", group: "staff" });
  const listed = async () =>
    (await site.query("community/boards:boards", null, M1)).boards.map(
      (row) => row.id,
    );
  assert.deepEqual(await listed(), []);
  assert.equal(
    await refusal(write(site, { data: { board: "plans", text: "안녕" } })),
    "access_denied",
  );
  site.setRoles("m-1", ["group-staff"]);
  assert.deepEqual(await listed(), ["plans"]);
  const [listedBoard] = (await site.query("community/boards:boards", null, M1))
    .boards;
  assert.equal(listedBoard.data.membersOnly, "staff");
  await write(site, { data: { board: "plans", text: "안녕" } });
  // Moderators reach every group; an open group is everyone's.
  site.setRoles("m-1", ["staff"]);
  assert.deepEqual(await listed(), ["plans"]);
  site.run("UPDATE board_groups SET members_only = 0");
  site.setRoles("m-1", []);
  assert.deepEqual(await listed(), ["plans"]);
});

test("a board search finds titles, text and nicknames among posts the reader may read", async () => {
  const site = await boardSite();
  board(site, "free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  profile(site, "m-2", "보라돌이");
  const a = post(site, { board: "free", owner: "m-2", title: "봄 소풍" });
  const b = post(site, { board: "free", owner: "m-2", body: "여름 바다" });
  post(site, { board: "free", owner: "m-2", body: "봄 비밀", secret: 1 });
  const found = async (text) =>
    (await search(site, { board: "free", text })).documents
      .map((row) => row.id)
      .sort();
  assert.deepEqual(await found("봄"), [a]);
  assert.deepEqual(await found("바다"), [b]);
  assert.deepEqual(await found("보라"), [a, b].sort());
  // LIKE's own characters are only themselves.
  assert.deepEqual(await found("%"), []);
  assert.equal(
    await refusal(search(site, { board: "free", text: " " })),
    "invalid_input",
  );
});

test("a board's newest post is what its readers may see, by members only", async () => {
  const site = await boardSite();
  board(site, "free", PUBLIC_BOARD);
  board(site, "staff", { kind: "text", listLevel: 5, readLevel: 5 });
  const latest = (board, who = M2) =>
    site.query("community/posts:latest", { board }, who);
  assert.deepEqual(await latest("free"), { id: null });
  const { document: first } = await write(site, {
    data: { board: "free", text: "회원 글" },
  });
  assert.deepEqual(await latest("free"), { id: first.id });
  assert.deepEqual(await latest("free", VISITOR), { id: first.id });
  // A secret post is its author's; a guest's is not announced.
  const { document: secret } = await write(site, {
    data: { board: "free", text: "비밀", secret: true },
  });
  assert.deepEqual(await latest("free"), { id: first.id });
  assert.deepEqual(await latest("free", M1), { id: secret.id });
  await write(
    site,
    {
      data: { board: "free", text: "손님 글" },
      guest: { name: "길손", password: "pass1234" },
    },
    VISITOR,
  );
  assert.deepEqual(await latest("free"), { id: first.id });
  // A board the reader may not list has none for them.
  moderator(site, "m-3");
  await write(site, { data: { board: "staff", text: "운영" } }, M3);
  assert.deepEqual(await latest("staff"), { id: null });
});

test("a Q&A board lets guests ask in secret and open their question with its password", async () => {
  const site = await testSite();
  board(site, "qna", {
    name: "문의",
    kind: "qna",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    commentLevel: 9,
  });
  board(site, "free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
  });
  const guest = { name: "길손", password: "pass1234" };
  // On any board, a guest's secret post lists locked and opens by password.
  const { document: hidden } = await write(
    site,
    { data: { board: "free", text: "비밀이에요", secret: true }, guest },
    VISITOR,
  );
  const free = (await listPage(site, { board: "free" }, VISITOR)).documents;
  assert.deepEqual(
    free.map((row) => [row.id, row.data.locked, row.data.text]),
    [[hidden.id, true, undefined]],
  );
  assert.equal(
    (
      await site.query(
        "community/posts:open",
        { id: hidden.id, password: guest.password },
        VISITOR,
      )
    ).document.data.text,
    "비밀이에요",
  );
  const { document: asked } = await write(
    site,
    { data: { board: "qna", text: "환불되나요?", secret: true }, guest },
    VISITOR,
  );
  const listed = (await listPage(site, { board: "qna" }, VISITOR)).documents;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].data.locked, true);
  assert.equal(listed[0].data.text, undefined);
  assert.deepEqual(listed[0].data.guest, { name: "길손" });
  const open = (password) =>
    site.query("community/posts:open", { id: asked.id, password }, VISITOR);
  assert.equal(await refusal(open("wrong")), "guest_password");
  assert.equal((await open("pass1234")).document.data.text, "환불되나요?");
});

test("on a Q&A board only moderators and the owner answer", async () => {
  const site = await testSite();
  // Comments open to everyone, so only the board's kind keeps them out.
  board(site, "qna", {
    name: "문의",
    kind: "qna",
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    commentLevel: 1,
  });
  const ask = post(site, { board: "qna", body: "환불되나요?" });
  const answer = (who, guest) =>
    reply(
      site,
      { data: { logId: ask, text: "답변" }, ...(guest ? { guest } : {}) },
      who,
    );
  // skin/board/qna/list.skin.php:85-87: the reply link is $is_admin's.
  assert.equal(await refusal(answer(M1)), "answers_staff_only");
  assert.equal(
    await refusal(answer(VISITOR, { name: "길손", password: "pass1234" })),
    "answers_staff_only",
  );
  moderator(site, "m-1");
  assert.equal((await answer(M1)).document.data.text, "답변");
  const { document: owners } = await answer(OWNER);
  assert.equal(owners.data.text, "답변");
  // The site owner's comments carry the admin mark (view_comment.skin.php:38).
  assert.equal(owners.data.admin, true);
});

test("a settlement is settled by a moderator, granting experience and money, then stays", async () => {
  const site = await boardSite();
  board(site, "calc", {
    name: "정산",
    kind: "settlement",
    categories: ["이벤트"],
  });
  insert(site, "characters", {
    owner: "m-1",
    name: "용사",
    created_at: site.now,
  });
  const { document: request } = await write(site, {
    data: {
      board: "calc",
      category: "이벤트",
      text: "참여했어요",
      character: "1",
    },
  });
  const settle = (args, who = M2) =>
    site.mutate("community/posts:settle", { id: request.id, ...args }, who);
  assert.equal(
    await refusal(settle({ state: "정산완료", exp: 5 }, M1)),
    "access_denied",
  );
  moderator(site, "m-2");
  const { document: settled } = await settle({
    state: "정산완료",
    exp: 5,
    money: 30,
    memo: "수고하셨습니다",
  });
  assert.equal(settled.data.settlement.state, "정산완료");
  assert.equal(site.rows("SELECT exp FROM characters WHERE id = 1")[0].exp, 5);
  assert.equal(balanceOf(site, "m-1"), 30);
  assert.deepEqual(
    site.rows("SELECT kind FROM history ORDER BY kind").map((row) => row.kind),
    ["exp", "settle"],
  );
  // The reply says what was given.
  const [answer] = await commentsOf(site, request.id);
  assert.match(
    answer.data.text,
    /\[정산완료\] 경험치 \+5 \+30 아보 수고하셨습니다/,
  );
  assert.equal(answer.data.settlement, true);
  // Its search finds the post by it.
  assert.deepEqual(indexed(site, "comments_search", "수고하셨습니다"), [
    answer.id,
  ]);
  // The author can no longer change or delete it.
  assert.equal(
    await refusal(
      write(site, { id: request.id, data: { ...request.data, text: "고침" } }),
    ),
    "settled",
  );
  assert.equal(
    await refusal(
      site.mutate("community/posts:remove", { id: request.id }, M1),
    ),
    "settled",
  );
  // Only the original's two states (caculate/write_comment.php).
  assert.equal(await refusal(settle({ state: "보류" })), "invalid_input");
  // A request is paid once; changing only the state is still the staff's.
  assert.equal(
    await refusal(settle({ state: "정산완료", money: 10 })),
    "settled",
  );
  await settle({ state: "반려" });
  assert.equal(balanceOf(site, "m-1"), 30);
  // A moderator does not pay their own request; the owner settles any.
  const { document: own } = await write(
    site,
    { data: { board: "calc", category: "이벤트", text: "내 것" } },
    M2,
  );
  assert.equal(
    await refusal(
      site.mutate(
        "community/posts:settle",
        { id: own.id, state: "정산완료", money: 5 },
        M2,
      ),
    ),
    "own_settlement",
  );
  await site.mutate(
    "community/posts:settle",
    { id: own.id, state: "정산완료", money: 5 },
    OWNER,
  );
  assert.equal(balanceOf(site, "m-2"), 5);
});

test("a board search reaches every post at once and pages what it finds", async () => {
  const site = await boardSite();
  board(site, "free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  insert(site, "characters", {
    id: 9,
    owner: "m-9",
    name: "보물찾기단",
    created_at: site.now,
  });
  const ids = [];
  for (let n = 0; n < 650; n += 1)
    ids.push(
      post(site, {
        board: "free",
        owner: "m-1",
        body: n === 0 ? "아주 오래된 보물" : n >= 625 ? `조개 ${n}` : `글 ${n}`,
        ...(n === 300 ? { character_id: 9 } : {}),
      }),
    );
  const found = (page) => page.documents.map((row) => row.id).sort();
  // The oldest post, and one written as a character named so.
  assert.deepEqual(
    found(await search(site, { board: "free", text: "보물" })),
    [ids[0], ids[300]].sort(),
  );
  // 25 finds: 20, then 5.
  const first = await search(site, { board: "free", text: "조개" });
  assert.equal(first.documents.length, 20);
  const second = await search(site, {
    board: "free",
    text: "조개",
    after: first.nextCursor,
  });
  assert.equal(second.documents.length, 5);
  assert.equal(second.nextCursor, null);
  // 300 characters of each, as the original's search shows (bbs/search.php).
  post(site, { board: "free", body: `파도 ${"가".repeat(400)}` });
  const [long] = (await search(site, { board: "free", text: "파도" }))
    .documents;
  assert.equal(long.data.text.length, 301);
  assert.equal(long.data.truncated, true);
});

test("멤버공개 is locked for visitors, and 익명 hides its author from all but them and the staff", async () => {
  const { site } = await roleplayWorld();
  board(site, "default", {
    ...LOG_BOARD,
    listLevel: 1,
    readLevel: 1,
    writeLevel: 1,
    anonymous: true,
  });
  const add = (data) =>
    write(site, { data: { image: "https://example.com/a.png", ...data } });
  const { document: hidden } = await add({
    text: "멤버만 #비밀",
    membersOnly: true,
    adult: true,
    fold: true,
  });
  const { document: masked } = await add({
    text: "누가 썼을까",
    anonymous: true,
    character: "1",
  });
  await reply(site, { data: { logId: hidden.id, text: "댓글" } });
  // A visitor: the 멤버공개 post shows its number and marks, locked...
  const seen = (await read(site, { id: hidden.id }, VISITOR)).document.data;
  assert.equal(seen.locked, true);
  assert.equal(seen.adult, true);
  assert.equal(seen.image, undefined);
  assert.equal(seen.text, undefined);
  assert.equal(seen.owner, null);
  // ...with none of its comments or count, and its tags find nothing.
  assert.deepEqual(await commentsOf(site, hidden.id, VISITOR), []);
  const listed = await listPage(site, { board: "default" }, VISITOR);
  assert.equal(listed.counts[hidden.id], undefined);
  assert.equal(
    (await listPage(site, { board: "default", tag: "비밀" }, VISITOR)).total,
    0,
  );
  assert.equal(
    (await listPage(site, { board: "default", tag: "비밀" }, M2)).total,
    1,
  );
  // Another member: the 익명 post names no one.
  const other = (await read(site, { id: masked.id }, M2)).document.data;
  assert.deepEqual(
    [other.owner, other.speaker, other.character],
    [null, undefined, undefined],
  );
  assert.equal(other.anonymous, true);
  // Nor can they find it by its author's name.
  const found = await search(site, { board: "default", text: "아보" }, M2);
  assert.equal(
    found.documents.some((row) => row.id === masked.id),
    false,
  );
  // The staff see who wrote it, and find it.
  moderator(site, "m-3");
  assert.equal(
    (await read(site, { id: masked.id }, M3)).document.data.owner,
    "m-1",
  );
  assert.equal(
    (await search(site, { board: "default", text: "Hero" }, M3)).documents
      .length,
    1,
  );
  // Its author sees it as theirs, and lists it in 로그내역.
  assert.equal(
    (await read(site, { id: masked.id })).document.data.owner,
    "m-1",
  );
  assert.deepEqual(
    (await site.query("community/posts:mine", undefined, M1)).documents
      .map((row) => row.id)
      .sort(),
    [hidden.id, masked.id].sort(),
  );
  // A guest cannot post 멤버공개, 19금 or 익명.
  const { document: guest } = await write(
    site,
    {
      guest: { name: "손님", password: "secret-1" },
      data: {
        image: "https://example.com/g.png",
        membersOnly: true,
        anonymous: true,
      },
    },
    VISITOR,
  );
  assert.deepEqual(
    [guest.data.membersOnly, guest.data.anonymous],
    [false, false],
  );
});

test("관심 keeps a member's favourite posts, theirs alone, and 경고내역 shows their warnings", async () => {
  const { site, thread } = await roleplayWorld();
  member(site, "m-1", { warnings: 2, warningNote: "도배" });
  const status = await site.query(
    "community/membership:membership",
    undefined,
    M1,
  );
  assert.deepEqual([status.warnings, status.warningNote], [2, "도배"]);
  const favorite = (id, who = M1) =>
    site.mutate("community/posts:favorite", { id }, who);
  const favorites = (who = M1) =>
    site.query("community/posts:favorites", undefined, who);
  assert.deepEqual(await favorite(thread), { favorite: true });
  assert.deepEqual(
    (await favorites()).documents.map((row) => row.id),
    [thread],
  );
  assert.deepEqual(
    (await site.query("community/profiles:own", undefined, M1)).profile.data
      .favorites,
    [thread],
  );
  assert.deepEqual((await favorites(M2)).documents, []);
  // A post they can no longer read stays out, but counts.
  site.run("UPDATE posts SET secret = 1 WHERE id = ?", Number(thread));
  assert.deepEqual(await favorites(), { documents: [], total: 1 });
  site.run("UPDATE posts SET secret = 0 WHERE id = ?", Number(thread));
  assert.deepEqual(await favorite(thread), { favorite: false });
  assert.deepEqual((await favorites()).documents, []);
  assert.equal(await refusal(favorite("999")), "document_not_found");
  assert.equal(
    await refusal(site.mutate("community/posts:favorite", { id: thread })),
    "sign_in",
  );
  assert.equal((await favorites(VISITOR)).total, 0);
});

test("items stay out of posts or 조합 as the owner marks them", async () => {
  const { site } = await roleplayWorld();
  insert(site, "items", {
    id: "note",
    name: "쪽지",
    effect: { type: "draw" },
    usable_in_posts: 0,
  });
  insert(site, "items", { id: "stone", name: "돌", craft_material: 0 });
  // Both flags start off (adm/item_form.php:217): an item without them is
  // kept out too.
  insert(site, "items", {
    id: "plain",
    name: "평범",
    effect: { type: "draw" },
  });
  for (const [id, item_id] of [
    [114, "plain"],
    [115, "note"],
    [116, "stone"],
  ])
    insert(site, "inventory", {
      id,
      owner: "m-1",
      item_id,
      character_id: 1,
      name: item_id,
    });
  const add = (data) =>
    write(site, {
      data: {
        image: "https://example.com/p.png",
        text: "",
        character: "1",
        ...data,
      },
    });
  assert.equal(await refusal(add({ item: "115" })), "not_usable");
  assert.equal(await refusal(add({ item: "114" })), "not_usable");
  assert.equal(
    await refusal(add({ action: "combine", materials: ["114"] })),
    "not_material",
  );
  assert.equal(
    await refusal(add({ action: "combine", materials: ["116"] })),
    "not_material",
  );
});

test("a post may 탐색, and one that recorded 탐색 or 조합 stays but for the staff", async () => {
  const { site } = await roleplayWorld();
  setSettings(site, "community", { exploreLimit: 3 });
  insert(site, "items", {
    id: "herb",
    name: "Herb",
    usable_in_posts: 1,
    craft_material: 1,
  });
  insert(site, "explore", { id: "found", item_id: "herb", weight: 1 });
  insert(site, "items", {
    id: "letter",
    name: "Letter",
    usable_in_posts: 1,
    craft_material: 1,
  });
  insert(site, "inventory", {
    id: 101,
    owner: "m-1",
    item_id: "letter",
    name: "Letter",
    character_id: 1,
  });
  const add = (data) =>
    rolling(0.1, () =>
      write(site, {
        data: {
          image: "https://example.com/p.png",
          text: "",
          character: "1",
          ...data,
        },
      }),
    );
  const remove = (id, who = M1) =>
    site.mutate("community/posts:remove", { id }, who);
  const { document: explored } = await add({ action: "explore" });
  assert.equal(explored.data.actions[0].type, "explore");
  assert.equal(explored.data.actions[0].item, "herb");
  assert.equal(await refusal(remove(explored.id)), "acted");
  // An item's use alone (wr_item_log) does not keep a post.
  const { document: used } = await add({ item: "101" });
  assert.equal(await remove(used.id), null);
  moderator(site, "m-1");
  assert.equal(await remove(explored.id), null);
});

test("an edit adds dice and actions a post has none of yet, once", async () => {
  const { site } = await roleplayWorld();
  setSettings(site, "community", { exploreLimit: 3 });
  insert(site, "items", {
    id: "herb",
    name: "Herb",
    usable_in_posts: 1,
    craft_material: 1,
  });
  insert(site, "explore", { id: "found", item_id: "herb", weight: 1 });
  const fresh = async () =>
    (
      await write(site, {
        data: {
          image: "https://example.com/p.png",
          text: "",
          character: "1",
        },
      })
    ).document;
  const edit = async (row, data, who = M1, roll = 0.1) =>
    (
      await rolling(roll, () =>
        write(site, { id: row.id, data: { ...row.data, ...data } }, who),
      )
    ).document;
  const plain = await fresh();
  const diced = await edit(plain, { dice: true });
  assert.equal(diced.data.dice, true);
  assert.deepEqual(diced.data.rolls, [1, 1]);
  assert.deepEqual(
    (await edit(diced, { dice: true }, M1, 0.9)).data.rolls,
    [1, 1],
  );
  const explored = await edit(diced, { action: "explore" });
  assert.equal(explored.data.actions[0].type, "explore");
  assert.equal(
    await refusal(edit(explored, { action: "explore" })),
    "already_acted",
  );
  // Another's post: a moderator edits it, but acts for no one.
  const theirs = await fresh();
  moderator(site, "m-2");
  assert.equal(
    await refusal(edit(theirs, { action: "explore" }, M2)),
    "access_denied",
  );
  assert.equal((await edit(theirs, { dice: true }, M2)).data.dice, true);
});

test("a post with others' comments is no longer edited but by the staff (bo_count_modify)", async () => {
  const { site } = await roleplayWorld();
  const { document: log } = await write(site, {
    data: { image: "https://example.com/p.png", text: "a" },
  });
  const edit = () =>
    write(site, { id: log.id, data: { ...log.data, text: "b" } });
  await reply(site, { data: { logId: log.id, text: "mine" } });
  assert.equal(await reasonOf(edit()), "ok");
  await reply(site, { data: { logId: log.id, text: "theirs" } }, M2);
  assert.equal(await reasonOf(edit()), "commented");
  site.run("UPDATE boards SET edit_lock = 2 WHERE id = 'default'");
  assert.equal(await reasonOf(edit()), "ok");
  site.run("UPDATE boards SET edit_lock = 1 WHERE id = 'default'");
  moderator(site, "m-1");
  assert.equal(await reasonOf(edit()), "ok");
});

test("boards pay for posts and comments, and take it back when they are deleted", async () => {
  const { site } = await roleplayWorld();
  site.run(
    "UPDATE boards SET write_reward = 10, comment_reward = 3 WHERE id = 'default'",
  );
  const { document: log } = await write(site, {
    data: { image: "https://example.com/p.png", text: "a" },
  });
  assert.equal(log.data.reward, 10);
  assert.equal(balanceOf(site, "m-1"), 10);
  const { document: said } = await reply(
    site,
    { data: { logId: log.id, text: "hi" } },
    M2,
  );
  await reply(site, { data: { logId: log.id, text: "again" } }, M2);
  assert.equal(balanceOf(site, "m-2"), 6);
  // An edit pays nothing more.
  await reply(
    site,
    { id: said.id, data: { ...said.data, text: "edited" } },
    M2,
  );
  assert.equal(balanceOf(site, "m-2"), 6);
  await site.mutate("community/comments:remove", { id: said.id }, M2);
  assert.equal(balanceOf(site, "m-2"), 3);
  await site.mutate("community/posts:remove", { id: log.id }, M1);
  assert.equal(balanceOf(site, "m-1"), 0);
  // The remaining comment's reward went back with the post.
  assert.equal(balanceOf(site, "m-2"), 0);
  const number = log.data.number;
  assert.deepEqual(
    site
      .rows(
        "SELECT owner, delta, balance, memo FROM history WHERE kind = 'board' ORDER BY id",
      )
      .map((row) => [row.owner, row.delta, row.balance, row.memo]),
    [
      ["m-1", 10, 10, `로그 ${number} 글쓰기`],
      ["m-2", 3, 3, `로그 ${number} 댓글쓰기`],
      ["m-2", 3, 6, `로그 ${number} 댓글쓰기`],
      ["m-2", -3, 3, `로그 ${number} 댓글삭제`],
      ["m-1", -10, 0, `로그 ${number} 글삭제`],
      ["m-2", -3, 0, `로그 ${number} 댓글삭제`],
    ],
  );
  // Guests are paid nothing.
  site.run(
    "UPDATE boards SET write_level = 1, list_level = 1, read_level = 1 WHERE id = 'default'",
  );
  const { document: guestLog } = await write(
    site,
    {
      data: { image: "https://example.com/p.png", text: "g" },
      guest: { name: "길손", password: "pass1234" },
    },
    VISITOR,
  );
  assert.equal(guestLog.data.reward, undefined);
});

test("a board search also finds posts by their comments' text and writers", async () => {
  const site = await testSite();
  board(site, "free", {
    name: "자유",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  board(site, "other", {
    name: "다른",
    kind: "text",
    listLevel: 1,
    readLevel: 1,
  });
  profile(site, "m-2", "보라돌이");
  const a = post(site, { board: "free", owner: "m-3", body: "봄" });
  const b = post(site, { board: "free", owner: "m-3", body: "여름" });
  const c = post(site, {
    board: "free",
    owner: "m-3",
    body: "가을",
    secret: 1,
  });
  const d = post(site, { board: "other", owner: "m-3", body: "겨울" });
  const e = post(site, { board: "free", owner: "m-3", body: "바다" });
  for (const [on, owner, body, anonymous = 0] of [
    [a, "m-3", "바다"],
    [b, "m-2", "hi"],
    [c, "m-3", "바다"],
    [d, "m-3", "바다"],
    [e, "m-3", "바다"],
    [b, "m-2", "익명", 1],
  ])
    comment(site, { post_id: Number(on), owner, body, anonymous });
  const found = async (text, after = null) =>
    await search(site, { board: "free", text, after });
  // e matched itself; c is secret; d is another board's.
  assert.deepEqual(
    (await found("바다")).documents.map((row) => row.id),
    [e, a],
  );
  assert.deepEqual(
    (await found("보라")).documents.map((row) => row.id),
    [b],
  );
  // A post found by many comments shows once; the comments' finds page on.
  for (let n = 0; n < 25; n += 1)
    comment(site, { post_id: Number(b), owner: "m-3", body: "파도" });
  for (let n = 0; n < 25; n += 1) {
    const each = post(site, { board: "free", owner: "m-3", body: `글 ${n}` });
    comment(site, { post_id: Number(each), owner: "m-3", body: "파도" });
  }
  const first = await found("파도");
  assert.equal(first.documents.length, 20);
  assert.match(first.nextCursor, /^comments:/);
  const second = await found("파도", first.nextCursor);
  assert.equal(second.documents.length, 6);
  assert.equal(second.nextCursor, null);
  assert.equal(second.documents.at(-1).id, b);
});

test("a board search finds 3-character terms by the full-text tables, shorter ones too, and follows every write", async () => {
  const { site } = await roleplayWorld();
  board(site, "free", PUBLIC_BOARD);
  board(site, "other", PUBLIC_BOARD);
  board(site, "rich", { ...PUBLIC_BOARD, html: true });
  const add = (data, who = M1) =>
    write(site, { data: { board: "free", image: null, ...data } }, who);
  const { document: spring } = await add({
    title: "봄날의 소풍",
    text: "벚꽃이 피었다",
  });
  const { document: summer } = await add({ text: "여름 바다 여행 Hello" });
  // Korean pieces of 3 or more, through the index; across words, any case.
  assert.deepEqual(indexed(site, "posts_search", "벚꽃이"), [spring.id]);
  assert.deepEqual(await searched(site, "free", "벚꽃이 피"), [spring.id]);
  assert.deepEqual(await searched(site, "free", "날의 소"), [spring.id]);
  assert.deepEqual(await searched(site, "free", "바다 여행"), [summer.id]);
  assert.deepEqual(await searched(site, "free", "hello"), [summer.id]);
  // Shorter terms still find, by LIKE.
  assert.deepEqual(await searched(site, "free", "소풍"), [spring.id]);
  assert.deepEqual(await searched(site, "free", "봄"), [spring.id]);
  assert.deepEqual(await searched(site, "free", "바다"), [summer.id]);
  // MATCH's own syntax is only text.
  for (const text of ['"벚꽃', "벚꽃이 OR 여름", "NEAR(벚꽃 여름)", "벚* 피"])
    assert.deepEqual(await searched(site, "free", text), [], text);
  // An edit's new text is found, its old text no longer.
  await write(site, {
    id: spring.id,
    revision: spring.revision,
    data: { ...spring.data, title: "가을", text: "단풍이 들었다" },
  });
  assert.deepEqual(await searched(site, "free", "벚꽃이"), []);
  assert.deepEqual(await searched(site, "free", "벚꽃"), []);
  assert.deepEqual(await searched(site, "free", "단풍이"), [spring.id]);
  assert.deepEqual(await searched(site, "free", "날의 소"), []);
  // A post moved to another board is searched there.
  await site.mutate(
    "community/boards:moderatePost",
    { id: spring.id, board: "other" },
    OWNER,
  );
  assert.deepEqual(await searched(site, "free", "단풍이"), []);
  assert.deepEqual(await searched(site, "other", "단풍이"), [spring.id]);
  // An HTML post is searched by its text, not its markup.
  const { document: rich } = await add({
    board: "rich",
    text: '<p class="note">무지개 다리</p>',
  });
  assert.deepEqual(await searched(site, "rich", "무지개 다"), [rich.id]);
  assert.deepEqual(await searched(site, "rich", "class"), []);
  // Comments: written, edited and deleted.
  const { document: said } = await reply(
    site,
    { data: { logId: summer.id, text: "조개껍데기 줍기" } },
    M2,
  );
  assert.deepEqual(await searched(site, "free", "조개껍데기"), [summer.id]);
  await reply(
    site,
    { id: said.id, revision: said.revision, data: { text: "모래성 쌓기" } },
    M2,
  );
  assert.deepEqual(await searched(site, "free", "조개껍"), []);
  assert.deepEqual(await searched(site, "free", "모래성"), [summer.id]);
  assert.deepEqual(await searched(site, "free", "모래"), [summer.id]);
  await site.mutate("community/comments:remove", { id: said.id }, M2);
  assert.deepEqual(await searched(site, "free", "모래성"), []);
  assert.deepEqual(indexed(site, "comments_search", "모래성"), []);
  // A deleted post takes its full-text rows and its comments'.
  await reply(site, { data: { logId: summer.id, text: "파도 소리" } }, M2);
  await site.mutate("community/posts:remove", { id: summer.id }, M1);
  assert.deepEqual(await searched(site, "free", "바다 여행"), []);
  assert.deepEqual(await searched(site, "free", "파도 소"), []);
  assert.deepEqual(indexed(site, "comments_search", "파도 소"), []);
  // Every post and comment has its row, and nothing else does.
  assert.deepEqual(
    site.rows("SELECT rowid AS id FROM posts_search ORDER BY rowid"),
    site.rows("SELECT id FROM posts ORDER BY id"),
  );
  assert.deepEqual(
    site.rows("SELECT rowid AS id FROM comments_search ORDER BY rowid"),
    site.rows("SELECT id FROM comments ORDER BY id"),
  );
});

test("a board search shows the same posts by any length of term: secret, 멤버공개, 19금, 익명 and members-only boards", async () => {
  const site = await boardSite();
  board(site, "free", PUBLIC_BOARD);
  profile(site, "m-2", "보라돌이");
  const at = (data) =>
    post(site, { board: "free", owner: "m-2", title: "비밀스러운", ...data });
  const open = at({ body: "공개" });
  const secret = at({ body: "비밀", secret: 1 });
  const members = at({ body: "회원", members_only: 1 });
  const adult = at({ body: "성인", adult: 1 });
  const masked = at({ title: "", body: "고백", anonymous: 1 });
  moderator(site, "m-3");
  // A long term and a short one find the same posts for each reader.
  for (const text of ["비밀스러운", "비밀"]) {
    assert.deepEqual(
      await searched(site, "free", text, VISITOR),
      [open, adult].sort(),
      text,
    );
    assert.deepEqual(
      await searched(site, "free", text, M1),
      [open, members, adult].sort(),
      text,
    );
    assert.deepEqual(
      await searched(site, "free", text, M2),
      [open, secret, members, adult].sort(),
      text,
    );
    assert.deepEqual(
      await searched(site, "free", text, M3),
      [open, secret, members, adult].sort(),
      text,
    );
  }
  // An author's name finds no 익명 post, but for the staff.
  assert.deepEqual(
    (await searched(site, "free", "보라돌", M1)).includes(masked),
    false,
  );
  assert.equal(
    (await searched(site, "free", "보라돌", M3)).includes(masked),
    true,
  );
  // A secret post is not found by its comments either.
  comment(site, { post_id: Number(secret), owner: "m-2", body: "속삭이는 말" });
  assert.deepEqual(await searched(site, "free", "속삭이는", M1), []);
  assert.deepEqual(await searched(site, "free", "속삭이는", M2), [secret]);
  assert.deepEqual(await searched(site, "free", "속삭", M2), [secret]);
  // A members-only group's board is searched by its members alone.
  insert(site, "board_groups", { id: "staff", name: "운영", members_only: 1 });
  board(site, "plans", { name: "계획", kind: "text", group: "staff" });
  const plan = post(site, {
    board: "plans",
    owner: "m-2",
    body: "다음 행사 계획",
  });
  assert.equal(
    await refusal(search(site, { board: "plans", text: "행사 계획" })),
    "access_denied",
  );
  site.setRoles("m-1", ["group-staff"]);
  assert.deepEqual(await searched(site, "plans", "행사 계획"), [plan]);
  assert.deepEqual(await searched(site, "plans", "행사"), [plan]);
});

test("the search migration fills its full-text tables from the posts and comments before it", async () => {
  const site = await testSite({ pending: "0006" });
  board(site, "free", PUBLIC_BOARD);
  const old = insert(site, "posts", {
    board: "free",
    number: 1,
    title: "오래된 이야기",
    body: "첫 번째 로그",
    created_at: site.now,
    updated_at: site.now,
  });
  const other = insert(site, "posts", {
    board: "free",
    number: 2,
    body: "두 번째",
    created_at: site.now,
    updated_at: site.now,
  });
  insert(site, "comments", {
    post_id: Number(other),
    body: "예전에 단 댓글",
    created_at: site.now,
    updated_at: site.now,
  });
  site.migrate();
  assert.deepEqual(await searched(site, "free", "오래된 이"), [old]);
  assert.deepEqual(await searched(site, "free", "번째 로그"), [old]);
  assert.deepEqual(await searched(site, "free", "예전에 단"), [other]);
  assert.equal(count(site, "posts_search"), 2);
  assert.equal(count(site, "comments_search"), 1);
});

test("boards bound post and comment lengths, and the site's banned words are refused", async () => {
  const { site, thread } = await roleplayWorld();
  site.run(
    "UPDATE boards SET write_min = 3, write_max = 10, comment_min = 2, comment_max = 5 WHERE id = 'default'",
  );
  const add = (text, title = "") =>
    write(site, {
      data: { image: "https://example.com/p.png", title, text },
    });
  assert.equal(await reasonOf(add("ab")), "length");
  assert.equal(await reasonOf(add("01234567890")), "length");
  assert.equal(await reasonOf(add("abc")), "ok");
  const said = (text) => reply(site, { data: { logId: thread, text } });
  assert.equal(await reasonOf(said("a")), "length");
  assert.equal(await reasonOf(said("abcdef")), "length");
  assert.equal(await reasonOf(said("abc")), "ok");
  setSettings(site, "community", { bannedWords: "바보, Spam" });
  assert.equal(await reasonOf(add("hello", "바보야")), "banned_word");
  assert.equal(await reasonOf(add("buy SPAM")), "banned_word");
  assert.equal(await reasonOf(said("spam")), "banned_word");
  // The staff are held to the words, not the lengths.
  moderator(site, "m-1");
  assert.equal(await reasonOf(said("a")), "ok");
  assert.equal(await reasonOf(said("spam")), "banned_word");
  // A comment is at most a textarea's 2,000 characters.
  site.run("UPDATE boards SET comment_max = 0 WHERE id = 'default'");
  assert.equal(await reasonOf(said("가".repeat(2000))), "ok");
  await assert.rejects(said("가".repeat(2001)));
});

test("adult members are told so, and 익명 comments name no one", async () => {
  const { site, thread } = await roleplayWorld();
  site.run("UPDATE boards SET anonymous = 1 WHERE id = 'default'");
  const { document: plain } = await reply(site, {
    data: { logId: thread, text: "회원" },
  });
  assert.equal(plain.data.admin, undefined);
  await reply(site, {
    data: { logId: thread, text: "누구게", anonymous: true, character: "1" },
  });
  const [, hidden] = await commentsOf(site, thread, M2);
  assert.deepEqual([hidden.data.owner, hidden.data.speaker], [null, undefined]);
  const [, own] = await commentsOf(site, thread, M1);
  assert.equal(own.data.owner, "m-1");
  // Its notice names no one either.
  assert.equal(callsTo(site, "m-2").at(-1).nick, "익명의 누군가");
  const adult = async () =>
    (await site.query("community/membership:membership", undefined, M1)).adult;
  assert.equal(await adult(), false);
  member(site, "m-1", { adult: true });
  assert.equal(await adult(), true);
});

test("[[name]] removed and put back does not call them again", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  profile(site, "m-3", "셋");
  let { document: current } = await write(site, {
    data: { image: "https://example.com/a.png", text: "[[셋]] 안녕" },
  });
  assert.equal(callsTo(site, "m-3").length, 1);
  for (const text of ["안녕", "[[셋]] 다시"])
    ({ document: current } = await write(site, {
      id: current.id,
      revision: current.revision,
      data: { ...current.data, text },
    }));
  assert.equal(callsTo(site, "m-3").length, 1);
});

test("a board's 게시판 관리자 and its group's 그룹 관리자 moderate it, and only it", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  profile(site, "m-3", "셋");
  insert(site, "board_groups", { id: "club", name: "동아리", admin: "m-3" });
  board(site, "free", { ...PUBLIC_BOARD, name: "자유" });
  board(site, "club", { ...PUBLIC_BOARD, name: "동아리방", group: "club" });
  board(site, "calc", { kind: "settlement", categories: ["정산"] });
  site.run("UPDATE boards SET admin = 'm-2' WHERE id IN ('free', 'calc')");
  const secret = post(site, {
    board: "free",
    owner: "m-1",
    title: "비밀",
    body: "몰래",
    secret: 1,
  });
  const other = post(site, {
    board: "default",
    owner: "m-1",
    image: "https://x.example/a.png",
  });
  const clubbed = post(site, {
    board: "club",
    owner: "m-1",
    body: "모임",
    secret: 1,
  });
  const commented = comment(site, {
    post_id: Number(secret),
    owner: "m-1",
    body: "댓글",
  });
  // The board's 게시판 관리자 reads its secrets and changes what others wrote.
  assert.equal(
    (await read(site, { id: secret }, M2)).document.data.text,
    "몰래",
  );
  assert.equal(
    await reasonOf(read(site, { id: clubbed }, M2)),
    "document_not_found",
  );
  assert.equal(
    (await listPage(site, { board: "free" }, M2)).documents[0].data.locked,
    undefined,
  );
  assert.equal(
    await reasonOf(write(site, { id: secret, data: { text: "고침" } }, M2)),
    "ok",
  );
  assert.equal(
    await reasonOf(
      reply(site, { id: commented, data: { text: "댓글 고침" } }, M2),
    ),
    "ok",
  );
  assert.equal(
    await reasonOf(write(site, { id: other, data: { text: "남의 글" } }, M2)),
    "not_owned",
  );
  // Notices and moves on their boards, and moves only to boards they administer.
  const moderate = (args, who = M2) =>
    site.mutate("community/boards:moderatePost", args, who);
  assert.equal(
    (await moderate({ id: secret, notice: true })).document.data.notice,
    true,
  );
  assert.equal(
    await reasonOf(moderate({ id: other, notice: true })),
    "access_denied",
  );
  assert.equal(
    await reasonOf(moderate({ id: secret, board: "default" })),
    "access_denied",
  );
  // The group's 그룹 관리자 moderates the group's boards.
  assert.equal(
    (await read(site, { id: clubbed }, M3)).document.data.text,
    "모임",
  );
  assert.equal(
    await reasonOf(moderate({ id: clubbed, notice: true }, M3)),
    "ok",
  );
  assert.equal(
    await reasonOf(read(site, { id: secret }, M3)),
    "document_not_found",
  );
  // A settlement board's 게시판 관리자 settles its requests.
  const request = post(site, {
    board: "calc",
    owner: "m-1",
    body: "정산해 주세요",
    category: "정산",
  });
  assert.equal(
    await reasonOf(
      site.mutate("community/posts:settle", { id: request, state: "반려" }, M3),
    ),
    "access_denied",
  );
  assert.equal(
    await reasonOf(
      site.mutate("community/posts:settle", { id: request, state: "반려" }, M2),
    ),
    "ok",
  );
  // A board admin who left the community is no one's moderator.
  site.run(
    "INSERT INTO members (member, left_on) VALUES ('m-2', '2026-10-16')",
  );
  assert.equal(
    await reasonOf(moderate({ id: secret, notice: false })),
    "access_denied",
  );
  // The admin's boards say who their 관리자 are, for the page's buttons.
  const { boards } = await site.query("community/boards:boards", null, M1);
  const free = boards.find((row) => row.id === "free");
  assert.equal(free.data.admin, "m-2");
  assert.equal(boards.find((row) => row.id === "club").data.groupAdmin, "m-3");
  // The owner picks them from the members on the board and group forms.
  const saved = await site.mutate(
    "admin/boards:save",
    { id: "free", values: { admin: "m-3" } },
    OWNER,
  );
  assert.equal(saved.data.admin, "m-3");
  assert.equal(
    await reasonOf(
      site.mutate(
        "admin/boards:save",
        { id: "free", values: { admin: "nobody" } },
        OWNER,
      ),
    ),
    "invalid_input",
  );
  assert.equal(
    (
      await site.mutate(
        "admin/board_groups:save",
        { id: "club", values: { admin: "" } },
        OWNER,
      )
    ).data.admin,
    undefined,
  );
});

test("a post keeps two links, a plain board's posts as many pictures as it allows", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  board(site, "free", { ...PUBLIC_BOARD, uploadCount: 3 });
  const { document } = await write(site, {
    data: {
      board: "free",
      text: "링크와 그림",
      image: "https://media.example/1.png",
      files: ["https://media.example/2.png", "https://media.example/3.png"],
      links: ["https://a.example/x", "", "http://b.example/y"].slice(0, 2),
    },
  });
  assert.deepEqual(document.data.links, ["https://a.example/x"]);
  assert.deepEqual(document.data.files, [
    "https://media.example/2.png",
    "https://media.example/3.png",
  ]);
  // An edit that does not send them keeps them; one that does changes them.
  const { document: kept } = await write(site, {
    id: document.id,
    data: { text: "고침" },
  });
  assert.deepEqual(kept.data.links, ["https://a.example/x"]);
  assert.equal(kept.data.files.length, 2);
  const { document: changed } = await write(site, {
    id: document.id,
    data: { text: "고침", links: ["http://b.example/y", "https://c.example/"] },
  });
  assert.deepEqual(changed.data.links, [
    "http://b.example/y",
    "https://c.example/",
  ]);
  for (const [data, reason] of [
    [{ links: ["javascript:alert(1)"] }, "invalid_link"],
    [
      {
        links: [
          "https://a.example/",
          "https://b.example/",
          "https://c.example/",
        ],
      },
      "invalid_input",
    ],
    [
      {
        image: "https://media.example/1.png",
        files: [
          "https://media.example/2.png",
          "https://media.example/3.png",
          "https://media.example/4.png",
        ],
      },
      "upload_count",
    ],
    [
      {
        image: "https://media.example/1.png",
        files: ["http://media.example/2.png"],
      },
      "invalid_input",
    ],
  ])
    assert.equal(
      await reasonOf(
        write(site, { data: { board: "free", text: "x", ...data } }),
      ),
      reason,
      JSON.stringify(data),
    );
  // A picture log takes its one picture; a board at 0 takes none.
  assert.equal(
    await reasonOf(
      write(site, {
        data: {
          image: "https://media.example/1.png",
          files: ["https://media.example/2.png"],
        },
      }),
    ),
    "invalid_input",
  );
  board(site, "plain", { ...PUBLIC_BOARD, uploadCount: 0 });
  assert.equal(
    await reasonOf(
      write(site, {
        data: {
          board: "plain",
          text: "x",
          image: "https://media.example/1.png",
        },
      }),
    ),
    "upload_count",
  );
  assert.equal(
    await reasonOf(write(site, { data: { board: "plain", text: "글만" } })),
    "ok",
  );
});

test("a board lists by its 정렬 필드 after its notices, with its text only when 목록에서 내용 사용", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, sortField: "comment desc" });
  const first = post(site, { board: "free", body: "하나", created_at: 1000 });
  const second = post(site, { board: "free", body: "둘", created_at: 2000 });
  const third = post(site, {
    board: "free",
    body: "셋",
    created_at: 3000,
    notice: 1,
  });
  for (let n = 0; n < 2; n += 1)
    comment(site, { post_id: Number(first), body: "c", created_at: 5000 + n });
  const order = async () =>
    (await listPage(site, { board: "free" })).documents.map((row) => row.id);
  assert.deepEqual(await order(), [third, first, second]);
  board(site, "free", { ...PUBLIC_BOARD, sortField: "datetime asc" });
  assert.deepEqual(await order(), [third, first, second]);
  comment(site, { post_id: Number(second), body: "c", created_at: 9000 });
  board(site, "free", { ...PUBLIC_BOARD, sortField: "last desc" });
  assert.deepEqual(await order(), [third, second, first]);
  board(site, "free", { ...PUBLIC_BOARD, sortField: "nonsense" });
  assert.deepEqual(await order(), [third, second, first]);
  // Without 목록에서 내용 사용, a plain board lists titles; the post reads whole.
  board(site, "free", { ...PUBLIC_BOARD, listContent: false });
  const listed = (await listPage(site, { board: "free" })).documents;
  assert.deepEqual(
    listed.map((row) => [row.data.text, row.data.truncated]),
    [
      ["", true],
      ["", true],
      ["", true],
    ],
  );
  assert.equal((await read(site, { id: first })).document.data.text, "하나");
  // A picture board's list always carries its text.
  board(site, "default", { ...LOG_BOARD, listContent: false });
  const log = post(site, {
    body: "그림 설명",
    image: "https://media.example/1.png",
  });
  assert.equal(
    (await listPage(site, { board: "default" })).documents.find(
      (row) => row.id === log,
    ).data.text,
    "그림 설명",
  );
});

test("글쓰기 간격 keeps a member's next post or comment that many seconds after their last", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  board(site, "free", PUBLIC_BOARD);
  const first = await write(site, { data: { board: "free", text: "첫 글" } });
  // A site that never set it has none.
  assert.equal(
    await reasonOf(write(site, { data: { board: "free", text: "곧바로" } })),
    "ok",
  );
  setSettings(site, "community", { writeDelay: 30 });
  site.now += 10 * 1000;
  assert.equal(
    await reasonOf(write(site, { data: { board: "free", text: "또" } })),
    "too_fast",
  );
  assert.equal(
    await reasonOf(
      reply(site, { data: { logId: first.document.id, text: "댓글" } }),
    ),
    "too_fast",
  );
  // Editing is not writing; others, the staff and guests are not held.
  assert.equal(
    await reasonOf(
      write(site, { id: first.document.id, data: { text: "고침" } }),
    ),
    "ok",
  );
  assert.equal(
    await reasonOf(write(site, { data: { board: "free", text: "남" } }, M2)),
    "ok",
  );
  moderator(site, "m-2");
  assert.equal(
    await reasonOf(write(site, { data: { board: "free", text: "남2" } }, M2)),
    "ok",
  );
  assert.equal(
    await reasonOf(
      write(
        site,
        {
          data: { board: "free", text: "손님" },
          guest: { name: "손", password: "1234" },
        },
        VISITOR,
      ),
    ),
    "ok",
  );
  site.now += 21 * 1000;
  assert.equal(
    await reasonOf(
      reply(site, { data: { logId: first.document.id, text: "이제" } }),
    ),
    "ok",
  );
  // A comment counts as the last as well.
  assert.equal(
    await reasonOf(write(site, { data: { board: "free", text: "다음" } })),
    "too_fast",
  );
});

test("최근게시물 lists the newest posts and comments of every readable board, by group, kind or member", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  insert(site, "board_groups", { id: "club", name: "동아리", members_only: 1 });
  board(site, "free", { ...PUBLIC_BOARD, name: "자유" });
  board(site, "club", { ...PUBLIC_BOARD, name: "동아리방", group: "club" });
  const at = (n) => site.now + n * 1000;
  const a = post(site, {
    board: "free",
    owner: "m-1",
    title: "가",
    body: "가",
    created_at: at(1),
  });
  const secret = post(site, {
    board: "free",
    owner: "m-2",
    title: "비밀",
    body: "s",
    secret: 1,
    created_at: at(2),
  });
  const hidden = post(site, {
    board: "club",
    owner: "m-2",
    title: "동아리 글",
    body: "c",
    created_at: at(3),
  });
  const members = post(site, {
    board: "free",
    owner: "m-2",
    title: "멤버",
    body: "m",
    members_only: 1,
    created_at: at(4),
  });
  const anon = post(site, {
    board: "free",
    owner: "m-1",
    title: "익명",
    body: "x",
    anonymous: 1,
    created_at: at(5),
  });
  const c1 = comment(site, {
    post_id: Number(a),
    owner: "m-2",
    body: "댓글",
    created_at: at(6),
  });
  comment(site, {
    post_id: Number(secret),
    owner: "m-2",
    body: "비밀 댓글",
    created_at: at(7),
  });
  const recent = (args = {}, who = M1) =>
    site.query("community/search:recent", args, who);
  const keys = (result) =>
    result.entries.map((entry) =>
      entry.kind === "post" ? `p${entry.post.id}` : `c${entry.comment.id}`,
    );
  const listed = await recent();
  // Not the secret post (nor its comment), nor the members-only group's.
  assert.deepEqual(keys(listed), [
    `c${c1}`,
    `p${anon}`,
    `p${members}`,
    `p${a}`,
  ]);
  assert.equal(listed.total, 4);
  assert.equal(listed.size, 15);
  assert.equal(listed.entries[0].board.name, "자유");
  assert.equal(listed.entries[0].post.id, a);
  assert.deepEqual(keys(await recent({ view: "posts" })), [
    `p${anon}`,
    `p${members}`,
    `p${a}`,
  ]);
  assert.deepEqual(keys(await recent({ view: "comments" })), [`c${c1}`]);
  // A visitor sees no 멤버공개 post; the staff see the secret one.
  assert.deepEqual(keys(await recent({}, VISITOR)), [
    `c${c1}`,
    `p${anon}`,
    `p${a}`,
  ]);
  moderator(site, "m-2");
  assert.equal((await recent({}, M2)).total, 7);
  assert.deepEqual(keys(await recent({ group: "club" }, M2)), [`p${hidden}`]);
  // By member: 하나's own, but not their 익명 one to another.
  assert.deepEqual(keys(await recent({ nick: "하나" }, M1)), [
    `p${anon}`,
    `p${a}`,
  ]);
  site.setRoles("m-2", []);
  assert.deepEqual(keys(await recent({ nick: "하나" }, M2)), [`p${a}`]);
  assert.equal((await recent({ nick: "아무도" })).total, 0);
  // 최근게시물 라인수 (cf_new_rows) sizes the pages.
  setSettings(site, "community", { newRows: 2 });
  const first = await recent();
  assert.deepEqual(keys(first), [`c${c1}`, `p${anon}`]);
  assert.deepEqual(keys(await recent({ page: 2 })), [`p${members}`, `p${a}`]);
  assert.equal(await reasonOf(recent({ view: "all" })), "invalid_input");
});

test("전체검색 finds words in every readable board's posts and comments, with each board's count", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  board(site, "free", { ...PUBLIC_BOARD, name: "자유" });
  board(site, "notice", { ...PUBLIC_BOARD, name: "공지" });
  board(site, "staff", {
    ...PUBLIC_BOARD,
    name: "운영",
    listLevel: 9,
    readLevel: 9,
  });
  const p1 = post(site, {
    board: "free",
    owner: "m-1",
    title: "바다 여행",
    body: "푸른 바다를 보았다",
  });
  const p2 = post(site, {
    board: "notice",
    owner: "m-2",
    title: "공지",
    body: "바다 금지",
  });
  post(site, {
    board: "staff",
    owner: "m-2",
    title: "바다 회의",
    body: "비공개",
  });
  const p4 = post(site, {
    board: "free",
    owner: "m-2",
    title: "산",
    body: "산에 갔다",
    secret: 1,
  });
  const p5 = post(site, {
    board: "free",
    owner: "m-2",
    title: "숲",
    body: "나무",
  });
  comment(site, { post_id: Number(p5), owner: "m-1", body: "바다가 그립다" });
  const search = (args, who = M1) =>
    site.query("community/search:everything", args, who);
  const ids = (result) => result.documents.map((row) => row.id);
  const all = await search({ text: "바다" });
  // Posts first, newest first, then the posts found by their comments.
  assert.deepEqual(ids(all), [p2, p1, p5]);
  assert.deepEqual(all.counts, [
    { id: "free", name: "자유", count: 2 },
    { id: "notice", name: "공지", count: 1 },
  ]);
  assert.equal(all.documents[0].boardName, "공지");
  assert.deepEqual(ids(await search({ text: "바다", board: "notice" })), [p2]);
  assert.deepEqual(ids(await search({ text: "바다", field: "title" })), [p1]);
  assert.deepEqual(ids(await search({ text: "바다 여행" })), [p1]);
  assert.deepEqual(ids(await search({ text: "여행 금지", operator: "or" })), [
    p2,
    p1,
  ]);
  // A two-letter word is found by LIKE; a secret post only by its own.
  assert.deepEqual(ids(await search({ text: "산에" })), []);
  assert.deepEqual(ids(await search({ text: "산에" }, M2)), [p4]);
  // By writer: 회원 is the nickname, 이름 a guest's name too.
  assert.deepEqual(ids(await search({ text: "하나", field: "nick" })), [
    p1,
    p5,
  ]);
  const guest = post(site, {
    board: "free",
    guest_name: "나그네",
    title: "손님 글",
    body: "안녕",
  });
  assert.deepEqual(ids(await search({ text: "나그네", field: "name" })), [
    guest,
  ]);
  // The level-9 board is the staff's to search.
  site.run("INSERT INTO members (member, level) VALUES ('m-2', 9)");
  assert.equal((await search({ text: "바다" }, M2)).counts.length, 3);
  for (const text of ["바", "바다 산 숲", ""])
    assert.equal(await reasonOf(search({ text })), "invalid_search", text);
  assert.equal(
    await reasonOf(search({ text: "바다", field: "mb_id" })),
    "invalid_input",
  );
  // Visitors search what level 1 reads.
  assert.deepEqual(ids(await search({ text: "바다" }, VISITOR)), [p2, p1, p5]);
});

test("로그번호 lists a board from log N down, as the mmb search's wr_num >= -N", async () => {
  const site = await boardSite();
  profile(site, "m-1", "아보");
  for (let n = 0; n < 5; n += 1)
    post(site, { owner: "m-1", image: "https://example.com/a.png" });
  const numbers = async (args) =>
    (await listPage(site, { board: "default", ...args })).documents.map(
      (row) => row.data.number,
    );
  assert.deepEqual(await numbers({}), [5, 4, 3, 2, 1]);
  assert.deepEqual(await numbers({ upTo: 3 }), [3, 2, 1]);
  assert.equal((await listPage(site, { board: "default", upTo: 3 })).total, 3);
  await assert.rejects(listPage(site, { board: "default", upTo: 0 }));
});

test("a board lists by 제목, 글쓴이 or 분류명; a 익명 post's writer sorts as blank", async () => {
  const site = await boardSite();
  profile(site, "m-1", "가나");
  profile(site, "m-2", "다라");
  board(site, "free", { ...PUBLIC_BOARD, categories: ["a", "b"] });
  const one = post(site, {
    board: "free",
    owner: "m-2",
    title: "나",
    category: "a",
  });
  const two = post(site, {
    board: "free",
    owner: "m-1",
    title: "다",
    category: "b",
  });
  const three = post(site, {
    board: "free",
    guest_name: "손님",
    title: "가",
    category: "a",
  });
  const four = post(site, {
    board: "free",
    owner: "m-2",
    title: "라",
    anonymous: 1,
  });
  const order = async (sortField) => {
    board(site, "free", { ...PUBLIC_BOARD, categories: ["a", "b"], sortField });
    return (await listPage(site, { board: "free" })).documents.map(
      (row) => row.id,
    );
  };
  assert.deepEqual(await order("subject asc"), [three, one, two, four]);
  assert.deepEqual(await order("subject desc"), [four, two, one, three]);
  // "" (익명), 가나, 다라, 손님.
  assert.deepEqual(await order("name asc"), [four, two, one, three]);
  assert.deepEqual(await order("category desc"), [two, three, one, four]);
});

test("최근게시물 leaves out what is older than its 기간 (cf_new_del), by Korean day", async () => {
  // 2030-01-31 12:00 in Korea.
  const site = await testSite({ now: Date.parse("2030-01-31T03:00:00Z") });
  board(site, "free", PUBLIC_BOARD);
  profile(site, "m-1", "아보");
  const day = (iso) => Date.parse(iso);
  const old = post(site, {
    board: "free",
    owner: "m-1",
    created_at: day("2029-12-31T14:59:00Z"), // 12-31 23:59 KST
  });
  const kept = post(site, {
    board: "free",
    owner: "m-1",
    created_at: day("2029-12-31T15:00:00Z"), // 01-01 00:00 KST
  });
  comment(site, {
    post_id: Number(old),
    owner: "m-1",
    body: "옛 댓글",
    created_at: day("2029-12-01T00:00:00Z"),
  });
  const ids = async () =>
    (await site.query("community/search:recent", {}, M1)).entries.map(
      (entry) => entry.kind + (entry.comment?.id ?? entry.post.id),
    );
  assert.equal((await ids()).length, 3);
  setSettings(site, "community", { newDays: 30 });
  assert.deepEqual(await ids(), [`post${kept}`]);
});

test("a secret comment is read by the staff and the two writers alone, and found by no one else", async () => {
  const site = await boardSite();
  board(site, "free", PUBLIC_BOARD);
  profile(site, "m-1", "글쓴이");
  profile(site, "m-2", "댓글러");
  profile(site, "m-3", "구경꾼");
  profile(site, "m-4", "운영진");
  const thread = post(site, { board: "free", owner: "m-1", body: "본문" });
  const { document: saved } = await reply(
    site,
    {
      data: {
        logId: thread,
        text: "비밀 이야기입니다 [[구경꾼]]",
        secret: true,
      },
    },
    M2,
  );
  assert.equal(saved.data.secret, true);
  const textFor = async (who) =>
    (await commentsOf(site, thread, who)).map((row) => [
      row.data.text,
      row.data.hidden === true,
    ]);
  assert.deepEqual(await textFor(M1), [
    ["비밀 이야기입니다 [[구경꾼]]", false],
  ]);
  assert.deepEqual(await textFor(M2), [
    ["비밀 이야기입니다 [[구경꾼]]", false],
  ]);
  assert.deepEqual(await textFor(M3), [["", true]]);
  assert.deepEqual(await textFor(VISITOR), [["", true]]);
  moderator(site, "m-4");
  assert.deepEqual(await textFor({ member: "m-4" }), [
    ["비밀 이야기입니다 [[구경꾼]]", false],
  ]);
  // The call names the comment, not what it says.
  assert.deepEqual(
    callsTo(site, "m-3").map((row) => row.preview),
    ["비밀글 입니다."],
  );
  // Neither the board's search nor 전체검색 finds it for others.
  assert.deepEqual(await searched(site, "free", "이야기", M3), []);
  assert.deepEqual(await searched(site, "free", "이야기", M1), [thread]);
  const everything = (who) =>
    site
      .query("community/search:everything", { text: "이야기" }, who)
      .then((result) => result.documents.map((row) => row.id));
  assert.deepEqual(await everything(M3), []);
  assert.deepEqual(await everything(M2), [thread]);
  // 최근게시물 lists it, without its text.
  const recentFor = async (who) =>
    (await site.query("community/search:recent", { view: "comments" }, who))
      .entries[0].comment.data;
  assert.equal((await recentFor(M3)).text, "");
  assert.equal((await recentFor(M1)).text, "비밀 이야기입니다 [[구경꾼]]");
  // A guest cannot write one.
  assert.equal(
    await refusal(
      reply(
        site,
        {
          data: { logId: thread, text: "손님 비밀", secret: true },
          guest: { name: "손님", password: "1234" },
        },
        VISITOR,
      ),
    ),
    "guest_secret",
  );
});

test("답변글 sit under what they answer, at 글답변 권한, and keep a post with replies", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, kind: "text", replyLevel: 2 });
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const say = async (title, replyTo, who = M1) =>
    (
      await write(
        site,
        {
          data: {
            board: "free",
            title,
            text: title,
            ...(replyTo ? { replyTo } : {}),
          },
        },
        who,
      )
    ).document;
  const first = await say("첫 글");
  const second = await say("둘째 글");
  const r1 = await say("Re: 첫 글", first.id, M2);
  const r2 = await say("Re: 첫 글 (2)", first.id);
  const r11 = await say("Re: Re: 첫 글", r1.id);
  assert.equal(r11.data.depth, 2);
  assert.equal(r11.data.thread, first.id);
  const titles = async () =>
    (await listPage(site, { board: "free" })).documents.map(
      (row) => row.data.title,
    );
  // wr_num, wr_reply: the newest thread first, each reply under its parent.
  assert.deepEqual(await titles(), [
    "둘째 글",
    "첫 글",
    "Re: 첫 글",
    "Re: Re: 첫 글",
    "Re: 첫 글 (2)",
  ]);
  // 나중에 쓴 답변 위로 달기 (bo_reply_order 0).
  board(site, "free", {
    ...PUBLIC_BOARD,
    kind: "text",
    replyLevel: 2,
    replyOrder: "0",
  });
  await say("Re: 둘째 글", second.id);
  await say("Re: 둘째 글 (2)", second.id);
  assert.deepEqual((await titles()).slice(0, 3), [
    "둘째 글",
    "Re: 둘째 글 (2)",
    "Re: 둘째 글",
  ]);
  // A post with replies stays, but for the staff.
  assert.equal(
    await refusal(site.mutate("community/posts:remove", { id: first.id }, M1)),
    "has_replies",
  );
  assert.equal(
    await reasonOf(site.mutate("community/posts:remove", { id: r2.id }, M1)),
    "ok",
  );
  // 글답변 권한 above the member's level refuses; picture boards have none.
  board(site, "free", { ...PUBLIC_BOARD, kind: "text", replyLevel: 9 });
  assert.equal(await refusal(say("Re", first.id)), "access_denied");
  const picture = post(site, { owner: "m-1", image: "https://e.com/a.png" });
  assert.equal(
    await refusal(
      write(site, {
        data: {
          image: "https://e.com/b.png",
          text: "x",
          replyTo: picture,
        },
      }),
    ),
    "invalid_input",
  );
});

test("조회수 counts a readable post's openings, lists them, sorts by them, and goes with the post", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, sortField: "hit desc" });
  profile(site, "m-1", "하나");
  const quiet = post(site, { board: "free", owner: "m-1", title: "조용" });
  const busy = post(site, { board: "free", owner: "m-1", title: "인기" });
  const secret = post(site, {
    board: "free",
    owner: "m-1",
    title: "비밀",
    secret: 1,
  });
  const hit = (id, who = M2) => site.mutate("community/posts:hit", { id }, who);
  await hit(busy);
  await hit(busy, VISITOR);
  await hit(quiet);
  await hit(busy, M1);
  // One the reader may not read is not counted.
  assert.equal(await refusal(hit(secret)), "document_not_found");
  const listed = (await listPage(site, { board: "free" })).documents;
  assert.deepEqual(
    listed.map((row) => [row.data.title, row.data.hits]),
    [
      ["인기", 3],
      ["조용", 1],
      ["비밀", 0],
    ].filter(([title]) => listed.some((row) => row.data.title === title)),
  );
  assert.equal(listed[0].id, busy);
  assert.equal((await read(site, { id: busy })).document.data.hits, 3);
  await site.mutate("community/posts:remove", { id: busy }, M1);
  assert.equal(count(site, "post_hits"), 1);
});

test("복사 copies a post with its comments and 조회수 to a board the moderator keeps, and 이동·복사 note it", async () => {
  // 2030-01-01 12:00 in Korea.
  const site = await testSite({ now: Date.parse("2030-01-01T03:00:00Z") });
  board(site, "free", PUBLIC_BOARD);
  board(site, "notes", { ...PUBLIC_BOARD, name: "기록" });
  profile(site, "m-1", "하나");
  profile(site, "m-2", "운영");
  moderator(site, "m-2");
  const original = post(site, {
    board: "free",
    owner: "m-1",
    title: "원본",
    body: "본문",
    reward: 5,
  });
  comment(site, { post_id: Number(original), owner: "m-1", body: "댓글" });
  site.run("INSERT INTO post_hits (post_id, hits) VALUES (?, 7)", original);
  const copyPost = (args, who = M2) =>
    site.mutate("community/boards:copyPost", args, who);
  assert.equal(
    await refusal(copyPost({ id: original, board: "notes" }, M1)),
    "access_denied",
  );
  const { document: copy } = await copyPost({ id: original, board: "notes" });
  assert.equal(copy.data.board, "notes");
  assert.equal(copy.data.number, 1);
  assert.equal(copy.data.hits, 7);
  assert.equal(
    copy.data.text,
    "본문\n\n[이 게시물은 운영님에 의해 2030-01-01 12:00:00 자유에서 복사 됨]",
  );
  assert.equal(
    site.rows("SELECT reward FROM posts WHERE id = ?", copy.id)[0].reward,
    0,
  );
  assert.deepEqual(
    (await commentsOf(site, copy.id)).map((row) => row.data.text),
    ["댓글"],
  );
  // The original is as it was; the copy's words are searched.
  assert.equal((await read(site, { id: original })).document.data.text, "본문");
  assert.deepEqual(await searched(site, "notes", "복사 됨"), [copy.id]);
  // A move notes itself the same way.
  const { document: moved } = await site.mutate(
    "community/boards:moderatePost",
    { id: original, board: "notes" },
    M2,
  );
  assert.match(moved.data.text, /자유에서 이동 됨\]$/);
  assert.equal(moved.data.number, 2);
});

test("윗글 and 아래글 are the posts above and below in the list's order, of those the reader may list", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, kind: "text" });
  profile(site, "m-1", "하나");
  const say = async (title, replyTo) =>
    (
      await write(site, {
        data: {
          board: "free",
          title,
          text: title,
          ...(replyTo ? { replyTo } : {}),
        },
      })
    ).document.id;
  const one = await say("1");
  const two = await say("2");
  const reply = await say("Re: 1", one);
  const three = post(site, {
    board: "free",
    owner: "m-2",
    title: "비밀",
    secret: 1,
  });
  const four = await say("4");
  // The list: 4, (비밀), 2, 1, Re: 1.
  const near = async (id, who = M1) => {
    const { previous, next } = await site.query(
      "community/posts:neighbors",
      { id },
      who,
    );
    return [previous?.title ?? null, next?.title ?? null];
  };
  assert.deepEqual(await near(two), ["4", "1"]);
  assert.deepEqual(await near(one), ["2", "Re: 1"]);
  assert.deepEqual(await near(reply), ["1", null]);
  assert.deepEqual(await near(four), [null, "2"]);
  // Its writer sees their secret post between them.
  assert.deepEqual(await near(two, M2), ["비밀", "1"]);
  assert.equal(three.length > 0, true);
});

test("a plain board's post keeps 첨부파일 with its pictures' count, and counts their downloads", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, kind: "text", uploadCount: 2 });
  profile(site, "m-1", "하나");
  const upload = (file) => ({ url: site.upload(file), ...file });
  const pdf = upload({
    member: "m-1",
    name: "규칙.pdf",
    size: 2048,
    type: "application/pdf",
  });
  const zip = upload({
    member: "m-1",
    name: "b.zip",
    size: 2048,
    type: "application/zip",
  });
  delete pdf.member;
  delete zip.member;
  const { document: saved } = await write(site, {
    data: {
      board: "free",
      title: "자료",
      text: "받으세요",
      attachments: [pdf],
    },
  });
  assert.deepEqual(saved.data.attachments, [{ ...pdf, downloads: 0 }]);
  // One picture and two files is more than 업로드 개수 2.
  assert.equal(
    await refusal(
      write(site, {
        data: {
          board: "free",
          text: "많이",
          image: "https://e.com/a.png",
          attachments: [pdf, zip],
        },
      }),
    ),
    "upload_count",
  );
  // Only the writer's own uploads that Naru Media finished, as Naru
  // recorded them, and only on plain boards.
  const theirs = upload({
    member: "m-2",
    name: "c.pdf",
    size: 10,
    type: "application/pdf",
  });
  for (const attachments of [
    [{ ...pdf, url: "https://media.naru.pub/never-uploaded.pdf" }],
    [{ url: theirs.url, name: "c.pdf", size: 10, type: "application/pdf" }],
  ])
    assert.equal(
      await refusal(
        write(site, { data: { board: "free", text: "x", attachments } }),
      ),
      "invalid_input",
    );
  const { document: told } = await write(site, {
    data: {
      board: "free",
      text: "x",
      attachments: [{ ...pdf, name: "other.exe", size: 1, type: "text/plain" }],
    },
  });
  assert.deepEqual(told.data.attachments, [{ ...pdf, downloads: 0 }]);
  assert.equal(
    await refusal(
      write(site, {
        data: { image: "https://e.com/a.png", text: "x", attachments: [pdf] },
      }),
    ),
    "invalid_input",
  );
  await site.mutate(
    "community/posts:download",
    { id: saved.id, url: pdf.url },
    VISITOR,
  );
  await site.mutate(
    "community/posts:download",
    { id: saved.id, url: pdf.url },
    M2,
  );
  assert.equal(
    (await read(site, { id: saved.id })).document.data.attachments[0].downloads,
    2,
  );
  assert.equal(
    await refusal(
      site.mutate("community/posts:download", { id: saved.id, url: zip.url }),
    ),
    "no_file",
  );
  // An edit keeps them unless it says otherwise.
  const { document: edited } = await write(site, {
    id: saved.id,
    data: { board: "free", title: "자료", text: "고침" },
    revision: saved.revision,
  });
  assert.equal(edited.data.attachments.length, 1);
  await site.mutate("community/posts:remove", { id: saved.id }, M1);
  assert.equal(count(site, "attachment_downloads"), 0);
});

test("댓글 답변 sit under the comment they answer, five deep, and keep a comment with replies", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, kind: "text" });
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const thread = post(site, { board: "free", owner: "m-1", body: "본문" });
  const say = async (text, replyTo, who = M1) =>
    (
      await reply(
        site,
        { data: { logId: thread, text, ...(replyTo ? { replyTo } : {}) } },
        who,
      )
    ).document;
  const a = await say("가");
  const b = await say("나");
  const a1 = await say("가-1", a.id, M2);
  await say("가-2", a.id);
  const a11 = await say("가-1-1", a1.id);
  assert.equal(a11.data.depth, 2);
  const texts = async (after = null) =>
    (await site.query("community/comments:list", { post: thread, after }, M1))
      .documents;
  assert.deepEqual(
    (await texts()).map((row) => row.data.text),
    ["가", "가-1", "가-1-1", "가-2", "나"],
  );
  // Five deep, then no more.
  let deep = a11;
  for (let n = 3; n <= 5; n += 1) deep = await say(`깊이 ${n}`, deep.id);
  assert.equal(deep.data.depth, 5);
  assert.equal(await refusal(say("여섯", deep.id)), "reply_depth");
  // A comment with replies stays, but for the staff.
  assert.equal(
    await refusal(site.mutate("community/comments:remove", { id: a.id }, M1)),
    "has_replies",
  );
  assert.equal(
    await reasonOf(site.mutate("community/comments:remove", { id: b.id }, M1)),
    "ok",
  );
  // Picture boards' comments take no replies.
  const picture = post(site, { owner: "m-1", image: "https://e.com/a.png" });
  const first = await reply(site, { data: { logId: picture, text: "x" } });
  assert.equal(
    await refusal(
      reply(site, {
        data: { logId: picture, text: "y", replyTo: first.document.id },
      }),
    ),
    "invalid_input",
  );
});

test("a post's comments page on in thread order, past fifty", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, kind: "text" });
  profile(site, "m-1", "하나");
  const thread = post(site, { board: "free", owner: "m-1", body: "본문" });
  const ids = [];
  for (let n = 0; n < 51; n += 1)
    ids.push(
      (await reply(site, { data: { logId: thread, text: `c${n}` } })).document
        .id,
    );
  await reply(site, { data: { logId: thread, text: "re", replyTo: ids[0] } });
  const first = await site.query(
    "community/comments:list",
    { post: thread },
    M1,
  );
  assert.equal(first.documents.length, 50);
  assert.equal(first.documents[1].data.text, "re");
  const second = await site.query(
    "community/comments:list",
    { post: thread, after: first.nextCursor },
    M1,
  );
  assert.deepEqual(
    second.documents.map((row) => row.data.text),
    ["c49", "c50"],
  );
  assert.equal(second.nextCursor, null);
});

test("a writer's character carries its 소속, whose icon every reader's frame names", async () => {
  const site = await boardSite();
  profile(site, "m-1", "하나");
  insert(site, "characters", {
    owner: "m-1",
    name: "Hero",
    side: "숲",
    state: "approved",
    created_at: site.now,
  });
  insert(site, "sides", {
    id: "forest",
    name: "숲",
    image: "https://e.com/f.png",
  });
  insert(site, "sides", { id: "city", name: "도시", image: "javascript:x" });
  const { document: saved } = await write(site, {
    data: { image: "https://e.com/a.png", text: "x", character: "1" },
  });
  assert.equal(saved.data.speaker.side, "숲");
  const { sideIcons } = await site.query("content/site:site");
  assert.deepEqual(sideIcons, { 숲: "https://e.com/f.png" });
});

test("a post's links count the times they are followed (wr_link1_hit), and go with the post", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, kind: "text" });
  profile(site, "m-1", "하나");
  const { document: saved } = await write(site, {
    data: {
      board: "free",
      text: "보세요",
      links: ["https://a.example/", "https://b.example/"],
    },
  });
  const follow = (url, who = M2) =>
    site.mutate("community/posts:linkHit", { id: saved.id, url }, who);
  await follow("https://b.example/");
  await follow("https://b.example/", VISITOR);
  assert.equal(await refusal(follow("https://c.example/")), "no_link");
  assert.deepEqual(
    (await read(site, { id: saved.id })).document.data.linkHits,
    [0, 2],
  );
  await site.mutate("community/posts:remove", { id: saved.id }, M1);
  assert.equal(count(site, "link_hits"), 0);
});

test("첨부파일 take a 설명 where the board asks, and stay within 파일 업로드 용량", async () => {
  const site = await boardSite();
  board(site, "free", {
    ...PUBLIC_BOARD,
    kind: "text",
    uploadCount: 3,
    uploadSize: 1,
    fileContent: true,
  });
  profile(site, "m-1", "하나");
  const file = {
    url: site.upload({ member: "m-1", name: "a.pdf", size: 1000 }),
    name: "a.pdf",
    size: 1000,
    type: "application/pdf",
    note: "규칙 모음",
  };
  // Naru's record of an upload's size counts, whatever the page says.
  const big = site.upload({
    member: "m-1",
    name: "big.pdf",
    size: 2 * 1048576,
  });
  const { document: saved } = await write(site, {
    data: { board: "free", text: "x", attachments: [file] },
  });
  assert.equal(saved.data.attachments[0].note, "규칙 모음");
  assert.equal(
    await refusal(
      write(site, {
        data: {
          board: "free",
          text: "y",
          attachments: [{ ...file, url: big, size: 1000 }],
        },
      }),
    ),
    "upload_size",
  );
  // Without 파일 설명 사용, a note is not kept.
  board(site, "free", { ...PUBLIC_BOARD, kind: "text", uploadCount: 3 });
  const { document: plain } = await write(site, {
    data: { board: "free", text: "z", attachments: [file] },
  });
  assert.equal(plain.data.attachments[0].note, undefined);
});

test("글읽기 포인트 pays or charges a member once a post they open, and stops one who cannot pay", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, readReward: -3 });
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  site.run("INSERT INTO wallets (member, balance) VALUES ('m-2', 4)");
  const first = post(site, { board: "free", owner: "m-1", number: 1 });
  const second = post(site, { board: "free", owner: "m-1", number: 2 });
  const open = (id, who = M2, count) =>
    site.mutate(
      "community/posts:hit",
      { id, ...(count === undefined ? {} : { count }) },
      who,
    );
  const balance = () =>
    site.rows("SELECT balance FROM wallets WHERE member = 'm-2'")[0].balance;
  await open(first);
  assert.equal(balance(), 1);
  // Once a post: again costs nothing, and counts no view when asked not to.
  await open(first, M2, false);
  assert.equal(balance(), 1);
  assert.equal(
    site.rows("SELECT hits FROM post_hits WHERE post_id = ?", first)[0].hits,
    1,
  );
  assert.equal(await refusal(open(second)), "read_point");
  assert.equal(balance(), 1);
  // Its writer and visitors are not charged.
  await open(second, M1);
  await open(second, VISITOR);
  const history = site.rows(
    "SELECT owner, delta, memo FROM history WHERE kind = 'read'",
  );
  assert.deepEqual(history, [
    { owner: "m-2", delta: -3, memo: history[0].memo },
  ]);
  assert.match(history[0].memo, /글읽기/);
});

test("췩: a picture posted first holds its place until its writer finishes it, by edit or comment", async () => {
  const site = await testSite({ now: 1000 });
  board(site, "default", { ...LOG_BOARD, chick: true });
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const picture = "https://e.com/a.png";
  const { document: held } = await write(site, {
    data: { image: picture, text: "" },
  });
  assert.equal(held.data.writing, true);
  // Someone else's comment does not finish it; its writer's edit does.
  site.now = 5000;
  await reply(site, { data: { logId: held.id, text: "기대돼요" } }, M2);
  assert.equal((await read(site, { id: held.id })).document.data.writing, true);
  const { document: done } = await write(site, {
    id: held.id,
    data: { image: picture, text: "완성" },
    revision: (await read(site, { id: held.id })).document.revision,
  });
  assert.equal(done.data.writing, undefined);
  assert.equal(
    site.rows("SELECT created_at FROM posts WHERE id = ?", Number(held.id))[0]
      .created_at,
    5000,
  );
  // The writer's own comment finishes another.
  const { document: second } = await write(site, {
    data: { image: picture, text: "" },
  });
  await reply(site, { data: { logId: second.id, text: "이어서" } });
  assert.equal(
    (await read(site, { id: second.id })).document.data.writing,
    undefined,
  );
  // With words already, a log is finished as it is posted.
  const { document: whole } = await write(site, {
    data: { image: picture, text: "한 번에" },
  });
  assert.equal(whole.data.writing, undefined);
});

test("추천 and 비추천 are members' one vote each on others' posts, where the board takes them", async () => {
  const site = await boardSite();
  board(site, "free", { ...PUBLIC_BOARD, useGood: true });
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const id = post(site, { board: "free", owner: "m-1", body: "글" });
  const vote = (kind, who = M2) =>
    site.mutate("community/posts:vote", { id, vote: kind }, who);
  assert.deepEqual(await vote("good"), { good: 1, nogood: 0 });
  assert.equal(await refusal(vote("good")), "voted");
  assert.equal(await refusal(vote("good", M1)), "own_post");
  assert.equal(await refusal(vote("nogood", M3)), "invalid_input");
  assert.equal(await refusal(vote("good", VISITOR)), "sign_in");
  const listed = (await listPage(site, { board: "free" })).documents[0];
  assert.deepEqual([listed.data.good, listed.data.nogood], [1, 0]);
});
