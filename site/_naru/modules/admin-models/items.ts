// 아이템 관리: items and the shop, inventories, draws, exploration, recipes, the history, money and grants.
import { type Data, displayWindow, type Model } from "./shared.js";

const items: Model = {
  label: "아이템·상점",
  help: "상점 가격·재고와 사용 효과, 구매 조건을 설정합니다. 빈 재고는 무제한입니다. 개인 제작 아이템도 여기에서 관리합니다.",
  fields: [
    { key: "name", label: "이름", required: true, max: 80 },
    // it_category (adm/item_form.php:81): what the item list files it under.
    {
      key: "category",
      label: "아이템 분류",
      type: "choice",
      options: [
        ["general", "일반 아이템"],
        ["personal", "개인 아이템"],
        ["attendance", "출석 아이템"],
      ],
    },
    { key: "description", label: "설명", type: "textarea", max: 2000 },
    // it_type: one of 커뮤니티 설정's 아이템 기능 (cf_item_category).
    {
      key: "itemType",
      label: "아이템 기능 (커뮤니티 설정의 아이템 기능 중 하나, 빈칸 가능)",
      max: 40,
    },
    // it_content2: what it does, under the description in the item's detail.
    {
      key: "effectDescription",
      label: "효과 설명",
      type: "textarea",
      max: 1000,
    },
    // sh_content: what the shop's NPC says of it when picked.
    { key: "shopTalk", label: "상점 NPC 대사", type: "textarea", max: 500 },
    { key: "image", label: "이미지", type: "url", image: true, max: 2000 },
    // it_1: a larger picture for the item's detail.
    {
      key: "detailImage",
      label: "상세이미지 (상점·인벤토리의 아이템 상세에 보임)",
      type: "url",
      image: true,
      max: 2000,
    },
    {
      key: "shopCategory",
      label: "상점 분류 (기본 설정의 분류 중 하나, 빈칸: 첫 분류)",
      max: 40,
    },
    {
      key: "display.from",
      label: "진열 시작일 (빈칸: 제한 없음)",
      type: "date",
    },
    {
      key: "display.until",
      label: "진열 종료일 (빈칸: 제한 없음)",
      type: "date",
    },
    {
      key: "display.fromHour",
      label: "진열 시작 시각 (0~23시, 한국 시간, 빈칸: 제한 없음)",
      type: "optional-number",
    },
    {
      key: "display.untilHour",
      label: "진열 종료 시각 (0~23시, 그 시각까지 포함)",
      type: "optional-number",
    },
    {
      key: "display.weekdays",
      label: "진열 요일 (일, 월, 화… 쉼표로 구분, 빈칸: 매일)",
      type: "tokens",
    },
    { key: "price", label: "구매 가격", type: "number", default: 0 },
    { key: "stock", label: "재고 (빈칸: 무제한)", type: "optional-number" },
    {
      key: "sellPrice",
      label: "판매 보상 (빈칸: 판매 불가)",
      type: "optional-number",
    },
    // sh_order (adm/shop_form.php): lower first in the shop.
    {
      key: "order",
      label: "진열 순서 (작은 수가 먼저)",
      type: "number",
      default: 0,
    },
    // A new item starts hidden, so it is not on sale at 0 until priced.
    {
      key: "hidden",
      label: "상점에서 숨기기",
      type: "checkbox",
      newDefault: true,
    },
    { key: "sellable", label: "판매 허용", type: "checkbox", default: true },
    { key: "giftable", label: "선물 허용", type: "checkbox", default: true },
    { key: "usable", label: "사용 허용", type: "checkbox", default: true },
    // it_use_mmb_able, it_use_recepi: both start off (adm/item_form.php:217).
    {
      key: "usableInPosts",
      label: "로그·댓글에서 사용 가능",
      type: "checkbox",
    },
    {
      key: "craftMaterial",
      label: "조합 재료로 사용 가능",
      type: "checkbox",
    },
    { key: "reusable", label: "사용 후 남기기", type: "checkbox" },
    {
      key: "effect.type",
      label: "사용 효과",
      type: "choice",
      options: [
        ["", "사용 효과 없음"],
        ["restore", "능력치 회복"],
        ["draw", "뽑기권"],
        ["create", "개인 아이템 제작권"],
        ["profile", "프로필 수정권"],
      ],
    },
    {
      key: "effect.stat",
      label: "회복할 능력치",
      type: "stat",
      optional: true,
    },
    { key: "effect.amount", label: "회복량", type: "optional-number" },
    {
      key: "requirements.approved",
      label: "승인 캐릭터만 구매",
      type: "checkbox",
    },
    {
      key: "requirements.sides",
      label: "구매 가능 세력 (쉼표로 구분, 빈칸: 모두)",
      type: "tokens",
    },
    {
      key: "requirements.classes",
      label: "구매 가능 종족 (쉼표로 구분, 빈칸: 모두)",
      type: "tokens",
    },
    {
      key: "requirements.exp",
      label: "구매에 필요한 경험치",
      type: "number",
      default: 0,
    },
    {
      key: "requirements.consumeExp",
      label: "구매 시 경험치 소모",
      type: "checkbox",
    },
    {
      key: "requirements.title",
      label: "구매에 필요한 타이틀",
      type: "title",
      optional: true,
    },
    {
      key: "requirements.consumeTitle",
      label: "구매 시 타이틀 소모",
      type: "checkbox",
    },
    {
      key: "requirements.limit",
      label: "구매 한도 (빈칸: 무제한)",
      type: "optional-number",
    },
    {
      key: "requirements.consumeMoney",
      label: "구매 시 돈 소모",
      type: "checkbox",
      default: true,
    },
    {
      key: "requirements.items",
      label: "구매에 필요한 교환 아이템",
      type: "ingredients",
      maxCount: 18,
      consumes: true,
    },
    {
      key: "useRequirements.approved",
      label: "승인 캐릭터만 사용",
      type: "checkbox",
    },
    {
      key: "useRequirements.sides",
      label: "사용 가능 세력 (쉼표로 구분)",
      type: "tokens",
    },
    {
      key: "useRequirements.classes",
      label: "사용 가능 종족 (쉼표로 구분)",
      type: "tokens",
    },
    {
      key: "useRequirements.exp",
      label: "사용에 필요한 경험치",
      type: "number",
      default: 0,
    },
    {
      key: "useRequirements.title",
      label: "사용에 필요한 타이틀",
      type: "title",
      optional: true,
    },
  ],
  check(data) {
    if (!data.effect.type) delete data.effect;
    else if (data.effect.type === "restore") {
      if (!data.effect.stat || !data.effect.amount)
        throw new Error("회복할 능력치와 양을 설정하세요.");
    } else data.effect = { type: data.effect.type };
    displayWindow(data);
  },
};

export const itemsModels: Record<string, Model> = {
  items,
  // 상점 진열 (adm/shop_list.php, shop_form.php): another sale of an item,
  // with the items form's own shop fields.
  shop_entries: {
    label: "상점 진열",
    help: "아이템 정의의 상점 설정 밖에, 같은 아이템을 다른 분류나 다른 가격·재고·기간·조건으로 더 진열합니다. 원본의 상점 관리처럼 진열마다 구매 한도와 재고를 따로 셉니다.",
    fields: [
      { key: "item", label: "아이템", type: "item", required: true },
      { key: "enabled", label: "진열 중", type: "checkbox", default: true },
      ...(items.fields ?? []).filter(
        (field) =>
          ["shopTalk", "shopCategory", "price", "stock", "order"].includes(
            field.key ?? "",
          ) ||
          field.key?.startsWith("display.") ||
          field.key?.startsWith("requirements."),
      ),
    ],
    check(data) {
      displayWindow(data);
    },
  },
  inventory: {
    label: "아이템 지급·보유 현황",
    help: "회원과 캐릭터를 선택해 아이템을 지급하거나 보유 정보를 고칩니다. 이름은 아이템 정의에서 가져옵니다.",
    fields: [
      { key: "owner", label: "회원", type: "profile", required: true },
      {
        key: "character",
        label: "캐릭터 (빈칸: 회원 인벤토리)",
        type: "character",
        optional: true,
      },
      { key: "item", label: "아이템", type: "item", required: true },
      { key: "memo", label: "지급 사유", max: 500 },
    ],
    check(data, { id, previous, references }) {
      const character = data.character
        ? references.characters.find((row) => row.id === data.character)
        : null;
      if (
        character &&
        (character.createdBy ?? character.data.owner) !== data.owner
      )
        throw new Error("선택한 회원의 캐릭터가 아닙니다.");
      const item = references.items.find((row) => row.id === data.item);
      data.name = item?.data.name;
      data.character = data.character || null;
      if (!previous) data.from = "admin";
    },
  },
  gacha: {
    label: "뽑기 표",
    help: "같은 뽑기권의 항목끼리 무게에 비례해 뽑습니다. 뽑기권을 고르지 않으면 일반 유료 뽑기입니다. 결과 아이템을 고르지 않으면 꽝입니다.",
    fields: [
      {
        key: "source",
        label: "뽑기권 아이템 (빈칸: 일반 뽑기)",
        type: "item",
        optional: true,
      },
      {
        key: "item",
        label: "결과 아이템 (빈칸: 꽝)",
        type: "item",
        optional: true,
      },
      {
        key: "weight",
        label: "무게 (0: 나오지 않음)",
        type: "decimal",
        default: 1,
      },
    ],
  },
  explore: {
    label: "탐색 표",
    help: "승인된 캐릭터가 댓글에서 탐색하면 무게에 비례해 하나를 뽑아 캐릭터 인벤토리에 넣습니다. 결과 아이템을 고르지 않으면 꽝입니다. 하루 횟수는 기본 설정에서 정합니다.",
    fields: [
      {
        key: "item",
        label: "결과 아이템 (빈칸: 꽝)",
        type: "item",
        optional: true,
      },
      {
        key: "weight",
        label: "무게 (0: 나오지 않음)",
        type: "decimal",
        default: 1,
      },
    ],
  },
  recipes: {
    label: "제작 레시피",
    help: "결과와 필요한 재료를 선택합니다. 한 제작에 재료를 최대 20개 소모합니다.",
    fields: [
      { key: "name", label: "레시피 이름", required: true, max: 80 },
      { key: "description", label: "설명", type: "textarea", max: 2000 },
      { key: "item", label: "결과 아이템", type: "item", required: true },
      { key: "cost", label: "제작 비용", type: "number", default: 0 },
      { key: "hidden", label: "숨기기", type: "checkbox" },
      {
        key: "ingredients",
        label: "필요 재료",
        type: "ingredients",
        maxCount: 20,
      },
    ],
    check(data, { id, references }) {
      // Only craft materials (adm/recipi_update.php:14-30), and no combination
      // twice (:48-51): which recipe a set of materials makes must be one.
      const unflagged = data.ingredients.find(
        (entry: Data) =>
          references.items.find((item) => item.id === entry.item)?.data
            .craftMaterial !== true,
      );
      if (unflagged)
        throw new Error(
          `${references.items.find((item) => item.id === unflagged.item)?.data.name ?? unflagged.item}은(는) 조합 재료로 사용 가능하게 설정되지 않은 아이템입니다.`,
        );
      const combination = (ingredients: unknown) =>
        (Array.isArray(ingredients) ? ingredients : [])
          .flatMap((entry) => Array(Number(entry.count) || 0).fill(entry.item))
          .sort()
          .join("||");
      const key = combination(data.ingredients);
      const same = (references.recipes ?? []).find(
        (row) => row.id !== id && combination(row.data.ingredients) === key,
      );
      if (same)
        throw new Error(
          `이미 등록된 레시피 조합입니다: ${same.data.name ?? same.id}.`,
        );
    },
  },
  history: {
    label: "전체 활동·구매 기록",
    help: "회원별 경제 활동 기록입니다. 화폐·경험치·구매기록으로 거르고 회원·캐릭터·아이템·내용으로 찾습니다. 화폐나 경험치를 바꾼 기록을 삭제하면 원본처럼 그만큼 되돌리고, 그 뒤 기록의 누계도 고칩니다.",
    readOnly: true,
    fields: [],
  },
  wallets: {
    label: "회원 잔액",
    memberKey: true,
    noDelete: true,
    help: "잔액을 변경하면 같은 트랜잭션에서 회원의 기록에 조정 사유를 남깁니다. 잔액 기록은 삭제하지 않습니다.",
    fields: [
      { key: "balance", label: "잔액", type: "number", default: 0 },
      {
        key: "lastDaily",
        label: "최근 로그인 보상일 (빈칸: 초기화)",
        type: "date",
      },
      {
        key: "note",
        label: "잔액 조정 사유",
        required: true,
        max: 500,
        transient: true,
      },
    ],
    check(data, { id, references }) {
      if (!references.profiles.some((row) => row.id === id))
        throw new Error("존재하는 회원을 선택하세요.");
    },
  },
  // adm/point_list.php (화폐 관리), exp_list.php (경험치 관리) and
  // inventory_list.php (아이템 지급): grants with a memo, to one or to
  // everyone, and the log of them.
  grants: {
    label: "아보·경험치·아이템 지급",
    help: "회원 한 명(닉네임) 또는 전체 회원(등급 1 회원 제외)에게 아보를, 캐릭터 하나(이름) 또는 승인된 전체 캐릭터에게 경험치를 주거나 깎고, 아이템을 1~100개 줍니다. 내용은 받는 사람의 기록에 남고, 가진 것보다 많이 깎지는 않습니다. 경험치로 랭킹이 바뀌면 그 랭킹의 추가 능력치 포인트도 함께 바뀝니다.",
    report: "grants",
    readOnly: true,
  },
};
