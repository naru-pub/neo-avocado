// 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { JSDOM } from "jsdom";
const root = new URL("../", import.meta.url);

const PROFILES = "neo_avocado_profiles";
const CHARACTERS = "neo_avocado_characters";
const LOGS = "neo_avocado_logs";
const COMMENTS = "neo_avocado_comments";
const ME = "member-me";

// 회원 컬렉션을 흉내 내는 가짜 데이터베이스. 이 테스트들이 보는 것은 페이지가
// 어떤 질의를 보내는지, 그리고 누가 쓴 문서인지(createdBy)를 어떻게 다루는지다.
function fakeDatabase(rows = {}) {
  // 페이지(jsdom)에서 만든 객체를 이 프로세스의 것으로 옮겨 적는다. 그래야
  // deepEqual이 내용만 비교한다.
  const recorded = [];
  const calls = {
    push: (call) => recorded.push(JSON.parse(JSON.stringify(call))),
    filter: (...args) => recorded.filter(...args),
    find: (...args) => recorded.find(...args),
    some: (...args) => recorded.some(...args),
    at: (index) => recorded.at(index),
    get length() {
      return recorded.length;
    },
  };
  let clock = Date.parse("2030-01-01T09:00:00.000Z");
  const store = new Map(
    [
      PROFILES,
      CHARACTERS,
      LOGS,
      COMMENTS,
      "neo_avocado_recipes",
      "neo_avocado_relations",
      "neo_avocado_wardrobe",
      "neo_avocado_boards",
      "neo_avocado_emoticons",
    ].map((name) => [
      name,
      (rows[name] ?? []).map((row) => ({
        revision: "r1.1",
        createdAt: new Date((clock += 1000)).toISOString(),
        createdBy: null,
        ...row,
        data: { ...(name === LOGS ? { board: "default" } : {}), ...row.data },
      })),
    ]),
  );
  const gatewayReads = [];
  const collection = (name) => ({
    async get(id) {
      calls.push({ method: "get", name, id });
      const found = store.get(name).find((row) => row.id === id);
      if (!found)
        throw Object.assign(new Error("Not found."), { code: "NOT_FOUND" });
      return found;
    },
    async list(options = {}) {
      calls.push({ method: "list", name, ...options });
      const [[{ metadata }, direction]] = options.sort ?? [
        [{ metadata: "id" }, "asc"],
      ];
      const sorted = store
        .get(name)
        .filter((row) =>
          Object.entries(options.filter ?? {}).every(
            ([field, value]) => row.data[field] === value,
          ),
        )
        .sort(
          (a, b) =>
            (a[metadata] < b[metadata] ? -1 : 1) *
            (direction === "desc" ? -1 : 1),
        );
      const start = options.after ? Number(options.after) : 0;
      const documents = sorted.slice(start, start + (options.size ?? 50));
      const end = start + documents.length;
      return {
        documents,
        nextCursor: end < sorted.length ? String(end) : null,
      };
    },
    async add(data) {
      calls.push({ method: "add", name, data });
      const row = {
        id: `${name}-${store.get(name).length}`,
        data,
        revision: "r1.1",
        createdAt: new Date((clock += 1000)).toISOString(),
        createdBy: ME,
      };
      store.get(name).push(row);
      return row;
    },
    async set(id, data, options) {
      calls.push({
        method: "set",
        name,
        id,
        data,
        ...(options ? { options } : {}),
      });
      const row = {
        id,
        data,
        revision: "r1.1",
        createdAt: new Date((clock += 1000)).toISOString(),
        createdBy: ME,
      };
      store.set(name, [...store.get(name).filter((r) => r.id !== id), row]);
      return row;
    },
    async delete(id) {
      calls.push({ method: "delete", name, id });
      store.set(
        name,
        store.get(name).filter((row) => row.id !== id),
      );
    },
  });
  const member = {
    id: ME,
    async membership() {
      return { id: ME, status: database.platformStatus ?? "approved" };
    },
    collection,
    media: {
      async upload(file) {
        calls.push({ method: "media.upload", name: file.name });
        return {
          id: "0190f1a2-0000-7000-8000-000000000001",
          url: `https://media.naru.pub/${file.name}`,
        };
      },
    },
    async signOut() {
      calls.push({ method: "signOut" });
    },
    // 서버 함수는 나루에서 돈다. 여기서는 무엇을 불렀는지만 남기고, 테스트가
    // 정한 결과를 돌려준다.
    async read(name, args = null) {
      if (name === "neo-avocado/communityData") gatewayReads.push(args);
      return this.call(name, args);
    },
    async call(name, args = null) {
      if (name === "neo-avocado/registerMedia") return { ok: true };
      if (name === "neo-avocado/mediaCleanup")
        return { ok: true, files: [], nextCursor: null };
      if (name === "neo-avocado/membership") {
        const profile = await member
          .collection(PROFILES)
          .get(ME)
          .catch((error) => {
            if (error.code === "NOT_FOUND") return null;
            throw error;
          });
        return { ok: true, status: "approved", role: "member", profile };
      }
      if (name === "neo-avocado/join")
        return {
          ok: true,
          status: "approved",
          profile: await member
            .collection(PROFILES)
            .set(ME, { nick: args.nick }),
        };
      if (name === "neo-avocado/communityData") {
        const handle = member.collection(args.collection);
        if (args.operation === "getMany")
          return {
            ok: true,
            documents: await Promise.all(
              args.options.ids.map((id) =>
                handle.get(id).catch((error) => {
                  if (error.code === "NOT_FOUND") return null;
                  throw error;
                }),
              ),
            ),
          };
        if (args.operation === "list")
          return { ok: true, ...(await handle.list(args.options)) };
        if (args.operation === "delete") {
          await handle.delete(args.id, args.options);
          return { ok: true, done: true };
        }
        return {
          ok: true,
          document: await handle[args.operation](
            ...(args.operation === "add"
              ? [args.data]
              : args.operation === "set"
                ? [args.id, args.data, args.options]
                : [args.id]),
          ),
        };
      }
      calls.push({ method: "call", name, args });
      return database.answer(name, args);
    },
  };
  const database = {
    calls,
    store,
    member,
    gatewayReads,
    signedIn: true,
    answer: (name) =>
      name === "neo-avocado/messageStatus"
        ? { ok: true, unread: false }
        : { ok: false, reason: "empty" },
  };
  return database;
}

async function page(database) {
  const dom = new JSDOM(await readFile(new URL("index.html", root), "utf8"), {
    url: "https://neo-avocado.naru.pub/",
    runScripts: "outside-only",
  });
  const { window } = dom;
  window.confirm = () => true;
  window.setInterval = () => 0;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const context = dom.getInternalVMContext();
  const config = new SyntheticModule(
    ["config"],
    function () {
      this.setExport("config", { site: "" });
    },
    { context },
  );
  const sdk = new SyntheticModule(
    ["createNaru"],
    function () {
      this.setExport("createNaru", () => ({
        collection: () => {
          throw new Error("visitor handles are not used");
        },
        members: {
          session: async () => (database.signedIn ? database.member : null),
          signIn: async () => database.calls.push({ method: "signIn" }),
        },
      }));
    },
    { context },
  );
  const app = new SourceTextModule(
    await readFile(new URL("app.js", root), "utf8"),
    {
      context,
      importModuleDynamically: async () => {
        await sdk.link(() => {
          throw new Error("no imports");
        });
        if (sdk.status !== "evaluated") await sdk.evaluate();
        return sdk;
      },
    },
  );
  const cleanup = new SourceTextModule(
    await readFile(new URL("media-cleanup.js", root), "utf8"),
    { context },
  );
  await cleanup.link(() => {
    throw new Error("unexpected cleanup dependency");
  });
  const emoticons = new SourceTextModule(
    await readFile(new URL("emoticons.js", root), "utf8"),
    { context },
  );
  await emoticons.link(() => {
    throw new Error("unexpected emoticon dependency");
  });
  const purifier = new SourceTextModule(
    await readFile(new URL("vendor/purify.es.mjs", root), "utf8"),
    { context },
  );
  await purifier.link(() => {
    throw new Error("unexpected purifier dependency");
  });
  const renderer = new SourceTextModule(
    await readFile(new URL("content-renderer.js", root), "utf8"),
    { context },
  );
  await renderer.link(() => purifier);
  await app.link(async (specifier) =>
    specifier === "./media-cleanup.js"
      ? cleanup
      : specifier === "./emoticons.js"
        ? emoticons
        : specifier === "./content-renderer.js"
          ? renderer
          : config,
  );
  await app.evaluate();
  const $ = (id) => window.document.getElementById(id);
  return {
    window,
    $,
    app,
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
    submit: (form) => form.onsubmit({ preventDefault() {} }),
  };
}

const me = { id: ME, data: { nick: "나" }, createdBy: ME };

test("editing keeps image and metadata and sends the revision, while a conflict retains the draft", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [LOGS]: [
      {
        id: "mine",
        createdBy: ME,
        data: { image: "original.png", text: "before", extra: "keep" },
      },
      { id: "other", createdBy: "other-member", data: { image: "other.png" } },
    ],
  });
  const { $, submit } = await page(database);
  assert.equal($("logs").querySelector(".log .edit").hidden, true);
  const own = [...$("logs").children].find(
    (row) => row.querySelector(".log-text").textContent === "before",
  );
  own.querySelector(".edit").onclick();
  assert.equal($("editor").open, true);
  $("editorFields").querySelector('[name="text"]').value = "after";
  await submit($("editorForm"));
  const write = database.calls.filter((call) => call.method === "set").at(-1);
  assert.deepEqual(write, {
    method: "set",
    name: LOGS,
    id: "mine",
    data: {
      board: "default",
      image: "original.png",
      text: "after",
      extra: "keep",
      title: "",
      category: "",
      secret: false,
    },
    options: { condition: { revision: "r1.1" } },
  });
  assert.equal($("editor").open, false);
  const edited = [...$("logs").children].find(
    (row) => row.querySelector(".log-text").textContent === "after",
  );
  edited.querySelector(".edit").onclick();
  const originalCollection = database.member.collection;
  database.member.collection = (name) => ({
    ...originalCollection(name),
    set: async () => {
      throw Object.assign(new Error("conflict"), { code: "CONFLICT" });
    },
  });
  $("editorFields").querySelector('[name="text"]').value = "retained draft";
  await submit($("editorForm"));
  assert.equal($("editor").open, true);
  assert.equal(
    $("editorFields").querySelector('[name="text"]').value,
    "retained draft",
  );
  assert.match($("editorStatus").textContent, /다른 곳에서 수정/);
});

test("profile and character edits use their original revisions and preserve extra fields", async () => {
  const database = fakeDatabase({
    [PROFILES]: [{ ...me, data: { nick: "나", mainCharacter: "character" } }],
    [CHARACTERS]: [
      {
        id: "character",
        createdBy: ME,
        data: {
          name: "캐릭터",
          side: "동쪽",
          profile: "소개",
          image: "portrait.png",
          custom: { color: "green" },
        },
      },
    ],
  });
  const { $, settle, submit } = await page(database);
  $("editProfile").onclick();
  $("editorFields").querySelector('[name="nick"]').value = "새 이름";
  await submit($("editorForm"));
  assert.equal($("whoami").textContent, "새 이름 님");
  assert.equal(database.store.get(PROFILES)[0].data.mainCharacter, "character");
  $("tabCharacters").onclick();
  await settle();
  await settle();
  $("characters").querySelector(".edit").onclick();
  $("editorFields").querySelector('[name="name"]').value = "새 캐릭터";
  await submit($("editorForm"));
  assert.equal(
    $("characters").querySelector(".character-name").textContent,
    "새 캐릭터",
  );
  const saved = database.store.get(CHARACTERS)[0];
  assert.equal(saved.data.image, "portrait.png");
  assert.deepEqual(saved.data.custom, { color: "green" });
  assert.deepEqual(
    database.calls.filter((call) => call.method === "set").at(-1).options,
    { condition: { revision: "r1.1" } },
  );
});

test("the shop exposes later pages and crafts selected inventory through the server", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  database.store.set(WALLETS, [{ id: ME, data: { balance: 100 } }]);
  database.store.set(
    ITEMS,
    Array.from({ length: 51 }, (_, n) => ({
      id: `item-${n}`,
      createdAt: String(n).padStart(3, "0"),
      data: { name: `아이템 ${n}`, price: 1 },
    })),
  );
  database.store.set(INVENTORY, [
    {
      id: "seed-1",
      createdAt: "1",
      data: { name: "씨앗", owner: ME, item: "seed" },
    },
  ]);
  database.store.set("neo_avocado_recipes", [
    {
      id: "tree",
      data: {
        name: "나무 제작",
        item: "tree",
        ingredients: [{ item: "seed", count: 1 }],
        cost: 5,
      },
    },
  ]);
  const { $, settle, submit } = await page(database);
  $("tabShop").onclick();
  for (let n = 0; n < 5; n++) await settle();
  assert.equal($("items").children.length, 50);
  assert.equal($("moreItems").hidden, false);
  $("moreItems").onclick();
  await settle();
  assert.equal($("items").children.length, 51);
  assert.equal($("moreItems").hidden, true);
  $("inventory").querySelector(".material").checked = true;
  submit($("craftForm"));
  await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.method === "call").at(-1),
    {
      method: "call",
      name: "neo-avocado/craft",
      args: { recipe: "tree", materials: ["seed-1"] },
    },
  );
});

test("signed out, the page asks nothing of the database and offers member sign-in", async () => {
  const database = fakeDatabase();
  database.signedIn = false;
  const { $, settle } = await page(database);
  assert.equal($("welcome").hidden, false);
  assert.equal($("community").hidden, true);
  assert.equal(database.calls.length, 0);
  $("signIn").onclick();
  await settle();
  assert.deepEqual(database.calls.at(0), { method: "signIn" });
});

test("a first visit sets a nickname under the member's own id, then reads the logs", async () => {
  const database = fakeDatabase();
  const { $, settle, submit } = await page(database);
  assert.equal($("profileSetup").hidden, false);
  assert.equal(database.calls.length, 1);
  assert.deepEqual(database.calls.at(0), {
    method: "get",
    name: PROFILES,
    id: ME,
  });
  $("nick").value = " 아보 ";
  submit($("profileForm"));
  await settle();
  assert.deepEqual(database.calls.at(1), {
    method: "set",
    name: PROFILES,
    id: ME,
    data: { nick: "아보" },
  });
  assert.equal($("community").hidden, false);
  assert.equal($("whoami").textContent, "아보 님");
  assert.equal(
    database.calls.some((call) => call.method === "list" && call.name === LOGS),
    true,
  );
});

test("logs are read a page at a time, newest first, and comments only when opened", async () => {
  const logs = Array.from({ length: 12 }, (_, n) => ({
    id: `log-${n}`,
    data: { image: `https://media.naru.pub/${n}.png`, text: `로그 ${n}` },
    createdBy: n === 11 ? ME : "member-other",
  }));
  const database = fakeDatabase({
    [PROFILES]: [me, { id: "member-other", data: { nick: "남" } }],
    [LOGS]: logs,
    [COMMENTS]: [
      { id: "c-1", data: { logId: "log-11", text: "멋져요", dice: false } },
    ],
  });
  const { $, settle } = await page(database);
  const listed = database.calls.filter((call) => call.method === "list");
  assert.deepEqual(listed, [
    { method: "list", name: "neo_avocado_boards", size: 100, after: null },
    {
      method: "list",
      name: LOGS,
      filter: { board: "default" },
      sort: [[{ metadata: "createdAt" }, "desc"]],
      size: 10,
      after: null,
    },
  ]);
  const items = $("logs").querySelectorAll(".log");
  assert.equal(items.length, 10);
  assert.equal(
    database.gatewayReads.some((args) =>
      [LOGS, COMMENTS].includes(args.collection),
    ),
    false,
  );
  assert.equal(items[0].querySelector(".log-text").textContent, "로그 11");
  // 자기 로그에만 삭제가 보인다.
  assert.equal(items[0].querySelector(".delete").hidden, false);
  assert.equal(items[1].querySelector(".delete").hidden, true);
  // 같은 회원의 닉네임은 한 번만 묻는다.
  const profileGets = database.calls.filter(
    (call) => call.method === "get" && call.name === PROFILES,
  );
  assert.deepEqual(
    profileGets.map((call) => call.id),
    [ME, "member-other"],
  );
  assert.equal(
    database.calls.some((call) => call.name === COMMENTS),
    false,
  );
  const comments = items[0].querySelector(".comments");
  comments.open = true;
  comments.ontoggle();
  await settle();
  await settle();
  assert.deepEqual(
    database.calls
      .filter((call) => call.method === "list" && call.name === COMMENTS)
      .at(-1),
    {
      method: "list",
      name: COMMENTS,
      filter: { logId: "log-11" },
      sort: [[{ metadata: "createdAt" }, "asc"]],
      size: 50,
      after: null,
    },
  );
  assert.match(items[0].querySelector(".comment-list").textContent, /멋져요/);
  $("moreLogs").onclick();
  await settle();
  await settle();
  assert.equal($("logs").querySelectorAll(".log").length, 12);
  assert.equal($("moreLogs").hidden, true);
});

test("a dice comment's roll comes from the id the server gave it", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [LOGS]: [{ id: "log-0", data: { image: "x.png", text: "" } }],
  });
  const { $, app, settle, submit } = await page(database);
  const form = $("logs").querySelector(".comment-form");
  form.querySelector(".comment-dice").checked = true;
  submit(form);
  await settle();
  await settle();
  const added = database.calls.find((call) => call.method === "add");
  assert.deepEqual(added.data, { logId: "log-0", text: "", dice: true });
  const [first, second] = app.namespace.diceOf(`${COMMENTS}-0`);
  assert.equal(
    $("logs").querySelector(".dice").textContent,
    `🎲 ${first} + ${second} = ${first + second}`,
  );
  // 같은 ID는 언제나 같은 눈, 눈은 1에서 6.
  assert.deepEqual(app.namespace.diceOf("abc"), app.namespace.diceOf("abc"));
  for (let n = 0; n < 200; n += 1)
    for (const face of app.namespace.diceOf(`id-${n}`))
      assert.ok(face >= 1 && face <= 6);
});

test("a log uploads its picture, then saves the stored URL", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  const { $, window, settle, submit } = await page(database);
  const file = new window.File(["png"], "log.png", { type: "image/png" });
  Object.defineProperty($("logImage"), "files", { value: [file] });
  $("logText").value = "첫 로그";
  submit($("logForm"));
  await settle();
  await settle();
  const writes = database.calls.filter((call) =>
    ["media.upload", "add"].includes(call.method),
  );
  assert.deepEqual(writes, [
    { method: "media.upload", name: "log.png" },
    {
      method: "add",
      name: LOGS,
      data: {
        image: "https://media.naru.pub/log.png",
        imageId: "0190f1a2-0000-7000-8000-000000000001",
        text: "첫 로그",
        board: "default",
        title: "",
        category: "",
        secret: false,
      },
    },
  ]);
  assert.equal($("logs").querySelector(".log-text").textContent, "첫 로그");
});

test("characters are read when their tab is first opened, and registered by members", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [CHARACTERS]: [
      {
        id: "char-0",
        data: {
          name: "아보",
          side: "초록단",
          profile: "씨가 큽니다.",
          image: null,
        },
        createdBy: ME,
      },
    ],
  });
  const { $, settle, submit } = await page(database);
  assert.equal(
    database.calls.some((call) => call.name === CHARACTERS),
    false,
  );
  $("tabCharacters").onclick();
  await settle();
  await settle();
  assert.equal($("charactersView").hidden, false);
  assert.deepEqual(
    database.calls.filter((call) => call.name === CHARACTERS),
    [
      {
        method: "list",
        name: CHARACTERS,
        sort: [[{ metadata: "createdAt" }, "desc"]],
        size: 20,
        after: null,
      },
    ],
  );
  assert.equal(
    $("characters").querySelector(".author").textContent,
    "오너: 나",
  );
  $("characterName").value = "카도";
  $("characterSide").value = "갈색단";
  submit($("characterForm"));
  await settle();
  await settle();
  assert.deepEqual(database.calls.at(-1), {
    method: "add",
    name: CHARACTERS,
    data: { name: "카도", side: "갈색단", profile: "", image: null },
  });
  assert.equal(
    $("characters").querySelector(".character-name").textContent,
    "카도",
  );
  // 두 번째로 열 때는 다시 읽지 않는다.
  $("tabLogs").onclick();
  $("tabCharacters").onclick();
  await settle();
  assert.equal(
    database.calls.filter((call) => call.name === CHARACTERS).length,
    2,
  );
});

test("an ended sign-in returns the page to the welcome screen", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  const { $, settle } = await page(database);
  database.member.collection = () => ({
    list: async () => {
      throw Object.assign(new Error("expired"), { code: "AUTH_REQUIRED" });
    },
  });
  $("moreLogs").hidden = false;
  $("messageDetail").textContent = "private message";
  $("messageBody").value = "private draft";
  $("moreLogs").onclick();
  await settle();
  assert.equal($("welcome").hidden, false);
  assert.equal($("messageDetail").textContent, "");
  assert.equal($("messageBody").value, "");
  assert.match($("status").textContent, /다시 회원 로그인/);
});

const WALLETS = "neo_avocado_wallets";
const ITEMS = "neo_avocado_items";
const INVENTORY = "neo_avocado_inventory";

test("the shop reads the wallet, items and own inventory when opened, and spends through server functions", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  database.store.set(WALLETS, [
    { id: ME, data: { balance: 120 }, createdBy: null },
  ]);
  database.store.set(ITEMS, [
    {
      id: "potion",
      data: { name: "물약", price: 10, stock: 3 },
      createdAt: "1",
    },
    {
      id: "secret",
      data: { name: "비밀", price: 1, hidden: true },
      createdAt: "2",
    },
  ]);
  database.store.set(INVENTORY, [
    {
      id: "i-1",
      data: { owner: ME, item: "potion", name: "물약" },
      createdAt: "3",
    },
    {
      id: "i-2",
      data: { owner: "member-other", item: "potion", name: "남의 물약" },
      createdAt: "4",
    },
  ]);
  const { $, settle } = await page(database);
  assert.equal(
    database.calls.some((call) =>
      [WALLETS, ITEMS, INVENTORY].includes(call.name),
    ),
    false,
  );
  $("tabShop").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.equal($("shopView").hidden, false);
  assert.equal($("balance").textContent, "120");
  assert.deepEqual(
    [...$("items").children].map(
      (row) => row.querySelector("span").textContent,
    ),
    ["물약 · 10 아보 · 남은 3개"],
  );
  assert.deepEqual(
    [...$("inventory").children].map(
      (row) => row.querySelector("label").textContent,
    ),
    ["물약"],
  );
  assert.deepEqual(
    database.calls.filter((call) => call.name === INVENTORY).at(0).filter,
    { owner: ME },
  );
  // The page never writes money or items itself: it calls the function, and
  // shows what the function decided.
  database.answer = (name) =>
    name === "neo-avocado/gacha"
      ? { ok: true, balance: 70, owned: { data: { name: "황금 아보카도" } } }
      : { ok: false, reason: "already" };
  $("gacha").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(
    database.calls
      .filter(
        (call) => call.method === "call" && call.name === "neo-avocado/gacha",
      )
      .at(0),
    { method: "call", name: "neo-avocado/gacha", args: null },
  );
  assert.match($("status").textContent, /황금 아보카도/);
  $("daily").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.equal($("status").textContent, "오늘은 이미 받았습니다.");
  $("items").querySelector("button").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.method === "call").at(-1),
    { method: "call", name: "neo-avocado/buy", args: { item: "potion" } },
  );
  assert.equal(
    database.calls.some(
      (call) =>
        ["set", "add", "delete"].includes(call.method) &&
        [WALLETS, ITEMS, INVENTORY].includes(call.name),
    ),
    false,
  );
});

test("pending and banned members see platform status before any protected app reads", async () => {
  for (const status of ["pending", "banned"]) {
    const database = fakeDatabase({ [PROFILES]: [me] });
    database.platformStatus = status;
    const { $, settle } = await page(database);
    await settle();
    assert.equal($("admissionPanel").hidden, false);
    assert.equal($("community").hidden, true);
    assert.equal($("profileSetup").hidden, true);
    assert.equal($("editProfile").hidden, true);
    assert.equal($("signOut").hidden, false);
    assert.equal(database.calls.length, 0);
    database.platformStatus = "approved";
    await $("checkAdmission").onclick();
    await settle();
    assert.equal($("admissionPanel").hidden, true);
    assert.equal($("community").hidden, false);
  }
});

test("a live platform ban clears private content after ACCESS_DENIED; board denials remain ordinary errors", async () => {
  for (const status of ["banned", "approved"]) {
    const database = fakeDatabase({ [PROFILES]: [me] });
    const { $, settle } = await page(database);
    database.platformStatus = status;
    database.member.read = async () => {
      throw Object.assign(new Error("denied"), { code: "ACCESS_DENIED" });
    };
    database.member.collection = () => ({
      list: async () => {
        throw Object.assign(new Error("denied"), { code: "ACCESS_DENIED" });
      },
    });
    await $("moreLogs").onclick();
    await settle();
    assert.equal($("admissionPanel").hidden, status === "approved");
    if (status === "banned") assert.equal($("logs").children.length, 0);
  }
});

test("post details and comment lists use native reads while deletion stays transactional", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [LOGS]: [
      {
        id: "long",
        createdBy: ME,
        data: { text: "x".repeat(200), image: "https://media.naru.pub/a.png" },
      },
    ],
  });
  const { $, settle } = await page(database);
  const item = $("logs").querySelector(".log");
  assert.equal(item.querySelector(".log-text").textContent.length, 150);
  const expand = [...item.querySelectorAll("button")].find(
    (button) => button.textContent === "본문 보기",
  );
  await expand.onclick();
  await settle();
  const full = $("logs").querySelector(".log");
  assert.equal(full.querySelector(".log-text").textContent.length, 200);
  full.querySelector(".comments").open = true;
  full.querySelector(".comments").ontoggle();
  await settle();
  assert.equal(
    database.gatewayReads.some((args) =>
      [LOGS, COMMENTS].includes(args.collection),
    ),
    false,
  );
  let deletion;
  const originalCall = database.member.call;
  database.member.call = async (name, args) => {
    if (name === "neo-avocado/communityData" && args.operation === "delete")
      deletion = args;
    return originalCall.call(database.member, name, args);
  };
  await full.querySelector(".delete").onclick();
  await settle();
  assert.equal(deletion.collection, LOGS);
  assert.equal(deletion.operation, "delete");
});
