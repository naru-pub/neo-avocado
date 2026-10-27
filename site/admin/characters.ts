// 캐릭터관리: the character review (승인·삭제), the character form, and title grants.

import type { ModelField, Reference } from "../_naru/modules/admin-model.js";
import {
  $,
  type AdminRow,
  grantTitleId,
  imageSlots,
  itemNames,
  loadReferences,
  message,
  ownerClient,
  ownerMutate,
  references,
  run,
  section,
  selected,
  setSelected,
} from "./core.js";
import { imageUpload } from "./editor.js";
import { REVIEW_STATES } from "./forms.js";
import { load } from "./list.js";
import { adminRoute } from "./main.js";

export const STATES: Record<string, string> = {
  editing: "수정 중",
  submitted: "신청(수정 완료)",
  approved: "승인",
  // 선택삭제: kept, out of every list, recovered by another state.
  deleted: "삭제",
};
/** The review list's state filter. */
export const review = { state: "" };
/**
 * The review's 소속 and 종족 choices (the values characters have) and its
 * state buttons with their counts (character_list.php:285-288).
 */
export function reviewFilters({
  sides,
  classes,
  counts,
}: {
  sides: string[];
  classes: string[];
  counts: Record<string, number>;
}) {
  for (const [id, values, title] of [
    ["reviewSide", sides, itemNames.sideTitle || "소속"],
    ["reviewClass", classes, itemNames.classTitle || "종족"],
  ] as const) {
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
/**
 * 선택승인, 선택삭제 and 선택제거 (character_list_update.php): each chosen
 * character through the review, in turn. 선택삭제 sets 삭제, which another
 * state recovers; 선택제거 deletes it with what hangs off it, for good.
 */
export function reviewChosen(
  button: string,
  verb: string,
  act: (box: HTMLInputElement) => Promise<unknown>,
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
export const reviewState = (state: string) => (box: HTMLInputElement) =>
  ownerMutate("characters/review:reviewCharacter", {
    character: box.value,
    revision: box.dataset.revision,
    state,
  });
// character_list_update.php's 선택수정: each chosen row's 유형 and 상태.
$("reviewSave").onclick = reviewChosen("reviewSave", "수정할", (box) => {
  const row = box.closest("form") as HTMLFormElement;
  const state = row.querySelector<HTMLSelectElement>(".review-state");
  return ownerMutate("characters/review:reviewCharacter", {
    character: box.value,
    revision: box.dataset.revision,
    type: row.querySelector<HTMLSelectElement>(".review-type")?.value,
    ...(state && state.value !== state.dataset.was
      ? { state: state.value }
      : {}),
  });
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
  (box) => ownerMutate("characters/sheet:remove", { id: box.value }),
);
export const TYPES: [string, string][] = [
  ["main", "메인"],
  ["sub", "서브"],
  ["npc", "NPC"],
];
/** One application: its sheet with every field, the decision and admin-only values. */
export function reviewRow(row: AdminRow) {
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
  const adminInputs: HTMLInputElement[] = [];
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
  type.className = "review-type";
  // character_list.php's ch_state select, for 선택수정.
  const state = document.createElement("select");
  state.className = "review-state";
  state.setAttribute("aria-label", "캐릭터 상태");
  for (const [value, label] of Object.entries(STATES))
    state.append(new Option(label, value));
  state.value = row.data.state ?? "submitted";
  state.dataset.was = state.value;
  const decide = (state: string | null) =>
    run(async () => {
      for (const control of form.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button,input,select"))
        control.disabled = true;
      try {
        await ownerMutate("characters/review:reviewCharacter", {
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
        await ownerMutate("characters/sheet:move", {
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
  form.append(
    select,
    heading,
    " ",
    type,
    " ",
    state,
    summary,
    sheet,
    ...buttons,
    manage,
  );
  return form;
}
/**
 * Deletes a character as adm/character_delete.php does; the items it held
 * go back to their owners' own inventory.
 */
export async function removeCharacter(row: AdminRow) {
  await ownerMutate("characters/sheet:remove", { id: row.id });
}
/**
 * The owner's full form for one character (adm/character_form.php:112-423):
 * the member it belongs to when new, state, type, 소속, 종족, name, profile,
 * picture and every custom field. Stats and points stay in 캐릭터 승인·경험치·
 * 능력치·타이틀. Image fields take a managed upload as the other forms do.
 */
export async function openCharacterForm(row: AdminRow | null = null) {
  const { fields, sides, classes } = await loadReferences();
  setSelected(row);
  adminRoute([section, row ? row.id : "new"]);
  $("adminForm").hidden = true;
  $("characterFormTitle").textContent = row
    ? `${row.data.name} 수정`
    : "새 캐릭터";
  $("characterFormStatus").textContent = "";
  const box = $("characterFields");
  box.replaceChildren();
  const add = <
    T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  >(
    text: string,
    input: T,
    image: ModelField | null = null,
  ) => {
    const label = document.createElement("label");
    label.append(text, input);
    box.append(label);
    if (image) box.append(imageUpload(image, input.value));
    return input;
  };
  const textInput = (name: string, value: string | undefined, max: number) => {
    const input = document.createElement("input");
    input.name = name;
    input.value = value ?? "";
    input.maxLength = max;
    return input;
  };
  const choice = (
    name: string,
    value: string | undefined,
    options: [string, string][],
    empty: string | null = "선택하지 않음",
  ) => {
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
  const listed = (
    name: string,
    label: string,
    rows: Reference[],
    value: string | undefined,
  ) => {
    // In their order already (admin/references).
    const names = rows.map((entry): [string, string] => [
      entry.data.name,
      entry.data.name,
    ]);
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
      label: slot.label,
      image: true,
    });
  }
  for (const field of fields) {
    const value = row?.data.fields?.[field.id] ?? "";
    const label = `${field.data.label ?? field.id}${field.data.visibility === "admin" ? " (운영자만)" : field.data.visibility === "owner" ? " (오너+운영자)" : ""}`;
    const key = `field:${field.id}`;
    const type = field.data.type ?? "text";
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (type === "textarea") {
      input = document.createElement("textarea");
      input.name = key;
      input.maxLength = 2000;
      input.value = value;
    } else if (type === "select")
      input = choice(
        key,
        value,
        (field.data.options ?? []).map((option: string): [string, string] => [
          option,
          option,
        ]),
        "",
      );
    else {
      input = textInput(key, value, type === "text" ? 200 : 2000);
      if (type === "url" || type === "image") input.placeholder = "https://";
    }
    add(label, input, type === "image" ? { key, label, image: true } : null);
  }
  $("characterForm").hidden = false;
}
$("characterForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("characterForm").querySelector<HTMLButtonElement>(
    '[type="submit"]',
  ) as HTMLButtonElement;
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
      values[file.dataset.uploadFor ?? ""] = (
        await ownerClient().media.upload(file.files[0])
      ).url;
    }
    $("characterFormStatus").textContent = "";
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(values))
      if (key.startsWith("field:")) fields[key.slice(6)] = value;
    const row = selected;
    await ownerMutate("characters/sheet:save", {
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
    const result = await ownerMutate("admin/titles:grant", {
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
