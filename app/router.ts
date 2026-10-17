// Opens the page an address names (/logs/free/12, /character/…), on load
// and whenever the address changes: a shared link, a reload, the back and
// forward buttons, a link within the site. app/core.js's route() writes the
// addresses; an old #/… address (core.js's pathOfHash) opens as its path.
import {
  $,
  opening,
  pathOfHash,
  run,
  say,
  shownAddress,
  showingAddress,
  showTab,
  state,
} from "./core.js";
import {
  configureBoard,
  loadBoards,
  loadLogs,
  openLogNumber,
  openPost,
} from "./logs.js";
import { openMessage } from "./messages.js";
import { follow } from "./site.js";
import { openCharacter } from "./characters.js";
import { showShopCategory } from "./shop.js";

/**
 * The pages addresses name by their first part, as Naru serves them
 * (_naru/routes/): "" is the home, and any other is a view's tab.
 */
export const PAGES = new Set([
  "",
  "home",
  "post",
  "logs",
  "messages",
  "character",
  "content",
  "shop",
  "mypage",
  "members",
  "applicants",
  "characters",
  "couples",
  "quests",
  "calls",
  "online",
]);

/** The address's parts: "/logs/free/12" → ["logs", "free", "12"]. */
export function parts(path) {
  return path
    .replace(/^\/+/, "")
    .replace(/(^|\/)index\.html$/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

export function openRoute(path = location.pathname) {
  showingAddress(location.pathname);
  const [kind = "", first, second] = parts(path);
  return opening(async () => {
    // A closed site (사이트공개 off) shows a visitor the sign-in card only,
    // whatever the address (extend/community.config.php's check_site_auth).
    if (!kind || (!state.member && state.siteOpen === false))
      return showTab("home");
    if (kind === "post" && first) {
      // /post/<id>, or /post/<id>/comment/<id>.
      const [, , , comment] = parts(path);
      return openPost(first, {
        comment: second === "comment" ? comment : null,
      });
    }
    if (kind === "logs") {
      $("tabLogs").click();
      const [, , , third] = parts(path);
      if (first && first !== state.board) {
        // A board made since the page read its list: read it again, once.
        if (!state.boards.some((row) => row.id === first)) await loadBoards();
        if (!state.boards.some((row) => row.id === first))
          return say("권한이 없습니다.");
        state.board = first;
        $<HTMLSelectElement>("board").value = first;
        configureBoard();
      }
      state.tag = second === "tag" ? third : null;
      state.search = second === "search" ? third : null;
      // /logs/free/category/잡담, and its pages (…/category/잡담/page/2).
      const [, , , , fourth, fifth] = parts(path);
      state.category = second === "category" ? third : null;
      $<HTMLInputElement>("searchText").value = state.search ?? "";
      // The readable form of a post's address: board and number.
      if (second && Number.isSafeInteger(Number(second))) {
        await loadLogs();
        return openLogNumber(Number(second));
      }
      $("logFocus").replaceChildren();
      $("logFocusPanel").hidden = true;
      const page =
        second === "page" ? third : fourth === "page" ? fifth : undefined;
      return loadLogs({ page: Math.max(1, Number(page) || 1) });
    }
    if (kind === "messages" && first) {
      if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
      $("tabMessages").click();
      return openMessage(first);
    }
    // The character viewer (member/viewer.php), open to visitors too.
    if (kind === "character" && first) return openCharacter(first);
    if (kind === "content" && first) return follow(`content:${first}`);
    if (kind === "shop") {
      if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
      // Chosen before the shop reads its categories, and shown if it has.
      if (first) showShopCategory(first);
      $("tabShop").click();
      return;
    }
    if (kind === "mypage") {
      if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
      const tab =
        first === "logs"
          ? "myLogsTab"
          : first === "exp"
            ? "myExpTab"
            : first === "favorites"
              ? "myFavoritesTab"
              : first === "money"
                ? "myMoneyTab"
                : "tabMypage";
      return $(tab).click();
    }
    return follow(`tab:${kind}`);
  });
}

/**
 * The address changed: back or forward, or an old #/… link followed (which
 * becomes its path). A move within the page (#top) opens nothing.
 */
function arrive() {
  pathOfHash();
  if (location.pathname === shownAddress()) return;
  return run(() => openRoute());
}
addEventListener("popstate", arrive);
addEventListener("hashchange", arrive);

/** Opens `path` (one of the site's pages) as a new history entry. */
export function navigate(path) {
  history.pushState(null, "", path);
  return run(() => openRoute());
}

/**
 * A link to one of the site's pages opens it here, without loading the
 * page again; a link the page handles itself, one to open elsewhere (a new
 * tab, a download) and one to anything else (the admin, a file) go as
 * links go.
 */
document.addEventListener("click", (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (
    !(link instanceof HTMLAnchorElement) ||
    (link.target && link.target !== "_self") ||
    link.hasAttribute("download")
  )
    return;
  // "#", "#top": the page's own business.
  const written = link.getAttribute("href");
  if (written.startsWith("#") && !written.startsWith("#/")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  // An old #/… link inside a post or page: its path.
  const path = url.hash.startsWith("#/")
    ? `/${url.hash.slice(2)}`
    : url.pathname;
  if (!url.hash.startsWith("#/") && (url.hash || url.search)) return;
  if (!PAGES.has(parts(path)[0] ?? "")) return;
  event.preventDefault();
  navigate(path);
});
