// 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { JSDOM } from "jsdom";
import { matches } from "./where.mjs";
const root = new URL("../", import.meta.url);

/** How a fake Naru answers a call its test did not expect: ctx.fail. */
function refuse(reason, message = reason) {
  throw Object.assign(new Error(message), {
    code: "CONFLICT",
    details: { reason },
  });
}

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
      "neo_avocado_character_fields",
      "neo_avocado_inventory",
      "neo_avocado_items",
      "neo_avocado_settings",
      "neo_avocado_couples",
      "neo_avocado_sides",
      "neo_avocado_classes",
      "neo_avocado_board_groups",
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
  const collection = (name) => ({
    async getMany(ids) {
      calls.push({ method: "getMany", name, ids });
      return ids.map(
        (id) => store.get(name).find((row) => row.id === id) ?? null,
      );
    },
    async get(id) {
      calls.push({ method: "get", name, id });
      const found = store.get(name).find((row) => row.id === id);
      if (!found)
        throw Object.assign(new Error("Not found."), { code: "NOT_FOUND" });
      return found;
    },
    async list(options = {}) {
      calls.push({ method: "list", name, ...options });
      if (database.unprepared)
        throw Object.assign(new Error(`Collection ${name} does not exist.`), {
          code: "NOT_FOUND",
        });
      const keys = options.sort ?? [[{ metadata: "id" }, "asc"]];
      // Missing values sort lowest, then strings, numbers and booleans.
      const rank = (value) =>
        value === undefined || value === null
          ? [0, 0]
          : [{ string: 1, number: 2, boolean: 3 }[typeof value] ?? 0, value];
      const compare = (a, b) => {
        for (const [key, direction] of keys) {
          const [x, y] = [a, b].map((row) =>
            rank(typeof key === "string" ? row.data[key] : row[key.metadata]),
          );
          const order = x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
          if (order) return direction === "desc" ? -order : order;
        }
        return 0;
      };
      const sorted = store
        .get(name)
        .filter(
          (row) =>
            Object.entries(options.filter ?? {}).every(
              ([field, value]) => row.data[field] === value,
            ) && matches(row, options.where),
        )
        .sort(compare);
      const start = options.after ? Number(options.after) : 0;
      const documents = sorted.slice(start, start + (options.size ?? 50));
      const end = start + documents.length;
      return {
        documents,
        nextCursor: end < sorted.length ? String(end) : null,
        ...(options.includeTotal ? { totalCount: sorted.length } : {}),
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
    collection,
    media: {
      async upload(file, options) {
        calls.push({
          method: "media.upload",
          name: file.name,
          ...(options ? { options } : {}),
        });
        return {
          id: "0190f1a2-0000-7000-8000-000000000001",
          url: `https://media.naru.pub/${file.name}`,
        };
      },
    },
    async signOut() {
      calls.push({ method: "signOut" });
    },
    // One live connection at a time; tests deliver messages and statuses.
    live(options) {
      calls.push({ method: "live", topics: options.topics });
      const connection = {
        options,
        closed: false,
        close() {
          connection.closed = true;
        },
      };
      database.live = connection;
      return connection;
    },
    // 서버 함수는 나루에서 돈다. 여기서는 무엇을 불렀는지만 남기고, 테스트가
    // 정한 결과를 돌려준다.
    async call(name, args = null) {
      // What Naru answers a member the site has not approved.
      if ((database.platformStatus ?? "approved") !== "approved")
        throw Object.assign(new Error("Membership is not approved."), {
          code: "ACCESS_DENIED",
          details: { membership: database.platformStatus },
        });
      // The site frame is read on every load; tests that care set database.site.
      if (name === "content/site:site") {
        if (database.unprepared)
          throw Object.assign(
            new Error("Collection neo_avocado_design does not exist."),
            { code: "NOT_FOUND" },
          );
        return {
          level: 2,
          member: true,
          design: { title: "", font: "sans", colors: {} },
          menus: [],
          banners: [],
          ...database.site,
        };
      }
      if (name === "community/boards:commentCounts") {
        const counts = {};
        for (const id of args.ids)
          counts[id] = store
            .get(COMMENTS)
            .filter((row) => row.data.logId === id).length;
        return { counts };
      }
      if (name === "community/membership:membership") {
        const profile = await member
          .collection(PROFILES)
          .get(ME)
          .catch((error) => {
            if (error.code === "NOT_FOUND") return null;
            throw error;
          });
        return { status: "approved", role: "member", profile };
      }
      if (name === "community/membership:join")
        return {
          status: "approved",
          profile: await member
            .collection(PROFILES)
            .set(ME, { nick: args.nick }),
        };
      // Writes: posts, comments and characters through their functions,
      // kept in the same store native reads come from.
      const writes = {
        "community/posts": LOGS,
        "community/comments": COMMENTS,
        "characters/sheet": CHARACTERS,
      };
      const [path, operation] = name.split(":");
      if (writes[path]) {
        const handle = member.collection(writes[path]);
        if (operation === "remove") {
          await handle.delete(args.id, args.guest ? { guest: args.guest } : {});
          return { done: true };
        }
        const options = {
          ...(args.revision ? { condition: { revision: args.revision } } : {}),
          ...(args.guest ? { guest: args.guest } : {}),
        };
        return {
          document: args.id
            ? await handle.set(
                args.id,
                args.data,
                Object.keys(options).length ? options : undefined,
              )
            : await handle.add(args.data),
        };
      }
      calls.push({ method: "call", name, args });
      return database.answer(name, args);
    },
  };
  // A visitor's client: function calls only, recorded apart from members'.
  const visitor = {
    calls: [],
    async call(name, args = null) {
      if (name !== "content/site:site")
        visitor.calls.push(JSON.parse(JSON.stringify({ name, args })));
      return member.call(name, args);
    },
    live(options) {
      visitor.calls.push({ name: "live", args: { topics: options.topics } });
      const connection = { options, close() {} };
      database.live = connection;
      return connection;
    },
  };
  const database = {
    calls,
    store,
    member,
    visitor,
    signedIn: true,
    answer: (name) =>
      name === "community/messages:messageStatus"
        ? { unread: false }
        : refuse("empty"),
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
  window.setInterval = () => {
    throw new Error("The page must not poll; it listens instead.");
  };
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
        // Visitors read what the declaration makes world-readable; posts
        // only where the test opens them (the board rule decides on Naru).
        collection: (name) => {
          if (
            database.visitorWorld ||
            [
              "neo_avocado_boards",
              "neo_avocado_profiles",
              "neo_avocado_emoticons",
            ].includes(name)
          )
            return database.member.collection(name);
          const denied = async () => {
            throw Object.assign(new Error("Members only"), {
              code: "ACCESS_DENIED",
            });
          };
          return { get: denied, list: denied };
        },
        call: database.visitor.call,
        live: database.visitor.live,
        members: {
          session: async () => (database.signedIn ? database.member : null),
          signIn: async () => database.calls.push({ method: "signIn" }),
        },
      }));
    },
    { context },
  );
  // The page's modules, linked as the browser links them: each import
  // resolved against the module importing it, config.js replaced and the SDK
  // served by the fake.
  // One instance per file, even when two importers ask at once: the map
  // holds the pending load.
  const modules = new Map();
  const load = (url) => {
    if (url.pathname.endsWith("/config.js")) return config;
    if (!modules.has(url.href))
      modules.set(
        url.href,
        readFile(url, "utf8").then(
          (source) =>
            new SourceTextModule(source, {
              context,
              identifier: url.href,
              importModuleDynamically: async () => {
                await sdk.link(() => {
                  throw new Error("no imports");
                });
                if (sdk.status !== "evaluated") await sdk.evaluate();
                return sdk;
              },
            }),
        ),
      );
    return modules.get(url.href);
  };
  const app = await load(new URL("app.js", root));
  await app.link((specifier, referencing) =>
    load(new URL(specifier, referencing.identifier)),
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
  // An edit reads the full sheet first: lists carry no custom values.
  $("characters").querySelector(".edit").onclick();
  await settle();
  await settle();
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
  // Ten to a page, as the original's shop: 51 items make six pages.
  assert.equal($("items").children.length, 10);
  const pages = [...$("itemPages").querySelectorAll("button.page")].map(
    (button) => button.textContent,
  );
  assert.deepEqual(pages, ["‹", "1", "2", "3", "4", "5", "›"]);
  $("itemPages").querySelector("button:last-child").onclick();
  await settle();
  assert.equal(
    $("itemPages").querySelector('[aria-current="page"]').textContent,
    "2",
  );
  for (let n = 0; n < 4; n += 1)
    $("itemPages").querySelector("button:last-child").onclick();
  await settle();
  assert.equal($("items").children.length, 1);
  $("inventory").querySelector(".material").checked = true;
  submit($("craftForm"));
  await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.method === "call").at(-1),
    {
      method: "call",
      name: "economy/inventory:craft",
      args: { recipe: "tree", materials: ["seed-1"] },
    },
  );
});

test("signed out, a visitor reads only the boards the board rule lists, and may sign in", async () => {
  const database = fakeDatabase();
  database.signedIn = false;
  const { $, settle, window } = await page(database);
  assert.equal($("welcome").hidden, false);
  assert.equal($("community").hidden, false);
  assert.ok(window.document.body.classList.contains("visitor"));
  // No board is open to guests: nothing but the board list is read, natively.
  assert.equal($("noPublicBoards").hidden, false);
  assert.equal($("logForm").hidden, true);
  // Their one call reports the visit (현재접속자, 접속자집계).
  assert.deepEqual(
    database.visitor.calls.map((call) => call.name),
    ["community/presence:seen"],
  );
  assert.deepEqual(
    database.calls
      .filter((call) => call.method !== "call")
      .map((call) => [call.method, call.name]),
    [["list", "neo_avocado_boards"]],
  );
  $("signIn").onclick();
  await settle();
  assert.deepEqual(database.calls.at(-1), { method: "signIn" });
});

test("a guest posts with a name and password, and must give the password to edit or delete", async () => {
  const database = fakeDatabase({
    neo_avocado_boards: [
      {
        id: "free",
        data: {
          name: "자유",
          kind: "text",
          enabled: true,
          secret: "optional",
          listLevel: 1,
          readLevel: 1,
          writeLevel: 1,
          commentLevel: 1,
          categories: [],
        },
      },
    ],
    [LOGS]: [
      {
        id: "guest-post",
        data: {
          board: "free",
          owner: null,
          guest: { name: "길손" },
          text: "안녕하세요",
          title: "",
          category: "",
          secret: false,
        },
      },
    ],
  });
  database.signedIn = false;
  database.visitorWorld = true;
  const { $, submit, settle } = await page(database);
  const post = $("logs").querySelector(".log");
  // World-readable posts are read natively, through the board rule.
  assert.ok(
    database.calls.some((call) => call.method === "list" && call.name === LOGS),
  );
  assert.equal(post.querySelector(".author").textContent, "길손 (손님)");
  assert.equal(post.querySelector(".edit").hidden, false);
  assert.equal($("logForm").hidden, false);
  assert.equal($("guestIdentity").hidden, false);
  // Without a name and password nothing is sent.
  $("logText").value = "두 번째";
  await submit($("logForm"));
  await settle();
  assert.match($("status").textContent, /비밀번호/);
  $("guestName").value = "길손";
  $("guestPassword").value = "secret1";
  await submit($("logForm"));
  await settle();
  const posted = database.visitor.calls.find(
    (call) => call.name === "community/posts:write" && !call.args.id,
  );
  assert.deepEqual(posted.args.guest, { name: "길손", password: "secret1" });
  assert.equal(posted.args.data.secret, false);
  assert.equal(posted.args.data.character, undefined);
  // Editing asks for the password and sends it with the revision.
  post.querySelector(".edit").onclick();
  $("editorFields").querySelector('[name="password"]').value = "secret1";
  $("editorFields").querySelector('[name="text"]').value = "고침";
  await submit($("editorForm"));
  const edited = database.visitor.calls.find(
    (call) => call.name === "community/posts:write" && call.args.id,
  );
  assert.equal(edited.args.revision, "r1.1");
  assert.deepEqual(edited.args.guest, { password: "secret1" });
  // A member's own collection handles are never touched by a visitor.
  assert.ok(!database.calls.some((call) => call.method === "media.upload"));
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
    // The board groups, for the board picker.
    {
      method: "list",
      name: "neo_avocado_board_groups",
      size: 100,
      after: null,
    },
    {
      method: "list",
      name: LOGS,
      filter: { board: "default" },
      sort: [
        ["notice", "desc"],
        [{ metadata: "createdAt" }, "desc"],
      ],
      size: 10,
      after: null,
      includeTotal: true,
    },
  ]);
  const items = $("logs").querySelectorAll(".log");
  assert.equal(items.length, 10);
  assert.equal(items[0].querySelector(".log-text").textContent, "로그 11");
  // 자기 로그에만 삭제가 보인다.
  assert.equal(items[0].querySelector(".delete").hidden, false);
  assert.equal(items[1].querySelector(".delete").hidden, true);
  // 같은 회원의 닉네임은 한 번만 묻는다.
  const askedFor = database.calls
    .filter((call) => call.name === PROFILES)
    .flatMap((call) =>
      call.method === "getMany"
        ? call.ids
        : call.method === "get"
          ? [call.id]
          : [],
    );
  assert.deepEqual(askedFor, [ME, "member-other"]);
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
  // Numbered pages: 12 posts make two pages of ten.
  const pageTwo = [...$("logPages").querySelectorAll("button")].find(
    (button) => button.textContent === "2",
  );
  pageTwo.onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.equal($("logs").querySelectorAll(".log").length, 2);
  assert.equal(
    $("logPages").querySelector('[aria-current="page"]').textContent,
    "2",
  );
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
    { method: "media.upload", name: "log.png", options: { managed: true } },
    {
      method: "add",
      name: LOGS,
      data: {
        image: "https://media.naru.pub/log.png",
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
        includeTotal: true,
      },
    ],
  );
  assert.equal(
    $("characters").querySelector(".author").textContent,
    "오너: 나",
  );
  $("characterName").value = "카도";
  $("characterSide").value = "갈색단";
  $("characterClass").value = "인간";
  submit($("characterForm"));
  await settle();
  await settle();
  assert.deepEqual(database.calls.at(-1), {
    method: "add",
    name: CHARACTERS,
    data: {
      name: "카도",
      side: "갈색단",
      class: "인간",
      profile: "",
      image: null,
      type: "main",
      state: "editing",
    },
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
  $("messageDetail").textContent = "private message";
  $("messageBody").value = "private draft";
  $("board").onchange();
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
    name === "economy/shop:gacha"
      ? { balance: 70, owned: { data: { name: "황금 아보카도" } } }
      : refuse("already", "오늘은 이미 받았습니다.");
  $("gacha").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(
    database.calls
      .filter(
        (call) => call.method === "call" && call.name === "economy/shop:gacha",
      )
      .at(0),
    { method: "call", name: "economy/shop:gacha", args: null },
  );
  assert.match($("status").textContent, /황금 아보카도/);
  $("daily").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.equal($("status").textContent, "오늘은 이미 받았습니다.");
  $("items").querySelector("button").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.method === "call").at(-1),
    {
      method: "call",
      name: "economy/shop:buy",
      args: { item: "potion" },
    },
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
    const call = database.member.call;
    // Every read a banned member makes is refused, saying why; an approved
    // member's refusal is the board's own, without it.
    const denied = () =>
      Object.assign(new Error("denied"), {
        code: "ACCESS_DENIED",
        ...(status === "banned" ? { details: { membership: "banned" } } : {}),
      });
    database.member.call = async (name, args) => {
      if (name.endsWith(":communityRead") || name.endsWith(":membership"))
        throw denied();
      return call.call(database.member, name, args);
    };
    database.member.collection = () => ({
      list: async () => {
        throw denied();
      },
    });
    await $("board").onchange();
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
  let deletion;
  const originalCall = database.member.call;
  database.member.call = async (name, args) => {
    if (name === "community/posts:remove") deletion = args;
    return originalCall.call(database.member, name, args);
  };
  await full.querySelector(".delete").onclick();
  await settle();
  // Deleting goes through community/posts:remove, which takes comments too.
  assert.equal(deletion.id, "long");
});

test("unread notices and new posts arrive over the live connection instead of a poll", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  const unread = { value: false };
  database.answer = (name) =>
    name === "community/messages:messageStatus"
      ? { unread: unread.value }
      : refuse("empty");
  const { $, settle } = await page(database);
  await settle();
  const live = database.live;
  assert.deepEqual([...live.options.topics], [LOGS]);
  const statusReads = () =>
    database.calls.filter(
      (call) => call.name === "community/messages:messageStatus",
    ).length;
  assert.equal(statusReads(), 0);
  // Nothing is replayed, so every (re)open reads the status once.
  unread.value = true;
  live.options.onStatus("open");
  await settle();
  assert.equal(statusReads(), 1);
  assert.equal($("tabMessages").textContent, "쪽지 · 새 쪽지");
  live.options.onMessage({ type: "notice", data: { unread: false } });
  assert.equal($("tabMessages").textContent, "쪽지");
  live.options.onMessage({ type: "notice", data: { unread: true } });
  assert.equal($("tabMessages").textContent, "쪽지 · 새 쪽지");
  assert.equal(statusReads(), 1);
  // Another board's post is ignored; this board's marks the tab until reloaded.
  live.options.onMessage({
    type: "topic",
    topic: LOGS,
    data: { board: "other", id: "x" },
  });
  assert.equal($("tabLogs").textContent, "로그");
  live.options.onMessage({
    type: "topic",
    topic: LOGS,
    data: { board: "default", id: "new" },
  });
  assert.equal($("tabLogs").textContent, "로그 · 새 글");
  const logReads = () =>
    database.calls.filter(
      (call) => call.method === "list" && call.name === LOGS,
    ).length;
  const before = logReads();
  $("tabLogs").onclick();
  await settle();
  assert.equal(logReads(), before + 1);
  assert.equal($("tabLogs").textContent, "로그");
  $("signOut").onclick();
  await settle();
  assert.equal(live.closed, true);
});

test("a function's ctx.fail reason and a duplicate nickname are shown as the page's own text", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  const failure = (code, message, details) =>
    Object.assign(new Error(message), { code, details });
  database.answer = (name) => {
    if (name === "economy/shop:daily")
      throw failure("CONFLICT", "아보가 모자랍니다.", { reason: "not_enough" });
    if (name === "community/messages:messageStatus") return { unread: false };
    refuse("empty");
  };
  const { $, settle, submit } = await page(database);
  await settle();
  $("daily").onclick();
  await settle();
  assert.equal($("status").textContent, "아보가 모자랍니다.");
  // A member's profile is written directly; Naru refuses a taken nickname.
  const collection = database.member.collection;
  database.member.collection = (name) =>
    name === PROFILES
      ? {
          ...collection(name),
          set: async () => {
            throw failure("CONFLICT", "server text", { unique: "nick" });
          },
        }
      : collection(name);
  $("editProfile").onclick();
  $("editorFields").querySelector('[name="nick"]').value = "taken";
  await submit($("editorForm"));
  assert.equal($("editorStatus").textContent, "이미 쓰는 닉네임입니다.");
});

test("posts speak as a chosen character, show server dice, calls and actions", async () => {
  const hero = {
    id: "hero",
    createdBy: ME,
    data: { name: "히어로", image: "https://media.naru.pub/hero.png" },
  };
  const database = fakeDatabase({
    [PROFILES]: [me, { id: "member-other", data: { nick: "남" } }],
    [CHARACTERS]: [hero, { id: "theirs", data: { name: "남의 것" } }],
    [LOGS]: [
      {
        id: "log-0",
        createdBy: "member-other",
        data: {
          image: "https://media.naru.pub/0.png",
          text: "[[나]] 와 주세요",
          dice: true,
          rolls: [6, 5],
          speaker: {
            character: "theirs",
            name: "남의 것",
            title: "용사",
            titleImage: "javascript:alert(1)",
            portrait: "https://media.naru.pub/outfit.png",
          },
        },
      },
    ],
    [COMMENTS]: [
      {
        id: "c-1",
        createdBy: ME,
        data: {
          logId: "log-0",
          text: "탐색!",
          dice: true,
          rolls: [2, 3],
          speaker: { character: "hero", name: "히어로" },
          actions: [
            { type: "explore", item: "herb", name: "약초", remaining: 0 },
            {
              type: "use",
              item: "box",
              name: "상자",
              effect: "draw",
              prize: { item: "gem", name: "보석" },
            },
          ],
        },
      },
    ],
    neo_avocado_inventory: [
      { id: "inv-1", data: { owner: ME, item: "letter", name: "편지" } },
    ],
  });
  const { $, settle, submit } = await page(database);
  const log = $("logs").querySelector(".log");
  assert.equal(log.querySelector(".speaker-name").textContent, "남의 것");
  assert.match(
    log.querySelector(".author").textContent,
    /용사.*남의 것 \(남\)/,
  );
  // Only HTTPS images from a post's snapshot are shown.
  assert.equal(log.querySelector(".speaker-title img"), null);
  assert.equal(
    log.querySelector(".speaker-portrait").src,
    "https://media.naru.pub/outfit.png",
  );
  assert.equal(log.querySelector(".member-call").textContent, "나");
  assert.equal(log.querySelector(".log-dice").textContent, "🎲 6 + 5 = 11");
  const comments = log.querySelector(".comments");
  comments.open = true;
  comments.ontoggle();
  await settle();
  await settle();
  const comment = log.querySelector(".comment");
  assert.match(comment.textContent, /히어로 \(나\)/);
  assert.match(comment.textContent, /🎲 2 \+ 3 = 5/);
  assert.deepEqual(
    [...comment.querySelectorAll(".post-action")].map((row) => row.textContent),
    [
      "탐색하여 약초을(를) 획득했습니다! (오늘 남은 탐색 0회)",
      "상자을(를) 사용해서 보석을(를) 획득했습니다!",
    ],
  );
  // The default board allows actions; choices are read on first use.
  const form = log.querySelector(".comment-form");
  assert.equal(form.querySelector(".comment-actions").hidden, false);
  assert.equal(
    database.calls.some((call) => call.name === CHARACTERS),
    false,
  );
  form.querySelector(".comment-character").onfocus();
  form.querySelector(".comment-item").onfocus();
  await settle();
  await settle();
  assert.deepEqual(
    [...form.querySelector(".comment-character").options].map(
      (option) => option.value,
    ),
    ["", "hero"],
  );
  form.querySelector(".comment-character").value = "hero";
  form.querySelector(".comment-action").value = "explore";
  form.querySelector(".comment-item").value = "inv-1";
  form.querySelector(".comment-text").value = "[[남]] 같이 가요";
  submit(form);
  await settle();
  await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.method === "add").at(-1).data,
    {
      logId: "log-0",
      text: "[[남]] 같이 가요",
      dice: false,
      character: "hero",
      action: "explore",
      item: "inv-1",
    },
  );
  // A log can be posted as a character with dice.
  $("logCharacter").onfocus();
  await settle();
  await settle();
  $("logCharacter").value = "hero";
  $("logDice").checked = true;
  $("logText").value = "글";
  Object.defineProperty($("logImage"), "files", {
    value: [new log.ownerDocument.defaultView.File(["png"], "a.png")],
  });
  submit($("logForm"));
  await settle();
  await settle();
  const added = database.calls.filter((call) => call.method === "add").at(-1);
  assert.equal(added.name, LOGS);
  assert.equal(added.data.character, "hero");
  assert.equal(added.data.dice, true);
});

test("custom fields render on the form, and the applicant filter queries by state", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    neo_avocado_character_fields: [
      { id: "age", data: { label: "나이", type: "text", order: 2 } },
      {
        id: "gender",
        data: {
          label: "성별",
          type: "select",
          options: ["여", "남"],
          order: 1,
        },
      },
    ],
  });
  const { $, settle, submit } = await page(database);
  $("tabCharacters").onclick();
  await settle();
  await settle();
  const inputs = [...$("characterFields").querySelectorAll("[data-field]")];
  assert.deepEqual(
    inputs.map((input) => input.dataset.field),
    ["gender", "age"],
  );
  $("characterName").value = "카도";
  inputs[0].value = "여";
  $("characterState").value = "submitted";
  submit($("characterForm"));
  await settle();
  await settle();
  assert.deepEqual(database.calls.at(-1).data.fields, { gender: "여" });
  assert.equal(database.calls.at(-1).data.state, "submitted");
  $("characterFilter").value = "applicants";
  $("characterFilter").onchange();
  await settle();
  await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.name === CHARACTERS).at(-1).where,
    { in: ["state", ["editing", "submitted"]] },
  );
});

test("calls arrive as live notices and the history marks them seen", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [LOGS]: [
      {
        id: "log-9",
        createdBy: "member-other",
        data: { image: "https://media.naru.pub/9.png", text: "[[나]]" },
      },
    ],
  });
  database.answer = (name) =>
    name === "community/messages:messageStatus"
      ? { unread: false, calls: true }
      : name === "community/calls:callHistory"
        ? {
            unread: true,
            nextCursor: null,
            documents: [
              {
                id: "call-1",
                data: {
                  kind: "call",
                  nick: "남",
                  speaker: "남의 것",
                  logId: "log-9",
                  preview: "나",
                  at: Date.parse("2030-01-01T00:00:00Z"),
                  unread: true,
                },
              },
            ],
          }
        : null;
  const { $, settle } = await page(database);
  await settle();
  database.live.options.onStatus("open");
  await settle();
  assert.equal($("tabCalls").textContent, "알림 · 새 알림");
  database.live.options.onMessage({ type: "notice", data: { calls: false } });
  assert.equal($("tabCalls").textContent, "알림");
  database.live.options.onMessage({ type: "notice", data: { calls: true } });
  $("tabCalls").onclick();
  await settle();
  await settle();
  assert.match($("calls").textContent, /남 \(남의 것\)님이 호출했습니다/);
  assert.equal(
    database.calls.some((call) => call.name === "community/calls:seeCalls"),
    true,
  );
  assert.equal($("tabCalls").textContent, "알림");
  // A notification links to the post's own address.
  assert.equal(
    $("calls").querySelector("a").getAttribute("href"),
    "#/post/log-9",
  );
});

test("log numbers, @N links, #tags, notices first and comment counts", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [LOGS]: [
      {
        id: "a",
        data: { image: "a.png", text: "#봄 첫 글", number: 1, tags: ["봄"] },
      },
      {
        id: "b",
        data: { image: "b.png", text: "공지", number: 2, notice: true },
      },
      { id: "c", data: { image: "c.png", text: "@1 보세요", number: 3 } },
    ],
    [COMMENTS]: [{ id: "x", data: { logId: "c", text: "!", dice: false } }],
  });
  const { $, settle } = await page(database);
  await settle();
  const items = [...$("logs").querySelectorAll(".log")];
  assert.deepEqual(
    items.map((item) => item.querySelector(".log-number").textContent),
    ["공지 · No. 2", "No. 3", "No. 1"],
  );
  assert.ok(items[0].classList.contains("notice"));
  assert.equal(
    items[1].querySelector(".comments summary").textContent,
    "댓글 (1)",
  );
  items[1].querySelector(".log-link").onclick({ preventDefault() {} });
  await settle();
  await settle();
  assert.equal($("logFocusPanel").hidden, false);
  assert.match($("logFocus").textContent, /첫 글/);
  assert.deepEqual(
    database.calls.filter((call) => call.method === "list").at(-1).filter,
    { board: "default", number: 1 },
  );
  items[2].querySelector(".hash-tag").onclick({ preventDefault() {} });
  await settle();
  await settle();
  assert.equal($("tagFilter").hidden, false);
  assert.deepEqual(
    [...$("logs").querySelectorAll(".log-text")].map((row) => row.textContent),
    ["#봄 첫 글"],
  );
  // Members are not moderators: no pin or move.
  assert.equal(items[0].querySelector(".pin").hidden, true);
});

test("HTML posts render sanitized, without scripts or handlers", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [LOGS]: [
      {
        id: "rich",
        data: {
          image: "a.png",
          format: "html",
          text: '<b>굵게</b><img src="https://a.b/x.png" onerror="alert(1)"><script>alert(2)</script>',
        },
      },
    ],
  });
  const { $ } = await page(database);
  const body = $("logs").querySelector(".log-text");
  assert.equal(body.querySelector("b").textContent, "굵게");
  assert.equal(body.querySelector("script"), null);
  assert.equal(body.querySelector("img").hasAttribute("onerror"), false);
});

test("before the owner's first sign-in, the page says the site is being prepared", async () => {
  const database = fakeDatabase();
  database.signedIn = false;
  database.unprepared = true;
  // Collections are missing: every read the visitor makes fails NOT_FOUND.
  const { $, settle } = await page(database);
  await settle();
  assert.equal($("welcome").hidden, false);
  assert.match($("status").textContent, /사이트를 준비하고 있습니다/);
});

test("멤버목록 groups approved characters under each 소속 once there are two", async () => {
  const character = (id, name, side) => ({
    id,
    createdBy: "member-other",
    data: {
      name,
      side,
      state: "approved",
      type: "main",
      owner: "member-other",
    },
  });
  const database = fakeDatabase({
    [PROFILES]: [me, { id: "member-other", data: { nick: "남" } }],
    neo_avocado_sides: [
      { id: "dark", data: { name: "어둠", order: 2 } },
      { id: "light", data: { name: "빛", order: 1 } },
    ],
    [CHARACTERS]: [
      character("a", "아침", "빛"),
      character("b", "밤", "어둠"),
      character("c", "떠돌이", ""),
    ],
  });
  const { $, settle } = await page(database);
  $("characterFilter").value = "approved";
  $("tabCharacters").onclick();
  for (let n = 0; n < 6; n += 1) await settle();
  const rows = [...$("characters").children].map((row) =>
    row.classList.contains("side-title")
      ? `[${row.textContent}]`
      : row.querySelector(".character-name").textContent,
  );
  assert.deepEqual(rows, ["[빛]", "아침", "[어둠]", "밤", "[기타]", "떠돌이"]);
  // Each character has a 쪽지 button to its owner.
  assert.ok(
    [...$("characters").querySelectorAll(".meta button")].some(
      (button) => button.textContent === "쪽지",
    ),
  );
});
