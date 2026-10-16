// Live updates: new posts, unread messages and notifications as they happen.

import { $, caller, state, subscribe } from "./core.js";

/**
 * The mail notice on the tab, and on the main page's card how many are
 * unread (outlogin.skin.2.php's $memo_not_read).
 */
export function showUnread(count: number) {
  const unread = count > 0;
  $("tabMessages").textContent = unread ? "쪽지 · 새 쪽지" : "쪽지";
  $("cardUnread").textContent = unread ? String(count) : "";
  $("cardUnread").hidden = !unread;
  $("cardMessages").classList.toggle("point", unread);
}
export function showCalls(unread) {
  $("tabCalls").textContent = unread ? "알림 · 새 알림" : "알림";
}
export function showNewPost(id) {
  state.newPost = id;
  $("tabLogs").textContent = id ? "로그 · 새 글" : "로그";
}
/**
 * Keeps the current board's newest post in view (community/posts:latest):
 * a newer one than the page has seen, not the reader's own, shows the 새 글
 * notice. Called whenever a board is shown; the subscription follows it.
 */
export function watchBoard() {
  const board = state.board;
  const reader = caller();
  if (state.boardWatch?.board === board && state.boardWatch.reader === reader)
    return;
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
  state.boardWatch = { board, reader, handle };
}

/**
 * Instead of polling, the page subscribes to the board's newest post and,
 * for a member, to what is new for them (community/inbox:status): Naru
 * answers again whenever a mutation writes mail, calls or the member's
 * profile, so a 쪽지, a gift's or money's note, a call or a comment notice
 * shows as it arrives, and reading them clears the notice on every tab.
 */
export function listen() {
  // The board's subscription stays while the reader does (watchBoard).
  state.live?.close();
  state.live = null;
  watchBoard();
  const member = state.member;
  if (!member) return;
  state.live = subscribe(
    "community/inbox:status",
    null,
    ({ messages, calls }) => {
      if (state.member !== member) return;
      showUnread(messages);
      showCalls(calls === true);
    },
    () => {
      /* The tabs keep their last notice. */
    },
  );
}
