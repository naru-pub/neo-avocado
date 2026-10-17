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
  showAlarms(null, null);
  if (!member) return;
  state.live = subscribe(
    "community/inbox:status",
    null,
    ({ messages, calls, memo, call }) => {
      if (state.member !== member) return;
      showUnread(messages);
      showCalls(calls === true);
      showAlarms(memo ?? null, call ?? null);
    },
    () => {
      /* The tabs keep their last notice. */
    },
  );
}

/**
 * The arrival popups (ajax/load_memo_call.php, load_board_call.php): the
 * newest unread 쪽지's sender, and the newest new call's, with a way there
 * and 닫기. Closing one keeps it closed in this browser until another
 * arrives; reading the 쪽지 or opening the 알림 ends it everywhere. With
 * the owner's 알림음 on, a new one chimes, once the member has touched the
 * page (browsers allow sound only then), unless they turned it off here.
 */
const CLOSED = {
  memo: "neo-avocado-memo-closed",
  call: "neo-avocado-call-closed",
};
const stored = (key: string) => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* A private window keeps nothing: the popup comes again. */
  }
};
/** What has chimed on this page, so an answer repeated does not ring again. */
const chimed = { memo: 0, call: 0 };
export function showAlarms(memo, call) {
  const memoShown = Boolean(memo) && Number(memo.id) > stored(CLOSED.memo);
  const callShown = Boolean(call) && Number(call.id) > stored(CLOSED.call);
  $("memoAlarm").hidden = !memoShown;
  $("callAlarm").hidden = !callShown;
  $("alarmSoundChoice").hidden = !state.alarmSound || !(memoShown || callShown);
  $<HTMLInputElement>("alarmSoundOn").checked =
    stored("neo-avocado-alarm-quiet") === 0;
  let ring = false;
  if (memoShown) {
    $("memoAlarmText").textContent =
      `${memo.nick}님으로부터 쪽지가 도착하였습니다.`;
    $<HTMLAnchorElement>("memoAlarmOpen").href =
      `/messages/${encodeURIComponent(memo.id)}`;
    $("memoAlarmOpen").onclick = $("memoAlarmClose").onclick = () => {
      store(CLOSED.memo, memo.id);
      $("memoAlarm").hidden = true;
    };
    if (Number(memo.id) > chimed.memo) ring = true;
    chimed.memo = Math.max(chimed.memo, Number(memo.id));
  }
  if (callShown) {
    $("callAlarmText").textContent =
      `${call.nick}님이 ${call.kind === "comment" ? "내 글에 댓글을 남겼습니다" : "호출하셨습니다"}. [ 확인하지 않은 알림 ${call.count}건 ]`;
    $<HTMLAnchorElement>("callAlarmOpen").href =
      `/post/${encodeURIComponent(call.post)}${call.comment ? `/comment/${encodeURIComponent(call.comment)}` : ""}`;
    $("callAlarmOpen").onclick =
      $("callAlarmList").onclick =
      $("callAlarmClose").onclick =
        () => {
          store(CLOSED.call, call.id);
          $("callAlarm").hidden = true;
        };
    if (Number(call.id) > chimed.call) ring = true;
    chimed.call = Math.max(chimed.call, Number(call.id));
  }
  if (ring) chime();
}
$("alarmSoundOn").onchange = () =>
  store(
    "neo-avocado-alarm-quiet",
    $<HTMLInputElement>("alarmSoundOn").checked ? "0" : "1",
  );
let audio: AudioContext | null = null;
/** Two short notes, made by Web Audio: no file to fetch. */
function chime() {
  if (!state.alarmSound || stored("neo-avocado-alarm-quiet")) return;
  // Autoplay: only after the member has touched the page.
  const activation = (navigator as any).userActivation;
  if (activation && !activation.hasBeenActive) return;
  const Context =
    globalThis.AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!Context) return;
  try {
    audio ??= new Context();
    const start = audio.currentTime;
    for (const [frequency, at] of [
      [880, 0],
      [1320, 0.15],
    ]) {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.2, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.3);
      tone.connect(gain).connect(audio.destination);
      tone.start(start + at);
      tone.stop(start + at + 0.32);
    }
  } catch {
    /* No sound is no reason to bother anyone. */
  }
}
