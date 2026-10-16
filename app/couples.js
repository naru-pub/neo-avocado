// 커플목록 (couple/): every couple the owner registered, with both
// characters' pictures and names and the day it began.
import {
  $,
  allDocuments,
  collection,
  COLLECTION,
  run,
  showTab,
} from "./core.js";

/** One side of a couple: the character's picture (or initial) and name. */
function partner(character) {
  const side = document.createElement("div");
  side.className = "partner";
  const picture = document.createElement("div");
  picture.className = "thumb";
  if (character?.data.image?.startsWith("https://")) {
    const image = document.createElement("img");
    image.src = character.data.image;
    image.alt = "";
    image.loading = "lazy";
    picture.append(image);
  } else picture.textContent = character?.data.name?.charAt(0) ?? "?";
  const name = document.createElement("p");
  name.textContent = character?.data.name ?? "삭제된 캐릭터";
  side.append(picture, name);
  return side;
}

async function loadCouples() {
  const couples = (await allDocuments(COLLECTION.couples)).sort(
    (a, b) =>
      (a.data.order ?? 0) - (b.data.order ?? 0) || (a.id < b.id ? -1 : 1),
  );
  const ids = [
    ...new Set(couples.flatMap((row) => [row.data.first, row.data.second])),
  ].filter((id) => typeof id === "string");
  const characters = new Map();
  for (let i = 0; i < ids.length; i += 100)
    for (const row of await collection(COLLECTION.characters).getMany(
      ids.slice(i, i + 100),
    ))
      if (row) characters.set(row.id, row);
  $("coupleList").replaceChildren(
    ...couples.map((couple) => {
      const item = document.createElement("li");
      const heart = document.createElement("span");
      heart.className = "heart";
      heart.textContent = "♥";
      item.append(
        partner(characters.get(couple.data.first)),
        heart,
        partner(characters.get(couple.data.second)),
      );
      if (couple.data.since) {
        const since = document.createElement("p");
        since.className = "since";
        // How many days, the first counted (couple/index.php's ceil).
        const days = Math.ceil(
          (Date.now() - Date.parse(`${couple.data.since}T00:00:00+09:00`)) /
            86400000,
        );
        since.textContent = `${couple.data.since} ~${Number.isFinite(days) && days > 0 ? ` · D+${days}` : ""}`;
        item.append(since);
      }
      return item;
    }),
  );
  if (!couples.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "등록된 커플이 없습니다.";
    $("coupleList").append(empty);
  }
}

// The list is read again only once it is a minute old: going back and forth
// between tabs reads it once, as the original's page loads once.
let couplesRead = 0;
$("tabCouples").onclick = () =>
  run(async () => {
    showTab("couples");
    if (Date.now() - couplesRead < 60_000) return;
    await loadCouples();
    couplesRead = Date.now();
  });
