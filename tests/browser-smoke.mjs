// A real Chromium page and the actual SDK, with a synthetic HTTP boundary.
// This is not evidence of deployed Naru authentication, R2, or QuickJS behavior.
// NARU_SDK_PATH=/path/to/naru.js PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
// node tests/browser-smoke.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import * as rules from "../_naru/functions/neo-avocado.js";

if (!process.env.NARU_SDK_PATH)
  throw new Error("Set NARU_SDK_PATH to the actual SDK 1.1.0 naru.js.");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const sdk = await readFile(process.env.NARU_SDK_PATH, "utf8");
const root = new URL("../", import.meta.url);
const P = "neo_avocado_";
const ME = "member-me";
let serial = 0;
const memberCallBuckets = new Map();
const memberReadBuckets = new Map();
const tables = new Map();
const table = (name) => {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
};
function write(name, id, data, author = null) {
  const old = table(name).get(id);
  const now = new Date().toISOString();
  const row = {
    id,
    data,
    createdBy: old?.createdBy ?? author,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    revision: `r1.${++serial}`,
  };
  table(name).set(id, row);
  return row;
}
write(`${P}profiles`, ME, { nick: "테스트 회원" }, ME);
write(`${P}profiles`, "member-other", { nick: "친구" }, "member-other");
write(
  `${P}characters`,
  "character-me",
  {
    name: "초록",
    side: "숲",
    profile: "테스트 캐릭터",
    image: "https://media.naru.pub/portrait.svg",
  },
  ME,
);
write(
  `${P}characters`,
  "character-other",
  { name: "노랑", image: "https://media.naru.pub/portrait.svg" },
  "member-other",
);
write(
  `${P}logs`,
  "log-me",
  { image: "https://media.naru.pub/log.svg", text: "첫 로그" },
  ME,
);
write(`${P}wallets`, ME, { balance: 100 });
write(`${P}items`, "seed", { name: "씨앗", price: 10, sellPrice: 5 });
write(`${P}items`, "tree", { name: "나무", price: 50 });
write(`${P}items`, "potion", {
  name: "회복약",
  effect: { type: "restore", stat: "hp", amount: 3 },
});
write(`${P}inventory`, "potion-a", {
  owner: ME,
  item: "potion",
  name: "회복약",
});
write(`${P}settings`, "community", { initialStatPoints: 5 });
write(`${P}stat_config`, "hp", { name: "체력", initial: 10, max: 20 });
write(`${P}character_state`, "character-me", {
  owner: ME,
  character: "character-me",
  points: 5,
  exp: 0,
  stats: { hp: { allocated: 0, max: 10, current: 3, damage: 7 } },
  titles: [],
});
write(`${P}levels`, "novice", { name: "초보", exp: 0 });
for (const row of table(`${P}logs`).values()) row.data.board = "default";
write(`${P}inventory`, "seed-a", { owner: ME, item: "seed", name: "씨앗" });
write(`${P}inventory`, "seed-b", { owner: ME, item: "seed", name: "씨앗" });
write(`${P}recipes`, "tree-recipe", {
  name: "나무 만들기",
  item: "tree",
  cost: 20,
  ingredients: [{ item: "seed", count: 2 }],
});
const list = (name, options = {}) => {
  const rows = [...table(name).values()].filter((row) =>
    Object.entries(options.filter ?? {}).every(
      ([key, value]) => row.data[key] === value,
    ),
  );
  for (const [field, direction] of [...(options.sort ?? [])].reverse()) {
    const value = (row) =>
      typeof field === "string" ? row.data[field] : row[field.metadata];
    rows.sort(
      (a, b) =>
        (value(a) < value(b)
          ? -1
          : value(a) > value(b)
            ? 1
            : a.id.localeCompare(b.id)) * (direction === "desc" ? -1 : 1),
    );
  }
  const start = Number(options.after ?? 0);
  const documents = rows.slice(start, start + (options.size ?? 50));
  const next = start + documents.length;
  return { documents, nextCursor: next < rows.length ? String(next) : null };
};
const ctx = {
  member: { id: ME },
  now: Date.now(),
  random: () => 0.5,
  get: (name, id) => table(name).get(id) ?? null,
  list,
  set: (name, id, data) => write(name, id, data),
  add: (name, data) => write(name, `generated-${++serial}`, data),
  delete: (name, id) => {
    table(name).delete(id);
    return null;
  },
};

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const files = {
      "/": "index.html",
      "/index.html": "index.html",
      "/app.js": "app.js",
      "/admin.html": "admin.html",
      "/admin.js": "admin.js",
      "/admin-model.js": "admin-model.js",
      "/admin-cleanup.js": "admin-cleanup.js",
      "/style.css": "style.css",
    };
    if (path === "/config.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end('export const config = { site: "neo-avocado" };');
      return;
    }
    if (!files[path]) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(await readFile(new URL(files[path], root)));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    timeout: 30000,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("https://naru.pub/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    };
    if (url.pathname === "/sdk/1.1.0/naru.js")
      return route.fulfill({
        contentType: "text/javascript",
        headers,
        body: sdk,
      });
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    const isOwner =
      request.headers().authorization === `Bearer ${"t".repeat(43)}`;
    assert.ok(
      isOwner ||
        request.headers().authorization === `Bearer m.${"x".repeat(43)}` ||
        request.headers().authorization === `Bearer m.${"y".repeat(43)}`,
    );
    const parts = url.pathname.split("/").slice(5);
    ctx.member.id =
      request.headers().authorization === `Bearer m.${"y".repeat(43)}`
        ? "member-other"
        : ME;
    let result;
    if (parts[0] === "_batch") {
      assert.equal(isOwner, true);
      const operations = request.postDataJSON().operations;
      const conflict = operations.some((operation) => {
        const previous = ctx.get(operation.collection, operation.id);
        return operation.condition?.absent
          ? Boolean(previous)
          : operation.condition?.revision
            ? previous?.revision !== operation.condition.revision
            : false;
      });
      if (conflict)
        return route.fulfill({
          status: 409,
          headers,
          json: { error: { code: "CONFLICT", message: "Batch conflict" } },
        });
      result = {
        results: operations.map((operation) =>
          operation.type === "set"
            ? write(operation.collection, operation.id, operation.data)
            : (table(operation.collection).delete(operation.id), null),
        ),
      };
    } else if (["_call", "_read"].includes(parts[0])) {
      const key = `${ctx.member.id}:${Math.floor(Date.now() / 60000)}`;
      const readonly = parts[0] === "_read";
      const buckets = readonly ? memberReadBuckets : memberCallBuckets;
      const count = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, count);
      if (count > (readonly ? 120 : 30))
        return route.fulfill({
          status: 429,
          headers,
          json: {
            error: {
              code: "RATE_LIMITED",
              message: "Member function rate limit reached",
            },
          },
        });
      const snapshot = structuredClone(tables);
      try {
        let violation = false;
        const forbid = () => {
          violation = true;
          throw new Error("read-only functions cannot write");
        };
        const functionCtx = readonly
          ? { ...ctx, add: forbid, set: forbid, delete: forbid }
          : ctx;
        result = {
          result: rules[parts[2]](functionCtx, request.postDataJSON().args),
        };
        if (violation) throw new Error("read-only functions cannot write");
      } catch (error) {
        tables.clear();
        for (const [name, rows] of snapshot) tables.set(name, rows);
        return route.fulfill({
          status: 400,
          headers,
          json: { error: { code: "INVALID_REQUEST", message: error.message } },
        });
      }
    } else {
      const [name, id] = parts;
      if (!isOwner)
        return route.fulfill({
          status: 403,
          headers,
          json: {
            error: { code: "ACCESS_DENIED", message: "Private history" },
          },
        });
      if (request.method() === "GET" && !id)
        result = list(name, {
          filter: JSON.parse(url.searchParams.get("filter") ?? "null"),
          sort: JSON.parse(url.searchParams.get("sort") ?? "null"),
          size: Number(url.searchParams.get("size") ?? 50),
          after: url.searchParams.get("after"),
        });
      else if (request.method() === "GET") {
        const document = ctx.get(name, id);
        if (!document)
          return route.fulfill({
            status: 404,
            headers,
            json: { error: { code: "NOT_FOUND", message: "Missing document" } },
          });
        result = { document };
      } else if (request.method() === "PUT") {
        if (
          url.searchParams.has("ifAbsent")
            ? Boolean(ctx.get(name, id))
            : url.searchParams.get("ifRevision") !== ctx.get(name, id)?.revision
        )
          return route.fulfill({
            status: 409,
            headers,
            json: { error: { code: "CONFLICT", message: "Changed" } },
          });
        result = write(name, id, request.postDataJSON().data, ME);
      } else throw new Error(`Unexpected ${request.method()} ${url.pathname}`);
    }
    return route.fulfill({ headers, json: result });
  });
  await page.route("https://media.naru.pub/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#568203"/></svg>',
    }),
  );
  await page.addInitScript(
    ({ member, token }) => {
      const other =
        new URLSearchParams(location.search).get("member") === "other";
      localStorage.setItem(
        "naru:member:https://naru.pub:neo-avocado",
        JSON.stringify({
          memberId: other ? "member-other" : member,
          accessToken: other ? `m.${"y".repeat(43)}` : token,
          expiresAt: Date.now() + 600000,
        }),
      );
    },
    { member: ME, token: `m.${"x".repeat(43)}` },
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator("#logs .log").waitFor();
  await page.locator("#logs .edit").click();
  await page.locator('#editor [name="text"]').fill("브라우저 확인");
  await page.locator('#editor [type="submit"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".log-text").textContent(), "브라우저 확인");
  await page.locator("#tabShop").click();
  await page.locator("#inventory .material").first().waitFor();
  await page
    .locator("#inventory li")
    .filter({ hasText: "회복약" })
    .getByRole("button", { name: "사용", exact: true })
    .click();
  await page.locator('#editor [type="submit"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert.equal(
    table(`${P}character_state`).get("character-me").data.stats.hp.current,
    6,
  );
  assert.equal(table(`${P}inventory`).has("potion-a"), false);
  await page.locator("#inventory .material").nth(0).check();
  await page.locator("#inventory .material").nth(1).check();
  await page.locator('#craftForm [type="submit"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("나무을(를)"),
  );
  await page.waitForFunction(
    () => document.querySelector("#balance").textContent === "80",
  );
  assert.equal(table(`${P}inventory`).size, 1);
  await page.locator("#tabCharacters").click();
  await page.locator("#characters .character").first().waitFor();
  const character = page
    .locator(".character")
    .filter({ has: page.locator(".character-name", { hasText: "초록" }) });
  await character.locator(".character-details summary").click();
  await character.locator(".allocate-stats").waitFor({ state: "visible" });
  assert.match(
    await character.locator(".stats").textContent(),
    /체력: 6 \/ 10/,
  );
  await character.locator(".allocate-stats").click();
  await page.locator('#editor [name="hp"]').fill("5");
  await page.locator('#editor [type="submit"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert.match(
    await character.locator(".stats").textContent(),
    /체력: 11 \/ 15/,
  );
  await character.locator(".add-relation").click();
  await page.locator('#editor [name="memo"]').fill("친구");
  await page.locator('#editor [type="submit"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert.match(
    await character.locator(".relations").textContent(),
    /노랑.*친구/,
  );
  await character.locator(".add-outfit").click();
  await page.locator('#editor [name="name"]').fill("외출복");
  await page
    .locator('#editor [name="image"]')
    .fill("https://media.naru.pub/outfit.svg");
  await page.locator('#editor [type="submit"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await character
    .locator(".wardrobe")
    .getByRole("button", { name: "사용", exact: true })
    .click();
  await character
    .locator(".wardrobe")
    .getByRole("button", { name: "사용 중", exact: true })
    .waitFor();
  assert.equal(
    await character.locator(".character-image").getAttribute("src"),
    "https://media.naru.pub/outfit.svg",
  );
  await page.locator("#tabShop").click();
  await page.locator("#inventoryCharacter").selectOption("character-me");
  await page.waitForFunction(
    () => document.querySelector("#inventory").children.length === 0,
  );
  await page
    .locator("#items li")
    .filter({ hasText: "씨앗" })
    .getByRole("button", { name: "사기", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#inventory").textContent.includes("씨앗"),
  );
  assert.ok(
    [...table(`${P}inventory`).values()].some(
      (row) =>
        row.data.item === "seed" && row.data.character === "character-me",
    ),
  );
  await page.locator("#historyPanel summary").click();
  await page.locator("#history li").first().waitFor();
  assert.match(await page.locator("#history").textContent(), /구매/);
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
  await page.locator("#adminSignIn").waitFor();
  assert.equal(await page.locator("#adminWorkspace").isVisible(), false);
  await page.addInitScript(() =>
    sessionStorage.setItem(
      `naru:owner:https://naru.pub:neo-avocado:${location.origin}${location.pathname}`,
      JSON.stringify({
        accessToken: "t".repeat(43),
        expiresAt: Date.now() + 600000,
      }),
    ),
  );
  await page.reload();
  await page.locator("#adminWorkspace").waitFor({ state: "visible" });
  await page.locator("#adminNew").click();
  await page.locator('#adminFields [name="id"]').fill("pair");
  await page
    .locator('#adminFields [name="first"]')
    .selectOption("character-me");
  await page
    .locator('#adminFields [name="second"]')
    .selectOption("character-other");
  await page.locator('#adminFields [name="since"]').fill("2030-01-01");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  assert.equal(table(`${P}couples`).get("pair").data.first, "character-me");
  await page.locator("#adminSection").selectOption("titles");
  await page.locator("#adminNew").click();
  await page.locator('#adminFields [name="id"]').fill("winner");
  await page.locator('#adminFields [name="name"]').fill("우승자");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  await page.locator("#adminSection").selectOption("character_state");
  await page
    .locator("#adminRows li")
    .filter({ hasText: "초록" })
    .getByRole("button", { name: "수정" })
    .click();
  await page.locator('#adminFields [name="approved"]').check();
  await page.locator('#adminFields [name="titles"]').selectOption("winner");
  await page.locator('#adminFields [name="exp"]').fill("100");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  assert.equal(
    table(`${P}character_state`).get("character-me").data.approved,
    true,
  );
  await page.locator("#adminSection").selectOption("items");
  await page.locator("#adminNew").click();
  await page.locator('#adminFields [name="id"]').fill("herb");
  await page.locator('#adminFields [name="name"]').fill("허브");
  await page.locator('#adminFields [name="price"]').fill("8");
  await page.locator('#adminFields [name="stock"]').fill("5");
  await page
    .locator('#adminFields [name="effect.type"]')
    .selectOption("restore");
  await page.locator('#adminFields [name="effect.stat"]').selectOption("hp");
  await page.locator('#adminFields [name="effect.amount"]').fill("2");
  await page.locator('#adminFields [name="useRequirements.approved"]').check();
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  assert.equal(table(`${P}items`).get("herb").data.effect.amount, 2);
  await page.locator("#adminSection").selectOption("gacha");
  await page.locator("#adminNew").click();
  await page.locator('#adminFields [name="id"]').fill("herb-draw");
  await page.locator('#adminFields [name="item"]').selectOption("herb");
  await page.locator('#adminFields [name="weight"]').fill("0.5");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  await page.locator("#adminSection").selectOption("recipes");
  await page.locator("#adminNew").click();
  await page.locator('#adminFields [name="id"]').fill("herb-recipe");
  await page.locator('#adminFields [name="name"]').fill("허브 제작");
  await page.locator('#adminFields [name="item"]').selectOption("herb");
  await page
    .locator('[data-ingredients="ingredients"]')
    .getByRole("button", { name: "재료 추가" })
    .click();
  await page.locator(".ingredient-item").selectOption("seed");
  await page.locator(".ingredient-count").fill("2");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  assert.deepEqual(table(`${P}recipes`).get("herb-recipe").data.ingredients, [
    { item: "seed", count: 2 },
  ]);
  await page.locator("#adminSection").selectOption("wallets");
  await page
    .locator("#adminRows li")
    .filter({ hasText: "테스트 회원" })
    .getByRole("button", { name: "수정", exact: true })
    .click();
  const previousBalance = table(`${P}wallets`).get(ME).data.balance;
  await page.locator('#adminFields [name="balance"]').fill("200");
  await page.locator('#adminFields [name="note"]').fill("브라우저 보상 확인");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  assert.equal(table(`${P}wallets`).get(ME).data.balance, 200);
  assert.ok(
    [...table(`${P}history`).values()].some(
      (row) =>
        row.data.kind === "adjust" &&
        row.data.delta === 200 - previousBalance &&
        row.data.memo === "브라우저 보상 확인",
    ),
  );
  await page.locator("#adminSection").selectOption("inventory");
  await page.locator("#adminNew").click();
  await page.locator('#adminFields [name="id"]').fill("reward-herb");
  await page.locator('#adminFields [name="owner"]').selectOption(ME);
  await page
    .locator('#adminFields [name="character"]')
    .selectOption("character-me");
  await page.locator('#adminFields [name="item"]').selectOption("herb");
  await page.locator('#adminFields [name="memo"]').fill("출석 보상");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  assert.equal(table(`${P}inventory`).get("reward-herb").data.name, "허브");
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator("#tabCharacters").click();
  const updated = page
    .locator(".character")
    .filter({ has: page.locator(".character-name", { hasText: "초록" }) });
  await updated.locator(".character-details summary").click();
  await updated.locator(".title-choice").waitFor({ state: "visible" });
  await updated.locator(".title-choice").selectOption("winner");
  await updated
    .locator(".titles")
    .getByText("우승자 (표시 중)", { exact: true })
    .waitFor();
  assert.match(
    await updated.locator(".couples").textContent(),
    /노랑.*2030-01-01/,
  );
  await page.locator("#tabMessages").click();
  await page.locator("#messageRecipients").selectOption("member-other");
  await page
    .locator("#messageBody")
    .fill("브라우저 비밀 쪽지 <script>throw Error('must not run')</script>");
  await page.locator('#messageForm [type="submit"]').click();
  await page.locator("#messages li").first().waitFor();
  assert.equal(
    [...table(`${P}messages`).values()].filter(
      (row) => row.data.from === ME && row.data.to === "member-other",
    ).length,
    1,
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/?member=other`);
  await page.locator("#tabMessages").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document.querySelector("#tabMessages").textContent.includes("새 쪽지"),
  );
  await page.locator("#tabMessages").click();
  await page.locator("#messages li button").first().click();
  await page.locator("#messageDetail").waitFor({ state: "visible" });
  assert.match(
    await page.locator(".message-body").textContent(),
    /<script>throw/,
  );
  assert.ok(
    [...table(`${P}messages`).values()].every(
      (row) => row.data.readAt !== null,
    ),
  );
  assert.equal(await page.locator("#tabMessages").textContent(), "쪽지");
  await page
    .locator("#messageDetail")
    .getByRole("button", { name: "답장", exact: true })
    .click();
  assert.deepEqual(
    await page
      .locator("#messageRecipients")
      .evaluate((select) =>
        [...select.selectedOptions].map((option) => option.value),
      ),
    [ME],
  );
  await page
    .locator("#messageDetail")
    .getByRole("button", { name: "쪽지 삭제", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#messages").children.length === 0,
  );
  assert.equal(table(`${P}messages`).size, 0);
  await page.locator("#tabLogs").click();
  write(`${P}messages`, "live-notice", {
    from: ME,
    to: "member-other",
    body: "폴링 확인",
    sentAt: Date.now(),
    readAt: null,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#tabMessages").textContent.includes("새 쪽지"),
    null,
    { timeout: 15000 },
  );
  write(`${P}members`, "member-other", { status: "banned", role: "member" });
  await page.locator("#tabShop").click();
  await page.locator("#admissionPanel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#community").isVisible(), false);
  assert.equal(
    await page.locator("#admissionTitle").textContent(),
    "접근 차단",
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
  await page.locator("#adminWorkspace").waitFor({ state: "visible" });
  await page.locator("#adminSection").selectOption("members");
  await page
    .locator("#adminRows li")
    .filter({ hasText: "친구" })
    .getByRole("button", { name: "수정", exact: true })
    .click();
  await page.locator('#adminFields [name="status"]').selectOption("approved");
  await page.locator('#adminForm [type="submit"]').click();
  await page.locator("#adminForm").waitFor({ state: "hidden" });
  write(`${P}characters`, "cleanup-character", {
    owner: ME,
    name: "중단된 캐릭터",
    deleted: true,
  });
  for (let i = 0; i < 12; i++) {
    write(`${P}inventory`, `cleanup-item-${i}`, {
      owner: ME,
      character: "cleanup-character",
      item: "recovery",
      memo: "보존",
    });
    write(`${P}couples`, `cleanup-couple-${i}`, {
      first: "cleanup-character",
      second: "character-other",
    });
  }
  await page.locator("#adminSection").selectOption("character_cleanup");
  for (
    let i = 0;
    table(`${P}characters`).has("cleanup-character") && i < 10;
    i++
  ) {
    await page.getByRole("button", { name: "정리 계속", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("#adminStatus").textContent.includes("정리"),
    );
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("#adminRows button")].some(
          (button) => button.disabled,
        ),
    );
  }
  assert.equal(table(`${P}characters`).has("cleanup-character"), false);
  assert.equal(
    [...table(`${P}couples`).values()].filter(
      (row) => row.data.first === "cleanup-character",
    ).length,
    0,
  );
  for (let i = 0; i < 12; i++)
    assert.deepEqual(table(`${P}inventory`).get(`cleanup-item-${i}`).data, {
      owner: ME,
      character: null,
      item: "recovery",
      memo: "보존",
    });
  await page.goto(`http://127.0.0.1:${server.address().port}/?member=other`);
  await page.locator("#community").waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
  const screenshot =
    process.env.NARU_SCREENSHOT_PATH ?? "/tmp/neo-avocado-browser.png";
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`Actual SDK browser smoke passed; screenshot: ${screenshot}`);
  console.log(
    `Peak member mutations: ${Math.max(...memberCallBuckets.values())}/30; reads: ${Math.max(...memberReadBuckets.values())}/120 per fixed minute. Fixture enforces both limits.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
