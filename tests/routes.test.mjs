// 실행: npm test
// The site's routes (_naru/routes/) on a real SQLite database with the
// site's migrations (tests/sql-ctx.mjs): every address the pages know is
// served as index.html with its link preview, read as a visitor reads, and
// what a visitor may not read (secret, 멤버공개 and 19금 posts, boards above
// level 1 or in a members-only group) shows the site's own; a closed site's
// pages show none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testSite } from "./sql-ctx.mjs";

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
/** A board open to visitors (level 1) unless `data` says otherwise. */
const board = (site, id, { options = {}, ...data } = {}) =>
  insert(site, "boards", {
    id,
    name: id,
    kind: "image",
    list_level: 1,
    read_level: 1,
    write_level: 2,
    comment_level: 2,
    options,
    ...data,
  });
const post = (site, data = {}) =>
  insert(site, "posts", {
    board: "free",
    number: site.rows(
      "SELECT coalesce(max(number), 0) + 1 AS n FROM posts WHERE board = ?",
      data.board ?? "free",
    )[0].n,
    owner: "m-1",
    created_at: site.now,
    updated_at: site.now,
    ...data,
  });
const character = (site, data = {}) =>
  insert(site, "characters", {
    owner: "m-1",
    name: "Hero",
    created_at: site.now,
    ...data,
  });

/** A route's head as its tags: title, canonical, and each meta's content. */
function tags(answer) {
  assert.equal(answer.file, "index.html");
  assert.equal(answer.cache, 60);
  const found = {};
  const unescape = (text) =>
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  found.title = unescape(answer.head.match(/<title>([^<]*)<\/title>/)[1]);
  found.canonical = unescape(
    answer.head.match(/<link rel="canonical" href="([^"]*)" \/>/)[1],
  );
  for (const [, , name, content] of answer.head.matchAll(
    /<meta (name|property)="([^"]+)" content="([^"]*)" \/>/g,
  ))
    found[name] = unescape(content);
  return found;
}
/** The site's own preview, for `path`. */
const generic = (path, site = {}) => ({
  title: site.name ?? "네오 아보카도",
  canonical: path,
  description: site.description ?? "자캐 커뮤니티입니다.",
  "og:site_name": site.name ?? "네오 아보카도",
  "og:type": "website",
  "og:title": site.name ?? "네오 아보카도",
  "og:description": site.description ?? "자캐 커뮤니티입니다.",
  "og:url": path,
  ...(site.image ? { "og:image": site.image } : {}),
  "twitter:card": site.image ? "summary_large_image" : "summary",
});
const NOT_FOUND = { body: "Not Found", type: "text/plain", status: 404 };
/** What a closed site's page answers: index.html with no preview at all. */
const CLOSED = {
  file: "index.html",
  head: '<meta name="robots" content="noindex, nofollow" />',
  cache: 60,
};

test("the home and the views are index.html with the site's preview, from 디자인", async () => {
  const site = await testSite();
  assert.deepEqual(tags(await site.route("/")), generic("/"));
  assert.deepEqual(tags(await site.route("/home")), generic("/home"));
  const members = tags(await site.route("/members"));
  assert.equal(members.title, "멤버목록 - 네오 아보카도");
  assert.equal(members["og:title"], "멤버목록");
  for (const [path, title] of [
    ["/applicants", "신청자목록"],
    ["/characters", "캐릭터"],
    ["/couples", "커플목록"],
    ["/quests", "퀘스트"],
    ["/calls", "알림"],
    ["/online", "현재접속자"],
    ["/shop", "상점"],
    ["/shop/%EC%9D%B4%EB%B2%A4%ED%8A%B8", "상점"],
    ["/mypage", "마이페이지"],
    ["/mypage/logs", "마이페이지"],
    ["/mypage/exp", "마이페이지"],
    ["/mypage/favorites", "마이페이지"],
    ["/mypage/money", "마이페이지"],
    ["/messages", "쪽지"],
    ["/messages/12", "쪽지"],
    ["/content", "안내"],
    ["/logs", "로그"],
  ]) {
    const shown = tags(await site.route(path));
    assert.equal(shown["og:title"], title, path);
    assert.equal(shown.canonical, path, path);
  }
  // Paths no page has are no route's: Naru serves them as files, or 404.
  for (const path of [
    "/nope",
    "/mypage/nope",
    "/character",
    "/post",
    "/app.js",
    "/admin/",
    "/style.css",
  ])
    assert.equal(await site.route(path), null, path);

  // The owner's name, description, picture (else the logo) and address.
  setSettings(site, "design", {
    title: '아보 & "친구들" <커뮤>',
    description: "우리의 자캐 커뮤니티",
    logo: "https://media.naru.pub/logo.png",
    address: "https://avocado.example/",
  });
  const own = {
    name: '아보 & "친구들" <커뮤>',
    description: "우리의 자캐 커뮤니티",
    image: "https://media.naru.pub/logo.png",
  };
  const home = await site.route("/");
  assert.deepEqual(tags(home), {
    ...generic("https://avocado.example/", own),
  });
  // Escaped wherever it goes.
  assert.ok(!/<커뮤>|"친구들"/.test(home.head));
  assert.match(home.head, /&amp; &quot;친구들&quot; &lt;커뮤&gt;/);
  setSettings(site, "design", {
    shareImage: "https://media.naru.pub/share.png",
    logo: "https://media.naru.pub/logo.png",
    // Not HTTPS: neither is used.
    address: "javascript:alert(1)",
  });
  const shared = tags(await site.route("/members"));
  assert.equal(shared["og:image"], "https://media.naru.pub/share.png");
  assert.equal(shared["og:url"], "/members");
  // Without the owner's address, the address the page was asked on.
  const asked = tags(
    await site.route("/members", {}, "https://neo-avocado.naru.pub"),
  );
  assert.equal(asked["og:url"], "https://neo-avocado.naru.pub/members");
  assert.equal(asked.canonical, "https://neo-avocado.naru.pub/members");
  assert.equal(
    tags(await site.route("/members", {}, "javascript:alert(1)"))["og:url"],
    "/members",
  );
  // With it, the owner's address is the one canonical address.
  setSettings(site, "design", { address: "https://avocado.example" });
  assert.equal(
    tags(await site.route("/members", {}, "https://neo-avocado.naru.pub"))[
      "og:url"
    ],
    "https://avocado.example/members",
  );
});

test("a post's preview: its title, opening text and picture, else its speaker's", async () => {
  const site = await testSite();
  board(site, "free", {
    name: "자유",
    options: { description: "<p>아무 이야기나 <b>자유롭게</b></p>" },
  });
  const body = `<p>첫 문단 &amp; 이야기</p>\n<p>${"길게 ".repeat(60)}</p>`;
  const id = post(site, {
    title: "봄 소풍",
    format: "html",
    body,
    image: "https://media.naru.pub/picnic.png",
  });
  const shown = tags(await site.route(`/post/${id}`));
  assert.equal(shown.title, "봄 소풍 - 네오 아보카도");
  assert.equal(shown["og:title"], "봄 소풍");
  assert.equal(shown["og:type"], "article");
  assert.equal(shown["og:image"], "https://media.naru.pub/picnic.png");
  assert.equal(shown["twitter:card"], "summary_large_image");
  assert.equal(shown.canonical, `/post/${id}`);
  assert.equal(shown["og:url"], `/post/${id}`);
  // Plain text, on one line, 150 characters at most.
  assert.ok(shown["og:description"].startsWith("첫 문단 & 이야기 길게 길게"));
  assert.ok(shown["og:description"].endsWith("…"));
  assert.ok(shown["og:description"].length <= 150);
  assert.equal(shown.description, shown["og:description"]);
  // Its comment's address and its board's number show the same post.
  assert.deepEqual(tags(await site.route(`/post/${id}/comment/7`)), shown);
  assert.deepEqual(tags(await site.route("/logs/free/1")), shown);

  // No title: its board and number. No picture: the speaker's portrait.
  const speaker = {
    character: "3",
    name: "용사",
    portrait: "https://media.naru.pub/hero.png",
  };
  const plain = post(site, { body: "  안녕\n  하세요  ", speaker });
  const untitled = tags(await site.route(`/post/${plain}`));
  assert.equal(untitled["og:title"], "자유 No. 2");
  assert.equal(untitled["og:description"], "안녕 하세요");
  assert.equal(untitled["og:image"], "https://media.naru.pub/hero.png");
  // 익명 hides who spoke, so the portrait is not shown either.
  const anonymous = post(site, { body: "누구게", speaker, anonymous: 1 });
  const hidden = tags(await site.route(`/post/${anonymous}`));
  assert.equal(hidden["og:image"], undefined);
  assert.equal(hidden["twitter:card"], "summary");
  // A text post's angle brackets are its text, escaped.
  const tricky = post(site, {
    title: '"><script>alert(1)</script>',
    body: "<b>굵게</b> & 'quote'",
  });
  const answer = await site.route(`/post/${tricky}`);
  assert.ok(!answer.head.includes("<script>"));
  assert.ok(!answer.head.includes("<b>"));
  const escaped = tags(answer);
  assert.equal(escaped["og:title"], '"><script>alert(1)</script>');
  assert.equal(escaped["og:description"], "<b>굵게</b> & 'quote'");

  // Addresses that are no post's: 404. A post there is not: the site's own.
  assert.deepEqual(await site.route("/post/abc"), NOT_FOUND);
  assert.deepEqual(await site.route(`/post/${id}/comment/x`), NOT_FOUND);
  assert.deepEqual(await site.route("/logs/free/abc"), NOT_FOUND);
  assert.deepEqual(tags(await site.route("/post/999")), generic("/post/999"));
  assert.deepEqual(
    tags(await site.route("/logs/free/99")),
    generic("/logs/free/99"),
  );
});

test("a post a visitor may not read whole shows the site's preview", async () => {
  const site = await testSite();
  board(site, "free", { name: "자유" });
  board(site, "members", { name: "회원", read_level: 2 });
  board(site, "unlisted", { name: "목록 비공개", list_level: 2 });
  board(site, "off", { name: "닫힘", enabled: 0 });
  insert(site, "board_groups", { id: "club", name: "동아리", members_only: 1 });
  board(site, "club", { name: "동아리방", group_id: "club" });
  const secret = {
    title: "비밀",
    body: "비밀 이야기",
    image: "https://media.naru.pub/s.png",
  };
  const cases = {
    secret: post(site, { ...secret, secret: 1 }),
    membersOnly: post(site, { ...secret, members_only: 1 }),
    adult: post(site, { ...secret, adult: 1 }),
    readLevel: post(site, { ...secret, board: "members" }),
    disabled: post(site, { ...secret, board: "off" }),
    group: post(site, { ...secret, board: "club" }),
  };
  for (const [name, id] of Object.entries(cases)) {
    const answer = await site.route(`/post/${id}`);
    assert.deepEqual(tags(answer), generic(`/post/${id}`), name);
    assert.ok(!/비밀|s\.png/.test(answer.head), name);
  }
  // By number, a board whose list a visitor may not see hides its posts too
  // (posts:post asks for the list level), though they may read them by ID.
  const unlisted = post(site, { ...secret, board: "unlisted" });
  assert.deepEqual(
    tags(await site.route("/logs/unlisted/1")),
    generic("/logs/unlisted/1"),
  );
  assert.equal(tags(await site.route(`/post/${unlisted}`))["og:title"], "비밀");

  // 사이트공개 off: no preview at all, not even the site's own.
  const open = post(site, { ...secret });
  assert.equal(tags(await site.route(`/post/${open}`))["og:title"], "비밀");
  setSettings(site, "community", { siteOpen: false });
  for (const path of [`/post/${open}`, "/logs/free/1", "/members", "/"])
    assert.deepEqual(await site.route(path), CLOSED, path);
});

test("a board's preview: its name and description, while a visitor may list and read it", async () => {
  const site = await testSite();
  board(site, "free", {
    name: "자유",
    options: {
      description: "<p>아무 이야기나&nbsp;<b>자유롭게</b></p>",
      categories: ["잡담", "질문"],
    },
  });
  const shown = tags(await site.route("/logs/free"));
  assert.equal(shown.title, "자유 - 네오 아보카도");
  assert.equal(shown["og:description"], "아무 이야기나 자유롭게");
  assert.equal(shown["og:type"], "website");
  assert.equal(shown.canonical, "/logs/free");
  const at = (path) => site.route(path).then(tags);
  assert.equal((await at("/logs/free/page/2"))["og:title"], "자유");
  assert.equal((await at("/logs/free/page/2")).canonical, "/logs/free/page/2");
  // A tag or a search is the reader's own words: the board's name only.
  assert.equal((await at("/logs/free/tag/%EB%B4%84"))["og:title"], "자유");
  assert.equal((await at("/logs/free/search/x"))["og:title"], "자유");
  // Its own 분류 is named; another is not.
  const category = await at(
    `/logs/free/category/${encodeURIComponent("잡담")}`,
  );
  assert.equal(category["og:title"], "자유 · 잡담");
  assert.equal(
    category.canonical,
    `/logs/free/category/${encodeURIComponent("잡담")}`,
  );
  assert.equal(
    (await at(`/logs/free/category/${encodeURIComponent("잡담")}/page/3`))[
      "og:title"
    ],
    "자유 · 잡담",
  );
  assert.equal((await at("/logs/free/category/x"))["og:title"], "자유");
  assert.deepEqual(await site.route("/logs/free/page/x"), NOT_FOUND);
  assert.deepEqual(await site.route("/logs/free/category/x/page/0"), NOT_FOUND);

  // Boards a visitor may not list or read, and boards that are not.
  board(site, "staff", { name: "운영", list_level: 2 });
  board(site, "inside", { name: "내부", read_level: 2 });
  insert(site, "board_groups", { id: "club", name: "동아리", members_only: 1 });
  board(site, "club", { name: "동아리방", group_id: "club" });
  for (const path of [
    "/logs/staff",
    "/logs/inside",
    "/logs/club",
    "/logs/none",
  ])
    assert.deepEqual(await at(path), generic(path), path);
  setSettings(site, "community", { siteOpen: false });
  assert.deepEqual(await site.route("/logs/free"), CLOSED);
});

test("a character's preview: its name, profile and picture, while the site is open", async () => {
  const site = await testSite();
  const hero = character(site, {
    name: "용사",
    profile: "  마을을 지키는\n용사입니다.  ",
    image: "https://media.naru.pub/hero.png",
    state: "approved",
  });
  const shown = tags(await site.route(`/character/${hero}`));
  assert.equal(shown.title, "용사 - 네오 아보카도");
  assert.equal(shown["og:description"], "마을을 지키는 용사입니다.");
  assert.equal(shown["og:image"], "https://media.naru.pub/hero.png");
  assert.equal(shown["og:type"], "profile");
  assert.equal(shown.canonical, `/character/${hero}`);
  // Without a 두상, the 흉상.
  const mage = character(site, {
    name: "마법사",
    head: "https://media.naru.pub/mage.png",
  });
  assert.equal(
    tags(await site.route(`/character/${mage}`))["og:image"],
    "https://media.naru.pub/mage.png",
  );
  assert.deepEqual(
    tags(await site.route("/character/999")),
    generic("/character/999"),
  );
  assert.deepEqual(await site.route("/character/hero"), NOT_FOUND);
  // 사이트공개 off: characters are not a visitor's (characters' viewable).
  setSettings(site, "community", { siteOpen: false });
  assert.deepEqual(await site.route(`/character/${hero}`), CLOSED);
});

test("a content page's preview: its title, at a visitor's level", async () => {
  const site = await testSite();
  insert(site, "content", { id: "rules", name: "규칙", body: "<p>지켜요</p>" });
  insert(site, "content", { id: "staff", name: "운영 안내", read_level: 2 });
  insert(site, "content", { id: "draft", name: "준비 중", enabled: 0 });
  insert(site, "content", { id: "site_main", name: "메인" });
  const shown = tags(await site.route("/content/rules"));
  assert.equal(shown.title, "규칙 - 네오 아보카도");
  assert.equal(shown["og:title"], "규칙");
  assert.equal(shown.canonical, "/content/rules");
  for (const path of [
    "/content/staff",
    "/content/draft",
    "/content/site_main",
    "/content/none",
  ])
    assert.deepEqual(tags(await site.route(path)), generic(path), path);
  setSettings(site, "community", { siteOpen: false });
  assert.deepEqual(await site.route("/content/rules"), CLOSED);
});
