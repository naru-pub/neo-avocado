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
export const QUICK: Record<string, [string, string, string][]> = {
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
  for (const [key, label, kind] of QUICK[section]) {
    const input = document.createElement("input");
    input.dataset.key = key;
    input.setAttribute("aria-label", label);
    if (kind === "checkbox") input.type = "checkbox";
    else if (kind === "number") {
      input.type = "number";
      input.step = "1";
      input.className = "quick-number";
    }
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
        "input[data-key]",
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
  $("quickTools").hidden = !Object.hasOwn(QUICK, section);
  $("recordSearch").hidden =
    Boolean(model.holdings || model.review) ||
    ["members", "history", "inventory", "items", "wallets"].includes(section);
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
  else
    page = await owner.query(CALLS[section].list, {
      section,
      after,
      search: $<HTMLInputElement>("recordText").value,
    });
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
    else li.append(row.data.name ?? row.label ?? row.nick ?? row.id, " ");
    if (section === "members") {
      const pick = document.createElement("input");
      pick.type = "checkbox";
      pick.dataset.member = row.id;
      pick.dataset.nick = row.nick ?? row.id;
      pick.setAttribute("aria-label", `${row.nick ?? row.id} 선택`);
      li.prepend(pick, " ");
      li.append(`· ${memberSummary({ row, lastSeen: row.lastSeen })} `);
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
    if (section === "shop_entries")
      li.append(
        `· ${row.data.item} · ${row.data.shopCategory || "첫 분류"} · ${moneyText(itemNames, row.data.price ?? 0)}${row.data.enabled === false ? " · 진열 안 함" : ""} `,
      );
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
