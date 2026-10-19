// Opens the page an address names (/logs/free/12, /character/…), on load
// and whenever the address changes: a shared link, a reload, the back and
// forward buttons, a link within the site. app/core.js's route() writes the
// addresses.
import {
  $,
  opening,
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
import { showRecent, showSearch } from "./across.js";
import { follow } from "./site.js";
import { openCharacter } from "./characters.js";
import { showShopCategory } from "./shop.js";
import { placeOf, type Place } from "../_naru/modules/places.js";

export function openRoute(path = location.pathname) {
  showingAddress(location.pathname);
  const place = placeOf(path);
  return opening(async () => {
    // A closed site (사이트공개 off) shows a visitor the sign-in card only,
    // whatever the address (extend/community.config.php's check_site_auth).
    // An address that names no page (Naru answers it 404) opens the home.
    if (
      !place ||
      place.kind === "index" ||
      (!state.member && state.siteOpen === false)
    )
      return showTab("home");
    switch (place.kind) {
      case "post":
        return openPost(place.id, { comment: place.comment ?? null });
      case "logs":
      case "board":
      case "log":
        return openLogs(place);
      case "messages":
        if (place.id === undefined) break;
        if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
        $("tabMessages").click();
        return openMessage(place.id);
      // 최근게시물 and 전체검색 (bbs/new.php, search.php), at /search/<words>.
      case "new":
        return showRecent();
      case "search":
        return showSearch(place.text ?? null);
      // The character viewer (member/viewer.php), open to visitors too.
      case "character":
        return openCharacter(place.id);
      case "content":
        if (place.id === undefined) break;
        return follow(`content:${place.id}`);
      case "shop":
        if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
        // Chosen before the shop reads its categories, and shown if it has.
        if (place.category) showShopCategory(place.category);
        $("tabShop").click();
        return;
      case "mypage":
        if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
        return $(MYPAGE_TAB_IDS[place.tab ?? ""]).click();
    }
    return follow(`tab:${place.kind}`);
  });
}

/** 마이페이지's tab buttons, by the address's tab ("": the page itself). */
const MYPAGE_TAB_IDS = {
  "": "tabMypage",
  logs: "myLogsTab",
  exp: "myExpTab",
  favorites: "myFavoritesTab",
  money: "myMoneyTab",
};

/** /logs and a board's lists, or one of its posts by number. */
async function openLogs(
  place: Extract<Place, { kind: "logs" | "board" | "log" }>,
) {
  $("tabLogs").click();
  const board = place.kind === "logs" ? undefined : place.board;
  if (board && board !== state.board) {
    // A board made since the page read its list: read it again, once.
    if (!state.boards.some((row) => row.id === board)) await loadBoards();
    if (!state.boards.some((row) => row.id === board))
      return say("권한이 없습니다.");
    state.board = board;
    $<HTMLSelectElement>("board").value = board;
    configureBoard();
  }
  const list = place.kind === "board" ? place : null;
  state.tag = list?.tag ?? null;
  state.upTo = list?.from ? Number(list.from) : null;
  state.search = list?.search ?? null;
  // /logs/free/category/잡담, and its pages (…/category/잡담/page/2).
  state.category = list?.category ?? null;
  $<HTMLInputElement>("searchText").value = state.search ?? "";
  // The readable form of a post's address: board and number.
  if (place.kind === "log") {
    await loadLogs();
    return openLogNumber(Number(place.number));
  }
  $("logFocus").replaceChildren();
  $("logFocusPanel").hidden = true;
  return loadLogs({ page: Math.max(1, Number(list?.page) || 1) });
}

/** The address changed: back or forward. A move within the page (#top) opens nothing. */
function arrive() {
  if (location.pathname === shownAddress()) return;
  return run(() => openRoute());
}
addEventListener("popstate", arrive);

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
  if (link.getAttribute("href").startsWith("#")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.hash || url.search) return;
  const path = url.pathname;
  // A feed (/rss/<board>) is no page: the browser opens it.
  const place = placeOf(path);
  if (!place || place.kind === "rss") return;
  event.preventDefault();
  navigate(path);
});
