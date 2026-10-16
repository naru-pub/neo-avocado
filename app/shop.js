// The shop and inventory: buying, gacha, crafting, gifts and history.
// Prices and balances are decided by site functions; the page shows results.

import {
  $,
  allDocuments,
  caller,
  COLLECTION,
  collection,
  edit,
  formatTime,
  ownCharacters,
  run,
  say,
  SHOP_PAGE,
  showTab,
  state,
  uploadManaged,
  route,
  renderPages,
} from "./core.js";
import { onDisplay } from "../_naru/modules/display.js";

async function loadBalance() {
  const wallet = await collection(COLLECTION.wallets)
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
  // Independent panels, read at once.
  await Promise.all([
    loadBalance(),
    Promise.all([loadShopFront(), loadShopCharacter()]).then(() => loadItems()),
    loadInventory(),
    loadRecipes(),
    $("historyPanel").open ? loadHistory() : null,
  ]);
  state.shopLoaded = true;
}
/**
 * The shop's front (shop/skin/shop.skin.php): the owner's NPC and greeting,
 * and a button for each category (cf_shop_category); items without one are
 * in the first.
 */
async function loadShopFront() {
  const settings = await collection(COLLECTION.settings)
    .get("community")
    .catch((error) => {
      if (error?.code === "NOT_FOUND") return null;
      throw error;
    });
  const categories = String(settings?.data.shopCategories ?? "일반, 이벤트")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  state.shopCategories = categories.length ? categories : ["일반"];
  if (!state.shopCategories.includes(state.shopCategory))
    state.shopCategory = state.shopCategories[0];
  state.shopGreeting = settings?.data.shopGreeting ?? "";
  $("shopTalk").textContent = state.shopGreeting;
  $("shopNpc").hidden = !settings?.data.shopNpc;
  if (settings?.data.shopNpc) $("shopNpc").src = settings.data.shopNpc;
  $("shopCategories").replaceChildren(
    ...state.shopCategories.map((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.setAttribute("aria-pressed", String(name === state.shopCategory));
      button.onclick = () => {
        route(`shop/${name}`, { replace: true });
        showShopCategory(name);
      };
      return button;
    }),
  );
}
/** Shows one category's items (a button, or the shop/카테고리 address). */
export function showShopCategory(name) {
  state.shopCategory = name;
  if (!state.shopCategories) return;
  for (const button of $("shopCategories").children)
    button.setAttribute("aria-pressed", String(button.textContent === name));
  showCategory();
}
/**
 * The chosen character's official record (approval, 세력 and 종족), which
 * buying needs: the original's shop is its member's character's
 * (shop/_ajax.shop_update.php:4).
 */
async function loadShopCharacter() {
  const id = state.inventoryCharacter;
  const status = id
    ? await caller().call("characters/progression:characterStatus", {
        character: id,
      })
    : null;
  // A choice made while this was read wins.
  if (id !== state.inventoryCharacter) return;
  state.shopCharacter = status ? { id, ...status.state } : null;
  const approved = state.shopCharacter?.approved === true;
  $("shopBuyNote").hidden = approved;
  $("shopBuyNote").textContent = id
    ? "승인된 캐릭터만 구매할 수 있습니다."
    : "구매하려면 위에서 승인된 내 캐릭터를 고르세요.";
}
/**
 * Whether the chosen character may see an item: one kept for some 세력 or
 * 종족 is left out for the others, and for no character (shop/index.php:33,36).
 */
function forCharacter(item) {
  const requirements = item.data.requirements ?? {};
  const character = state.shopCharacter;
  return [
    ["sides", "side"],
    ["classes", "class"],
  ].every(
    ([key, field]) =>
      !Array.isArray(requirements[key]) ||
      !requirements[key].length ||
      (character && requirements[key].includes(character[field])),
  );
}
/** The shop's items of the chosen category, from what has been read. */
function showCategory(number = 1) {
  const first = state.shopCategories?.[0];
  const shown = [...state.itemCatalog.values()].filter(
    (item) =>
      !item.data.hidden &&
      onDisplay(item.data.display, Date.now()) &&
      (item.data.shopCategory || first) === state.shopCategory &&
      forCharacter(item),
  );
  // Ten to a page (shop/index.php's page_rows).
  const pages = Math.ceil(shown.length / SHOP_PAGE);
  const current = Math.min(Math.max(1, number), Math.max(1, pages));
  $("items").replaceChildren(
    ...shown
      .slice((current - 1) * SHOP_PAGE, current * SHOP_PAGE)
      .map((item) => shopItem(item)),
  );
  renderPages($("itemPages"), current, pages, (next) => showCategory(next));
}
/** Every item, once: categories and pages are drawn from them. */
async function loadItems() {
  const items = await allDocuments(COLLECTION.items);
  state.itemCatalog.clear();
  for (const item of items) state.itemCatalog.set(item.id, item);
  showCategory();
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
  // As the original's popup, the NPC talks about the item picked.
  row.onclick = (event) => {
    if (event.target.closest("button")) return;
    $("shopTalk").textContent =
      `${item.data.name}${item.data.description ? ` — ${item.data.description}` : ""}`;
  };
  row.append(itemPortrait(item.data));
  const label = document.createElement("span");
  const stock =
    typeof item.data.stock === "number" ? ` · 남은 ${item.data.stock}개` : "";
  label.textContent = `${item.data.name} · ${item.data.price ?? 0} 아보${stock}`;
  const buy = document.createElement("button");
  buy.type = "button";
  buy.textContent = item.data.stock === 0 ? "품절" : "사기";
  buy.disabled = item.data.stock === 0;
  // 구매하기 shows only for an approved character (shop.item.skin.php:24).
  buy.hidden = state.shopCharacter?.approved !== true;
  buy.onclick = () =>
    spend(
      "economy/shop:buy",
      {
        item: item.id,
        character: state.shopCharacter.id,
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
  const page = await collection(COLLECTION.inventory).list({
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
    const items = await collection(COLLECTION.items).getMany(missing);
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
          "economy/inventory:sell",
          { inventory: owned.id },
          (result) => `${result.name}을(를) 판매했습니다.`,
        );
    };
    const gift = document.createElement("button");
    gift.type = "button";
    gift.textContent = "선물";
    // inventory/inventory_update.php: the gift goes to a character named by
    // the sender (get_character_by_name), found with one read.
    gift.onclick = () =>
      edit(
        `${owned.data.name} 선물`,
        [
          {
            name: "name",
            label: "받는 캐릭터 이름",
            required: true,
            max: 40,
          },
          { name: "memo", label: "메시지", multiline: true, max: 500 },
        ],
        async (data) => {
          const { documents } = await collection(COLLECTION.characters).list({
            where: {
              all: [
                { eq: ["name", data.name.trim()] },
                { eq: ["state", "approved"] },
              ],
            },
            size: 1,
          });
          const character = documents[0];
          if (!character) return say("그 이름의 캐릭터를 찾을 수 없습니다.");
          const recipient = character.createdBy ?? character.data.owner;
          if (recipient === state.member.id)
            return say("내 캐릭터에게는 선물할 수 없습니다.");
          await state.member.call("economy/inventory:gift", {
            inventory: owned.id,
            recipient,
            character: character.id,
            memo: data.memo,
          });
          say(`${character.data.name}에게 선물을 보냈습니다.`);
          await loadInventory();
        },
      );
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
          await caller().call("economy/inventory:assignInventory", {
            inventory: owned.id,
            character: character || null,
          });
          await loadInventory();
        },
      );
    // 판매, 사용 and 선물 only where the item allows them
    // (inventory/skin/item.skin.php:36-44); the functions refuse the rest.
    const item = state.itemCatalog.get(owned.data.item)?.data;
    sell.hidden = !(
      typeof item?.sellPrice === "number" && item.sellable !== false
    );
    use.hidden = !(item?.effect?.type && item.usable !== false);
    gift.hidden = !item || item.giftable === false;
    row.append(" ", sell, " ", gift, " ", use, " ", assign);
    $("inventory").append(row);
  }
  state.inventoryCursor = page.nextCursor;
  $("moreInventory").hidden = !page.nextCursor;
}
$("inventoryCharacter").onchange = () =>
  run(async () => {
    state.inventoryCharacter = $("inventoryCharacter").value || null;
    await Promise.all([
      loadInventory(),
      loadShopCharacter().then(() => showCategory()),
    ]);
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
  exp: "경험치 변경",
};
async function loadHistory({ more = false } = {}) {
  const page = await caller().call("economy/history:history", {
    after: more ? state.historyCursor : null,
    size: 20,
  });
  if (!more) $("history").replaceChildren();
  for (const row of page.documents) {
    const li = document.createElement("li");
    li.textContent = `${formatTime(row.data.at)} · ${HISTORY_NAMES[row.data.kind] ?? row.data.kind}${row.data.delta !== undefined ? ` · ${row.data.delta > 0 ? "+" : ""}${row.data.delta} 아보` : ""}${row.data.balance !== undefined ? ` · 잔액 ${row.data.balance}` : ""}${row.data.expDelta !== undefined ? ` · 경험치 ${row.data.expDelta > 0 ? "+" : ""}${row.data.expDelta} (총 ${row.data.exp})` : ""}${row.data.memo ? ` · ${row.data.memo}` : ""}`;
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
  const item = await collection(COLLECTION.items).get(owned.data.item);
  const effect = item.data.effect;
  if (!effect || item.data.usable === false)
    return say("사용할 수 없는 아이템입니다.");
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
      }
      if (effect.type === "profile")
        data.revision = characters.find((row) => row.id === character).revision;
      const result = await caller().call("economy/inventory:useItem", {
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
    "economy/inventory:craft",
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
function spend(reference, args, success) {
  return run(async () => {
    const result = await state.member.call(reference, args);
    say(success(result));
    await loadShop();
  });
}
$("tabShop").onclick = () =>
  run(async () => {
    showTab("shop");
    if (!state.shopLoaded) await loadShop();
  });
$("daily").onclick = () =>
  spend(
    "economy/shop:daily",
    null,
    (result) => `출석 보상을 받았습니다. 잔액 ${result.balance} 아보.`,
  );
$("gacha").onclick = () =>
  spend(
    "economy/shop:gacha",
    state.inventoryCharacter ? { character: state.inventoryCharacter } : null,
    (result) =>
      result.owned
        ? `뽑기에서 ${result.owned.data.name}이(가) 나왔습니다!`
        : "아무것도 나오지 않았습니다.",
  );
$("moreInventory").onclick = () => run(() => loadInventory({ more: true }));
