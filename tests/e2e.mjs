// The site on a local Naru: naru-dev runs the real edge Worker (the site's
// tables, queries, mutations, live queries and limits) and stands in for
// naru.pub. Nothing here imitates
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
const site = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.E2E_PORT ?? 4300);
const origin = `http://localhost:${port}`;
const state = await mkdtemp(join(tmpdir(), "neo-avocado-e2e-"));

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
/**
 * enter.php's entrance: a visitor arriving at an open site's home clicks
 * through it, once a browser session; elsewhere it does not show.
 */
async function pastEntrance(page) {
  const enter = page.locator("#entranceEnter");
  try {
    await enter.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    return;
  }
  await enter.click();
}
async function signInAs(page, name) {
  await page.goto(`${origin}/`);
  await pastEntrance(page);
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
  // Every collection became a table: the site declares none, and the
  // owner's sign-in asks for none.
  assert.doesNotMatch(log, /collections\.json/);
  const owner = await person();
  await owner.goto(`${origin}/admin/`);
  await owner.locator("#adminSignIn").click();
  await owner.locator("#adminWorkspace").waitFor();
  assert.match(log, /owner signed in: 0 collections, 0 created/);
  // Setup through the owner's own SDK handle: a public board and fields.
  await owner.evaluate(async () => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    // A day's first visit pays this (cf_login_point); the original installs 0.
    // The owner's admin mutations check what they save as the forms do, and
    // a save may send only the fields it changes.
    await admin.mutate("admin/settings:save", {
      section: "settings",
      values: { loginReward: 100 },
    });
    // The original installs no boards: the owner makes 로그 too.
    const board = (id, values) =>
      admin.mutate("admin/boards:save", { id, values, create: true });
    await board("default", {
      name: "로그",
      kind: "image",
      enabled: true,
      listLevel: 1,
      readLevel: 1,
      writeLevel: 2,
      commentLevel: 2,
      secret: "optional",
      categories: "",
      actions: true,
    });
    await board("free", {
      name: "자유",
      kind: "text",
      enabled: true,
      listLevel: 1,
      readLevel: 1,
      writeLevel: 1,
      commentLevel: 1,
      secret: "optional",
      categories: "",
    });
    for (const [code, values] of [
      ["age", { label: "나이", type: "text", visibility: "public", order: 1 }],
      [
        "diary",
        { label: "일기", type: "textarea", visibility: "owner", order: 2 },
      ],
      ["art", { label: "전신", type: "image", visibility: "public", order: 3 }],
    ])
      await admin.mutate("admin/records:save", {
        section: "character_fields",
        id: code,
        values,
        create: true,
      });
  });

  // An image field in the admin forms takes a file: it goes to Naru Media
  // and its address is what the row keeps.
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
  const smile = await owner.evaluate(async () => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    return (
      await admin.query("admin/records:get", {
        section: "emoticons",
        id: "smile",
      })
    ).data.image;
  });
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
  // Her one character is all the site allows: the button goes once the page
  // has her character.
  await alice.locator("#newCharacter").waitFor({ state: "hidden" });
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
  // The number, and the 새글 mark (bo_new) a post just written carries.
  assert.equal(
    await post.locator(".log-number").evaluate((node) =>
      [...node.childNodes]
        .filter((child) => !child.classList?.contains("new-mark"))
        .map((child) => child.textContent)
        .join("")
        .trim(),
    ),
    "No. 1",
  );
  assert.equal(
    (await post.locator(".log-number .new-mark").textContent()).trim(),
    "N",
  );
  await alice.waitForFunction(
    () => document.querySelector("#logs .log img.log-image")?.naturalWidth > 0,
  );
  const logPicture = await post.locator("img.log-image").getAttribute("src");
  assert.match(logPicture, /^https:\/\/media\.naru\.pub\/1\//);
  // #tag lists the board's posts with the tag.
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

  // Bob calls Alice in a comment; her subscription marks the call.
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
  // The day's first visit paid the 로그인 reward (common.php:401), once.
  await menu(bob, "상점");
  await bob.waitForFunction(
    () => document.querySelector("#balance").textContent === "100",
  );
  await bob.reload();
  await menu(bob, "상점");
  await bob.waitForFunction(
    () => document.querySelector("#balance").textContent === "100",
  );
  // What an action said stays with its page.
  await menu(bob, "로그");
  assert.equal(await bob.locator("#status").textContent(), "");

  // 마이페이지's 로그내역 lists the member's own posts.
  await menu(alice, "마이페이지");
  await alice.locator("#myLogsTab").click();
  await alice.locator("#myLogs li", { hasText: "첫 로그" }).waitFor();

  // The owner pairs two characters, as the form does: 초록 and one the
  // owner registers for Bob. Members see them in 커플목록.
  const partner = await owner.evaluate(async () => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    const { characters } = await admin.query("admin/references:references");
    const { document } = await admin.mutate("characters/sheet:save", {
      nick: "밥",
      data: {
        name: "파랑",
        side: "",
        class: "",
        profile: "",
        image: "",
        head: "",
        body: "",
        type: "npc",
        state: "approved",
        fields: {},
      },
    });
    await admin.mutate("admin/records:save", {
      section: "couples",
      id: "pair",
      values: {
        first: characters[0].id,
        second: document.id,
        since: "2030-01-01",
      },
      create: true,
    });
    // Shop categories: the event item shows under 이벤트 only.
    await admin.mutate("admin/settings:save", {
      section: "settings",
      values: { shopCategories: "일반, 이벤트", shopGreeting: "어서 오세요" },
    });
    // A new item starts hidden, as the form's does: this one is on sale.
    await admin.mutate("admin/records:save", {
      section: "items",
      id: "cake",
      values: {
        name: "케이크",
        price: 1,
        shopCategory: "이벤트",
        hidden: false,
      },
      create: true,
    });
    return document.id;
  });
  await menu(alice, "커플목록");
  await alice.locator("#coupleList li", { hasText: "초록" }).waitFor();
  assert.match(
    await alice.locator("#coupleList li", { hasText: "초록" }).textContent(),
    /파랑/,
  );
  // Bob's character goes again, and the couple with it.
  await owner.evaluate(async (id) => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    await admin.mutate("characters/sheet:remove", { id });
  }, partner);
  await menu(alice, "상점");
  await alice.locator("#shopTalk", { hasText: "어서 오세요" }).waitFor();
  assert.equal(
    await alice.locator("#items li", { hasText: "케이크" }).count(),
    0,
  );
  await alice.locator("#shopCategories button", { hasText: "이벤트" }).click();
  await alice.locator("#items li", { hasText: "케이크" }).waitFor();

  // Every page has an address: a character's viewer, a post, a category.
  const greenId = await alice.evaluate(async () => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const member = await createNaru().members.session();
    const { document } = await member.query("characters/sheet:named", {
      name: "초록",
    });
    return document.id;
  });
  await alice.goto(`${origin}/character/${greenId}`);
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
  // The board list names its board; a post links to its own address and a
  // comment to its own, and both survive a reload; so does a tag.
  await menu(alice, "로그");
  await alice.waitForURL(`${origin}/logs/default`);
  await alice
    .locator("#logs .log", { hasText: "첫 로그" })
    .locator(".log-number a")
    .click();
  await alice.waitForURL(/\/post\/[^/]+$/);
  await alice.reload();
  await alice.locator("#logFocus .log", { hasText: "첫 로그" }).waitFor();
  await alice.locator("#logFocus .comments > summary").click();
  const commentLink = await alice
    .locator("#logFocus .comment", { hasText: "멋져요" })
    .locator(".permalink")
    .getAttribute("href");
  assert.match(commentLink, /^\/post\/[^/]+\/comment\/[^/]+$/);
  await alice.goto(`${origin}${commentLink}`);
  await alice.reload();
  await alice
    .locator("#logFocus .comment.linked", { hasText: "멋져요" })
    .waitFor();
  await alice.goto(`${origin}/logs/default/tag/${encodeURIComponent("봄")}`);
  await alice.reload();
  await alice.locator("#tagName", { hasText: "봄" }).waitFor();
  await alice.goto(`${origin}/shop/${encodeURIComponent("이벤트")}`);
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
      const { createNaru } =
        await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
      const admin = await createNaru().auth.session();
      await admin.mutate("characters/review:reviewCharacter", {
        character: id,
        state: "approved",
      });
    },
    { id: greenId },
  );
  await alice.reload();
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
  await pastEntrance(guest);
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
  // The post's own path, visited directly: Naru's route serves the page
  // with the post's link preview, which a crawler reads without the script.
  const guestPath = await guest
    .locator("#logs .log", { hasText: "고친 손님 글" })
    .locator(".log-number a")
    .getAttribute("href");
  assert.match(guestPath, /^\/post\/\d+$/);
  const preview = await (await fetch(`${origin}${guestPath}`)).text();
  assert.match(
    preview,
    /<meta property="og:description" content="고친 손님 글" \/>/,
  );
  assert.match(
    preview,
    /<meta property="og:title" content="[^"]+ No\. \d+" \/>/,
  );
  const reader = await person();
  await reader.goto(`${origin}${guestPath}`);
  await reader.locator("#logFocus .log", { hasText: "고친 손님 글" }).waitFor();
  assert.match(
    await reader.locator('meta[property="og:title"]').getAttribute("content"),
    /No\. \d+$/,
  );
  assert.equal(
    await reader.locator('link[rel="canonical"]').getAttribute("href"),
    // Naru tells routes the address the page was asked on.
    `${origin}${guestPath}`,
  );
  // Paths no page has stay 404.
  assert.equal((await fetch(`${origin}/logs/free/abc`)).status, 404);
  assert.equal((await fetch(`${origin}/nowhere`)).status, 404);
  await reader.context().close();

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
  await guest.goto(`${origin}/logs/default`);
  await guest
    .locator("#logs .log", { hasText: "멤버 공개용 로그입니다." })
    .waitFor();
  assert.doesNotMatch(
    await guest.locator("#logs").textContent(),
    /멤버만 보는 로그/,
  );
  await bob.goto(`${origin}/logs/default`);
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
  await guest.goto(`${origin}/character/${greenId}`);
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
    owner.evaluate(async (open) => {
      const { createNaru } =
        await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
      const admin = await createNaru().auth.session();
      await admin.mutate("admin/settings:save", {
        section: "settings",
        values: { siteOpen: open },
      });
    }, open);
  await siteOpen(false);
  await guest.reload();
  await guest.locator("#closedNotice").waitFor();
  assert.equal(await guest.locator("#characterView").isVisible(), false);
  assert.equal(await guest.locator("#siteMenu").isVisible(), false);
  // Members' IDs, as their pages know them.
  const idOf = (page) =>
    page.evaluate(async () => {
      const { createNaru } =
        await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
      return (await createNaru().members.session()).id;
    });
  const memberIds = [await idOf(alice), await idOf(bob)];
  const closedReads = await guest.evaluate(
    async ({ memberIds }) => {
      const { createNaru } =
        await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
      const naru = createNaru();
      const ids = (name, args, list) =>
        naru.query(name, args).then(
          (answer) => answer[list].map((row) => row.id),
          (error) => error.code,
        );
      return {
        // Characters are a query's, which reads the closed site's setting.
        characters: await naru.query("characters/sheet:list").then(
          (page) => page.documents.map((row) => row.id),
          (error) => error.code,
        ),
        // So are the boards and their posts.
        boards: await ids("community/boards:boards", null, "boards"),
        logs: await ids("community/posts:page", { board: "free" }, "documents"),
        // Nicknames are a query's, which reads the closed site's setting.
        nicks: await naru
          .query("community/profiles:nicks", { ids: memberIds })
          .then(({ nicks }) => Object.keys(nicks)),
      };
    },
    { memberIds },
  );
  for (const [name, read] of Object.entries(closedReads))
    assert.ok(
      (Array.isArray(read) && !read.length) || read === "ACCESS_DENIED",
      `${name}: ${JSON.stringify(read)}`,
    );
  await siteOpen(true);
  await guest.goto(`${origin}/`);
  await pastEntrance(guest);

  // On the real runtime: a member reads their own wallet and nobody else's;
  // a visitor reads nicknames and no wallet.
  const reads = (page) =>
    page.evaluate(async (memberIds) => {
      const { createNaru } =
        await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
      const naru = createNaru();
      const member = await naru.members.session();
      const reader = member ?? naru;
      const settle = (promise) =>
        promise.then(
          (value) => value,
          (error) => error.code,
        );
      return {
        wallet: await settle(reader.query("economy/wallet:wallet")),
        own: await settle(reader.query("community/profiles:own")),
        nicks: await settle(
          reader.query("community/profiles:nicks", { ids: memberIds }),
        ),
        me: member?.id ?? null,
      };
    }, memberIds);
  const bobReads = await reads(bob);
  assert.equal(typeof bobReads.wallet.balance, "number");
  assert.equal(bobReads.own.profile.id, bobReads.me);
  assert.equal(typeof bobReads.own.profile.data.acceptMessages, "boolean");
  const guestReads = await reads(guest);
  assert.equal(guestReads.wallet, "AUTH_REQUIRED");
  assert.equal(guestReads.own, "AUTH_REQUIRED");
  assert.deepEqual(
    Object.keys(guestReads.nicks.nicks).sort(),
    [...memberIds].sort(),
  );

  // A member changes their own nickname and preferences through
  // profiles:update; another's nickname is not theirs to take.
  const profileWrites = await bob.evaluate(async (alice) => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const member = await createNaru().members.session();
    const settle = (promise) =>
      promise.then(
        (saved) => saved.profile.data.nick,
        (error) => error.details?.reason ?? error.code,
      );
    const update = (nick) =>
      settle(
        member.mutate("community/profiles:update", {
          nick,
          acceptMessages: true,
          commentAlerts: true,
        }),
      );
    const { nicks } = await member.query("community/profiles:nicks", {
      ids: [alice],
    });
    return {
      renamed: await update("바뀐밥"),
      theirs: await update(nicks[alice]),
      reserved: await update("관리자"),
    };
  }, memberIds[0]);
  assert.deepEqual(profileWrites, {
    renamed: "바뀐밥",
    theirs: "nick_taken",
    reserved: "reserved_nick",
  });

  // 커뮤니티 설정 is one form, opened at once, in the original's sections
  // (adm/community_form.php): nothing to register first, even on a new site.
  await owner.goto(`${origin}/admin/#/settings`);
  await owner.locator('#adminFields [name="siteOpen"]').waitFor();
  assert.equal(await owner.locator("#adminNew").isVisible(), false);
  assert.deepEqual(await owner.locator("#adminFields h3").allTextContents(), [
    "홈페이지 기본환경 설정",
    "회원가입 설정",
    "기능 설정",
    "화폐",
    "게시판 기본 설정",
    "쪽지",
    "자동 정리",
    "상점",
    "캐릭터 보기",
    "기타 항목명 설정",
  ]);
  // 기타 항목명 설정 names the menu: 화폐 관리 by cf_money, and an untitled
  // 소속 (cf_side_title) has no menu entry, as in the original.
  await owner.locator('#adminFields [name="moneyName"]').fill("골드");
  await owner.locator('#adminFields [name="sideTitle"]').fill("");
  // 글쓰기 간격 offers the original's 30 seconds on a site never saved; this
  // test writes in quick succession, so it saves 0 (no limit).
  assert.equal(
    await owner.locator('#adminFields [name="writeDelay"]').inputValue(),
    "30",
  );
  await owner.locator('#adminFields [name="writeDelay"]').fill("0");
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

  // A settings form's own address opens it, as the form gives it.
  await owner.goto(`${origin}/admin/#/settings/community`);
  await owner.reload();
  await owner.locator('#adminFields [name="moneyName"]').waitFor();
  assert.equal(
    await owner.locator('#adminFields [name="moneyName"]').inputValue(),
    "아보",
  );
  assert.equal(await owner.locator("#adminStatus").textContent(), "");

  // The admin page has addresses too: an entry's form, and a report.
  await owner.goto(`${origin}/admin/#/emoticons/smile`);
  await owner.reload();
  await owner.locator('#adminFields [name="name"]').waitFor();
  assert.equal(
    await owner.locator('#adminFields [name="name"]').inputValue(),
    "웃음",
  );
  await owner.goto(`${origin}/admin/#/visits`);
  await owner.locator("#adminReport table.report").waitFor();

  // The smaller lists edit in place (선택수정), a board group lists its
  // 접근회원, and 상점 진열 is a section of its own.
  await owner.evaluate(async () => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    await admin.mutate("admin/records:save", {
      section: "levels",
      id: "rank-e2e",
      values: { name: "새싹", exp: 5, bonusPoints: 1 },
      create: true,
    });
    await admin.mutate("admin/records:save", {
      section: "board_groups",
      id: "e2e-group",
      values: { name: "시험 그룹" },
      create: true,
    });
  });
  await owner.goto(`${origin}/admin/#/levels`);
  const rank = owner.locator("#adminRows li", { hasText: "rank-e2e" });
  await rank.locator('input[data-key="name"]').fill("새순");
  await owner.locator("#quickSave").click();
  await owner.waitForFunction(() =>
    /수정했습니다/.test(document.querySelector("#adminStatus").textContent),
  );
  assert.equal(
    await owner.evaluate(async () => {
      const { createNaru } =
        await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
      const admin = await createNaru().auth.session();
      return (
        await admin.query("admin/records:get", {
          section: "levels",
          id: "rank-e2e",
        })
      ).data.name;
    }),
    "새순",
  );
  await owner.goto(`${origin}/admin/#/board_groups`);
  await owner
    .locator("#adminRows li", { hasText: "시험 그룹" })
    .locator("button", { hasText: "접근회원" })
    .click();
  await owner
    .locator(".group-members [role=status]", {
      hasText: "접근회원 0명",
    })
    .waitFor();
  await owner.goto(`${origin}/admin/#/shop_entries`);
  await owner.locator("#adminNew").waitFor();
  assert.equal(await owner.locator("#adminNew").isVisible(), true);

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
  await moved.locator("button", { hasText: "영구 삭제" }).click();
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
  await adminMenu(owner, "아이템 관리", "아보·경험치·아이템 지급");
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

  // Board search finds Alice's post by its text: a Korean word of 3
  // characters through the full-text table, one of 2 by LIKE; her deleted
  // post is no longer found.
  await menu(alice, "로그");
  const searchFor = async (text, found) => {
    await alice.locator("#searchText").fill(text);
    await alice.locator("#boardSearch button").click();
    await alice
      .locator("#tagName", { hasText: `‘${text}’ 검색 결과 ${found}건` })
      .waitFor();
  };
  await searchFor("멤버만", 1);
  await alice.locator("#logs .log", { hasText: "멤버만 보는 로그" }).waitFor();
  await searchFor("로그", 1);
  await alice.locator("#logs .log", { hasText: "멤버만 보는 로그" }).waitFor();
  await searchFor("첫 로그", 0);
  await alice.locator("#clearTag").click();

  // A Q&A board: a guest asks in secret and opens it with the password;
  // a settlement board: Alice asks as her character, the owner settles.
  await owner.evaluate(async () => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    for (const [id, values] of [
      ["ask", { name: "문의", kind: "qna", secret: "optional" }],
      ["calc", { name: "정산", kind: "settlement", categories: "이벤트" }],
    ])
      await admin.mutate("admin/boards:save", {
        id,
        values: {
          enabled: true,
          listLevel: 1,
          readLevel: 1,
          writeLevel: 1,
          commentLevel: 1,
          ...values,
        },
        create: true,
      });
  });
  const asker = await person();
  await asker.goto(`${origin}/logs/ask`);
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

  await alice.goto(`${origin}/logs/calc`);
  await alice.locator("#logCategory").selectOption("이벤트");
  await alice.locator("#logText").fill("이벤트 참여 정산 부탁드려요");
  await alice.locator('#logForm [type="submit"]').click();
  await alice.locator("#logs .log", { hasText: "정산 부탁" }).waitFor();
  await owner.evaluate(async () => {
    const { createNaru } =
      await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    // The owner reads the board as its staff.
    const { documents } = await admin.query("community/posts:page", {
      board: "calc",
    });
    await admin.mutate("community/posts:settle", {
      id: documents[0].id,
      state: "정산완료",
      money: 10,
      memo: "확인했습니다",
    });
  });
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
  // Bob's page hears of it without reloading (community/inbox:status), the
  // tab and the home card's count alike.
  await bob.waitForFunction(
    () =>
      document.querySelector("#tabMessages").textContent.includes("새 쪽지") &&
      document.querySelector("#cardUnread").textContent === "1",
  );
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
  // Opening the conversation read Alice's: Bob's notice goes, and Alice's
  // comes with his reply.
  await bob.waitForFunction(
    () =>
      !document.querySelector("#tabMessages").textContent.includes("새 쪽지"),
  );
  await alice.waitForFunction(() =>
    document.querySelector("#tabMessages").textContent.includes("새 쪽지"),
  );
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
  await pastEntrance(night);
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
