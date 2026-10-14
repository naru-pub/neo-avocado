import {
  retryMemberMedia,
  rememberUpload,
  forgetUpload,
  recoverPendingUploads,
} from "./media-cleanup.js";
import { emoticonContent } from "./emoticons.js";
import { renderContent } from "./content-renderer.js";
import { functionReference } from "./function-references.js";
import { config } from "./config.js";

// 아보카도 에디션의 뼈대만 나루 회원으로 다시 만든 것: 회원 로그인과 닉네임,
// 캐릭터 등록, 그림 로그와 댓글, 댓글 주사위, 상점과 뽑기. 회원이 쓰는
// 컬렉션은 읽기·쓰기 모두 ‘회원’이라 로그인한 회원만 보고, 회원은 자기가 만든
// 문서만 고치고 지운다. 돈과 아이템은 회원이 읽기만 하고, 사이트의 서버 함수
// (_naru/functions 아래의 모듈)만 바꾼다.
const PREFIX = "neo_avocado_";
const COLLECTION = {
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
const SHOP_PAGE = 50;
const REASONS = {
  already: "오늘은 이미 받았습니다.",
  sold_out: "품절입니다.",
  not_enough: "아보가 모자랍니다.",
  no_item: "없는 아이템입니다.",
  empty: "아직 뽑을 것이 없습니다.",
  not_owned: "내가 가진 아이템이 아닙니다.",
  not_sellable: "판매할 수 없는 아이템입니다.",
  not_giftable: "선물할 수 없는 아이템입니다.",
  no_recipient: "받는 회원을 확인해 주세요.",
  invalid_input: "입력 내용을 확인해 주세요.",
  no_recipe: "없는 레시피입니다.",
  invalid_materials: "레시피에 맞는 재료를 선택해 주세요.",
  no_character: "캐릭터를 확인해 주세요.",
  conflict: "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
  outfit_in_use: "사용 중인 의상은 먼저 기본 두상으로 바꿔 주세요.",
  no_profile: "먼저 닉네임을 등록해 주세요.",
  not_usable: "사용할 수 없는 아이템입니다.",
  already_full: "이미 전부 회복되었습니다.",
  wrong_character: "이 아이템을 가진 캐릭터를 선택해 주세요.",
  not_enough_points: "배분할 능력치 포인트가 모자랍니다.",
  not_approved: "승인된 캐릭터만 할 수 있습니다.",
  restricted_character: "이 캐릭터의 세력·종족은 구매할 수 없습니다.",
  not_enough_exp: "경험치가 모자랍니다.",
  missing_title: "필요한 타이틀이 없습니다.",
  purchase_limit: "이 아이템의 구매 한도에 도달했습니다.",
  invalid_recipients: "받는 회원을 중복 없이 1~20명 선택해 주세요.",
  message_not_found: "쪽지가 없거나 읽을 권한이 없습니다.",
  banned: "이 커뮤니티에서 차단되었습니다.",
  approval_required: "운영자의 가입 승인이 필요합니다.",
  registration_closed: "현재 신규 가입을 받지 않습니다.",
  document_not_found: "자료를 찾을 수 없습니다.",
  access_denied: "권한이 없습니다.",
  media_unavailable: "그림 파일을 쓸 수 없습니다. 다시 올려 주세요.",
  media_ref_limit: "이 그림을 더 많은 곳에 쓸 수 없습니다.",
  nick_taken: "이미 쓰는 닉네임입니다.",
  invalid_field: "프로필 항목을 확인해 주세요.",
  missing_fields: "신청하려면 필수 프로필 항목을 모두 채워 주세요.",
  fields_too_long: "추가 프로필 항목은 합쳐서 6,000자까지입니다.",
  explore_closed: "지금은 탐색할 수 없습니다.",
  explore_limit: "이 캐릭터는 오늘 탐색을 모두 했습니다.",
  not_usable_here: "이 아이템은 인벤토리에서 사용해 주세요.",
};
const STATE_NAMES = {
  editing: "수정 중",
  submitted: "신청",
  approved: "승인",
};
const TYPE_NAMES = { main: "메인", sub: "서브", npc: "NPC" };
const LOG_PAGE = 10;
const CHARACTER_PAGE = 20;
const COMMENT_PAGE = 50;

const $ = (id) => document.getElementById(id);
const state = {
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
/** A function's ctx.fail reason, or a unique field it collided on. */
function reasonOf(error) {
  if (error?.details?.unique === "nick") return REASONS.nick_taken;
  const reason = error?.details?.reason;
  return typeof reason === "string" && Object.hasOwn(REASONS, reason)
    ? REASONS[reason]
    : undefined;
}
function say(message) {
  $("status").textContent = message;
}
async function recoverMedia() {
  const member = state.member;
  if (!member || state.admission !== "approved") return;
  try {
    await recoverPendingUploads(member);
    await retryMemberMedia(member);
  } catch {
    /* The durable queue or local pending record is retried on the next visit. */
  }
}
async function uploadManaged(file) {
  const member = state.member;
  const uploaded = await member.media.upload(file);
  if (!uploaded.id) throw new Error("업로드한 파일 번호를 받지 못했습니다.");
  rememberUpload(member, uploaded);
  const registered = await member.call(functionReference("registerMedia"), {
    id: uploaded.id,
    url: uploaded.url,
  });
  if (!registered.ok) throw new Error("미디어 기록을 저장하지 못했습니다.");
  forgetUpload(member, uploaded.id);
  return uploaded;
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    console.error(error);
    await recoverMedia();
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
      reasonOf(error) ?? MESSAGES[error?.code] ?? "요청을 처리하지 못했습니다.",
    );
  }
}
function clearPrivateViews() {
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
const formatTime = (value) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

// 댓글 주사위: 굴린 값을 페이지가 정하면 누구나 원하는 눈을 적을 수 있다.
// 대신 서버가 댓글에 붙이는 ID에서 읽는다. ID는 회원이 고를 수 없으므로,
// 같은 댓글은 누가 언제 보든 같은 눈이 나온다.
export function diceOf(id) {
  const roll = (seed) => {
    let hash = seed;
    for (const char of id) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return (hash % 6) + 1;
  };
  return [roll(2166136261), roll(3141592653)];
}

/** A post's dice: rolled by the server since the roleplay port, else from its ID. */
function diceText(row) {
  const [first, second] =
    Array.isArray(row.data.rolls) && row.data.rolls.length === 2
      ? row.data.rolls
      : diceOf(row.id);
  return `🎲 ${first} + ${second} = ${first + second}`;
}

const CALL_PART = /(\[\[[^[\]\r\n]{1,20}\]\])/;
/** Text with [[nick]] calls marked, as autolink() did; the rest stays text. */
function postText(text, emoticons = []) {
  const fragment = document.createDocumentFragment();
  for (const part of String(text ?? "").split(CALL_PART)) {
    if (!part) continue;
    if (CALL_PART.test(part) && part.startsWith("[[")) {
      const call = document.createElement("span");
      call.className = "member-call";
      call.textContent = part.slice(2, -2);
      fragment.append(call);
    } else fragment.append(emoticonContent(document, part, emoticons));
  }
  return fragment;
}

/** Who wrote a post: the character it was posted as, with title and outfit, then the nickname. */
async function speakerLabel(row) {
  const nick = await nickOf(row.createdBy ?? row.data.owner);
  const speaker = row.data.speaker;
  const fragment = document.createDocumentFragment();
  if (!speaker?.name) {
    fragment.append(nick);
    return fragment;
  }
  if (speaker.portrait?.startsWith("https://")) {
    const portrait = document.createElement("img");
    portrait.className = "speaker-portrait";
    portrait.src = speaker.portrait;
    portrait.alt = "";
    portrait.loading = "lazy";
    fragment.append(portrait);
  }
  if (speaker.title) {
    const title = document.createElement("span");
    title.className = "speaker-title";
    if (speaker.titleImage?.startsWith("https://")) {
      const image = document.createElement("img");
      image.className = "title-image";
      image.src = speaker.titleImage;
      image.alt = "";
      title.append(image);
    }
    title.append(speaker.title);
    fragment.append(title, " ");
  }
  const name = document.createElement("span");
  name.className = "speaker-name";
  name.textContent = speaker.name;
  fragment.append(name, ` (${nick})`);
  return fragment;
}

/** What an in-post action did, as the mmb skin's action logs (log.S, log.item). */
function actionItem(action) {
  const line = document.createElement("p");
  line.className = "post-action";
  const image =
    action.type === "use" && action.prize ? null : (action.image ?? null);
  if (image?.startsWith("https://")) {
    const picture = document.createElement("img");
    picture.src = image;
    picture.alt = "";
    picture.className = "action-image";
    line.append(picture);
  }
  if (action.type === "explore")
    line.append(
      action.item
        ? `탐색하여 ${action.name}을(를) 획득했습니다!`
        : "탐색했지만 아무것도 얻지 못했습니다.",
      typeof action.remaining === "number"
        ? ` (오늘 남은 탐색 ${action.remaining}회)`
        : "",
    );
  else if (action.effect === "draw")
    line.append(
      action.prize
        ? `${action.name}을(를) 사용해서 ${action.prize.name}을(를) 획득했습니다!`
        : `${action.name}을(를) 사용했지만 아무것도 획득하지 못했습니다…`,
    );
  else
    line.append(
      `${action.name}을(를) 사용했습니다!`,
      action.effect === "restore"
        ? ` (${action.stat} +${action.amount})`
        : action.description
          ? ` (${action.description})`
          : "",
    );
  return line;
}

/** Fills a "post as" select with the member's characters the first time it is used. */
function wireSpeakerChoice(select) {
  const fill = () =>
    run(async () => {
      if (select.dataset.loaded) return;
      select.dataset.loaded = "1";
      state.speakers ??= await ownCharacters();
      for (const row of state.speakers) {
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = row.data.name;
        select.append(option);
      }
    });
  select.onfocus = fill;
  select.onpointerdown = fill;
}

/** Fills an in-post item select with the member's own inventory. */
function wireItemChoice(select) {
  select.onfocus = select.onpointerdown = () =>
    run(async () => {
      if (select.dataset.loaded) return;
      select.dataset.loaded = "1";
      state.postItems ??= await allDocuments(COLLECTION.inventory, {
        owner: state.member.id,
      });
      for (const row of state.postItems) {
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = row.data.name ?? row.data.item;
        select.append(option);
      }
    });
}

const mine = (document) =>
  state.member !== null &&
  (document.createdBy ?? document.data.owner) === state.member.id;
/** Narrows a read to the member's own characters; `mine` still decides. */
const ownCharacters = async () =>
  (
    await allDocuments(COLLECTION.characters, undefined, {
      any: [
        { eq: ["owner", state.member.id] },
        { eq: [{ metadata: "createdBy" }, state.member.id] },
      ],
    })
  ).filter(mine);

/** Resolve the distinct authors for a page in bounded batches before rendering. */
async function preloadNicks(rows) {
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
async function nickOf(memberId) {
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

async function connect() {
  const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
  state.naru = createNaru(config.site ? { site: config.site } : undefined);
}
function communityCollection(collection) {
  const nativeReads = [COLLECTION.logs, COLLECTION.comments].includes(
    collection,
  );
  const invoke = async (operation, id, data, options = {}) => {
    // Reads go through the gate's read-only export, on the read budget.
    const gate = ["get", "getMany", "list"].includes(operation)
      ? "communityRead"
      : "communityData";
    const result = await state.member.call(functionReference(gate), {
      collection,
      operation,
      ...(id !== undefined ? { id } : {}),
      ...(data !== undefined ? { data } : {}),
      options,
    });
    if (!result.ok) {
      const code =
        result.reason === "document_not_found"
          ? "NOT_FOUND"
          : result.reason === "conflict"
            ? "CONFLICT"
            : [
                  "access_denied",
                  "not_owned",
                  "banned",
                  "approval_required",
                ].includes(result.reason)
              ? "ACCESS_DENIED"
              : "INVALID_REQUEST";
      throw Object.assign(
        new Error(REASONS[result.reason] ?? "요청을 처리하지 못했습니다."),
        { code },
      );
    }
    return result;
  };
  return {
    getMany: async (ids) =>
      (await invoke("getMany", undefined, undefined, { ids })).documents,
    get: async (id) =>
      nativeReads
        ? state.member.collection(collection).get(id)
        : (await invoke("get", id)).document,
    list: async (options) => {
      if (!nativeReads) return invoke("list", undefined, undefined, options);
      const page = await state.member.collection(collection).list(options);
      // Native reads return complete visible posts; trim previews only in this page.
      return collection === COLLECTION.logs
        ? {
            ...page,
            documents: page.documents.map((doc) => ({
              ...doc,
              data: {
                ...doc.data,
                text: (doc.data.text ?? "").slice(0, 150),
                ...((doc.data.text ?? "").length > 150
                  ? { truncated: true }
                  : {}),
              },
            })),
          }
        : page;
    },
    add: async (data) => (await invoke("add", undefined, data)).document,
    set: async (id, data, options) =>
      (await invoke("set", id, data, options)).document,
    delete: async (id, options) => {
      let result = await invoke("delete", id, undefined, options);
      while (!result.done) result = await invoke("delete", id);
    },
  };
}
function showAdmission(status) {
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
      ? REASONS.banned
      : status === "closed"
        ? REASONS.registration_closed
        : REASONS.approval_required;
  $("admissionId").textContent = `가입 문의용 회원 번호: ${state.member.id}`;
  $("editProfile").hidden = true;
  $("retryMedia").hidden = true;
}
$("checkAdmission").onclick = () => run(start);

function show(profile) {
  $("admissionPanel").hidden = true;
  const member = state.member;
  $("signIn").hidden = Boolean(member);
  $("signOut").hidden = !member;
  $("retryMedia").hidden = !member;
  $("editProfile").hidden = !member || !profile;
  $("welcome").hidden = Boolean(member);
  $("profileSetup").hidden = !member || Boolean(profile);
  $("community").hidden = !member || !profile;
  $("whoami").textContent = profile ? `${profile.data.nick} 님` : "";
  state.profile = profile ?? null;
}

/** An inline form retains the draft when saving fails. */
function edit(title, fields, save) {
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
        reasonOf(error) ??
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
      const saved = await communityCollection(COLLECTION.profiles).set(
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
  if (!state.member) return show();
  const platform = await state.member.membership();
  state.admission = platform.status;
  if (platform.status !== "approved") {
    show();
    return showAdmission(platform.status);
  }
  await recoverMedia();
  const status = await callRule("membership");
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

/* ------------------------------------------------------------- live --- */

// The topic communityData announces new, publicly listable posts on.
const POSTS_TOPIC = COLLECTION.logs;
function showUnread(unread) {
  $("tabMessages").textContent = unread ? "쪽지 · 새 쪽지" : "쪽지";
}
function showCalls(unread) {
  $("tabCalls").textContent = unread ? "알림 · 새 알림" : "알림";
}
function showNewPost(id) {
  state.newPost = id;
  $("tabLogs").textContent = id ? "로그 · 새 글" : "로그";
}
async function refreshUnread() {
  const member = state.member;
  const notice = await callRule("messageStatus");
  if (state.member !== member) return;
  showUnread(notice.unread);
  showCalls(notice.calls === true);
}
/**
 * Instead of polling, functions notify the member of new messages and
 * broadcast new posts. Nothing is replayed, so the status is read again
 * whenever the connection opens or reopens.
 */
function listen() {
  stopLive();
  const member = state.member;
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
function stopLive() {
  state.live?.close();
  state.live = null;
}

/* ------------------------------------------------------------- logs --- */

async function loadLogs({ more = false } = {}) {
  const page = await communityCollection(COLLECTION.logs).list({
    filter: { board: state.board },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: LOG_PAGE,
    after: more ? state.logCursor : null,
  });
  await preloadNicks(page.documents);
  if (!more) {
    $("logs").replaceChildren();
    showNewPost(null);
  }
  for (const log of page.documents) $("logs").append(await logItem(log));
  state.logCursor = page.nextCursor;
  $("moreLogs").hidden = !page.nextCursor;
}

async function logItem(log) {
  const item = $("logTemplate").content.firstElementChild.cloneNode(true);
  const image = item.querySelector(".log-image");
  if (log.data.image && !log.data.locked) image.src = log.data.image;
  else image.remove();
  if (log.data.locked)
    item.querySelector(".log-text").textContent =
      "비밀글입니다. 본문을 볼 수 없습니다.";
  else item.querySelector(".log-text").append(postText(log.data.text));
  if (log.data.dice && !log.data.locked) {
    item.querySelector(".log-dice").hidden = false;
    item.querySelector(".log-dice").textContent = diceText(log);
  }
  item.querySelector(".log-title").textContent =
    `${log.data.secret ? "🔒 " : ""}${log.data.title ?? ""}${log.data.category ? ` · ${log.data.category}` : ""}`;
  item.querySelector(".author").replaceChildren(await speakerLabel(log));
  item.querySelector("time").textContent = formatTime(log.createdAt);
  const remove = item.querySelector(".delete");
  remove.hidden = !mine(log) && state.role !== "moderator";
  const change = item.querySelector(".edit");
  change.hidden =
    Boolean(log.data.locked) || (!mine(log) && state.role !== "moderator");
  const beginEdit = (current) =>
    edit(
      "로그 수정",
      [
        { name: "title", label: "제목", value: current.data.title, max: 120 },
        {
          name: "category",
          label: "분류",
          value: current.data.category ?? "",
          options: [
            ["", "분류 없음"],
            ...(
              state.boards.find(
                (row) => row.id === (current.data.board ?? "default"),
              )?.data.categories ?? []
            ).map((name) => [name, name]),
          ],
        },
        {
          name: "secret",
          label: "비밀글",
          value: current.data.secret === true,
          type: "checkbox",
        },
        {
          name: "text",
          label: "설명",
          value: current.data.text,
          multiline: true,
          max: 2000,
        },
      ],
      async ({ text, title, category, secret }) => {
        const saved = await communityCollection(COLLECTION.logs).set(
          log.id,
          { ...current.data, text, title, category, secret },
          { condition: { revision: current.revision } },
        );
        item.replaceWith(await logItem(saved));
      },
    );
  change.onclick = () =>
    log.data.truncated
      ? run(async () =>
          beginEdit(await communityCollection(COLLECTION.logs).get(log.id)),
        )
      : beginEdit(log);
  if (log.data.truncated && !log.data.locked) {
    const expand = document.createElement("button");
    expand.type = "button";
    expand.textContent = "본문 보기";
    expand.onclick = () =>
      run(async () => {
        const full = await communityCollection(COLLECTION.logs).get(log.id);
        item.replaceWith(
          await logItem({ ...full, data: { ...full.data, truncated: false } }),
        );
      });
    item.querySelector(".log-text").after(expand);
  }
  remove.onclick = () =>
    run(async () => {
      if (!confirm("이 로그를 지울까요?")) return;
      await communityCollection(COLLECTION.logs).delete(log.id);
      item.remove();
    });
  // 댓글은 펼쳤을 때 처음 읽는다.
  const comments = item.querySelector(".comments");
  comments.hidden = Boolean(log.data.locked);
  let cursor;
  const load = (more) =>
    run(async () => {
      const page = await communityCollection(COLLECTION.comments).list({
        filter: { logId: log.id },
        sort: [[{ metadata: "createdAt" }, "asc"]],
        size: COMMENT_PAGE,
        after: more ? cursor : null,
      });
      await preloadNicks(page.documents);
      const list = item.querySelector(".comment-list");
      if (!more) list.replaceChildren();
      for (const comment of page.documents)
        list.append(await commentItem(comment));
      cursor = page.nextCursor;
      item.querySelector(".more-comments").hidden = !cursor;
    });
  comments.ontoggle = () => {
    if (comments.open && cursor === undefined) load(false);
  };
  item.querySelector(".more-comments").onclick = () => load(true);
  const form = item.querySelector(".comment-form");
  const picker = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "이모티콘";
  const choices = document.createElement("div");
  choices.className = "emoticon-choices";
  picker.append(summary, choices);
  form.prepend(picker);
  picker.ontoggle = () => {
    if (picker.open && !choices.childNodes.length)
      run(async () => {
        const definitions = await loadEmoticons();
        for (const row of definitions) {
          const button = document.createElement("button");
          button.type = "button";
          button.title = row.data.name;
          button.setAttribute("aria-label", row.data.name);
          button.append(
            emoticonContent(document, row.data.name, [row]),
            row.data.name,
          );
          button.onclick = () => {
            const input = form.querySelector(".comment-text");
            input.setRangeText(
              row.data.name,
              input.selectionStart,
              input.selectionEnd,
              "end",
            );
            input.focus();
          };
          choices.append(button);
        }
        if (!definitions.length)
          choices.textContent = "등록된 이모티콘이 없습니다.";
      });
  };

  const speakerChoice = form.querySelector(".comment-character");
  const actionChoice = form.querySelector(".comment-action");
  const itemChoice = form.querySelector(".comment-item");
  wireSpeakerChoice(speakerChoice);
  wireItemChoice(itemChoice);
  form.querySelector(".comment-actions").hidden = !state.boards.find(
    (row) => row.id === (log.data.board ?? "default"),
  )?.data.actions;
  form.onsubmit = (event) => {
    event.preventDefault?.();
    run(async () => {
      const text = form.querySelector(".comment-text").value.trim();
      const dice = form.querySelector(".comment-dice").checked;
      const character = speakerChoice.value;
      const action = actionChoice.value;
      const used = itemChoice.value;
      if (!text && !dice && !action && !used) return;
      const saved = await communityCollection(COLLECTION.comments).add({
        logId: log.id,
        text,
        dice,
        ...(character ? { character } : {}),
        ...(action ? { action } : {}),
        ...(used ? { item: used } : {}),
      });
      item.querySelector(".comment-list").append(await commentItem(saved));
      form.querySelector(".comment-text").value = "";
      form.querySelector(".comment-dice").checked = false;
      actionChoice.value = "";
      if (used || action) {
        // The inventory changed: read it again when next needed.
        state.postItems = null;
        state.shopLoaded = false;
        itemChoice.replaceChildren(itemChoice.options[0]);
        delete itemChoice.dataset.loaded;
      }
    });
  };
  return item;
}

async function commentItem(comment) {
  const item = document.createElement("li");
  item.className = "comment";
  const author = document.createElement("strong");
  author.className = "author";
  author.append(await speakerLabel(comment));
  item.append(author, " ");
  if (comment.data.dice) {
    const dice = document.createElement("span");
    dice.className = "dice";
    dice.textContent = diceText(comment);
    item.append(dice, " ");
  }
  item.append(postText(comment.data.text ?? "", await loadEmoticons()));
  for (const action of Array.isArray(comment.data.actions)
    ? comment.data.actions
    : [])
    item.append(actionItem(action));
  if (mine(comment) || state.role === "moderator") {
    const change = document.createElement("button");
    change.type = "button";
    change.className = "edit";
    change.textContent = "수정";
    change.onclick = () =>
      edit(
        "댓글 수정",
        [
          {
            name: "text",
            label: "댓글",
            value: comment.data.text,
            multiline: true,
            max: 500,
          },
        ],
        async ({ text }) => {
          if (!text && !comment.data.dice)
            throw new Error("댓글을 입력해 주세요.");
          const saved = await communityCollection(COLLECTION.comments).set(
            comment.id,
            { ...comment.data, text },
            { condition: { revision: comment.revision } },
          );
          item.replaceWith(await commentItem(saved));
        },
      );
    item.append(" ", change);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "삭제";
    remove.onclick = () =>
      run(async () => {
        await communityCollection(COLLECTION.comments).delete(comment.id);
        item.remove();
      });
    item.append(" ", remove);
  }
  return item;
}

/* ------------------------------------------------------- characters --- */

const CHARACTER_FILTERS = {
  // member/ready.php: characters not yet approved, in either state.
  applicants: { in: ["state", ["editing", "submitted"]] },
  approved: { eq: ["state", "approved"] },
};
async function loadCharacters({ more = false } = {}) {
  await loadFieldCatalogue();
  const where = CHARACTER_FILTERS[$("characterFilter").value];
  const page = await communityCollection(COLLECTION.characters).list({
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: CHARACTER_PAGE,
    after: more ? state.characterCursor : null,
    ...(where ? { where } : {}),
  });
  await preloadNicks(page.documents);
  if (!more) $("characters").replaceChildren();
  for (const character of page.documents)
    $("characters").append(await characterItem(character));
  state.characterCursor = page.nextCursor;
  state.charactersLoaded = true;
  $("moreCharacters").hidden = !page.nextCursor;
}

/** The owner's custom profile fields (adm/character_article_list.php), read once. */
async function loadFieldCatalogue() {
  if (state.fieldCatalogue) return state.fieldCatalogue;
  const member = state.member;
  const rows = (await allDocuments(COLLECTION.characterFields))
    .filter((row) => /^[a-z][a-z0-9_]{0,31}$/.test(row.id))
    .sort(
      (a, b) =>
        (a.data.order ?? 0) - (b.data.order ?? 0) || (a.id < b.id ? -1 : 1),
    );
  if (state.member !== member) return [];
  state.fieldCatalogue = rows;
  $("characterFields").replaceChildren(
    ...rows.map((row) => {
      const [label, input] = fieldInput(row, "");
      input.dataset.field = row.id;
      label.append(input);
      return label;
    }),
  );
  return rows;
}
/** A label and control for one custom field definition. */
function fieldInput(row, value) {
  const label = document.createElement("label");
  label.textContent = `${row.data.label ?? row.id}${row.data.required ? " (신청 시 필수)" : ""}${row.data.visibility === "owner" ? " · 오너와 운영자만 봄" : ""}`;
  if (row.data.help) label.title = row.data.help;
  const type = row.data.type ?? "text";
  const input = document.createElement(
    type === "select" ? "select" : type === "textarea" ? "textarea" : "input",
  );
  if (type === "select")
    for (const option of ["", ...(row.data.options ?? [])]) {
      const element = document.createElement("option");
      element.value = option;
      element.textContent = option || "선택 안 함";
      input.append(element);
    }
  else {
    input.maxLength = type === "textarea" ? 2000 : type === "text" ? 200 : 2000;
    if (type === "url" || type === "image") input.type = "url";
    if (type === "image" || type === "url") input.placeholder = "https://";
  }
  input.value = value ?? "";
  return [label, input];
}
/** Custom values of a character the gate let the caller see, in catalogue order. */
function renderFields(list, character) {
  list.replaceChildren();
  for (const row of state.fieldCatalogue ?? []) {
    const value = character.data.fields?.[row.id];
    if (typeof value !== "string" || !value) continue;
    const term = document.createElement("dt");
    term.textContent = row.data.label ?? row.id;
    const detail = document.createElement("dd");
    if (row.data.type === "image" && value.startsWith("https://")) {
      const image = document.createElement("img");
      image.src = value;
      image.alt = row.data.label ?? row.id;
      image.loading = "lazy";
      image.className = "field-image";
      detail.append(image);
    } else if (row.data.type === "url" && value.startsWith("https://")) {
      const link = document.createElement("a");
      link.href = value;
      link.textContent = value;
      link.rel = "noopener noreferrer";
      detail.append(link);
    } else detail.textContent = value;
    list.append(term, detail);
  }
}

async function characterItem(character) {
  const item = $("characterTemplate").content.firstElementChild.cloneNode(true);
  const image = item.querySelector(".character-image");
  if (character.data.image) image.src = character.data.image;
  else image.remove();
  item.querySelector(".character-name").textContent = character.data.name;
  item.querySelector(".character-side").textContent = character.data.side ?? "";
  item.querySelector(".character-state").textContent = [
    TYPE_NAMES[character.data.type],
    STATE_NAMES[character.data.state],
  ]
    .filter(Boolean)
    .join(" · ");
  item.querySelector(".character-profile").textContent =
    character.data.profile ?? "";
  item.querySelector(".author").textContent =
    `오너: ${await nickOf(character.createdBy ?? character.data.owner)}`;
  const remove = item.querySelector(".delete");
  remove.hidden = !mine(character);
  const change = item.querySelector(".edit");
  change.hidden = !mine(character);
  // Lists carry no custom values, so an edit starts from the full sheet.
  change.onclick = () =>
    run(async () => {
      const catalogue = await loadFieldCatalogue();
      const current = await communityCollection(COLLECTION.characters).get(
        character.id,
      );
      const fields = [
        {
          name: "name",
          label: "이름",
          value: current.data.name,
          required: true,
          max: 40,
        },
        { name: "side", label: "소속", value: current.data.side, max: 40 },
        {
          name: "profile",
          label: "프로필",
          value: current.data.profile,
          multiline: true,
          max: 4000,
        },
      ];
      if (current.data.type !== "npc")
        fields.push({
          name: "type",
          label: "종류",
          value: current.data.type ?? "main",
          options: [
            ["main", "메인"],
            ["sub", "서브"],
          ],
        });
      if (current.data.state !== "approved")
        fields.push({
          name: "state",
          label: "상태",
          value: current.data.state ?? "editing",
          options: [
            ["editing", "수정 중"],
            ["submitted", "신청 (수정 완료)"],
          ],
        });
      for (const row of catalogue)
        fields.push({
          name: `field:${row.id}`,
          label: `${row.data.label ?? row.id}${row.data.required ? " (신청 시 필수)" : ""}`,
          value: current.data.fields?.[row.id] ?? "",
          ...(row.data.type === "select"
            ? {
                options: [
                  ["", "선택 안 함"],
                  ...(row.data.options ?? []).map((option) => [option, option]),
                ],
              }
            : row.data.type === "textarea"
              ? { multiline: true, max: 2000 }
              : { max: row.data.type === "text" ? 200 : 2000 }),
        });
      edit("캐릭터 수정", fields, async (values) => {
        if (!values.name) throw new Error("이름을 입력해 주세요.");
        const data = { ...current.data, fields: {} };
        for (const [name, value] of Object.entries(values))
          if (name.startsWith("field:")) {
            if (value) data.fields[name.slice(6)] = value;
          } else data[name] = value;
        const saved = await communityCollection(COLLECTION.characters).set(
          character.id,
          data,
          { condition: { revision: current.revision } },
        );
        state.speakers = null;
        item.replaceWith(await characterItem(saved));
      });
    });
  remove.onclick = () =>
    run(async () => {
      if (!confirm(`${character.data.name}을(를) 지울까요?`)) return;
      await communityCollection(COLLECTION.characters).delete(character.id);
      state.speakers = null;
      item.remove();
    });
  const main = item.querySelector(".main-character");
  main.hidden = !mine(character);
  main.onclick = () =>
    run(async () => {
      const result = await callRule("mainCharacter", {
        character: character.id,
      });
      show(result.document);
      say(`${character.data.name}이(가) 대표 캐릭터입니다.`);
    });
  wireCharacterDetails(item, character);
  return item;
}

// Which functions only read is declared in their modules (readOnly), so Naru
// gives them the read budget; the page calls them all the same way.
async function callRule(name, args) {
  const result = await state.member.call(functionReference(name), args);
  if (!result?.ok) {
    throw new Error(REASONS[result?.reason] ?? "요청을 처리하지 못했습니다.");
  }
  return result;
}

function wireCharacterDetails(item, character) {
  const details = item.querySelector(".character-details");
  const addRelation = item.querySelector(".add-relation");
  const addOutfit = item.querySelector(".add-outfit");
  const defaultOutfit = item.querySelector(".default-outfit");
  const allocate = item.querySelector(".allocate-stats");
  for (const button of [addRelation, addOutfit, defaultOutfit])
    button.hidden = !mine(character);
  let loaded = false;
  const refresh = async () => {
    await loadFieldCatalogue();
    if (state.fieldCatalogue.length)
      renderFields(
        item.querySelector(".character-fields"),
        await communityCollection(COLLECTION.characters).get(character.id),
      );
    const status = await callRule("characterStatus", {
      character: character.id,
    });
    item.querySelector(".progression").textContent =
      `경험치 ${status.state.exp}${status.rank ? ` · ${status.rank}` : ""} · 능력치 포인트 ${status.state.points}`;
    item.querySelector(".stats").replaceChildren();
    for (const definition of status.definitions) {
      const li = document.createElement("li");
      const stat = status.state.stats[definition.id];
      li.textContent = `${definition.data.name ?? definition.id}: ${stat.current} / ${stat.max}`;
      item.querySelector(".stats").append(li);
    }
    allocate.hidden = !mine(character) || !status.definitions.length;
    allocate.onclick = () =>
      edit(
        "능력치 포인트 배분",
        status.definitions.map((definition) => ({
          name: definition.id,
          label: `${definition.data.name ?? definition.id}에 배분할 포인트`,
          type: "number",
          value: status.state.stats[definition.id].allocated,
        })),
        async (allocation) => {
          await callRule("allocateStats", {
            character: character.id,
            revision: status.revision,
            allocation: Object.fromEntries(
              Object.entries(allocation).map(([key, value]) => [
                key,
                Number(value),
              ]),
            ),
          });
          await refresh();
        },
      );
    // The gate reads only the character's titles (at most 100 per query).
    const owned = [...new Set(status.state.titles ?? [])];
    const titles = [];
    for (let i = 0; i < owned.length; i += 100)
      titles.push(
        ...(await allDocuments(COLLECTION.titles, undefined, {
          in: [{ metadata: "id" }, owned.slice(i, i + 100)],
        })),
      );
    const titleChoice = item.querySelector(".title-choice");
    item.querySelector(".titles").replaceChildren();
    titleChoice.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "타이틀 없음";
    titleChoice.append(none);
    for (const title of titles) {
      const span = document.createElement("span");
      span.textContent = `${title.data.name}${status.state.activeTitle === title.id ? " (표시 중)" : ""}`;
      if (title.data.image?.startsWith("https://")) {
        const image = document.createElement("img");
        image.src = title.data.image;
        image.alt = title.data.name;
        image.className = "title-image";
        span.prepend(image);
      }
      item.querySelector(".titles").append(span, " ");
      const option = document.createElement("option");
      option.value = title.id;
      option.textContent = title.data.name;
      titleChoice.append(option);
    }
    titleChoice.value = status.state.activeTitle ?? "";
    titleChoice.hidden = !mine(character) || !titles.length;
    titleChoice.onchange = () =>
      run(async () => {
        await callRule("equipTitle", {
          character: character.id,
          title: titleChoice.value || null,
        });
        await refresh();
      });
    const couples = await allDocuments(COLLECTION.couples, undefined, {
      any: [{ eq: ["first", character.id] }, { eq: ["second", character.id] }],
    });
    item.querySelector(".couples").replaceChildren();
    for (const couple of couples.sort(
      (a, b) => (a.data.order ?? 0) - (b.data.order ?? 0),
    )) {
      const partnerId =
        couple.data.first === character.id
          ? couple.data.second
          : couple.data.first;
      const partner = await communityCollection(COLLECTION.characters)
        .get(partnerId)
        .catch((error) => {
          if (error.code === "NOT_FOUND") return null;
          throw error;
        });
      const li = document.createElement("li");
      li.textContent = `${partner?.data.name ?? "삭제된 캐릭터"}${couple.data.since ? ` · ${couple.data.since}부터` : ""}`;
      item.querySelector(".couples").append(li);
    }
    const relations = await allDocuments(COLLECTION.relations, {
      character: character.id,
    });
    const clothes = await allDocuments(COLLECTION.wardrobe, {
      character: character.id,
    });
    item.querySelector(".relations").replaceChildren();
    for (const row of relations.sort((a, b) => a.data.order - b.data.order)) {
      const li = document.createElement("li");
      const target = await communityCollection(COLLECTION.characters)
        .get(row.data.target)
        .catch((error) => {
          if (error.code === "NOT_FOUND") return null;
          throw error;
        });
      li.textContent = `${target?.data.name ?? "삭제된 캐릭터"} · 호감도 ${row.data.affinity}: ${row.data.memo}`;
      if (row.data.link && row.data.link.startsWith("https://")) {
        const link = document.createElement("a");
        link.href = row.data.link;
        link.textContent = "관계 링크";
        link.rel = "noopener noreferrer";
        li.append(" ", link);
      }
      if (mine(character)) {
        const change = document.createElement("button");
        change.type = "button";
        change.textContent = "수정";
        change.onclick = () => relationEditor(row);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            if (!confirm("이 관계를 지울까요?")) return;
            await callRule("removeRelation", { id: row.id });
            await refresh();
          });
        li.append(" ", change, " ", remove);
      }
      item.querySelector(".relations").append(li);
    }
    item.querySelector(".wardrobe").replaceChildren();
    for (const clothing of clothes) {
      const li = document.createElement("li");
      const image = document.createElement("img");
      image.src = clothing.data.image;
      image.alt = clothing.data.name;
      image.className = "outfit-image";
      li.append(image, clothing.data.name);
      if (mine(character)) {
        const wear = document.createElement("button");
        wear.type = "button";
        wear.textContent =
          character.data.outfit === clothing.id ? "사용 중" : "사용";
        wear.disabled = character.data.outfit === clothing.id;
        wear.onclick = () =>
          run(async () => {
            const result = await callRule("wear", {
              character: character.id,
              outfit: clothing.id,
            });
            character = result.document;
            await refresh();
          });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            if (!confirm("이 의상을 지울까요?")) return;
            await callRule("removeOutfit", { id: clothing.id });
            await refresh();
          });
        li.append(" ", wear, " ", remove);
      }
      item.querySelector(".wardrobe").append(li);
    }
    const active = clothes.find((row) => row.id === character.data.outfit);
    let portrait = item.querySelector(".character-image");
    const src = active?.data.image ?? character.data.image;
    if (src && !portrait) {
      portrait = document.createElement("img");
      portrait.className = "character-image";
      portrait.alt = character.data.name;
      item.prepend(portrait);
    }
    if (portrait && src) portrait.src = src;
    else if (portrait) portrait.remove();
    loaded = true;
  };
  const relationEditor = (row) =>
    run(async () => {
      const characters = await allDocuments(COLLECTION.characters);
      const options = characters
        .filter((target) => target.id !== character.id)
        .map((target) => [target.id, target.data.name]);
      if (!options.length) return say("관계를 맺을 다른 캐릭터가 없습니다.");
      edit(
        "캐릭터 관계",
        [
          {
            name: "target",
            label: "상대 캐릭터",
            value: row?.data.target ?? options[0][0],
            required: true,
            options,
          },
          {
            name: "affinity",
            label: "호감도 (-100 ~ 100)",
            value: row?.data.affinity ?? 0,
            type: "number",
          },
          {
            name: "memo",
            label: "관계 설명",
            value: row?.data.memo,
            multiline: true,
            max: 2000,
          },
          {
            name: "link",
            label: "관계 링크 (HTTPS)",
            value: row?.data.link,
            max: 2000,
          },
          {
            name: "order",
            label: "정렬 순서",
            value: row?.data.order ?? 0,
            type: "number",
          },
        ],
        async (data) => {
          await callRule("relation", {
            ...data,
            ...(row ? { id: row.id, revision: row.revision } : {}),
            character: character.id,
            affinity: Number(data.affinity),
            order: Number(data.order),
          });
          await refresh();
        },
      );
    });
  addRelation.onclick = () => relationEditor();
  addOutfit.onclick = () =>
    edit(
      "의상 등록",
      [
        { name: "name", label: "의상 이름", required: true, max: 80 },
        { name: "image", label: "이미지 주소 (HTTPS)", max: 2000 },
        {
          name: "file",
          label: "또는 이미지 파일",
          type: "file",
          accept: "image/*",
        },
      ],
      async ({ name, image, file }) => {
        const uploaded = file ? await uploadManaged(file) : null;
        if (uploaded) image = uploaded.url;
        await callRule("outfit", {
          character: character.id,
          name,
          image,
          ...(uploaded ? { imageId: uploaded.id } : {}),
        });
        await refresh();
      },
    );
  defaultOutfit.onclick = () =>
    run(async () => {
      const result = await callRule("wear", {
        character: character.id,
        outfit: null,
      });
      character = result.document;
      await refresh();
    });
  details.ontoggle = () => {
    if (details.open && !loaded) run(refresh);
  };
  if (character.data.outfit)
    run(async () => {
      const clothing = await communityCollection(COLLECTION.wardrobe).get(
        character.data.outfit,
      );
      if (clothing.data.character === character.id) {
        let portrait = item.querySelector(".character-image");
        if (!portrait) {
          portrait = document.createElement("img");
          portrait.className = "character-image";
          portrait.alt = character.data.name;
          item.prepend(portrait);
        }
        portrait.src = clothing.data.image;
      }
    });
}

/* ------------------------------------------------------------- shop --- */

async function loadBalance() {
  const wallet = await communityCollection(COLLECTION.wallets)
    .get(state.member.id)
    .catch((error) => {
      if (error?.code === "NOT_FOUND") return null;
      throw error;
    });
  $("balance").textContent = String(wallet?.data.balance ?? 0);
}

async function loadShop() {
  state.ownCharacters = await ownCharacters();
  const selector = $("inventoryCharacter");
  selector.replaceChildren();
  for (const [value, label] of [
    ["", "전체 / 새 아이템은 회원 인벤토리"],
    ...state.ownCharacters.map((row) => [row.id, row.data.name]),
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    selector.append(option);
  }
  if (
    state.inventoryCharacter &&
    !state.ownCharacters.some((row) => row.id === state.inventoryCharacter)
  )
    state.inventoryCharacter = null;
  selector.value = state.inventoryCharacter ?? "";
  await loadBalance();
  await loadItems();
  await loadInventory();
  await loadRecipes();
  if ($("historyPanel").open) await loadHistory();
  state.shopLoaded = true;
}

async function loadItems({ more = false } = {}) {
  const page = await communityCollection(COLLECTION.items).list({
    sort: [[{ metadata: "createdAt" }, "asc"]],
    size: SHOP_PAGE,
    after: more ? state.itemCursor : null,
  });
  if (!more) {
    $("items").replaceChildren();
    state.itemCatalog.clear();
  }
  for (const item of page.documents) state.itemCatalog.set(item.id, item);
  $("items").append(
    ...page.documents
      .filter((item) => !item.data.hidden)
      .map((item) => shopItem(item)),
  );
  state.itemCursor = page.nextCursor;
  $("moreItems").hidden = !page.nextCursor;
}

function itemPortrait(data) {
  const portrait = document.createElement("div");
  portrait.className = "item-portrait";
  if (data?.image?.startsWith("https://")) {
    const image = document.createElement("img");
    image.src = data.image;
    image.alt = "";
    image.loading = "lazy";
    portrait.append(image);
  } else {
    const placeholder = document.createElement("i");
    placeholder.textContent = data?.name?.slice(0, 1) || "·";
    placeholder.setAttribute("aria-hidden", "true");
    portrait.append(placeholder);
  }
  return portrait;
}

function shopItem(item) {
  const row = document.createElement("li");
  row.className = "card shop-item";
  row.append(itemPortrait(item.data));
  const label = document.createElement("span");
  const stock =
    typeof item.data.stock === "number" ? ` · 남은 ${item.data.stock}개` : "";
  label.textContent = `${item.data.name} · ${item.data.price ?? 0} 아보${stock}`;
  const buy = document.createElement("button");
  buy.type = "button";
  buy.textContent = item.data.stock === 0 ? "품절" : "사기";
  buy.disabled = item.data.stock === 0;
  buy.onclick = () =>
    spend(
      "buy",
      {
        item: item.id,
        ...(state.inventoryCharacter
          ? { character: state.inventoryCharacter }
          : {}),
        ...(item.data.requirements?.items?.length
          ? {
              materials: [
                ...$("inventory").querySelectorAll(".material:checked"),
              ].map((input) => input.value),
            }
          : {}),
      },
      (result) => `${result.owned.data.name}을(를) 샀습니다.`,
    );
  row.append(label, " ", buy);
  if (item.data.description) {
    const description = document.createElement("p");
    description.textContent = item.data.description;
    row.append(description);
  }
  if (item.data.requirements) {
    const note = document.createElement("p");
    const r = item.data.requirements;
    note.textContent = [
      r.approved ? "승인 캐릭터" : "",
      r.sides?.length ? `세력: ${r.sides.join(", ")}` : "",
      r.classes?.length ? `종족: ${r.classes.join(", ")}` : "",
      r.exp ? `경험치 ${r.exp}${r.consumeExp ? " 소모" : " 이상"}` : "",
      r.title ? `타이틀 ${r.title}${r.consumeTitle ? " 소모" : " 필요"}` : "",
      r.limit !== undefined ? `캐릭터별 ${r.limit}회` : "",
      ...(r.items ?? []).map(
        (entry) =>
          `${entry.item} × ${entry.count}${entry.consume ? " 소모" : " 필요"} (인벤토리에서 선택)`,
      ),
    ]
      .filter(Boolean)
      .join(" · ");
    row.append(note);
  }
  return row;
}

async function loadInventory({ more = false } = {}) {
  const page = await communityCollection(COLLECTION.inventory).list({
    filter: {
      owner: state.member.id,
      ...(state.inventoryCharacter
        ? { character: state.inventoryCharacter }
        : {}),
    },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: SHOP_PAGE,
    after: more ? state.inventoryCursor : null,
  });
  if (!more) $("inventory").replaceChildren();
  const missing = [
    ...new Set(page.documents.map((row) => row.data.item)),
  ].filter((id) => id && !state.itemCatalog.has(id));
  if (missing.length) {
    const items = await communityCollection(COLLECTION.items).getMany(missing);
    items.forEach((item, index) => state.itemCatalog.set(missing[index], item));
  }
  for (const owned of page.documents) {
    const row = document.createElement("li");
    row.className = "inventory-slot";
    row.append(
      itemPortrait(state.itemCatalog.get(owned.data.item)?.data ?? owned.data),
    );
    const label = document.createElement("label");
    const selected = document.createElement("input");
    selected.type = "checkbox";
    selected.value = owned.id;
    selected.className = "material";
    label.append(selected, owned.data.name);
    row.append(label);
    const sell = document.createElement("button");
    sell.type = "button";
    sell.textContent = "판매";
    sell.onclick = () => {
      if (confirm(`${owned.data.name}을(를) 판매할까요?`))
        spend(
          "sell",
          { inventory: owned.id },
          (result) => `${result.name}을(를) 판매했습니다.`,
        );
    };
    const gift = document.createElement("button");
    gift.type = "button";
    gift.textContent = "선물";
    gift.onclick = () =>
      run(async () => {
        const profiles = await allDocuments(COLLECTION.profiles);
        const options = profiles
          .filter((profile) => profile.id !== state.member.id)
          .map((profile) => [profile.id, profile.data.nick]);
        if (!options.length) return say("선물을 받을 회원이 없습니다.");
        edit(
          `${owned.data.name} 선물`,
          [
            {
              name: "recipient",
              label: "받는 회원",
              required: true,
              value: options[0][0],
              options,
            },
            {
              name: "character",
              label: "받는 캐릭터",
              value: "",
              options: [["", "회원 인벤토리"]],
            },
            { name: "memo", label: "메시지", multiline: true, max: 500 },
          ],
          async (data) => {
            const result = await state.member.call(functionReference("gift"), {
              inventory: owned.id,
              ...data,
              character: data.character || null,
            });
            if (!result.ok)
              throw new Error(REASONS[result.reason] ?? "선물하지 못했습니다.");
            say("선물을 보냈습니다.");
            await loadInventory();
          },
        );
        const characters = await allDocuments(COLLECTION.characters);
        const recipient = $("editorFields").querySelector('[name="recipient"]');
        const selection = $("editorFields").querySelector('[name="character"]');
        const update = () => {
          selection.replaceChildren();
          const choices = characters.filter(
            (row) => (row.createdBy ?? row.data.owner) === recipient.value,
          );
          for (const [value, label] of [
            ...(owned.data.character ? [] : [["", "회원 인벤토리"]]),
            ...choices.map((row) => [row.id, row.data.name]),
          ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            selection.append(option);
          }
          selection.required = Boolean(owned.data.character);
        };
        recipient.onchange = update;
        update();
      });
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "사용";
    use.onclick = () => run(() => useInventory(owned));
    const assign = document.createElement("button");
    assign.type = "button";
    assign.textContent = "캐릭터 이동";
    assign.onclick = () =>
      edit(
        "아이템 인벤토리 이동",
        [
          {
            name: "character",
            label: "캐릭터",
            value: owned.data.character ?? "",
            options: [
              ["", "회원 인벤토리"],
              ...state.ownCharacters.map((row) => [row.id, row.data.name]),
            ],
          },
        ],
        async ({ character }) => {
          await callRule("assignInventory", {
            inventory: owned.id,
            character: character || null,
          });
          await loadInventory();
        },
      );
    row.append(" ", sell, " ", gift, " ", use, " ", assign);
    $("inventory").append(row);
  }
  state.inventoryCursor = page.nextCursor;
  $("moreInventory").hidden = !page.nextCursor;
}

$("inventoryCharacter").onchange = () =>
  run(async () => {
    state.inventoryCharacter = $("inventoryCharacter").value || null;
    await loadInventory();
  });
const HISTORY_NAMES = {
  adjust: "운영자 잔액 조정",
  daily: "출석",
  buy: "구매",
  sell: "판매",
  gift: "선물 보냄",
  giftReceived: "선물 받음",
  craft: "제작",
  gacha: "뽑기",
  use: "아이템 사용",
};
async function loadHistory({ more = false } = {}) {
  const page = await callRule("history", {
    after: more ? state.historyCursor : null,
    size: 20,
  });
  if (!more) $("history").replaceChildren();
  for (const row of page.documents) {
    const li = document.createElement("li");
    li.textContent = `${formatTime(row.data.at)} · ${HISTORY_NAMES[row.data.kind] ?? row.data.kind}${row.data.delta !== undefined ? ` · ${row.data.delta > 0 ? "+" : ""}${row.data.delta} 아보` : ""}${row.data.balance !== undefined ? ` · 잔액 ${row.data.balance}` : ""}${row.data.memo ? ` · ${row.data.memo}` : ""}`;
    $("history").append(li);
  }
  state.historyCursor = page.nextCursor;
  $("moreHistory").hidden = !page.nextCursor;
}
$("historyPanel").ontoggle = () => {
  if ($("historyPanel").open) run(() => loadHistory());
};
$("moreHistory").onclick = () => run(() => loadHistory({ more: true }));

async function useInventory(owned) {
  const item = await communityCollection(COLLECTION.items).get(owned.data.item);
  const effect = item.data.effect;
  if (!effect || item.data.usable === false) return say(REASONS.not_usable);
  const fields = [];
  let characters = [];
  const requirements = item.data.useRequirements ?? {};
  if (
    ["restore", "profile"].includes(effect.type) ||
    owned.data.character ||
    requirements.approved ||
    requirements.sides?.length ||
    requirements.classes?.length ||
    requirements.exp ||
    requirements.title
  ) {
    characters = (await ownCharacters()).filter(
      (row) => !owned.data.character || owned.data.character === row.id,
    );
    if (!characters.length) return say("사용할 내 캐릭터가 없습니다.");
    fields.push({
      name: "character",
      label: "캐릭터",
      required: true,
      value: characters[0].id,
      options: characters.map((row) => [row.id, row.data.name]),
    });
  }
  if (effect.type === "profile") {
    for (const [name, label, max, multiline] of [
      ["name", "이름", 40, false],
      ["side", "소속", 40, false],
      ["profile", "프로필", 4000, true],
    ])
      fields.push({
        name,
        label,
        max,
        multiline,
        value: characters[0].data[name],
        required: name === "name",
      });
  }
  if (effect.type === "create")
    fields.push(
      { name: "name", label: "새 아이템 이름", required: true, max: 80 },
      { name: "description", label: "설명", multiline: true, max: 2000 },
      { name: "image", label: "이미지 주소 (HTTPS)", max: 2000 },
      {
        name: "file",
        label: "또는 이미지 파일",
        type: "file",
        accept: "image/*",
      },
    );
  edit(
    `${owned.data.name} 사용${item.data.reusable && effect.type !== "create" ? " (계속 사용 가능)" : " (사용하면 소모)"}`,
    fields,
    async (values) => {
      const { character, file, ...data } = values;
      if (file) {
        const uploaded = await uploadManaged(file);
        data.image = uploaded.url;
        data.imageId = uploaded.id;
      }
      if (effect.type === "profile")
        data.revision = characters.find((row) => row.id === character).revision;
      const result = await callRule("useItem", {
        inventory: owned.id,
        ...(character || owned.data.character
          ? { character: character || owned.data.character }
          : {}),
        data,
      });
      say(
        result.owned
          ? `${result.owned.data.name}을(를) 얻었습니다.`
          : effect.type === "draw"
            ? "아무것도 나오지 않았습니다."
            : `${result.name}을(를) 사용했습니다.`,
      );
      await loadShop();
      state.charactersLoaded = false;
    },
  );
  if (effect.type === "profile") {
    $("editorFields").querySelector('[name="character"]').onchange = (
      event,
    ) => {
      const selected = characters.find((row) => row.id === event.target.value);
      for (const name of ["name", "side", "profile"])
        $("editorFields").querySelector(`[name="${name}"]`).value =
          selected.data[name] ?? "";
    };
  }
}

async function allDocuments(collection, filter, where) {
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

async function loadRecipes() {
  state.recipes = await allDocuments(COLLECTION.recipes, undefined, {
    ne: ["hidden", true],
  });
  $("recipe").replaceChildren();
  for (const row of state.recipes) {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.data.name ?? row.id;
    $("recipe").append(option);
  }
  $("craftForm").hidden = !state.recipes.length;
  $("recipe").onchange = () => {
    const recipe = state.recipes.find((row) => row.id === $("recipe").value);
    $("recipeDescription").textContent = recipe
      ? `${recipe.data.description ?? ""} · ${recipe.data.cost ?? 0} 아보 · 재료: ${(recipe.data.ingredients ?? []).map((ingredient) => `${ingredient.item} × ${ingredient.count}`).join(", ")}`
      : "";
  };
  $("recipe").onchange();
}
$("craftForm").onsubmit = (event) => {
  event.preventDefault();
  const materials = [
    ...$("inventory").querySelectorAll(".material:checked"),
  ].map((input) => input.value);
  spend(
    "craft",
    {
      recipe: $("recipe").value,
      materials,
      ...(state.inventoryCharacter
        ? { character: state.inventoryCharacter }
        : {}),
    },
    (result) => `${result.owned.data.name}을(를) 만들었습니다.`,
  );
};

/**
 * 서버 함수 하나를 부르고, 결과를 알린 뒤 잔액과 인벤토리를 다시 읽는다. 값을
 * 정하는 것은 서버이므로 페이지는 결과만 보여 준다.
 */
function spend(name, args, success) {
  return run(async () => {
    const result = await state.member.call(functionReference(name), args);
    if (!result?.ok) {
      return say(REASONS[result?.reason] ?? "하지 못했습니다.");
    }
    say(success(result));
    await loadShop();
  });
}

function showTab(name) {
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

/* ------------------------------------------------------------ wiring --- */

$("signIn").onclick = () => run(() => state.naru.members.signIn());
$("retryMedia").onclick = () =>
  run(async () => {
    await recoverPendingUploads(state.member);
    const result = await retryMemberMedia(state.member);
    say(
      `${result.completed}개 파일을 정리했습니다.${result.remaining ? " 다시 눌러 남은 파일을 정리하세요." : ""}`,
    );
  });
$("signOut").onclick = () =>
  run(async () => {
    const member = state.member;
    state.member = null;
    state.nicks.clear();
    state.charactersLoaded = false;
    state.shopLoaded = false;
    $("editor").close();
    clearPrivateViews();
    show();
    await member.signOut();
    say("로그아웃했습니다.");
  });
$("profileForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const nick = $("nick").value.trim();
    if (!nick) return;
    // 회원 번호를 ID로 쓰는 문서는 그 회원만 만들 수 있다.
    const joined = await callRule("join", { nick });
    const profile = joined.profile;
    state.nicks.set(state.member.id, Promise.resolve(nick));
    show(profile);
    await loadBoards();
    await loadLogs();
    listen();
  });
};
$("tabLogs").onclick = () =>
  run(async () => {
    showTab("logs");
    if (state.newPost) await loadLogs();
  });
$("tabCharacters").onclick = () =>
  run(async () => {
    showTab("characters");
    if (!state.charactersLoaded) await loadCharacters();
  });
$("tabShop").onclick = () =>
  run(async () => {
    showTab("shop");
    if (!state.shopLoaded) await loadShop();
  });
$("tabMessages").onclick = () =>
  run(async () => {
    showTab("messages");
    await loadMessageRecipients();
    await loadMailbox();
  });
$("messageBox").onchange = () => run(() => loadMailbox());
$("refreshMessages").onclick = () => run(() => loadMailbox());
$("moreMessages").onclick = () => run(() => loadMailbox({ more: true }));
$("messageForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("messageForm").querySelector('[type="submit"]');
  button.disabled = true;
  await run(async () => {
    const recipients = [...$("messageRecipients").selectedOptions].map(
      (option) => option.value,
    );
    await callRule("sendMessage", { recipients, body: $("messageBody").value });
    $("messageBody").value = "";
    $("messageBox").value = "sent";
    await loadMailbox();
    state.shopLoaded = false;
    say("쪽지를 보냈습니다.");
  });
  button.disabled = false;
};

async function loadMessageRecipients() {
  const profiles = await allDocuments(COLLECTION.profiles, undefined, {
    all: [
      { ne: [{ metadata: "id" }, state.member.id] },
      { ne: ["acceptMessages", false] },
    ],
  });
  $("messageRecipients").replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.data.nick;
    $("messageRecipients").append(option);
  }
  const settings = await communityCollection(COLLECTION.settings)
    .get("community")
    .catch((error) => {
      if (error.code === "NOT_FOUND") return null;
      throw error;
    });
  $("messageCost").textContent =
    `회원 한 명당 ${settings?.data.messageCost ?? 0} 아보`;
}

async function loadMailbox({ more = false } = {}) {
  const page = await callRule("mailbox", {
    box: $("messageBox").value,
    after: more ? state.messageCursor : null,
    size: 20,
  });
  showUnread(page.unread);
  if (!more) {
    $("messages").replaceChildren();
    $("messageDetail").hidden = true;
  }
  for (const row of page.documents) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = `${row.data.readAt === null ? "[안 읽음] " : ""}${await nickOf($("messageBox").value === "inbox" ? row.data.from : row.data.to)} · ${formatTime(row.data.sentAt)} · ${row.data.preview}`;
    open.onclick = () =>
      run(async () => {
        const result = await callRule("readMessage", { id: row.id });
        const message = result.document;
        showUnread(result.unread);
        $("messageDetail").replaceChildren();
        const heading = document.createElement("h3");
        heading.textContent = `${await nickOf(message.data.from)} → ${await nickOf(message.data.to)}`;
        const body = document.createElement("p");
        const receipt = document.createElement("p");
        receipt.textContent = `보낸 시간 ${formatTime(message.data.sentAt)} · ${message.data.readAt === null ? "아직 읽지 않음" : `읽은 시간 ${formatTime(message.data.readAt)}`}`;
        body.className = "message-body";
        body.textContent = message.data.body;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "쪽지 삭제";
        remove.onclick = () =>
          run(async () => {
            if (
              !confirm(
                "쪽지를 삭제하면 보낸 사람과 받는 사람 모두의 보관함에서 사라집니다. 삭제할까요?",
              )
            )
              return;
            await callRule("removeMessage", { id: message.id });
            await loadMailbox();
          });
        $("messageDetail").append(heading, receipt, body, remove);
        if (message.data.to === state.member.id) {
          const reply = document.createElement("button");
          reply.type = "button";
          reply.textContent = "답장";
          reply.onclick = () => {
            const options = [...$("messageRecipients").options];
            if (!options.some((option) => option.value === message.data.from))
              return say("상대가 지금은 쪽지를 받지 않습니다.");
            for (const option of options)
              option.selected = option.value === message.data.from;
            $("messageBody").focus();
          };
          $("messageDetail").append(" ", reply);
        }
        $("messageDetail").hidden = false;
        if (message.data.to === state.member.id)
          open.textContent = open.textContent.replace(/^\[안 읽음\] /, "");
      });
    li.append(open);
    $("messages").append(li);
  }
  state.messageCursor = page.nextCursor;
  $("moreMessages").hidden = !page.nextCursor;
}
$("daily").onclick = () =>
  spend(
    "daily",
    null,
    (result) => `출석 보상을 받았습니다. 잔액 ${result.balance} 아보.`,
  );
$("gacha").onclick = () =>
  spend(
    "gacha",
    state.inventoryCharacter ? { character: state.inventoryCharacter } : null,
    (result) =>
      result.owned
        ? `뽑기에서 ${result.owned.data.name}이(가) 나왔습니다!`
        : "아무것도 나오지 않았습니다.",
  );
$("moreInventory").onclick = () => run(() => loadInventory({ more: true }));
$("moreItems").onclick = () => run(() => loadItems({ more: true }));
$("moreLogs").onclick = () => run(() => loadLogs({ more: true }));
$("moreCharacters").onclick = () => run(() => loadCharacters({ more: true }));
$("characterFilter").onchange = () => run(() => loadCharacters());

/* ------------------------------------------------------------ calls --- */

/** ajax/board_call.php's alarm list: calls and comment notices, newest first. */
async function loadCalls({ more = false } = {}) {
  const member = state.member;
  const page = await callRule("callHistory", {
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
  if (page.unread) await callRule("seeCalls");
  showCalls(false);
}
$("tabCalls").onclick = () =>
  run(async () => {
    showTab("calls");
    await loadCalls();
  });
$("refreshCalls").onclick = () => run(() => loadCalls());
$("moreCalls").onclick = () => run(() => loadCalls({ more: true }));

$("logForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const file = $("logImage").files?.[0];
    const board = state.boards.find((row) => row.id === state.board);
    if (!file && board?.data.kind !== "text") return say("그림을 골라 주세요.");
    say("올리는 중…");
    const image = file ? await uploadManaged(file) : null;
    const character = $("logCharacter").value;
    const log = await communityCollection(COLLECTION.logs).add({
      image: image?.url ?? null,
      ...(image ? { imageId: image.id } : {}),
      text: $("logText").value.trim(),
      board: state.board,
      title: $("logTitle").value.trim(),
      category: $("logCategory").value,
      secret: $("logSecret").checked,
      ...(character ? { character } : {}),
      ...($("logDice").checked ? { dice: true } : {}),
    });
    state.ownPosts.add(log.id);
    if (state.newPost === log.id) showNewPost(null);
    $("logs").prepend(await logItem(log));
    $("logForm").reset?.();
    $("logCharacter").value = character;
    configureBoard();
    say("로그를 올렸습니다.");
  });
};

async function loadBoards() {
  state.boards = await allDocuments(COLLECTION.boards);
  if (!state.boards.length)
    state.boards = [
      {
        id: "default",
        data: {
          name: "로그",
          kind: "image",
          enabled: true,
          secret: "optional",
          categories: [],
          writeLevel: 2,
          actions: true,
        },
      },
    ];
  if (!state.boards.some((row) => row.id === state.board))
    state.board = state.boards[0].id;
  $("board").replaceChildren();
  for (const row of state.boards) {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.data.name;
    $("board").append(option);
  }
  $("board").value = state.board;
  configureBoard();
}
function configureBoard() {
  const board = state.boards.find((row) => row.id === state.board);
  $("boardDescription").textContent = board?.data.description ?? "";
  $("logImage").required = board?.data.kind !== "text";
  $("logForm").hidden =
    board?.data.enabled === false ||
    (state.role !== "moderator" && state.level < (board?.data.writeLevel ?? 2));
  $("logCategory").replaceChildren();
  for (const name of ["", ...(board?.data.categories ?? [])]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name || "분류 없음";
    $("logCategory").append(option);
  }
  $("logSecret").disabled = board?.data.secret !== "optional";
  $("logSecret").checked = board?.data.secret === "required";
}
wireSpeakerChoice($("logCharacter"));
$("board").onchange = () =>
  run(async () => {
    state.board = $("board").value;
    configureBoard();
    await loadLogs();
  });

$("characterForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const name = $("characterName").value.trim();
    if (!name) return;
    const file = $("characterImage").files?.[0];
    const uploaded = file ? await uploadManaged(file) : null;
    const image = uploaded?.url ?? null;
    const fields = Object.fromEntries(
      [...$("characterFields").querySelectorAll("[data-field]")]
        .map((input) => [input.dataset.field, input.value.trim()])
        .filter(([, value]) => value),
    );
    const character = await communityCollection(COLLECTION.characters).add({
      name,
      side: $("characterSide").value.trim(),
      profile: $("characterProfile").value.trim(),
      image,
      ...(uploaded ? { imageId: uploaded.id } : {}),
      type: $("characterType").value,
      state: $("characterState").value,
      ...(Object.keys(fields).length ? { fields } : {}),
    });
    state.speakers = null;
    $("characters").prepend(await characterItem(character));
    $("characterForm").reset?.();
    say(`${name}을(를) 등록했습니다.`);
  });
};

await run(start);

let questCursor = null;
async function loadQuests(more = false) {
  const page = await callRule("quests", {
    type: $("questType").value,
    after: more ? questCursor : null,
  });
  if (!more) $("quests").replaceChildren();
  for (const row of page.documents) {
    const li = document.createElement("li");
    li.className = "card";
    const heading = document.createElement("h3");
    heading.textContent = row.data.name;
    const detail = document.createElement("p");
    detail.textContent = `${row.data.type === "weekly" ? "주간" : "일일"} · ${row.data.side || "공통"} · ${row.data.startsAt?.replace("T", " ") || "시작 제한 없음"} ~ ${row.data.endsAt?.replace("T", " ") || "종료 제한 없음"} (한국 시간)`;
    li.append(heading, detail);
    for (const url of row.data.images ?? []) {
      if (typeof url !== "string" || !url.startsWith("https://")) continue;
      const image = document.createElement("img");
      image.src = url;
      image.alt = row.data.name;
      image.loading = "lazy";
      image.style.maxWidth = "100%";
      li.append(image);
    }
    $("quests").append(li);
  }
  questCursor = page.nextCursor;
  $("moreQuests").hidden = !questCursor;
}
$("tabQuests").onclick = () =>
  run(async () => {
    showTab("quests");
    await loadQuests();
  });
$("questType").onchange = () => run(() => loadQuests());
$("refreshQuests").onclick = () => run(() => loadQuests());
$("moreQuests").onclick = () => run(() => loadQuests(true));

async function loadEmoticons() {
  if (state.emoticons !== null) return state.emoticons;
  const member = state.member;
  const rows = await allDocuments(COLLECTION.emoticons);
  if (state.member !== member) return [];
  state.emoticons = rows.filter((row) => !row.data.deleted);
  return state.emoticons;
}

async function loadContentBody() {
  const id = $("contentPage").value;
  if (!id) {
    $("contentBody").textContent = "등록된 안내 페이지가 없습니다.";
    return;
  }
  const member = state.member;
  $("contentBody").replaceChildren();
  const result = await callRule("contentPage", {
    id,
    mobile: window.innerWidth <= 700,
  });
  if (state.member !== member || $("contentPage").value !== id) return;
  renderContent($("contentBody"), result.page);
}
async function loadContentPages() {
  const previous = $("contentPage").value;
  $("contentPage").replaceChildren();
  let cursor = null;
  do {
    const page = await callRule("contentPages", { after: cursor });
    for (const row of page.documents) {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.data.name;
      $("contentPage").append(option);
    }
    cursor = page.nextCursor;
  } while (cursor);
  if ([...$("contentPage").options].some((option) => option.value === previous))
    $("contentPage").value = previous;
  await loadContentBody();
}
$("tabContent").onclick = () =>
  run(async () => {
    showTab("content");
    await loadContentPages();
  });
$("contentPage").onchange = () => run(() => loadContentBody());
$("refreshContent").onclick = () => run(() => loadContentPages());
