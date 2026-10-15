// 아보카도 에디션의 뼈대만 나루 회원으로 다시 만든 것: 회원 로그인과 닉네임,
// 캐릭터 등록, 그림 로그와 댓글, 댓글 주사위, 상점과 뽑기. 회원이 쓰는
// 컬렉션은 읽기·쓰기 모두 ‘회원’이라 로그인한 회원만 보고, 회원은 자기가 만든
// 문서만 고치고 지운다. 돈과 아이템은 회원이 읽기만 하고, 사이트의 서버 함수
// (_naru/functions 아래의 모듈)만 바꾼다.
//
// This file signs the visitor or member in and starts the page; each part of
// the community lives in app/ (core.js is what they share).

import { config } from "./config.js";
import {
  $,
  caller,
  clearPrivateViews,
  COLLECTION,
  edit,
  run,
  say,
  show,
  showAdmission,
  showTab,
  state,
} from "./app/core.js";
import { listen } from "./app/live.js";
import { loadSite } from "./app/site.js";
import { loadBoards, loadLogs } from "./app/logs.js";
import { loadCharacters } from "./app/characters.js";
import "./app/shop.js";
import "./app/messages.js";
import "./app/calls.js";
import "./app/content.js";

export { diceOf } from "./app/posts.js";

async function connect() {
  const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
  state.naru = createNaru(config.site ? { site: config.site } : undefined);
}
$("checkAdmission").onclick = () => run(start);
$("editProfile").onclick = () => {
  const profile = state.profile;
  edit(
    "프로필 수정",
    [
      {
        name: "nick",
        label: "닉네임",
        value: profile.data.nick,
        required: true,
        max: 20,
      },
      {
        name: "acceptMessages",
        label: "다른 회원의 쪽지 받기",
        type: "checkbox",
        value: profile.data.acceptMessages !== false,
      },
      {
        name: "commentAlerts",
        label: "내 글에 달린 댓글 알림 받기",
        type: "checkbox",
        value: profile.data.commentAlerts !== false,
      },
    ],
    async ({ nick, acceptMessages, commentAlerts }) => {
      if (!nick) throw new Error("닉네임을 입력해 주세요.");
      // A member's own profile is written directly; rules/profiles.js
      // lets them change their nickname and preferences only.
      const saved = await state.member
        .collection(COLLECTION.profiles)
        .set(
          state.member.id,
          { ...profile.data, nick, acceptMessages, commentAlerts },
          { condition: { revision: profile.revision } },
        );
      state.nicks.set(state.member.id, Promise.resolve(nick));
      show(saved);
      await loadLogs();
      if (state.charactersLoaded) await loadCharacters();
    },
  );
};
async function start() {
  await connect();
  state.member = await state.naru.members.session();
  // The site's frame is decoration: without it the default design shows.
  await loadSite().catch((error) => console.error(error));
  if (!state.member) return visit();
  const platform = await state.member.membership();
  state.admission = platform.status;
  if (platform.status !== "approved") {
    show();
    return showAdmission(platform.status);
  }
  const status = await caller().call("community/membership:membership");
  state.role = status.role;
  state.level = status.level ?? 2;
  const profile = status.profile;
  show(profile);
  if (profile) {
    state.nicks.set(state.member.id, Promise.resolve(profile.data.nick));
    await loadBoards();
    await loadLogs();
    listen();
  }
}
/** A visitor's view: public boards and pages at GnuBoard's guest level 1. */
async function visit() {
  state.role = "guest";
  state.level = 1;
  show();
  showTab("logs");
  await loadBoards();
  await loadLogs();
  if (state.boards.length) listen();
}
$("signIn").onclick = () => run(() => state.naru.members.signIn());
$("signOut").onclick = () =>
  run(async () => {
    const member = state.member;
    state.member = null;
    state.nicks.clear();
    state.charactersLoaded = false;
    state.shopLoaded = false;
    $("editor").close();
    clearPrivateViews();
    // The page becomes a visitor's at once; revoking the sign-in follows.
    await visit();
    await member.signOut();
    say("로그아웃했습니다.");
  });
$("profileForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const nick = $("nick").value.trim();
    if (!nick) return;
    // 회원 번호를 ID로 쓰는 문서는 그 회원만 만들 수 있다.
    const joined = await caller().call("community/membership:join", { nick });
    const profile = joined.profile;
    state.nicks.set(state.member.id, Promise.resolve(nick));
    show(profile);
    await loadBoards();
    await loadLogs();
    listen();
  });
};
await run(start);
