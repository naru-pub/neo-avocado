// The site's look and navigation: design, menus, banners and the intro.

import { $, addressOf, run, say, showTab, state, query } from "./core.js";
import { configureBoard, loadLogs } from "./logs.js";
import { loadContentBody, loadContentPages } from "./content.js";
import { NAME_DEFAULTS } from "./names.js";
import { renderContent } from "../shared/content-renderer.js";
import { showRecent, showSearch } from "./across.js";
import { loadPoll, showPopups } from "./polls.js";

/** Applies the owner's design, menus and banners (adm/design_form.php, menu_list.php). */
export async function loadSite() {
  const site = await query("content/site:site");
  const { design } = site;
  state.siteOpen = site.open !== false;
  state.names = { ...NAME_DEFAULTS, ...site.names };
  state.adminIcon = site.adminIcon ?? null;
  state.sideIcons = site.sideIcons ?? {};
  state.twitter = site.twitter ?? null;
  if (Array.isArray(site.images)) state.images = site.images;
  if (site.nameField) {
    state.nameField = site.nameField;
    // The new character form's name, as the owner names it.
    $("characterNameLabel").firstChild.textContent = `${site.nameField.label} `;
    $("characterNameHelp").textContent = site.nameField.help;
    $("characterNameHelp").hidden = !site.nameField.help;
  }
  if (site.viewer) state.viewer = { ...state.viewer, ...site.viewer };
  applyItemNames(state.names);
  // Without 디자인 사용 the page is plain (plain.css), as the original
  // without its design CSS: the title, logo, menus and slides still apply.
  document.body.classList.toggle("designed", design.enabled);
  applyNames(design);
  applyHead(design);
  renderMenus(site.menus);
  if (site.menuPage) await showMenuPage(site.banners);
  const entering = showEntrance(site, design);
  renderBanners(site.banners, entering);
  // 팝업레이어 and 설문조사 on the main page; neither holds the page up.
  showPopups(site.popups ?? []);
  loadPoll(site.poll ?? null).catch(() => ($("pollBox").hidden = true));
  await showMainPage(site.main === true, site.banners);
  setMusic(site.bgm);
  state.alarmSound = site.alarmSound === true;
  state.combining = site.recipes !== false;
  // 금액 사용 off: 화폐관리 is not in 마이페이지 (mypage/_head.php:19).
  $("myMoneyTab").hidden = site.money !== true;
  if (site.paging) state.paging = { ...state.paging, ...site.paging };
  state.counter = design.enabled ? (design.counter ?? "") : "";
  state.ownerMarks = design.ownerMarks ?? { prefix: "▶", suffix: "◀" };
  // The look as the server made it (designLook in _naru/modules/design.ts),
  // which each page's head already carries (previews.ts), so this only
  // refreshes it: the <body> classes, the `design` layer after the
  // template's, and 사용자 CSS in no layer, whose unlayered rules beat every
  // layer's, so the owner's need no !important or matching selectors.
  for (const name of ["no-header", "menu-top", "font-serif", "font-mono"])
    document.body.classList.toggle(name, (design.classes ?? []).includes(name));
  let styles = document.getElementById("designStyles");
  if (!styles) {
    styles = document.createElement("style");
    styles.id = "designStyles";
    document.head.append(styles);
  }
  styles.textContent = design.layer ?? "";
  // The owner's stylesheet in Naru's _owner/ folder, which no template
  // update touches: before 사용자 CSS, which keeps the last word.
  const file = document.getElementById("ownerFile");
  if (design.ownerFiles && !file) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = "ownerFile";
    link.href = "/_owner/style.css";
    document.head.append(link);
  } else if (!design.ownerFiles) file?.remove();
  let own = document.getElementById("ownerStyles");
  if (!own) {
    own = document.createElement("style");
    own.id = "ownerStyles";
  }
  // Last in <head>, after the design's.
  document.head.append(own);
  own.textContent = design.customCss ?? "";
  // And its script, once the template's has set the page up.
  if (design.ownerFiles && !document.getElementById("ownerScript")) {
    const script = document.createElement("script");
    script.type = "module";
    script.id = "ownerScript";
    script.src = "/_owner/script.js";
    document.body.append(script);
  }
}
/**
 * The owner's names in the page's own text (기타 항목명 설정); a 소속 or 종족
 * left untitled is hidden, as in the original's profile.
 */
function applyItemNames(names) {
  for (const element of document.querySelectorAll<HTMLElement>("[data-name]"))
    element.textContent = names[element.dataset.name];
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-name-shown]",
  ))
    element.hidden = !names[element.dataset.nameShown];
}
/**
 * cf_site_descript and cf_favicon (head.sub.php): the page's description
 * and the browser tab's icon, when the owner sets them, for the open tab.
 */
function applyHead(design) {
  // Without the owner's own, the route's tags stay (link previews read
  // those, which _naru/routes/ add: crawlers do not run this script).
  const set = (selector, create, attribute, value) => {
    let element = document.head.querySelector(selector);
    if (!value) return;
    if (!element) document.head.append((element = create()));
    element.setAttribute(attribute, value);
  };
  set(
    'meta[name="description"]',
    () =>
      Object.assign(document.createElement("meta"), { name: "description" }),
    "content",
    design.description,
  );
  set(
    'link[rel="icon"]',
    () => Object.assign(document.createElement("link"), { rel: "icon" }),
    "href",
    design.favicon,
  );
}
/**
 * 메인화면 구성 (main.php): the owner's site_main page in the home's place,
 * or the home as it is. Its placeholders become the parts they name.
 */
async function showMainPage(enabled, banners) {
  // The card a previous {{OUTLOGIN}} moved returns home first.
  cardHome.parent.insertBefore($("profileCard"), cardHome.next);
  $("mainPage").hidden = !enabled;
  if (enabled) $("banners").hidden = true;
  if (!enabled) return;
  const result = await query("content/pages:contentPage", {
    id: "site_main",
    mobile: window.innerWidth <= 700,
  });
  renderContent($("mainPage"), result.page);
  expandPlaceholders(
    $("mainPage"),
    banners.filter((banner) => banner.place === "main"),
  );
}
/**
 * 화면 설정's 메뉴영역 (head.php:56): the owner's site_menu page in the
 * menu's place, its 모바일 메뉴영역 on a phone, its placeholders expanded;
 * 운영 still closes it.
 */
async function showMenuPage(banners) {
  const result = await query("content/pages:contentPage", {
    id: "site_menu",
    mobile: window.innerWidth <= 700,
  });
  const nav = $("siteMenu");
  const area = document.createElement("div");
  area.className = "menu-content";
  renderContent(area, result.page);
  expandPlaceholders(
    area,
    banners.filter((banner) => banner.place === "main"),
  );
  const admin = document.createElement("ul");
  admin.append(adminItem());
  nav.replaceChildren(area, admin);
  nav.hidden = false;
}
/** Where the member card lives on the home, for {{OUTLOGIN}} to give back. */
const cardHome = {
  parent: $("profileCard").parentElement,
  next: $("profileCard").nextSibling,
};
/** A link that does what a page control does, for a placeholder. */
function controlLink(text, href, className, action) {
  const link = document.createElement("a");
  link.href = href;
  link.className = className;
  link.textContent = text;
  link.onclick = (event) => {
    event.preventDefault();
    action();
  };
  return link;
}
/**
 * extend/community.config.php's get_site_content: {{VISUAL_SLIDE}} the main
 * slides, {{OUTLOGIN}} the member card, {{LOGIN}}, {{JOIN}}, {{LOGOUT}} and
 * {{MYPAGE}} links that show to guests or members as the original's, and
 * {{BGM}} nothing (the music plays from the header) and {{TWITTER}} the
 * owner's timeline (templete/txt.twitter.php). Others stay as written. The page is sanitized
 * already; the parts are the page's own elements, put in as nodes.
 */
/**
 * templete/txt.twitter.php: cf_twitter's timeline, by X's own widget, with
 * the account's link standing where the widget does not load.
 */
function twitterTimeline() {
  if (!state.twitter) return null;
  const box = document.createElement("div");
  box.className = "twitter theme-box";
  const link = Object.assign(document.createElement("a"), {
    className: "twitter-timeline",
    href: `https://twitter.com/${state.twitter}`,
    target: "_blank",
    rel: "noopener",
    textContent: `@${state.twitter}`,
  });
  link.dataset.height = "310";
  box.append(link);
  if (!document.getElementById("twitterWidgets")) {
    const script = document.createElement("script");
    script.id = "twitterWidgets";
    script.async = true;
    script.src = "https://platform.twitter.com/widgets.js";
    document.head.append(script);
  }
  return box;
}
function expandPlaceholders(container: HTMLElement, slides) {
  const parts = {
    VISUAL_SLIDE: () => {
      const element = document.createElement("div");
      showSlides(element, slides);
      return element;
    },
    OUTLOGIN: () => $("profileCard"),
    LOGIN: () =>
      controlLink("로그인", "#", "guest-only", () => $("signIn").click()),
    // Naru's sign-in is where a visitor becomes a member.
    JOIN: () =>
      controlLink("회원가입", "#", "guest-only", () => $("signIn").click()),
    LOGOUT: () =>
      controlLink("로그아웃", "#", "member-only", () => $("signOut").click()),
    MYPAGE: () =>
      controlLink("마이페이지", "/mypage", "member-only", () =>
        $("tabMypage").click(),
      ),
    BGM: () => null,
    TWITTER: () => twitterTimeline(),
  };
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const node of texts) {
    const pieces = node.data.split(/\{\{([A-Z_]+)\}\}/);
    if (pieces.length === 1) continue;
    // split() with a group: text, name, text, name, …, text.
    const replacement = pieces.map((piece, index) => {
      if (index % 2 === 0) return piece;
      if (!Object.hasOwn(parts, piece)) return `{{${piece}}}`;
      return parts[piece]() ?? "";
    });
    node.replaceWith(...replacement);
  }
}
/** The site's name and logo, in the header. */
function applyNames(design) {
  if (design.title) {
    $("siteTitle").textContent = design.title;
    document.title = design.title;
  }
  $("siteLogo").hidden = !design.logo;
  $("siteTitle").hidden = Boolean(design.logo);
  if (design.logo) {
    $<HTMLImageElement>("siteLogo").src = design.logo;
    $<HTMLImageElement>("siteLogo").alt = design.title || "";
  }
  // m_logo: a phone's own logo, as the original's mobile header.
  if (design.logo && design.mobileLogo)
    $<HTMLSourceElement>("siteLogoMobile").srcset = design.mobileLogo;
  else $("siteLogoMobile").removeAttribute("srcset");
}
function menuLink(menu) {
  const link = document.createElement("a");
  link.textContent = menu.name;
  if (menu.link.startsWith("https://")) {
    link.href = menu.link;
    if (menu.newWindow) {
      link.target = "_blank";
      link.rel = "noopener";
    }
    return link;
  }
  link.href = menuAddress(menu.link);
  link.onclick = (event) => {
    event.preventDefault();
    document.body.classList.remove("open-gnb");
    run(() => follow(menu.link));
  };
  return link;
}
/** head.php's menu when the owner has not designed one (#no_design_gnb). */
// The original's menu without a design (head.php #no_design_gnb), with the
// boards first and neo-avocado's quests and pages after.
const DEFAULT_MENUS = [
  ["로그", "tab:logs"],
  ["멤버목록", "tab:members"],
  ["신청자목록", "tab:applicants"],
  ["커플목록", "tab:couples"],
  ["상점", "tab:shop", true],
  ["마이페이지", "tab:mypage", true],
  ["현재접속자", "tab:online", true],
  ["퀘스트", "tab:quests", true],
  ["안내", "tab:content"],
].map(([name, link, memberOnly]) => ({
  id: link,
  name,
  link,
  parent: null,
  mobile: true,
  memberOnly,
}));
/** The menu's last item: 운영, to the admin. */
function adminItem() {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = "/admin/";
  link.textContent = "운영";
  item.append(link);
  return item;
}
function renderMenus(menus) {
  const nav = $("siteMenu");
  nav.replaceChildren();
  if (!menus.length) menus = DEFAULT_MENUS;
  const top = menus.filter(
    (menu) => !menu.parent || !menus.some((row) => row.id === menu.parent),
  );
  if (!top.length) return void (nav.hidden = true);
  const list = document.createElement("ul");
  for (const menu of top) {
    const item = document.createElement("li");
    if (!menu.mobile) item.className = "desktop-only";
    if (menu.memberOnly) item.classList.add("member-only");
    item.append(menuLink(menu));
    const children = menus.filter((row) => row.parent === menu.id);
    if (children.length) {
      const sub = document.createElement("ul");
      for (const child of children) {
        const entry = document.createElement("li");
        if (!child.mobile) entry.className = "desktop-only";
        entry.append(menuLink(child));
        sub.append(entry);
      }
      item.append(sub);
    }
    list.append(item);
  }
  // 운영 closes every menu, the owner's or the default.
  list.append(adminItem());
  nav.append(list);
  nav.hidden = false;
}
function bannerPicture(banner, linked = true) {
  const picture = document.createElement("picture");
  if (banner.mobileImage) {
    const source = document.createElement("source");
    source.media = "(max-width: 700px)";
    source.srcset = banner.mobileImage;
    picture.append(source);
  }
  const image = document.createElement("img");
  image.src = banner.image;
  image.alt = banner.alt;
  picture.append(image);
  if (!banner.url || !linked) return picture;
  const link = document.createElement("a");
  link.href = banner.url;
  if (banner.newWindow) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  link.append(picture);
  return link;
}
/** How to stop each slider's turning, when it is drawn again. */
const stopping = new WeakMap<HTMLElement, () => void>();
/**
 * templete/txt.visual.php's slider (display_banner(…, 'slide', '5000')): one
 * slide at a time, the next every five seconds, held while the pointer or
 * focus is on it, with 이전·다음 buttons. With reduced motion asked for, it
 * turns only by the buttons.
 */
function showSlides(container: HTMLElement, banners) {
  stopping.get(container)?.();
  stopping.delete(container);
  container.className = "banners";
  container.setAttribute("role", "region");
  container.setAttribute("aria-roledescription", "carousel");
  container.setAttribute("aria-label", "메인 슬라이드");
  const slides = banners.map((banner, index) => {
    const slide = document.createElement("div");
    slide.className = "slide";
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", `${index + 1} / ${banners.length}`);
    slide.hidden = index > 0;
    slide.append(bannerPicture(banner));
    return slide;
  });
  container.replaceChildren(...slides);
  if (slides.length < 2) return;
  let current = 0;
  const go = (step) => {
    slides[current].hidden = true;
    current = (current + step + slides.length) % slides.length;
    slides[current].hidden = false;
  };
  const button = (text, className, step) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `slide-nav ${className}`;
    element.setAttribute("aria-label", text);
    element.textContent = step < 0 ? "‹" : "›";
    element.onclick = () => go(step);
    return element;
  };
  container.append(
    button("이전 슬라이드", "previous", -1),
    button("다음 슬라이드", "next", 1),
  );
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  let held = 0;
  const hold = (change) => () => (held = Math.max(0, held + change));
  container.addEventListener("mouseenter", hold(1));
  container.addEventListener("mouseleave", hold(-1));
  container.addEventListener("focusin", hold(1));
  container.addEventListener("focusout", hold(-1));
  // It turns while the page is in view, and stops once off the page.
  let timer = null;
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", turn);
  };
  function turn() {
    clearInterval(timer);
    timer = null;
    if (document.hidden) return;
    timer = setInterval(() => {
      if (!container.isConnected) return stop();
      if (!held) go(1);
    }, 5000);
  }
  document.addEventListener("visibilitychange", turn);
  stopping.set(container, stop);
  turn();
}
/** Whether the page was opened at the home (/, or /home). */
const arrivedHome = /^\/((home|index\.html)\/?)?$/.test(location.pathname);
const INTRO_KEY = "neo-avocado-intro-closed";
const ENTRANCE_KEY = "neo-avocado-entered";
/** What runs once the entrance is clicked through: the intro, if any. */
let afterEntrance: (() => void) | null = null;
/**
 * enter.php (index.php:57-64): a visitor, not signed in, arriving at an open
 * site's home sees its logo (or name) first, once a browser session, and
 * clicks through to the main page. index.html opens it on arrival, from the
 * home's route; this settles it once the site is known. Answers whether it
 * shows.
 */
function showEntrance(site, design) {
  let entered = false;
  try {
    entered = sessionStorage.getItem(ENTRANCE_KEY) === "1";
  } catch {
    /* Without storage the entrance shows on each arrival. */
  }
  const dialog = $<HTMLDialogElement>("entrance");
  if (site.member || site.open === false || !arrivedHome || entered) {
    // Opened on arrival for a member index.html took for a visitor.
    dialog.close();
    return false;
  }
  const logo = $<HTMLImageElement>("entranceLogo");
  logo.hidden = !design.logo;
  if (design.logo) logo.src = design.logo;
  $("entranceTitle").textContent = design.logo
    ? ""
    : design.title || $("siteTitle").textContent;
  if (!dialog.open) dialog.showModal?.();
  return true;
}
$("entranceEnter").onclick = () => {
  try {
    sessionStorage.setItem(ENTRANCE_KEY, "1");
  } catch {
    /* It shows again next time. */
  }
  $<HTMLDialogElement>("entrance").close();
  const next = afterEntrance;
  afterEntrance = null;
  next?.();
};
function renderBanners(banners, entering = false) {
  const main = banners.filter((banner) => banner.place === "main");
  showSlides($("banners"), main);
  $("banners").hidden = !main.length;
  const intro = banners.filter((banner) => banner.place === "intro");
  // main.php's intro comes after enter.php's click.
  if (entering) {
    afterEntrance = () => openIntro(intro);
    return;
  }
  openIntro(intro);
}
function openIntro(intro) {
  // intro.php: only on the main page, and not for a day once seen through
  // (its intro_close cookie, 24 hours).
  let closed = false;
  try {
    closed = Number(localStorage.getItem(INTRO_KEY)) > Date.now();
  } catch {
    /* Without storage the intro shows on each arrival. */
  }
  if (
    !intro.length ||
    !arrivedHome ||
    closed ||
    $<HTMLDialogElement>("intro").open
  )
    return;
  showIntro(intro, 0);
  $<HTMLDialogElement>("intro").showModal?.();
}
/**
 * One intro picture at a time, each click the next (intro.php's stacked
 * .intro-item); the last one's click enters the site.
 */
function showIntro(intro, index) {
  const next = document.createElement("button");
  next.type = "button";
  next.className = "intro-item";
  next.setAttribute(
    "aria-label",
    index + 1 < intro.length
      ? `다음 (${index + 1} / ${intro.length})`
      : "입장하기",
  );
  next.append(bannerPicture(intro[index], false));
  next.onclick = () =>
    index + 1 < intro.length ? showIntro(intro, index + 1) : enterSite();
  $("introImages").replaceChildren(next);
}
function enterSite() {
  try {
    localStorage.setItem(INTRO_KEY, String(Date.now() + 24 * 3600 * 1000));
  } catch {
    /* The intro shows again next time. */
  }
  $<HTMLDialogElement>("intro").close();
}
/**
 * The owner's background music (cf_bgm): a YouTube playlist or video, played
 * on request in a frame that stays as the member moves around the page.
 */
let music = null;
function setMusic(bgm) {
  music = bgm;
  $("bgmPlayer").hidden = !bgm;
  if (!bgm) stopMusic();
}
function stopMusic() {
  $("bgmFrame").replaceChildren();
  $("bgmPlayer").classList.remove("playing");
  $("bgmPlay").hidden = false;
  $("bgmStop").hidden = true;
}
$("bgmPlay").onclick = () => {
  if (!music) return;
  const frame = document.createElement("iframe");
  frame.title = "배경음악";
  frame.allow = "autoplay; encrypted-media";
  frame.src = music.list
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(music.list)}&autoplay=1&loop=1&playsinline=1`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(music.video)}?autoplay=1&loop=1&playlist=${encodeURIComponent(music.video)}&playsinline=1`;
  $("bgmFrame").replaceChildren(frame);
  $("bgmPlayer").classList.add("playing");
  $("bgmPlay").hidden = true;
  $("bgmStop").hidden = false;
};
$("bgmStop").onclick = stopMusic;
$("menuToggle").onclick = () => document.body.classList.toggle("open-gnb");
// A tap outside the open menu closes it.
document.addEventListener("click", (event) => {
  if (
    document.body.classList.contains("open-gnb") &&
    !(event.target as Element).closest("#siteMenu, #menuToggle")
  )
    document.body.classList.remove("open-gnb");
});
$("enterSite").onclick = enterSite;
/** The address of what a menu entry names: board:free is /logs/free. */
export function menuAddress(link) {
  const [kind, id = ""] = String(link).split(":");
  const path =
    kind === "board"
      ? ["logs", id]
      : kind === "content"
        ? ["content", id]
        : kind === "tab"
          ? [id]
          : [];
  return addressOf(path);
}
/** Opens what a menu entry names: a board, a content page or a member tab. */
export async function follow(link) {
  const [kind, id] = link.split(":");
  if (kind === "board") {
    showTab("logs");
    if (!state.boards.some((row) => row.id === id))
      return say("권한이 없습니다.");
    state.board = id;
    $<HTMLSelectElement>("board").value = id;
    configureBoard();
    return loadLogs();
  }
  if (kind === "content") {
    showTab("content");
    await loadContentPages();
    if (
      ![...$<HTMLSelectElement>("contentPage").options].some(
        (option) => option.value === id,
      )
    )
      return say("자료를 찾을 수 없습니다.");
    $<HTMLSelectElement>("contentPage").value = id;
    return loadContentBody();
  }
  // member/ and member/ready.php: the character list, approved or not yet,
  // open to visitors as the original's are while the site is (사이트공개).
  if (id === "members" || id === "applicants") {
    const filter = id === "members" ? "approved" : "applicants";
    // A list already read under another filter is read again, once.
    if ($<HTMLSelectElement>("characterFilter").value !== filter) {
      $<HTMLSelectElement>("characterFilter").value = filter;
      if (state.charactersLoaded)
        $("characterFilter").dispatchEvent(new Event("change"));
    }
    return $("tabCharacters").click();
  }
  if (id === "new") return showRecent();
  if (id === "search") return showSearch();
  const tab = $(`tab${id.charAt(0).toUpperCase()}${id.slice(1)}`);
  if (!tab) return;
  if (!state.member && tab.classList.contains("member-only"))
    return say("회원 로그인 후 이용할 수 있습니다.");
  tab.click();
}
