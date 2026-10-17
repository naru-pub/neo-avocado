// What every part of the page shares: the page's state, status messages and
// run(), the site's queries and mutations, and the edit dialog.
// It imports no other part but names.js, so it is always ready before them.

import { NAME_DEFAULTS } from "./names.js";
import { imageSlotsOf, viewerOf } from "../_naru/modules/images.js";

export const SHOP_PAGE = 10;
export const STATE_NAMES = {
  editing: "수정 중",
  submitted: "신청",
  approved: "승인",
  deleted: "삭제",
};
export const TYPE_NAMES = { main: "메인", sub: "서브", npc: "NPC" };
export const CHARACTER_PAGE = 20;
export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const initialState = {
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
  admission: null,
  // 사이트공개 (cf_open), from the site's frame: off, visitors see nothing.
  siteOpen: true,
  // 기타 항목명 설정: the owner's names for money, experience, 소속, 종족.
  names: NAME_DEFAULTS,
  // 캐릭터 이미지 항목: the 두상, 흉상 and 전신 the owner uses.
  images: imageSlotsOf(),
  // What a character's page shows (ad_use_exp, _rank, _status, _title…).
  viewer: viewerOf(),
  // 디자인's 접속자 카운터 (mmb_counter): HTML shown above picture boards.
  counter: "",
  // 커뮤니티 설정's 쪽지·호출 알림음: the arrival popups may chime.
  alarmSound: false,
  // The site owner, signed in here, is staff as moderators are.
  owner: false,
  role: "member",
  level: 2,
  // mb_adult: 19금 posts show uncovered.
  adult: false,
  // 경고내역: the owner's warnings, from the member's own record.
  warnings: { count: 0, note: "" },
  emoticons: null,
  boards: [],
  board: "default",
  tag: null,
  // The board list's 분류 (sca), while one is chosen.
  category: null,
  // The board search (skins' 검색), while it is shown.
  search: null,
  // The board list's page, for its address.
  logPage: 1,
  live: null,
  // The board whose newest post the page keeps in view (live.js).
  boardWatch: null as {
    board: string;
    reader: unknown;
    handle: { close(): void };
  } | null,
  newPost: null,
  ownPosts: new Set(),
  // The member's characters for posting, and items for in-post use: read on
  // first use, forgotten when they may have changed.
  speakers: null,
  postItems: null,
  fieldCatalogue: null,
  callCursor: null,
};
/** What the page reads later and keeps here, absent until then. */
interface LaterState {
  // The owner's 소속 and 종족 lists (characters.js).
  sides?: any[];
  classes?: any[];
  // The shop's categories, the chosen one and its greeting (shop.js).
  shopCategories?: string[];
  shopCategory?: string;
  shopGreeting?: string;
}
export const state: typeof initialState & LaterState = initialState;
const MESSAGES = {
  AUTH_REQUIRED: "로그인이 끝났습니다. 다시 회원 로그인해 주세요.",
  ACCESS_DENIED: "권한이 없습니다.",
  RATE_LIMITED: "잠시 뒤에 다시 해 주세요.",
  QUOTA_EXCEEDED: "사이트의 저장 공간이 가득 찼습니다.",
  UNAVAILABLE: "나루에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.",
  CONFLICT: "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
};
/**
 * The site's own words for an error: a query's or mutation's ctx.fail
 * message (it passes a reason in its details), or the unique field a write
 * hit.
 */
function siteMessage(error) {
  if (error?.details?.unique === "nick") return "이미 쓰는 닉네임입니다.";
  return error?.details?.reason ? error.message : undefined;
}
export function say(message) {
  $("status").textContent = message;
}
/**
 * Uploads a file as the member. Its address is kept in the site's tables,
 * which Naru's media library searches to mark uploads no row names.
 */
export async function uploadMedia(file) {
  return await state.member.media.upload(file);
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
      siteMessage(error) ??
        MESSAGES[error?.code] ??
        "요청을 처리하지 못했습니다.",
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
  $<HTMLTextAreaElement>("messageBody").value = "";
  $("tabMessages").textContent = "쪽지";
}
export const formatTime = (value) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
/**
 * Whether the member moderates a board: the staff (and the site's owner),
 * or its 게시판 관리자 or its group's 그룹 관리자 (bo_admin, gr_admin).
 */
export function boardStaff(boardId: string | null | undefined = state.board) {
  if (state.role === "moderator") return true;
  const me = state.member?.id;
  const board = state.boards.find((row) => row.id === (boardId ?? "default"));
  return Boolean(
    me && board && (board.data.admin === me || board.data.groupAdmin === me),
  );
}
export const mine = (document) =>
  state.member !== null &&
  (document.createdBy ?? document.data.owner) === state.member.id;
/** The member's own characters, oldest first (characters/sheet:mine). */
export const ownCharacters = async () =>
  (await query("characters/sheet:mine")).documents;
/** Resolve the distinct authors for a page in bounded batches before rendering. */
export async function preloadNicks(rows) {
  const member = state.member;
  const missing: string[] = [
    ...new Set<string>(rows.map((row) => row.createdBy ?? row.data.owner)),
  ].filter((id) => id && !state.nicks.has(id));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const ids = missing.slice(offset, offset + 100);
    const { nicks } = await query("community/profiles:nicks", { ids });
    if (state.member !== member) return;
    for (const id of ids)
      state.nicks.set(id, Promise.resolve(nicks[id] ?? "이름 없음"));
  }
}
/** 글쓴이의 닉네임. 처음 보는 회원만 한 번 묻는다. */
export async function nickOf(memberId) {
  if (!memberId) return "운영자";
  if (!state.nicks.has(memberId))
    state.nicks.set(
      memberId,
      query("community/profiles:nicks", { ids: [memberId] }).then(
        ({ nicks }) => nicks[memberId] ?? "이름 없음",
        () => "이름 없음",
      ),
    );
  return state.nicks.get(memberId);
}
/**
 * The community settings members' pages need (content/site:settings), or
 * none while they cannot be read.
 */
export const memberSettings = (): Promise<Record<string, any>> =>
  query("content/site:settings").catch(() => ({}));
/** Who calls queries and mutations: the signed-in member, else the visitor's client. */
export const caller = () => state.member ?? state.naru;
/**
 * Runs one of the site's queries (_naru/queries/<module>.ts) as whoever is
 * reading: the member, or a visitor. The query's code decides what each sees.
 */
export const query = <R = any>(name: string, args: any = null): Promise<R> =>
  caller().query(name, args);
/** Runs one of the site's mutations (_naru/mutations/<module>.ts), in one transaction. */
export const mutate = <R = any>(name: string, args: any = null): Promise<R> =>
  caller().mutate(name, args);
/** A query's answer, kept current while the page holds it (`close()` ends it). */
export const subscribe = <R = any>(
  name: string,
  args: any,
  onResult: (result: R) => void,
  onError?: (error: any) => void,
) => caller().subscribe(name, args, onResult, { onError });
/** The name and password a visitor posts with (bbs/write.php's wr_name, wr_password). */
export function guestCredentials() {
  const name = $<HTMLInputElement>("guestName").value.trim();
  const password = $<HTMLInputElement>("guestPassword").value.trim();
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
export function showAdmission(status) {
  state.admission = status;
  state.charactersLoaded = false;
  state.shopLoaded = false;
  clearPrivateViews();
  $("community").hidden = true;
  $("profileSetup").hidden = true;
  $("admissionPanel").hidden = false;
  const [title, description] = {
    banned: ["접근 차단", "이 커뮤니티에서 차단되었습니다."],
    blocked: ["접근 차단", "운영자가 이 커뮤니티의 접근을 차단했습니다."],
    deleted: [
      "삭제된 회원",
      "운영자가 이 커뮤니티의 회원 정보를 삭제했습니다.",
    ],
    closed: ["가입 닫힘", "현재 신규 가입을 받지 않습니다."],
    left: [
      "탈퇴한 회원",
      "탈퇴한 회원입니다. 다시 이용하려면 운영자에게 문의해 주세요.",
    ],
  }[status] ?? ["가입 승인 대기", "운영자의 가입 승인이 필요합니다."];
  $("admissionTitle").textContent = title;
  $("admissionDescription").textContent = description;
  $("admissionId").textContent = `가입 문의용 회원 번호: ${state.member.id}`;
  $("editProfile").hidden = true;
}
export function show(profile?) {
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
  // outlogin.skin.2.php's 관리자 link, for the site's owner.
  $("cardAdmin").hidden = !member || !state.owner;
  $("cardDescript").textContent = profile ? "" : "회원 로그인해 주세요.";
  state.profile = profile ?? null;
}
/** One field of the edit dialog. */
export interface EditField {
  name: string;
  label: string;
  value?: any;
  type?: string;
  accept?: string;
  // [value, text] pairs; makes the field a select.
  options?: ReadonlyArray<ReadonlyArray<any>>;
  multiline?: boolean;
  required?: boolean;
  max?: number;
  min?: number;
}
/** An inline form retains the draft when saving fails. */
export function edit(
  title: string,
  fields: EditField[],
  save: (values: Record<string, any>) => unknown,
) {
  $("editorTitle").textContent = title;
  $("editorStatus").textContent = "";
  $("editorFields").replaceChildren();
  const inputs: Record<string, HTMLInputElement> = {};
  for (const field of fields) {
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement(
      field.options ? "select" : field.multiline ? "textarea" : "input",
    ) as HTMLInputElement; // the members set below are those the field asks for
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
    const button =
      $("editorForm").querySelector<HTMLButtonElement>('[type="submit"]');
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
      $<HTMLDialogElement>("editor").close();
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
  $<HTMLDialogElement>("editor").showModal();
}
$("cancelEditor").onclick = () => $<HTMLDialogElement>("editor").close();
export function stopLive() {
  state.live?.close();
  state.live = null;
  state.boardWatch?.handle.close();
  state.boardWatch = null;
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
  myFavorites: "마이페이지",
  myMoney: "마이페이지",
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
  mutate("community/presence:seen", {
    where: place,
    ...(visit
      ? { visit: true, ...client(), ...(domain ? { domain } : {}) }
      : {}),
  }).catch(() => {
    /* A visit not counted is no reason to bother anyone. */
  });
}

/**
 * Every page has an address (/logs/free/12, /character/…, /shop/이벤트), as
 * the original's pages have URLs: it can be shared, reloaded, and gone back
 * to, and Naru serves each with its link preview (_naru/routes/). Moving to
 * another page makes a history entry; changes within a page (a board, a
 * category) replace it. app/router.js opens addresses.
 */
let routing = false;
let moved = false;
/** The path the page shows, as last opened or written. */
let shownAt: string | null = null;
/** Whether the visitor has gone somewhere themselves since the page opened. */
export const movedSinceOpening = () => moved;
/** The path the page shows now (null before the first is opened). */
export const shownAddress = () => shownAt;
/** Marks `path` as the one the page shows. */
export const showingAddress = (path: string) => {
  shownAt = path;
};
/** A page's path: ["logs", "free", "12"] → "/logs/free/12", "" → "/". */
export const addressOf = (path: string | string[]) =>
  `/${(Array.isArray(path) ? path : path.split("/"))
    .filter((part) => part !== "")
    .map(encodeURIComponent)
    .join("/")}`;
export function route(path, { replace = false } = {}) {
  if (routing) return;
  moved = true;
  // A list is taken part by part, so a tag or search with "/" stays one.
  const address = addressOf(path);
  shownAt = address;
  if (location.pathname === address && !location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", address);
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
    return $<HTMLSelectElement>("contentPage").value
      ? `content/${$<HTMLSelectElement>("contentPage").value}`
      : "content";
  if (name === "characters") {
    const filter = $<HTMLSelectElement>("characterFilter").value;
    return filter === "approved"
      ? "members"
      : filter === "applicants"
        ? "applicants"
        : "characters";
  }
  if (name === "myLogs") return "mypage/logs";
  if (name === "myExp") return "mypage/exp";
  if (name === "myFavorites") return "mypage/favorites";
  if (name === "myMoney") return "mypage/money";
  return name;
}

/** The views under 마이페이지's own menu (mypage/). */
const MYPAGE = {
  mypage: "myAccountTab",
  myLogs: "myLogsTab",
  myExp: "myExpTab",
  myFavorites: "myFavoritesTab",
  myMoney: "myMoneyTab",
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
    ["myFavoritesView", "myFavorites"],
    ["myMoneyView", "myMoney"],
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
