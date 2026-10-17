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
  clearPrivateViews,
  edit,
  memberSettings,
  mutate,
  query,
  movedSinceOpening,
  opening,
  run,
  say,
  show,
  showAdmission,
  showTab,
  state,
  standing,
} from "./app/core.js";
import { listen } from "./app/live.js";
import { loadSite } from "./app/site.js";
import { loadBoards, loadLogs } from "./app/logs.js";
import { loadCharacters } from "./app/characters.js";
import "./app/shop.js";
import "./app/messages.js";
import "./app/calls.js";
import "./app/content.js";
import { createCharacter } from "./app/mypage.js";
import "./app/couples.js";
import { openRoute } from "./app/router.js";

/** The address the page was opened at, before anything is shown. */
const arrivedAt = location.pathname;
/** Whether the address the page opened at names a board, which reads its own list. */
const arrivesAtList = () =>
  !movedSinceOpening() && /^\/logs(\/|$)/.test(arrivedAt);
import "./app/online.js";
import "./app/across.js";

export { diceOf } from "./app/posts.js";

async function connect() {
  const { createNaru } = await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
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
      if (nick !== profile.data.nick && reserved(await memberSettings(), nick))
        throw new Error(RESERVED);
      // The member changes their nickname and preferences only.
      const { profile: saved } = await mutate("community/profiles:update", {
        nick,
        acceptMessages,
        commentAlerts,
      });
      state.nicks.set(state.member.id, Promise.resolve(nick));
      show(saved);
      await loadLogs();
      if (state.charactersLoaded) await loadCharacters();
    },
  );
};
const RESERVED = "이미 예약된 단어로 사용할 수 없는 닉네임입니다.";
/**
 * Whether a nickname is reserved (cf_prohibit_id, lib/register.lib.php);
 * profiles:update and membership:join refuse it too. The owner may.
 */
function reserved(community, nick) {
  if (state.owner) return false;
  return String(community.reservedNicks ?? "")
    .split(",")
    .some(
      (word) => word.trim() && word.trim().toLowerCase() === nick.toLowerCase(),
    );
}
/**
 * Before joining, the owner's 커뮤니티 활동 규칙 and 캐릭터 유의사항, each
 * with a box to tick (register.skin.php), where written.
 */
async function showAgreements() {
  const community = await memberSettings();
  for (const key of ["stipulation", "characterNotice"]) {
    const text = typeof community[key] === "string" ? community[key] : "";
    $(`${key}Text`).textContent = text;
    $(`${key}Box`).hidden = !text.trim();
    $<HTMLInputElement>(`${key}Agree`).required = Boolean(text.trim());
  }
  $("recommenderLabel").hidden = community.useRecommend !== true;
}
async function start() {
  await connect();
  state.member = await state.naru.members.session();
  // The site's frame is decoration: without it the default design shows.
  await loadSite().catch((error) => console.error(error));
  if (!state.member) return visit();
  let status;
  try {
    status = await query("community/membership:membership");
  } catch (error) {
    // Naru's refusal says when the site has not approved this member yet.
    if (!standing(error)) throw error;
    show();
    return showAdmission(standing(error));
  }
  state.admission = "approved";
  // 회원 삭제, 접근차단 and 탈퇴: the community's own, apart from Naru's.
  for (const standing of ["deleted", "blocked", "left"])
    if (status[standing]) {
      show();
      return showAdmission(standing);
    }
  state.role = status.role;
  state.owner = status.owner === true;
  state.level = status.level ?? 2;
  state.adult = status.adult === true;
  state.warnings = {
    count: status.warnings ?? 0,
    note: status.warningNote ?? "",
  };
  const profile = status.profile;
  show(profile);
  if (!profile) await showAgreements();
  // Decoration: the card keeps its placeholder if this fails.
  showMainCharacter(profile).catch((error) => console.error(error));
  if (profile) {
    state.nicks.set(state.member.id, Promise.resolve(profile.data.nick));
    await loadBoards();
    // Read once: the board the address names, or else the first.
    if (!arrivesAtList()) await loadLogs();
    listen();
    // The address it was opened at, unless they have moved on already.
    if (!movedSinceOpening()) await openRoute(arrivedAt);
  }
}
/** A visitor's view: public boards and pages at GnuBoard's guest level 1. */
async function visit() {
  state.role = "guest";
  state.owner = false;
  state.level = 1;
  state.adult = false;
  show();
  await opening(() => showTab("home"));
  // 사이트공개 off: the welcome and sign-in card, and nothing else read.
  if (state.siteOpen === false) return;
  await loadBoards();
  if (!arrivesAtList()) await loadLogs();
  if (state.boards.length) listen();
  if (!movedSinceOpening()) await openRoute(arrivedAt);
}
$("signIn").onclick = () => run(() => state.naru.members.signIn());
// The main page, as the original lands on main.php; the logo leads back.
$("tabHome").onclick = () => showTab("home");
$("homeLink").onclick = (event) => {
  event.preventDefault();
  document.body.classList.remove("open-gnb");
  showTab("home");
};
$("cardSignIn").onclick = () => $("signIn").click();
$("cardSignOut").onclick = () => $("signOut").click();
$("cardMessages").onclick = () => $("tabMessages").click();
$("copyrightYear").textContent = String(new Date().getFullYear());
$("gotoTop").onclick = (event) => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
};
/**
 * The card shows the member's main character, as the original's thumbnail;
 * without one, 캐릭터 생성 while the owner allows it, or that it is not the
 * time (outlogin.skin.2.php).
 */
async function showMainCharacter(profile) {
  const id = profile?.data.mainCharacter;
  const character = id
    ? await query("characters/sheet:sheet", { id }).then(
        (found) => found.document,
        () => null,
      )
    : null;
  if (character) {
    $("cardThumb").replaceChildren(
      character.data.image
        ? Object.assign(new Image(), { src: character.data.image, alt: "" })
        : "⌘",
    );
    $("cardDescript").textContent = character.data.name;
    return;
  }
  $("cardThumb").replaceChildren("⌘");
  if (!profile) return;
  const settings = await memberSettings();
  const open = settings.characterCreation !== false;
  $("cardDescript").textContent = open
    ? "보유중인 캐릭터가 없습니다."
    : "캐릭터 생성기간이 아닙니다.";
  if (open) {
    const create = document.createElement("button");
    create.type = "button";
    create.className = "point";
    create.textContent = "캐릭터 생성";
    create.onclick = createCharacter;
    $("cardThumb").replaceChildren(create);
  }
}
$("signOut").onclick = () =>
  run(async () => {
    const member = state.member;
    state.member = null;
    state.nicks.clear();
    state.charactersLoaded = false;
    state.shopLoaded = false;
    $<HTMLDialogElement>("editor").close();
    clearPrivateViews();
    // The page becomes a visitor's at once; revoking the sign-in follows.
    await visit();
    await member.signOut();
    say("로그아웃했습니다.");
  });
$("profileForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const nick = $<HTMLInputElement>("nick").value.trim();
    if (!nick) return;
    // 회원 번호를 ID로 쓰는 문서는 그 회원만 만들 수 있다.
    const joined = await mutate("community/membership:join", {
      nick,
      // The boxes shown are required, so the form is sent only once ticked.
      agreed: !$("stipulationBox").hidden || !$("characterNoticeBox").hidden,
      ...(!$("recommenderLabel").hidden &&
      $<HTMLInputElement>("recommender").value.trim()
        ? { recommender: $<HTMLInputElement>("recommender").value.trim() }
        : {}),
    });
    const profile = joined.profile;
    state.nicks.set(state.member.id, Promise.resolve(nick));
    show(profile);
    showMainCharacter(profile).catch((error) => console.error(error));
    await loadBoards();
    await loadLogs();
    listen();
  });
};
await run(start);
