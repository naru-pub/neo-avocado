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
/** Opens a page from the site menu, as a member would. */
const menu = (page, name) =>
  page.locator("#siteMenu a", { hasText: name }).first().click();
/** Opens an admin section from the side menu, opening its group first. */
async function adminMenu(page, group, label) {
  const details = page.locator("#adminNav details", {
    has: page.locator("summary", { hasText: group }),
  });
  if (!(await details.evaluate((element) => element.open)))
    await details.locator("summary").click();
  await details.locator("a", { hasText: label }).first().click();
}
async function signInAs(page, name) {
  await page.goto(`${origin}/`);
  await page.locator("#cardSignIn").click();
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
  assert.match(log, /_naru\/collections\.json: 36 created, 0 changed/);
  const owner = await person();
  await owner.goto(`${origin}/admin/`);
  await owner.locator("#adminSignIn").click();
  await owner.locator("#adminWorkspace").waitFor();
  assert.match(log, /owner signed in: \d+ collections, 0 created/);
  // Setup through the owner's own SDK handle: a public board and fields.
  await owner.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    // The original installs no boards: the owner makes 로그 too.
    await admin.collection(`${P}boards`).set("default", {
      name: "로그",
      kind: "image",
      enabled: true,
      listLevel: 1,
      readLevel: 1,
      writeLevel: 2,
      commentLevel: 2,
      secret: "optional",
      categories: [],
      actions: true,
    });
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
  await adminMenu(owner, "게시판관리", "이모티콘");
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

  // 캐릭터 이미지 항목: the owner turns the 전신 on, asked as an address.
  await adminMenu(owner, "캐릭터관리", "프로필 기본 항목");
  await owner.locator('#adminFields [name="bodyUse"]').check();
  await owner.locator('#adminFields [name="bodyUrl"]').check();
  await owner.locator('#adminForm [type="submit"]').click();
  await owner.locator("#adminStatus", { hasText: "저장했습니다." }).waitFor();

  // Alice joins, makes a character with an owner-only field and an image
  // field, and posts a log with a picture and a tag.
  const alice = await person();
  await signInAs(alice, "alice");
  await joinAs(alice, "앨리스");
  // Characters are registered from 마이페이지, as the original's
  // mypage/character does; the lists have no form.
  await menu(alice, "마이페이지");
  await alice.locator("#newCharacter").click();
  await alice.locator('#characterFields [data-field="age"]').waitFor();
  await alice.locator("#characterName").fill("초록");
  await alice.locator("#characterProfile").fill("숲에서 온 초록");
  await alice.locator('#characterFields [data-field="age"]').fill("17");
  await alice
    .locator('#characterFields [data-field="diary"]')
    .fill("비밀 일기");
  await alice
    .locator('#characterFields [data-field-upload="art"]')
    .setInputFiles(picture("art.png"));
  await alice.locator('#characterImages [data-image="body"]').fill(smile);
  await alice.locator('#characterForm [type="submit"]').click();
  // Her first character is her 대표 (character_form_update.php:120).
  await alice
    .locator("#myCharacters li", { hasText: "초록" })
    .filter({ hasText: "대표" })
    .waitFor();
  assert.equal(await alice.locator("#newCharacter").isVisible(), false);
  await menu(alice, "신청자목록");
  await alice
    .locator("#characters .character")
    .filter({ hasText: "초록" })
    .waitFor();
  // member/ready.php: ALL with its count, and a search by 캐릭명.
  await alice
    .locator("#applicantFilters button", { hasText: "ALL(1)" })
    .waitFor();
  await alice.locator("#applicantField").selectOption("name");
  await alice.locator("#applicantText").fill("없는이름");
  await alice.locator("#applicantSearch button").click();
  await alice
    .locator("#characters li", { hasText: "신청자가 없습니다." })
    .waitFor();
  await alice.locator("#applicantText").fill("초록");
  await alice.locator("#applicantSearch button").click();
  await alice
    .locator("#characters .character")
    .filter({ hasText: "초록" })
    .waitFor();
  await menu(alice, "로그");
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
  await menu(bob, "신청자목록");
  const sheet = bob
    .locator("#characters .character")
    .filter({ hasText: "초록" });
  await sheet.waitFor();
  await sheet.locator(".character-details summary").click();
  await sheet.locator(".character-fields").filter({ hasText: "17" }).waitFor();
  assert.doesNotMatch(await sheet.textContent(), /비밀 일기/);
  // Alice still sees her own.
  await menu(alice, "신청자목록");
  const own = alice
    .locator("#characters .character")
    .filter({ hasText: "초록" });
  await own.locator(".character-details summary").click();
  await own
    .locator(".character-fields")
    .filter({ hasText: "비밀 일기" })
    .waitFor();

  // Bob calls Alice in a comment; her live connection marks the call.
  await menu(bob, "로그");
  const thread = bob.locator("#logs .log").filter({ hasText: "첫 로그" });
  await thread.locator(".comments > summary").click();
  await thread.locator(".comment-text").fill("[[앨리스]] 멋져요");
  await thread.locator('.comment-form [type="submit"]').click();
  await thread.locator(".comment-list .member-call").waitFor();
  await alice.waitForFunction(() =>
    document.querySelector("#tabCalls").textContent.includes("새 알림"),
  );

  // The shop runs in site functions with the real write budget.
  await menu(bob, "상점");
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
  // What an action said stays with its page.
  await menu(bob, "로그");
  assert.equal(await bob.locator("#status").textContent(), "");

  // 마이페이지's 로그내역 lists the member's own posts.
  await menu(alice, "마이페이지");
  await alice.locator("#myLogsTab").click();
  await alice.locator("#myLogs li", { hasText: "첫 로그" }).waitFor();

  // The owner pairs two characters; members see them in 커플목록.
  await owner.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    const { documents } = await admin.collection(`${P}characters`).list();
    await admin.collection(`${P}couples`).set("pair", {
      first: documents[0].id,
      second: documents[documents.length - 1].id,
      since: "2030-01-01",
    });
    // Shop categories: the event item shows under 이벤트 only.
    await admin.collection(`${P}settings`).set("community", {
      shopCategories: "일반, 이벤트",
      shopGreeting: "어서 오세요",
    });
    await admin
      .collection(`${P}items`)
      .set("cake", { name: "케이크", price: 1, shopCategory: "이벤트" });
  }, P);
  await menu(alice, "커플목록");
  await alice.locator("#coupleList li", { hasText: "초록" }).waitFor();
  await menu(alice, "상점");
  await alice.locator("#shopTalk", { hasText: "어서 오세요" }).waitFor();
  assert.equal(
    await alice.locator("#items li", { hasText: "케이크" }).count(),
    0,
  );
  await alice.locator("#shopCategories button", { hasText: "이벤트" }).click();
  await alice.locator("#items li", { hasText: "케이크" }).waitFor();

  // Every page has an address: a character's viewer, a post, a category.
  const greenId = await alice.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const member = await createNaru().members.session();
    const { documents } = await member.collection(`${P}characters`).list({
      where: { eq: ["name", "초록"] },
    });
    return documents[0].id;
  }, P);
  await alice.goto(`${origin}/#/character/${greenId}`);
  await alice
    .locator("#characterSheet .character-name", { hasText: "초록" })
    .waitFor();
  await alice
    .locator("#characterSheet h3", { hasText: "경험치 내역" })
    .waitFor();
  // The 전신 the owner turned on shows on the character's page.
  assert.equal(
    await alice
      .locator("#characterSheet .viewer-figures .viewer-body")
      .getAttribute("src"),
    smile,
  );
  await alice.reload();
  await alice
    .locator("#characterSheet .character-name", { hasText: "초록" })
    .waitFor();
  await alice.goto(`${origin}/#/logs/default/1`);
  await alice.locator("#logFocus .log", { hasText: "첫 로그" }).waitFor();
  await alice.goBack();
  await alice
    .locator("#characterSheet .character-name", { hasText: "초록" })
    .waitFor();
  // The board list names its board; a post links to its own address and a
  // comment to its own, and both survive a reload; so does a tag.
  await menu(alice, "로그");
  await alice.waitForURL(/#\/logs\/default$/);
  await alice
    .locator("#logs .log", { hasText: "첫 로그" })
    .locator(".log-number a")
    .click();
  await alice.waitForURL(/#\/post\/[^/]+$/);
  await alice.reload();
  await alice.locator("#logFocus .log", { hasText: "첫 로그" }).waitFor();
  await alice.locator("#logFocus .comments > summary").click();
  const commentLink = await alice
    .locator("#logFocus .comment", { hasText: "멋져요" })
    .locator(".permalink")
    .getAttribute("href");
  assert.match(commentLink, /^#\/post\/[^/]+\/comment\/[^/]+$/);
  await alice.goto(`${origin}/${commentLink}`);
  await alice.reload();
  await alice
    .locator("#logFocus .comment.linked", { hasText: "멋져요" })
    .waitFor();
  await alice.goto(`${origin}/#/logs/default/tag/${encodeURIComponent("봄")}`);
  await alice.reload();
  await alice.locator("#tagName", { hasText: "봄" }).waitFor();
  await alice.goto(`${origin}/#/shop/${encodeURIComponent("이벤트")}`);
  await alice.locator("#items li", { hasText: "케이크" }).waitFor();

  // Buying takes an approved character (shop/_ajax.shop_update.php:4):
  // none is offered until the owner approves 초록 and Alice picks it.
  const cake = alice.locator("#items .shop-pick", { hasText: "케이크" });
  const cakeBuy = alice.locator("#shopDetail button", { hasText: "구매하기" });
  await cake.click();
  await alice.locator("#shopDetail", { hasText: "케이크" }).waitFor();
  assert.equal(await cakeBuy.count(), 0);
  await alice.locator("#shopBuyNote").waitFor();
  await owner.evaluate(
    async ({ id }) => {
      const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
      const admin = await createNaru().auth.session();
      await admin.call("characters/review:reviewCharacter", {
        character: id,
        state: "approved",
      });
    },
    { id: greenId },
  );
  await alice.reload();
  await alice.locator("#daily").click();
  await alice.waitForFunction(
    () => document.querySelector("#balance").textContent === "100",
  );
  await alice
    .locator("#inventoryCharacter option", { hasText: "초록" })
    .waitFor({ state: "attached" });
  await alice.locator("#inventoryCharacter").selectOption({ label: "초록" });
  await alice.locator("#shopBuyNote").waitFor({ state: "hidden" });
  await cake.click();
  await cakeBuy.click();
  await alice
    .locator("#status", { hasText: "케이크을(를) 샀습니다." })
    .waitFor();
  // The inventory shows it in a slot; its detail opens on a click.
  await alice
    .locator('#inventory .inventory-slot button[title="케이크"]')
    .click();
  await alice.locator("#inventoryDetail", { hasText: "케이크" }).waitFor();
  if (process.env.E2E_SHOTS)
    await alice.locator("#shopView").screenshot({
      path: `${process.env.E2E_SHOTS}/shop.png`,
    });

  // Deleting the post leaves its picture: Naru deletes media only when
  // someone asks, as it may be linked from anywhere.
  const file = logPicture.split("/").pop();
  assert.equal((await fetch(`${origin}/media/1/${file}`)).status, 200);
  await menu(alice, "로그");
  await alice
    .locator("#logs .log")
    .filter({ hasText: "첫 로그" })
    .locator(".delete")
    .click();
  await alice
    .locator("#logs .log")
    .filter({ hasText: "첫 로그" })
    .waitFor({ state: "detached" });
  assert.equal((await fetch(`${origin}/media/1/${file}`)).status, 200);

  // A visitor posts on the public board, and edits with the password only.
  const guest = await person();
  await guest.goto(`${origin}/`);
  await menu(guest, "로그");
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

  // The mmb options, on the real runtime: 멤버공개 shows a visitor the log
  // locked, its body never sent; 19금 covers it until a member clicks.
  await menu(alice, "로그");
  await alice.locator("#board").selectOption("default");
  await alice.locator("#logImage").setInputFiles(picture("log.png"));
  await alice.locator("#logText").fill("멤버만 보는 로그");
  await alice.locator("#logMembersOnly").check();
  await alice.locator("#logAdult").check();
  await alice.locator('#logForm [type="submit"]').click();
  await alice.locator("#logs .log", { hasText: "멤버만 보는 로그" }).waitFor();
  await guest.goto(`${origin}/#/logs/default`);
  await guest
    .locator("#logs .log", { hasText: "멤버 공개용 로그입니다." })
    .waitFor();
  assert.doesNotMatch(
    await guest.locator("#logs").textContent(),
    /멤버만 보는 로그/,
  );
  await bob.goto(`${origin}/#/logs/default`);
  // The same address again would not reload: read the board afresh.
  await bob.reload();
  const covered = bob.locator("#logs .log", { hasText: "멤버만 보는 로그" });
  await covered.locator(".log-picture.blind").waitFor();
  await covered.locator(".remove-blind").click();
  await covered.locator(".log-picture.blind").waitFor({ state: "detached" });

  // 사이트공개: a visitor reads 멤버목록 and a character's page, with only
  // its public fields.
  await menu(guest, "멤버목록");
  await guest
    .locator("#characters .character")
    .filter({ hasText: "초록" })
    .waitFor();
  await guest.goto(`${origin}/#/character/${greenId}`);
  await guest
    .locator("#characterSheet .character-fields", { hasText: "17" })
    .waitFor();
  assert.doesNotMatch(
    await guest.locator("#characterSheet").textContent(),
    /비밀 일기/,
  );
  // Closed, a visitor sees the sign-in card only and the rules read them
  // nothing (extend/community.config.php sends guests to log in).
  const siteOpen = (open) =>
    owner.evaluate(
      async ({ P, open }) => {
        const { createNaru } =
          await import("https://naru.pub/sdk/1.1.0/naru.js");
        const admin = await createNaru().auth.session();
        const settings = admin.collection(`${P}settings`);
        const current = await settings.get("community");
        await settings.set("community", { ...current.data, siteOpen: open });
      },
      { P, open },
    );
  await siteOpen(false);
  await guest.reload();
  await guest.locator("#closedNotice").waitFor();
  assert.equal(await guest.locator("#characterView").isVisible(), false);
  assert.equal(await guest.locator("#siteMenu").isVisible(), false);
  const closedReads = await guest.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const naru = createNaru();
    const ids = (name, options) =>
      naru
        .collection(`${P}${name}`)
        .list(options)
        .then(
          (page) => page.documents.map((row) => row.id),
          (error) => error.code,
        );
    return {
      characters: await ids("characters"),
      boards: await ids("boards"),
      logs: await ids("logs", { filter: { board: "free" } }),
    };
  }, P);
  for (const [name, read] of Object.entries(closedReads))
    assert.ok(
      (Array.isArray(read) && !read.length) || read === "ACCESS_DENIED",
      `${name}: ${JSON.stringify(read)}`,
    );
  await siteOpen(true);
  await guest.goto(`${origin}/`);

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

  // A member writes their own profile directly, as rules/profiles.js allows:
  // nickname and preferences only, and nobody else's.
  const profileWrites = await bob.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const member = await createNaru().members.session();
    const profiles = member.collection(`${P}profiles`);
    const settle = (promise) =>
      promise.then(
        (saved) => saved.data.nick,
        (error) => error.code,
      );
    const own = await profiles.get(member.id);
    const renamed = await settle(
      profiles.set(member.id, { ...own.data, nick: "바뀐밥" }),
    );
    const again = await profiles.get(member.id);
    const forged = await settle(
      profiles.set(member.id, { ...again.data, owner: "someone" }),
    );
    const others = (await profiles.list()).documents.filter(
      (row) => row.id !== member.id,
    );
    const theirs = await settle(
      profiles.set(others[0].id, { ...others[0].data, nick: "가로채기" }),
    );
    return { renamed, forged, theirs };
  }, P);
  assert.deepEqual(profileWrites, {
    renamed: "바뀐밥",
    forged: "ACCESS_DENIED",
    theirs: "ACCESS_DENIED",
  });

  // 커뮤니티 설정 is one form, opened at once, in the original's sections
  // (adm/community_form.php): nothing to register first, even on a new site.
  await owner.goto(`${origin}/admin/#/settings`);
  await owner.locator('#adminFields [name="siteOpen"]').waitFor();
  assert.equal(await owner.locator("#adminNew").isVisible(), false);
  assert.deepEqual(await owner.locator("#adminFields h3").allTextContents(), [
    "홈페이지 기본환경 설정",
    "기능 설정",
    "쪽지",
    "상점",
    "캐릭터 보기",
    "기타 항목명 설정",
  ]);
  // 기타 항목명 설정 names the menu: 화폐 관리 by cf_money, and an untitled
  // 소속 (cf_side_title) has no menu entry, as in the original.
  await owner.locator('#adminFields [name="moneyName"]').fill("골드");
  await owner.locator('#adminFields [name="sideTitle"]').fill("");
  await owner.locator('#adminForm [type="submit"]').click();
  await owner
    .locator("#adminNav a", { hasText: "골드 관리" })
    .waitFor({ state: "attached" });
  assert.equal(
    await owner.locator("#adminNav a", { hasText: "소속 관리" }).count(),
    0,
  );
  await owner.reload();
  await owner.locator('#adminFields [name="moneyName"]').fill("아보");
  await owner.locator('#adminFields [name="sideTitle"]').fill("소속");
  await owner.locator('#adminForm [type="submit"]').click();
  await owner
    .locator("#adminNav a", { hasText: "소속 관리" })
    .waitFor({ state: "attached" });

  // The admin page has addresses too: an entry's form, and old links to
  // admin.html carry on to /admin/ with their address.
  await owner.goto(`${origin}/admin/#/emoticons/smile`);
  await owner.reload();
  await owner.locator('#adminFields [name="name"]').waitFor();
  assert.equal(
    await owner.locator('#adminFields [name="name"]').inputValue(),
    "웃음",
  );
  await owner.goto(`${origin}/admin.html#/visits`);
  await owner.waitForURL(/\/admin\/#\/visits/);
  await owner.locator("#adminReport table.report").waitFor();

  // Reviewing an application shows what the member wrote, with a link to
  // the character's page on the site.
  await owner.goto(`${origin}/admin/#/character_review`);
  const application = owner
    .locator("#adminRows .review")
    .filter({ hasText: "초록" });
  await application
    .locator(".review-summary", { hasText: "숲에서 온 초록" })
    .waitFor();
  assert.match(
    await application.locator(".review-summary a").getAttribute("href"),
    /^\.\.\/#\/character\//,
  );

  // The owner manages any character as adm/character_form.php: registers
  // one for a member named by nickname, with every field and a picture,
  // edits it, gives it to another member and deletes it.
  await owner.locator("#adminNew", { hasText: "새 캐릭터" }).click();
  await owner.waitForURL(/#\/character_review\/new$/);
  const sheetForm = owner.locator("#characterForm");
  await sheetForm.locator('[name="nick"]').fill("바뀐밥");
  await sheetForm.locator('[name="name"]').fill("운영자캐");
  await sheetForm.locator('[name="state"]').selectOption("approved");
  await sheetForm.locator('[name="type"]').selectOption("npc");
  await sheetForm.locator('[name="field:age"]').fill("99");
  await sheetForm.locator('[name="field:diary"]').fill("오너만 보는 일기");
  await sheetForm
    .locator('[data-upload-for="field:art"]')
    .setInputFiles(picture("art.png"));
  await sheetForm.locator('[type="submit"]').click();
  const made = owner
    .locator("#adminRows .review")
    .filter({ hasText: "운영자캐 · 바뀐밥 · 승인" });
  await made.waitFor();
  await made.locator(".review-manage button", { hasText: "수정" }).click();
  await owner.waitForURL(/#\/character_review\/[^/]+$/);
  assert.equal(
    await sheetForm.locator('[name="field:age"]').inputValue(),
    "99",
  );
  assert.match(
    await sheetForm.locator('[name="field:art"]').inputValue(),
    /^https:\/\/media\.naru\.pub\/\d+\//,
  );
  assert.equal(await sheetForm.locator('[name="type"]').inputValue(), "npc");
  await sheetForm.locator('[name="profile"]').fill("운영자가 고친 프로필");
  await sheetForm.locator('[type="submit"]').click();
  await made
    .locator(".review-summary", { hasText: "운영자가 고친 프로필" })
    .waitFor();
  await made.locator(".move-nick").fill("앨리스");
  await made.locator("button", { hasText: "회원 변경" }).click();
  const moved = owner
    .locator("#adminRows .review")
    .filter({ hasText: "운영자캐 · 앨리스 · 승인" });
  await moved.waitFor();
  await moved.locator("button", { hasText: "삭제" }).click();
  await moved.waitFor({ state: "detached" });
  await owner
    .locator("#adminStatus", { hasText: "운영자캐을(를) 삭제했습니다." })
    .waitFor();

  // 현재접속자 lists who visited in the last ten minutes.
  await menu(alice, "현재접속자");
  await alice.locator("#onlineList li", { hasText: "앨리스" }).waitFor();
  // The owner's reports: visits counted, and each member's activity.
  await adminMenu(owner, "회원관리", "접속자 집계");
  await owner.locator("#adminReport table.report td").first().waitFor();
  assert.match(
    await owner.locator("#adminReport p").first().textContent(),
    /접속 [1-9]\d*회/,
  );
  await adminMenu(owner, "회원관리", "활동량 관리");
  await owner
    .locator("#adminReport tr", { hasText: "앨리스" })
    .first()
    .waitFor();
  // 아보·경험치 지급 (adm/point_list.php): to one member, with its log.
  await adminMenu(owner, "아이템 관리", "아보·경험치 지급");
  await owner
    .locator(".grant-form label", { hasText: "회원 닉네임" })
    .locator("input")
    .fill("앨리스");
  await owner
    .locator(".grant-form label", { hasText: "양" })
    .locator("input")
    .fill("7");
  await owner
    .locator(".grant-form label", { hasText: "내용" })
    .locator("input")
    .fill("수고 보상");
  await owner.locator('.grant-form [type="submit"]').click();
  await owner
    .locator(".grant-form [role=status]", { hasText: "끝났습니다" })
    .waitFor();
  await owner.locator(".grant-log li", { hasText: "수고 보상" }).waitFor();

  // Board search finds Alice's post by its text.
  await menu(alice, "로그");
  await alice.locator("#searchText").fill("봄");
  await alice.locator("#boardSearch button").click();
  await alice.locator("#tagName", { hasText: "검색 결과" }).waitFor();
  await alice.locator("#clearTag").click();

  // A Q&A board: a guest asks in secret and opens it with the password;
  // a settlement board: Alice asks as her character, the owner settles.
  await owner.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    for (const [id, data] of [
      ["ask", { name: "문의", kind: "qna", secret: "optional" }],
      ["calc", { name: "정산", kind: "settlement", categories: ["이벤트"] }],
    ])
      await admin.collection(`${P}boards`).set(id, {
        enabled: true,
        listLevel: 1,
        readLevel: 1,
        writeLevel: 1,
        commentLevel: 1,
        ...data,
      });
  }, P);
  const asker = await person();
  await asker.goto(`${origin}/#/logs/ask`);
  await asker.locator("#logText").waitFor();
  await asker.locator("#guestName").fill("문의자");
  await asker.locator("#guestPassword").fill("pass1234");
  await asker.locator("#logText").fill("환불되나요?");
  await asker.locator("#logSecret").check();
  await asker.locator('#logForm [type="submit"]').click();
  await asker.locator("#logs .log", { hasText: "환불되나요?" }).waitFor();
  await asker.reload();
  const question = asker.locator("#logs .log", { hasText: "비밀 질문" });
  await question.waitFor();
  await question.locator(".open-secret input").fill("pass1234");
  await question.locator(".open-secret button").click();
  const opened = asker.locator("#logs .log", { hasText: "환불되나요?" });
  await opened.waitFor();
  // Only the staff answer (skin/board/qna/list.skin.php:85-87).
  assert.equal(
    await opened.locator(".comment-form").evaluate((form) => form.hidden),
    true,
  );

  await alice.goto(`${origin}/#/logs/calc`);
  await alice.locator("#logCategory").selectOption("이벤트");
  await alice.locator("#logText").fill("이벤트 참여 정산 부탁드려요");
  await alice.locator('#logForm [type="submit"]').click();
  await alice.locator("#logs .log", { hasText: "정산 부탁" }).waitFor();
  await owner.evaluate(async (P) => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    const { documents } = await admin
      .collection(`${P}logs`)
      .list({ filter: { board: "calc" } });
    await admin.call("community/posts:settle", {
      id: documents[0].id,
      state: "정산완료",
      money: 10,
      memo: "확인했습니다",
    });
  }, P);
  await alice.reload();
  await alice
    .locator("#logs .log .log-title", { hasText: "[정산완료]" })
    .waitFor();

  // A message goes to a member named by nickname, as the original's memo
  // form takes an ID; an unknown name is refused before anything is sent.
  await alice.evaluate(() => document.querySelector("#tabMessages").click());
  // Bob is 바뀐밥 since he changed his nickname above.
  await alice.locator("#messageTo").fill("바뀐밥, 없는사람");
  await alice.locator("#messageBody").fill("안녕 밥");
  await alice.locator('#messageForm [type="submit"]').click();
  await alice
    .locator("#status", { hasText: "닉네임을 찾을 수 없습니다: 없는사람" })
    .waitFor();
  await alice.locator("#messageTo").fill("바뀐밥");
  await alice.locator('#messageForm [type="submit"]').click();
  await alice.locator("#status", { hasText: "쪽지를 보냈습니다." }).waitFor();
  await bob.evaluate(() => document.querySelector("#tabMessages").click());
  await bob.locator("#messages li", { hasText: "안녕 밥" }).waitFor();
  // 쪽지함 as the original's: the conversation opens, and a reply goes
  // into it; Alice's entry shows it.
  await bob
    .locator("#messages .conversation-entry", { hasText: "앨리스" })
    .click();
  await bob.locator("#messageDetail .theirs", { hasText: "안녕 밥" }).waitFor();
  await bob.locator("#messageDetail .reply textarea").fill("고마워");
  await bob.locator("#messageDetail .reply button").click();
  await bob.locator("#messageDetail .mine", { hasText: "고마워" }).waitFor();
  await alice.evaluate(() => document.querySelector("#tabMessages").click());
  await alice
    .locator("#messages .conversation-entry", { hasText: "고마워" })
    .filter({ hasText: "N" })
    .waitFor();

  // Bob leaves the community: from then on he is a guest here.
  await menu(bob, "마이페이지");
  await bob.locator("#myLeave").click();
  await bob.locator("#admissionTitle", { hasText: "탈퇴한 회원" }).waitFor();
  await bob.reload();
  await bob.locator("#admissionTitle", { hasText: "탈퇴한 회원" }).waitFor();

  // 화면 모드: the system's by default, then the visitor's choice, kept
  // across reloads and on the admin page.
  const night = await (
    await browser.newContext({ colorScheme: "dark" })
  ).newPage();
  night.on("pageerror", (error) => errors.push(error.message));
  const paper = () =>
    night.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await night.goto(`${origin}/`);
  await night.locator("#homeView").waitFor();
  assert.equal(await night.locator("#schemeChoice").inputValue(), "");
  assert.equal(await paper(), "rgb(18, 18, 18)");
  if (process.env.E2E_SHOTS)
    await night.screenshot({ path: `${process.env.E2E_SHOTS}/dark.png` });
  await night.locator("#schemeChoice").selectOption("light");
  assert.equal(await paper(), "rgb(255, 255, 255)");
  await night.reload();
  assert.equal(await night.locator("#schemeChoice").inputValue(), "light");
  assert.equal(await paper(), "rgb(255, 255, 255)");
  await night.goto(`${origin}/admin/`);
  assert.equal(await night.locator("#schemeChoice").inputValue(), "light");
  assert.equal(await paper(), "rgb(255, 255, 255)");
  await night.locator("#schemeChoice").selectOption("dark");
  assert.equal(await paper(), "rgb(24, 25, 27)");
  if (process.env.E2E_SHOTS) {
    await night.screenshot({ path: `${process.env.E2E_SHOTS}/admin-dark.png` });
    await night.setViewportSize({ width: 390, height: 800 });
    await night.goto(`${origin}/`);
    await night.locator("#homeView").waitFor();
    await night.screenshot({
      path: `${process.env.E2E_SHOTS}/narrow-dark.png`,
    });
    await alice.screenshot({ path: `${process.env.E2E_SHOTS}/alice.png` });
  }

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
