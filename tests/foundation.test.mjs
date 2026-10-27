// 실행: npm test
// The foundation's queries and mutations on a real SQLite database with the
// site's migrations (tests/sql-ctx.mjs): membership, presence, the site's
// frame and pages, and profiles. The owner's admin is tests/admin.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sqlOf, testSite } from "./sql-ctx.mjs";
import { M1, M2, OWNER, joined, refusal, setSettings } from "./helpers.mjs";

const wallet = (site, member) =>
  site.rows(
    "SELECT balance, last_daily FROM wallets WHERE member = ?",
    member,
  )[0];

test("the day's first visit pays the login reward once per Korean day, and joining the sign-up reward once", async () => {
  const site = await testSite({ now: Date.parse("2030-01-01T03:00:00Z") });
  // The original installs both at 0: nothing is paid, and nothing recorded.
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  await site.mutate("community/presence:seen", { where: "home" }, M1);
  assert.equal(wallet(site, "m-1").balance, 0);
  assert.equal(site.rows("SELECT * FROM history").length, 0);
  setSettings(site, "community", { loginReward: 100, signupReward: 30 });
  // The day was already marked; the next Korean day pays.
  await site.mutate(
    "community/presence:seen",
    { where: "home", visit: true },
    M1,
  );
  assert.equal(wallet(site, "m-1").balance, 0);
  // 2030-01-01 15:00 UTC is already 2 January in Korea.
  site.now = Date.parse("2030-01-01T15:00:00Z");
  await site.mutate("community/presence:seen", { where: "home" }, M1);
  await site.mutate(
    "community/presence:seen",
    { where: "shop", visit: true },
    M1,
  );
  assert.deepEqual(wallet(site, "m-1"), {
    balance: 100,
    last_daily: "2030-01-02",
  });
  assert.deepEqual(
    site.rows("SELECT owner, kind, delta, balance, memo FROM history"),
    [
      {
        owner: "m-1",
        kind: "daily",
        delta: 100,
        balance: 100,
        memo: "2030-01-02 첫로그인",
      },
    ],
  );
  // Changing the nickname is no new sign-up.
  await site.mutate("community/membership:join", { nick: "앨리스2" }, M1);
  assert.equal(wallet(site, "m-1").balance, 100);
  // A new member is paid on joining, once; before joining, nothing.
  await site.mutate("community/presence:seen", { where: "home" }, M2);
  assert.equal(wallet(site, "m-2"), undefined);
  await site.mutate("community/membership:join", { nick: "밥" }, M2);
  assert.equal(wallet(site, "m-2").balance, 30);
  await site.mutate("community/presence:seen", { where: "home" }, M2);
  assert.equal(wallet(site, "m-2").balance, 130);
  assert.equal(
    (await site.query("economy/wallet:wallet", null, M2)).balance,
    130,
  );
  // A member who left is paid nothing.
  await site.mutate(
    "community/membership:join",
    { nick: "캐럴" },
    { member: "m-3" },
  );
  site.run("UPDATE members SET left_on = '2030-01-02' WHERE member = 'm-3'");
  await site.mutate(
    "community/presence:seen",
    { where: "home" },
    { member: "m-3" },
  );
  assert.equal(wallet(site, "m-3").balance, 30);
  // An overflowing balance is refused, and nothing is kept.
  site.now += 86400000;
  site.run(
    "UPDATE wallets SET balance = ? WHERE member = 'm-1'",
    Number.MAX_SAFE_INTEGER,
  );
  await assert.rejects(
    site.mutate("community/presence:seen", { where: "home" }, M1),
    /Balance/,
  );
  assert.equal(wallet(site, "m-1").balance, Number.MAX_SAFE_INTEGER);
  assert.equal(await refusal(site.query("economy/wallet:wallet")), "sign_in");
});

test("joining refuses reserved and taken nicknames and asks agreement to the owner's rules", async () => {
  const site = await testSite();
  const join = (args, who = M1) =>
    site.mutate("community/membership:join", args, who);
  // The original's cf_prohibit_id until the owner writes their own.
  assert.equal(await refusal(join({ nick: "운영자" })), "reserved_nick");
  assert.equal(await refusal(join({ nick: "ADMIN" })), "reserved_nick");
  setSettings(site, "community", {
    reservedNicks: "별, 달",
    stipulation: "서로 존중합니다.",
    characterNotice: "",
  });
  assert.equal(await refusal(join({ nick: "달" })), "reserved_nick");
  assert.equal(await refusal(join({ nick: "아보" })), "not_agreed");
  assert.equal(site.rows("SELECT * FROM profiles").length, 0);
  site.now += 1000;
  const joined = await join({ nick: "운영자", agreed: true });
  assert.equal(joined.profile.data.nick, "운영자");
  assert.equal(joined.level, 2);
  assert.deepEqual(
    site.rows("SELECT level, requested_at, agreed_at FROM members"),
    [{ level: 2, requested_at: site.now, agreed_at: site.now }],
  );
  // A nickname is one member's.
  const taken = await join({ nick: "운영자", agreed: true }, M2).catch(
    (error) => error,
  );
  assert.equal(taken.code, "CONFLICT");
  assert.equal(taken.details.unique, "nick");
  assert.equal(taken.message, "이미 쓰는 닉네임입니다.");
  // Joining is a member's; the site's owner may take a reserved word.
  assert.equal(await refusal(join({ nick: "별" }, OWNER)), "sign_in");
  const { reservedNick } = await import("../dist/_naru/modules/access.js");
  assert.equal(await reservedNick({ owner: true, member: null }, "별"), false);
});

test("a member who leaves becomes a guest until the owner clears the date", async () => {
  const site = await testSite({ now: Date.parse("2030-01-01T16:00:00Z") });
  await site.mutate("community/membership:join", { nick: "떠날이" }, M1);
  site.run("UPDATE members SET level = 5 WHERE member = 'm-1'");
  assert.equal(
    await refusal(site.mutate("community/membership:leave", {}, M1)),
    "invalid_input",
  );
  assert.deepEqual(
    await site.mutate("community/membership:leave", { confirm: true }, M1),
    { left: true },
  );
  // The date is Korea's: 01:00 the next day there.
  assert.equal(
    site.rows("SELECT left_on FROM members")[0].left_on,
    "2030-01-02",
  );
  const left = await site.query("community/membership:membership", null, M1);
  assert.equal(left.left, true);
  assert.equal(left.level, 1);
  assert.equal(
    await refusal(
      site.mutate("community/membership:leave", { confirm: true }, M1),
    ),
    "left",
  );
  assert.equal(
    await refusal(
      site.mutate("community/membership:join", { nick: "다시" }, M1),
    ),
    "left",
  );
  // Their profile stays; the owner clears the date to let them back.
  assert.equal(left.profile.data.nick, "떠날이");
  site.run("UPDATE members SET left_on = NULL");
  assert.equal(
    (await site.query("community/membership:membership", null, M1)).level,
    5,
  );
});

test("membership answers level (1 before joining), roles, warnings and adult; staff and groups are Naru roles", async () => {
  const site = await testSite();
  assert.equal(
    await refusal(site.query("community/membership:membership")),
    "sign_in",
  );
  const before = await site.query("community/membership:membership", null, M1);
  assert.deepEqual(
    { ...before, profile: before.profile },
    {
      groups: [],
      level: 1,
      role: "member",
      warnings: 0,
      warningNote: "",
      adult: false,
      owner: false,
      memberId: "m-1",
      profile: null,
    },
  );
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  site.run(
    "UPDATE members SET warnings = 2, warning_note = '도배', adult = 1, level = 2",
  );
  site.setRoles("m-1", ["staff", "group-writers", "other"]);
  const status = await site.query("community/membership:membership", null, M1);
  assert.deepEqual(
    [
      status.warnings,
      status.warningNote,
      status.adult,
      status.role,
      status.groups,
      status.level,
    ],
    [2, "도배", true, "moderator", ["writers"], 2],
  );
  assert.deepEqual(status.profile, {
    id: "m-1",
    data: {
      owner: "m-1",
      nick: "앨리스",
      acceptMessages: true,
      commentAlerts: true,
      mainCharacter: null,
      createdAt: new Date(site.now).toISOString(),
      favorites: [],
    },
  });
  // Roles are the site's own (member_roles), read with ctx.sql alone.
  const { communityAccess } = await import("../dist/_naru/modules/access.js");
  const { sqlOf } = await import("./sql-ctx.mjs");
  const access = await communityAccess({
    member: { id: "m-1" },
    sql: sqlOf(site.db, "query"),
  });
  assert.deepEqual([access.role, access.groups], ["moderator", ["writers"]]);
});

test("visits record where members are and count each Korean day, bounded", async () => {
  const site = await testSite({ now: Date.parse("2030-01-01T15:30:00Z") });
  const seen = (args, who = M1) =>
    site.mutate("community/presence:seen", args, who);
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  await seen({
    where: "상점",
    visit: true,
    browser: "Chrome",
    os: "macOS",
    device: "PC",
    domain: "twitter.com",
  });
  // A member is one visitor a day: their second visit counts nothing.
  await seen({ where: "로그", visit: true, browser: "Firefox" });
  await site.mutate("community/membership:join", { nick: "밥" }, M2);
  await seen(
    {
      where: "로그",
      visit: true,
      browser: "<script>",
      os: "x".repeat(500),
    },
    M2,
  );
  assert.deepEqual(site.rows("SELECT * FROM presence"), [
    { member: "m-1", place: "로그", at: Date.parse("2030-01-01T15:30:00Z") },
    { member: "m-2", place: "로그", at: Date.parse("2030-01-01T15:30:00Z") },
  ]);
  // 15:30 UTC is 00:30 the next day in Korea.
  const day = () => {
    const row = site.rows("SELECT * FROM visits WHERE day = '2030-01-02'")[0];
    for (const key of [
      "members",
      "hours",
      "browsers",
      "os",
      "devices",
      "domains",
    ])
      row[key] = JSON.parse(row[key]);
    return row;
  };
  assert.equal(day().total, 2);
  assert.deepEqual(day().members, { "m-1": 1, "m-2": 1 });
  assert.deepEqual(day().hours, { 0: 2 });
  assert.deepEqual(day().browsers, { Chrome: 1, 기타: 1 });
  assert.deepEqual(day().os, { macOS: 1, 기타: 1 });
  assert.deepEqual(day().devices, { PC: 1, 기타: 1 });
  assert.deepEqual(day().domains, { "twitter.com": 1 });
  // Moving between pages says where a member is, and counts nothing.
  await seen({ where: "마이페이지" });
  assert.equal(
    site.rows("SELECT place FROM presence WHERE member = 'm-1'")[0].place,
    "마이페이지",
  );
  assert.equal(day().total, 2);
  // A visitor counts as a guest and is not listed as here.
  await seen({ visit: true }, {});
  await seen({}, {});
  assert.equal(day().guests, 1);
  assert.deepEqual(
    (await site.query("community/presence:online", null, M1)).members,
    [
      { nick: "밥", where: "로그", at: site.now },
      { nick: "앨리스", where: "마이페이지", at: site.now },
    ],
  );
  // Who is here is for members (and the owner), not visitors.
  assert.equal(
    await refusal(site.query("community/presence:online")),
    "sign_in",
  );
  site.now += 11 * 60 * 1000;
  assert.deepEqual(
    (await site.query("community/presence:online", null, OWNER)).members,
    [],
  );
  assert.equal(await refusal(seen({ where: 5 })), "invalid_input");
});

test("the owner is not 현재접속자, and a member before joining is nowhere", async () => {
  const site = await testSite();
  await site.mutate("community/presence:seen", { where: "home" }, M1);
  assert.equal(site.rows("SELECT * FROM presence").length, 0);
  await site.mutate("community/presence:seen", { where: "home" }, OWNER);
  assert.equal(site.rows("SELECT * FROM presence").length, 0);
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  await site.mutate("community/presence:seen", { where: "home" }, M1);
  assert.equal(
    (await site.query("community/presence:online", null, M1)).members.length,
    1,
  );
});

test("디자인 설정's styles become the design CSS, and nothing else does", async () => {
  const site = await testSite();
  setSettings(site, "design", {
    enabled: true,
    useHeader: false,
    menuPosition: "top",
    menuWidth: 240,
    menuHeight: "x",
    counter:
      '<a href="https://whos.amung.us/"><img src="https://c.example/c.png"></a>',
    styles: {
      notice: {
        background: "rgba(0, 0, 0, .5)",
        color: "#eee",
        borderColor: "#555555",
        borderStyle: "dashed",
        borderWidth: 1,
        borderSides: ["top", "bottom", "middle"],
      },
      comment: { margin: 10, background: "red;} body{display:none" },
      button: { color: "#fff", hoverBackground: "#222222" },
      menu: { image: 'https://c.example/m.png");}', color: "#000" },
      mobileMenu: { image: "https://c.example/m.png", fixed: "fixed" },
      input: { topLeft: 4, bottomRight: "8" },
      menuText: { color: "#ffffff", size: 14, hoverColor: "#29c7c9" },
      hashTag: { color: "#29c7c9", size: 30 },
      equalizer: { color: "#29c7c9", glow: "#000000" },
      unknown: { color: "#123456" },
    },
  });
  const { design } = await site.query("content/site:site");
  assert.equal(design.useHeader, false);
  assert.equal(design.menuPosition, "top");
  assert.equal(
    design.counter,
    '<a href="https://whos.amung.us/"><img src="https://c.example/c.png"></a>',
  );
  const { css } = design;
  // menu_width as set; menu_height malformed, the original's 50.
  assert.match(css, /--menu-width: 240px;\n  --menu-height: 50px;/);
  assert.match(
    css,
    /body\.site\.designed #boardDescription \{\n  background-color: rgba\(0, 0, 0, \.5\);\n  color: #eee;\n  border-top-color: #555555;\n  border-top-style: dashed;\n  border-top-width: 1px;\n  border-bottom-color: #555555;/,
  );
  assert.doesNotMatch(css, /border-middle/);
  // A colour that is not one is left out; the margin stays.
  assert.match(
    css,
    /body\.site\.designed \.comment \{\n  margin-bottom: 10px !important;\n\}/,
  );
  assert.match(
    css,
    /button:hover:not\(:disabled\)[^{]*\{\n  background: #222222;/,
  );
  // A picture's address must be plain HTTPS: the broken one is dropped.
  assert.doesNotMatch(css, /m\.png"\);\}/);
  assert.match(
    css,
    /@media \(max-width: 1024px\) \{\nbody\.site\.designed \.site-menu \{\n  background-image: url\("https:\/\/c\.example\/m\.png"\);\n  background-attachment: fixed;/,
  );
  assert.match(
    css,
    /border-top-left-radius: 4px;\n  border-bottom-right-radius: 8px;/,
  );
  assert.match(css, /\.site-menu a \{\n  color: #ffffff;\n  font-size: 14px;/);
  // 해시태그 has a colour only.
  assert.match(css, /\.hash-tag \{\n  color: #29c7c9;\n\}/);
  assert.match(css, /box-shadow: 0 0 3px 0 #000000/);
  assert.doesNotMatch(css, /#123456|display:none|\}\s*body\{/);
  // Nothing outside a rule's body: every line is a selector, a declaration or a brace.
  for (const line of css.split("\n").filter(Boolean))
    assert.match(
      line,
      /^(?:@media \([a-z-]+: \d+px\) \{|[^{};]+[,{]|  [a-z-]+: [^;{}]+;|\})$/,
      line,
    );
});

test("the site frame shows only safe design values and menus/banners a reader may see", async () => {
  const site = await testSite({ now: Date.parse("2030-01-01T03:00:00Z") });
  joined(site, "m-1");
  setSettings(site, "design", {
    title: "아보카도",
    logo: "javascript:alert(1)",
    background: "https://cdn.example/bg.png",
    mobileBackground: "http://cdn.example/m.png",
    mobileLogo: "https://cdn.example/m-logo.png",
    backgroundColor: "red;}",
    backgroundRepeat: "space;}",
    backgroundPosition: "center bottom",
    font: "comic",
    colors: { accent: "#123456", ink: "red;}" },
  });
  const menu = (id, name, link, more = {}) =>
    site.run(
      "INSERT INTO menus (id, name, link, sort_order, level, enabled) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      name,
      link,
      more.order ?? 0,
      more.level ?? 1,
      more.enabled ?? 1,
    );
  menu("a", "공지", "board:notice", { order: 2 });
  menu("b", "소개", "content:about", { order: 1 });
  menu("c", "운영", "tab:shop", { level: 2 });
  menu("d", "나쁜", "javascript:alert(1)");
  menu("e", "꺼짐", "board:x", { enabled: 0 });
  const banner = (id, image, place, startsAt, endsAt) =>
    site.run(
      "INSERT INTO banners (id, image, place, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)",
      id,
      image,
      place,
      startsAt,
      endsAt,
    );
  banner(
    "now",
    "https://cdn.example/1.png",
    "main",
    "2030-01-01T11:00",
    "2030-01-01T13:00",
  );
  banner(
    "later",
    "https://cdn.example/2.png",
    "main",
    "2030-01-01T13:00",
    null,
  );
  banner("intro", "https://cdn.example/3.png", "intro", null, null);
  const frame = await site.query("content/site:site");
  assert.deepEqual(frame.design, {
    // 디자인 사용 is off unless the owner turns it on.
    enabled: false,
    title: "아보카도",
    description: "",
    favicon: null,
    logo: null,
    mobileLogo: "https://cdn.example/m-logo.png",
    background: "https://cdn.example/bg.png",
    // Only HTTPS pictures, a #rrggbb colour and the listed choices.
    mobileBackground: null,
    backgroundColor: null,
    backgroundRepeat: "repeat",
    backgroundPosition: "center bottom",
    headerBackground: null,
    font: "sans",
    colors: { accent: "#123456" },
    useHeader: true,
    menuPosition: "left",
    css: ":root:has(body.site.designed) {\n  --menu-width: 200px;\n  --menu-height: 50px;\n}\n",
    // With 디자인 사용 off: no classes and no design layer.
    classes: [],
    layer: "",
    customCss: "",
    ownerMarks: { prefix: "▶", suffix: "◀" },
    counter: "",
  });
  assert.deepEqual(
    frame.menus.map((entry) => entry.id),
    ["b", "a"],
  );
  assert.deepEqual(frame.menus[0], {
    id: "b",
    name: "소개",
    link: "content:about",
    parent: null,
    newWindow: false,
    mobile: true,
  });
  assert.deepEqual(
    frame.banners.map((entry) => [entry.id, entry.place]),
    [
      ["intro", "intro"],
      ["now", "main"],
    ],
  );
  assert.equal(frame.level, 1);
  assert.equal(frame.member, false);
  assert.equal(frame.open, true);
  // No background music until the owner sets a YouTube link; only its ID
  // reaches pages.
  assert.equal(frame.bgm, null);
  setSettings(site, "community", {
    bgm: "https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  });
  assert.deepEqual((await site.query("content/site:site")).bgm, {
    list: "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  });
  setSettings(site, "community", { bgm: "javascript:alert(1)" });
  assert.equal((await site.query("content/site:site")).bgm, null);
  const member = await site.query("content/site:site", null, M1);
  assert.deepEqual(
    member.menus.map((entry) => entry.id),
    ["c", "b", "a"],
  );
  assert.equal(member.member, true);
  // Closed (사이트공개 off): visitors are below every level.
  setSettings(site, "community", { siteOpen: false });
  const closed = await site.query("content/site:site");
  assert.equal(closed.open, false);
  assert.equal(closed.level, 0);
  assert.deepEqual(closed.menus, []);
});

test("the site's frame names money and experience and says what a character's page shows", async () => {
  const site = await testSite();
  const { NAME_DEFAULTS } = await import("../dist/_naru/modules/access.js");
  const pages = await import("../dist/app/names.js");
  // The pages show the same defaults before the site's frame arrives.
  assert.deepEqual(pages.NAME_DEFAULTS, NAME_DEFAULTS);
  const frame = await site.query("content/site:site");
  assert.deepEqual(frame.names, NAME_DEFAULTS);
  assert.deepEqual(frame.viewer, {
    exp: true,
    rank: true,
    stats: true,
    titles: true,
    closet: true,
  });
  assert.deepEqual(
    frame.images.map((slot) => [slot.slot, slot.use]),
    [
      ["thumb", true],
      ["head", false],
      ["body", false],
    ],
  );
  setSettings(site, "community", {
    moneyName: "골드",
    moneyUnit: "G",
    expName: "포인트",
    sideTitle: "",
    classTitle: "  ",
    rankName: " ",
  });
  setSettings(site, "profile", {
    showStats: false,
    showCloset: false,
    bodyUse: true,
  });
  const { names, viewer, images } = await site.query("content/site:site");
  assert.equal(names.moneyUnit, "G");
  // An empty 소속 or 종족 hides it; an empty name for the rest is the default.
  assert.equal(names.sideTitle, "");
  assert.equal(names.classTitle, "");
  assert.equal(names.rankName, "랭킹");
  assert.deepEqual(viewer, {
    exp: true,
    rank: true,
    stats: false,
    titles: true,
    closet: false,
  });
  assert.equal(images[2].use, true);
  // Refusals and pages say them in the owner's names.
  const { lacking, subject } = await import("../dist/_naru/modules/access.js");
  const ctx = { member: null, sql: sqlOf(site.db, "query") };
  assert.equal(await lacking(ctx, "moneyName"), "골드가 모자랍니다.");
  assert.equal(subject("포인트"), "포인트가");
  assert.equal(subject("경험"), "경험이");
  assert.equal(subject("XP"), "XP이(가)");
  assert.equal(
    pages.rename("경험치·아보 지급 (네오 아보카도)", names),
    "포인트·골드 지급 (네오 아보카도)",
  );
});

test("content read levels and publication protect both metadata and selected bodies", async () => {
  const site = await testSite();
  joined(site, "m-1");
  const page = (id, fields) =>
    site.run(
      "INSERT INTO content (id, name, body, mobile_body, enabled, read_level) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      fields.name,
      fields.body,
      fields.mobileBody ?? "",
      fields.enabled ?? 1,
      fields.readLevel ?? 1,
    );
  page("guide", {
    name: "Guide",
    body: "Desktop",
    mobileBody: "Mobile",
    readLevel: 2,
  });
  page("restricted", { name: "Restricted", body: "Private", readLevel: 5 });
  page("draft", { name: "Draft", body: "Secret", enabled: 0 });
  const get = (args, who = M1) =>
    site.query("content/pages:contentPage", args, who);
  assert.deepEqual(await site.query("content/pages:contentPages", null, M1), {
    pages: [{ id: "guide", name: "Guide" }],
  });
  // A visitor is level 1.
  assert.deepEqual(await site.query("content/pages:contentPages"), {
    pages: [],
  });
  assert.equal((await get({ id: "guide" })).page.body, "Desktop");
  assert.deepEqual((await get({ id: "guide", mobile: true })).page, {
    name: "Guide",
    format: "html",
    body: "Mobile",
    headerImage: null,
    footerImage: null,
  });
  assert.equal(await refusal(get({ id: "restricted" })), "document_not_found");
  assert.equal(await refusal(get({ id: "draft" })), "document_not_found");
  assert.equal(await refusal(get({ id: 5 })), "invalid_input");
  site.run("INSERT OR REPLACE INTO members (member, level) VALUES ('m-1', 5)");
  assert.equal((await get({ id: "restricted" })).page.body, "Private");
});

test("a readable site_main page takes the home's place, and is not an 안내 page", async () => {
  const site = await testSite();
  assert.equal((await site.query("content/site:site", null, M1)).main, false);
  // Without a read level a page is everyone's, as the original's have none.
  site.run(
    "INSERT INTO content (id, name, body) VALUES ('site_main', '메인', '<p>환영합니다</p>'), ('rules', '규칙', '...')",
  );
  assert.equal((await site.query("content/site:site", null, M1)).main, true);
  assert.deepEqual(
    (await site.query("content/pages:contentPages", null, M1)).pages.map(
      (entry) => entry.id,
    ),
    ["rules"],
  );
  assert.equal((await site.query("content/site:site")).main, true);
  assert.equal(
    (await site.query("content/pages:contentPage", { id: "site_main" })).page
      .body,
    "<p>환영합니다</p>",
  );
});

test("quest reads enforce Korean start/end boundaries, categories and pagination", async () => {
  const site = await testSite({ now: Date.parse("2030-01-01T00:00:00Z") });
  const quest = (id, type, startsAt = null, endsAt = null, images = "[]") =>
    site.run(
      "INSERT INTO quests (id, name, type, starts_at, ends_at, images) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      id,
      type,
      startsAt,
      endsAt,
      images,
    );
  quest(
    "active",
    "daily",
    "2030-01-01T09:00",
    "2030-01-01T10:00",
    '["https://cdn.example/q.png", 5]',
  );
  quest("future", "daily", "2030-01-01T10:00");
  quest("ended", "daily", null, "2030-01-01T09:00");
  quest("corrupt", "daily", "2030-02-30T09:00");
  quest("weekly", "weekly");
  const quests = (args, who = M1) =>
    site.query("content/quests:quests", args, who);
  const daily = await quests({ type: "daily" });
  assert.deepEqual(daily.quests, [
    {
      id: "active",
      name: "active",
      type: "daily",
      side: "",
      startsAt: "2030-01-01T09:00",
      endsAt: "2030-01-01T10:00",
      images: ["https://cdn.example/q.png"],
    },
  ]);
  assert.deepEqual(
    (await quests({ type: "weekly" })).quests.map((row) => row.id),
    ["weekly"],
  );
  assert.equal((await quests({}, OWNER)).quests.length, 2);
  assert.equal(await refusal(quests({ type: "bad" })), "invalid_input");
  assert.equal(await refusal(quests({}, {})), "sign_in");
  for (let i = 0; i < 60; i++)
    quest(`extra${String(i).padStart(2, "0")}`, "weekly");
  const page = await quests({ type: "weekly" });
  assert.equal(page.quests.length, 50);
  assert.equal(
    (await quests({ type: "weekly", after: page.nextCursor })).quests.length,
    11,
  );
});

test("nicknames are read by ID or found by name, and a closed site shows visitors none", async () => {
  const site = await testSite();
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  await site.mutate(
    "community/membership:join",
    { nick: "밥", acceptMessages: false },
    M2,
  );
  site.run(
    "INSERT INTO profiles (member, nick, deleted_at, joined_at) VALUES ('m-3', '지운이', 1, 0)",
  );
  assert.deepEqual(
    await site.query("community/profiles:nicks", {
      ids: ["m-1", "m-2", "m-3", "m-9", "m-1"],
    }),
    { nicks: { "m-1": "앨리스", "m-2": "밥" } },
  );
  assert.deepEqual(
    await site.query("community/profiles:find", { nicks: ["밥", "없음"] }, M1),
    { profiles: [{ id: "m-2", nick: "밥", acceptMessages: false }] },
  );
  assert.equal(
    await refusal(site.query("community/profiles:nicks", { ids: "m-1" })),
    "invalid_input",
  );
  setSettings(site, "community", { siteOpen: false });
  assert.deepEqual(
    await site.query("community/profiles:nicks", { ids: ["m-1"] }),
    { nicks: {} },
  );
  assert.deepEqual(
    await site.query("community/profiles:nicks", { ids: ["m-1"] }, M2),
    { nicks: { "m-1": "앨리스" } },
  );
  assert.equal(
    (await site.query("community/profiles:own", null, M2)).profile.data
      .acceptMessages,
    false,
  );
  assert.deepEqual(
    await site.query("community/profiles:own", null, { member: "m-9" }),
    { profile: null },
  );
});

test("a member edits their own nickname and preferences, within the owner's rules", async () => {
  const site = await testSite();
  const update = (args, who = M1) =>
    site.mutate("community/profiles:update", args, who);
  const valid = { acceptMessages: false, commentAlerts: true };
  assert.equal(
    await refusal(update({ nick: "앨리스", ...valid })),
    "no_profile",
  );
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  await site.mutate("community/membership:join", { nick: "밥" }, M2);
  site.run("UPDATE profiles SET main_character = 'hero' WHERE member = 'm-1'");
  const { profile } = await update({ nick: "앨리", ...valid });
  assert.deepEqual(profile.data, {
    owner: "m-1",
    nick: "앨리",
    acceptMessages: false,
    commentAlerts: true,
    mainCharacter: "hero",
    createdAt: new Date(site.now).toISOString(),
    favorites: [],
  });
  for (const bad of [
    { nick: " 앨리", ...valid },
    { nick: "", ...valid },
    { nick: "가".repeat(21), ...valid },
    { nick: "앨리", acceptMessages: "no", commentAlerts: true },
  ])
    assert.equal(await refusal(update(bad)), "invalid_input");
  // Only Hangul, letters and digits, as joining asks: no lookalike of a
  // reserved word or another's name.
  for (const nick of ["관​리자", "аdmin", "밥ㅤ", "앨 리", "앨리!"])
    assert.equal(
      await refusal(update({ nick, ...valid })),
      "invalid_nick",
      nick,
    );
  assert.equal(
    await refusal(update({ nick: "관리자", ...valid })),
    "reserved_nick",
  );
  assert.equal(await refusal(update({ nick: "밥", ...valid })), "nick_taken");
  // A nickname taken before the owner reserved it may stay.
  setSettings(site, "community", { reservedNicks: "앨리" });
  assert.equal(
    (await update({ nick: "앨리", acceptMessages: true, commentAlerts: false }))
      .profile.data.commentAlerts,
    false,
  );
  assert.equal(
    await refusal(update({ nick: "앨리", ...valid }, {})),
    "sign_in",
  );
});

test("members read the community settings their pages need, and nothing else", async () => {
  const site = await testSite();
  setSettings(site, "community", {
    messageCost: 5,
    loginReward: 100,
    stipulation: "규칙",
    characterLimit: 0,
  });
  assert.deepEqual(await site.query("content/site:settings", null, M1), {
    initialStatPoints: 0,
    messageCost: 5,
    shopCategories: "일반, 이벤트",
    shopNpc: null,
    shopGreeting: "",
    characterCreation: true,
    characterEditing: true,
    characterLimit: 0,
    stipulation: "규칙",
    characterNotice: "",
    reservedNicks:
      "admin,administrator,관리자,운영자,어드민,주인장,webmaster,웹마스터,sysop,시삽,시샵,manager,매니저,메니저,root,루트,su,guest,방문객",
    useRecommend: false,
  });
  assert.equal(await refusal(site.query("content/site:settings")), "sign_in");
});

test("게시판 기본 설정: rows a list reads, page links and where links open, for the pages", async () => {
  const site = await testSite();
  assert.deepEqual((await site.query("content/site:site")).paging, {
    rows: 20,
    pages: 10,
    mobilePages: 5,
    linkTarget: "_blank",
  });
  setSettings(site, "community", {
    pageRows: 15,
    writePages: 7,
    mobilePages: 99,
    linkTarget: "javascript:",
  });
  assert.deepEqual((await site.query("content/site:site")).paging, {
    rows: 15,
    pages: 7,
    mobilePages: 20,
    linkTarget: "_blank",
  });
  setSettings(site, "community", { linkTarget: "_self", pageRows: 100 });
  const { paging } = await site.query("content/site:site");
  assert.equal(paging.linkTarget, "_self");
  assert.equal(paging.rows, 20);
});

test("a new member starts at 회원가입시 권한, 2 until the owner sets it", async () => {
  const site = await testSite();
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  assert.equal(site.rows("SELECT level FROM members")[0].level, 2);
  setSettings(site, "community", { registerLevel: "4" });
  await site.mutate("community/membership:join", { nick: "밥" }, M2);
  assert.equal(
    site.rows("SELECT level FROM members WHERE member = 'm-2'")[0].level,
    4,
  );
  // Changing a nickname keeps the level the member has.
  setSettings(site, "community", { registerLevel: "6" });
  await site.mutate("community/membership:join", { nick: "밥2" }, M2);
  assert.equal(
    site.rows("SELECT level FROM members WHERE member = 'm-2'")[0].level,
    4,
  );
});

test("디자인's 로그 card and 원글 작성자 styles, and the writer's 접두·접미문자 with or without design", async () => {
  const site = await testSite();
  // A fresh site shows the original's ▶ and ◀, design or not.
  let { design } = await site.query("content/site:site");
  assert.deepEqual(design.ownerMarks, { prefix: "▶", suffix: "◀" });
  setSettings(site, "design", {
    enabled: true,
    styles: {
      logItem: {
        background: "#111111",
        margin: 30,
        borderColor: "#333333",
        borderStyle: "solid",
        borderWidth: 2,
        borderSides: ["bottom"],
      },
      ownerName: { color: "#29c7c9", size: 13, prefix: "★", suffix: "" },
    },
  });
  ({ design } = await site.query("content/site:site"));
  assert.match(
    design.css,
    /body\.site\.designed #logs > \.log \{\n  background-color: #111111;\n  border-bottom-color: #333333;\n  border-bottom-style: solid;\n  border-bottom-width: 2px;\n  margin-bottom: 30px !important;\n\}/,
  );
  assert.match(
    design.css,
    /body\.site\.designed \.comment\.owner > \.author \{\n  color: #29c7c9;\n  font-size: 13px;\n\}/,
  );
  // The marks are text for the page, never CSS; a cleared one stays blank.
  assert.doesNotMatch(design.css, /★/);
  assert.deepEqual(design.ownerMarks, { prefix: "★", suffix: "" });
});

test("names are suggested to members as they type: nicknames, and approved characters", async () => {
  const site = await testSite();
  await site.mutate("community/membership:join", { nick: "앨리스" }, M1);
  await site.mutate("community/membership:join", { nick: "앨가리" }, M2);
  site.run(
    "INSERT INTO characters (id, owner, name, state, created_at) VALUES (1, 'm-1', '아보 카도', 'approved', 0), (2, 'm-2', '아보 씨앗', 'editing', 0)",
  );
  site.run("UPDATE profiles SET main_character = '1' WHERE member = 'm-1'");
  assert.equal(
    await refusal(
      site.query("community/profiles:suggest", { kind: "member", text: "앨" }),
    ),
    "sign_in",
  );
  const named = (kind, text) =>
    site
      .query("community/profiles:suggest", { kind, text }, M2)
      .then(({ names }) => names);
  assert.deepEqual(await named("member", "앨"), [
    { name: "앨가리", detail: null },
    { name: "앨리스", detail: "아보 카도" },
  ]);
  // LIKE's own characters are only themselves.
  // LIKE's own characters are only themselves.
  assert.deepEqual(await named("member", "_"), []);
  assert.deepEqual(await named("character", "아보"), [
    { name: "아보 카도", detail: "앨리스" },
  ]);
  assert.deepEqual(await named("character", " "), []);
});

test("관리자 아이콘 reaches every reader's frame, when it is plain HTTPS", async () => {
  const site = await testSite();
  assert.equal((await site.query("content/site:site")).adminIcon, null);
  setSettings(site, "community", { adminIcon: "javascript:alert(1)" });
  assert.equal((await site.query("content/site:site")).adminIcon, null);
  setSettings(site, "community", { adminIcon: "https://media.example/a.png" });
  assert.equal(
    (await site.query("content/site:site")).adminIcon,
    "https://media.example/a.png",
  );
});

test("프로필 양식's 이름 is named and explained as the owner says (ad_text_name, ad_help_name)", async () => {
  const site = await testSite();
  assert.deepEqual((await site.query("content/site:site")).nameField, {
    label: "이름",
    help: "",
  });
  setSettings(site, "profile", { nameLabel: "캐릭터명", nameHelp: "풀네임" });
  assert.deepEqual((await site.query("content/site:site")).nameField, {
    label: "캐릭터명",
    help: "풀네임",
  });
});

test("출생년도 is given on joining or later, shown on 계정정보, and checked", async () => {
  const site = await testSite();
  await site.mutate(
    "community/membership:join",
    { nick: "앨리스", birthYear: 1999 },
    M1,
  );
  const own = async () =>
    (await site.query("community/profiles:own", {}, M1)).profile.data;
  assert.equal((await own()).birthYear, 1999);
  const update = (birthYear) =>
    site.mutate(
      "community/profiles:update",
      { nick: "앨리스", acceptMessages: true, commentAlerts: true, birthYear },
      M1,
    );
  await update(2001);
  assert.equal((await own()).birthYear, 2001);
  await update(null);
  assert.equal((await own()).birthYear, undefined);
  assert.equal(await refusal(update(1800)), "invalid_input");
});

test("사용자 CSS reaches every reader, whether 디자인 사용 is on or not, as the owner wrote it", async () => {
  const site = await testSite();
  const css =
    ":root { --avocado: #c04 !important; }\n.log-title { font-weight: bold; }";
  for (const enabled of [false, true]) {
    setSettings(site, "design", { enabled, customCss: css });
    const { design } = await site.query("content/site:site");
    assert.equal(design.customCss, css);
  }
  setSettings(site, "design", { customCss: "x".repeat(60000) });
  assert.equal(
    (await site.query("content/site:site")).design.customCss.length,
    50000,
  );
  setSettings(site, "design", { customCss: 7 });
  assert.equal((await site.query("content/site:site")).design.customCss, "");
});
