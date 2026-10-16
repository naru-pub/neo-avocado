// Live updates: new posts, unread messages and notifications as they happen.

import { $, caller, run, state, stopLive, subscribe } from "./core.js";

/** How many messages are unread, as last told. */
let unreadCount = 0;
/**
 * The mail notice on the tab, and on the main page's card how many are
 * unread (outlogin.skin.2.php's $memo_not_read). A notice without a count
 * says one message came (messages:sendMessage, a gift's or money's notice).
 */
export function showUnread(unread, count?) {
  $("tabMessages").textContent = unread ? "쪽지 · 새 쪽지" : "쪽지";
  unreadCount = !unread
    ? 0
    : typeof count === "number"
      ? count
      : unreadCount + 1;
  $("cardUnread").textContent = unread ? String(unreadCount) : "";
  $("cardUnread").hidden = !unread;
  $("cardMessages").classList.toggle("point", Boolean(unread));
}
export function showCalls(unread) {
  $("tabCalls").textContent = unread ? "알림 · 새 알림" : "알림";
}
export function showNewPost(id) {
  state.newPost = id;
  $("tabLogs").textContent = id ? "로그 · 새 글" : "로그";
}
async function refreshUnread() {
  const member = state.member;
  const notice = await caller().call("community/messages:messageStatus");
  if (state.member !== member) return;
  showUnread(notice.unread, notice.unreadCount);
}

/**
 * Keeps the current board's newest post in view (community/posts:latest):
 * a newer one than the page has seen, not the reader's own, shows the 새 글
 * notice. Called whenever a board is shown; the subscription follows it.
 */
export function watchBoard() {
  const board = state.board;
  if (state.boardWatch?.board === board) return;
  state.boardWatch?.handle.close();
  state.boardWatch = null;
  if (!state.boards.some((row) => row.id === board)) return;
  let seen: string | null | undefined;
  const handle = subscribe(
    "community/posts:latest",
    { board },
    ({ id }) => {
      if (state.board !== board) return;
      if (seen !== undefined && id && id !== seen && !state.ownPosts.has(id))
        showNewPost(id);
      seen = id;
    },
    () => {
      /* A notice missed is no reason to bother anyone. */
    },
  );
  state.boardWatch = { board, handle };
}

/**
 * Instead of polling, the page subscribes to the board's newest post and
 * the member's unread calls, and hears mail's notices over the live
 * connection (mail's site functions still notify the member). Nothing is
 * replayed there, so mail's status is read again whenever the connection
 * opens or reopens.
 */
export function listen() {
  stopLive();
  watchBoard();
  const member = state.member;
  if (!member) return;
  // 알림: the member's calls and comment notices. (Mail's own unread status
  // takes this in when mail moves to the site's tables.)
  const calls = subscribe(
    "community/calls:unread",
    null,
    ({ unread }) => {
      if (state.member === member) showCalls(unread === true);
    },
    () => {
      /* The tab keeps its last notice. */
    },
  );
  if (!member?.live) {
    state.live = calls;
    return run(refreshUnread);
  }
  const connection = member.live({
    onMessage(message) {
      if (state.member !== member) return;
      if (
        message.type === "notice" &&
        typeof message.data?.unread === "boolean"
      )
        showUnread(message.data.unread, message.data.unreadCount);
    },
    onStatus(status) {
      if (status === "open" && state.member === member && state.profile)
        run(refreshUnread);
    },
  });
  state.live = {
    close() {
      calls.close();
      connection.close();
    },
  };
}
