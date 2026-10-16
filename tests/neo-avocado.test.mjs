// 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { JSDOM } from "jsdom";
import { matches } from "./where.mjs";
import { memberSettings } from "../dist/_naru/modules/access.js";
const root = new URL("../dist/", import.meta.url);

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
const DEFAULT_BOARD = {
  id: "default",
  data: {
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
  },
};
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
      "neo_avocado_wallets",
      "neo_avocado_couples",
      "neo_avocado_sides",
      "neo_avocado_classes",
      "neo_avocado_titles",
      "neo_avocado_board_groups",
    ].map((name) => [
      name,
      // A site the owner has given a 로그 board ("default"), as the
      // original's admin makes boards; tests that need others pass them.
      (
        rows[name] ?? (name === "neo_avocado_boards" ? [DEFAULT_BOARD] : [])
      ).map((row) => ({
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
    // Queries and mutations: the foundation's answer from the same store
    // (profiles, settings, wallets), the rest as a function call.
    query: (name, args = null) => member.call(name, args, "query"),
    mutate: (name, args = null) => member.call(name, args, "mutate"),
    // Each subscription is kept for the test to send newer answers.
    subscribe(name, args, onResult) {
      calls.push({ method: "subscribe", name, args });
      const subscription = {
        name,
        args: JSON.parse(JSON.stringify(args)),
        onResult,
        closed: false,
      };
      database.subscriptions.push(subscription);
      member.call(name, args, "query").then(onResult, () => {});
      return {
        close() {
          subscription.closed = true;
        },
      };
    },
    // 서버 함수는 나루에서 돈다. 여기서는 무엇을 불렀는지만 남기고, 테스트가
    // 정한 결과를 돌려준다.
    async call(name, args = null, kind = "call") {
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
      const profileOf = (id) =>
        store.get(PROFILES).find((row) => row.id === id) ?? null;
      /**
       * The characters' queries, answered from the same store: sheets as
       * lists show them (no custom values) or whole, with the fields the
       * reader may see; what a character's page shows beside them.
       */
      const characterQueries = () => {
        const rows = (name) => store.get(`neo_avocado_${name}`);
        const ownerOf = (row) => row.createdBy ?? row.data.owner;
        const ordered = (list) =>
          [...list].sort(
            (a, b) =>
              (a.data.order ?? 0) - (b.data.order ?? 0) ||
              (a.id < b.id ? -1 : 1),
          );
        const listed = (row) => {
          const { fields, ...data } = row.data;
          return { ...row, data };
        };
        const definitions = () =>
          ordered(rows("character_fields")).filter(
            (row) => database.owner === true || row.data.visibility !== "admin",
          );
        const visible = (row) =>
          Object.fromEntries(
            definitions()
              .filter(
                (field) =>
                  (field.data.visibility ?? "public") === "public" ||
                  (field.data.visibility === "owner" &&
                    database.signedIn &&
                    ownerOf(row) === ME),
              )
              .filter((field) => row.data.fields?.[field.id] !== undefined)
              .map((field) => [field.id, row.data.fields[field.id]]),
          );
        const find = (id) => rows("characters").find((row) => row.id === id);
        const nicks = (list) =>
          Object.fromEntries(
            list
              .map((row) => [ownerOf(row), profileOf(ownerOf(row))?.data.nick])
              .filter(([, nick]) => nick !== undefined),
          );
        const name = (id) =>
          find(id) ? { id, name: find(id).data.name } : null;
        return {
          "characters/sheet:choices": () => ({
            fields: definitions(),
            sides: ordered(rows("sides")),
            classes: ordered(rows("classes")),
          }),
          "characters/sheet:list": () => {
            const { filter = null, page = 1, size = 20 } = args ?? {};
            const all = rows("characters")
              .filter(
                (row) =>
                  !filter ||
                  (filter === "approved"
                    ? row.data.state === "approved"
                    : ["editing", "submitted"].includes(row.data.state)),
              )
              .sort(
                (a, b) =>
                  (a.createdAt < b.createdAt ? -1 : 1) *
                  (filter === "approved" ? 1 : -1),
              );
            const documents = size
              ? all.slice((page - 1) * size, page * size)
              : all;
            return {
              documents: documents.map(listed),
              total: all.length,
              nicks: nicks(documents),
            };
          },
          "characters/sheet:mine": () => ({
            documents: rows("characters")
              .filter((row) => ownerOf(row) === ME)
              .map(listed),
          }),
          "characters/sheet:sheet": () => {
            const row = find(args.id);
            if (!row) return { document: null };
            const outfit = rows("wardrobe").find(
              (entry) =>
                entry.id === row.data.outfit && entry.data.character === row.id,
            );
            return {
              document: {
                ...listed(row),
                data: { ...listed(row).data, fields: visible(row) },
              },
              nicks: nicks([row]),
              outfitImage: outfit?.data.image ?? null,
            };
          },
          "characters/sheet:named": () => ({
            document:
              rows("characters")
                .filter(
                  (row) =>
                    row.data.name === args.name &&
                    (!args.approved || row.data.state === "approved"),
                )
                .map(listed)[0] ?? null,
          }),
          "characters/sheet:details": async () => {
            const row = find(args.character);
            const status = await database.answer(
              "characters/progression:characterStatus",
              { character: args.character },
            );
            const held = status?.state?.titles ?? [];
            return {
              fields: row ? visible(row) : {},
              status,
              titles: rows("titles").filter((title) => held.includes(title.id)),
              couples: ordered(
                rows("couples").filter((couple) =>
                  [couple.data.first, couple.data.second].includes(
                    args.character,
                  ),
                ),
              ).map((couple) => ({
                ...couple,
                partner: name(
                  couple.data.first === args.character
                    ? couple.data.second
                    : couple.data.first,
                ),
              })),
              relations: rows("relations")
                .filter(
                  (relation) => relation.data.character === args.character,
                )
                .sort(
                  (a, b) =>
                    (a.data.order ?? 0) - (b.data.order ?? 0) ||
                    (a.createdAt < b.createdAt ? 1 : -1),
                )
                .map((relation) => ({
                  ...relation,
                  target: name(relation.data.target),
                })),
              wardrobe: rows("wardrobe").filter(
                (outfit) => outfit.data.character === args.character,
              ),
            };
          },
          "characters/couples:list": () => ({
            couples: ordered(rows("couples")).map((couple) => ({
              ...couple,
              first: find(couple.data.first) ?? null,
              second: find(couple.data.second) ?? null,
            })),
          }),
        };
      };
      /**
       * The economy's queries, answered from the same store: the items the
       * member may see (the shop's, their own, a recipe's), the recipes
       * not hidden, and their inventory as asked.
       */
      const economyQueries = () => {
        const inventory = () =>
          store
            .get("neo_avocado_inventory")
            .filter(
              (row) =>
                row.data.owner === ME &&
                (args?.all ||
                  (args?.character
                    ? row.data.character === args.character
                    : !row.data.character)),
            );
        const recipes = () =>
          store
            .get("neo_avocado_recipes")
            .filter((row) => row.data.hidden !== true);
        const items = () => {
          const known = new Set([
            ...store
              .get("neo_avocado_inventory")
              .filter((row) => row.data.owner === ME)
              .map((row) => row.data.item),
            ...recipes().flatMap((row) => [
              row.data.item,
              ...(row.data.ingredients ?? []).map((entry) => entry.item),
            ]),
          ]);
          return store
            .get("neo_avocado_items")
            .filter((row) => row.data.hidden !== true || known.has(row.id));
        };
        return {
          "economy/shop:shop": () => ({
            items: items(),
            recipes: recipes(),
            inventory: inventory(),
          }),
          "economy/inventory:inventory": () => {
            const rows = inventory();
            return {
              inventory: rows,
              items: store
                .get("neo_avocado_items")
                .filter((item) =>
                  rows.some((row) => row.data.item === item.id),
                ),
            };
          },
        };
      };
      /**
       * The boards' queries, answered from the same store: the boards with
       * their groups and emoticons, a board's page (notices first, newest
       * first, the board's rows a page, with comment counts), one post, a
       * post's comments, a board's newest post and unread calls.
       */
      const boardQueries = () => {
        const boards = () => store.get("neo_avocado_boards");
        const boardOf = (id) => boards().find((row) => row.id === id);
        const logs = () => store.get(LOGS);
        const comments = (id) =>
          store
            .get(COMMENTS)
            .filter((row) => row.data.logId === id)
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        const notFound = () => {
          throw Object.assign(new Error("자료를 찾을 수 없습니다."), {
            code: "NOT_FOUND",
            details: { reason: "document_not_found" },
          });
        };
        return {
          "community/boards:boards": () => ({
            boards: boards(),
            groups: [...store.get("neo_avocado_board_groups")].sort(
              (a, b) =>
                (a.data.order ?? 0) - (b.data.order ?? 0) ||
                (a.id < b.id ? -1 : 1),
            ),
            emoticons: store.get("neo_avocado_emoticons"),
          }),
          "community/posts:page": () => {
            const board = boardOf(args.board);
            const size = Math.min(
              board.data.pageRows ?? 15,
              board.data.kind === "qna" && !args.tag ? 10 : 100,
            );
            const all = logs()
              .filter(
                (row) =>
                  row.data.board === args.board &&
                  (!args.category || row.data.category === args.category) &&
                  (!args.tag || (row.data.tags ?? []).includes(args.tag)),
              )
              .sort(
                (a, b) =>
                  (b.data.notice === true) - (a.data.notice === true) ||
                  (a.createdAt < b.createdAt ? 1 : -1),
              );
            const page = args.page ?? 1;
            const documents = all.slice((page - 1) * size, page * size);
            return {
              board,
              documents,
              total: all.length,
              size,
              counts: Object.fromEntries(
                documents.map((row) => [row.id, comments(row.id).length]),
              ),
            };
          },
          "community/posts:post": () => ({
            document:
              (args.id !== undefined
                ? logs().find((row) => row.id === args.id)
                : logs().find(
                    (row) =>
                      row.data.board === args.board &&
                      row.data.number === args.number,
                  )) ?? notFound(),
          }),
          "community/comments:list": () => {
            const all = comments(args.post);
            const start = args.after
              ? all.findIndex((row) => row.id === args.after) + 1
              : 0;
            const documents = all.slice(start, start + 50);
            return {
              documents,
              nextCursor: start + 50 < all.length ? documents.at(-1).id : null,
            };
          },
          "community/posts:latest": () => ({ id: null }),
          "community/inbox:status": () => ({ messages: 0, calls: false }),
        };
      };
      if (name === "community/membership:membership") {
        const profile = profileOf(ME);
        return {
          status: "approved",
          role: database.role ?? "member",
          owner: database.owner === true,
          adult: database.adult === true,
          profile,
        };
      }
      if (name === "community/membership:join") {
        database.joined = args;
        calls.push({ method: kind, name, args });
        return {
          status: "approved",
          profile: await member
            .collection(PROFILES)
            .set(ME, { nick: args.nick }),
        };
      }
      const foundation = {
        "community/profiles:nicks": () => ({
          nicks: Object.fromEntries(
            args.ids
              .map((id) => [id, profileOf(id)?.data.nick])
              .filter(([, nick]) => nick !== undefined),
          ),
        }),
        "community/profiles:find": () => ({
          profiles: store
            .get(PROFILES)
            .filter((row) => args.nicks.includes(row.data.nick))
            .map((row) => ({
              id: row.id,
              nick: row.data.nick,
              acceptMessages: row.data.acceptMessages !== false,
            })),
        }),
        "community/profiles:own": () => ({ profile: profileOf(ME) }),
        "community/profiles:update": async () => ({
          profile: await member
            .collection(PROFILES)
            .set(ME, { ...profileOf(ME)?.data, ...args }),
        }),
        "content/site:settings": () =>
          memberSettings(
            store
              .get("neo_avocado_settings")
              .find((row) => row.id === "community")?.data ?? {},
          ),
        "economy/wallet:wallet": () => ({
          balance:
            store.get("neo_avocado_wallets").find((row) => row.id === ME)?.data
              .balance ?? 0,
        }),
        ...economyQueries(),
        ...characterQueries(),
        ...boardQueries(),
      };
      if (Object.hasOwn(foundation, name)) {
        calls.push({ method: kind, name, args });
        // Before the site is ready, as Naru answers reads of what it has
        // not made yet.
        if (database.unprepared)
          throw Object.assign(new Error(`Collection ${name} does not exist.`), {
            code: "NOT_FOUND",
          });
        return JSON.parse(JSON.stringify(await foundation[name]()));
      }
      // Writes: posts, comments and characters through their functions,
      // kept in the same store native reads come from.
      const writes = {
        "community/posts": LOGS,
        "community/comments": COMMENTS,
        "characters/sheet": CHARACTERS,
      };
      const [path, operation] = name.split(":");
      if (writes[path] && ["write", "save", "remove"].includes(operation)) {
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
    async call(name, args = null, kind = "call") {
      if (name !== "content/site:site")
        visitor.calls.push(JSON.parse(JSON.stringify({ name, args })));
      return member.call(name, args, kind);
    },
    query: (name, args = null) => visitor.call(name, args, "query"),
    mutate: (name, args = null) => visitor.call(name, args, "mutate"),
    subscribe: (...args) => member.subscribe(...args),
  };
  const database = {
    calls,
    store,
    member,
    visitor,
    subscriptions: [],
    signedIn: true,
    answer: () => refuse("empty"),
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
        query: database.visitor.query,
        mutate: database.visitor.mutate,
        subscribe: database.visitor.subscribe,
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
      // The mmb skin's options, as the edit dialog shows them.
      membersOnly: false,
      adult: false,
      wide: false,
      fold: false,
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

test("profile edits go through profiles:update, character edits use their original revisions, and both keep extra fields", async () => {
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
  // The member's own profile changes through profiles:update, which keeps
  // the rest.
  assert.deepEqual(
    database.calls.find((call) => call.name === "community/profiles:update")
      .args,
    { nick: "새 이름", acceptMessages: true, commentAlerts: true },
  );
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

test("the shop exposes later pages and crafts from the inventory's own copies through the server", async () => {
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
  // The recipe's materials are taken from the inventory, as the original's.
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

test("signed out, a visitor reads only the boards the board query lists, and may sign in", async () => {
  // The boards query gives this visitor no boards.
  const database = fakeDatabase({ neo_avocado_boards: [] });
  database.signedIn = false;
  const { $, settle, window } = await page(database);
  assert.equal($("welcome").hidden, false);
  assert.equal($("community").hidden, false);
  assert.ok(window.document.body.classList.contains("visitor"));
  // No board is open to guests: nothing but the board list is read.
  assert.equal($("noPublicBoards").hidden, false);
  assert.equal($("logForm").hidden, true);
  // Besides it, their one call reports the visit (현재접속자, 접속자집계).
  assert.deepEqual(
    database.visitor.calls.map((call) => call.name),
    ["community/presence:seen", "community/boards:boards"],
  );
  assert.deepEqual(
    database.calls
      .filter((call) => call.method !== "call")
      .map((call) => [call.method, call.name]),
    [["query", "community/boards:boards"]],
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
  const { $, submit, settle } = await page(database);
  const post = $("logs").querySelector(".log");
  // A visitor reads the board's page as members do.
  assert.ok(
    database.visitor.calls.some((call) => call.name === "community/posts:page"),
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
  // Membership brought no profile; then the settings for the rules to
  // agree to (none here).
  assert.deepEqual(database.calls.at(0), {
    method: "query",
    name: "content/site:settings",
    args: null,
  });
  assert.equal(database.calls.length, 1);
  assert.equal($("stipulationBox").hidden, true);
  assert.equal($("characterNoticeBox").hidden, true);
  $("nick").value = " 아보 ";
  submit($("profileForm"));
  await settle();
  assert.equal(database.joined.agreed, false);
  assert.deepEqual(database.calls.at(1), {
    method: "mutate",
    name: "community/membership:join",
    args: { nick: "아보", agreed: false },
  });
  assert.equal($("community").hidden, false);
  assert.equal($("whoami").textContent, "아보 님");
  assert.equal(
    database.calls.some((call) => call.name === "community/posts:page"),
    true,
  );
});

test("joining shows the owner's rules with boxes to tick, and says they were agreed to", async () => {
  const database = fakeDatabase({
    neo_avocado_settings: [
      {
        id: "community",
        data: { stipulation: "첫째 줄\n둘째 줄", characterNotice: "" },
      },
    ],
  });
  const { $, settle, submit } = await page(database);
  assert.equal($("stipulationBox").hidden, false);
  assert.equal($("stipulationText").textContent, "첫째 줄\n둘째 줄");
  assert.equal($("stipulationAgree").required, true);
  assert.equal($("characterNoticeBox").hidden, true);
  assert.equal($("characterNoticeAgree").required, false);
  $("stipulationAgree").checked = true;
  $("nick").value = "아보";
  submit($("profileForm"));
  await settle();
  assert.equal(database.joined.agreed, true);
});

const slide = (id, place = "main") => ({
  id,
  place,
  image: `https://cdn.example/${id}.png`,
  mobileImage: null,
  alt: id,
  url: null,
  newWindow: false,
});

test("site_main's placeholders become the slides, the member card and links, as nodes", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  database.site = { main: true, banners: [slide("one"), slide("two")] };
  database.answer = (name) => {
    if (name === "content/pages:contentPage")
      return {
        page: {
          name: "메인",
          format: "html",
          body: '<p>{{VISUAL_SLIDE}}</p><div id="x">{{OUTLOGIN}} {{MYPAGE}} {{LOGIN}} {{UNKNOWN}}{{TWITTER}}</div><img src="x.png" onerror="alert(1)"><p title="{{LOGIN}}">text</p>',
        },
      };
    return refuse("empty");
  };
  const { $, settle } = await page(database);
  await settle();
  const main = $("mainPage");
  // The slider is the page's own, one slide at a time; the home's is hidden.
  assert.equal($("banners").hidden, true);
  const slides = [...main.querySelectorAll(".banners .slide")];
  assert.deepEqual(
    slides.map((element) => element.hidden),
    [false, true],
  );
  main.querySelector(".slide-nav.next").onclick();
  assert.deepEqual(
    slides.map((element) => element.hidden),
    [true, false],
  );
  main.querySelector(".slide-nav.next").onclick();
  assert.equal(slides[0].hidden, false);
  main.querySelector(".slide-nav.previous").onclick();
  assert.equal(slides[1].hidden, false);
  assert.equal(main.contains($("profileCard")), true);
  assert.deepEqual(
    [...main.querySelectorAll("a.member-only, a.guest-only")].map(
      (link) => link.textContent,
    ),
    ["마이페이지", "로그인"],
  );
  // Unknown ones stay as written; the gone timeline leaves nothing.
  assert.match(main.textContent, /\{\{UNKNOWN\}\}/);
  assert.doesNotMatch(main.textContent, /TWITTER|VISUAL_SLIDE|OUTLOGIN/);
  // Expanded after sanitizing: attributes are not, and nothing runs.
  assert.equal(main.querySelector("img").hasAttribute("onerror"), false);
  assert.equal(main.querySelector("p[title]").title, "{{LOGIN}}");
});

test("the main page's card counts unread mail, offers 캐릭터 생성 and links the owner to 관리자", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    neo_avocado_settings: [{ id: "community", data: {} }],
  });
  database.owner = true;
  database.answer = () => refuse("empty");
  const { $, settle } = await page(database);
  await settle();
  const inbox = database.subscriptions.find(
    (subscription) => subscription.name === "community/inbox:status",
  );
  inbox.onResult({ messages: 3, calls: false });
  assert.equal($("cardUnread").textContent, "3");
  assert.equal($("cardUnread").hidden, false);
  // Naru answers again as mail arrives or is read.
  inbox.onResult({ messages: 4, calls: false });
  assert.equal($("cardUnread").textContent, "4");
  inbox.onResult({ messages: 0, calls: false });
  assert.equal($("cardUnread").hidden, true);
  assert.equal($("cardAdmin").hidden, false);
  assert.equal($("cardDescript").textContent, "보유중인 캐릭터가 없습니다.");
  assert.equal(
    $("cardThumb").querySelector("button").textContent,
    "캐릭터 생성",
  );
});

test("the intro shows one picture at a time on arriving home, then not for a day", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  database.site = {
    banners: [slide("a", "intro"), slide("b", "intro"), slide("main")],
  };
  database.answer = () => refuse("empty");
  const { $, settle, window } = await page(database);
  await settle();
  assert.equal($("intro").open, true);
  const picture = () => $("introImages").querySelector("img").src;
  assert.equal(picture(), "https://cdn.example/a.png");
  // An intro picture is not a link: a click is the next one.
  assert.equal($("introImages").querySelector("a"), null);
  $("introImages").querySelector("button").onclick();
  assert.equal(picture(), "https://cdn.example/b.png");
  $("introImages").querySelector("button").onclick();
  assert.equal($("intro").open, false);
  const until = Number(window.localStorage.getItem("neo-avocado-intro-closed"));
  assert.ok(until > Date.now() + 23 * 3600 * 1000);
  // The main slides: one, so no buttons to turn it.
  assert.equal($("banners").querySelectorAll(".slide").length, 1);
  assert.equal($("banners").querySelector(".slide-nav"), null);
});

test("logs are read a page at a time, newest first, and comments only when opened", async () => {
  const logs = Array.from({ length: 17 }, (_, n) => ({
    id: `log-${n}`,
    data: { image: `https://media.naru.pub/${n}.png`, text: `로그 ${n}` },
    createdBy: n === 16 ? ME : "member-other",
  }));
  const database = fakeDatabase({
    [PROFILES]: [me, { id: "member-other", data: { nick: "남" } }],
    [LOGS]: logs,
    [COMMENTS]: [
      { id: "c-1", data: { logId: "log-16", text: "멋져요", dice: false } },
    ],
  });
  const { $, settle } = await page(database);
  // The boards (with their groups, for the board picker), then the board's
  // first page in one read.
  const listed = database.calls.filter((call) =>
    ["community/boards:boards", "community/posts:page"].includes(call.name),
  );
  assert.deepEqual(listed, [
    { method: "query", name: "community/boards:boards", args: null },
    {
      method: "query",
      name: "community/posts:page",
      args: { board: "default", page: 1 },
    },
  ]);
  const items = $("logs").querySelectorAll(".log");
  assert.equal(items.length, 15);
  assert.equal(items[0].querySelector(".log-text").textContent, "로그 16");
  // 자기 로그에만 삭제가 보인다.
  assert.equal(items[0].querySelector(".delete").hidden, false);
  assert.equal(items[1].querySelector(".delete").hidden, true);
  // 같은 회원의 닉네임은 한 번만 묻는다.
  const askedFor = database.calls
    .filter((call) => call.name === "community/profiles:nicks")
    .flatMap((call) => call.args.ids);
  // The member's own came with their membership.
  assert.deepEqual(askedFor, ["member-other"]);
  assert.equal(
    database.calls.some((call) => call.name === "community/comments:list"),
    false,
  );
  // The page brought each post's comment count.
  assert.equal(
    items[0].querySelector(".comments summary").textContent,
    "댓글 (1)",
  );
  const comments = items[0].querySelector(".comments");
  comments.open = true;
  comments.ontoggle();
  await settle();
  await settle();
  assert.deepEqual(
    database.calls
      .filter((call) => call.name === "community/comments:list")
      .at(-1),
    {
      method: "query",
      name: "community/comments:list",
      args: { post: "log-16", after: null },
    },
  );
  assert.match(items[0].querySelector(".comment-list").textContent, /멋져요/);
  // Numbered pages: 17 posts make two pages of 15 (cf_page_rows).
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
    { method: "media.upload", name: "log.png" },
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
        wide: false,
        fold: false,
        membersOnly: false,
        adult: false,
        anonymous: false,
      },
    },
  ]);
  assert.equal($("logs").querySelector(".log-text").textContent, "첫 로그");
});

test("characters are read when their tab is first opened, and registered by members", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    // Two a member: they have one, and register the second.
    neo_avocado_settings: [{ id: "community", data: { characterLimit: 2 } }],
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
  const lists = () =>
    database.calls.filter((call) => call.name === "characters/sheet:list");
  assert.equal(lists().length, 0);
  $("tabCharacters").onclick();
  await settle();
  await settle();
  assert.equal($("charactersView").hidden, false);
  // A page of them, newest first, with their owners' nicknames.
  assert.deepEqual(lists(), [
    {
      method: "query",
      name: "characters/sheet:list",
      args: { filter: null, page: 1, size: 20 },
    },
  ]);
  assert.equal(
    $("characters").querySelector(".author").textContent,
    "오너: 나",
  );
  // The lists have no form: 마이페이지's 신규 캐릭터 등록 opens it, as
  // mypage/character/index.php does.
  assert.equal(
    $("characters").closest("section").contains($("characterForm")),
    false,
  );
  $("tabMypage").onclick();
  await settle();
  await settle();
  assert.equal($("newCharacter").hidden, false);
  assert.equal($("characterForm").hidden, true);
  $("newCharacter").onclick();
  await settle();
  assert.equal($("characterForm").hidden, false);
  $("characterName").value = "카도";
  $("characterSide").value = "갈색단";
  $("characterClass").value = "인간";
  submit($("characterForm"));
  await settle();
  await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.method === "add").at(-1),
    {
      method: "add",
      name: CHARACTERS,
      data: {
        name: "카도",
        side: "갈색단",
        class: "인간",
        profile: "",
        state: "editing",
      },
    },
  );
  await settle();
  // 마이페이지 lists it; with two of two, the button goes.
  assert.match($("myCharacters").textContent, /카도/);
  assert.equal($("newCharacter").hidden, true);
  assert.equal($("characterForm").hidden, true);
  // The list reads the new character when next opened, and then not again.
  const reads = () => lists().length;
  $("tabCharacters").onclick();
  await settle();
  await settle();
  assert.match($("characters").textContent, /카도/);
  const after = reads();
  $("tabLogs").onclick();
  $("tabCharacters").onclick();
  await settle();
  assert.equal(reads(), after);
});

test("an ended sign-in returns the page to the welcome screen", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  const { $, settle } = await page(database);
  database.member.query = async () => {
    throw Object.assign(new Error("expired"), { code: "AUTH_REQUIRED" });
  };
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
      data: {
        name: "물약",
        // 진열 순서 (sh_order) before names: 요정 활 (0), 물약, 기념품.
        order: 1,
        price: 10,
        stock: 3,
        sellPrice: 5,
        effect: { type: "restore", stat: "hp", amount: 1 },
      },
      createdAt: "1",
    },
    {
      id: "secret",
      data: { name: "비밀", price: 1, hidden: true },
      createdAt: "2",
    },
    {
      id: "elven",
      data: { name: "요정 활", price: 1, requirements: { classes: ["요정"] } },
      createdAt: "5",
    },
    {
      id: "token",
      data: {
        name: "기념품",
        order: 2,
        price: 1,
        sellable: false,
        giftable: false,
      },
      createdAt: "6",
    },
  ]);
  database.store.set(CHARACTERS, [
    {
      id: "hero",
      createdBy: ME,
      data: { name: "용사", state: "approved", class: "요정" },
    },
    { id: "draft", createdBy: ME, data: { name: "초안", state: "editing" } },
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
    {
      id: "i-3",
      data: { owner: ME, item: "token", name: "기념품" },
      createdAt: "7",
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
  // No character chosen: an item kept for one 종족 is left out
  // (shop/index.php:36), and nothing can be bought (shop.item.skin.php:24).
  // The list shows pictures and names (shop.skin.php); picking one shows
  // its price, and 구매하기 only for an approved character.
  const listed = () =>
    [...$("items").children].map(
      (row) => row.querySelector(".shop-pick").textContent,
    );
  const pick = (name) =>
    [...$("items").querySelectorAll(".shop-pick")]
      .find((button) => button.textContent.includes(name))
      .onclick();
  const detailButtons = (id) =>
    [...$(id).querySelectorAll("button")].map((button) => button.textContent);
  assert.deepEqual(listed(), ["물물약", "기기념품"]);
  pick("물약");
  assert.match($("shopDetail").textContent, /물약 10 아보/);
  assert.match($("shopDetail").textContent, /남은 수량 3개/);
  assert.deepEqual(detailButtons("shopDetail"), []);
  assert.equal($("shopBuyNote").hidden, false);
  // One slot an item; its detail has 판매하기, 사용하기 and 선물하기 as the
  // item allows (inventory/skin/item.skin.php:36-44).
  const slot = (name) =>
    [...$("inventory").querySelectorAll(".inventory-slot button")].find(
      (button) => button.title === name,
    );
  assert.deepEqual(
    [...$("inventory").querySelectorAll(".inventory-slot button")]
      .map((button) => button.title)
      .sort(),
    ["기념품", "물약"],
  );
  slot("기념품").onclick();
  assert.deepEqual(detailButtons("inventoryDetail"), ["캐릭터 이동"]);
  slot("물약").onclick();
  assert.match($("inventoryDetail").textContent, /물약 5 아보/);
  assert.deepEqual(detailButtons("inventoryDetail"), [
    "판매하기",
    "사용하기",
    "선물하기",
    "캐릭터 이동",
  ]);
  // The member's own inventory, of no character until one is chosen.
  assert.deepEqual(
    database.calls.find((call) => call.name === "economy/shop:shop").args,
    { character: null },
  );
  // A character not yet approved buys nothing either. 종족 is the sheet's
  // (ch_class), not a value in the official record.
  const official = {
    draft: { approved: false, class: "요정" },
    hero: { approved: true },
  };
  database.answer = (name, args) =>
    name === "characters/progression:characterStatus"
      ? { state: official[args.character], definitions: [], revision: null }
      : refuse("empty");
  $("inventoryCharacter").value = "draft";
  $("inventoryCharacter").onchange();
  for (let n = 0; n < 4; n += 1) await settle();
  pick("물약");
  assert.deepEqual(detailButtons("shopDetail"), []);
  assert.equal($("shopBuyNote").hidden, false);
  // An approved 요정 sees the 요정's bow and buys as itself.
  $("inventoryCharacter").value = "hero";
  $("inventoryCharacter").onchange();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(listed(), ["요요정 활", "물물약", "기기념품"]);
  pick("요정 활");
  assert.deepEqual(detailButtons("shopDetail"), ["구매하기"]);
  assert.equal($("shopBuyNote").hidden, true);
  // The page never writes money or items itself: it calls the function, and
  // shows what the function decided.
  const status = database.answer;
  database.answer = (name, args) =>
    name === "economy/shop:gacha"
      ? { balance: 70, owned: { data: { name: "황금 아보카도" } } }
      : name === "characters/progression:characterStatus"
        ? status(name, args)
        : refuse("already", "오늘은 이미 받았습니다.");
  $("gacha").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(
    database.calls
      .filter(
        (call) => call.method === "call" && call.name === "economy/shop:gacha",
      )
      .at(0),
    { method: "call", name: "economy/shop:gacha", args: { character: "hero" } },
  );
  assert.match($("status").textContent, /황금 아보카도/);
  $("shopDetail").querySelector("button").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.equal($("status").textContent, "오늘은 이미 받았습니다.");
  $("shopDetail").querySelector("button").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.method === "call").at(-1),
    {
      method: "call",
      name: "economy/shop:buy",
      args: { item: "elven", character: "hero" },
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

test("unread mail and calls, and new posts, arrive by subscription instead of a poll", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  database.answer = () => refuse("empty");
  const { $, settle } = await page(database);
  await settle();
  const latest = database.subscriptions.find(
    (subscription) => subscription.name === "community/posts:latest",
  );
  assert.deepEqual(latest.args, { board: "default" });
  // One subscription says what is new for the member: mail and calls.
  const inboxes = database.subscriptions.filter(
    (subscription) => subscription.name === "community/inbox:status",
  );
  assert.equal(inboxes.length, 1);
  const [inbox] = inboxes;
  inbox.onResult({ messages: 1, calls: false });
  assert.equal($("tabMessages").textContent, "쪽지 · 새 쪽지");
  assert.equal($("tabCalls").textContent, "알림");
  inbox.onResult({ messages: 0, calls: true });
  assert.equal($("tabMessages").textContent, "쪽지");
  assert.equal($("tabCalls").textContent, "알림 · 새 알림");
  // A newer post than the page has seen marks the tab until reloaded.
  latest.onResult({ id: null });
  assert.equal($("tabLogs").textContent, "로그");
  latest.onResult({ id: "new" });
  assert.equal($("tabLogs").textContent, "로그 · 새 글");
  const logReads = () =>
    database.calls.filter((call) => call.name === "community/posts:page")
      .length;
  const before = logReads();
  $("tabLogs").onclick();
  await settle();
  assert.equal(logReads(), before + 1);
  assert.equal($("tabLogs").textContent, "로그");
  $("signOut").onclick();
  await settle();
  assert.equal(inbox.closed, true);
  assert.equal(latest.closed, true);
});

test("a function's ctx.fail reason and a duplicate nickname are shown as the page's own text", async () => {
  const database = fakeDatabase({ [PROFILES]: [me] });
  const failure = (code, message, details) =>
    Object.assign(new Error(message), { code, details });
  database.answer = (name) => {
    if (name === "economy/shop:gacha")
      throw failure("CONFLICT", "아보가 모자랍니다.", { reason: "not_enough" });
    refuse("empty");
  };
  const { $, settle, submit } = await page(database);
  await settle();
  $("gacha").onclick();
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
      {
        id: "inv-1",
        data: { owner: ME, item: "letter", name: "편지", character: "hero" },
      },
    ],
    // Posts offer a character's items usable in posts (it_use_mmb_able).
    neo_avocado_items: [
      {
        id: "letter",
        data: { name: "편지", effect: { type: "draw" }, usableInPosts: true },
      },
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
  $("tabMypage").onclick();
  await settle();
  await settle();
  $("newCharacter").onclick();
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
  const added = database.calls.filter((call) => call.method === "add").at(-1);
  assert.deepEqual(added.data.fields, { gender: "여" });
  assert.equal(added.data.state, "submitted");
  $("tabCharacters").onclick();
  await settle();
  $("characterFilter").value = "applicants";
  $("characterFilter").onchange();
  await settle();
  await settle();
  // 신청자목록 reads them all at once (size 0), to count and search.
  assert.deepEqual(
    database.calls
      .filter((call) => call.name === "characters/sheet:list")
      .at(-1).args,
    { filter: "applicants", page: 1, size: 0 },
  );
  assert.match($("characters").textContent, /카도/);
});

test("calls arrive by subscription and the history marks them seen", async () => {
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
    name === "community/calls:callHistory"
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
  const unread = database.subscriptions.find(
    (subscription) => subscription.name === "community/inbox:status",
  );
  unread.onResult({ messages: 0, calls: true });
  assert.equal($("tabCalls").textContent, "알림 · 새 알림");
  unread.onResult({ messages: 0, calls: false });
  assert.equal($("tabCalls").textContent, "알림");
  unread.onResult({ messages: 0, calls: true });
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
    database.calls.filter((call) => call.name === "community/posts:post").at(-1)
      .args,
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
  // Nothing is made yet: every read the visitor makes fails NOT_FOUND.
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

test("사이트공개 off: a visitor sees the welcome and sign-in card only, whatever the address", async () => {
  const database = fakeDatabase({
    [CHARACTERS]: [{ id: "hero", data: { name: "용사", state: "approved" } }],
  });
  database.signedIn = false;
  database.site = { open: false };
  const { $, settle, window } = await page(database);
  for (let n = 0; n < 4; n += 1) await settle();
  const body = window.document.body;
  assert.ok(body.classList.contains("site-closed"));
  assert.equal($("welcome").hidden, false);
  assert.equal($("homeView").hidden, false);
  // extend/community.config.php sends guests to log in: nothing is read.
  assert.deepEqual(
    database.calls.filter((call) => call.method !== "call"),
    [],
  );
  for (const hash of ["#/members", "#/character/hero", "#/logs/default"]) {
    window.location.hash = hash;
    for (let n = 0; n < 4; n += 1) await settle();
    assert.equal($("homeView").hidden, false, hash);
    assert.equal($("charactersView").hidden, true, hash);
    assert.equal($("characterView").hidden, true, hash);
    assert.equal($("logsView").hidden, true, hash);
  }
  assert.deepEqual(
    database.calls.filter((call) => call.method !== "call"),
    [],
  );
  $("cardSignIn").onclick();
  await settle();
  assert.deepEqual(database.calls.at(-1), { method: "signIn" });
});

test("사이트공개 on: a visitor opens 멤버목록, 신청자목록 and a character's page", async () => {
  const database = fakeDatabase({
    [PROFILES]: [{ id: "owner-1", data: { nick: "주인" } }],
    [CHARACTERS]: [
      {
        id: "hero",
        createdBy: "owner-1",
        data: { name: "용사", state: "approved", owner: "owner-1" },
      },
      {
        id: "draft",
        createdBy: "owner-1",
        data: { name: "지원자", state: "submitted", owner: "owner-1" },
      },
    ],
  });
  database.signedIn = false;
  database.answer = (name) =>
    name === "characters/progression:characterStatus"
      ? {
          state: { exp: 3, points: 0, stats: {}, titles: [] },
          definitions: [],
          revision: null,
          rank: "",
        }
      : name === "characters/progression:characterSheet"
        ? { exp: [], inventory: null, balance: null }
        : refuse("empty");
  const { $, settle, window } = await page(database);
  assert.ok(!window.document.body.classList.contains("site-closed"));
  const open = async (label) => {
    [...$("siteMenu").querySelectorAll("a")]
      .find((link) => link.textContent === label)
      .onclick({ preventDefault() {} });
    for (let n = 0; n < 6; n += 1) await settle();
  };
  const names = () =>
    [...$("characters").querySelectorAll(".character-name")].map(
      (name) => name.textContent,
    );
  // member/index.php and member/ready.php, without signing in.
  await open("멤버목록");
  assert.equal($("charactersView").hidden, false);
  assert.deepEqual(names(), ["용사"]);
  await open("신청자목록");
  assert.deepEqual(names(), ["지원자"]);
  // Nothing of the owner's is offered to a visitor.
  for (const button of $("characters").querySelectorAll(
    ".edit, .delete, .main-character, .allocate-stats",
  ))
    assert.equal(button.hidden, true);
  // member/viewer.php through its address.
  window.location.hash = "#/character/hero";
  for (let n = 0; n < 8; n += 1) await settle();
  assert.equal($("characterView").hidden, false);
  assert.equal(
    $("characterSheet").querySelector(".character-name").textContent,
    "용사",
  );
  assert.ok(
    database.visitor.calls.some(
      (call) => call.name === "characters/progression:characterSheet",
    ),
  );
});

test("on a Q&A board the comment form is the staff's alone", async () => {
  const board = {
    id: "default",
    data: {
      name: "문의",
      kind: "qna",
      enabled: true,
      listLevel: 1,
      readLevel: 1,
      writeLevel: 1,
      commentLevel: 1,
    },
  };
  const question = {
    id: "q-1",
    createdBy: "member-other",
    createdAt: "2030-01-01T00:00:00.000Z",
    data: { board: "default", text: "환불되나요?" },
  };
  const formHidden = async (setup) => {
    const database = fakeDatabase({
      [PROFILES]: [me, { id: "member-other", data: { nick: "남" } }],
      neo_avocado_boards: [board],
      [LOGS]: [question],
    });
    setup(database);
    database.answer = (name) =>
      name === "community/posts:questions"
        ? { documents: [question], nextCursor: null, totalCount: 1 }
        : refuse("empty");
    const { $, settle } = await page(database);
    for (let n = 0; n < 6; n += 1) await settle();
    const log = $("logs").querySelector(".log");
    assert.ok(log, "the question is listed");
    return log.querySelector(".comment-form").hidden;
  };
  // skin/board/qna/list.skin.php:85-87: members and guests do not answer.
  assert.equal(await formHidden(() => {}), true);
  assert.equal(
    await formHidden((database) => (database.role = "moderator")),
    false,
  );
  assert.equal(await formHidden((database) => (database.owner = true)), false);
});

test("an approved character's stats only take the points left, never going down", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [CHARACTERS]: [
      { id: "hero", createdBy: ME, data: { name: "용사", state: "approved" } },
    ],
  });
  let points = 10;
  database.answer = (name) =>
    name === "characters/progression:characterStatus"
      ? {
          state: {
            exp: 0,
            points,
            approved: true,
            stats: { hp: { allocated: 4, max: 4, current: 4, damage: 0 } },
            titles: [],
          },
          definitions: [{ id: "hp", data: { name: "HP" } }],
          revision: "r1",
          rank: "",
        }
      : refuse("empty");
  const { $, settle } = await page(database);
  $("tabCharacters").onclick();
  for (let n = 0; n < 6; n += 1) await settle();
  const item = $("characters").querySelector(".character");
  const details = item.querySelector(".character-details");
  details.open = true;
  details.ontoggle();
  for (let n = 0; n < 6; n += 1) await settle();
  assert.match(item.querySelector(".progression").textContent, /남은 6/);
  const allocate = item.querySelector(".allocate-stats");
  assert.equal(allocate.hidden, false);
  allocate.onclick();
  // status.inc.php's data-min: what the stat has once approved.
  assert.equal($("editorFields").querySelector('[name="hp"]').min, "4");
  $("editor").close();
  // With nothing left there is nothing to change (status_modify false).
  points = 4;
  $("characterFilter").onchange();
  for (let n = 0; n < 6; n += 1) await settle();
  const again = $("characters").querySelector(".character");
  again.querySelector(".character-details").open = true;
  again.querySelector(".character-details").ontoggle();
  for (let n = 0; n < 6; n += 1) await settle();
  assert.match(again.querySelector(".progression").textContent, /남은 0/);
  assert.equal(again.querySelector(".allocate-stats").hidden, true);
});

test("relations are an approved character's, as hearts with their links; the closet waits for a 전신", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me],
    [CHARACTERS]: [
      { id: "hero", createdBy: ME, data: { name: "용사", state: "approved" } },
      { id: "rival", createdBy: ME, data: { name: "맞수", state: "approved" } },
    ],
    neo_avocado_relations: [
      {
        id: "r1",
        data: {
          owner: ME,
          character: "hero",
          target: "rival",
          affinity: 40,
          memo: "오랜 맞수",
          link: "https://example.com/a\nhttps://example.com/b",
          order: 0,
        },
      },
      {
        id: "r2",
        data: { owner: ME, character: "hero", target: "rival", memo: "" },
      },
    ],
  });
  database.answer = (name) =>
    name === "characters/progression:characterStatus"
      ? {
          state: { exp: 0, points: 0, approved: true, stats: {}, titles: [] },
          definitions: [],
          revision: null,
          rank: "",
        }
      : refuse("empty");
  const { $, settle } = await page(database);
  $("tabCharacters").onclick();
  for (let n = 0; n < 6; n += 1) await settle();
  const item = [...$("characters").querySelectorAll(".character")].find(
    (row) => row.querySelector(".character-name").textContent === "용사",
  );
  const details = item.querySelector(".character-details");
  details.open = true;
  details.ontoggle();
  for (let n = 0; n < 8; n += 1) await settle();
  assert.equal(item.querySelector(".relations-section").hidden, false);
  // viewer.skin.php:209: a relation with no summary is not shown.
  const rows = item.querySelectorAll(".relations > li");
  assert.equal(rows.length, 1);
  // An affinity from before is held to five hearts.
  assert.equal(rows[0].querySelector(".affinity").textContent, "♥♥♥♥♥");
  assert.deepEqual(
    [...rows[0].querySelectorAll('a[href^="https://"]')].map((a) => a.href),
    ["https://example.com/a", "https://example.com/b"],
  );
  // Only the 두상 is in use: no closet (viewer.skin.php:7).
  assert.equal(item.querySelector(".closet-section").hidden, true);
  // 메인·서브 is the admin's: the member's form does not offer it.
  item.querySelector(".edit").onclick();
  for (let n = 0; n < 4; n += 1) await settle();
  assert.equal($("editorFields").querySelector('[name="type"]'), null);
  $("editor").close();
});

test("a board lists by 분류, shows its HTML notice and new-post text, and marks its writer's comments", async () => {
  const database = fakeDatabase({
    [PROFILES]: [me, { id: "member-other", data: { nick: "남" } }],
    neo_avocado_boards: [
      {
        id: "default",
        data: {
          ...DEFAULT_BOARD.data,
          categories: ["잡담", "공지"],
          description: "<b>규칙</b><script>alert(1)</script>",
          insertContent: "캐릭터: ",
        },
      },
    ],
    [LOGS]: [
      {
        id: "a",
        data: {
          image: "https://media.naru.pub/a.png",
          text: "a",
          category: "잡담",
          adult: true,
        },
        createdBy: "member-other",
      },
      {
        id: "b",
        data: {
          image: "https://media.naru.pub/b.png",
          text: "b",
          category: "공지",
        },
        createdBy: ME,
      },
    ],
    [COMMENTS]: [
      { id: "c-1", data: { logId: "b", text: "내 댓글" }, createdBy: ME },
      {
        id: "c-2",
        data: { logId: "b", text: "운영자", admin: true },
        createdBy: "member-other",
      },
    ],
  });
  // mb_adult: 19금 shows uncovered.
  database.adult = true;
  const { $, settle } = await page(database);
  // bo_content_head, sanitized.
  assert.equal($("boardDescription").querySelector("b").textContent, "규칙");
  assert.equal($("boardDescription").querySelector("script"), null);
  // bo_insert_content starts a new post.
  assert.equal($("logText").value, "캐릭터: ");
  assert.equal($("logs").querySelector(".blind"), null);
  const links = () => [...$("boardCategories").querySelectorAll("a")];
  assert.deepEqual(
    links().map((link) => link.textContent),
    ["전체", "잡담", "공지"],
  );
  links()[1].onclick({ preventDefault() {} });
  for (let n = 0; n < 4; n += 1) await settle();
  assert.deepEqual(
    database.calls.filter((call) => call.name === "community/posts:page").at(-1)
      .args,
    { board: "default", page: 1, category: "잡담" },
  );
  assert.deepEqual(
    [...$("logs").querySelectorAll(".log")].map((item) => item.dataset.id),
    ["a"],
  );
  assert.equal(links()[1].getAttribute("aria-current"), "page");
  links()[0].onclick({ preventDefault() {} });
  for (let n = 0; n < 4; n += 1) await settle();
  const post = $("logs").querySelector('.log[data-id="b"]');
  const comments = post.querySelector(".comments");
  comments.open = true;
  comments.ontoggle();
  for (let n = 0; n < 4; n += 1) await settle();
  const [mine, staff] = post.querySelectorAll(".comment");
  assert.equal(mine.classList.contains("owner"), true);
  assert.equal(staff.classList.contains("owner"), false);
  assert.equal(staff.querySelector(".admin-mark").textContent, "관리자");
});
