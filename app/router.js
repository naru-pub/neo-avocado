// Opens the page an address names (#/logs/free/12, #/character/…), on load
// and whenever the address changes: a shared link, a reload, the back and
// forward buttons. app/core.js's route() writes the addresses.
import { $, opening, run, say, showTab, state } from "./core.js";
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

/** The address's parts: "#/logs/free/12" → ["logs", "free", "12"]. */
function parts(hash) {
  return hash
    .replace(/^#\/?/, "")
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

export function openRoute(hash = location.hash) {
  const [kind = "", first, second] = parts(hash);
  return opening(async () => {
    // A closed site (사이트공개 off) shows a visitor the sign-in card only,
    // whatever the address (extend/community.config.php's check_site_auth).
    if (!kind || (!state.member && state.siteOpen === false))
      return showTab("home");
    if (kind === "post" && first) {
      // #/post/<id>, or #/post/<id>/comment/<id>.
      const [, , , comment] = parts(hash);
      return openPost(first, {
        comment: second === "comment" ? comment : null,
      });
    }
    if (kind === "logs") {
      $("tabLogs").click();
      const [, , , third] = parts(hash);
      if (first && first !== state.board) {
        // A board made since the page read its list: read it again, once.
        if (!state.boards.some((row) => row.id === first)) await loadBoards();
        if (!state.boards.some((row) => row.id === first))
          return say("권한이 없습니다.");
        state.board = first;
        $("board").value = first;
        configureBoard();
      }
      state.tag = second === "tag" ? third : null;
      state.search = second === "search" ? third : null;
      $("searchText").value = state.search ?? "";
      // The readable form of a post's address: board and number.
      if (second && Number.isSafeInteger(Number(second))) {
        await loadLogs();
        return openLogNumber(Number(second));
      }
      $("logFocus").replaceChildren();
      $("logFocusPanel").hidden = true;
      return loadLogs({
        page: second === "page" ? Math.max(1, Number(third) || 1) : 1,
      });
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
            : "tabMypage";
      return $(tab).click();
    }
    return follow(`tab:${kind}`);
  });
}

addEventListener("hashchange", () => run(() => openRoute()));
