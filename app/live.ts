// Live updates: new posts, unread messages and notifications as they happen.

import { $, caller, COLLECTION, run, state, stopLive } from "./core.js";

// The topic community/posts:write announces new, publicly listable posts on.
const POSTS_TOPIC = COLLECTION.logs;
export function showUnread(unread) {
  $("tabMessages").textContent = unread ? "쪽지 · 새 쪽지" : "쪽지";
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
  showUnread(notice.unread);
  showCalls(notice.calls === true);
}
/**
 * Instead of polling, functions notify the member of new messages and
 * broadcast new posts. Nothing is replayed, so the status is read again
 * whenever the connection opens or reopens.
 */
export function listen() {
  stopLive();
  const member = state.member;
  if (!member) {
    // Visitors hear new public posts too; they have no notices.
    state.live = state.naru.live?.({
      topics: [POSTS_TOPIC],
      onMessage(message) {
        if (
          !state.member &&
          message.type === "topic" &&
          message.data?.board === state.board &&
          typeof message.data.id === "string" &&
          !state.ownPosts.has(message.data.id)
        )
          showNewPost(message.data.id);
      },
    });
    return;
  }
  if (!member?.live) return run(refreshUnread);
  state.live = member.live({
    topics: [POSTS_TOPIC],
    onMessage(message) {
      if (state.member !== member) return;
      if (
        message.type === "notice" &&
        typeof message.data?.unread === "boolean"
      )
        showUnread(message.data.unread);
      if (message.type === "notice" && typeof message.data?.calls === "boolean")
        showCalls(message.data.calls);
      if (
        message.type === "topic" &&
        message.topic === POSTS_TOPIC &&
        message.data?.board === state.board &&
        typeof message.data.id === "string" &&
        !state.ownPosts.has(message.data.id)
      )
        showNewPost(message.data.id);
    },
    onStatus(status) {
      if (status === "open" && state.member === member && state.profile)
        run(refreshUnread);
    },
  });
}
