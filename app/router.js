// Opens the page an address names (#/logs/free/12, #/character/…), on load
// and whenever the address changes: a shared link, a reload, the back and
// forward buttons. app/core.js's route() writes the addresses.
import { $, opening, run, say, showTab, state } from "./core.js";
import { configureBoard, loadLogs, openLogNumber } from "./logs.js";
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
    if (!kind) return showTab("home");
    if (kind === "logs") {
      $("tabLogs").click();
      if (first && first !== state.board) {
        if (!state.boards.some((row) => row.id === first))
          return say("권한이 없습니다.");
        state.board = first;
        $("board").value = first;
        configureBoard();
        await loadLogs();
      }
      if (second && Number.isSafeInteger(Number(second)))
        await openLogNumber(Number(second));
      return;
    }
    if (kind === "character" && first) {
      if (!state.member) return say("회원 로그인 후 이용할 수 있습니다.");
      return openCharacter(first);
    }
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
