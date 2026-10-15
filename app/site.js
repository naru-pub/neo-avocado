// The site's look and navigation: design, menus, banners and the intro.

import { $, caller, run, say, showTab, state } from "./core.js";
import { configureBoard, loadLogs } from "./logs.js";
import { loadContentBody, loadContentPages } from "./content.js";

const SITE_COLORS = {
  accent: "--avocado",
  muted: "--pit",
  paper: "--paper",
  ink: "--ink",
  line: "--line",
  surface: "--surface",
};
/** Applies the owner's design, menus and banners (adm/design_form.php, menu_list.php). */
export async function loadSite() {
  const site = await caller().call("content/site:site");
  const { design } = site;
  const root = document.documentElement.style;
  // Without 디자인 사용 the page is plain (plain.css), as the original
  // without its design CSS: the title, logo, menus and slides still apply.
  document.body.classList.toggle("designed", design.enabled);
  applyNames(design);
  renderMenus(site.menus);
  renderBanners(site.banners);
  setMusic(site.bgm);
  if (!design.enabled) return;
  for (const [key, variable] of Object.entries(SITE_COLORS))
    if (design.colors[key]) root.setProperty(variable, design.colors[key]);
  if (design.background) {
    // The owner's picture tiles at its own size, as background_repeat did.
    root.setProperty("--site-background-size", "auto");
    root.setProperty(
      "--site-background",
      `url("${encodeURI(design.background)}")`,
    );
  }
  if (design.headerBackground)
    root.setProperty(
      "--site-header-background",
      `url("${encodeURI(design.headerBackground)}")`,
    );
  document.body.classList.remove("font-serif", "font-mono");
  if (design.font !== "sans")
    document.body.classList.add(`font-${design.font}`);
}
/** The site's name and logo, in the header and the copyright. */
function applyNames(design) {
  if (design.title) {
    $("siteTitle").textContent = design.title;
    $("copyrightName").textContent = design.title;
    document.title = design.title;
  }
  $("siteLogo").hidden = !design.logo;
  $("siteTitle").hidden = Boolean(design.logo);
  if (design.logo) {
    $("siteLogo").src = design.logo;
    $("siteLogo").alt = design.title || "";
  }
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
  link.href = `#${menu.link}`;
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
  ["멤버목록", "tab:members", true],
  ["신청자목록", "tab:applicants", true],
  ["커플목록", "tab:couples", true],
  ["상점", "tab:shop", true],
  ["마이페이지", "tab:mypage", true],
  ["현재접속자", "tab:online"],
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
  nav.append(list);
  nav.hidden = false;
}
function bannerPicture(banner) {
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
  if (!banner.url) return picture;
  const link = document.createElement("a");
  link.href = banner.url;
  if (banner.newWindow) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  link.append(picture);
  return link;
}
function renderBanners(banners) {
  const main = banners.filter((banner) => banner.place === "main");
  $("banners").replaceChildren(...main.map(bannerPicture));
  $("banners").hidden = !main.length;
  const intro = banners.filter((banner) => banner.place === "intro");
  let entered = false;
  try {
    entered = sessionStorage.getItem("neo-avocado-entered") === "1";
  } catch {
    /* Without storage the intro shows on each load. */
  }
  if (!intro.length || entered || $("intro").open) return;
  $("introImages").replaceChildren(...intro.map(bannerPicture));
  $("intro").showModal?.();
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
    !event.target.closest("#siteMenu, #menuToggle")
  )
    document.body.classList.remove("open-gnb");
});
$("enterSite").onclick = () => {
  try {
    sessionStorage.setItem("neo-avocado-entered", "1");
  } catch {
    /* The intro shows again next time. */
  }
  $("intro").close();
};
/** Opens what a menu entry names: a board, a content page or a member tab. */
export async function follow(link) {
  const [kind, id] = link.split(":");
  if (kind === "board") {
    showTab("logs");
    if (!state.boards.some((row) => row.id === id))
      return say("권한이 없습니다.");
    state.board = id;
    $("board").value = id;
    configureBoard();
    return loadLogs();
  }
  if (kind === "content") {
    showTab("content");
    await loadContentPages();
    if (![...$("contentPage").options].some((option) => option.value === id))
      return say("자료를 찾을 수 없습니다.");
    $("contentPage").value = id;
    return loadContentBody();
  }
  // member/ and member/ready.php: the character list, approved or not yet.
  if (id === "members" || id === "applicants") {
    if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
    const filter = id === "members" ? "approved" : "applicants";
    // A list already read under another filter is read again, once.
    if ($("characterFilter").value !== filter) {
      $("characterFilter").value = filter;
      if (state.charactersLoaded)
        $("characterFilter").dispatchEvent(new Event("change"));
    }
    return $("tabCharacters").click();
  }
  const tab = $(`tab${id.charAt(0).toUpperCase()}${id.slice(1)}`);
  if (!tab) return;
  if (!state.member && tab.classList.contains("member-only"))
    return say("회원 로그인 후 이용할 수 있습니다.");
  tab.click();
}
