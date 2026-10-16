import { applyTitles, deleteTitle } from "./admin-titles.js";
import { resumeCleanup } from "./admin-cleanup.js";
import { withTables } from "./admin-tables.js";
import { config } from "./config.js";
import {
  VISIT_BREAKDOWNS,
  activityReport,
  koreanDay,
  visitReport,
} from "./admin-reports.js";
import {
  models,
  scopes,
  buildRecord,
  fieldValue,
  walletWrites,
  characterStateWrites,
  titleHoldings,
  characterReview,
  REVIEW_STATES,
  memberList,
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
// 캐릭터 이미지 항목: the 두상, 흉상 and 전신, named as the owner set them.
let imageSlots = imageSlotsOf();
// Rows the forms pick from, by kind (buildRecord checks picks against them).
let references: Record<string, any[]> = {
  fields: [],
  characters: [],
  titles: [],
  stats: [],
  items: [],
  profiles: [],
};
function message(error) {
  // A site function's own ctx.fail message comes with a reason.
  if (error?.details?.reason) return error.message;
  return error?.code === "CONFLICT"
    ? "다른 창에서 바뀌었습니다. 다시 불러온 뒤 수정하세요."
    : error?.code === "NOT_FOUND"
      ? "컬렉션을 먼저 만들거나 삭제된 자료를 확인하세요."
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
    if (model.report || name !== section || !entry) return;
    const open = model.review ? openCharacterForm : openForm;
    if (entry === "new") return open();
    const row = await owner
      .collection(model.collection)
      .get(entry)
      .catch((error) => {
        if (error?.code === "NOT_FOUND") return null;
        throw error;
      });
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

async function all(collection) {
  const rows = [];
  for await (const page of owner.collection(collection).pages({ size: 100 }))
    rows.push(...page.documents);
  return rows;
}
async function load({ more = false } = {}) {
  const requestedSection = section;
  const model = models[section];
  $("adminHelp").textContent = named(model.help);
  // The review registers characters too (adm/character_form.php, w='').
  $("adminNew").hidden = Boolean(model.readOnly) && !model.review;
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
    $("reviewTools").hidden = true;
    $("memberSearchLabel").hidden = true;
    const row = await owner
      .collection(model.collection)
      .get(model.fixedId)
      .catch((error) => {
        if (error.code === "NOT_FOUND") return null;
        throw error;
      });
    if (requestedSection === section) await openForm(row);
    return;
  }
  if (model.report) {
    $("adminMore").hidden = true;
    $("holdingsSearchLabel").hidden = true;
    $("reviewTools").hidden = true;
    $("memberSearchLabel").hidden = true;
    return model.report === "visits"
      ? visitsView()
      : model.report === "grants"
        ? grantsView()
        : activityView();
  }
  $("holdingsSearchLabel").hidden = !model.holdings;
  $("reviewTools").hidden = !model.review;
  $("memberSearchLabel").hidden = section !== "members";
  let page;
  // 회원 관리 (adm/member_list.php): every member, found by nickname.
  const memberEntries = new Map();
  if (model.holdings) {
    references.titles = await all("neo_avocado_titles");
    references.characters = await all("neo_avocado_characters");
    const rows = titleHoldings(
      await all(model.collection),
      references.characters,
      references.titles,
      $<HTMLInputElement>("holdingsSearch").value,
    );
    const start = more ? Number(cursor) : 0;
    page = {
      documents: rows.slice(start, start + 50),
      nextCursor: start + 50 < rows.length ? String(start + 50) : null,
    };
  } else if (section === "members") {
    references.profiles = await all("neo_avocado_profiles");
    const rows = memberList(
      await all(model.collection),
      references.profiles,
      await all("neo_avocado_presence"),
      $<HTMLInputElement>("memberSearch").value,
    );
    const start = more ? Number(cursor) : 0;
    for (const entry of rows.slice(start, start + 50))
      memberEntries.set(entry.row.id, entry);
    page = {
      documents: rows.slice(start, start + 50).map((entry) => entry.row),
      nextCursor: start + 50 < rows.length ? String(start + 50) : null,
    };
  } else if (model.review) {
    references.fields = await all("neo_avocado_character_fields");
    references.profiles = await all("neo_avocado_profiles");
    // Every character is read once, then searched and counted here, as
    // the original's list does in SQL (adm/character_list.php:107-140).
    const characters = (await all(model.collection)).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    const { rows, counts } = characterReview(characters, references.profiles, {
      field: $<HTMLSelectElement>("reviewField").value,
      text: $<HTMLInputElement>("reviewSearch").value,
      state: review.state,
      side: $<HTMLSelectElement>("reviewSide").value,
      kind: $<HTMLSelectElement>("reviewClass").value,
    });
    reviewFilters(characters, counts);
    const start = more ? Number(cursor) : 0;
    page = {
      documents: rows.slice(start, start + 50),
      nextCursor: start + 50 < rows.length ? String(start + 50) : null,
    };
  } else
    page = await owner.collection(model.collection).list({
      size: 50,
      after: more ? cursor : null,
      ...(model.cleanup ? { filter: { deleted: true } } : {}),
    });
  if (requestedSection !== section || !owner) return;
  if (!more) $("adminRows").replaceChildren();
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
            const previous = row.state;
            await owner.collection("neo_avocado_character_state").set(
              previous.id,
              {
                ...previous.data,
                titles: (previous.data.titles ?? []).filter(
                  (id) => id !== row.titleId,
                ),
                ...(previous.data.activeTitle === row.titleId
                  ? { activeTitle: null }
                  : {}),
              },
              { condition: { revision: previous.revision } },
            );
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
    if (model.cleanup) {
      li.append(`${row.data.name ?? row.data.title ?? row.id} · 삭제 정리 중 `);
      const resume = document.createElement("button");
      resume.type = "button";
      resume.textContent = "정리 계속";
      resume.onclick = () =>
        run(async () => {
          resume.disabled = true;
          try {
            const result = await resumeCleanup(owner, model.cleanup, row.id);
            $("adminStatus").textContent = result.done
              ? "정리를 완료했습니다."
              : "일부 자료를 정리했습니다. 정리 계속을 눌러 이어가세요.";
            await load();
          } finally {
            resume.disabled = false;
          }
        });
      li.append(resume);
      $("adminRows").append(li);
      continue;
    }
    if (model.readOnly) {
      li.textContent = `${new Date(row.data.at).toLocaleString("ko-KR")} · ${row.data.owner} · ${row.data.kind}${row.data.delta !== undefined ? ` · ${moneyText(itemNames, row.data.delta)}` : ""}${row.data.memo ? ` · ${row.data.memo}` : ""}`;
      $("adminRows").append(li);
      continue;
    }
    li.append(
      row.data.name ??
        references.characters.find((character) => character.id === row.id)?.data
          .name ??
        references.profiles.find((profile) => profile.id === row.id)?.data
          .nick ??
        row.id,
      " ",
    );
    if (section === "members")
      li.append(`· ${memberSummary(memberEntries.get(row.id))} `);
    if (section === "wallets")
      li.append(`${moneyText(itemNames, row.data.balance)} `);
    if (section === "inventory")
      li.append(
        `${references.profiles.find((profile) => profile.id === row.data.owner)?.data.nick ?? row.data.owner} · ${references.characters.find((character) => character.id === row.data.character)?.data.name ?? "회원 인벤토리"} `,
      );
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "수정";
    edit.onclick = () => run(() => openForm(row));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.hidden = Boolean(model.noDelete);
    remove.textContent = "삭제";
    remove.onclick = () =>
      run(async () => {
        if (!confirm("이 자료를 삭제할까요?")) return;
        if (section === "titles") {
          await deleteTitle(owner, row.id, ({ completed }) => {
            $("adminStatus").textContent =
              `${completed}명의 타이틀을 회수했습니다.`;
          });
          await load();
          return;
        }
        // Its uploads stay; Naru's media library marks them 참조 없음.
        await owner
          .collection(model.collection)
          .delete(row.id, { condition: { revision: row.revision } });
        await load();
      });
    li.append(edit, " ", remove);
    if (section === "titles") {
      const grant = document.createElement("button");
      grant.type = "button";
      grant.textContent = "지급·회수";
      grant.disabled = Boolean(row.data.deleted);
      if (row.data.deleted)
        li.append(" (삭제 정리 중: 삭제를 다시 눌러 재개) ");
      grant.onclick = () =>
        run(async () => {
          grantTitleId = row.id;
          $("titleGrantHeading").textContent = `${row.data.name} 지급·회수`;
          $("titleGrantStatus").textContent = "";
          $("titleGrantCharacters").replaceChildren();
          for (const character of await all("neo_avocado_characters")) {
            if (character.data.deleted) continue;
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
};
/** The review list's state filter. */
const review = { state: "" };
/**
 * The review's 소속 and 종족 choices (the values characters have) and its
 * state buttons with their counts (character_list.php:285-288).
 */
function reviewFilters(characters, counts) {
  for (const [id, key, title] of [
    ["reviewSide", "side", itemNames.sideTitle || "소속"],
    ["reviewClass", "class", itemNames.classTitle || "종족"],
  ]) {
    const select = $<HTMLSelectElement>(id);
    const chosen = select.value;
    const values = [
      ...new Set<string>(
        characters
          .map((row) => row.data[key])
          .filter((value) => typeof value === "string" && value),
      ),
    ].sort();
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
// 선택승인 (character_list_update.php): each through the review, in turn.
$("reviewApprove").onclick = () =>
  run(async () => {
    const chosen = [
      ...$("adminRows").querySelectorAll<HTMLInputElement>(
        ".review-select:checked",
      ),
    ];
    if (!chosen.length)
      throw new Error("승인할 캐릭터를 하나 이상 선택해 주세요.");
    if (!confirm(`선택한 ${chosen.length}명을 승인할까요?`)) return;
    $<HTMLButtonElement>("reviewApprove").disabled = true;
    let approved = 0;
    try {
      for (const box of chosen) {
        await owner.mutate("characters/review:reviewCharacter", {
          character: box.value,
          revision: box.dataset.revision,
          state: "approved",
        });
        approved++;
      }
    } finally {
      $<HTMLButtonElement>("reviewApprove").disabled = false;
      $("adminStatus").textContent = `${approved}명을 승인했습니다.`;
      await load();
    }
  });
const TYPES = [
  ["main", "메인"],
  ["sub", "서브"],
  ["npc", "NPC"],
];
/** One application: its sheet with every field, the decision and admin-only values. */
function reviewRow(row) {
  const form = document.createElement("form");
  form.className = "review";
  const nick =
    references.profiles.find(
      (profile) => profile.id === (row.createdBy ?? row.data.owner),
    )?.data.nick ?? "알 수 없는 회원";
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
  const definitions = references.fields
    .filter((field) => !field.data.deleted)
    .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
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
    ["editing", "수정 요청"],
    ["submitted", "신청 상태로"],
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
  remove.textContent = "삭제";
  remove.onclick = () =>
    run(async () => {
      if (
        !confirm(
          `${row.data.name}을(를) 삭제할까요? 관계·옷장·커플·공식 기록도 함께 지웁니다.`,
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
  const [fields, sides, classes] = await Promise.all([
    all("neo_avocado_character_fields"),
    all("neo_avocado_sides"),
    all("neo_avocado_classes"),
  ]);
  references.fields = fields;
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
    const names = rows
      .filter((entry) => !entry.data.deleted)
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
      .map((entry) => [entry.data.name, entry.data.name]);
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
  const definitions = fields
    .filter((field) => !field.data.deleted)
    .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
  for (const field of definitions) {
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
        await owner.media.upload(file.files[0], { managed: true })
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
  references = {
    characters: await all("neo_avocado_characters"),
    titles: (await all("neo_avocado_titles")).filter(
      (row) => !row.data.deleted,
    ),
    stats: await all("neo_avocado_stat_config"),
    items: await all("neo_avocado_items"),
    profiles: await all("neo_avocado_profiles"),
    sides: await all("neo_avocado_sides"),
    classes: await all("neo_avocado_classes"),
    groups: await all("neo_avocado_board_groups"),
    // To refuse a combination another recipe already has.
    recipes: section === "recipes" ? await all("neo_avocado_recipes") : [],
  };
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
  for (const field of fields) {
    if (field.type === "heading") {
      const title = document.createElement("h3");
      title.textContent = named(field.label);
      $("adminFields").append(title);
      continue;
    }
    const value =
      field.key === "id"
        ? (row?.id ?? model.fixedId ?? field.default)
        : section === "quests" && field.key === "images"
          ? (row?.data.images?.join("\n") ?? "")
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
      $("adminFields").append(group);
      continue;
    }
    const label = document.createElement("label");
    label.textContent = named(field.label);
    // A pick from an owner's list; free text while that list is empty.
    const pickRows =
      field.type === "pick"
        ? (references[field.from] ?? []).filter((row) => !row.data.deleted)
        : null;
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
        : ["tokens", "pick"].includes(field.type)
          ? "text"
          : (field.type ?? "text");
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
    $("adminFields").append(label);
    if (field.image || field.images)
      $("adminFields").append(imageUpload(field, value));
  }
  $("adminForm").hidden = false;
}

/**
 * A file picker beside an image field: saving uploads the file to Naru Media
 * and its address takes the field's place (quest images: joins the list). The
 * upload is managed: Naru's media library marks it 참조 없음 once no document
 * names it, for the owner to delete if it is not linked elsewhere.
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
        urls.push((await owner.media.upload(chosen, { managed: true })).url);
      const key = file.dataset.uploadFor;
      values[key] = file.multiple
        ? [values[key], ...urls].filter(Boolean).join("\n")
        : urls[0];
    }
    $("adminFormStatus").textContent = "";
    const record = buildRecord(section, values, selected, references);
    let saved;
    if (section === "wallets") {
      const results = await owner.batch(
        walletWrites(
          record,
          selected,
          values.note,
          Date.now(),
          crypto.randomUUID(),
        ),
      );
      saved = { ...record, ...results[0] };
    } else if (section === "character_state") {
      const results = await owner.batch(
        characterStateWrites(
          record,
          selected,
          values.expNote,
          Date.now(),
          crypto.randomUUID(),
        ),
      );
      saved = { ...record, ...results[0] };
    } else
      saved = await owner
        .collection(models[section].collection)
        .set(record.id, record.data, {
          condition: selected
            ? { revision: selected.revision }
            : { absent: true },
        });
    selected = saved;
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
  const settings = await owner
    .collection("neo_avocado_settings")
    .get("community")
    .catch((error) => {
      if (error.code === "NOT_FOUND") return null;
      throw error;
    });
  itemNames = namesOf(settings?.data);
  const profile = await owner
    .collection("neo_avocado_settings")
    .get("profile")
    .catch((error) => {
      if (error.code === "NOT_FOUND") return null;
      throw error;
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
  run(() => naru.auth.signIn({ collections: scopes }));
$("adminSignOut").onclick = () =>
  run(async () => {
    await owner.signOut();
    owner = null;
    $("adminWorkspace").hidden = true;
    $("adminWelcome").hidden = false;
  });
await run(async () => {
  const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
  naru = createNaru(config.site ? { site: config.site } : undefined);
  renderNav();
  const session = await naru.auth.session();
  if (!session) return;
  // The foundation's tables stand in for the collections they replaced.
  owner = withTables(session);
  $("adminWelcome").hidden = true;
  $("adminWorkspace").hidden = false;
  references.characters = await all("neo_avocado_characters");
  references.profiles = await all("neo_avocado_profiles");
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
    const result = await applyTitles(
      owner,
      grantTitleId,
      {
        action: $<HTMLSelectElement>("titleGrantAction").value,
        allApproved: $<HTMLInputElement>("titleGrantAll").checked,
        characterIds: $<HTMLInputElement>("titleGrantAll").checked
          ? []
          : [
              ...$<HTMLSelectElement>("titleGrantCharacters").selectedOptions,
            ].map((option) => option.value),
      },
      ({ completed, total }) => {
        $("titleGrantStatus").textContent =
          `${completed}/${total}명 처리했습니다.`;
      },
    );
    $("titleGrantStatus").textContent =
      `${result.completed}명에게 적용했습니다.`;
  } catch (error) {
    $("titleGrantStatus").textContent = error.message ?? message(error);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
    $("adminNav").inert = false;
  }
};

$("holdingsFind").onclick = () => run(() => load());
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
    const days = await all("neo_avocado_visits");
    const report = visitReport(days, {
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
      const old = (await all("neo_avocado_visits")).filter(
        (row) => row.data.day < from.value,
      );
      if (!old.length) {
        $("adminStatus").textContent = "지울 기록이 없습니다.";
        return;
      }
      if (
        !confirm(`${from.value} 이전 ${old.length}일의 접속 기록을 지울까요?`)
      )
        return;
      for (const row of old)
        await owner.collection("neo_avocado_visits").delete(row.id);
      $("adminStatus").textContent =
        `${old.length}일의 접속 기록을 지웠습니다.`;
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
  const boards = await all("neo_avocado_boards");
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
  const draw = async () => {
    // "all" stands for every board, which has no ID of its own.
    adminRoute(["activity", board.value || "all", from.value, to.value]);
    const [profiles, members, characters, logs, comments, presence] =
      await Promise.all([
        all("neo_avocado_profiles"),
        all("neo_avocado_members"),
        all("neo_avocado_characters"),
        all("neo_avocado_logs"),
        all("neo_avocado_comments"),
        all("neo_avocado_presence"),
      ]);
    const rows = activityReport(
      { profiles, members, characters, logs, comments, presence },
      { board: board.value, from: from.value, to: to.value },
    );
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
              await owner.collection("neo_avocado_members").set(
                row.id,
                {
                  role: "member",
                  ...row.member?.data,
                  warnings: count,
                  warningNote: note.value.trim(),
                },
                row.member
                  ? { condition: { revision: row.member.revision } }
                  : { condition: { absent: true } },
              );
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
    );
  };
  show.onclick = () => run(draw);
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
  const items = (await all("neo_avocado_items")).filter(
    (row) => !row.data.deleted,
  );
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
    const page = await owner.collection("neo_avocado_history").list({
      where: { eq: ["actor", "grant"] },
      sort: [[{ metadata: "createdAt" }, "desc"]],
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
