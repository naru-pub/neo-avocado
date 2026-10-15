// What every part of the page shares: collection names, the page's state,
// status messages and run(), the community collections and the edit dialog.
// It imports no other part, so it is always ready before them.

import { sanitizedFragment } from "../content-renderer.js";

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
};
export const SHOP_PAGE = 50;
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
  logCursor: null,
  characterCursor: null,
  charactersLoaded: false,
  shopLoaded: false,
  inventoryCursor: null,
  itemCursor: null,
  itemCatalog: new Map(),
  profile: null,
  recipes: [],
  inventoryCharacter: null,
  ownCharacters: [],
  historyCursor: null,
  messageCursor: null,
  admission: null,
  role: "member",
  level: 2,
  emoticons: null,
  boards: [],
  board: "default",
  tag: null,
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
 * A managed upload (SDK 1.1.0): Naru keeps it while a document names its
 * address and deletes it once none does, so nothing else is recorded here.
 */
export async function uploadManaged(file) {
  return await state.member.media.upload(file, { managed: true });
}
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
    if (error?.code === "ACCESS_DENIED" && state.member) {
      try {
        const platform = await state.member.membership();
        if (platform.status !== "approved") {
          showAdmission(platform.status);
          return;
        }
      } catch (statusError) {
        if (statusError?.code === "AUTH_REQUIRED") {
          state.member = null;
          clearPrivateViews();
          show();
        }
      }
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
    "messageRecipients",
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
    const profiles = await communityCollection(COLLECTION.profiles).getMany(
      ids,
    );
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
      communityCollection(COLLECTION.profiles)
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
 * A community collection. Reads are the SDK's own (`member.collection()`, or a
 * visitor's `naru.collection()`); the collection rules in _naru/rules/ decide
 * what each reader sees. Writes go through the community/data site function,
 * which checks board levels and guest passwords and numbers posts.
 */
export function communityCollection(collection) {
  const reader = (state.member ?? state.naru).collection(collection);
  const write = async (operation, id, data, options = {}) =>
    caller().call("community/data:communityData", {
      collection,
      operation,
      ...(id !== undefined ? { id } : {}),
      ...(data !== undefined ? { data } : {}),
      options,
    });
  return {
    get: (id) => reader.get(id),
    getMany: (ids) => reader.getMany(ids),
    list: async (options) => {
      const page = await reader.list(options);
      if (collection !== COLLECTION.logs) return page;
      // A list shows each post's start; the whole post is read when opened.
      return {
        ...page,
        documents: page.documents.map((doc) => {
          const raw = doc.data.text ?? "";
          if (raw.length <= 150) return doc;
          const text = doc.data.format === "html" ? htmlText(raw) : raw;
          return {
            ...doc,
            data: { ...doc.data, text: text.slice(0, 150), truncated: true },
          };
        }),
      };
    },
    add: async (data, options) =>
      (await write("add", undefined, data, options)).document,
    set: async (id, data, options) =>
      (await write("set", id, data, options)).document,
    delete: async (id, options = {}) => {
      let result = await write("delete", id, undefined, options);
      const { condition, ...rest } = options;
      while (!result.done) result = await write("delete", id, undefined, rest);
    },
  };
}
/** The text of an HTML body, for a preview cut short. */
function htmlText(html) {
  const holder = document.createElement("div");
  holder.append(sanitizedFragment(document, html));
  return holder.textContent.replace(/\s+/g, " ").trim();
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
        : "가입 승인 대기";
  $("admissionDescription").textContent =
    status === "banned"
      ? "이 커뮤니티에서 차단되었습니다."
      : status === "closed"
        ? "현재 신규 가입을 받지 않습니다."
        : "운영자의 가입 승인이 필요합니다.";
  $("admissionId").textContent = `가입 문의용 회원 번호: ${state.member.id}`;
  $("editProfile").hidden = true;
}
export function show(profile) {
  $("admissionPanel").hidden = true;
  const member = state.member;
  document.body.classList.toggle("visitor", !member);
  $("signIn").hidden = Boolean(member);
  $("signOut").hidden = !member;
  $("editProfile").hidden = !member || !profile;
  $("welcome").hidden = Boolean(member);
  $("guestIdentity").hidden = Boolean(member);
  $("profileSetup").hidden = !member || Boolean(profile);
  // Visitors see the public boards and pages (level 1).
  $("community").hidden = member ? !profile : false;
  $("whoami").textContent = profile ? `${profile.data.nick} 님` : "";
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
export async function allDocuments(collection, filter, where) {
  const documents = [];
  let after = null;
  do {
    const page = await communityCollection(collection).list({
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
export function showTab(name) {
  for (const [tab, view, key] of [
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
