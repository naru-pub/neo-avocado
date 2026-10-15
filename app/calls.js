// Notifications: calls and replies to the member.

import {
  $,
  caller,
  COLLECTION,
  communityCollection,
  formatTime,
  run,
  showTab,
  state,
} from "./core.js";
import { showCalls } from "./live.js";
import { logItem } from "./logs.js";

/** ajax/board_call.php's alarm list: calls and comment notices, newest first. */
async function loadCalls({ more = false } = {}) {
  const member = state.member;
  const page = await caller().call("community/calls:callHistory", {
    after: more ? state.callCursor : null,
    size: 20,
  });
  if (state.member !== member) return;
  if (!more) {
    $("calls").replaceChildren();
    $("callDetail").replaceChildren();
  }
  for (const row of page.documents) {
    const li = document.createElement("li");
    li.className = row.data.unread ? "call unread" : "call";
    li.textContent = `${row.data.unread ? "[새 알림] " : ""}${row.data.nick || "이름 없음"}${row.data.speaker ? ` (${row.data.speaker})` : ""}님이 ${row.data.kind === "comment" ? "내 글에 댓글을 남겼습니다" : "호출했습니다"} · ${formatTime(row.data.at)} · ${row.data.preview} `;
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "글 보기";
    open.onclick = () =>
      run(async () => {
        const log = await communityCollection(COLLECTION.logs).get(
          row.data.logId,
        );
        $("callDetail").replaceChildren(await logItem(log));
      });
    li.append(open);
    $("calls").append(li);
  }
  state.callCursor = page.nextCursor;
  $("moreCalls").hidden = !page.nextCursor;
  // Opening the list is looking at it, as the original's close_call.php.
  if (page.unread) await caller().call("community/calls:seeCalls");
  showCalls(false);
}
$("tabCalls").onclick = () =>
  run(async () => {
    showTab("calls");
    await loadCalls();
  });
$("refreshCalls").onclick = () => run(() => loadCalls());
$("moreCalls").onclick = () => run(() => loadCalls({ more: true }));
