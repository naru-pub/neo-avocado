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
  if (design.title) {
    $("siteTitle").textContent = design.title;
    document.title = design.title;
  }
  $("siteLogo").hidden = !design.logo;
  if (design.logo) {
    $("siteLogo").src = design.logo;
    $("siteLogo").alt = design.title || "";
  }
  renderMenus(site.menus);
  renderBanners(site.banners);
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
const DEFAULT_MENUS = [
  ["로그", "tab:logs"],
  ["멤버목록", "tab:characters", true],
  ["상점", "tab:shop", true],
  ["퀘스트", "tab:quests", true],
  ["쪽지", "tab:messages", true],
  ["알림", "tab:calls", true],
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
$("menuToggle").onclick = () => document.body.classList.toggle("open-gnb");
$("enterSite").onclick = () => {
  try {
    sessionStorage.setItem("neo-avocado-entered", "1");
  } catch {
    /* The intro shows again next time. */
  }
  $("intro").close();
};
/** Opens what a menu entry names: a board, a content page or a member tab. */
async function follow(link) {
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
  const tab = $(`tab${id.charAt(0).toUpperCase()}${id.slice(1)}`);
  if (!tab) return;
  if (!state.member && tab.classList.contains("member-only"))
    return say("회원 로그인 후 이용할 수 있습니다.");
  tab.click();
}
