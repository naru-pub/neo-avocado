// Run the actual Naru runner, QuickJS-ng build and memory cap against SQLite.
// NARU_REPO_PATH=/path/to/naru-pub node tests/runtime.mjs
// This verifies the interpreter and transactional writes, not deployed auth/R2.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformSync } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";

const repo = process.env.NARU_REPO_PATH;
if (!repo)
  throw new Error("Set NARU_REPO_PATH to the Naru repository being verified.");
const uri = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = (source) =>
  transformSync(source, { loader: "ts", format: "esm" }).code;
const validation = compile(
  await readFile(
    `${repo}/control-plane/src/lib/site-data/validation.ts`,
    "utf8",
  ),
);
const rawRunner = await readFile(`${repo}/edge/src/functions.ts`, "utf8");
assert.ok(
  rawRunner.includes('"../../control-plane/src/lib/site-data/validation"'),
  "Naru runner import changed; update this test's module resolution.",
);
const runner = compile(rawRunner).replace(
  '"../../control-plane/src/lib/site-data/validation"',
  JSON.stringify(uri(validation)),
);
const { runFunction, MAX_WRITES, MAX_OPERATIONS } = await import(uri(runner));
const { DataError } = await import(uri(validation));
const source = await readFile(
  new URL("../_naru/functions/neo-avocado.js", import.meta.url),
  "utf8",
);
const db = new DatabaseSync(":memory:");
db.exec(
  "CREATE TABLE documents (collection TEXT, id TEXT, data TEXT, author TEXT, version INTEGER, PRIMARY KEY(collection, id))",
);
const P = "neo_avocado_";
const ME = "member-me";
let failingDelete = null;
let counts;
const get = (collection, id) => {
  const row = db
    .prepare("SELECT * FROM documents WHERE collection=? AND id=?")
    .get(collection, id);
  return row
    ? {
        id,
        data: JSON.parse(row.data),
        createdBy: row.author,
        revision: `r1.${row.version}`,
      }
    : null;
};
const put = (collection, id, data, author = null) => {
  db.prepare(
    "INSERT INTO documents VALUES (?, ?, ?, ?, 1) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,version=documents.version+1",
  ).run(collection, id, JSON.stringify(data), author);
  return get(collection, id);
};
const host = (operation, args) => {
  counts.operations++;
  if (["add", "set", "delete"].includes(operation)) counts.writes++;
  const [collection, id, data] = args;
  if (operation === "get") return get(collection, id);
  if (operation === "getMany") return id.map((key) => get(collection, key));
  if (operation === "set") return put(collection, id, data);
  if (operation === "add") return put(collection, randomUUID(), id);
  if (operation === "delete") {
    if (id === failingDelete)
      throw new DataError(409, "Injected quota failure", "QUOTA_EXCEEDED");
    db.prepare("DELETE FROM documents WHERE collection=? AND id=?").run(
      collection,
      id,
    );
    return null;
  }
  if (operation === "random") return 0.5;
  if (operation === "list") {
    const options = id;
    const all = db
      .prepare("SELECT id FROM documents WHERE collection=? ORDER BY id")
      .all(collection)
      .map((row) => get(collection, row.id))
      .filter((row) =>
        Object.entries(options.filter ?? {}).every(
          ([key, value]) => row.data[key] === value,
        ),
      );
    const start = Number(options.after ?? 0);
    const documents = all.slice(start, start + (options.size ?? 50));
    const next = start + documents.length;
    return { documents, nextCursor: next < all.length ? String(next) : null };
  }
  throw new Error(`Unknown operation: ${operation}`);
};
async function call(name, args = null, member = ME) {
  const module = await newQuickJSWASMModuleFromVariant(
    newVariant(variant, {
      wasmMemory: () =>
        Promise.resolve(new WebAssembly.Memory({ initial: 256, maximum: 512 })),
    }),
  );
  counts = { operations: 0, writes: 0 };
  db.exec("BEGIN");
  try {
    const result = runFunction(
      module,
      {
        source,
        name,
        args,
        member,
        now: Date.parse("2030-01-01T00:00:00Z"),
      },
      host,
    );
    assert.ok(counts.operations <= MAX_OPERATIONS);
    assert.ok(counts.writes <= MAX_WRITES);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
try {
  put(`${P}characters`, "hero", { name: "Hero" }, ME);
  put(`${P}characters`, "other", { name: "Other" }, "other-member");
  put(`${P}profiles`, ME, { nick: "Tester" }, ME);
  put(`${P}profiles`, "other-member", { nick: "Other" }, "other-member");
  put(`${P}settings`, "community", { initialStatPoints: 10 });
  put(`${P}stat_config`, "hp", { name: "Health", initial: 10, max: 100 });
  put(`${P}levels`, "novice", { name: "Novice", exp: 0 });
  const initial = await call("characterStatus", { character: "hero" });
  assert.equal(initial.rank, "Novice");
  await call("allocateStats", {
    character: "hero",
    allocation: { hp: 5 },
    revision: null,
  });
  const state = get(`${P}character_state`, "hero").data;
  state.stats.hp.current = 5;
  state.stats.hp.damage = 10;
  put(`${P}character_state`, "hero", state);
  put(`${P}items`, "potion", {
    name: "Potion",
    effect: { type: "restore", stat: "hp", amount: 3 },
  });
  put(`${P}inventory`, "potion-a", {
    owner: ME,
    item: "potion",
    name: "Potion",
  });
  assert.equal(
    (await call("useItem", { inventory: "potion-a", character: "hero" }))
      .document.data.stats.hp.current,
    8,
  );
  assert.equal(get(`${P}inventory`, "potion-a"), null);
  const related = await call("relation", {
    character: "hero",
    target: "other",
    affinity: 1,
    memo: "Friend",
  });
  assert.equal(related.document.data.owner, ME);
  const clothing = await call("outfit", {
    character: "hero",
    name: "Coat",
    image: "https://example.com/coat.png",
  });
  assert.equal(
    (await call("wear", { character: "hero", outfit: clothing.document.id }))
      .document.createdBy,
    ME,
  );
  assert.equal(
    (await call("mainCharacter", { character: "hero" })).document.data
      .mainCharacter,
    "hero",
  );
  await call("daily");
  put(`${P}items`, "seed", { name: "Seed", price: 10, stock: 2, sellPrice: 4 });
  const bought = await call("buy", { item: "seed" });
  assert.equal(bought.balance, 90);
  assert.equal(
    (await call("sell", { inventory: bought.owned.id })).balance,
    94,
  );
  put(`${P}items`, "tree", { name: "Tree" });
  put(`${P}gacha`, "global", { item: "tree", weight: 1 });
  assert.equal((await call("gacha")).owned.data.item, "tree");
  put(`${P}items`, "ticket", { name: "Ticket", effect: { type: "draw" } });
  put(`${P}gacha`, "ticket", { source: "ticket", item: null, weight: 1 });
  put(`${P}inventory`, "ticket-a", {
    owner: ME,
    item: "ticket",
    name: "Ticket",
  });
  assert.equal((await call("useItem", { inventory: "ticket-a" })).owned, null);
  put(`${P}inventory`, "material-a", { owner: ME, item: "seed", name: "Seed" });
  put(`${P}inventory`, "material-b", { owner: ME, item: "seed", name: "Seed" });
  put(`${P}recipes`, "recipe", {
    item: "tree",
    cost: 1,
    ingredients: [{ item: "seed", count: 2 }],
  });
  const snapshot = db
    .prepare("SELECT * FROM documents ORDER BY collection,id")
    .all();
  failingDelete = "material-b";
  await assert.rejects(
    call("craft", {
      recipe: "recipe",
      materials: ["material-a", "material-b"],
    }),
    (error) => error.code === "QUOTA_EXCEEDED",
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM documents ORDER BY collection,id").all(),
    snapshot,
  );
  failingDelete = null;
  assert.equal(
    (
      await call("craft", {
        recipe: "recipe",
        materials: ["material-a", "material-b"],
      })
    ).owned.data.item,
    "tree",
  );
  put(`${P}titles`, "winner", { name: "Winner" });
  const official = get(`${P}character_state`, "hero").data;
  official.titles = ["winner"];
  put(`${P}character_state`, "hero", official);
  assert.equal(
    (await call("equipTitle", { character: "hero", title: "winner" })).document
      .data.activeTitle,
    "winner",
  );
  const linked = await call("buy", { item: "seed", character: "hero" });
  assert.equal(linked.owned.data.character, "hero");
  const visibleHistory = await call("history", {
    owner: "other-member",
    size: 20,
  });
  assert.ok(visibleHistory.documents.length > 0);
  assert.ok(visibleHistory.documents.every((row) => row.data.owner === ME));
  const materials = Array.from({ length: 20 }, (_, index) => `bulk-${index}`);
  for (const id of materials)
    put(`${P}inventory`, id, { owner: ME, item: "seed", name: "Seed" });
  put(`${P}recipes`, "bulk-recipe", {
    item: "tree",
    cost: 0,
    ingredients: [{ item: "seed", count: 20 }],
  });
  assert.equal(
    (await call("craft", { recipe: "bulk-recipe", materials })).ok,
    true,
  );
  assert.equal(
    counts.writes,
    23,
    "Twenty-material craft plus payment, output and history fits the production write budget",
  );
  put(`${P}settings`, "community", { initialStatPoints: 10, messageCost: 1 });
  const letter = await call("sendMessage", {
    recipients: ["other-member"],
    body: "private runtime test",
  });
  assert.equal(
    (await call("readMessage", { id: letter.ids[0] }, "stranger")).reason,
    "message_not_found",
  );
  assert.equal(
    (await call("removeMessage", { id: letter.ids[0] }, "stranger")).reason,
    "message_not_found",
  );
  assert.equal(
    (await call("messageStatus", null, "other-member")).unread,
    true,
  );
  assert.equal(
    (await call("readMessage", { id: letter.ids[0] }, "other-member")).document
      .data.body,
    "private runtime test",
  );
  assert.equal(
    (await call("messageStatus", null, "other-member")).unread,
    false,
  );
  const recipients = Array.from({ length: 20 }, (_, i) => `recipient-${i}`);
  for (const id of recipients) put(`${P}profiles`, id, { nick: id });
  put(`${P}wallets`, ME, { balance: 100 });
  assert.equal(
    (await call("sendMessage", { recipients, body: "x".repeat(5000) })).ids
      .length,
    20,
  );
  assert.equal(
    counts.writes,
    22,
    "Bulk mail, charge and private ledger fit the write budget",
  );
  // Legacy admission is inert; production rejects unapproved callers before QuickJS.
  put(`${P}members`, ME, { status: "pending", role: "member" });
  assert.equal((await call("membership")).status, undefined);
  const batch = await call("communityData", {
    collection: `${P}profiles`,
    operation: "getMany",
    options: { ids: [ME, "missing-profile", ME] },
  });
  assert.deepEqual(
    batch.documents.map((row) => row?.id ?? null),
    [ME, null, ME],
  );
  assert.equal(
    (
      await call("communityData", {
        collection: `${P}wallets`,
        operation: "getMany",
        options: { ids: [ME] },
      })
    ).reason,
    "access_denied",
  );
  assert.equal(
    (
      await call("communityData", {
        collection: `${P}profiles`,
        operation: "getMany",
        options: { ids: Array(51).fill(ME) },
      })
    ).reason,
    "invalid_input",
  );
  const gated = await call("communityData", {
    collection: `${P}logs`,
    operation: "add",
    data: {
      image: "https://example.com/log.png",
      text: "gated",
      owner: "forged",
    },
  });
  assert.equal(gated.document.data.owner, ME);
  assert.equal(gated.document.createdBy, null);
  for (let i = 0; i < 8; i++)
    put(`${P}comments`, `gated-comment-${i}`, {
      owner: "other-member",
      logId: gated.document.id,
      text: "reply",
    });
  assert.equal(
    (
      await call("communityData", {
        collection: `${P}logs`,
        operation: "delete",
        id: gated.document.id,
      })
    ).done,
    false,
  );
  assert.equal(get(`${P}logs`, gated.document.id).data.deleted, true);
  assert.ok(counts.writes <= MAX_WRITES);
  assert.equal(
    (
      await call("communityData", {
        collection: `${P}logs`,
        operation: "delete",
        id: gated.document.id,
      })
    ).done,
    true,
  );
  assert.equal(get(`${P}logs`, gated.document.id), null);
  put(`${P}characters`, "large-cleanup", { owner: ME, name: "Cleanup" });
  for (let i = 0; i < 12; i++) {
    put(`${P}relations`, `cleanup-relation-${i}`, {
      character: "large-cleanup",
      target: "other",
    });
    put(`${P}wardrobe`, `cleanup-outfit-${i}`, { character: "large-cleanup" });
    put(`${P}inventory`, `cleanup-item-${i}`, {
      owner: ME,
      character: "large-cleanup",
      item: "sword",
    });
    put(`${P}couples`, `cleanup-couple-${i}`, {
      first: "large-cleanup",
      second: "other",
    });
  }
  let completed = false;
  for (let i = 0; !completed && i < 20; i++) {
    completed = (
      await call("communityData", {
        collection: `${P}characters`,
        operation: "delete",
        id: "large-cleanup",
      })
    ).done;
    assert.ok(counts.writes <= MAX_WRITES);
  }
  assert.equal(completed, true);
  for (let i = 0; i < 12; i++) {
    assert.equal(get(`${P}couples`, `cleanup-couple-${i}`), null);
    assert.equal(
      get(`${P}inventory`, `cleanup-item-${i}`).data.character,
      null,
    );
  }
  put(`${P}members`, ME, { status: "banned", role: "moderator" });
  assert.equal((await call("messageStatus")).ok, true);
  assert.equal((await call("join", { nick: "Platform approved" })).ok, true);
  // Managed portraits and ten wardrobe assets exercise the 25-write cascade budget.
  const assetId = (n) =>
    `0190f1a2-0000-7000-8000-${String(n).padStart(12, "0")}`;
  put(`${P}characters`, "media-cascade", {
    owner: ME,
    name: "Media",
    image: "https://example.com/portrait.png",
    imageId: assetId(1),
  });
  put(`${P}media_assets`, assetId(1), {
    owner: ME,
    url: "https://example.com/portrait.png",
    refs: [`${P}characters/media-cascade`],
    cleanup: false,
    status: "active",
  });
  for (let n = 2; n <= 11; n++) {
    const id = `media-outfit-${n}`;
    put(`${P}wardrobe`, id, {
      owner: ME,
      character: "media-cascade",
      imageId: assetId(n),
    });
    put(`${P}media_assets`, assetId(n), {
      owner: ME,
      refs: [`${P}wardrobe/${id}`],
      cleanup: false,
      status: "active",
    });
  }
  let mediaDone = false;
  for (let attempt = 0; !mediaDone && attempt < 5; attempt++) {
    mediaDone = (
      await call("communityData", {
        collection: `${P}characters`,
        operation: "delete",
        id: "media-cascade",
      })
    ).done;
    assert.ok(counts.writes <= MAX_WRITES);
  }
  assert.equal(mediaDone, true);
  for (let n = 1; n <= 11; n++)
    assert.equal(get(`${P}media_assets`, assetId(n)).data.cleanup, true);
  console.log(
    "Actual Naru runner + QuickJS + SQLite checks passed, including rollback after partial writes.",
  );
} finally {
  db.close();
}
