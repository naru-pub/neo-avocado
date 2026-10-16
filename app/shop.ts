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
  uploadMedia,
  route,
  renderPages,
  query,
} from "./core.js";
import { amountText, expText, moneyText } from "./names.js";
import { onDisplay } from "../_naru/modules/display.js";
import { editCharacter } from "./characters.js";

async function loadBalance() {
  const { balance } = await query("economy/wallet:wallet");
  $("balance").textContent = amountText(balance);
}
async function loadShop() {
  state.ownCharacters = await ownCharacters();
  const selector = $<HTMLSelectElement>("inventoryCharacter");
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
    $<HTMLDetailsElement>("historyPanel").open ? loadHistory() : null,
  ]);
  state.shopLoaded = true;
}
/**
 * The shop's front (shop/skin/shop.skin.php): the owner's NPC and greeting,
 * and a button for each category (cf_shop_category); items without one are
 * in the first.
 */
async function loadShopFront() {
  const settings = await query("content/site:settings");
  const categories = String(settings.shopCategories ?? "일반, 이벤트")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  state.shopCategories = categories.length ? categories : ["일반"];
  if (!state.shopCategories.includes(state.shopCategory))
    state.shopCategory = state.shopCategories[0];
  state.shopGreeting = settings.shopGreeting ?? "";
  $("shopTalk").textContent = state.shopGreeting;
  $("shopNpc").hidden = !settings.shopNpc;
  if (settings.shopNpc) $<HTMLImageElement>("shopNpc").src = settings.shopNpc;
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
 * The chosen character's official record (approval) and its sheet's 세력
 * and 종족, which
 * buying needs: the original's shop is its member's character's
 * (shop/_ajax.shop_update.php:4).
 */
async function loadShopCharacter() {
  const id = state.inventoryCharacter;
  const status = id
    ? await query("characters/progression:characterStatus", {
        character: id,
      })
    : null;
  // A choice made while this was read wins.
  if (id !== state.inventoryCharacter) return;
  // 소속 and 종족 are the sheet's own (ch_side, ch_class), the member's pick.
  const sheet = state.ownCharacters.find((row) => row.id === id);
  state.shopCharacter = status
    ? {
        id,
        ...status.state,
        side: sheet?.data.side ?? "",
        class: sheet?.data.class ?? "",
      }
    : null;
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
  // The owner's 진열 순서 (sh_order, shop/index.php:15), then by name.
  shown.sort(
    (a, b) =>
      (a.data.order ?? 0) - (b.data.order ?? 0) ||
      String(a.data.name ?? "").localeCompare(String(b.data.name ?? "")) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
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
/** An item's name from the catalog, for requirements and recipes. */
const itemName = (id) => state.itemCatalog.get(id)?.data.name ?? id;
/**
 * What buying costs (_ajax.shop_item.php's $money): the money, the
 * experience it consumes and the items it takes, joined with +.
 */
function priceText(item) {
  const r = item.data.requirements ?? {};
  const parts = [];
  if ((item.data.price ?? 0) > 0 && r.consumeMoney !== false)
    parts.push(moneyText(state.names, item.data.price));
  if (r.exp && r.consumeExp) parts.push(expText(state.names, r.exp));
  for (const entry of r.items ?? [])
    if (entry.consume) parts.push(`${itemName(entry.item)} ${entry.count}개`);
  return parts.join(" + ") || "무료";
}
/** What else buying asks of the character, beyond its price. */
function requirementsText(r) {
  return [
    r.approved ? "승인 캐릭터" : "",
    r.sides?.length
      ? `${state.names.sideTitle || "소속"}: ${r.sides.join(", ")}`
      : "",
    r.classes?.length
      ? `${state.names.classTitle || "종족"}: ${r.classes.join(", ")}`
      : "",
    r.exp && !r.consumeExp ? `${expText(state.names, r.exp)} 이상` : "",
    r.title ? `타이틀 ${r.title}${r.consumeTitle ? " 소모" : " 필요"}` : "",
    r.limit !== undefined ? `캐릭터별 ${r.limit}회` : "",
    ...(r.items ?? [])
      .filter((entry) => !entry.consume)
      .map((entry) => `${itemName(entry.item)} ${entry.count}개 필요`),
  ]
    .filter(Boolean)
    .join(" · ");
}
/**
 * The copies of each needed item from the chosen character's inventory,
 * gifts last, as the original takes them without asking; null if short.
 */
function pickMaterials(needs) {
  const picked = [];
  for (const need of needs ?? []) {
    const copies = state.inventoryRows
      .filter((row) => row.data.item === need.item)
      .sort(
        (a, b) =>
          Number(Boolean(a.data.sender)) - Number(Boolean(b.data.sender)),
      )
      .slice(0, need.count);
    if (copies.length < need.count) {
      say(`${itemName(need.item)}이(가) ${need.count}개 필요합니다.`);
      return null;
    }
    picked.push(...copies.map((row) => row.id));
  }
  return picked;
}
/** The shop's list: each item's picture and name (shop.skin.php). */
function shopItem(item) {
  const row = document.createElement("li");
  row.className = "shop-item";
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "shop-pick";
  pick.append(itemPortrait(item.data), item.data.name);
  pick.onclick = () => showShopDetail(item);
  row.append(pick);
  return row;
}
/** The item picked (shop.item.skin.php): the NPC speaks, 구매하기 below. */
function showShopDetail(item) {
  $("shopTalk").textContent =
    item.data.shopTalk ||
    `${item.data.name}${item.data.description ? ` — ${item.data.description}` : ""}`;
  const detail = $("shopDetail");
  detail.replaceChildren(itemPortrait(item.data));
  const title = document.createElement("h3");
  title.append(item.data.name, " ");
  const price = document.createElement("sup");
  price.className = "price";
  price.textContent = priceText(item);
  title.append(price);
  detail.append(title);
  for (const [text, className] of [
    [item.data.description, "description"],
    [item.data.effectDescription, "effect"],
    [requirementsText(item.data.requirements ?? {}), "requirements"],
    [
      typeof item.data.stock === "number"
        ? `남은 수량 ${item.data.stock}개`
        : "",
      "stock",
    ],
  ])
    if (text)
      detail.append(
        Object.assign(document.createElement("p"), {
          className,
          textContent: text,
        }),
      );
  // 구매하기 only for an approved character (shop.item.skin.php:24).
  if (state.shopCharacter?.approved === true) {
    const buy = document.createElement("button");
    buy.type = "button";
    buy.textContent = item.data.stock === 0 ? "품절" : "구매하기";
    buy.disabled = item.data.stock === 0;
    buy.onclick = () => {
      const materials = item.data.requirements?.items?.length
        ? pickMaterials(item.data.requirements.items)
        : [];
      if (!materials) return;
      spend(
        "economy/shop:buy",
        {
          item: item.id,
          character: state.shopCharacter.id,
          ...(materials.length ? { materials } : {}),
        },
        (result) => `${result.owned.data.name}을(를) 샀습니다.`,
      );
    };
    detail.append(buy);
  }
  detail.hidden = false;
}
/**
 * The chosen character's inventory (inventory/list.inc.php): gifts one by
 * one with a mark, the rest one slot an item with its count.
 */
async function loadInventory() {
  const rows = await allDocuments(COLLECTION.inventory, {
    owner: state.member.id,
    ...(state.inventoryCharacter
      ? { character: state.inventoryCharacter }
      : {}),
  });
  state.inventoryRows = state.inventoryCharacter
    ? rows
    : rows.filter((row) => !row.data.character);
  const missing = [
    ...new Set(state.inventoryRows.map((row) => row.data.item)),
  ].filter((id) => id && !state.itemCatalog.has(id));
  for (let start = 0; start < missing.length; start += 100) {
    const ids = missing.slice(start, start + 100);
    const items = await collection(COLLECTION.items).getMany(ids);
    items.forEach((item, index) => state.itemCatalog.set(ids[index], item));
  }
  const gifts = state.inventoryRows.filter((row) => row.data.sender);
  const groups = new Map();
  for (const row of state.inventoryRows)
    if (!row.data.sender)
      groups.set(row.data.item, [...(groups.get(row.data.item) ?? []), row]);
  const slots = [...gifts.map((row) => [row]), ...groups.values()];
  $("inventory").replaceChildren(
    ...slots.map((copies) => {
      const owned = copies[0];
      const item = state.itemCatalog.get(owned.data.item)?.data;
      const slot = document.createElement("li");
      slot.className = "inventory-slot";
      const open = document.createElement("button");
      open.type = "button";
      open.title = owned.data.name ?? item?.name ?? "";
      open.append(itemPortrait(item ?? owned.data));
      if (copies.length > 1)
        open.append(
          Object.assign(document.createElement("i"), {
            className: "count",
            textContent: copies.length,
          }),
        );
      if (owned.data.sender)
        open.append(
          Object.assign(document.createElement("i"), {
            className: "present",
            title: "선물",
            textContent: "🎁",
          }),
        );
      open.onclick = () => showInventoryDetail(owned);
      slot.append(open);
      return slot;
    }),
  );
  if (!slots.length)
    $("inventory").append(
      Object.assign(document.createElement("li"), {
        className: "no-data",
        textContent: "보유중인 아이템이 없습니다.",
      }),
    );
  $("inventoryDetail").hidden = true;
}
/**
 * One item's detail (inventory/skin/item.skin.php): picture, name and sale
 * price, what it is and does, a gift's message and sender, and 판매하기,
 * 사용하기 and 선물하기 where the item allows them.
 */
function showInventoryDetail(owned) {
  const item = state.itemCatalog.get(owned.data.item)?.data;
  const detail = $("inventoryDetail");
  detail.replaceChildren(itemPortrait(item ?? owned.data));
  const title = document.createElement("h3");
  title.append(owned.data.name ?? item?.name ?? "");
  const sellable =
    typeof item?.sellPrice === "number" && item.sellable !== false;
  if (sellable)
    title.append(
      " ",
      Object.assign(document.createElement("sup"), {
        className: "price",
        textContent: moneyText(state.names, item.sellPrice),
      }),
    );
  detail.append(title);
  for (const [text, className] of [
    [item?.description, "description"],
    [item?.effectDescription, "effect"],
  ])
    if (text)
      detail.append(
        Object.assign(document.createElement("p"), {
          className,
          textContent: text,
        }),
      );
  if (owned.data.sender) {
    const memo = document.createElement("div");
    memo.className = "gift-memo";
    if (owned.data.memo)
      memo.append(
        Object.assign(document.createElement("p"), {
          textContent: owned.data.memo,
        }),
      );
    memo.append(
      Object.assign(document.createElement("p"), {
        className: "by",
        textContent: `By. ${owned.data.senderName || "누군가"}`,
      }),
    );
    detail.append(memo);
  }
  const actions = document.createElement("p");
  actions.className = "actions";
  const button = (label, onclick) => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    control.onclick = onclick;
    actions.append(control, " ");
  };
  if (sellable)
    button("판매하기", () => {
      if (confirm(`${owned.data.name}을(를) 판매할까요?`))
        spend(
          "economy/inventory:sell",
          { inventory: owned.id },
          (result) => `${result.name}을(를) 판매했습니다.`,
        );
    });
  if (item?.effect?.type && item.usable !== false)
    button("사용하기", () => run(() => useInventory(owned)));
  if (item && item.giftable !== false)
    button("선물하기", () => giveItem(owned));
  button("캐릭터 이동", () =>
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
    ),
  );
  detail.append(actions);
  detail.hidden = false;
}
/**
 * 선물하기 (inventory/inc/send_item_form.php): to a character named by the
 * sender, another member's or their own, with a message.
 */
function giveItem(owned) {
  edit(
    `${owned.data.name} 선물`,
    [
      { name: "name", label: "받는 캐릭터 이름", required: true, max: 40 },
      { name: "memo", label: "전달 메시지", multiline: true, max: 500 },
    ],
    async (data) => {
      const { document: character } = await query("characters/sheet:named", {
        name: data.name.trim(),
        approved: true,
      });
      if (!character) return say("그 이름의 캐릭터를 찾을 수 없습니다.");
      await state.member.call("economy/inventory:gift", {
        inventory: owned.id,
        recipient: character.createdBy ?? character.data.owner,
        character: character.id,
        memo: data.memo,
      });
      say(`${character.data.name}님께 선물이 배송되었습니다.`);
      await loadInventory();
    },
  );
}
$("inventoryCharacter").onchange = () =>
  run(async () => {
    state.inventoryCharacter =
      $<HTMLSelectElement>("inventoryCharacter").value || null;
    await Promise.all([
      loadInventory(),
      loadShopCharacter().then(() => showCategory()),
    ]);
  });
const HISTORY_NAMES = {
  adjust: "운영자 잔액 조정",
  daily: "첫 로그인",
  signup: "회원가입 축하",
  buy: "구매",
  sell: "판매",
  gift: "선물 보냄",
  giftReceived: "선물 받음",
  craft: "제작",
  gacha: "뽑기",
  use: "아이템 사용",
  exp: "변경",
};
async function loadHistory({ more = false } = {}) {
  const page = await caller().call("economy/history:history", {
    after: more ? state.historyCursor : null,
    size: 20,
  });
  if (!more) $("history").replaceChildren();
  for (const row of page.documents) {
    const li = document.createElement("li");
    li.textContent = `${formatTime(row.data.at)} · ${row.data.kind === "exp" ? `${state.names.expName} ` : ""}${HISTORY_NAMES[row.data.kind] ?? row.data.kind}${row.data.delta !== undefined ? ` · ${row.data.delta > 0 ? "+" : ""}${moneyText(state.names, row.data.delta)}` : ""}${row.data.balance !== undefined ? ` · 잔액 ${row.data.balance}` : ""}${row.data.expDelta !== undefined ? ` · ${state.names.expName} ${row.data.expDelta > 0 ? "+" : ""}${row.data.expDelta} (총 ${row.data.exp})` : ""}${row.data.memo ? ` · ${row.data.memo}` : ""}`;
    $("history").append(li);
  }
  state.historyCursor = page.nextCursor;
  $("moreHistory").hidden = !page.nextCursor;
}
$("historyPanel").ontoggle = () => {
  if ($<HTMLDetailsElement>("historyPanel").open) run(() => loadHistory());
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
    // 프로필수정 opens the character's whole form, even after the editing
    // period, and saving it spends the ticket (inventory/use_item.php:27-28,
    // character_form_update.php:18,268).
    if (effect.type === "profile") {
      const open = (chosen) =>
        editCharacter(
          chosen,
          async () => {
            say(`${owned.data.name}을(를) 사용했습니다.`);
            state.charactersLoaded = false;
            await loadShop();
          },
          owned.id,
        );
      if (characters.length === 1) return await open(characters[0]);
      return edit(
        `${owned.data.name} 사용`,
        [
          {
            name: "character",
            label: "수정할 캐릭터",
            required: true,
            value: characters[0].id,
            options: characters.map((row) => [row.id, row.data.name]),
          },
        ],
        ({ character }) => {
          const chosen = characters.find((row) => row.id === character);
          // The form opens once this dialog has closed.
          setTimeout(() => run(() => open(chosen)));
        },
      );
    }
    fields.push({
      name: "character",
      label: "캐릭터",
      required: true,
      value: characters[0].id,
      options: characters.map((row) => [row.id, row.data.name]),
    });
  }
  if (effect.type === "create")
    fields.push(
      { name: "name", label: "새 아이템 이름", required: true, max: 80 },
      // The original asks for all of these (inventory/inc/add_item_form.php).
      {
        name: "description",
        label: "설명",
        multiline: true,
        max: 2000,
        required: true,
      },
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
      if (effect.type === "create" && !file && !data.image)
        throw new Error("이미지 주소를 넣거나 이미지 파일을 골라 주세요.");
      if (file) {
        const uploaded = await uploadMedia(file);
        data.image = uploaded.url;
      }
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
  const describeRecipe = () => {
    const recipe = state.recipes.find(
      (row) => row.id === $<HTMLSelectElement>("recipe").value,
    );
    $("recipeDescription").textContent = recipe
      ? `${recipe.data.description ?? ""} · ${moneyText(state.names, recipe.data.cost ?? 0)} · 재료: ${(recipe.data.ingredients ?? []).map((ingredient) => `${itemName(ingredient.item)} × ${ingredient.count}`).join(", ")}`
      : "";
  };
  $("recipe").onchange = describeRecipe;
  describeRecipe();
}
$("craftForm").onsubmit = (event) => {
  event.preventDefault();
  const recipe = state.recipes.find(
    (row) => row.id === $<HTMLSelectElement>("recipe").value,
  );
  const materials = pickMaterials(recipe?.data.ingredients);
  if (!materials) return;
  spend(
    "economy/inventory:craft",
    {
      recipe: $<HTMLSelectElement>("recipe").value,
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
$("gacha").onclick = () =>
  spend(
    "economy/shop:gacha",
    state.inventoryCharacter ? { character: state.inventoryCharacter } : null,
    (result) =>
      result.owned
        ? `뽑기에서 ${result.owned.data.name}이(가) 나왔습니다!`
        : "아무것도 나오지 않았습니다.",
  );
