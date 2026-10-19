// A section's list (load): its entries a page at a time, the smaller lists
// edited in place (선택수정), and its search and filters.
import { models, memberSummary } from "./forms.js";
import { moneyText } from "../app/names.js";
import {
  $,
  CALLS,
  cursor,
  grantTitleId,
  itemNames,
  loadReferences,
  named,
  owner,
  references,
  run,
  section,
  setCursor,
  setGrantTitleId,
} from "./core.js";
import { openForm } from "./editor.js";
import { activityView, mainView, visitsView } from "./views.js";
import { backupView, grantsView } from "./tools.js";
import { review, reviewFilters, reviewRow } from "./characters.js";
import { boardRow, groupMembers } from "./boards.js";

/**
 * Each section's owner-only queries and mutations (_naru/queries/admin/,
 * _naru/mutations/admin/): its list, one entry, saving one (checked on the
 * server as its form is) and deleting one. A section without `remove`
 * keeps its entries.
 */
/**
 * The fields the smaller lists edit in place (title_list.php's ti_title and
 * ti_use, level_list's lv_name, lv_exp and lv_add_state, side_list and
 * class_list's name and 권한, recipi_list's name and use, status_list's
 * fields), each [key, label, kind].
 */
export const QUICK: Record<
  string,
  [string, string, string, [string, string][]?][]
> = {
  // item_list_update.php: 분류, 이름, 되팔기 and what it may do.
  items: [
    ["name", "이름", "text"],
    [
      "category",
      "분류",
      "select",
      [
        ["general", "일반"],
        ["personal", "개인"],
        ["attendance", "출석"],
      ],
    ],
    ["sellPrice", "되팔기", "number"],
    ["sellable", "판매", "checkbox"],
    ["giftable", "선물", "checkbox"],
    ["usable", "사용", "checkbox"],
  ],
  // shop_list_update.php: 분류, 가격, 재고 and 순서.
  shop_entries: [
    ["shopCategory", "분류", "text"],
    ["price", "가격", "number"],
    ["stock", "재고", "number"],
    ["order", "순서", "number"],
    ["enabled", "진열", "checkbox"],
  ],
  // explorer_list_update.php: each row's chance.
  gacha: [["weight", "가중치", "number"]],
  explore: [["weight", "가중치", "number"]],
  // quest_list_update.php: 종류, 세력, 이름 and 기간.
  quests: [
    ["name", "이름", "text"],
    [
      "type",
      "종류",
      "select",
      [
        ["daily", "일일"],
        ["weekly", "주간"],
      ],
    ],
    ["side", "소속", "text"],
    ["startsAt", "시작", "datetime-local"],
    ["endsAt", "종료", "datetime-local"],
  ],
  // boardgroup_list_update.php: 제목 and 순서.
  board_groups: [
    ["name", "이름", "text"],
    ["membersOnly", "멤버 전용", "checkbox"],
    ["order", "순서", "number"],
  ],
  titles: [
    ["name", "이름", "text"],
    ["enabled", "사용", "checkbox"],
  ],
  levels: [
    ["name", "이름", "text"],
    ["exp", "필요 경험치", "number"],
    ["bonusPoints", "추가 포인트", "number"],
  ],
  sides: [
    ["name", "이름", "text"],
    ["level", "권한", "number"],
    ["order", "순서", "number"],
  ],
  classes: [
    ["name", "이름", "text"],
    ["level", "권한", "number"],
    ["order", "순서", "number"],
  ],
  recipes: [
    ["name", "이름", "text"],
    ["hidden", "숨김", "checkbox"],
  ],
  stat_config: [
    ["name", "이름", "text"],
    ["max", "최대값", "number"],
    ["min", "최소값", "number"],
    ["order", "순서", "number"],
    ["useMax", "최대값 기준", "checkbox"],
  ],
};
/** One list row's in-place fields, and its 선택 box. */
export function quickFields(row) {
  const box = document.createElement("span");
  box.className = "quick-fields";
  const pick = document.createElement("input");
  pick.type = "checkbox";
  pick.dataset.quick = row.id;
  pick.setAttribute("aria-label", `${row.data.name ?? row.id} 선택`);
  box.append(pick, " ");
  for (const [key, label, kind, options] of QUICK[section]) {
    const input = document.createElement(
      kind === "select" ? "select" : "input",
    ) as HTMLInputElement;
    input.dataset.key = key;
    input.dataset.kind = kind;
    input.setAttribute("aria-label", label);
    for (const [value, text] of options ?? [])
      input.append(new Option(text, value));
    if (kind === "checkbox") input.type = "checkbox";
    else if (kind === "number") {
      input.type = "number";
      input.step = "any";
      input.className = "quick-number";
    } else if (kind === "datetime-local") input.type = "datetime-local";
    if (kind === "checkbox") input.checked = Boolean(row.data[key]);
    else input.value = row.data[key] ?? "";
    // Changing a row ticks it, as the original's forms do.
    input.oninput = input.onchange = () => (pick.checked = true);
    box.append(kind === "checkbox" ? `${label} ` : "", input, " ");
  }
  return box;
}
$("quickSave").onclick = () =>
  run(async () => {
    const rows = [
      ...$("adminRows").querySelectorAll<HTMLInputElement>(
        "input[data-quick]:checked",
      ),
    ];
    if (!rows.length)
      return ($("adminStatus").textContent =
        "선택수정 하실 항목을 하나 이상 선택하세요.");
    for (const pick of rows) {
      const values = {};
      for (const input of pick.parentElement.querySelectorAll<HTMLInputElement>(
        "[data-key]",
      ))
        values[input.dataset.key] =
          input.type === "checkbox" ? input.checked : input.value;
      await owner.mutate(CALLS[section].save, {
        section,
        id: pick.dataset.quick,
        values,
      });
    }
    $("adminStatus").textContent = `${rows.length}개를 수정했습니다.`;
    await load();
  });
/**
 * Whether the open list deletes several at once (the lists' 선택삭제):
 * those with a delete, but the boards', members' and characters' own tools.
 */
export function bulkRemovable() {
  const model = models[section];
  return (
    section === "history" ||
    Boolean(model?.holdings) ||
    (Boolean(CALLS[section]?.remove) &&
      !model?.noDelete &&
      !model?.review &&
      !["boards", "members"].includes(section))
  );
}
/** A row's 선택 box, as the 선택수정 rows have theirs. */
function pickBox(id: string, name: string, data: Record<string, string> = {}) {
  const pick = document.createElement("input");
  pick.type = "checkbox";
  pick.dataset.quick = id;
  Object.assign(pick.dataset, data);
  pick.setAttribute("aria-label", `${name} 선택`);
  return pick;
}
/** The day and time a list shows, from a stored 한국 시간 or a moment. */
const when = (value) =>
  value
    ? typeof value === "number"
      ? new Date(value).toLocaleString("ko-KR")
      : String(value).replace("T", " ")
    : "";
/**
 * What the original's lists show in their columns, past an entry's name:
 * banner_list.php's place, 대체 문구, 기간 and 순서; couple_list.php's two
 * characters; explorer_list.php's items and chance; quest_list.php's 종류,
 * 세력 and 기간; shop_list.php's item.
 */
function rowSummary(row) {
  const data = row.data;
  const parts: (string | Node)[] = [];
  const thumb = (url) => {
    if (typeof url !== "string" || !url.startsWith("https://")) return;
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.loading = "lazy";
    image.className = "title-image";
    parts.push(image);
  };
  const period = () =>
    data.startsAt || data.endsAt
      ? `${when(data.startsAt)} ~ ${when(data.endsAt)}`
      : "기간 없음";
  if (section === "banners") {
    thumb(data.image);
    parts.push(
      [
        data.place === "intro" ? "인트로" : "메인 슬라이드",
        data.alt,
        period(),
        `순서 ${data.order ?? 0}`,
        data.enabled === false && "사용 안 함",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  } else if (section === "couples")
    parts.push(
      `${data.firstName || data.first} ♥ ${data.secondName || data.second} · ${data.since ?? ""} · 순서 ${data.order ?? 0}`,
    );
  else if (section === "gacha")
    parts.push(
      `${data.sourceName || data.source || "탐색"} → ${data.itemName || "꽝"} (${data.weight})`,
    );
  else if (section === "explore")
    parts.push(`${data.itemName || "꽝"} (${data.weight})`);
  else if (section === "quests") {
    thumb(data.images?.[0]);
    if (!Object.hasOwn(QUICK, section))
      parts.push(
        `${data.type === "weekly" ? "주간" : "일일"} · ${data.side || "공통"} · ${period()}`,
      );
  } else if (section === "shop_entries")
    parts.push(`· ${data.itemName || data.item}`);
  if (!parts.length) return null;
  const span = document.createElement("span");
  span.className = "row-summary";
  span.append(...parts);
  return span;
}
/**
 * The list's 정렬 (subject_sort_link's columns) and its filter: quest_list's
 * 세력, and main slides apart from the intro (banner_list, intro_list).
 */
const SORTS: Record<string, [string, string][]> = {
  banners: [
    ["startsAt", "시작"],
    ["endsAt", "종료"],
  ],
  couples: [["since", "날짜"]],
  quests: [
    ["name", "이름"],
    ["startsAt", "시작"],
    ["endsAt", "종료"],
  ],
  shop_entries: [["price", "가격"]],
  gacha: [["weight", "가중치"]],
  explore: [["weight", "가중치"]],
  content: [["name", "이름"]],
  menus: [["name", "이름"]],
  emoticons: [["name", "이름"]],
  sides: [["name", "이름"]],
  classes: [["name", "이름"]],
  recipes: [["name", "이름"]],
  levels: [["exp", "필요 경험치"]],
  popups: [["startsAt", "시작"]],
  polls: [["createdAt", "만든 때"]],
};
let choicesFor = null;
async function showListChoices() {
  if (choicesFor === section) return;
  choicesFor = section;
  const sort = $<HTMLSelectElement>("recordSort");
  sort.replaceChildren(new Option("기본 순서", ""));
  for (const [key, label] of SORTS[section] ?? []) {
    sort.append(new Option(`${label} ↑`, `${key}:asc`));
    sort.append(new Option(`${label} ↓`, `${key}:desc`));
  }
  sort.hidden = !(SORTS[section] ?? []).length;
  const filter = $<HTMLSelectElement>("recordFilter");
  filter.replaceChildren();
  filter.hidden = true;
  if (section === "banners") {
    filter.dataset.field = "place";
    filter.append(
      new Option("메인 슬라이드·인트로", ""),
      new Option("메인 슬라이드", "main"),
      new Option("인트로", "intro"),
    );
    filter.hidden = false;
  } else if (section === "quests") {
    filter.dataset.field = "side";
    filter.append(new Option("모든 세력", ""));
    const sides = await owner.query(CALLS.sides.list, { section: "sides" });
    for (const side of sides.documents)
      filter.append(new Option(side.data.name, side.data.name));
    filter.hidden = !sides.documents.length;
  }
}
$("recordSort").onchange = $("recordFilter").onchange = () => run(() => load());
// The lists' 선택삭제: each chosen entry as its own 삭제 would, the history's
// 20 a call (exp_list_delete.php, point_list_delete.php), title holdings
// taken back by title (title_has_list_delete.php).
$("quickRemove").onclick = () =>
  run(async () => {
    const picks = [
      ...$("adminRows").querySelectorAll<HTMLInputElement>(
        "input[data-quick]:checked",
      ),
    ];
    if (!picks.length)
      return ($("adminStatus").textContent =
        "선택삭제 하실 항목을 하나 이상 선택하세요.");
    if (!confirm(`선택한 ${picks.length}개를 삭제할까요? 되돌릴 수 없습니다.`))
      return;
    const ids = picks.map((pick) => pick.dataset.quick);
    if (section === "history")
      for (let at = 0; at < ids.length; at += 20)
        await owner.mutate(CALLS.history.remove, {
          ids: ids.slice(at, at + 20),
        });
    else if (models[section].holdings) {
      const byTitle = new Map<string, string[]>();
      for (const pick of picks)
        byTitle.set(pick.dataset.title, [
          ...(byTitle.get(pick.dataset.title) ?? []),
          pick.dataset.quick,
        ]);
      for (const [title, characters] of byTitle)
        await owner.mutate("admin/titles:grant", {
          title,
          action: "revoke",
          characters,
        });
    } else
      for (const id of ids)
        await owner.mutate(CALLS[section].remove, { section, id });
    $("adminStatus").textContent = `${ids.length}개를 삭제했습니다.`;
    await load();
  });
/** What each kind of history entry was (전체 활동·구매 기록). */
export const HISTORY_KINDS = {
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
  read: "글읽기",
  board: "글·댓글 보상",
};

export async function load({ more = false } = {}) {
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
    $("memberTools").hidden = true;
    $("itemCategoryLabel").hidden = true;
    $("logSearch").hidden = true;
    $("recordSearch").hidden = true;
    $("quickTools").hidden = true;
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
    $("memberTools").hidden = true;
    $("itemCategoryLabel").hidden = true;
    $("logSearch").hidden = true;
    $("recordSearch").hidden = true;
    $("quickTools").hidden = true;
    return model.report === "main"
      ? mainView()
      : model.report === "visits"
        ? visitsView()
        : model.report === "grants"
          ? grantsView()
          : model.report === "backup"
            ? backupView()
            : activityView();
  }
  $("holdingsSearchLabel").hidden = !model.holdings;
  $("reviewTools").hidden = !model.review;
  $("boardTools").hidden = section !== "boards";
  $("memberSearchLabel").hidden = section !== "members";
  $("memberCounts").hidden = section !== "members";
  $("memberTools").hidden = section !== "members";
  $("itemCategoryLabel").hidden = section !== "items";
  $("logSearch").hidden = !["history", "inventory"].includes(section);
  $("quickTools").hidden = !Object.hasOwn(QUICK, section) && !bulkRemovable();
  $("quickSave").hidden = !Object.hasOwn(QUICK, section);
  $("quickRemove").hidden = !bulkRemovable();
  $("recordSearch").hidden =
    Boolean(model.holdings || model.review) ||
    ["members", "history", "inventory", "items", "wallets"].includes(section);
  await showListChoices();
  $("logKind").hidden = section !== "history";
  // An inventory copy has no memo of its own.
  document.querySelector<HTMLOptionElement>(
    '#logField option[value="memo"]',
  ).hidden = section !== "history";
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
      section,
      search: $<HTMLInputElement>("holdingsSearch").value,
      after,
    });
  else if (section === "members")
    // 회원 관리 (adm/member_list.php): every member, found by nickname.
    page = await owner.query(CALLS[section].list, {
      section,
      search: $<HTMLInputElement>("memberSearch").value,
      field: $<HTMLSelectElement>("memberField").value,
      sort: $<HTMLSelectElement>("memberSort").value,
      after,
    });
  else if (model.review) {
    // Searched, filtered and counted by the server, as the original's list
    // does in SQL (adm/character_list.php:107-140).
    page = await owner.query(CALLS[section].list, {
      section,
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
      section,
      after,
      field: $<HTMLSelectElement>("logField").value,
      text: $<HTMLInputElement>("logText").value,
      ...(section === "history"
        ? { kind: $<HTMLSelectElement>("logKind").value }
        : {}),
    });
  else if (section === "items")
    page = await owner.query(CALLS[section].list, {
      section,
      after,
      category: $<HTMLSelectElement>("itemCategory").value,
      effect: $<HTMLSelectElement>("itemEffect").value,
      search: $<HTMLInputElement>("itemSearch").value,
    });
  else {
    const [sort, order] = $<HTMLSelectElement>("recordSort").value.split(":");
    const filter = $<HTMLSelectElement>("recordFilter");
    page = await owner.query(CALLS[section].list, {
      section,
      after,
      search: $<HTMLInputElement>("recordText").value,
      ...(sort ? { sort, desc: order === "desc" } : {}),
      ...(!filter.hidden && filter.value
        ? { filter: { field: filter.dataset.field, value: filter.value } }
        : {}),
    });
  }
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
      // title_has_list.php's 선택삭제 (회수).
      li.prepend(
        pickBox(`${row.characterId}`, `${row.character} · ${row.title}`, {
          title: row.titleId,
        }),
        " ",
      );
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "회수";
      revoke.className = "danger";
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
        // exp_list.php and point_list.php's 선택삭제.
        li.prepend(pickBox(row.id, "이 기록"), " ");
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.className = "danger";
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
    // character and member; the smaller lists edit in place.
    if (Object.hasOwn(QUICK, section))
      li.append(`${row.id} `, quickFields(row));
    else {
      // The lists' 선택삭제 (chk[]).
      if (bulkRemovable() && section !== "members")
        li.append(pickBox(row.id, row.data.name ?? row.id), " ");
      li.append(row.data.name ?? row.label ?? row.nick ?? row.id, " ");
    }
    // What the original's list shows in its columns.
    const summary = rowSummary(row);
    if (summary) li.append(summary, " ");
    if (section === "members") {
      const pick = document.createElement("input");
      pick.type = "checkbox";
      pick.dataset.member = row.id;
      pick.dataset.nick = row.nick ?? row.id;
      pick.setAttribute("aria-label", `${row.nick ?? row.id} 선택`);
      li.prepend(pick, " ");
      li.append(
        `· ${memberSummary({ row, lastSeen: row.lastSeen, joinedAt: row.joinedAt })} `,
      );
      // 보유캐릭터 (member_list.php:175-190), each opening its record.
      if (row.characters?.length) {
        li.append("· 보유캐릭터 ");
        for (const [n, character] of row.characters.entries()) {
          const link = document.createElement("a");
          link.href = `../character/${character.id}`;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = character.name;
          li.append(...(n ? [", "] : []), link);
        }
        li.append(" ");
      }
    }
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
    remove.className = "danger";
    remove.onclick = () =>
      run(async () => {
        if (!confirm("이 자료를 삭제할까요?")) return;
        // Its uploads stay; Naru's media library marks them 참조 없음 once no
        // row of the site's tables names them.
        const removed = await owner.mutate(CALLS[section].remove, {
          section,
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
    if (section === "board_groups") {
      // adm/boardgroupmember_list.php: the group's 접근회원.
      const people = document.createElement("button");
      people.type = "button";
      people.textContent = "접근회원";
      people.onclick = () =>
        run(async () => {
          const open = li.querySelector(".group-members");
          if (open) return open.remove();
          li.append(await groupMembers(row));
        });
      li.append(" ", people);
    }
    if (section === "titles") {
      const grant = document.createElement("button");
      grant.type = "button";
      grant.textContent = "지급·회수";
      grant.onclick = () =>
        run(async () => {
          setGrantTitleId(row.id);
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
  setCursor(page.nextCursor);
  $("adminMore").hidden = !cursor;
}
$("reviewTools").onsubmit = (event) => {
  event.preventDefault();
  run(() => load());
};
$("reviewSide").onchange = $("reviewClass").onchange = () => run(() => load());
$("itemCategory").onchange = () => run(() => load());
$("itemEffect").onchange = () => run(() => load());
$("itemFind").onclick = () => run(() => load());
$("itemSearch").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    run(() => load());
  }
};

$("holdingsFind").onclick = () => run(() => load());
$("logSearch").onsubmit = (event) => {
  event.preventDefault();
  run(() => load());
};
$("logKind").onchange = () => run(() => load());
$("recordSearch").onsubmit = (event) => {
  event.preventDefault();
  run(() => load());
};
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

// member_list.php sorts by a column (sst, sod).
$("memberSort").onchange = () => run(() => load());
