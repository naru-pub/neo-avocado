// The site on a local Naru: naru-dev runs the real edge Worker (documents,
// rules, functions, limits) and stands in for naru.pub. Nothing here imitates
// Naru; a real Chromium drives the real pages.
//
//   NARU_REPO_PATH=/path/to/naru PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
//     node tests/e2e.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = process.env.NARU_REPO_PATH;
if (!repo) throw new Error("Set NARU_REPO_PATH to a Naru checkout.");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const site = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.E2E_PORT ?? 4300);
const origin = `http://localhost:${port}`;
const state = await mkdtemp(join(tmpdir(), "neo-avocado-e2e-"));
const P = "neo_avocado_";

const naru = spawn(
  "pnpm",
  [
    "naru-dev",
    site,
    "--site",
    "neo-avocado",
    "--port",
    String(port),
    "--state",
    state,
  ],
  {
    cwd: join(repo, "control-plane"),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
naru.stdout.on("data", (chunk) => (log += chunk));
naru.stderr.on("data", (chunk) => (log += chunk));
for (let tries = 0; !log.includes("naru-dev: neo-avocado"); tries++) {
  if (tries > 600) throw new Error(`naru-dev did not start:\n${log}`);
  await new Promise((done) => setTimeout(done, 200));
}

const browser = await chromium.launch();
const errors = [];
/** A browser of its own for each person, as on their own device. */
async function person() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}
async function signInAs(page, name) {
  await page.goto(`${origin}/`);
  await page.locator("#signIn").click();
  await page.waitForURL(/members\/sign-in/);
  await page.locator("input[name=as]:not([type=hidden])").fill(name);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(`${origin}/`);
}
async function joinAs(page, nick) {
  await page.locator("#nick").fill(nick);
  await page.locator("#profileForm button").click();
  await page.locator("#community").waitFor();
  // Uploads load through naru-dev's service worker once it controls the page.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.locator("#community").waitFor();
}
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNk+M8ABIwMDP8ZGBgYAAAhCAMBaVPDaAAAAABJRU5ErkJggg==",
  "base64",
);
const picture = (name) => ({ name, mimeType: "image/png", buffer: PNG });

try {
  // _naru/collections.json made every collection as the site started, so
  // the owner's sign-in only signs in.
  assert.match(log, /_naru\/collections\.json: 31 created, 0 changed/);
  const owner = await person();
  await owner.goto(`${origin}/admin.html`);
  await owner.locator("#adminSignIn").click();
  await owner.locator("#adminWorkspace").waitFor();
  assert.match(log, /owner signed in: \d+ collections, 0 created/);
  // Setup through the owner's own SDK handle: a public board and fields.
  await owner.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    await admin.collection(`${P}boards`).set("free", {
      name: "자유",
      kind: "text",
      enabled: true,
      listLevel: 1,
      readLevel: 1,
      writeLevel: 1,
      commentLevel: 1,
      secret: "optional",
      categories: [],
    });
    for (const [code, data] of [
      ["age", { label: "나이", type: "text", visibility: "public", order: 1 }],
      [
        "diary",
        { label: "일기", type: "textarea", visibility: "owner", order: 2 },
      ],
      ["art", { label: "전신", type: "image", visibility: "public", order: 3 }],
    ])
      await admin.collection(`${P}character_fields`).set(code, data);
  }, P);

  // An image field in the admin forms takes a file: it goes to Naru Media
  // as a managed upload and its address is what the row keeps.
  await owner.locator("#adminSection").selectOption("emoticons");
  await owner.locator("#adminNew").click();
  await owner.locator('#adminFields [name="id"]').fill("smile");
  await owner.locator('#adminFields [name="name"]').fill("웃음");
  await owner
    .locator('#adminFields [data-upload-for="image"]')
    .setInputFiles(picture("smile.png"));
  await owner.locator('#adminForm [type="submit"]').click();
  await owner.waitForFunction(
    () =>
      document.querySelector("#adminForm").hidden ||
      /[^…]$/.test(document.querySelector("#adminFormStatus").textContent),
  );
  assert.equal(await owner.locator("#adminFormStatus").textContent(), "");
  const smile = await owner.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    return (await admin.collection(`${P}emoticons`).get("smile")).data.image;
  }, P);
  assert.match(smile, /^https:\/\/media\.naru\.pub\/1\//);
  assert.equal(
    (await fetch(`${origin}/media/${new URL(smile).pathname.slice(1)}`)).status,
    200,
  );

  // Alice joins, makes a character with an owner-only field and an image
  // field, and posts a log with a picture and a tag.
  const alice = await person();
  await signInAs(alice, "alice");
  await joinAs(alice, "앨리스");
  await alice.locator("#tabCharacters").click();
  await alice.locator('#characterFields [data-field="age"]').waitFor();
  await alice.locator("#characterName").fill("초록");
  await alice.locator('#characterFields [data-field="age"]').fill("17");
  await alice
    .locator('#characterFields [data-field="diary"]')
    .fill("비밀 일기");
  await alice
    .locator('#characterFields [data-field-upload="art"]')
    .setInputFiles(picture("art.png"));
  await alice.locator('#characterForm [type="submit"]').click();
  await alice
    .locator("#characters .character")
    .filter({ hasText: "초록" })
    .waitFor();
  await alice.locator("#tabLogs").click();
  await alice.locator("#logImage").setInputFiles(picture("log.png"));
  await alice.locator("#logText").fill("첫 로그 #봄");
  await alice.locator('#logForm [type="submit"]').click();
  const post = alice.locator("#logs .log").filter({ hasText: "첫 로그" });
  await post.waitFor();
  assert.equal(await post.locator(".log-number").textContent(), "No. 1");
  await alice.waitForFunction(
    () => document.querySelector("#logs .log img.log-image")?.naturalWidth > 0,
  );
  const logPicture = await post.locator("img.log-image").getAttribute("src");
  assert.match(logPicture, /^https:\/\/media\.naru\.pub\/1\//);
  // #tag searches with `has`.
  await post.locator(".hash-tag").click();
  await alice.locator("#tagFilter").waitFor();
  assert.equal(await alice.locator("#logs .log").count(), 1);
  await alice.locator("#clearTag").click();

  // Bob sees Alice's character natively, without her owner-only field.
  const bob = await person();
  await signInAs(bob, "bob");
  await joinAs(bob, "밥");
  await bob.locator("#tabCharacters").click();
  const sheet = bob
    .locator("#characters .character")
    .filter({ hasText: "초록" });
  await sheet.waitFor();
  await sheet.locator(".character-details summary").click();
  await sheet.locator(".character-fields").filter({ hasText: "17" }).waitFor();
  assert.doesNotMatch(await sheet.textContent(), /비밀 일기/);
  // Alice still sees her own.
  await alice.locator("#tabCharacters").click();
  const own = alice
    .locator("#characters .character")
    .filter({ hasText: "초록" });
  await own.locator(".character-details summary").click();
  await own
    .locator(".character-fields")
    .filter({ hasText: "비밀 일기" })
    .waitFor();

  // Bob calls Alice in a comment; her live connection marks the call.
  await bob.locator("#tabLogs").click();
  const thread = bob.locator("#logs .log").filter({ hasText: "첫 로그" });
  await thread.locator(".comments > summary").click();
  await thread.locator(".comment-text").fill("[[앨리스]] 멋져요");
  await thread.locator('.comment-form [type="submit"]').click();
  await thread.locator(".comment-list .member-call").waitFor();
  await alice.waitForFunction(() =>
    document.querySelector("#tabCalls").textContent.includes("새 알림"),
  );

  // The shop runs in site functions with the real write budget.
  await bob.locator("#tabShop").click();
  await bob.locator("#daily").click();
  await bob.waitForFunction(
    () => document.querySelector("#balance").textContent === "100",
  );
  // A second claim is refused by the function's ctx.fail, in its own words,
  // and the balance stays.
  await bob.locator("#daily").click();
  await bob.waitForFunction(
    () =>
      document.querySelector("#status").textContent ===
      "오늘은 이미 받았습니다.",
  );
  assert.equal(await bob.locator("#balance").textContent(), "100");

  // Deleting the post deletes its picture too (a managed upload).
  const file = logPicture.split("/").pop();
  assert.equal((await fetch(`${origin}/media/1/${file}`)).status, 200);
  await alice.locator("#tabLogs").click();
  await alice
    .locator("#logs .log")
    .filter({ hasText: "첫 로그" })
    .locator(".delete")
    .click();
  await alice
    .locator("#logs .log")
    .filter({ hasText: "첫 로그" })
    .waitFor({ state: "detached" });
  for (
    let tries = 0;
    (await fetch(`${origin}/media/1/${file}`)).status !== 404;
    tries++
  ) {
    if (tries > 50)
      throw new Error("The deleted post's picture was not deleted.");
    await new Promise((done) => setTimeout(done, 200));
  }

  // A visitor posts on the public board, and edits with the password only.
  const guest = await person();
  await guest.goto(`${origin}/`);
  await guest.waitForFunction(() =>
    [...document.querySelectorAll("#board option")].some(
      (o) => o.value === "free",
    ),
  );
  await guest.locator("#board").selectOption("free");
  await guest.locator("#guestName").fill("길손");
  await guest.locator("#guestPassword").fill("pass1234");
  await guest.locator("#logText").fill("손님 글");
  await guest.locator('#logForm [type="submit"]').click();
  const guestPost = guest.locator("#logs .log").filter({ hasText: "손님 글" });
  await guestPost.waitFor();
  await guestPost.locator(".edit").click();
  await guest.locator('#editorFields [name="password"]').fill("wrong");
  await guest.locator('#editorFields [name="text"]').fill("고친 손님 글");
  await guest.locator('#editorForm [type="submit"]').click();
  await guest
    .locator("#editorStatus")
    .filter({ hasText: "비밀번호" })
    .waitFor();
  await guest.locator('#editorFields [name="password"]').fill("pass1234");
  await guest.locator('#editorForm [type="submit"]').click();
  await guest
    .locator("#logs .log")
    .filter({ hasText: "고친 손님 글" })
    .waitFor();

  // The collection rules, on the real runtime: a member reads their own
  // wallet and nobody else's; a visitor reads nicknames and no wallets.
  const reads = (page, P) =>
    page.evaluate(async (P) => {
      const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
      const naru = createNaru();
      const member = await naru.members.session();
      const reader = member ?? naru;
      const settle = (promise) =>
        promise.then(
          (value) => value,
          (error) => error.code,
        );
      return {
        wallets: await settle(
          reader
            .collection(`${P}wallets`)
            .list()
            .then((page) => page.documents.map((row) => row.id)),
        ),
        profiles: await settle(
          reader
            .collection(`${P}profiles`)
            .list()
            .then((page) => page.documents.map((row) => Object.keys(row.data))),
        ),
        me: member?.id ?? null,
      };
    }, P);
  const bobReads = await reads(bob, P);
  assert.deepEqual(bobReads.wallets, [bobReads.me]);
  assert.ok(bobReads.profiles.some((keys) => keys.includes("acceptMessages")));
  const guestReads = await reads(guest, P);
  assert.equal(guestReads.wallets, "ACCESS_DENIED");
  assert.ok(guestReads.profiles.every((keys) => keys.join() === "nick"));

  assert.deepEqual(errors, []);
  console.log("neo-avocado on naru-dev: every flow passed.");
} catch (error) {
  console.error(log.split("\n").slice(-30).join("\n"));
  throw error;
} finally {
  await browser.close();
  try {
    process.kill(-naru.pid);
  } catch {
    /* already gone */
  }
  await rm(state, { recursive: true, force: true });
}
