// What every part of the page shares: collection names, the page's state,
// status messages and run(), the community collections and the edit dialog.
// It imports no other part but names.js, so it is always ready before them.

import { NAME_DEFAULTS } from "./names.js";
import { imageSlotsOf } from "../_naru/modules/images.js";

const PREFIX = "neo_avocado_";
export const COLLECTION = {
  profiles: `${PREFIX}profiles`,
  characters: `${PREFIX}characters`,
  logs: `${PREFIX}logs`,
  comments: `${PREFIX}comments`,
  wallets: `${PREFIX}wallets`,
  inventory: `${PREFIX}inventory`,
  items: `${PREFIX}items`,
  recipes: `${PREFIX}recipes`,
  relations: `${PREFIX}relations`,
  wardrobe: `${PREFIX}wardrobe`,
  characterState: `${PREFIX}character_state`,
  titles: `${PREFIX}titles`,
  couples: `${PREFIX}couples`,
  settings: `${PREFIX}settings`,
  boards: `${PREFIX}boards`,
  emoticons: `${PREFIX}emoticons`,
  characterFields: `${PREFIX}character_fields`,
  sides: `${PREFIX}sides`,
  classes: `${PREFIX}classes`,
  boardGroups: `${PREFIX}board_groups`,
};
export const SHOP_PAGE = 10;
export const STATE_NAMES = {
  editing: "수정 중",
  submitted: "신청",
  approved: "승인",
};
export const TYPE_NAMES = { main: "메인", sub: "서브", npc: "NPC" };
export const LOG_PAGE = 10;
export const CHARACTER_PAGE = 20;
export const COMMENT_PAGE = 50;
export const $ = (id) => document.getElementById(id);
export const state = {
  naru: null,
  member: null,
  nicks: new Map(),
  charactersLoaded: false,
  shopLoaded: false,
  // The chosen character's inventory, as last read: buying and crafting
  // take their materials from it.
  inventoryRows: [],
  itemCatalog: new Map(),
  profile: null,
  recipes: [],
  inventoryCharacter: null,
  // The shop's chosen character's official record: buying needs it approved.
  shopCharacter: null,
  ownCharacters: [],
  historyCursor: null,
  messageCursor: null,
  admission: null,
  // 사이트공개 (cf_open), from the site's frame: off, visitors see nothing.
  siteOpen: true,
  // 기타 항목명 설정: the owner's names for money, experience, 소속, 종족.
  names: NAME_DEFAULTS,
  // 캐릭터 이미지 항목: the 두상, 흉상 and 전신 the owner uses.
  images: imageSlotsOf(),
  // The site owner, signed in here, is staff as moderators are.
  owner: false,
  role: "member",
  level: 2,
  emoticons: null,
  boards: [],
  board: "default",
  tag: null,
  // The board search (skins' 검색), while it is shown.
  search: null,
  // The board list's page, for its address.
  logPage: 1,
  live: null,
  newPost: null,
  ownPosts: new Set(),
  // The member's characters for posting, and items for in-post use: read on
  // first use, forgotten when they may have changed.
  speakers: null,
  postItems: null,
  fieldCatalogue: null,
  callCursor: null,
};
const MESSAGES = {
  AUTH_REQUIRED: "로그인이 끝났습니다. 다시 회원 로그인해 주세요.",
  ACCESS_DENIED: "권한이 없습니다.",
  RATE_LIMITED: "잠시 뒤에 다시 해 주세요.",
  QUOTA_EXCEEDED: "사이트의 저장 공간이 가득 찼습니다.",
  UNAVAILABLE: "나루에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.",
  CONFLICT: "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
};
/**
 * The site's own words for an error: a site function's ctx.fail message
 * (it passes a reason in its details), or the unique field a write hit.
 */
function siteMessage(error) {
  if (error?.details?.unique === "nick") return "이미 쓰는 닉네임입니다.";
  return error?.details?.reason ? error.message : undefined;
}
export function say(message) {
  $("status").textContent = message;
}
/**
 * A managed upload (SDK 1.1.0): Naru records which documents name its
 * address and marks it in the media library once none does.
 */
export async function uploadManaged(file) {
  return await state.member.media.upload(file, { managed: true });
}
/**
 * "pending" or "banned" when Naru refused the member because the site has not
 * approved them (or has banned them); null for any other error.
 */
export const standing = (error) =>
  (error?.code === "ACCESS_DENIED" && error.details?.membership) || null;
export async function run(action) {
  try {
    await action();
  } catch (error) {
    console.error(error);
    if (error?.code === "AUTH_REQUIRED") {
      state.member = null;
      clearPrivateViews();
      show();
    }
    if (state.member && standing(error)) {
      showAdmission(standing(error));
      return;
    }
    say(
      // A collection that does not exist yet: Naru creates them from
      // _naru/collections.json as the site's files arrive.
      error?.code === "NOT_FOUND" && /^Collection /.test(error.message)
        ? "사이트를 준비하고 있습니다. 잠시 뒤에 다시 해 주세요."
        : (siteMessage(error) ??
            MESSAGES[error?.code] ??
            "요청을 처리하지 못했습니다."),
    );
  }
}
export function clearPrivateViews() {
  stopLive();
  state.emoticons = null;
  for (const id of [
    "logs",
    "characters",
    "items",
    "inventory",
    "messages",
    "messageDetail",
    "history",
    "quests",
    "contentBody",
    "contentPage",
    "calls",
    "callDetail",
  ])
    $(id).replaceChildren();
  state.speakers = null;
  state.postItems = null;
  state.fieldCatalogue = null;
  $("tabCalls").textContent = "알림";
  $("messageDetail").hidden = true;
  $("messageBody").value = "";
  $("tabMessages").textContent = "쪽지";
}
export const formatTime = (value) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export const mine = (document) =>
  state.member !== null &&
  (document.createdBy ?? document.data.owner) === state.member.id;
/** Narrows a read to the member's own characters; `mine` still decides. */
export const ownCharacters = async () =>
  (
    await allDocuments(COLLECTION.characters, undefined, {
      any: [
        { eq: ["owner", state.member.id] },
        { eq: [{ metadata: "createdBy" }, state.member.id] },
      ],
    })
  ).filter(mine);
/** Resolve the distinct authors for a page in bounded batches before rendering. */
export async function preloadNicks(rows) {
  const member = state.member;
  const missing = [
    ...new Set(rows.map((row) => row.createdBy ?? row.data.owner)),
  ].filter((id) => id && !state.nicks.has(id));
  for (let offset = 0; offset < missing.length; offset += 50) {
    const ids = missing.slice(offset, offset + 50);
    const profiles = await collection(COLLECTION.profiles).getMany(ids);
    if (state.member !== member) return;
    profiles.forEach((profile, index) =>
      state.nicks.set(
        ids[index],
        Promise.resolve(profile?.data.nick ?? "이름 없음"),
      ),
    );
  }
}
/** 글쓴이의 닉네임. 처음 보는 회원만 한 번 묻는다. */
export async function nickOf(memberId) {
  if (!memberId) return "운영자";
  if (!state.nicks.has(memberId))
    state.nicks.set(
      memberId,
      collection(COLLECTION.profiles)
        .get(memberId)
        .then(
          (profile) => profile.data.nick,
          () => "이름 없음",
        ),
    );
  return state.nicks.get(memberId);
}
/** Who calls site functions: the signed-in member, else the visitor's client. */
export const caller = () => state.member ?? state.naru;
/** The name and password a visitor posts with (bbs/write.php's wr_name, wr_password). */
export function guestCredentials() {
  const name = $("guestName").value.trim();
  const password = $("guestPassword").value.trim();
  if (!name || password.length < 4)
    throw Object.assign(
      new Error("손님 이름과 4자 이상의 비밀번호를 입력해 주세요."),
      {
        details: { reason: "guest_identity" },
      },
    );
  return { name, password };
}
/** Asks a visitor for a guest post's password, then runs `action` with it. */
export function withGuestPassword(title, action) {
  edit(
    title,
    [
      {
        name: "password",
        label: "글을 쓸 때 정한 비밀번호",
        type: "password",
        required: true,
        max: 64,
      },
    ],
    ({ password }) => action({ password }),
  );
}
/**
 * The SDK's collection for whoever is reading: the member, or a visitor. The
 * collection rules in _naru/rules/ decide what each of them sees. Pages write
 * through site functions (community/posts, community/comments,
 * characters/sheet), except a member's own profile.
 */
export function collection(name) {
  return (state.member ?? state.naru).collection(name);
}

/**
 * Calls a site function that deletes in bounded steps (a post with its
 * comments, a character with what hangs off it) until it answers `done`.
 */
export async function removeAll(reference, args) {
  while (!(await caller().call(reference, args)).done);
}
export function showAdmission(status) {
  state.admission = status;
  state.charactersLoaded = false;
  state.shopLoaded = false;
  clearPrivateViews();
  $("community").hidden = true;
  $("profileSetup").hidden = true;
  $("admissionPanel").hidden = false;
  $("admissionTitle").textContent =
    status === "banned"
      ? "접근 차단"
      : status === "closed"
        ? "가입 닫힘"
        : status === "left"
          ? "탈퇴한 회원"
          : "가입 승인 대기";
  $("admissionDescription").textContent =
    status === "banned"
      ? "이 커뮤니티에서 차단되었습니다."
      : status === "closed"
        ? "현재 신규 가입을 받지 않습니다."
        : status === "left"
          ? "탈퇴한 회원입니다. 다시 이용하려면 운영자에게 문의해 주세요."
          : "운영자의 가입 승인이 필요합니다.";
  $("admissionId").textContent = `가입 문의용 회원 번호: ${state.member.id}`;
  $("editProfile").hidden = true;
}
export function show(profile) {
  $("admissionPanel").hidden = true;
  const member = state.member;
  document.body.classList.toggle("visitor", !member);
  document.body.classList.toggle(
    "site-closed",
    !member && state.siteOpen === false,
  );
  $("signIn").hidden = Boolean(member);
  $("signOut").hidden = !member;
  $("editProfile").hidden = !member || !profile;
  $("welcome").hidden = Boolean(member);
  $("guestIdentity").hidden = Boolean(member);
  $("profileSetup").hidden = !member || Boolean(profile);
  // Visitors see the public boards and pages (level 1).
  $("community").hidden = member ? !profile : false;
  $("whoami").textContent = profile ? `${profile.data.nick} 님` : "";
  // The main page's card (templete/txt.outlogin.php).
  $("cardName").textContent = profile ? profile.data.nick : "손님";
  $("cardRole").hidden = state.role !== "moderator";
  $("cardDescript").textContent = profile ? "" : "회원 로그인해 주세요.";
  state.profile = profile ?? null;
}
/** An inline form retains the draft when saving fails. */
export function edit(title, fields, save) {
  $("editorTitle").textContent = title;
  $("editorStatus").textContent = "";
  $("editorFields").replaceChildren();
  const inputs = {};
  for (const field of fields) {
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement(
      field.options ? "select" : field.multiline ? "textarea" : "input",
    );
    input.name = field.name;
    if (field.type) input.type = field.type;
    if (field.accept) input.accept = field.accept;
    if (field.options) {
      for (const [value, text] of field.options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        input.append(option);
      }
    }
    if (field.type === "checkbox") input.checked = Boolean(field.value);
    else if (field.type !== "file") input.value = field.value ?? "";
    input.required = Boolean(field.required);
    if (field.max) input.maxLength = field.max;
    if (field.min !== undefined) input.min = String(field.min);
    label.append(input);
    $("editorFields").append(label);
    inputs[field.name] = input;
  }
  $("editorForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("editorForm").querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await save(
        Object.fromEntries(
          Object.entries(inputs).map(([name, input]) => [
            name,
            input.type === "file"
              ? (input.files?.[0] ?? null)
              : input.type === "checkbox"
                ? input.checked
                : input.value.trim(),
          ]),
        ),
      );
      $("editor").close();
    } catch (error) {
      $("editorStatus").textContent =
        siteMessage(error) ??
        MESSAGES[error?.code] ??
        error.message ??
        "저장하지 못했습니다.";
    } finally {
      button.disabled = false;
    }
  };
  $("editor").showModal();
}
$("cancelEditor").onclick = () => $("editor").close();
export function stopLive() {
  state.live?.close();
  state.live = null;
}
export async function allDocuments(name, filter, where) {
  const documents = [];
  let after = null;
  do {
    const page = await collection(name).list({
      size: 100,
      after,
      ...(filter ? { filter } : {}),
      ...(where ? { where } : {}),
    });
    documents.push(...page.documents);
    after = page.nextCursor;
  } while (after);
  return documents;
}
/** Where a member is, as 현재접속자 shows it, for each view. */
const PLACES = {
  home: "메인",
  logs: "로그",
  characters: "멤버목록",
  shop: "상점",
  messages: "쪽지",
  quests: "퀘스트",
  content: "안내",
  calls: "알림",
  couples: "커플목록",
  mypage: "마이페이지",
  myLogs: "마이페이지",
  myExp: "마이페이지",
  online: "현재접속자",
};
/** The browser, OS and device a page reports with a visit, for statistics. */
function client() {
  const agent = navigator.userAgent;
  const browser = /SamsungBrowser/.test(agent)
    ? "Samsung"
    : /Whale/.test(agent)
      ? "Whale"
      : /Edg\//.test(agent)
        ? "Edge"
        : /Firefox\//.test(agent)
          ? "Firefox"
          : /Chrome\//.test(agent)
            ? "Chrome"
            : /Safari\//.test(agent)
              ? "Safari"
              : "기타";
  const os = /iPhone|iPad|iPod/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "기타";
  const device = /iPad|Tablet/.test(agent)
    ? "태블릿"
    : /Mobi|iPhone|Android/.test(agent)
      ? "모바일"
      : "PC";
  return { browser, os, device };
}
let lastVisit = 0;
let lastPlace = null;
/**
 * Tells Naru where the visitor is (현재접속자, 접속자집계): on the first
 * page, then when they move on, at most every 30 seconds. Never polls.
 */
/** True the first time this browser asks on a Korean day, then false until the next. */
function firstVisitToday() {
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    if (localStorage.getItem("neo-avocado-visited") === day) return false;
    localStorage.setItem("neo-avocado-visited", day);
  } catch {
    /* Storage blocked: count once a page load instead. */
  }
  return true;
}
export function noteVisit(place) {
  if (!state.naru) return;
  const now = Date.now();
  if (place === lastPlace || (lastVisit && now - lastVisit < 30_000)) return;
  const first = !lastVisit;
  lastVisit = now;
  lastPlace = place;
  // A browser counts as a visitor once a Korean day, as the original's
  // ck_visit_ip cookie (bbs/visit_insert.inc.php) lets it; a visitor who is
  // not signed in reports nothing else, so browsing costs them no calls.
  const visit = firstVisitToday();
  if (!visit && !state.member) return;
  let domain = "";
  try {
    const from = first && document.referrer ? new URL(document.referrer) : null;
    if (from && from.host !== location.host) domain = from.hostname;
  } catch {
    /* No referrer to count. */
  }
  caller()
    .call("community/presence:seen", {
      where: place,
      ...(visit
        ? { visit: true, ...client(), ...(domain ? { domain } : {}) }
        : {}),
    })
    .catch(() => {
      /* A visit not counted is no reason to bother anyone. */
    });
}

/**
 * Every page has an address (#/logs/free/12, #/character/…, #/shop/이벤트),
 * as the original's pages have URLs: it can be shared, reloaded, and gone
 * back to. Moving to another page makes a history entry; changes within a
 * page (a board, a category) replace it. app/router.js opens addresses.
 */
let routing = false;
let moved = false;
/** Whether the visitor has gone somewhere themselves since the page opened. */
export const movedSinceOpening = () => moved;
export function route(path, { replace = false } = {}) {
  if (routing) return;
  moved = true;
  // A list is taken part by part, so a tag or search with "/" stays one.
  const parts = Array.isArray(path) ? path : path.split("/");
  const hash = `#/${parts
    .filter((part) => part !== "")
    .map(encodeURIComponent)
    .join("/")}`;
  if (location.hash === hash) return;
  history[replace ? "replaceState" : "pushState"](null, "", hash);
}
/** While an address is being opened, the page does not write one back. */
export async function opening(action) {
  routing = true;
  try {
    return await action();
  } finally {
    routing = false;
  }
}
/** A view's own address. */
function viewPath(name) {
  if (name === "home") return "";
  // The board or page shown, so the address names it.
  if (name === "logs") return `logs/${state.board ?? "default"}`;
  if (name === "content")
    return $("contentPage").value
      ? `content/${$("contentPage").value}`
      : "content";
  if (name === "characters") {
    const filter = $("characterFilter").value;
    return filter === "approved"
      ? "members"
      : filter === "applicants"
        ? "applicants"
        : "characters";
  }
  if (name === "myLogs") return "mypage/logs";
  if (name === "myExp") return "mypage/exp";
  return name;
}

/** The views under 마이페이지's own menu (mypage/). */
const MYPAGE = {
  mypage: "myAccountTab",
  myLogs: "myLogsTab",
  myExp: "myExpTab",
  messages: "myMailTab",
  calls: "myCallsTab",
};
export function showTab(name) {
  // What an action said belongs to the page it was done on.
  say("");
  noteVisit(PLACES[name] ?? name);
  route(viewPath(name));
  $("mypageNav").hidden = !Object.hasOwn(MYPAGE, name);
  for (const [view, button] of Object.entries(MYPAGE))
    $(button).setAttribute("aria-pressed", String(view === name));
  for (const [view, key] of [
    ["characterView", "character"],
    ["onlineView", "online"],
    ["mypageView", "mypage"],
    ["myLogsView", "myLogs"],
    ["myExpView", "myExp"],
    ["couplesView", "couples"],
  ])
    $(view).hidden = name !== key;
  $("tabCouples").setAttribute("aria-pressed", String(name === "couples"));
  $("tabMypage").setAttribute(
    "aria-pressed",
    String(Object.hasOwn(MYPAGE, name)),
  );
  for (const [tab, view, key] of [
    ["tabHome", "homeView", "home"],
    ["tabLogs", "logsView", "logs"],
    ["tabCharacters", "charactersView", "characters"],
    ["tabShop", "shopView", "shop"],
    ["tabMessages", "messagesView", "messages"],
    ["tabQuests", "questsView", "quests"],
    ["tabContent", "contentView", "content"],
    ["tabCalls", "callsView", "calls"],
  ]) {
    $(tab).setAttribute("aria-pressed", String(name === key));
    $(view).hidden = name !== key;
  }
}

/**
 * Numbered pages over a list the SDK reads by cursor (lib's get_paging,
 * pg_wrap). `read(after, { includeTotal, size, cursorOnly })` reads `size`
 * documents from `after`. The total comes with the first page, and a page
 * past it is empty, as the original's LIMIT past the end shows nothing. A
 * page not reached yet is skipped to from the nearest known one, up to 100
 * documents a read, keeping only the cursor.
 */
export function cursorPages(read, size) {
  const starts = new Map([[1, null]]);
  // As many pages as one read of at most 100 documents covers.
  const skip = Math.max(1, Math.floor(100 / size));
  return {
    total: null,
    reset() {
      starts.clear();
      starts.set(1, null);
      this.total = null;
    },
    async page(number) {
      if (this.total === null) {
        const first = await read(null, { includeTotal: true, size });
        this.total = first.totalCount ?? null;
        if (first.nextCursor) starts.set(2, first.nextCursor);
        if (number <= 1) return { ...first, number: 1 };
      }
      const pages = Math.max(1, Math.ceil((this.total ?? 0) / size));
      if (number > pages) return { documents: [], nextCursor: null, number };
      let known = Math.max(...[...starts.keys()].filter((at) => at <= number));
      while (known < number) {
        const jump = Math.min(skip, number - known);
        const step = await read(starts.get(known), {
          size: size * jump,
          cursorOnly: true,
        });
        if (!step.nextCursor) break;
        known += jump;
        starts.set(known, step.nextCursor);
      }
      const page = await read(starts.get(known), { size });
      if (page.nextCursor) starts.set(known + 1, page.nextCursor);
      return { ...page, number: known };
    },
  };
}

/**
 * The page numbers under a list: ‹ 1 2 3 4 5 › around the current page, as
 * the original shows five at a time.
 */
export function renderPages(nav, current, pages, pick) {
  nav.replaceChildren();
  nav.hidden = pages <= 1;
  if (pages <= 1) return;
  const first = Math.max(1, Math.min(current - 2, pages - 4));
  const last = Math.min(pages, first + 4);
  const button = (label, number, extra = {}) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.className = "page";
    if (number === current) element.setAttribute("aria-current", "page");
    element.disabled = number < 1 || number > pages;
    Object.assign(element, extra);
    element.onclick = () => run(() => pick(number));
    return element;
  };
  nav.append(
    button("‹", current - 1, {
      ariaLabel: "이전 페이지",
      className: "page control",
    }),
    ...Array.from({ length: last - first + 1 }, (_, i) =>
      button(String(first + i), first + i),
    ),
    button("›", current + 1, {
      ariaLabel: "다음 페이지",
      className: "page control",
    }),
  );
}
