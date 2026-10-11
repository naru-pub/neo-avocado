import { config } from "./config.js";

// 아보카도 에디션의 뼈대만 나루 회원으로 다시 만든 것: 회원 로그인과 닉네임,
// 캐릭터 등록, 그림 로그와 댓글, 댓글 주사위, 상점과 뽑기. 회원이 쓰는
// 컬렉션은 읽기·쓰기 모두 ‘회원’이라 로그인한 회원만 보고, 회원은 자기가 만든
// 문서만 고치고 지운다. 돈과 아이템은 회원이 읽기만 하고, 사이트의 서버 함수
// (/_naru/functions/neo-avocado.js)만 바꾼다.
const PREFIX = "neo_avocado_";
const COLLECTION = {
  profiles: `${PREFIX}profiles`,
  characters: `${PREFIX}characters`,
  logs: `${PREFIX}logs`,
  comments: `${PREFIX}comments`,
  wallets: `${PREFIX}wallets`,
  inventory: `${PREFIX}inventory`,
  items: `${PREFIX}items`,
};
const FUNCTIONS = "neo-avocado";
const SHOP_PAGE = 50;
const REASONS = {
  already: "오늘은 이미 받았습니다.",
  sold_out: "품절입니다.",
  not_enough: "아보가 모자랍니다.",
  no_item: "없는 아이템입니다.",
  empty: "아직 뽑을 것이 없습니다.",
};
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
};

const MESSAGES = {
  AUTH_REQUIRED: "로그인이 끝났습니다. 다시 회원 로그인해 주세요.",
  ACCESS_DENIED: "권한이 없습니다.",
  RATE_LIMITED: "잠시 뒤에 다시 해 주세요.",
  QUOTA_EXCEEDED: "사이트의 저장 공간이 가득 찼습니다.",
  UNAVAILABLE: "나루에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.",
};
function say(message) {
  $("status").textContent = message;
}
async function run(action) {
  try {
    await action();
  } catch (error) {
    console.error(error);
    if (error?.code === "AUTH_REQUIRED") {
      state.member = null;
      show();
    }
    say(MESSAGES[error?.code] ?? "요청을 처리하지 못했습니다.");
  }
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

const mine = (document) =>
  state.member !== null && document.createdBy === state.member.id;

/** 글쓴이의 닉네임. 처음 보는 회원만 한 번 묻는다. */
async function nickOf(memberId) {
  if (!memberId) return "운영자";
  if (!state.nicks.has(memberId))
    state.nicks.set(
      memberId,
      state.member
        .collection(COLLECTION.profiles)
        .get(memberId)
        .then(
          (profile) => profile.data.nick,
          () => "이름 없음",
        ),
    );
  return state.nicks.get(memberId);
}

async function connect() {
  const { createNaru } = await import("https://naru.pub/sdk/1/naru.js");
  state.naru = createNaru(config.site ? { site: config.site } : undefined);
}

function show(profile) {
  const member = state.member;
  $("signIn").hidden = Boolean(member);
  $("signOut").hidden = !member;
  $("welcome").hidden = Boolean(member);
  $("profileSetup").hidden = !member || Boolean(profile);
  $("community").hidden = !member || !profile;
  $("whoami").textContent = profile ? `${profile.data.nick} 님` : "";
}

async function start() {
  await connect();
  state.member = await state.naru.members.session();
  if (!state.member) return show();
  const profile = await state.member
    .collection(COLLECTION.profiles)
    .get(state.member.id)
    .catch((error) => {
      if (error?.code === "NOT_FOUND") return null;
      throw error;
    });
  show(profile);
  if (profile) {
    state.nicks.set(state.member.id, Promise.resolve(profile.data.nick));
    await loadLogs();
  }
}

/* ------------------------------------------------------------- logs --- */

async function loadLogs({ more = false } = {}) {
  const page = await state.member.collection(COLLECTION.logs).list({
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: LOG_PAGE,
    after: more ? state.logCursor : null,
  });
  if (!more) $("logs").replaceChildren();
  for (const log of page.documents) $("logs").append(await logItem(log));
  state.logCursor = page.nextCursor;
  $("moreLogs").hidden = !page.nextCursor;
}

async function logItem(log) {
  const item = $("logTemplate").content.firstElementChild.cloneNode(true);
  const image = item.querySelector(".log-image");
  image.src = log.data.image;
  item.querySelector(".log-text").textContent = log.data.text ?? "";
  item.querySelector(".author").textContent = await nickOf(log.createdBy);
  item.querySelector("time").textContent = formatTime(log.createdAt);
  const remove = item.querySelector(".delete");
  remove.hidden = !mine(log);
  remove.onclick = () =>
    run(async () => {
      if (!confirm("이 로그를 지울까요?")) return;
      await state.member.collection(COLLECTION.logs).delete(log.id);
      item.remove();
    });
  // 댓글은 펼쳤을 때 처음 읽는다.
  const comments = item.querySelector(".comments");
  let cursor;
  const load = (more) =>
    run(async () => {
      const page = await state.member.collection(COLLECTION.comments).list({
        filter: { logId: log.id },
        sort: [[{ metadata: "createdAt" }, "asc"]],
        size: COMMENT_PAGE,
        after: more ? cursor : null,
      });
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
  form.onsubmit = (event) => {
    event.preventDefault?.();
    run(async () => {
      const text = form.querySelector(".comment-text").value.trim();
      const dice = form.querySelector(".comment-dice").checked;
      if (!text && !dice) return;
      const saved = await state.member
        .collection(COLLECTION.comments)
        .add({ logId: log.id, text, dice });
      item.querySelector(".comment-list").append(await commentItem(saved));
      form.querySelector(".comment-text").value = "";
      form.querySelector(".comment-dice").checked = false;
    });
  };
  return item;
}

async function commentItem(comment) {
  const item = document.createElement("li");
  item.className = "comment";
  const author = document.createElement("strong");
  author.textContent = await nickOf(comment.createdBy);
  item.append(author, " ");
  if (comment.data.dice) {
    const [first, second] = diceOf(comment.id);
    const dice = document.createElement("span");
    dice.className = "dice";
    dice.textContent = `🎲 ${first} + ${second} = ${first + second}`;
    item.append(dice, " ");
  }
  item.append(comment.data.text ?? "");
  if (mine(comment)) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "삭제";
    remove.onclick = () =>
      run(async () => {
        await state.member.collection(COLLECTION.comments).delete(comment.id);
        item.remove();
      });
    item.append(" ", remove);
  }
  return item;
}

/* ------------------------------------------------------- characters --- */

async function loadCharacters({ more = false } = {}) {
  const page = await state.member.collection(COLLECTION.characters).list({
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: CHARACTER_PAGE,
    after: more ? state.characterCursor : null,
  });
  if (!more) $("characters").replaceChildren();
  for (const character of page.documents)
    $("characters").append(await characterItem(character));
  state.characterCursor = page.nextCursor;
  state.charactersLoaded = true;
  $("moreCharacters").hidden = !page.nextCursor;
}

async function characterItem(character) {
  const item = $("characterTemplate").content.firstElementChild.cloneNode(true);
  const image = item.querySelector(".character-image");
  if (character.data.image) image.src = character.data.image;
  else image.remove();
  item.querySelector(".character-name").textContent = character.data.name;
  item.querySelector(".character-side").textContent = character.data.side ?? "";
  item.querySelector(".character-profile").textContent =
    character.data.profile ?? "";
  item.querySelector(".author").textContent =
    `오너: ${await nickOf(character.createdBy)}`;
  const remove = item.querySelector(".delete");
  remove.hidden = !mine(character);
  remove.onclick = () =>
    run(async () => {
      if (!confirm(`${character.data.name}을(를) 지울까요?`)) return;
      await state.member.collection(COLLECTION.characters).delete(character.id);
      item.remove();
    });
  return item;
}

/* ------------------------------------------------------------- shop --- */

async function loadBalance() {
  const wallet = await state.member
    .collection(COLLECTION.wallets)
    .get(state.member.id)
    .catch((error) => {
      if (error?.code === "NOT_FOUND") return null;
      throw error;
    });
  $("balance").textContent = String(wallet?.data.balance ?? 0);
}

async function loadShop() {
  await loadBalance();
  const page = await state.member.collection(COLLECTION.items).list({
    sort: [[{ metadata: "createdAt" }, "asc"]],
    size: SHOP_PAGE,
  });
  $("items").replaceChildren(
    ...page.documents
      .filter((item) => !item.data.hidden)
      .map((item) => shopItem(item)),
  );
  await loadInventory();
  state.shopLoaded = true;
}

function shopItem(item) {
  const row = document.createElement("li");
  row.className = "card";
  const label = document.createElement("span");
  const stock =
    typeof item.data.stock === "number" ? ` · 남은 ${item.data.stock}개` : "";
  label.textContent = `${item.data.name} · ${item.data.price ?? 0} 아보${stock}`;
  const buy = document.createElement("button");
  buy.type = "button";
  buy.textContent = "사기";
  buy.onclick = () =>
    spend(
      "buy",
      { item: item.id },
      (result) => `${result.owned.data.name}을(를) 샀습니다.`,
    );
  row.append(label, " ", buy);
  if (item.data.description) {
    const description = document.createElement("p");
    description.textContent = item.data.description;
    row.append(description);
  }
  return row;
}

async function loadInventory({ more = false } = {}) {
  const page = await state.member.collection(COLLECTION.inventory).list({
    filter: { owner: state.member.id },
    sort: [[{ metadata: "createdAt" }, "desc"]],
    size: SHOP_PAGE,
    after: more ? state.inventoryCursor : null,
  });
  if (!more) $("inventory").replaceChildren();
  for (const owned of page.documents) {
    const row = document.createElement("li");
    row.textContent = owned.data.name;
    $("inventory").append(row);
  }
  state.inventoryCursor = page.nextCursor;
  $("moreInventory").hidden = !page.nextCursor;
}

/**
 * 서버 함수 하나를 부르고, 결과를 알린 뒤 잔액과 인벤토리를 다시 읽는다. 값을
 * 정하는 것은 서버이므로 페이지는 결과만 보여 준다.
 */
function spend(name, args, success) {
  return run(async () => {
    const result = await state.member.call(`${FUNCTIONS}/${name}`, args);
    if (!result?.ok) return say(REASONS[result?.reason] ?? "하지 못했습니다.");
    say(success(result));
    await loadShop();
  });
}

function showTab(name) {
  for (const [tab, view, key] of [
    ["tabLogs", "logsView", "logs"],
    ["tabCharacters", "charactersView", "characters"],
    ["tabShop", "shopView", "shop"],
  ]) {
    $(tab).setAttribute("aria-pressed", String(name === key));
    $(view).hidden = name !== key;
  }
}

/* ------------------------------------------------------------ wiring --- */

$("signIn").onclick = () => run(() => state.naru.members.signIn());
$("signOut").onclick = () =>
  run(async () => {
    const member = state.member;
    state.member = null;
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
    const profile = await state.member
      .collection(COLLECTION.profiles)
      .set(state.member.id, { nick });
    state.nicks.set(state.member.id, Promise.resolve(nick));
    show(profile);
    await loadLogs();
  });
};
$("tabLogs").onclick = () => showTab("logs");
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
$("daily").onclick = () =>
  spend(
    "daily",
    null,
    (result) => `출석 보상을 받았습니다. 잔액 ${result.balance} 아보.`,
  );
$("gacha").onclick = () =>
  spend(
    "gacha",
    null,
    (result) => `뽑기에서 ${result.owned.data.name}이(가) 나왔습니다!`,
  );
$("moreInventory").onclick = () => run(() => loadInventory({ more: true }));
$("moreLogs").onclick = () => run(() => loadLogs({ more: true }));
$("moreCharacters").onclick = () => run(() => loadCharacters({ more: true }));

$("logForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const file = $("logImage").files?.[0];
    if (!file) return say("그림을 골라 주세요.");
    say("올리는 중…");
    const image = await state.member.media.upload(file);
    const log = await state.member.collection(COLLECTION.logs).add({
      image: image.url,
      text: $("logText").value.trim(),
    });
    $("logs").prepend(await logItem(log));
    $("logForm").reset?.();
    say("로그를 올렸습니다.");
  });
};

$("characterForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const name = $("characterName").value.trim();
    if (!name) return;
    const file = $("characterImage").files?.[0];
    const image = file ? (await state.member.media.upload(file)).url : null;
    const character = await state.member.collection(COLLECTION.characters).add({
      name,
      side: $("characterSide").value.trim(),
      profile: $("characterProfile").value.trim(),
      image,
    });
    $("characters").prepend(await characterItem(character));
    $("characterForm").reset?.();
    say(`${name}을(를) 등록했습니다.`);
  });
};

await run(start);
