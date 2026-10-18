import { config } from "./config.js";
import { VISIT_BREAKDOWNS, koreanDay } from "./admin-reports.js";
import {
  models,
  fieldValue,
  REVIEW_STATES,
  memberSummary,
  menu,
  sectionLabel,
} from "./admin-model.js";
import {
  NAME_DEFAULTS,
  moneyText,
  namesOf,
  rename,
  type Names,
} from "./app/names.js";
import { imageSlotsOf } from "./_naru/modules/images.js";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let grantTitleId;
let naru,
  owner,
  section = "couples",
  cursor = null,
  selected = null;
// 기타 항목명 설정, from 커뮤니티 설정: the menu and labels use them.
let itemNames: Names = NAME_DEFAULTS;
// 커뮤니티 설정's 한페이지당 라인수: a new board's rows a page.
let newBoardRows = 15;
// 캐릭터 이미지 항목: the 두상, 흉상 and 전신, named as the owner set them.
let imageSlots = imageSlotsOf();
// Rows the forms pick from, by kind (admin/references; the server checks
// what is picked against its own).
let references: Record<string, any[]> = {
  fields: [],
  characters: [],
  titles: [],
  stats: [],
  items: [],
  profiles: [],
};
/**
 * Each section's owner-only queries and mutations (_naru/queries/admin/,
 * _naru/mutations/admin/): its list, one entry, saving one (checked on the
 * server as its form is) and deleting one. A section without `remove`
 * keeps its entries.
 */
/** What each kind of history entry was (전체 활동·구매 기록). */
const HISTORY_KINDS = {
  adjust: "운영자 조정",
  grant: "운영자 지급",
  daily: "첫 로그인",
  signup: "회원가입 축하",
  recommend: "추천인",
  buy: "구매",
  sell: "판매",
  gift: "선물 보냄",
  giftReceived: "선물 받음",
  moneySent: "화폐 보냄",
  craft: "제작",
  gacha: "뽑기",
  explore: "탐색",
  use: "아이템 사용",
  exp: "경험치",
  settle: "정산",
  message: "쪽지 비용",
  board: "글·댓글 보상",
};
const CALLS: Record<
  string,
  { list?: string; get?: string; save?: string; remove?: string }
> = {
  content: {
    list: "admin/content:list",
    get: "admin/content:get",
    save: "admin/content:save",
    remove: "admin/content:remove",
  },
  menus: {
    list: "admin/menus:list",
    get: "admin/menus:get",
    save: "admin/menus:save",
    remove: "admin/menus:remove",
  },
  banners: {
    list: "admin/banners:list",
    get: "admin/banners:get",
    save: "admin/banners:save",
    remove: "admin/banners:remove",
  },
  quests: {
    list: "admin/quests:list",
    get: "admin/quests:get",
    save: "admin/quests:save",
    remove: "admin/quests:remove",
  },
  emoticons: {
    list: "admin/emoticons:list",
    get: "admin/emoticons:get",
    save: "admin/emoticons:save",
    remove: "admin/emoticons:remove",
  },
  boards: {
    list: "admin/boards:list",
    get: "admin/boards:get",
    save: "admin/boards:save",
    remove: "admin/boards:remove",
  },
  board_groups: {
    list: "admin/board_groups:list",
    get: "admin/board_groups:get",
    save: "admin/board_groups:save",
    remove: "admin/board_groups:remove",
  },
  members: {
    list: "admin/members:list",
    get: "admin/members:get",
    save: "admin/members:save",
    remove: "admin/members:remove",
  },
  wallets: {
    list: "admin/wallets:list",
    get: "admin/wallets:get",
    save: "admin/wallets:save",
  },
  inventory: {
    list: "admin/inventory:list",
    get: "admin/inventory:get",
    save: "admin/inventory:save",
    remove: "admin/inventory:remove",
  },
  history: { list: "admin/history:list", remove: "admin/history:remove" },
  items: {
    list: "admin/items:list",
    get: "admin/items:get",
    save: "admin/items:save",
    remove: "admin/items:remove",
  },
  gacha: {
    list: "admin/gacha:list",
    get: "admin/gacha:get",
    save: "admin/gacha:save",
    remove: "admin/gacha:remove",
  },
  recipes: {
    list: "admin/recipes:list",
    get: "admin/recipes:get",
    save: "admin/recipes:save",
    remove: "admin/recipes:remove",
  },
  explore: {
    list: "admin/explore:list",
    get: "admin/explore:get",
    save: "admin/explore:save",
    remove: "admin/explore:remove",
  },
  sides: {
    list: "admin/sides:list",
    get: "admin/sides:get",
    save: "admin/sides:save",
    remove: "admin/sides:remove",
  },
  classes: {
    list: "admin/classes:list",
    get: "admin/classes:get",
    save: "admin/classes:save",
    remove: "admin/classes:remove",
  },
  couples: {
    list: "admin/couples:list",
    get: "admin/couples:get",
    save: "admin/couples:save",
    remove: "admin/couples:remove",
  },
  titles: {
    list: "admin/titles:list",
    get: "admin/titles:get",
    save: "admin/titles:save",
    remove: "admin/titles:remove",
  },
  character_fields: {
    list: "admin/character_fields:list",
    get: "admin/character_fields:get",
    save: "admin/character_fields:save",
    remove: "admin/character_fields:remove",
  },
  character_state: {
    list: "admin/character_state:list",
    get: "admin/character_state:get",
    save: "admin/character_state:save",
  },
  stat_config: {
    list: "admin/stat_config:list",
    get: "admin/stat_config:get",
    save: "admin/stat_config:save",
    remove: "admin/stat_config:remove",
  },
  levels: {
    list: "admin/levels:list",
    get: "admin/levels:get",
    save: "admin/levels:save",
    remove: "admin/levels:remove",
  },
  // One form each, kept as the site's settings.
  settings: { get: "admin/settings:get", save: "admin/settings:save" },
  design: { get: "admin/settings:get", save: "admin/settings:save" },
  character_images: {
    get: "admin/settings:get",
    save: "admin/settings:save",
  },
  character_review: {
    list: "admin/character_review:list",
    get: "admin/character_review:get",
  },
  title_holdings: { list: "admin/title_holdings:list" },
};
/** What the forms pick from, read again whenever one opens. */
async function loadReferences() {
  references = await owner.query("admin/references:references");
  return references;
}
function message(error) {
  // A site function's own ctx.fail message comes with a reason.
  if (error?.details?.reason) return error.message;
  return error?.code === "CONFLICT"
    ? "다른 창에서 바뀌었습니다. 다시 불러온 뒤 수정하세요."
    : error?.code === "NOT_FOUND"
      ? "자료를 찾을 수 없습니다. 삭제되었는지 확인하세요."
      : error?.code === "ACCESS_DENIED"
        ? "사이트 소유자 권한이 필요합니다."
        : error?.code === "AUTH_REQUIRED"
          ? "운영자 로그인이 끝났습니다. 다시 로그인하세요."
          : (error?.message ?? "처리하지 못했습니다.");
}
async function run(action) {
  try {
    await action();
  } catch (error) {
    $("adminStatus").textContent = message(error);
  }
}
/* -------------------------------------------------------- addresses --- */

/**
 * Every section, entry and report has an address (#/items, #/items/potion,
 * #/items/new, #/visits/2026-10-01/2026-10-07/hour), as the site's pages
 * do: it can be shared, reloaded and gone back to. Choosing a section makes
 * a history entry; opening an entry or changing a report's filters replaces
 * it.
 */
let routing = false;
function adminRoute(parts, { replace = true } = {}) {
  if (routing) return;
  const hash = `#/${parts
    .filter((part) => part !== "" && part !== null && part !== undefined)
    .map((part) => encodeURIComponent(String(part)))
    .join("/")}`;
  if (location.hash !== hash)
    history[replace ? "replaceState" : "pushState"](null, "", hash);
}
/** The address's parts, decoded. */
function addressParts() {
  return location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}
/** A report's filters, from its address when it was opened by one. */
let reportFilters = [];
/** Opens what the address names: a section, an entry in it, or a report. */
async function openAddress() {
  const [name, entry, ...filters] = addressParts();
  routing = true;
  try {
    if (name && Object.hasOwn(models, name)) {
      section = name;
    }
    renderNav();
    $("adminForm").hidden = true;
    $("characterForm").hidden = true;
    $("titleGrantForm").hidden = true;
    const model = models[section];
    reportFilters = model.report && name === section ? [entry, ...filters] : [];
    await load();
    // A settings form is opened by load(), whatever its address names.
    if (model.report || model.fixedId || name !== section || !entry) return;
    const open = model.review ? openCharacterForm : openForm;
    if (entry === "new") return open();
    if (!CALLS[section]?.get) return;
    const row = await owner.query(CALLS[section].get, { id: entry });
    if (!row) {
      $("adminStatus").textContent = "자료를 찾을 수 없습니다.";
      return;
    }
    await open(row);
  } finally {
    routing = false;
  }
}
addEventListener("hashchange", () => {
  if (owner) run(openAddress);
});

async function load({ more = false } = {}) {
  const requestedSection = section;
  const model = models[section];
  $("adminHelp").textContent = named(model.help);
  // The review registers characters too (adm/character_form.php, w='').
  $("adminNew").hidden =
    (Boolean(model.readOnly) && !model.review) || Boolean(model.noCreate);
  $("adminNew").textContent = model.review ? "새 캐릭터" : "새로 등록";
  $("adminReport").hidden = !model.report;
  $("adminRows").hidden = Boolean(model.report);
  // One document, as the original's settings pages are one form
  // (adm/community_form.php): shown at once, filled in, nothing to register.
  if (model.fixedId) {
    $("adminNew").hidden = true;
    $("adminRows").hidden = true;
    $("adminMore").hidden = true;
    $("holdingsSearchLabel").hidden = true;
    $("boardTools").hidden = true;
    $("reviewTools").hidden = true;
    $("memberSearchLabel").hidden = true;
    $("memberCounts").hidden = true;
    $("itemCategoryLabel").hidden = true;
    $("logSearch").hidden = true;
    const row = await owner.query(CALLS[section].get, { section });
    if (requestedSection === section) await openForm(row);
    return;
  }
  if (model.report) {
    $("adminMore").hidden = true;
    $("holdingsSearchLabel").hidden = true;
    $("boardTools").hidden = true;
    $("reviewTools").hidden = true;
    $("memberSearchLabel").hidden = true;
    $("memberCounts").hidden = true;
    $("itemCategoryLabel").hidden = true;
    $("logSearch").hidden = true;
    return model.report === "visits"
      ? visitsView()
      : model.report === "grants"
        ? grantsView()
        : activityView();
  }
  $("holdingsSearchLabel").hidden = !model.holdings;
  $("reviewTools").hidden = !model.review;
  $("boardTools").hidden = section !== "boards";
  $("memberSearchLabel").hidden = section !== "members";
  $("memberCounts").hidden = section !== "members";
  $("itemCategoryLabel").hidden = section !== "items";
  $("logSearch").hidden = !["history", "inventory"].includes(section);
  $("logKind").hidden = section !== "history";
  // An inventory copy has no memo of its own.
  $<HTMLOptionElement>('#logField option[value="memo"]').hidden =
    section !== "history";
  if (
    section === "inventory" &&
    $<HTMLSelectElement>("logField").value === "memo"
  )
    $<HTMLSelectElement>("logField").value = "nick";
  const after = more ? cursor : null;
  let page;
  if (model.holdings)
    // 타이틀 보유·착용 현황, found by character or title.
    page = await owner.query(CALLS[section].list, {
      search: $<HTMLInputElement>("holdingsSearch").value,
      after,
    });
  else if (section === "members")
    // 회원 관리 (adm/member_list.php): every member, found by nickname.
    page = await owner.query(CALLS[section].list, {
      search: $<HTMLInputElement>("memberSearch").value,
      after,
    });
  else if (model.review) {
    // Searched, filtered and counted by the server, as the original's list
    // does in SQL (adm/character_list.php:107-140).
    page = await owner.query(CALLS[section].list, {
      field: $<HTMLSelectElement>("reviewField").value,
      text: $<HTMLInputElement>("reviewSearch").value,
      state: review.state,
      side: $<HTMLSelectElement>("reviewSide").value,
      kind: $<HTMLSelectElement>("reviewClass").value,
      after,
    });
    references.fields = page.fields;
    reviewFilters(page);
  } else if (section === "history" || section === "inventory")
    page = await owner.query(CALLS[section].list, {
      after,
      field: $<HTMLSelectElement>("logField").value,
      text: $<HTMLInputElement>("logText").value,
      ...(section === "history"
        ? { kind: $<HTMLSelectElement>("logKind").value }
        : {}),
    });
  else if (section === "items")
    page = await owner.query(CALLS[section].list, {
      after,
      category: $<HTMLSelectElement>("itemCategory").value,
    });
  else page = await owner.query(CALLS[section].list, { after });
  if (requestedSection !== section || !owner) return;
  if (!more) $("adminRows").replaceChildren();
  if (section === "members" && page.counts)
    $("memberCounts").textContent =
      `총회원수 ${page.counts.total.toLocaleString("ko-KR")}명 중, 차단 ${page.counts.blocked.toLocaleString("ko-KR")}명, 탈퇴 ${page.counts.left.toLocaleString("ko-KR")}명`;
  if (section === "boards") await loadReferences();
  for (const row of page.documents) {
    const li = document.createElement("li");
    if (model.holdings) {
      li.append(
        `${row.character} · ${row.title}${row.active ? " · 착용 중" : ""} `,
      );
      if (typeof row.image === "string" && row.image.startsWith("https://")) {
        const image = document.createElement("img");
        image.src = row.image;
        image.alt = row.title;
        image.loading = "lazy";
        image.className = "title-image";
        li.prepend(image);
      }
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "회수";
      revoke.onclick = () =>
        run(async () => {
          revoke.disabled = true;
          try {
            await owner.mutate("admin/titles:grant", {
              title: row.titleId,
              action: "revoke",
              characters: [row.characterId],
            });
            $("adminStatus").textContent = "타이틀을 회수했습니다.";
            await load();
          } finally {
            revoke.disabled = false;
          }
        });
      li.append(revoke);
      $("adminRows").append(li);
      continue;
    }
    if (model.review) {
      li.append(reviewRow(row));
      $("adminRows").append(li);
      continue;
    }
    if (model.readOnly) {
      const who = row.ownerNick ?? row.data.owner;
      li.textContent = [
        new Date(row.data.at).toLocaleString("ko-KR"),
        row.characterName ? `${row.characterName} (${who})` : who,
        HISTORY_KINDS[row.data.kind] ?? row.data.kind,
        row.data.delta !== undefined &&
          `${row.data.delta > 0 ? "+" : ""}${moneyText(itemNames, row.data.delta)}`,
        row.data.expDelta !== undefined &&
          `${itemNames.expName} ${row.data.expDelta > 0 ? "+" : ""}${row.data.expDelta}`,
        row.data.memo,
      ]
        .filter(Boolean)
        .join(" · ");
      // exp_list_delete.php and point_list_delete.php: the entry goes, and
      // what it moved is taken back.
      if (row.data.delta !== undefined || row.data.expDelta !== undefined) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            if (
              !confirm(
                "이 기록을 지우고 기록이 바꾼 경험치·화폐를 되돌릴까요? 되돌릴 수 없습니다.",
              )
            )
              return;
            remove.disabled = true;
            try {
              await owner.mutate(CALLS.history.remove, { ids: [row.id] });
              $("adminStatus").textContent =
                "기록을 지우고 경험치·화폐를 되돌렸습니다.";
              await load();
            } finally {
              remove.disabled = false;
            }
          });
        li.append(" ", remove);
      }
      $("adminRows").append(li);
      continue;
    }
    // A character's record and a member's balance are named by their
    // character and member.
    li.append(row.data.name ?? row.label ?? row.nick ?? row.id, " ");
    if (section === "members")
      li.append(`· ${memberSummary({ row, lastSeen: row.lastSeen })} `);
    if (section === "wallets")
      li.append(`${moneyText(itemNames, row.data.balance)} `);
    if (section === "inventory")
      li.append(
        `${row.ownerNick ?? row.data.owner} · ${row.characterName ?? "회원 인벤토리"} `,
      );
    if (section === "boards") {
      li.replaceChildren(...boardRow(row));
      $("adminRows").append(li);
      continue;
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "수정";
    edit.onclick = () => run(() => openForm(row));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.hidden = Boolean(model.noDelete) || !CALLS[section].remove;
    remove.textContent = "삭제";
    remove.onclick = () =>
      run(async () => {
        if (!confirm("이 자료를 삭제할까요?")) return;
        // Its uploads stay; Naru's media library marks them 참조 없음 once no
        // row of the site's tables names them.
        const removed = await owner.mutate(CALLS[section].remove, {
          id: row.id,
        });
        // A title goes from the characters holding it too.
        if (section === "titles")
          $("adminStatus").textContent =
            `${removed.completed}명의 타이틀을 회수했습니다.`;
        await load();
      });
    li.append(edit, " ", remove);
    if (section === "members") {
      // The record's 삭제 resets it; 회원 삭제 is member_delete.php.
      remove.textContent = "기록 초기화";
      const erase = document.createElement("button");
      erase.type = "button";
      erase.textContent = "회원 삭제";
      erase.hidden = Boolean(row.deleted);
      erase.onclick = () =>
        run(async () => {
          if (
            !confirm(
              `${row.nick ?? row.id} 회원을 삭제할까요? 닉네임은 남고, 쪽지·관심로그·화폐 내역과 잔액·운영 역할을 지우며 되돌릴 수 없습니다. 글·댓글·캐릭터는 남습니다.`,
            )
          )
            return;
          await owner.mutate("admin/members:deleteMember", { id: row.id });
          $("adminStatus").textContent = "회원을 삭제했습니다.";
          await load();
        });
      li.append(" ", erase);
    }
    if (section === "titles") {
      const grant = document.createElement("button");
      grant.type = "button";
      grant.textContent = "지급·회수";
      grant.onclick = () =>
        run(async () => {
          grantTitleId = row.id;
          $("titleGrantHeading").textContent = `${row.data.name} 지급·회수`;
          $("titleGrantStatus").textContent = "";
          $("titleGrantCharacters").replaceChildren();
          for (const character of (await loadReferences()).characters) {
            const option = document.createElement("option");
            option.value = character.id;
            option.textContent = `${character.data.name} (${character.id})`;
            $("titleGrantCharacters").append(option);
          }
          $("titleGrantForm").hidden = false;
        });
      li.append(" ", grant);
    }
    $("adminRows").append(li);
  }
  cursor = page.nextCursor;
  $("adminMore").hidden = !cursor;
}
const STATES = {
  editing: "수정 중",
  submitted: "신청(수정 완료)",
  approved: "승인",
  // 선택삭제: kept, out of every list, recovered by another state.
  deleted: "삭제",
};
/** The review list's state filter. */
const review = { state: "" };
/**
 * The review's 소속 and 종족 choices (the values characters have) and its
 * state buttons with their counts (character_list.php:285-288).
 */
function reviewFilters({ sides, classes, counts }) {
  for (const [id, values, title] of [
    ["reviewSide", sides, itemNames.sideTitle || "소속"],
    ["reviewClass", classes, itemNames.classTitle || "종족"],
  ]) {
    const select = $<HTMLSelectElement>(id);
    const chosen = select.value;
    select.replaceChildren(
      new Option(`${title} 전체`, ""),
      ...values.map((value) => new Option(value, value)),
    );
    select.value = values.includes(chosen) ? chosen : "";
    select.hidden = !values.length;
  }
  $("reviewStates").replaceChildren(
    ...[["", "전체"], ...REVIEW_STATES.map((key) => [key, STATES[key]])].map(
      ([key, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${label} (${counts[key || "all"]})`;
        button.setAttribute("aria-pressed", String(review.state === key));
        button.onclick = () =>
          run(async () => {
            review.state = key;
            await load();
          });
        return button;
      },
    ),
  );
}
$("reviewTools").onsubmit = (event) => {
  event.preventDefault();
  run(() => load());
};
$("reviewSide").onchange = $("reviewClass").onchange = () => run(() => load());
$("itemCategory").onchange = () => run(() => load());
/**
 * 선택승인, 선택삭제 and 선택제거 (character_list_update.php): each chosen
 * character through the review, in turn. 선택삭제 sets 삭제, which another
 * state recovers; 선택제거 deletes it with what hangs off it, for good.
 */
function reviewChosen(
  button: string,
  verb: string,
  act: (box) => Promise<void>,
) {
  return () =>
    run(async () => {
      const chosen = [
        ...$("adminRows").querySelectorAll<HTMLInputElement>(
          ".review-select:checked",
        ),
      ];
      if (!chosen.length)
        throw new Error(`${verb} 캐릭터를 하나 이상 선택해 주세요.`);
      if (
        !confirm(
          `선택한 ${chosen.length}명을 ${verb.replace(/할$/, "할까요?")}`,
        )
      )
        return;
      $<HTMLButtonElement>(button).disabled = true;
      let done = 0;
      try {
        for (const box of chosen) {
          await act(box);
          done++;
        }
      } finally {
        $<HTMLButtonElement>(button).disabled = false;
        $("adminStatus").textContent = `${done}명을 처리했습니다.`;
        await load();
      }
    });
}
const reviewState = (state) => (box) =>
  owner.mutate("characters/review:reviewCharacter", {
    character: box.value,
    revision: box.dataset.revision,
    state,
  });
$("reviewApprove").onclick = reviewChosen(
  "reviewApprove",
  "승인할",
  reviewState("approved"),
);
$("reviewDelete").onclick = reviewChosen(
  "reviewDelete",
  "삭제할",
  reviewState("deleted"),
);
$("reviewRemove").onclick = reviewChosen(
  "reviewRemove",
  "영구히 삭제할",
  (box) => owner.mutate("characters/sheet:remove", { id: box.value }),
);
const TYPES = [
  ["main", "메인"],
  ["sub", "서브"],
  ["npc", "NPC"],
];
/** One application: its sheet with every field, the decision and admin-only values. */
function reviewRow(row) {
  const form = document.createElement("form");
  form.className = "review";
  const nick = row.nick;
  const heading = document.createElement("strong");
  heading.textContent = `${row.data.name} · ${nick} · ${STATES[row.data.state] ?? "상태 없음(이전 캐릭터)"}`;
  // Chosen for 선택 승인.
  const select = document.createElement("input");
  select.type = "checkbox";
  select.className = "review-select";
  select.value = row.id;
  select.dataset.revision = row.revision;
  select.setAttribute("aria-label", `${row.data.name} 선택`);
  // What the member wrote, as the application shows it: picture, 소속,
  // 종족 and 프로필, and the character's own page on the site.
  const summary = document.createElement("div");
  summary.className = "review-summary";
  if (
    typeof row.data.image === "string" &&
    row.data.image.startsWith("https://")
  ) {
    const portrait = document.createElement("img");
    portrait.src = row.data.image;
    portrait.alt = row.data.name ?? "";
    portrait.loading = "lazy";
    portrait.className = "review-portrait";
    summary.append(portrait);
  }
  const basics = document.createElement("dl");
  for (const [label, value] of [
    [itemNames.sideTitle || "소속", row.data.side],
    [itemNames.classTitle || "종족", row.data.class],
    ["프로필", row.data.profile],
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value || "—";
    detail.style.whiteSpace = "pre-wrap";
    basics.append(term, detail);
  }
  const page = document.createElement("a");
  page.href = `../#/character/${encodeURIComponent(row.id)}`;
  page.target = "_blank";
  page.rel = "noopener";
  page.textContent = "사이트에서 캐릭터 보기 (회원 로그인 필요)";
  summary.append(basics, page);
  const sheet = document.createElement("dl");
  // In their order already (admin/character_review).
  const definitions = references.fields;
  const adminInputs = [];
  for (const field of definitions) {
    const term = document.createElement("dt");
    term.textContent = `${field.data.label ?? field.id}${field.data.visibility === "admin" ? " (운영자만)" : field.data.visibility === "owner" ? " (오너+운영자)" : ""}`;
    const detail = document.createElement("dd");
    const value = row.data.fields?.[field.id] ?? "";
    if (field.data.visibility === "admin") {
      const input = document.createElement("input");
      input.name = field.id;
      input.value = value;
      input.maxLength = 2000;
      input.setAttribute("aria-label", field.data.label ?? field.id);
      adminInputs.push(input);
      detail.append(input);
    } else detail.textContent = value || "—";
    sheet.append(term, detail);
  }
  const type = document.createElement("select");
  type.setAttribute("aria-label", "캐릭터 종류");
  for (const [value, label] of TYPES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    type.append(option);
  }
  type.value = row.data.type ?? "main";
  const decide = (state) =>
    run(async () => {
      for (const control of form.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button,input,select"))
        control.disabled = true;
      try {
        await owner.mutate("characters/review:reviewCharacter", {
          character: row.id,
          revision: row.revision,
          type: type.value,
          ...(state ? { state } : {}),
          fields: Object.fromEntries(
            adminInputs.map((input) => [input.name, input.value]),
          ),
        });
        $("adminStatus").textContent = state
          ? `${row.data.name}: ${STATES[state]}`
          : "저장했습니다.";
        await load();
      } finally {
        for (const control of form.querySelectorAll<
          HTMLButtonElement | HTMLInputElement | HTMLSelectElement
        >("button,input,select"))
          control.disabled = false;
      }
    });
  const buttons = [
    ["approved", "승인"],
    [
      "editing",
      row.data.state === "deleted" ? "복구 (수정 중으로)" : "수정 요청",
    ],
    ["submitted", "신청 상태로"],
    ...(row.data.state === "deleted" ? [] : [["deleted", "삭제 (복구 가능)"]]),
    [null, "종류·운영자 항목 저장"],
  ].map(([state, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = () => decide(state);
    return button;
  });
  // adm/character_list.php's 수정 and 삭제, and the form's 오너아이디.
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "수정";
  edit.onclick = () => run(() => openCharacterForm(row));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "영구 삭제";
  remove.onclick = () =>
    run(async () => {
      if (
        !confirm(
          `${row.data.name}을(를) 영구히 삭제할까요? 관계·옷장·커플·공식 기록도 함께 지우며 되돌릴 수 없습니다.`,
        )
      )
        return;
      for (const control of form.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button,input,select"))
        control.disabled = true;
      try {
        await removeCharacter(row);
        $("adminStatus").textContent = `${row.data.name}을(를) 삭제했습니다.`;
        await load();
      } finally {
        for (const control of form.querySelectorAll<
          HTMLButtonElement | HTMLInputElement | HTMLSelectElement
        >("button,input,select"))
          control.disabled = false;
      }
    });
  const moveTo = document.createElement("input");
  moveTo.className = "move-nick";
  moveTo.placeholder = "닉네임";
  moveTo.maxLength = 20;
  moveTo.setAttribute("aria-label", "옮길 회원 닉네임");
  const move = document.createElement("button");
  move.type = "button";
  move.textContent = "회원 변경";
  move.onclick = () =>
    run(async () => {
      const nick = moveTo.value.trim();
      if (!nick) throw new Error("옮길 회원의 닉네임을 적어 주세요.");
      for (const control of form.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button,input,select"))
        control.disabled = true;
      try {
        // Outfits, relations and items go with it.
        await owner.mutate("characters/sheet:move", {
          id: row.id,
          nick,
          revision: row.revision,
        });
        $("adminStatus").textContent =
          `${row.data.name}을(를) ${nick}님에게 옮겼습니다.`;
        await load();
      } finally {
        for (const control of form.querySelectorAll<
          HTMLButtonElement | HTMLInputElement | HTMLSelectElement
        >("button,input,select"))
          control.disabled = false;
      }
    });
  const manage = document.createElement("div");
  manage.className = "review-manage";
  manage.append(edit, " ", remove, " ", moveTo, move);
  form.onsubmit = (event) => event.preventDefault();
  form.append(select, heading, " ", type, summary, sheet, ...buttons, manage);
  return form;
}
/**
 * Deletes a character as adm/character_delete.php does; the items it held
 * go back to their owners' own inventory.
 */
async function removeCharacter(row) {
  await owner.mutate("characters/sheet:remove", { id: row.id });
}
/**
 * The owner's full form for one character (adm/character_form.php:112-423):
 * the member it belongs to when new, state, type, 소속, 종족, name, profile,
 * picture and every custom field. Stats and points stay in 캐릭터 승인·경험치·
 * 능력치·타이틀. Image fields take a managed upload as the other forms do.
 */
async function openCharacterForm(row = null) {
  const { fields, sides, classes } = await loadReferences();
  selected = row;
  adminRoute([section, row ? row.id : "new"]);
  $("adminForm").hidden = true;
  $("characterFormTitle").textContent = row
    ? `${row.data.name} 수정`
    : "새 캐릭터";
  $("characterFormStatus").textContent = "";
  const box = $("characterFields");
  box.replaceChildren();
  const add = (text, input, image = null) => {
    const label = document.createElement("label");
    label.append(text, input);
    box.append(label);
    if (image) box.append(imageUpload(image, input.value));
    return input;
  };
  const textInput = (name, value, max) => {
    const input = document.createElement("input");
    input.name = name;
    input.value = value ?? "";
    input.maxLength = max;
    return input;
  };
  const choice = (name, value, options, empty = "선택하지 않음") => {
    const select = document.createElement("select");
    select.name = name;
    if (empty !== null) select.append(new Option(empty, ""));
    for (const [id, text] of options) select.append(new Option(text, id));
    if (value && !options.some(([id]) => id === value))
      select.append(new Option(`${value} (목록에 없음)`, value));
    select.value = value ?? "";
    return select;
  };
  if (!row) {
    const nick = add("회원 닉네임", textInput("nick", "", 20));
    nick.required = true;
  }
  add(
    "상태",
    choice("state", row?.data.state ?? "editing", Object.entries(STATES), null),
  );
  add("캐릭터 종류", choice("type", row?.data.type ?? "main", TYPES, null));
  // A pick from the owner's list; free text while it is empty.
  const listed = (name, label, rows, value) => {
    // In their order already (admin/references).
    const names = rows.map((entry) => [entry.data.name, entry.data.name]);
    add(
      label,
      names.length ? choice(name, value, names) : textInput(name, value, 40),
    );
  };
  listed("side", itemNames.sideTitle || "소속", sides, row?.data.side);
  listed("class", itemNames.classTitle || "종족", classes, row?.data.class);
  const name = add("이름", textInput("name", row?.data.name, 40));
  name.required = true;
  const profile = document.createElement("textarea");
  profile.name = "profile";
  profile.maxLength = 4000;
  profile.value = row?.data.profile ?? "";
  add("프로필", profile);
  // 두상, 흉상, 전신: the owner sets all three, used or not.
  for (const slot of imageSlots) {
    const image = textInput(slot.key, row?.data[slot.key], 2000);
    image.placeholder = "https://";
    add(`${slot.label}${slot.use ? "" : " (사용 안 함)"}`, image, {
      key: slot.key,
      image: true,
    });
  }
  for (const field of fields) {
    const value = row?.data.fields?.[field.id] ?? "";
    const label = `${field.data.label ?? field.id}${field.data.visibility === "admin" ? " (운영자만)" : field.data.visibility === "owner" ? " (오너+운영자)" : ""}`;
    const key = `field:${field.id}`;
    const type = field.data.type ?? "text";
    let input;
    if (type === "textarea") {
      input = document.createElement("textarea");
      input.name = key;
      input.maxLength = 2000;
      input.value = value;
    } else if (type === "select")
      input = choice(
        key,
        value,
        (field.data.options ?? []).map((option) => [option, option]),
        "",
      );
    else {
      input = textInput(key, value, type === "text" ? 200 : 2000);
      if (type === "url" || type === "image") input.placeholder = "https://";
    }
    add(label, input, type === "image" ? { key, image: true } : null);
  }
  $("characterForm").hidden = false;
}
$("characterForm").onsubmit = async (event) => {
  event.preventDefault();
  const button =
    $("characterForm").querySelector<HTMLButtonElement>('[type="submit"]');
  button.disabled = true;
  $("adminNav").inert = true;
  try {
    const values: Record<string, string> = {};
    for (const input of $("characterFields").querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input,select,textarea"))
      if (input.name) values[input.name] = input.value;
    for (const file of $("characterFields").querySelectorAll<HTMLInputElement>(
      "[data-upload-for]",
    )) {
      if (!file.files?.length) continue;
      $("characterFormStatus").textContent = "이미지를 올리는 중…";
      values[file.dataset.uploadFor] = (
        await owner.media.upload(file.files[0])
      ).url;
    }
    $("characterFormStatus").textContent = "";
    const fields = {};
    for (const [key, value] of Object.entries(values))
      if (key.startsWith("field:")) fields[key.slice(6)] = value;
    const row = selected;
    await owner.mutate("characters/sheet:save", {
      ...(row ? { id: row.id, revision: row.revision } : { nick: values.nick }),
      data: {
        name: values.name,
        side: values.side,
        class: values.class,
        profile: values.profile,
        image: values.image.trim(),
        head: values.head.trim(),
        body: values.body.trim(),
        type: values.type,
        state: values.state,
        fields,
      },
    });
    $("characterForm").hidden = true;
    adminRoute([section]);
    $("adminStatus").textContent = "저장했습니다.";
    await load();
  } catch (error) {
    $("characterFormStatus").textContent = message(error);
  } finally {
    button.disabled = false;
    $("adminNav").inert = false;
  }
};
$("characterCancel").onclick = () => {
  $("characterForm").hidden = true;
  adminRoute([section]);
};
/** The 글 형식 choices, as the board form names them. */
const boardKinds = () =>
  models.boards.fields.find((field) => field.key === "kind").options;
/**
 * A board in adm/board_list.php's list: chosen for 선택수정 or 선택삭제, with
 * the fields the list edits in place (그룹, 제목, 스킨 as 글 형식, and the
 * 글쓰기·댓글쓰기 rewards), 수정 for the whole form, 삭제, and 복사
 * (board_copy.php): a new ID and name, its settings alone (구조만) or with
 * its posts (구조와 데이터).
 */
function boardRow(row) {
  const select = document.createElement("input");
  select.type = "checkbox";
  select.className = "board-select";
  select.value = row.id;
  select.setAttribute("aria-label", `${row.data.name} 선택`);
  const field = (name, label, input: HTMLInputElement | HTMLSelectElement) => {
    input.name = name;
    input.dataset.board = row.id;
    input.setAttribute("aria-label", `${row.data.name} ${label}`);
    return input;
  };
  const name = field("name", "제목", document.createElement("input"));
  name.value = row.data.name ?? "";
  (name as HTMLInputElement).maxLength = 120;
  const group = field("group", "그룹", document.createElement("select"));
  group.append(
    new Option("그룹 없음", ""),
    ...(references.groups ?? []).map(
      (entry) => new Option(entry.data.name, entry.id),
    ),
  );
  group.value = row.data.group ?? "";
  const kind = field("kind", "글 형식", document.createElement("select"));
  kind.append(...boardKinds().map(([id, text]) => new Option(text, id)));
  kind.value = row.data.kind ?? "image";
  const reward = (key, label) => {
    const input = field(key, label, document.createElement("input"));
    (input as HTMLInputElement).type = "number";
    (input as HTMLInputElement).min = "0";
    input.value = String(row.data[key] ?? 0);
    input.title = label;
    return input;
  };
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "수정";
  edit.onclick = () => run(() => openForm(row));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "삭제";
  remove.onclick = () =>
    run(async () => {
      if (!confirm("이 게시판을 삭제할까요? 글은 남습니다.")) return;
      await owner.mutate(CALLS.boards.remove, { id: row.id });
      await load();
    });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "복사";
  const copyForm = document.createElement("span");
  copyForm.className = "board-copy";
  copyForm.hidden = true;
  const target = document.createElement("input");
  target.maxLength = 20;
  target.placeholder = "복사 게시판 ID";
  target.setAttribute("aria-label", "복사할 게시판 ID (영문자, 숫자, _)");
  const title = document.createElement("input");
  title.maxLength = 120;
  title.value = `[복사본] ${row.data.name ?? ""}`;
  title.setAttribute("aria-label", "복사할 게시판 제목");
  const both = document.createElement("select");
  both.setAttribute("aria-label", "복사 유형");
  both.append(new Option("구조만", ""), new Option("구조와 데이터", "data"));
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "복사하기";
  go.onclick = () =>
    run(async () => {
      go.disabled = true;
      try {
        const result = await owner.mutate("admin/boards:copy", {
          id: row.id,
          target: target.value.trim(),
          name: title.value.trim(),
          data: both.value === "data",
        });
        $("adminStatus").textContent =
          `${result.id} 게시판으로 복사했습니다${both.value === "data" ? ` (글 ${result.posts}개)` : ""}.`;
        await load();
      } finally {
        go.disabled = false;
      }
    });
  copyForm.append(target, title, both, go);
  copy.onclick = () => {
    copyForm.hidden = !copyForm.hidden;
  };
  return [
    select,
    ` ${row.id} `,
    name,
    group,
    kind,
    reward("writeReward", "글쓰기 보상"),
    reward("commentReward", "댓글쓰기 보상"),
    " ",
    edit,
    " ",
    remove,
    " ",
    copy,
    copyForm,
  ];
}
/** The boards chosen in the list. */
const chosenBoards = () =>
  [
    ...$("adminRows").querySelectorAll<HTMLInputElement>(
      ".board-select:checked",
    ),
  ].map((box) => box.value);
// 선택수정 (board_list_update.php): each chosen board's listed fields, saved
// one at a time as the form saves them.
$("boardsSave").onclick = () =>
  run(async () => {
    const chosen = chosenBoards();
    if (!chosen.length)
      throw new Error("선택수정 하실 항목을 하나 이상 체크하세요.");
    let saved = 0;
    try {
      for (const id of chosen) {
        const values: Record<string, unknown> = {};
        for (const input of $("adminRows").querySelectorAll<
          HTMLInputElement | HTMLSelectElement
        >(`[data-board="${CSS.escape(id)}"]`))
          values[input.name] =
            input.type === "number" ? Number(input.value) : input.value;
        await owner.mutate(CALLS.boards.save, { id, values });
        saved++;
      }
    } finally {
      $("adminStatus").textContent = `게시판 ${saved}개를 수정했습니다.`;
      await load();
    }
  });
// 선택삭제: the chosen boards; their posts stay.
$("boardsRemove").onclick = () =>
  run(async () => {
    const chosen = chosenBoards();
    if (!chosen.length)
      throw new Error("선택삭제 하실 항목을 하나 이상 체크하세요.");
    if (
      !confirm(`선택한 게시판 ${chosen.length}개를 삭제할까요? 글은 남습니다.`)
    )
      return;
    let removed = 0;
    try {
      for (const id of chosen) {
        await owner.mutate(CALLS.boards.remove, { id });
        removed++;
      }
    } finally {
      $("adminStatus").textContent = `게시판 ${removed}개를 삭제했습니다.`;
      await load();
    }
  });
/**
 * An ID for a new row: the section's name and four random characters, which
 * every section's ID rules accept (a lowercase letter first, then lowercase
 * letters, digits and underscores).
 */
function suggestedId(section) {
  const prefix = section.replace(/s$/, "").replace(/[^a-z0-9_]/g, "") || "id";
  const random = crypto
    .getRandomValues(new Uint32Array(1))[0]
    .toString(36)
    .padStart(4, "0")
    .slice(-4);
  return `${prefix}_${random}`;
}
async function openForm(row = null) {
  const requestedSection = section;
  await loadReferences();
  if (requestedSection !== section || !owner) return;
  selected = row;
  const model = models[section];
  adminRoute([section, row ? row.id : (model.fixedId ?? "new")]);
  $("adminFormTitle").textContent = model.fixedId
    ? sectionLabel(section, itemNames)
    : `${sectionLabel(section, itemNames).replace(/ 관리$/, "")} ${row ? "수정" : "등록"}`;
  $("adminFormStatus").textContent = "";
  $("adminFields").replaceChildren();
  const fields = [
    {
      key: "id",
      label: model.characterKey
        ? "캐릭터"
        : model.memberKey
          ? "회원"
          : "ID (등록 후 변경 불가, 미리 정해 둔 값을 바꿔도 됩니다)",
      type: model.characterKey
        ? "character"
        : model.memberKey
          ? "profile"
          : "text",
      required: true,
      // A new row gets an ID ready to use; it only has to be unique.
      ...(!row && !model.characterKey && !model.memberKey
        ? { default: suggestedId(section) }
        : {}),
    },
    ...model.fields,
  ];
  if (model.characterKey)
    for (const definition of references.stats)
      fields.push(
        {
          key: `allocated:${definition.id}`,
          label: `${definition.data.name} 배분 포인트`,
          type: "number",
          default: row?.data.stats?.[definition.id]?.allocated ?? 0,
        },
        {
          key: `damage:${definition.id}`,
          label: `${definition.data.name} 받은 피해량`,
          type: "number",
          default:
            row?.data.stats?.[definition.id]?.damage ??
            (row?.data.stats?.[definition.id]?.max ?? definition.data.initial) -
              (row?.data.stats?.[definition.id]?.current ??
                definition.data.initial),
        },
      );
  // A heading starts a part of the form; a group, a row of its fields
  // (디자인's 배경, 버튼, 테이블…), set in a fieldset of its own.
  let container = $("adminFields");
  for (const field of fields) {
    if (field.type === "heading") {
      const title = document.createElement("h3");
      title.textContent = named(field.label);
      $("adminFields").append(title);
      container = $("adminFields");
      continue;
    }
    if (field.type === "group") {
      const group = document.createElement("fieldset");
      group.className = "field-group";
      const legend = document.createElement("legend");
      legend.textContent = named(field.label);
      group.append(legend);
      $("adminFields").append(group);
      container = group;
      continue;
    }
    const value =
      field.key === "id"
        ? (row?.id ?? model.fixedId ?? field.default)
        : section === "quests" && field.key === "images"
          ? (row?.data.images?.join("\n") ?? "")
          : section === "boards" && field.key === "pageRows" && !row
            ? newBoardRows
            : (fieldValue(row?.data, field.key) ??
              (row ? field.default : (field.newDefault ?? field.default)));
    if (field.type === "ingredients") {
      const group = document.createElement("fieldset");
      group.dataset.ingredients = field.key;
      const legend = document.createElement("legend");
      legend.textContent = named(field.label);
      group.append(legend);
      const addRow = (
        entry: { item?: string; count?: number; consume?: boolean } = {},
      ) => {
        const line = document.createElement("div");
        line.className = "ingredient-row";
        const item = document.createElement("select");
        item.className = "ingredient-item";
        item.setAttribute("aria-label", "재료 아이템");
        item.required = true;
        for (const reference of references.items) {
          const option = document.createElement("option");
          option.value = reference.id;
          option.textContent = reference.data.name;
          item.append(option);
        }
        if (
          entry.item &&
          !references.items.some((reference) => reference.id === entry.item)
        ) {
          const option = document.createElement("option");
          option.value = entry.item;
          option.textContent = `${entry.item} (삭제됨: 다시 선택하세요)`;
          item.append(option);
        }
        if (entry.item) item.value = entry.item;
        const count = document.createElement("input");
        count.className = "ingredient-count";
        count.type = "number";
        count.min = "1";
        count.step = "1";
        count.value = String(entry.count ?? 1);
        count.required = true;
        count.setAttribute("aria-label", "재료 개수");
        line.append(item, count);
        if (field.consumes) {
          const consumeLabel = document.createElement("label");
          const consume = document.createElement("input");
          consume.type = "checkbox";
          consume.className = "ingredient-consume";
          consume.checked = Boolean(entry.consume);
          consumeLabel.append(consume, "소모");
          line.append(consumeLabel);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "재료 빼기";
        remove.onclick = () => line.remove();
        line.append(remove);
        group.insertBefore(line, add);
      };
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "재료 추가";
      add.onclick = () => addRow();
      group.append(add);
      for (const entry of value ?? []) addRow(entry);
      container.append(group);
      continue;
    }
    const label = document.createElement("label");
    label.textContent = named(field.label);
    // A pick from an owner's list; free text while that list is empty.
    const pickRows =
      field.type === "pick" ? (references[field.from] ?? []) : null;
    const isSelect =
      [
        "character",
        "titles",
        "item",
        "stat",
        "title",
        "choice",
        "profile",
      ].includes(field.type) ||
      (field.type === "pick" && (pickRows.length || !field.fallbackText));
    // Each member set below is one the element made for the field has.
    const input = document.createElement(
      isSelect ? "select" : field.type === "textarea" ? "textarea" : "input",
    ) as HTMLInputElement;
    input.name = field.key;
    // An image field may be filled by an upload instead; buildRecord checks.
    input.required = Boolean(field.required) && !field.image;
    if (!isSelect && field.type !== "textarea")
      input.type = ["optional-number", "decimal"].includes(field.type)
        ? "number"
        : ["tokens", "pick", "css-color"].includes(field.type)
          ? "text"
          : (field.type ?? "text");
    if (field.type === "css-color") input.placeholder = "#000000";
    if (["number", "optional-number", "decimal"].includes(field.type)) {
      input.min = "0";
      input.step = field.type === "decimal" ? "any" : "1";
    }
    if (isSelect) {
      input.multiple = field.type === "titles" || Boolean(field.multiple);
      if (field.optional) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "선택하지 않음";
        input.append(option);
      }
      const choices = pickRows
        ? pickRows.map((row) => ({
            id: field.valueBy === "name" ? row.data.name : row.id,
            data: { name: row.data.name },
          }))
        : field.options
          ? field.options.map(([id, name]) => ({
              id,
              data: { name: named(name) },
            }))
          : references[
              field.type === "character"
                ? "characters"
                : field.type === "stat"
                  ? "stats"
                  : ["title", "titles"].includes(field.type)
                    ? "titles"
                    : field.type === "profile"
                      ? "profiles"
                      : "items"
            ];
      for (const optionRow of choices) {
        const option = document.createElement("option");
        option.value = optionRow.id;
        option.textContent = optionRow.data.name ?? optionRow.data.nick;
        option.selected = input.multiple
          ? (value ?? []).includes(optionRow.id)
          : value === optionRow.id;
        input.append(option);
      }
      if (
        !input.multiple &&
        value &&
        !choices.some((optionRow) => optionRow.id === value)
      ) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value} (삭제됨: 다시 선택하세요)`;
        input.append(option);
      }
      if (!input.multiple && value !== undefined && value !== null)
        input.value = value;
    } else if (field.type === "checkbox") input.checked = Boolean(value);
    else
      input.value =
        field.type === "tokens" ? (value ?? []).join(", ") : (value ?? "");
    if (field.max) input.maxLength = field.max;
    if (field.key === "id" && (row || model.fixedId)) {
      input.value = row?.id ?? model.fixedId;
      input.disabled = true;
    }
    if (field.image) input.placeholder = "https://";
    label.append(input);
    container.append(label);
    if (field.image || field.images)
      container.append(imageUpload(field, value));
  }
  if (section === "boards") $("adminFields").append(boardApply(model));
  $("adminForm").hidden = false;
}

/**
 * board_form.php's 그룹적용 and 전체적용: the settings ticked here are
 * saved to every board of this board's group, or to every board, too.
 */
function boardApply(model) {
  const fieldset = document.createElement("fieldset");
  fieldset.id = "boardApply";
  const legend = document.createElement("legend");
  legend.textContent = "그룹적용 · 전체적용";
  const to = document.createElement("select");
  to.dataset.applyTo = "";
  to.append(
    new Option("이 게시판에만 저장", ""),
    new Option("같은 그룹의 게시판에도 적용", "group"),
    new Option("모든 게시판에도 적용", "all"),
  );
  const list = document.createElement("p");
  list.className = "apply-fields";
  for (const field of model.fields) {
    if (!field.key || ["name", "group"].includes(field.key)) continue;
    if (field.type === "heading" || field.type === "group") continue;
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.applyField = field.key;
    label.append(box, ` ${field.label}`);
    list.append(label);
  }
  fieldset.append(legend, control("적용 범위", to), list);
  return fieldset;
}

/**
 * A file picker beside an image field: saving uploads the file to Naru Media
 * and its address takes the field's place (quest images: joins the list).
 * Naru's media library searches the site's tables for each upload when it
 * opens, and marks those no row names 참조 없음 (unreferenced).
 */
function imageUpload(field, value) {
  const upload = document.createElement("label");
  upload.className = "image-upload";
  if (
    field.image &&
    typeof value === "string" &&
    value.startsWith("https://")
  ) {
    const preview = document.createElement("img");
    preview.src = value;
    preview.alt = "";
    preview.loading = "lazy";
    upload.append(preview);
  }
  upload.append(field.images ? "이미지 파일 올리기 (여러 장)" : "파일 올리기");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.multiple = Boolean(field.images);
  file.dataset.uploadFor = field.key;
  upload.append(file);
  return upload;
}
$("adminForm").onsubmit = async (event) => {
  event.preventDefault();
  const button =
    $("adminForm").querySelector<HTMLButtonElement>('[type="submit"]');
  button.disabled = true;
  $("adminNav").inert = true;
  $<HTMLButtonElement>("adminNew").disabled = true;
  try {
    const values: Record<string, any> = {};
    // Each member read below is one the control has: a select's
    // selectedOptions only where it is multiple.
    for (const input of $("adminFields").querySelectorAll<
      HTMLInputElement & Pick<HTMLSelectElement, "selectedOptions">
    >("input,select,textarea"))
      if (input.name)
        values[input.name] =
          input.type === "checkbox"
            ? input.checked
            : input.multiple
              ? [...input.selectedOptions].map((option) => option.value)
              : input.value;
    for (const group of $("adminFields").querySelectorAll<HTMLElement>(
      "[data-ingredients]",
    ))
      values[group.dataset.ingredients] = [
        ...group.querySelectorAll(".ingredient-row"),
      ].map((line) => ({
        item: line.querySelector<HTMLSelectElement>(".ingredient-item").value,
        count: line.querySelector<HTMLInputElement>(".ingredient-count").value,
        consume:
          line.querySelector<HTMLInputElement>(".ingredient-consume")
            ?.checked ?? false,
      }));
    for (const file of $("adminFields").querySelectorAll<HTMLInputElement>(
      "[data-upload-for]",
    )) {
      if (!file.files?.length) continue;
      $("adminFormStatus").textContent = "이미지를 올리는 중…";
      const urls = [];
      for (const chosen of file.files)
        urls.push((await owner.media.upload(chosen)).url);
      const key = file.dataset.uploadFor;
      values[key] = file.multiple
        ? [values[key], ...urls].filter(Boolean).join("\n")
        : urls[0];
    }
    $("adminFormStatus").textContent = "";
    // The server checks the form as buildRecord does, and refuses with its
    // message. A balance's or record's change goes into the member's
    // history in the same call; a record is saved at the version it was
    // opened at.
    selected = models[section].fixedId
      ? await owner.mutate(CALLS[section].save, { section, values })
      : await owner.mutate(CALLS[section].save, {
          id: values.id,
          values,
          create: !selected,
          ...(section === "character_state"
            ? { revision: selected?.revision ?? null }
            : {}),
          ...(section === "boards" &&
          $("adminFields").querySelector<HTMLSelectElement>("[data-apply-to]")
            ?.value
            ? {
                applyTo:
                  $("adminFields").querySelector<HTMLSelectElement>(
                    "[data-apply-to]",
                  ).value,
                applyFields: [
                  ...$("adminFields").querySelectorAll<HTMLInputElement>(
                    "[data-apply-field]:checked",
                  ),
                ].map((box) => box.dataset.applyField),
              }
            : {}),
        });
    $("adminForm").hidden = true;
    adminRoute([section]);
    $("adminStatus").textContent = "저장했습니다.";
    if (models[section].fixedId) await loadNames();
    await load();
  } catch (error) {
    $("adminFormStatus").textContent = message(error);
  } finally {
    button.disabled = false;
    $("adminNav").inert = false;
    $<HTMLButtonElement>("adminNew").disabled = false;
  }
};
$("adminCancel").onclick = () => {
  $("adminForm").hidden = true;
  adminRoute([section]);
};
$("adminNew").onclick = () =>
  run(() => (models[section].review ? openCharacterForm() : openForm()));
$("adminMore").onclick = () => run(() => load({ more: true }));
/** The owner's names, read again after 커뮤니티 설정 is saved. */
async function loadNames() {
  const settings = await owner.query(CALLS.settings.get, {
    section: "settings",
  });
  itemNames = namesOf(settings?.data);
  // cf_page_rows: a new board's 한 페이지 글 수 (bo_page_rows' default).
  const rows = settings?.data?.pageRows;
  newBoardRows =
    Number.isSafeInteger(rows) && rows >= 1 ? Math.min(rows, 100) : 15;
  const profile = await owner.query(CALLS.character_images.get, {
    section: "character_images",
  });
  imageSlots = imageSlotsOf(profile?.data);
  renderNav();
}
/** Template text in the owner's names; 커뮤니티 설정 keeps the original's. */
function named(text) {
  return section === "settings" ? text : rename(text, itemNames);
}
/**
 * The menu (adm/admin.head.php's side menu): the original's groups, the
 * current one open, the current section marked. As in the original, 소속 and
 * 종족 are left out while untitled, unless one is open.
 */
function renderNav() {
  const groups = menu.map((group) => {
    const details = document.createElement("details");
    details.open = group.sections.includes(section);
    const summary = document.createElement("summary");
    summary.textContent = group.label;
    const list = document.createElement("ul");
    for (const name of group.sections) {
      if (
        name !== section &&
        ((name === "sides" && !itemNames.sideTitle) ||
          (name === "classes" && !itemNames.classTitle))
      )
        continue;
      const link = document.createElement("a");
      link.href = `#/${name}`;
      link.textContent = sectionLabel(name, itemNames);
      if (name === section) link.setAttribute("aria-current", "page");
      const item = document.createElement("li");
      item.append(link);
      list.append(item);
    }
    details.append(summary, list);
    return details;
  });
  $("adminNav").replaceChildren(...groups);
}
$("adminSignIn").onclick = () =>
  // The site has no collections: the owner manages it through admin/'s
  // queries and mutations.
  run(() => naru.auth.signIn());
$("adminSignOut").onclick = () =>
  run(async () => {
    await owner.signOut();
    owner = null;
    $("adminWorkspace").hidden = true;
    $("adminWelcome").hidden = false;
  });
await run(async () => {
  const { createNaru } = await import("https://sdk.naru.pub/sdk/1.1.0/naru.js");
  naru = createNaru(config.site ? { site: config.site } : undefined);
  renderNav();
  owner = await naru.auth.session();
  if (!owner) return;
  $("adminWelcome").hidden = true;
  $("adminWorkspace").hidden = false;
  await loadNames();
  await openAddress();
  adminRoute([section]);
});

$("titleGrantCancel").onclick = () => {
  $("titleGrantForm").hidden = true;
};
$("titleGrantForm").onsubmit = async (event) => {
  event.preventDefault();
  const controls = [
    ...$("titleGrantForm").querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >("button,input,select"),
    $<HTMLButtonElement>("adminSignOut"),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });
  $("adminNav").inert = true;
  try {
    // One call for every character: all of it is done, or none.
    const result = await owner.mutate("admin/titles:grant", {
      title: grantTitleId,
      action: $<HTMLSelectElement>("titleGrantAction").value,
      allApproved: $<HTMLInputElement>("titleGrantAll").checked,
      characters: $<HTMLInputElement>("titleGrantAll").checked
        ? []
        : [...$<HTMLSelectElement>("titleGrantCharacters").selectedOptions].map(
            (option) => option.value,
          ),
    });
    $("titleGrantStatus").textContent =
      `${result.completed}명에게 적용했습니다.`;
  } catch (error) {
    $("titleGrantStatus").textContent = message(error);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
    $("adminNav").inert = false;
  }
};

$("holdingsFind").onclick = () => run(() => load());
$("logSearch").onsubmit = (event) => {
  event.preventDefault();
  run(() => load());
};
$("logKind").onchange = () => run(() => load());
$("memberFind").onclick = () => run(() => load());
$("memberSearch").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    run(() => load());
  }
};
$("holdingsSearch").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    run(() => load());
  }
};

/* ---------------------------------------------------------- reports --- */

/** A labelled control for a report's filter bar. */
function control(text, element) {
  const label = document.createElement("label");
  label.append(text, element);
  return label;
}
function dateInput(value) {
  const input = document.createElement("input");
  input.type = "date";
  input.value = value;
  return input;
}
/** A plain table of `rows` under `headings`. */
function table(headings, rows) {
  const element = document.createElement("table");
  element.className = "report";
  const head = element.createTHead().insertRow();
  for (const heading of headings) {
    const cell = document.createElement("th");
    cell.textContent = heading;
    head.append(cell);
  }
  const body = element.createTBody();
  for (const cells of rows) {
    const row = body.insertRow();
    for (const value of cells) {
      const cell = row.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = String(value);
    }
  }
  if (!rows.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = headings.length;
    cell.textContent = "자료가 없습니다.";
  }
  return element;
}
// Declared as functions so they exist when the page opens a report by its
// address, which happens before the module reaches this point.
function today() {
  return koreanDay(Date.now());
}
function daysAgo(days) {
  return koreanDay(Date.now() - days * 24 * 3600 * 1000);
}

/** 접속자 집계 (adm/visit_list.php and its tabs), and deleting old days. */
function visitsView() {
  const [fromDay, toDay, breakdown] = reportFilters;
  const day = (value, fallback) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : fallback;
  const from = dateInput(day(fromDay, daysAgo(6)));
  const to = dateInput(day(toDay, today()));
  const by = document.createElement("select");
  for (const [value, text] of VISIT_BREAKDOWNS)
    by.append(new Option(text, value));
  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "보기";
  const prune = document.createElement("button");
  prune.type = "button";
  prune.textContent = "시작일 이전 기록 삭제";
  const output = document.createElement("div");
  if (VISIT_BREAKDOWNS.some(([value]) => value === breakdown))
    by.value = breakdown;
  const draw = async () => {
    adminRoute(["visits", from.value, to.value, by.value]);
    const report = await owner.query("admin/visits:report", {
      from: from.value,
      to: to.value,
      by: by.value,
    });
    const top = Math.max(1, ...report.rows.map((row) => row.count));
    const bar = (count) => {
      const meter = document.createElement("meter");
      meter.max = top;
      meter.value = count;
      return meter;
    };
    const summary = document.createElement("p");
    summary.textContent = `접속 ${report.total}회 · 회원 ${report.members}명 · 손님 접속 ${report.guests}회`;
    output.replaceChildren(
      summary,
      table(
        ["구분", "접속 수", ""],
        report.rows.map((row) => [row.label, row.count, bar(row.count)]),
      ),
    );
  };
  show.onclick = () => run(draw);
  prune.onclick = () =>
    run(async () => {
      if (!from.value) return;
      const { older } = await owner.query("admin/visits:report", {
        from: from.value,
        to: to.value,
        by: by.value,
      });
      if (!older) {
        $("adminStatus").textContent = "지울 기록이 없습니다.";
        return;
      }
      if (!confirm(`${from.value} 이전 ${older}일의 접속 기록을 지울까요?`))
        return;
      const { deleted } = await owner.mutate("admin/visits:prune", {
        before: from.value,
      });
      $("adminStatus").textContent = `${deleted}일의 접속 기록을 지웠습니다.`;
      await draw();
    });
  const bar = document.createElement("div");
  bar.className = "report-filters";
  bar.append(
    control("시작일", from),
    control("종료일", to),
    control("보기", by),
    show,
    prune,
  );
  $("adminReport").replaceChildren(bar, output);
  return draw();
}

/** 활동량 관리 (adm/action_list.php): counts per member, warnings editable. */
async function activityView() {
  const { boards } = await loadReferences();
  const board = document.createElement("select");
  board.append(
    new Option("모든 게시판", ""),
    ...boards.map((row) => new Option(row.data.name, row.id)),
  );
  const [chosen, fromDay, toDay] = reportFilters.map((value) =>
    value === "all" ? "" : value,
  );
  const day = (value, fallback) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : fallback;
  if ([...board.options].some((option) => option.value === chosen))
    board.value = chosen;
  const from = dateInput(day(fromDay, daysAgo(29)));
  const to = dateInput(day(toDay, today()));
  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "보기";
  const output = document.createElement("div");
  // 100 members a page, 더 보기 for the next, each after the last one read.
  let rows = [];
  let cursor = null;
  const draw = async ({ more = false } = {}) => {
    // "all" stands for every board, which has no ID of its own.
    adminRoute(["activity", board.value || "all", from.value, to.value]);
    // Counted by the server's SQL.
    const page = await owner.query("admin/activity:report", {
      board: board.value,
      from: from.value,
      to: to.value,
      after: more ? cursor : null,
    });
    rows = more ? [...rows, ...page.rows] : page.rows;
    cursor = page.nextCursor;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "더 보기";
    next.hidden = !cursor;
    next.onclick = () => run(() => draw({ more: true }));
    output.replaceChildren(
      table(
        [
          "닉네임",
          "대표 캐릭터",
          "로그",
          "댓글",
          "최종 접속",
          "누적 경고",
          "경고 내용",
          "",
        ],
        rows.map((row) => {
          const warnings = document.createElement("input");
          warnings.type = "number";
          warnings.min = "0";
          warnings.value = String(row.warnings);
          const note = document.createElement("input");
          note.maxLength = 1000;
          note.value = row.warningNote;
          const save = document.createElement("button");
          save.type = "button";
          save.textContent = "저장";
          save.onclick = () =>
            run(async () => {
              const count = Number(warnings.value);
              if (!Number.isSafeInteger(count) || count < 0)
                throw new Error("누적 경고는 0 이상의 정수입니다.");
              // The warnings alone: the member's other settings stay.
              await owner.mutate(CALLS.members.save, {
                id: row.id,
                values: { warnings: count, warningNote: note.value.trim() },
                create: !row.member,
              });
              $("adminStatus").textContent =
                `${row.nick}의 경고를 저장했습니다.`;
              await draw();
            });
          return [
            row.nick,
            row.mainCharacter,
            row.logs,
            row.comments,
            row.lastSeen ? new Date(row.lastSeen).toLocaleString("ko-KR") : "",
            warnings,
            note,
            save,
          ];
        }),
      ),
      next,
    );
  };
  show.onclick = () => run(() => draw());
  const bar = document.createElement("div");
  bar.className = "report-filters";
  bar.append(
    control("게시판", board),
    control("시작일", from),
    control("종료일", to),
    show,
  );
  $("adminReport").replaceChildren(bar, output);
  return draw();
}

/* ----------------------------------------------------------- grants --- */

/**
 * 아보·경험치·아이템 지급 (adm/point_list.php, exp_list.php,
 * inventory_list.php): the form, one call for all its recipients, and the
 * last grants.
 */
async function grantsView() {
  const report = $("adminReport");
  const form = document.createElement("form");
  form.className = "card grant-form";
  const kind = document.createElement("select");
  kind.append(
    new Option(itemNames.moneyName, "money"),
    new Option(itemNames.expName, "exp"),
    new Option("아이템", "item"),
  );
  // The items to give, and the names the log shows.
  const { items } = await loadReferences();
  const item = document.createElement("select");
  item.append(
    ...items.map((row) => new Option(row.data.name ?? row.id, row.id)),
  );
  const target = document.createElement("select");
  target.append(new Option("개별 지급", "one"), new Option("전체 지급", "all"));
  const name = document.createElement("input");
  name.maxLength = 40;
  const value = document.createElement("input");
  value.type = "number";
  value.step = "1";
  value.required = true;
  const memo = document.createElement("input");
  memo.maxLength = 200;
  const nameLabel = control("", name);
  const itemLabel = control("아이템", item);
  const valueLabel = control("", value);
  const describe = () => {
    nameLabel.firstChild.textContent =
      kind.value === "money" ? "회원 닉네임" : "캐릭터 이름";
    nameLabel.hidden = target.value === "all";
    name.required = target.value === "one";
    itemLabel.hidden = kind.value !== "item";
    item.required = kind.value === "item";
    valueLabel.firstChild.textContent =
      kind.value === "item" ? "개수 (1~100)" : "양 (깎으려면 음수)";
  };
  kind.onchange = target.onchange = describe;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "지급";
  form.append(
    control("종류", kind),
    control("지급 유형", target),
    nameLabel,
    itemLabel,
    valueLabel,
    control("내용", memo),
    submit,
    status,
  );
  describe();
  const log = document.createElement("ul");
  log.className = "grant-log";
  const showLog = async () => {
    const page = await owner.query(CALLS.history.list, {
      actor: "grant",
      size: 20,
    });
    log.replaceChildren(
      ...page.documents.map((row) => {
        const item = document.createElement("li");
        const who =
          references.profiles.find((profile) => profile.id === row.data.owner)
            ?.data.nick ?? row.data.owner;
        const character = row.data.character
          ? references.characters.find(
              (entry) => entry.id === row.data.character,
            )?.data.name
          : null;
        item.textContent = `${new Date(row.data.at).toLocaleString("ko-KR")} · ${character ? `${character} (${who})` : who} · ${
          row.data.kind === "exp"
            ? `${itemNames.expName} ${row.data.expDelta > 0 ? "+" : ""}${row.data.expDelta}`
            : row.data.kind === "grant"
              ? `${row.data.name} ${row.data.count}개`
              : `${row.data.delta > 0 ? "+" : ""}${moneyText(itemNames, row.data.delta)}`
        }${row.data.memo ? ` · ${row.data.memo}` : ""}`;
        return item;
      }),
    );
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const amount = Number(value.value);
      if (!Number.isSafeInteger(amount) || amount === 0)
        return (status.textContent = "0이 아닌 정수를 입력하세요.");
      if (kind.value === "item" && (amount < 1 || amount > 100))
        return (status.textContent = "아이템은 1~100개 지급할 수 있습니다.");
      if (
        target.value === "all" &&
        !confirm(
          `전체 ${kind.value === "money" ? "회원" : "승인된 캐릭터"}에게 ${
            kind.value === "item"
              ? `${item.selectedOptions[0]?.textContent} ${amount}개를`
              : `${amount}만큼`
          } 지급할까요?`,
        )
      )
        return;
      submit.disabled = true;
      try {
        // One call gives to everyone it names.
        const { granted, skipped } = await owner.mutate(
          "economy/grants:grant",
          {
            kind: kind.value,
            target: target.value,
            name: name.value.trim(),
            value: amount,
            memo: memo.value.trim(),
            ...(kind.value === "item" ? { item: item.value } : {}),
          },
        );
        status.textContent = `${granted}명 지급${skipped ? `, ${skipped}명은 가진 것보다 많이 깎을 수 없어 건너뜀` : ""}. 끝났습니다.`;
        await showLog();
      } finally {
        submit.disabled = false;
      }
    });
  };
  const heading = document.createElement("h3");
  heading.textContent = "최근 지급 기록";
  report.replaceChildren(form, heading, log);
  await showLog();
}
