// How a post or comment is shown: its text, dice and the character it speaks as.

import { emoticonContent } from "../emoticons.js";
import { nickOf, ownCharacters, query, run, state } from "./core.js";
import { openLogNumber, searchTag } from "./logs.js";

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
export function diceText(row) {
  const [first, second] =
    Array.isArray(row.data.rolls) && row.data.rolls.length === 2
      ? row.data.rolls
      : diceOf(row.id);
  return `🎲 ${first} + ${second} = ${first + second}`;
}
const POST_PART =
  /(https?:\/\/[^\s<>"']+|\[\[[^[\]\r\n]{1,20}\]\]|@[0-9]{1,9}|#[0-9a-zA-Z가-힣_]{1,30})/;
/**
 * Text with autolink()'s marks: web addresses as links (url_auto_link, in
 * 새창 링크's window; the mmb skin's picture boards say Link URL and open a
 * new one, extend/mmb.lib.php:15), [[nick]] calls, @N links to a log on
 * the same board and #tag searches. The rest stays text (and emoticons).
 */
export function postText(text, emoticons = [], { pictureBoard = false } = {}) {
  const fragment = document.createDocumentFragment();
  for (const part of String(text ?? "").split(POST_PART)) {
    if (!part) continue;
    if (/^https?:\/\//.test(part)) {
      const link = document.createElement("a");
      link.className = "other-site-link";
      link.href = part;
      link.target = pictureBoard ? "_blank" : state.paging.linkTarget;
      link.rel = "noopener noreferrer nofollow";
      link.textContent = pictureBoard ? "Link URL" : part;
      fragment.append(link);
    } else if (part.startsWith("[[") && POST_PART.test(part)) {
      const call = document.createElement("span");
      call.className = "member-call";
      call.textContent = part.slice(2, -2);
      fragment.append(call);
    } else if (/^@[0-9]+$/.test(part)) {
      const link = document.createElement("a");
      link.className = "log-link";
      link.href = `#log-${part.slice(1)}`;
      link.textContent = part;
      link.onclick = (event) => {
        event.preventDefault();
        run(() => openLogNumber(Number(part.slice(1))));
      };
      fragment.append(link);
    } else if (/^#[0-9a-zA-Z가-힣_]+$/.test(part)) {
      const link = document.createElement("a");
      link.className = "hash-tag";
      link.href = `#tag-${encodeURIComponent(part.slice(1))}`;
      link.textContent = part;
      link.onclick = (event) => {
        event.preventDefault();
        run(() => searchTag(part.slice(1)));
      };
      fragment.append(link);
    } else fragment.append(emoticonContent(document, part, emoticons));
  }
  return fragment;
}
/** Who wrote a post: the character it was posted as, with title and outfit, then the nickname. */
export async function speakerLabel(row) {
  const fragment = document.createDocumentFragment();
  // 익명 (wr_noname): readers get no author; the author and staff, a mark.
  if (row.data.anonymous === true && !row.data.owner && !row.data.guest) {
    fragment.append("익명의 누군가");
    return fragment;
  }
  if (row.data.anonymous === true) fragment.append("(익명) ");
  // Guests sign with a name of their own.
  const nick = row.data.guest?.name
    ? `${row.data.guest.name} (손님)`
    : await nickOf(row.createdBy ?? row.data.owner);
  const speaker = row.data.speaker;
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
export function actionItem(action) {
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
  if (action.type === "combine")
    line.append(
      action.success
        ? `${action.materials.join(", ")}을(를) 조합해 ${action.name}을(를) 제작했습니다!`
        : `${action.materials.join(", ")}을(를) 조합했지만 제작에 실패하였습니다.`,
    );
  else if (action.type === "explore")
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
      // Posts made before items only showed their use healed here.
      action.effect === "restore" && action.stat
        ? ` (${action.stat} +${action.amount})`
        : action.description
          ? ` (${action.description})`
          : "",
    );
  return line;
}
/** Fills a "post as" select with the member's characters the first time it is used. */
export function wireSpeakerChoice(select) {
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
/**
 * The member's inventory with each copy's item and the name of the character
 * holding it (`owner`, null for a copy no character holds), read once until
 * it changes: posts offer a character's own items (write.skin.php:68, 238)
 * that the owner lets them (it_use_mmb_able, it_use_recepi).
 */
export async function postInventory() {
  state.speakers ??= await ownCharacters();
  if (!state.postItems) {
    const { inventory, items } = await query("economy/inventory:inventory", {
      all: true,
    });
    for (const item of items) state.itemCatalog.set(item.id, item);
    state.postItems = inventory;
  }
  return state.postItems.map((row) => ({
    row,
    item: state.itemCatalog.get(row.data.item)?.data ?? null,
    owner:
      state.speakers.find((character) => character.id === row.data.character)
        ?.data.name ?? null,
  }));
}
/** Fills an in-post item select with what the member may use in posts. */
export function wireItemChoice(select) {
  select.onfocus = select.onpointerdown = () =>
    run(async () => {
      if (select.dataset.loaded) return;
      select.dataset.loaded = "1";
      // Any item the owner allows in posts: only a draw ticket does more
      // than show it was used (write_update.inc.php:106-131).
      for (const { row, item, owner } of await postInventory()) {
        if (!owner || !item || item.usable === false) continue;
        if (item.usableInPosts !== true) continue;
        const option = document.createElement("option");
        option.value = row.id;
        option.textContent = `${row.data.name ?? row.data.item} (${owner})`;
        select.append(option);
      }
    });
}
