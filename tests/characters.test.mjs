// 실행: npm test
// The characters' queries and mutations on a real SQLite database with the
// site's migrations (tests/sql-ctx.mjs): sheets and their custom fields,
// the review, the official record (stats, titles, ranks), relations,
// outfits, couples and the viewer. The owner's admin is tests/admin.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testSite } from "./sql-ctx.mjs";

const M1 = { member: "m-1" };
const M2 = { member: "m-2" };
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
const setSettings = (site, key, value) =>
  site.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
const profile = (site, member, nick, main = null) =>
  site.run(
    "INSERT INTO profiles (member, nick, main_character) VALUES (?, ?, ?)",
    member,
    nick,
    main,
  );
/** A character row made directly; answers its ID as pages know it. */
function character(site, data = {}) {
  const row = {
    owner: "m-1",
    name: "Hero",
    created_at: site.now,
    ...data,
  };
  if (row.fields && typeof row.fields !== "string")
    row.fields = JSON.stringify(row.fields);
  if (row.stats && typeof row.stats !== "string")
    row.stats = JSON.stringify(row.stats);
  const columns = Object.keys(row);
  const { lastInsertRowid } = site.run(
    `INSERT INTO characters (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return String(lastInsertRowid);
}
const define = (site, code, data = {}) =>
  site.run(
    "INSERT INTO character_fields (id, label, type, options, visibility, required, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
    code,
    data.label ?? code,
    data.type ?? "text",
    JSON.stringify(data.options ?? []),
    data.visibility ?? "public",
    data.required ? 1 : 0,
    data.order ?? 0,
  );
const row = (site, id) =>
  site.rows("SELECT * FROM characters WHERE id = ?", Number(id))[0];
const fieldsOf = (site, id) => JSON.parse(row(site, id).fields);
const save = (site, args, who = M1) =>
  site.mutate("characters/sheet:save", args, who);

test("custom profile fields validate types and hide owner/admin values from other members", async () => {
  const site = await testSite();
  setSettings(site, "community", { characterLimit: 0 });
  define(site, "age", { type: "text", order: 1, required: true });
  define(site, "gender", { type: "select", options: ["F", "M"], order: 2 });
  define(site, "secret", { type: "textarea", visibility: "owner", order: 3 });
  define(site, "memo", { type: "text", visibility: "admin", order: 4 });
  define(site, "theme", { type: "url", order: 5 });
  const add = (data) => save(site, { data: { name: "New", ...data } });
  for (const fields of [
    { gender: "X" },
    { memo: "self-approved" },
    { unknown: "x" },
    { theme: "javascript:alert(1)" },
    { age: "1\n2" },
    { age: 3 },
    [],
  ])
    assert.equal(await refusal(add({ fields })), "invalid_field");
  assert.equal(
    await refusal(add({ fields: { secret: "가".repeat(2001) } })),
    "invalid_field",
  );
  assert.equal(
    await refusal(add({ state: "submitted", fields: { gender: "F" } })),
    "missing_fields",
  );
  assert.equal(await refusal(add({ state: "approved" })), "invalid_input");
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
  site.run(
    "UPDATE characters SET fields = ? WHERE id = ?",
    JSON.stringify({ ...created.data.fields, memo: "check age" }),
    Number(created.id),
  );
  const own = (
    await site.query("characters/sheet:sheet", { id: created.id }, M1)
  ).document;
  assert.deepEqual(Object.keys(own.data.fields), ["age", "gender", "secret"]);
  await save(site, {
    id: created.id,
    revision: own.revision,
    data: { ...own.data, fields: { gender: "M" } },
  });
  assert.deepEqual(fieldsOf(site, created.id), {
    age: "17",
    gender: "M",
    secret: "hidden past",
    memo: "check age",
  });
  const other = (
    await site.query("characters/sheet:sheet", { id: created.id }, M2)
  ).document;
  assert.deepEqual(other.data.fields, { age: "17", gender: "M" });
  // A visitor sees the public ones; the owner, all.
  assert.deepEqual(
    (await site.query("characters/sheet:sheet", { id: created.id })).document
      .data.fields,
    { age: "17", gender: "M" },
  );
  assert.equal(
    (await site.query("characters/sheet:sheet", { id: created.id }, OWNER))
      .document.data.fields.memo,
    "check age",
  );
  // Lists carry no custom values; definitions hide admin-only ones.
  const listed = await site.query("characters/sheet:list", {}, M2);
  assert.equal(
    listed.documents.find((entry) => entry.id === created.id).data.fields,
    undefined,
  );
  assert.deepEqual(
    (await site.query("characters/sheet:choices", null, M2)).fields.map(
      (entry) => entry.id,
    ),
    ["age", "gender", "secret", "theme"],
  );
  assert.ok(
    (await site.query("characters/sheet:choices", null, OWNER)).fields.some(
      (entry) => entry.id === "memo",
    ),
  );
  // Another member's sheet is not theirs to write.
  assert.equal(
    await refusal(save(site, { id: created.id, data: { name: "탈취" } }, M2)),
    "not_owned",
  );
});

test("the owner's review moves editing → submitted → approved, the record's approval with it", async () => {
  const site = await testSite();
  define(site, "memo", { label: "Memo", visibility: "admin" });
  const created = (
    await save(site, { data: { name: "Applicant", state: "submitted" } })
  ).document;
  assert.equal(
    await refusal(
      site.mutate(
        "characters/review:reviewCharacter",
        { character: created.id, state: "approved" },
        M1,
      ),
    ),
    "owner_only",
  );
  const reviewed = await site.mutate(
    "characters/review:reviewCharacter",
    {
      character: created.id,
      state: "approved",
      type: "npc",
      fields: { memo: "ok" },
      revision: created.revision,
    },
    OWNER,
  );
  assert.equal(reviewed.document.data.state, "approved");
  const status = await site.query(
    "characters/progression:characterStatus",
    { character: created.id },
    M1,
  );
  assert.equal(status.state.approved, true);
  assert.equal(status.state.owner, "m-1");
  // A page that read an older version is told so.
  assert.equal(
    await refusal(
      site.mutate(
        "characters/review:reviewCharacter",
        { character: created.id, state: "editing", revision: created.revision },
        OWNER,
      ),
    ),
    "conflict",
  );
  assert.equal(
    await refusal(
      site.mutate(
        "characters/review:reviewCharacter",
        { character: created.id, fields: { age: "1" } },
        OWNER,
      ),
    ),
    "invalid_input",
  );
  // The member's later edit cannot leave approval or the NPC type.
  const own = (
    await site.query("characters/sheet:sheet", { id: created.id }, M1)
  ).document;
  const saved = (
    await save(site, {
      id: created.id,
      revision: own.revision,
      data: { ...own.data, state: "editing", type: "main" },
    })
  ).document;
  assert.equal(saved.data.state, "approved");
  assert.equal(saved.data.type, "npc");
  assert.equal(fieldsOf(site, created.id).memo, "ok");
  await site.mutate(
    "characters/review:reviewCharacter",
    { character: created.id, state: "editing" },
    OWNER,
  );
  assert.equal(
    (
      await site.query(
        "characters/progression:characterStatus",
        { character: created.id },
        M1,
      )
    ).state.approved,
    false,
  );
  // The public applicant list narrows on the state.
  const approved = character(site, { name: "Done", state: "approved" });
  const applicants = await site.query("characters/sheet:list", {
    filter: "applicants",
    size: 0,
  });
  assert.deepEqual(
    applicants.documents.map((entry) => entry.id),
    [created.id],
  );
  assert.equal(applicants.total, 1);
  assert.deepEqual(applicants.nicks, {});
  assert.deepEqual(
    (
      await site.query("characters/sheet:list", { filter: "approved" })
    ).documents.map((entry) => entry.id),
    [approved],
  );
  assert.equal(
    await refusal(site.query("characters/sheet:list", { filter: "deleted" })),
    "invalid_input",
  );
});

test("lists page newest first, 멤버목록 oldest first, and name their owners", async () => {
  const site = await testSite();
  profile(site, "m-1", "아보");
  profile(site, "m-2", "카도");
  const ids = [];
  for (let n = 0; n < 5; n++)
    ids.push(
      character(site, {
        owner: n % 2 ? "m-2" : "m-1",
        name: `C${n}`,
        state: n < 3 ? "approved" : "editing",
      }),
    );
  const first = await site.query("characters/sheet:list", { size: 2 });
  assert.deepEqual(
    first.documents.map((entry) => entry.id),
    [ids[4], ids[3]],
  );
  assert.equal(first.total, 5);
  assert.deepEqual(first.nicks, { "m-1": "아보", "m-2": "카도" });
  assert.deepEqual(
    (
      await site.query("characters/sheet:list", { size: 2, page: 3 })
    ).documents.map((entry) => entry.id),
    [ids[0]],
  );
  assert.deepEqual(
    (
      await site.query("characters/sheet:list", { filter: "approved" })
    ).documents.map((entry) => entry.id),
    ids.slice(0, 3),
  );
  // Their own, oldest first; a name finds the first so named.
  assert.deepEqual(
    (await site.query("characters/sheet:mine", null, M2)).documents.map(
      (entry) => entry.id,
    ),
    [ids[1], ids[3]],
  );
  assert.equal(await refusal(site.query("characters/sheet:mine")), "sign_in");
  assert.equal(
    (await site.query("characters/sheet:named", { name: "C3" })).document.id,
    ids[3],
  );
  assert.equal(
    (
      await site.query("characters/sheet:named", {
        name: "C3",
        approved: true,
      })
    ).document,
    null,
  );
});

test("the owner's switches open and close creating and editing characters, and limit them", async () => {
  const site = await testSite();
  const data = { name: "하나", type: "main", state: "editing" };
  // The original's install default: one character a member.
  setSettings(site, "community", { characterLimit: 1 });
  const first = await save(site, { data });
  assert.equal(
    await refusal(save(site, { data: { ...data, name: "둘" } })),
    "character_limit",
  );
  setSettings(site, "community", { characterCreation: false });
  assert.equal(
    await refusal(save(site, { data: { ...data, name: "둘" } })),
    "creation_closed",
  );
  setSettings(site, "community", { characterEditing: false });
  // An application can still be finished; an approved sheet waits.
  const finished = await save(site, {
    id: first.document.id,
    revision: first.document.revision,
    data: { ...data, profile: "신청 중 고침" },
  });
  assert.equal(finished.document.data.profile, "신청 중 고침");
  site.run("UPDATE characters SET state = 'approved'");
  assert.equal(
    await refusal(
      save(site, {
        id: first.document.id,
        data: { ...data, profile: "고침" },
      }),
    ),
    "editing_closed",
  );
  // The limit is the default one until the owner says otherwise; a deleted
  // character no longer counts.
  setSettings(site, "community", {});
  site.run("UPDATE characters SET state = 'editing'");
  await site.mutate("characters/sheet:remove", { id: first.document.id }, M1);
  await save(site, { data: { ...data, name: "둘" } });
});

test("characters choose 소속 and 종족 from the owner's lists once there are any, up to their level", async () => {
  const site = await testSite();
  setSettings(site, "community", { characterLimit: 0 });
  const data = { name: "하나", type: "main", state: "editing" };
  const free = await save(site, { data: { ...data, side: "아무거나" } });
  assert.equal(free.document.data.side, "아무거나");
  site.run("INSERT INTO sides (id, name) VALUES ('a', '빛')");
  site.run("INSERT INTO classes (id, name) VALUES ('x', '인간')");
  assert.equal(
    await refusal(save(site, { data: { ...data, side: "어둠" } })),
    "invalid_input",
  );
  const chosen = await save(site, {
    data: { ...data, side: "빛", class: "인간" },
  });
  assert.deepEqual(
    [chosen.document.data.side, chosen.document.data.class],
    ["빛", "인간"],
  );
  // A value the character already has stays when the list changes.
  site.run("DELETE FROM sides");
  site.run("INSERT INTO sides (id, name) VALUES ('b', '그림자')");
  const kept = await save(site, {
    id: chosen.document.id,
    data: { ...data, name: "둘", side: "빛", class: "인간" },
  });
  assert.equal(kept.document.data.side, "빛");
  // si_auth: a member is level 2 until the owner sets another.
  site.run("INSERT INTO sides (id, name, level) VALUES ('c', '왕실', 5)");
  assert.equal(
    await refusal(save(site, { data: { ...data, side: "왕실" } })),
    "invalid_input",
  );
  site.run("INSERT INTO members (member, level) VALUES ('m-1', 5)");
  assert.equal(
    (await save(site, { data: { ...data, side: "왕실" } })).document.data.side,
    "왕실",
  );
  // Refusals name the lists as the owner does (기타 항목명 설정).
  setSettings(site, "community", { characterLimit: 0, sideTitle: "진영" });
  const refused = await save(site, { data: { ...data, side: "어둠" } }).catch(
    (error) => error,
  );
  assert.equal(refused.message, "진영을(를) 목록에서 골라 주세요.");
  // The lists in the owner's order, with the custom fields.
  const choices = await site.query("characters/sheet:choices");
  assert.deepEqual(
    choices.sides.map((entry) => [entry.id, entry.data.name, entry.data.level]),
    [
      ["b", "그림자", 1],
      ["c", "왕실", 5],
    ],
  );
  assert.deepEqual(choices.classes[0].data.name, "인간");
});

test("a member's first character is their 대표, with its 두상·흉상·전신, deleted only before approval", async () => {
  const site = await testSite();
  setSettings(site, "community", { characterLimit: 0 });
  profile(site, "m-1", "앨리스");
  const data = {
    name: "하나",
    type: "main",
    state: "editing",
    image: "https://example.com/thumb.png",
    head: "https://example.com/head.png",
    body: "https://example.com/body.png",
  };
  const first = await save(site, { data });
  const main = () =>
    site.rows("SELECT main_character FROM profiles WHERE member = 'm-1'")[0]
      .main_character;
  assert.equal(main(), first.document.id);
  assert.deepEqual(
    ["image", "head", "body"].map((key) => first.document.data[key]),
    [data.image, data.head, data.body],
  );
  // The second does not take the 대표 over.
  const second = await save(site, { data: { ...data, name: "둘" } });
  assert.equal(main(), first.document.id);
  // A sheet that leaves a picture out keeps it; a bad address is refused.
  const { image, head, body, ...rest } = data;
  const kept = await save(site, {
    id: first.document.id,
    revision: first.document.revision,
    data: rest,
  });
  assert.equal(kept.document.data.body, body);
  await assert.rejects(
    save(site, {
      id: first.document.id,
      data: { ...rest, image: "javascript:alert(1)" },
    }),
    /HTTPS/,
  );
  // The 대표 is the member's choice among their own.
  await site.mutate(
    "characters/profile:mainCharacter",
    { character: second.document.id },
    M1,
  );
  assert.equal(main(), second.document.id);
  assert.equal(
    await refusal(
      site.mutate(
        "characters/profile:mainCharacter",
        { character: second.document.id },
        M2,
      ),
    ),
    "not_owned",
  );
  site.run("UPDATE characters SET state = 'approved' WHERE id = ?", 1);
  assert.equal(
    await refusal(
      site.mutate("characters/sheet:remove", { id: first.document.id }, M1),
    ),
    "approved",
  );
  // Deleting the 대표 makes the oldest remaining one it.
  await site.mutate("characters/sheet:remove", { id: second.document.id }, M1);
  assert.equal(main(), first.document.id);
  assert.equal(
    await refusal(
      site.mutate("characters/sheet:remove", { id: second.document.id }, M1),
    ),
    "document_not_found",
  );
});

test("the owner edits any character fully, outside the member's periods and limit", async () => {
  const site = await testSite();
  setSettings(site, "community", {
    characterCreation: false,
    characterEditing: false,
    characterLimit: 1,
  });
  profile(site, "m-2", "카도");
  const rival = character(site, { owner: "m-2", name: "Rival" });
  site.run("INSERT INTO sides (id, name) VALUES ('east', '동쪽')");
  define(site, "age", { label: "나이", type: "select", options: ["10", "20"] });
  define(site, "diary", { type: "textarea", visibility: "owner" });
  define(site, "memo", { visibility: "admin" });
  define(site, "art", { type: "image", required: true });
  // adm/character_form_update.php saves every field, type and state.
  const saved = await save(
    site,
    {
      id: rival,
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
    },
    OWNER,
  );
  const {
    owner,
    name,
    side,
    class: kind,
    profile: text,
    image,
    type,
    state,
  } = row(site, rival);
  assert.deepEqual(
    { owner, name, side, kind, text, image, type, state },
    {
      owner: "m-2",
      name: "새 이름",
      side: "동쪽",
      kind: "",
      text: "운영자가 고침",
      image: "https://example.com/rival.png",
      type: "npc",
      state: "submitted",
    },
  );
  assert.deepEqual(fieldsOf(site, rival), {
    age: "20",
    diary: "비밀",
    memo: "확인",
  });
  assert.equal(saved.document.data.fields.memo, "확인");
  // Approving from the form approves the official record too.
  await save(
    site,
    { id: rival, data: { name: "새 이름", state: "approved" } },
    OWNER,
  );
  assert.equal(
    (
      await site.query(
        "characters/progression:characterStatus",
        { character: rival },
        OWNER,
      )
    ).state.approved,
    true,
  );
  assert.equal(fieldsOf(site, rival).memo, "확인");
  // Values are checked as a member's: options, the 소속 list, lengths.
  for (const data of [
    { name: "x", fields: { age: "30" } },
    { name: "x", fields: { missing: "1" } },
    { name: "x", state: "removed" },
    { name: "x", type: "test" },
    { name: "x", side: "서쪽" },
  ])
    assert.notEqual(
      await refusal(save(site, { id: rival, data }, OWNER)),
      null,
    );
  await assert.rejects(save(site, { id: rival, data: { name: "" } }, OWNER));
  // A member still edits and deletes only their own.
  assert.equal(
    await refusal(save(site, { id: rival, data: { name: "탈취" } })),
    "not_owned",
  );
  assert.equal(
    await refusal(site.mutate("characters/sheet:remove", { id: rival }, M1)),
    "not_owned",
  );
  assert.equal(
    await refusal(site.mutate("characters/sheet:remove", { id: rival })),
    "access_denied",
  );
});

test("the owner registers a character for a member named by nickname", async () => {
  const site = await testSite();
  setSettings(site, "community", {
    characterCreation: false,
    characterLimit: 1,
  });
  profile(site, "m-1", "아보");
  profile(site, "m-2", "카도");
  const hero = character(site, { owner: "m-1" });
  site.run("UPDATE profiles SET main_character = ? WHERE member = 'm-1'", hero);
  character(site, { owner: "m-2", name: "Rival" });
  const data = { name: "선물", type: "main", state: "approved" };
  for (const nick of ["없는사람", "", null])
    assert.equal(await refusal(save(site, { nick, data }, OWNER)), "no_member");
  // 카도 already has Rival and creation is closed: neither stops the owner.
  const { document } = await save(site, { nick: "카도", data }, OWNER);
  assert.equal(document.data.owner, "m-2");
  assert.equal(row(site, document.id).state, "approved");
  // Their first 대표: it becomes their main character, as ch_id is set.
  assert.equal(
    site.rows("SELECT main_character FROM profiles WHERE member = 'm-2'")[0]
      .main_character,
    document.id,
  );
  await save(site, { nick: "아보", data }, OWNER);
  assert.equal(
    site.rows("SELECT main_character FROM profiles WHERE member = 'm-1'")[0]
      .main_character,
    hero,
  );
  // Members still meet the switches.
  assert.equal(
    await refusal(save(site, { data: { name: "몰래" } })),
    "creation_closed",
  );
});

test("deleting a character takes what character_delete.php removes, in one call", async () => {
  const site = await testSite();
  profile(site, "m-1", "아보");
  const elder = character(site, { owner: "m-1", name: "Elder" });
  const hero = character(site, { owner: "m-1", name: "Hero" });
  const rival = character(site, { owner: "m-2", name: "Rival" });
  site.run("UPDATE profiles SET main_character = ?", hero);
  for (let n = 0; n < 30; n++)
    site.run(
      "INSERT INTO wardrobe (owner, character_id, name, image) VALUES ('m-1', ?, 'w', 'https://example.com/w.png')",
      Number(hero),
    );
  for (const [source, target] of [
    [rival, hero],
    [hero, rival],
  ])
    site.run(
      "INSERT INTO relations (owner, character_id, target, created_at) VALUES ('m-2', ?, ?, 0)",
      Number(source),
      Number(target),
    );
  site.run(
    "INSERT INTO couples (id, first, second) VALUES ('c', ?, ?), ('d', ?, ?)",
    Number(hero),
    Number(rival),
    Number(rival),
    Number(hero),
  );
  site.run("INSERT INTO titles (id, name) VALUES ('brave', 'Brave')");
  site.run(
    "INSERT INTO character_titles (character_id, title_id) VALUES (?, 'brave')",
    Number(hero),
  );
  site.run("INSERT INTO wallets (member, balance) VALUES ('m-1', 100)");
  assert.deepEqual(
    await site.mutate("characters/sheet:remove", { id: hero }, OWNER),
    { done: true },
  );
  assert.equal(row(site, hero), undefined);
  for (const table of ["wardrobe", "relations", "couples", "character_titles"])
    assert.equal(site.rows(`SELECT * FROM ${table}`).length, 0, table);
  // The oldest remaining one becomes the 대표 (extend/character.lib.php:5-12).
  assert.equal(
    site.rows("SELECT main_character FROM profiles")[0].main_character,
    elder,
  );
  assert.ok(row(site, rival));
  assert.equal(site.rows("SELECT balance FROM wallets")[0].balance, 100);
  // The last one leaves none.
  await site.mutate("characters/sheet:remove", { id: elder }, M1);
  assert.equal(
    site.rows("SELECT main_character FROM profiles")[0].main_character,
    null,
  );
});

test("the owner moves a character to another member, with what it keeps", async () => {
  const site = await testSite();
  profile(site, "m-1", "아보");
  profile(site, "m-2", "카도");
  const hero = character(site, { owner: "m-1" });
  const rival = character(site, { owner: "m-2", name: "Rival" });
  site.run("UPDATE profiles SET main_character = ? WHERE member = 'm-1'", hero);
  site.run(
    "UPDATE profiles SET main_character = ? WHERE member = 'm-2'",
    rival,
  );
  for (let n = 0; n < 20; n++)
    site.run(
      "INSERT INTO wardrobe (owner, character_id, name, image) VALUES ('m-1', ?, 'w', 'https://example.com/w.png')",
      Number(hero),
    );
  site.run(
    "INSERT INTO relations (owner, character_id, target, created_at) VALUES ('m-1', ?, ?, 0)",
    Number(hero),
    Number(rival),
  );
  const move = (args, who = OWNER) =>
    site.mutate("characters/sheet:move", args, who);
  assert.equal(
    await refusal(move({ id: hero, nick: "카도" }, M1)),
    "owner_only",
  );
  assert.equal(
    await refusal(move({ id: hero, nick: "없는사람" })),
    "no_member",
  );
  assert.equal(
    await refusal(move({ id: "999", nick: "카도" })),
    "document_not_found",
  );
  assert.equal(
    await refusal(move({ id: hero, nick: "카도", revision: "0" })),
    "conflict",
  );
  // 카도 already has Rival: the owner is not held to the limit.
  const moved = await move({ id: hero, nick: "카도", revision: "1" });
  assert.equal(moved.document.data.owner, "m-2");
  assert.equal(moved.done, true);
  assert.equal(row(site, hero).owner, "m-2");
  assert.deepEqual(site.rows("SELECT DISTINCT owner FROM wardrobe"), [
    { owner: "m-2" },
  ]);
  assert.equal(site.rows("SELECT owner FROM relations")[0].owner, "m-2");
  // Its former owner has no 대표 left; its new one keeps theirs.
  assert.deepEqual(
    site.rows("SELECT member, main_character FROM profiles ORDER BY member"),
    [
      { member: "m-1", main_character: null },
      { member: "m-2", main_character: rival },
    ],
  );
  // The new owner uses it; the former one no longer can.
  const outfit = {
    character: hero,
    name: "옷",
    image: "https://example.com/o.png",
  };
  assert.equal(
    await refusal(site.mutate("characters/wardrobe:outfit", outfit, M1)),
    "not_owned",
  );
  const coat = site.rows("SELECT id FROM wardrobe LIMIT 1")[0].id;
  await site.mutate(
    "characters/wardrobe:wear",
    { character: hero, outfit: String(coat) },
    M2,
  );
  assert.equal(row(site, hero).outfit, coat);
});

test("a member without a 대표 is given the moved character as theirs", async () => {
  const site = await testSite();
  profile(site, "m-1", "아보");
  profile(site, "m-2", "카도");
  const hero = character(site, { owner: "m-1" });
  site.run("UPDATE profiles SET main_character = ? WHERE member = 'm-1'", hero);
  await site.mutate("characters/sheet:move", { id: hero, nick: "카도" }, OWNER);
  assert.deepEqual(
    site.rows("SELECT member, main_character FROM profiles ORDER BY member"),
    [
      { member: "m-1", main_character: null },
      { member: "m-2", main_character: hero },
    ],
  );
});

test("stat allocation is bounded by server points and preserves damage through zero and back", async () => {
  const site = await testSite();
  const hero = character(site, { owner: "m-1", name: "Hero" });
  setSettings(site, "community", { initialStatPoints: 10 });
  site.run(
    "INSERT INTO stats (id, name, initial, max) VALUES ('hp', 'HP', 0, 100)",
  );
  site.run(
    "INSERT INTO levels (id, name, exp) VALUES ('novice', '초보', 0), ('expert', '전문가', 100)",
  );
  const status = () =>
    site.query("characters/progression:characterStatus", { character: hero });
  const first = await status();
  // The owner's starting points until the record is first written.
  assert.equal(first.state.points, 10);
  assert.equal(first.state.exp, 0);
  assert.equal(first.rank, "초보");
  assert.equal(first.state.purchases, undefined);
  assert.deepEqual(first.definitions, [
    {
      id: "hp",
      data: { name: "HP", initial: 0, max: 100, min: 0, help: "" },
    },
  ]);
  const allocate = (allocation, revision, who = M1) =>
    site.mutate(
      "characters/progression:allocateStats",
      { character: hero, allocation, revision },
      who,
    );
  assert.equal(
    await refusal(allocate({ hp: 11 }, first.revision)),
    "not_enough_points",
  );
  const { revision } = await allocate({ hp: 10 }, first.revision);
  assert.equal(row(site, hero).points, 10);
  site.run(
    "UPDATE characters SET stats = ? WHERE id = ?",
    JSON.stringify({ hp: { allocated: 10, max: 10, damage: 7, current: 3 } }),
    Number(hero),
  );
  const zero = await allocate({ hp: 0 }, revision);
  const back = await allocate({ hp: 10 }, zero.revision);
  assert.equal((await status()).state.stats.hp.current, 3);
  // The owner's starting points no longer change a written record.
  setSettings(site, "community", { initialStatPoints: 20 });
  assert.equal((await status()).state.points, 10);
  assert.equal(await refusal(allocate({ hp: 2 }, "1")), "conflict");
  assert.equal(
    await refusal(allocate({ hp: 2, invented: 0 }, back.revision)),
    "invalid_input",
  );
  assert.equal(
    await refusal(allocate({ hp: 2 }, back.revision, M2)),
    "not_owned",
  );
  // st_min: a stat starts no lower than the owner's minimum.
  site.run("UPDATE stats SET min = 3");
  assert.equal(
    await refusal(allocate({ hp: 1 }, back.revision)),
    "below_minimum",
  );
  await allocate({ hp: 3 }, back.revision);
  // Ranks: the highest reached.
  site.run("UPDATE characters SET exp = 150");
  assert.equal((await status()).rank, "전문가");
});

test("an approved character only spends its points left, and no stat goes down", async () => {
  const site = await testSite();
  const hero = character(site, {
    owner: "m-1",
    state: "approved",
    points: 10,
    stats: {
      hp: { allocated: 4, max: 4, damage: 0, current: 4 },
      mp: { allocated: 2, max: 2, damage: 0, current: 2 },
    },
  });
  site.run(
    "INSERT INTO stats (id, name, initial, max) VALUES ('hp', 'HP', 0, 100), ('mp', 'MP', 0, 100)",
  );
  const allocate = (allocation) =>
    site.mutate(
      "characters/progression:allocateStats",
      { character: hero, allocation },
      M1,
    );
  // mypage/character/status.inc.php:17-25: approved, the form starts from
  // what each stat has (status_fix), and only the space point is spent.
  assert.equal(await refusal(allocate({ hp: 3, mp: 3 })), "approved_stats");
  assert.equal(await refusal(allocate({ hp: 6, mp: 5 })), "not_enough_points");
  await allocate({ hp: 6, mp: 4 });
  assert.equal(JSON.parse(row(site, hero).stats).hp.max, 6);
  // Before approval the owner moves points freely.
  site.run("UPDATE characters SET state = 'submitted'");
  await allocate({ hp: 0, mp: 10 });
  assert.equal(JSON.parse(row(site, hero).stats).mp.max, 10);
});

test("a character shows only titles it was given and that are in use", async () => {
  const site = await testSite();
  const hero = character(site, { owner: "m-1" });
  site.run(
    "INSERT INTO titles (id, name) VALUES ('winner', 'Winner'), ('unearned', 'Unearned')",
  );
  site.run(
    "INSERT INTO character_titles (character_id, title_id) VALUES (?, 'winner')",
    Number(hero),
  );
  const equip = (title, who = M1) =>
    site.mutate(
      "characters/progression:equipTitle",
      { character: hero, title },
      who,
    );
  assert.equal(await refusal(equip("unearned")), "missing_title");
  assert.equal(await refusal(equip("winner", M2)), "not_owned");
  await equip("winner");
  assert.equal(row(site, hero).active_title, "winner");
  // A title out of use (ti_use) cannot be shown, nor one deleted.
  site.run("UPDATE titles SET enabled = 0 WHERE id = 'winner'");
  assert.equal(await refusal(equip("winner")), "missing_title");
  const details = await site.query("characters/sheet:details", {
    character: hero,
  });
  assert.deepEqual(details.titles, []);
  assert.deepEqual(details.status.state.titles, ["winner"]);
  site.run("UPDATE titles SET enabled = 1");
  assert.deepEqual(
    (await site.query("characters/sheet:details", { character: hero })).titles,
    [{ id: "winner", data: { name: "Winner", image: null } }],
  );
  site.run("DELETE FROM titles WHERE id = 'winner'");
  assert.equal(await refusal(equip("winner")), "missing_title");
  await equip(null);
  assert.equal(row(site, hero).active_title, null);
});

test("character relationships validate source ownership, targets, revisions and text", async () => {
  const site = await testSite();
  const mine = character(site, {
    owner: "m-1",
    name: "내 캐릭터",
    state: "submitted",
  });
  const other = character(site, { owner: "m-2", name: "상대" });
  const relation = (args, who = M1) =>
    site.mutate("characters/relations:relation", args, who);
  const args = {
    character: mine,
    target: other,
    affinity: 3,
    memo: "친구",
    order: 1,
  };
  // Only an approved character has relations (viewer.php:157-196).
  assert.equal(await refusal(relation(args)), "not_approved");
  site.run(
    "UPDATE characters SET state = 'approved' WHERE id = ?",
    Number(mine),
  );
  assert.equal(
    await refusal(relation({ ...args, character: other, target: mine })),
    "not_owned",
  );
  assert.equal(
    await refusal(relation({ ...args, target: mine })),
    "no_character",
  );
  assert.equal(
    await refusal(relation({ ...args, target: "999" })),
    "no_character",
  );
  for (const affinity of [6, -1, 1.5])
    assert.equal(
      await refusal(relation({ ...args, affinity })),
      "invalid_input",
    );
  for (const link of [
    "https://example.com/a\njavascript:alert(1)",
    "javascript:alert(1)",
  ])
    await assert.rejects(relation({ ...args, link }), /HTTPS/);
  assert.equal(site.rows("SELECT * FROM relations").length, 0);
  // Several links, one per line (rm_link); blank lines drop.
  const created = (
    await relation({
      ...args,
      link: " https://example.com/a \n\nhttps://example.com/b",
    })
  ).document;
  assert.equal(created.data.owner, "m-1");
  assert.equal(created.data.target, other);
  assert.equal(
    created.data.link,
    "https://example.com/a\nhttps://example.com/b",
  );
  assert.equal(
    await refusal(
      relation({ ...args, id: created.id, revision: "old", memo: "changed" }),
    ),
    "conflict",
  );
  assert.equal(site.rows("SELECT memo FROM relations")[0].memo, "친구");
  await relation({
    ...args,
    id: created.id,
    revision: created.revision,
    memo: "새 관계",
  });
  // The page shows them with their targets' names, rm_order then newest.
  const later = (await relation({ ...args, memo: "둘째", order: 0 })).document;
  const shown = await site.query("characters/sheet:details", {
    character: mine,
  });
  assert.deepEqual(
    shown.relations.map((entry) => [entry.id, entry.data.memo, entry.target]),
    [
      [later.id, "둘째", { id: other, name: "상대" }],
      [created.id, "새 관계", { id: other, name: "상대" }],
    ],
  );
  assert.equal(
    await refusal(
      site.mutate(
        "characters/relations:removeRelation",
        { id: created.id },
        M2,
      ),
    ),
    "not_owned",
  );
  await site.mutate(
    "characters/relations:removeRelation",
    { id: created.id },
    M1,
  );
  assert.equal(site.rows("SELECT * FROM relations").length, 1);
});

test("wardrobe protects characters, rejects unsafe addresses and keeps the active outfit", async () => {
  const site = await testSite();
  const mine = character(site, { owner: "m-1", name: "내 캐릭터" });
  const other = character(site, { owner: "m-2", name: "상대" });
  const call = (name, args, who = M1) =>
    site.mutate(`characters/wardrobe:${name}`, args, who);
  for (const image of [
    "javascript:alert(1)",
    "data:image/png;base64,x",
    "http://example.com/image",
    "https://user:secret@example.com/image",
    "https://example.com/a b",
  ])
    await assert.rejects(
      call("outfit", { character: mine, name: "외출복", image }),
      /HTTPS/,
    );
  assert.equal(site.rows("SELECT * FROM wardrobe").length, 0);
  const clothing = (
    await call("outfit", {
      character: mine,
      name: "외출복",
      image: "https://media.naru.pub/outfit.png",
    })
  ).document;
  assert.equal(
    await refusal(call("wear", { character: other, outfit: clothing.id })),
    "not_owned",
  );
  assert.equal(
    await refusal(call("wear", { character: other, outfit: clothing.id }, M2)),
    "not_owned",
  );
  // cloest_path_update.php: the owner renames it or changes its address.
  await call("editOutfit", {
    id: clothing.id,
    name: "정장",
    image: "https://media.naru.pub/suit.png",
  });
  assert.deepEqual(site.rows("SELECT name, image FROM wardrobe"), [
    { name: "정장", image: "https://media.naru.pub/suit.png" },
  ]);
  await assert.rejects(
    call("editOutfit", {
      id: clothing.id,
      name: "정장",
      image: "javascript:alert(1)",
    }),
    /HTTPS/,
  );
  assert.equal(
    await refusal(
      call(
        "editOutfit",
        {
          id: clothing.id,
          name: "뺏기",
          image: "https://media.naru.pub/x.png",
        },
        M2,
      ),
    ),
    "not_owned",
  );
  const worn = await call("wear", { character: mine, outfit: clothing.id });
  assert.equal(worn.document.data.outfit, clothing.id);
  // The viewer's 전신 is the worn outfit.
  assert.equal(
    (await site.query("characters/sheet:sheet", { id: mine })).outfitImage,
    "https://media.naru.pub/suit.png",
  );
  assert.equal(
    await refusal(call("removeOutfit", { id: clothing.id })),
    "outfit_in_use",
  );
  assert.equal(
    await refusal(call("removeOutfit", { id: clothing.id }, M2)),
    "not_owned",
  );
  await call("wear", { character: mine, outfit: null });
  await call("removeOutfit", { id: clothing.id });
  assert.equal(site.rows("SELECT * FROM wardrobe").length, 0);
});

test("a character's page reads its record, titles, couples, relations and outfits at once", async () => {
  const site = await testSite();
  define(site, "age", { order: 1 });
  define(site, "diary", { visibility: "owner", order: 2 });
  const hero = character(site, {
    owner: "m-1",
    name: "Hero",
    exp: 5,
    fields: { age: "17", diary: "비밀" },
  });
  const rival = character(site, { owner: "m-2", name: "Rival" });
  site.run(
    "INSERT INTO couples (id, first, second, since) VALUES ('pair', ?, ?, '2030-01-01'), ('lost', 999, ?, NULL)",
    Number(rival),
    Number(hero),
    Number(hero),
  );
  site.run(
    "INSERT INTO wardrobe (owner, character_id, name, image) VALUES ('m-1', ?, '코트', 'https://example.com/c.png')",
    Number(hero),
  );
  const details = await site.query("characters/sheet:details", {
    character: hero,
  });
  assert.deepEqual(details.fields, { age: "17" });
  assert.equal(details.status.state.exp, 5);
  assert.deepEqual(
    details.couples.map((couple) => [couple.id, couple.partner]),
    [
      ["lost", null],
      ["pair", { id: rival, name: "Rival" }],
    ],
  );
  assert.deepEqual(
    details.wardrobe.map((entry) => entry.data.name),
    ["코트"],
  );
  assert.deepEqual(
    (await site.query("characters/sheet:details", { character: hero }, M1))
      .fields,
    { age: "17", diary: "비밀" },
  );
  assert.equal(
    await refusal(site.query("characters/sheet:details", { character: "999" })),
    "no_character",
  );
  // 커플목록: both sides, a gone one as null.
  const { couples } = await site.query("characters/couples:list");
  assert.deepEqual(
    couples.map((couple) => [
      couple.id,
      couple.first?.data.name ?? null,
      couple.second?.data.name ?? null,
      couple.data.since,
    ]),
    [
      ["lost", null, "Hero", null],
      ["pair", "Rival", "Hero", "2030-01-01"],
    ],
  );
});

test("the viewer's experience history comes a page at a time, with money where the owner shows it", async () => {
  const site = await testSite();
  const hero = character(site, { owner: "m-2", name: "용사" });
  for (let n = 0; n < 25; n++)
    site.run(
      "INSERT INTO history (owner, kind, at, exp_delta, exp, character_id, memo) VALUES ('m-2', 'exp', ?, 1, ?, ?, ?)",
      n,
      n + 1,
      hero,
      n === 24 ? "첫 모험" : null,
    );
  site.run(
    "INSERT INTO history (owner, kind, at, character_id) VALUES ('m-2', 'buy', 99, ?)",
    hero,
  );
  site.run(
    "INSERT INTO history (owner, kind, at, exp_delta, exp, character_id) VALUES ('m-2', 'exp', 100, 3, 3, '999')",
  );
  site.run("INSERT INTO wallets (member, balance) VALUES ('m-2', 42)");
  const sheet = (args) =>
    site.query("characters/progression:characterSheet", {
      character: hero,
      ...args,
    });
  const first = await sheet();
  assert.equal(first.exp.length, 20);
  assert.deepEqual(first.exp[0], {
    at: 24,
    delta: 1,
    exp: 25,
    memo: "첫 모험",
  });
  assert.ok(first.expCursor);
  assert.equal(first.showsInventory, false);
  assert.equal(first.balance, null);
  const second = await sheet({ after: first.expCursor });
  assert.equal(second.exp.length, 5);
  assert.equal(second.expCursor, null);
  assert.equal(Object.hasOwn(second, "balance"), false);
  assert.equal(await refusal(sheet({ size: 51 })), "invalid_input");
  setSettings(site, "community", { viewerInventory: true, viewerMoney: true });
  const shown = await sheet();
  assert.equal(shown.showsInventory, true);
  assert.equal(shown.balance, 42);
  assert.equal(
    await refusal(
      site.query("characters/progression:characterSheet", {
        character: "nobody",
      }),
    ),
    "no_character",
  );
});

test("사이트공개: visitors read characters while the site is open, members always", async () => {
  const site = await testSite();
  const hero = character(site, { owner: "m-1", state: "approved" });
  site.run("INSERT INTO sides (id, name) VALUES ('forest', '숲')");
  const reads = (who) => [
    site.query("characters/sheet:list", null, who),
    site.query("characters/sheet:sheet", { id: hero }, who),
    site.query("characters/sheet:choices", null, who),
    site.query("characters/sheet:details", { character: hero }, who),
    site.query("characters/sheet:named", { name: "Hero" }, who),
    site.query("characters/couples:list", null, who),
    site.query(
      "characters/progression:characterStatus",
      { character: hero },
      who,
    ),
    site.query(
      "characters/progression:characterSheet",
      { character: hero },
      who,
    ),
  ];
  for (const read of reads()) assert.equal(await refusal(read), null);
  setSettings(site, "community", { siteOpen: false });
  for (const read of reads()) assert.equal(await refusal(read), "site_closed");
  for (const who of [M2, OWNER])
    for (const read of reads(who)) assert.equal(await refusal(read), null);
});

test("선택삭제 puts a character away, out of every list and use, until the owner recovers or removes it", async () => {
  const site = await testSite();
  setSettings(site, "community", { characterLimit: 2 });
  profile(site, "m-1", "하나");
  profile(site, "m-2", "둘");
  const hero = character(site, { name: "Hero", state: "approved" });
  const other = character(site, { name: "Other", state: "approved" });
  site.run("UPDATE profiles SET main_character = ? WHERE member = 'm-1'", hero);
  const review = (state, id = hero) =>
    site.mutate(
      "characters/review:reviewCharacter",
      { character: id, state, revision: row(site, id).version.toString() },
      OWNER,
    );
  await review("deleted");
  assert.equal(row(site, hero).state, "deleted");
  // The member's 대표 moves to what they still have (ch_id cleared).
  assert.equal(
    site.rows("SELECT main_character FROM profiles WHERE member = 'm-1'")[0]
      .main_character,
    other,
  );
  const ids = (result) => result.documents.map((entry) => entry.id);
  assert.deepEqual(ids(await site.query("characters/sheet:list", {}, M2)), [
    other,
  ]);
  assert.deepEqual(
    ids(await site.query("characters/sheet:list", { filter: "approved" }, M2)),
    [other],
  );
  assert.deepEqual(ids(await site.query("characters/sheet:mine", {}, M1)), [
    other,
  ]);
  assert.equal(
    (await site.query("characters/sheet:sheet", { id: hero }, M1)).document,
    null,
  );
  assert.equal(
    (await site.query("characters/sheet:named", { name: "Hero" }, M2)).document,
    null,
  );
  assert.notEqual(
    (await site.query("characters/sheet:sheet", { id: hero }, OWNER)).document,
    null,
  );
  // Its member neither speaks as it nor changes or removes it.
  site.run(
    "INSERT INTO boards (id, name, kind) VALUES ('default', '로그', 'text')",
  );
  assert.equal(
    await refusal(
      site.mutate(
        "community/posts:write",
        { data: { text: "x", character: hero } },
        M1,
      ),
    ),
    "not_owned",
  );
  assert.equal(
    await refusal(save(site, { id: hero, data: { name: "Hero" } })),
    "document_not_found",
  );
  assert.equal(
    await refusal(site.mutate("characters/sheet:remove", { id: hero }, M1)),
    "document_not_found",
  );
  // Nor counts it toward the limit: a new one fits beside Other.
  assert.equal(
    await refusal(save(site, { data: { name: "New", state: "editing" } })),
    null,
  );
  // Another state recovers it, as the member's 대표 if they had none.
  site.run("UPDATE profiles SET main_character = NULL WHERE member = 'm-1'");
  await review("approved");
  assert.equal(row(site, hero).state, "approved");
  assert.equal(
    site.rows("SELECT main_character FROM profiles WHERE member = 'm-1'")[0]
      .main_character,
    hero,
  );
  // 선택제거 deletes it for good.
  await review("deleted");
  await site.mutate("characters/sheet:remove", { id: hero }, OWNER);
  assert.equal(row(site, hero), undefined);
});

test("신청자목록 is searched by a 공개 profile field, as member/ready.php's arcode", async () => {
  const site = await testSite();
  profile(site, "m-1", "하나");
  define(site, "age", { label: "나이" });
  define(site, "secret", { label: "비밀", visibility: "admin" });
  character(site, {
    name: "가",
    state: "submitted",
    fields: { age: "17세", secret: "x" },
  });
  character(site, { name: "나", state: "editing", fields: { age: "20세" } });
  character(site, { name: "다", state: "approved", fields: { age: "17세" } });
  const names = async (args) =>
    (
      await site.query(
        "characters/sheet:list",
        { filter: "applicants", size: 0, ...args },
        M1,
      )
    ).documents.map((row) => row.data.name);
  assert.deepEqual(await names({ field: "age", text: "17" }), ["가"]);
  assert.equal(
    (
      await site.query(
        "characters/sheet:list",
        { filter: "applicants", size: 0, field: "age", text: "세" },
        M1,
      )
    ).total,
    2,
  );
  // A field not everyone reads is not searched.
  await assert.rejects(names({ field: "secret", text: "x" }));
  await assert.rejects(names({ field: "nope", text: "x" }));
});
