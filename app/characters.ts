// Characters: the list, profile fields, relations, outfits and stats.

import {
  $,
  CHARACTER_PAGE,
  memberSettings,
  mutate,
  query,
  edit,
  type EditField,
  mine,
  nickOf,
  preloadNicks,
  run,
  say,
  show,
  showTab,
  state,
  STATE_NAMES,
  TYPE_NAMES,
  uploadMedia,
  route,
  formatTime,
  renderPages,
  pageTitle,
} from "./core.js";
import { writeTo } from "./messages.js";
import { expText, moneyText } from "./names.js";

/**
 * The list's filter: "applicants" (member/ready.php: characters not yet
 * approved, in either state), "approved", or every character.
 */
const characterFilter = () =>
  $<HTMLSelectElement>("characterFilter").value || null;
/** Keeps the nicknames a query answered beside its characters. */
function keepNicks(nicks: Record<string, string> = {}) {
  for (const [id, nick] of Object.entries(nicks))
    if (!state.nicks.has(id)) state.nicks.set(id, Promise.resolve(nick));
}
/**
 * The owner's 소속 and 종족 lists (adm/side_list, class_list), in order (while
 * a list is empty, members write their own), and the custom profile fields
 * (adm/character_article_list.php), in one read.
 */
async function loadChoices() {
  const member = state.member;
  const { fields, sides, classes } = await query("characters/sheet:choices");
  if (state.member !== member) return;
  state.sides = sides;
  state.classes = classes;
  choiceField("characterSide", state.sides);
  choiceField("characterClass", state.classes);
  showFieldCatalogue(fields);
}
/**
 * The names a member may pick (si_auth, cl_auth: up to their level); the
 * site owner, all.
 */
function pickable(rows) {
  return rows
    .filter(
      (row) => state.owner || (Number(row.data.level) || 1) <= state.level,
    )
    .map((row) => row.data.name);
}
/** The form's field as a select of the list's names, or free text. */
function choiceField(id, rows) {
  const current = $(id);
  const wanted = rows.length ? "SELECT" : "INPUT";
  if (current.tagName === wanted && wanted === "INPUT") return;
  const field = document.createElement(wanted.toLowerCase()) as
    HTMLInputElement | HTMLSelectElement;
  field.id = id;
  if (wanted === "INPUT") (field as HTMLInputElement).maxLength = 40;
  else
    field.append(
      new Option("선택 안 함", ""),
      ...pickable(rows).map((name) => new Option(name, name)),
    );
  current.replaceWith(field);
}
/** The edit dialog's field for a list, keeping a value no longer on it. */
function choiceEdit(name, label, rows, value) {
  if (!rows?.length) return { name, label, value, max: 40 };
  const names = pickable(rows);
  return {
    name,
    label,
    value: value ?? "",
    options: [
      ["", "선택 안 함"],
      ...(value && !names.includes(value) ? [[value, value]] : []),
      ...names.map((entry) => [entry, entry]),
    ],
  };
}
/**
 * The characters the filter picks by numbered pages: 멤버목록 oldest first
 * (get_character_list's ch_id asc), the rest newest first; `size` 0, all.
 */
async function characterPage(filter, page, size, search = {}) {
  const result = await query("characters/sheet:list", {
    filter,
    page,
    size,
    ...search,
  });
  keepNicks(result.nicks);
  return result;
}
export async function loadCharacters({ page: number = 1 } = {}) {
  const filter = characterFilter();
  if (number === 1 || !state.fieldCatalogue) await loadChoices();
  $("applicantTools").hidden = filter !== "applicants";
  if (filter === "applicants") {
    if (number === 1 || !applicants.rows)
      applicants.rows = (await characterPage(filter, 1, 0)).documents;
    await showApplicants(number);
    state.charactersLoaded = true;
    return;
  }
  // 멤버목록 by 소속 (member/index.php's 진영별), once there are two: every
  // approved character on one page, as the original lists them.
  if (
    $<HTMLSelectElement>("characterFilter").value === "approved" &&
    state.names.sideTitle &&
    state.sides.length >= 2
  ) {
    await showBySide();
    state.charactersLoaded = true;
    return;
  }
  const page = await characterPage(filter, number, CHARACTER_PAGE);
  $("characters").replaceChildren();
  for (const character of page.documents)
    $("characters").append(await characterItem(character));
  state.charactersLoaded = true;
  renderPages(
    $("characterPages"),
    number,
    Math.ceil(page.total / CHARACTER_PAGE),
    (next) => loadCharacters({ page: next }),
  );
}
/** 신청자목록's applicants, read once a visit, and what narrows them. */
const applicants = { rows: null, side: "", class: "", field: "nick", text: "" };
const APPLICANT_PAGE = 10;
/**
 * 신청자목록 (member/ready.php): ALL and each 소속 (with its 종족) and
 * their counts, the search, then 10 a page, newest first.
 */
async function showApplicants(number = 1) {
  const rows = applicants.rows;
  await preloadNicks(rows);
  const nicks = new Map();
  for (const row of rows)
    nicks.set(row.id, await nickOf(row.createdBy ?? row.data.owner));
  const searched = rows.filter((row) => {
    // A profile field's search was the server's (member/ready.php's arcode).
    if (!applicants.text || applicants.field.startsWith("field:")) return true;
    const value =
      applicants.field === "nick" ? nicks.get(row.id) : row.data.name;
    return String(value ?? "").includes(applicants.text);
  });
  const count = (side, kind) =>
    searched.filter(
      (row) =>
        (!side || row.data.side === side) && (!kind || row.data.class === kind),
    ).length;
  const filter = (label, side, kind) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${label}(${count(side, kind)})`;
    button.setAttribute(
      "aria-pressed",
      String(applicants.side === side && applicants.class === kind),
    );
    button.onclick = () =>
      run(async () => {
        applicants.side = side;
        applicants.class = kind;
        await showApplicants();
      });
    return button;
  };
  const sides = state.names.sideTitle
    ? state.sides.map((row) => row.data.name)
    : [];
  const classes = state.names.classTitle
    ? state.classes.map((row) => row.data.name)
    : [];
  $("applicantFilters").replaceChildren(
    filter("ALL", "", ""),
    ...sides.flatMap((side) => [
      filter(side, side, ""),
      ...classes.map((kind) => filter(`${side} ${kind}`, side, kind)),
    ]),
    ...(sides.length ? [] : classes.map((kind) => filter(kind, "", kind))),
  );
  const shown = searched
    .filter(
      (row) =>
        (!applicants.side || row.data.side === applicants.side) &&
        (!applicants.class || row.data.class === applicants.class),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const pages = Math.ceil(shown.length / APPLICANT_PAGE);
  const current = Math.min(Math.max(1, number), Math.max(1, pages));
  $("characters").replaceChildren();
  for (const character of shown.slice(
    (current - 1) * APPLICANT_PAGE,
    current * APPLICANT_PAGE,
  ))
    $("characters").append(await characterItem(character));
  if (!shown.length)
    $("characters").append(
      Object.assign(document.createElement("li"), {
        textContent: "신청자가 없습니다.",
      }),
    );
  renderPages($("characterPages"), current, pages, (next) =>
    run(() => showApplicants(next)),
  );
}
$("applicantSearch").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    applicants.field = $<HTMLSelectElement>("applicantField").value;
    applicants.text = $<HTMLInputElement>("applicantText").value.trim();
    // A 공개 profile field: the server finds the applicants holding it.
    applicants.rows = (
      await characterPage(
        "applicants",
        1,
        0,
        applicants.field.startsWith("field:") && applicants.text
          ? { field: applicants.field.slice(6), text: applicants.text }
          : {},
      )
    ).documents;
    await showApplicants();
  });
};
/** Every approved character under its 소속's title, the rest under 기타. */
async function showBySide() {
  const characters = (await characterPage("approved", 1, 0)).documents;
  const sections = [
    ...state.sides.map((side) => ({
      side,
      members: characters.filter((row) => row.data.side === side.data.name),
    })),
    {
      side: null,
      members: characters.filter(
        (row) => !state.sides.some((side) => side.data.name === row.data.side),
      ),
    },
  ].filter((section) => section.members.length);
  const items = [];
  for (const { side, members } of sections) {
    const title = document.createElement("li");
    title.className = "side-title";
    if (side?.data.image?.startsWith("https://"))
      title.append(
        Object.assign(new Image(), {
          src: side.data.image,
          alt: side.data.name,
        }),
      );
    else title.textContent = side?.data.name ?? "기타";
    items.push(title);
    for (const character of members) items.push(await characterItem(character));
  }
  $("characters").replaceChildren(...items);
  $("characterPages").hidden = true;
}
/** The owner's custom profile fields, read with the lists once a visit. */
async function loadFieldCatalogue() {
  if (!state.fieldCatalogue) await loadChoices();
  return state.fieldCatalogue ?? [];
}
/** The registration form's inputs for the custom fields. */
function showFieldCatalogue(rows) {
  state.fieldCatalogue = rows;
  // 신청자목록's search by each 공개 profile field (member/ready.php).
  const choice = $<HTMLSelectElement>("applicantField");
  const chosen = choice.value;
  for (const option of [...choice.options])
    if (option.value.startsWith("field:")) option.remove();
  for (const row of rows)
    if (row.data.visibility === "public")
      choice.append(new Option(row.data.label, `field:${row.id}`));
  if ([...choice.options].some((option) => option.value === chosen))
    choice.value = chosen;
  $("characterFields").replaceChildren(
    ...rows.flatMap((row) => {
      const [label, input] = fieldInput(row, "");
      input.dataset.field = row.id;
      label.append(input);
      const unit = suffixOf(row);
      if (unit) label.append(` ${unit}`);
      if (row.data.type !== "image") return [label];
      const upload = document.createElement("label");
      upload.textContent = `${row.data.label ?? row.id} 파일 올리기`;
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/*";
      file.dataset.fieldUpload = row.id;
      upload.append(file);
      return [label, upload];
    }),
  );
  return rows;
}
/** A one-line field's unit (ar_text), shown after it (viewer.skin.php:117). */
const suffixOf = (row) =>
  (row.data.type ?? "text") === "text" && typeof row.data.suffix === "string"
    ? row.data.suffix.trim()
    : "";
/** A label and control for one custom field definition. */
function fieldInput(row, value) {
  const label = document.createElement("label");
  label.textContent = `${row.data.label ?? row.id}${row.data.required ? " (신청 시 필수)" : ""}${row.data.visibility === "owner" ? " · 오너와 운영자만 봄" : ""}`;
  if (row.data.help) label.title = row.data.help;
  const type = row.data.type ?? "text";
  const input = document.createElement(
    type === "select" ? "select" : type === "textarea" ? "textarea" : "input",
  ) as HTMLInputElement; // only an input is given input-only members below
  if (type === "select")
    for (const option of ["", ...(row.data.options ?? [])]) {
      const element = document.createElement("option");
      element.value = option;
      element.textContent = option || "선택 안 함";
      input.append(element);
    }
  else {
    input.maxLength = type === "textarea" ? 2000 : type === "text" ? 200 : 2000;
    if (type === "url" || type === "image") input.type = "url";
    if (type === "image" || type === "url") input.placeholder = "https://";
  }
  input.value = value ?? "";
  // ar_size (character_form.php:283-287): one line's width, or the
  // textarea's height.
  if (row.data.size > 0) {
    if (type === "textarea") input.style.height = `${row.data.size}px`;
    else input.style.width = `min(${row.data.size}px, 100%)`;
  }
  return [label, input];
}
/** Custom values of a character the characters rule let the caller see, in catalogue order. */
function renderFields(list, character) {
  list.replaceChildren();
  for (const row of state.fieldCatalogue ?? []) {
    const value = character.data.fields?.[row.id];
    if (typeof value !== "string" || !value) continue;
    const term = document.createElement("dt");
    term.textContent = row.data.label ?? row.id;
    const detail = document.createElement("dd");
    if (row.data.type === "image" && value.startsWith("https://")) {
      const image = document.createElement("img");
      image.src = value;
      image.alt = row.data.label ?? row.id;
      image.loading = "lazy";
      image.className = "field-image";
      detail.append(image);
    } else if (row.data.type === "url" && value.startsWith("https://")) {
      const link = document.createElement("a");
      link.href = value;
      link.textContent = value;
      link.rel = "noopener noreferrer";
      detail.append(link);
    } else
      detail.textContent = `${value}${suffixOf(row) ? ` ${suffixOf(row)}` : ""}`;
    list.append(term, detail);
  }
}
async function characterItem(character) {
  const item = $<HTMLTemplateElement>(
    "characterTemplate",
  ).content.firstElementChild.cloneNode(true) as HTMLElement;
  const image = item.querySelector<HTMLImageElement>(".character-image");
  if (character.data.image) image.src = character.data.image;
  else image.remove();
  const name = document.createElement("a");
  name.href = `/character/${encodeURIComponent(character.id)}`;
  name.textContent = character.data.name;
  item.querySelector(".character-name").replaceChildren(name);
  // 쪽지 to another member's owner, as the member list's memo link.
  const owner = character.createdBy ?? character.data.owner;
  if (state.member && owner && owner !== state.member.id) {
    const write = document.createElement("button");
    write.type = "button";
    write.textContent = "쪽지";
    write.onclick = () => run(() => writeTo(owner));
    item.querySelector(".meta").append(write);
  }
  // An untitled 소속 or 종족 is not shown, as cf_side_title left empty.
  item.querySelector(".character-side").textContent = [
    state.names.sideTitle && character.data.side,
    state.names.classTitle && character.data.class,
  ]
    .filter(Boolean)
    .join(" · ");
  item.querySelector(".character-state").textContent = [
    TYPE_NAMES[character.data.type],
    STATE_NAMES[character.data.state],
  ]
    .filter(Boolean)
    .join(" · ");
  item.querySelector(".character-profile").textContent =
    character.data.profile ?? "";
  item.querySelector(".author").textContent =
    `오너: ${await nickOf(character.createdBy ?? character.data.owner)}`;
  const remove = item.querySelector<HTMLButtonElement>(".delete");
  // 캐릭터 정보 삭제 only before approval (viewer.php:203); the owner, always.
  remove.hidden =
    !mine(character) || (character.data.state === "approved" && !state.owner);
  const change = item.querySelector<HTMLButtonElement>(".edit");
  // An approved character is edited only while the owner allows editing.
  change.hidden =
    !mine(character) ||
    (character.data.state === "approved" &&
      (await communitySettings()).characterEditing === false);
  change.onclick = () =>
    run(() =>
      editCharacter(character, async (saved) => {
        item.replaceWith(await characterItem(saved));
      }),
    );
  remove.onclick = () =>
    run(async () => {
      if (!confirm(`${character.data.name}을(를) 지울까요?`)) return;
      // Its items go back to the member's own inventory with it.
      await mutate("characters/sheet:remove", { id: character.id });
      state.speakers = null;
      item.remove();
    });
  const main = item.querySelector<HTMLButtonElement>(".main-character");
  main.hidden = !mine(character);
  main.onclick = () =>
    run(async () => {
      const result = await mutate("characters/profile:mainCharacter", {
        character: character.id,
      });
      show(result.document);
      say(`${character.data.name}이(가) 대표 캐릭터입니다.`);
    });
  wireCharacterDetails(item, character);
  return item;
}
/**
 * The member's character form for one of theirs (character_form.php?w=u).
 * A 프로필수정 ticket (`ticket`, an inventory ID) opens it even while
 * editing is closed, and the save spends it (inventory/use_item.php:27-28).
 */
export async function editCharacter(
  character,
  onSaved: (saved) => unknown,
  ticket: string | null = null,
) {
  // Lists carry no custom values, so an edit starts from the full sheet.
  const catalogue = await loadFieldCatalogue();
  const { document: current } = await query("characters/sheet:sheet", {
    id: character.id,
  });
  if (!current) throw new Error("캐릭터를 찾을 수 없습니다.");
  const fields: EditField[] = [
    {
      name: "name",
      label: state.nameField.help
        ? `${state.nameField.label} (${state.nameField.help})`
        : state.nameField.label,
      value: current.data.name,
      required: true,
      max: 40,
    },
    ...(state.names.sideTitle
      ? [
          choiceEdit(
            "side",
            state.names.sideTitle,
            state.sides,
            current.data.side,
          ),
        ]
      : []),
    ...(state.names.classTitle
      ? [
          choiceEdit(
            "class",
            state.names.classTitle,
            state.classes,
            current.data.class,
          ),
        ]
      : []),
    {
      name: "profile",
      label: "프로필",
      value: current.data.profile,
      multiline: true,
      max: 4000,
    },
  ];
  // 메인·서브 (ch_type) is the admin's to set (character_form.php:96).
  if (current.data.state !== "approved")
    fields.push({
      name: "state",
      label: "상태",
      value: current.data.state ?? "editing",
      options: [
        ["editing", "수정 중"],
        ["submitted", "신청 (수정 완료)"],
      ],
    });
  fields.push(...imageEdits(current));
  for (const row of catalogue) {
    if (row.data.type === "image")
      fields.push({
        name: `upload:${row.id}`,
        label: `${row.data.label ?? row.id} 파일 올리기 (선택)`,
        type: "file",
        accept: "image/*",
      });
    fields.push({
      name: `field:${row.id}`,
      label: `${row.data.label ?? row.id}${suffixOf(row) ? ` (단위: ${suffixOf(row)})` : ""}${row.data.required ? " (신청 시 필수)" : ""}`,
      value: current.data.fields?.[row.id] ?? "",
      ...(row.data.type === "select"
        ? {
            options: [
              ["", "선택 안 함"],
              ...(row.data.options ?? []).map((option) => [option, option]),
            ],
          }
        : row.data.type === "textarea"
          ? { multiline: true, max: 2000 }
          : { max: row.data.type === "text" ? 200 : 2000 }),
    });
  }
  edit(
    ticket ? "캐릭터 수정 (프로필 수정권 사용)" : "캐릭터 수정",
    fields,
    async (values) => {
      if (!values.name) throw new Error("이름을 입력해 주세요.");
      const data = { ...current.data, fields: {} };
      delete data.fieldMedia;
      for (const [name, value] of Object.entries(values))
        if (name.startsWith("field:")) {
          if (value) data.fields[name.slice(6)] = value;
        } else if (name.startsWith("image:")) {
          data[name.slice(6)] = value.trim() || null;
        } else if (
          !name.startsWith("upload:") &&
          !name.startsWith("imageUpload:")
        )
          data[name] = value;
      for (const [name, file] of Object.entries(values))
        if (name.startsWith("imageUpload:") && file)
          data[name.slice(12)] = (await uploadMedia(file)).url;
      // An uploaded file replaces the field's address with its own.
      for (const [name, file] of Object.entries(values))
        if (name.startsWith("upload:") && file) {
          const uploaded = await uploadMedia(file);
          data.fields[name.slice(7)] = uploaded.url;
        }
      // A 프로필수정 ticket is spent by the save it opens.
      const { document: saved } = await mutate("characters/sheet:save", {
        id: character.id,
        data,
        revision: current.revision,
        ...(ticket ? { ticket } : {}),
      });
      state.speakers = null;
      await onSaved(saved);
    },
  );
}
function wireCharacterDetails(item, character) {
  const details = item.querySelector(".character-details");
  const addRelation = item.querySelector(".add-relation");
  const addOutfit = item.querySelector(".add-outfit");
  const defaultOutfit = item.querySelector(".default-outfit");
  const allocate = item.querySelector(".allocate-stats");
  for (const button of [addRelation, addOutfit, defaultOutfit])
    button.hidden = !mine(character);
  // What the owner shows on a character (ad_use_status, _title, _closet).
  const show = state.viewer;
  item.querySelector(".stats-section").hidden =
    !show.stats && !show.exp && !show.rank;
  item.querySelector(".stats").hidden = !show.stats;
  item.querySelector(".titles-section").hidden = !show.titles;
  // The closet needs the 전신 too: an outfit is a 전신 (member/skin/
  // viewer.skin.php:7, member/viewer.php:79).
  // Relations are an approved character's (mypage/character/viewer.php:157,
  // member/skin/viewer.skin.php:201).
  item.querySelector(".relations-section").hidden =
    character.data.state !== "approved";
  item.querySelector(".closet-section").hidden = !show.closet || !bodyUsed();
  let loaded = false;
  const refresh = async () => {
    await loadFieldCatalogue();
    // What the page shows beside the sheet, in one read.
    const shown = await query("characters/sheet:details", {
      character: character.id,
    });
    if (state.fieldCatalogue.length)
      renderFields(item.querySelector(".character-fields"), {
        data: { fields: shown.fields },
      });
    const status = shown.status;
    // The points not yet given to a stat (status.inc.php's space point).
    const spent = status.definitions.reduce(
      (total, definition) =>
        total + (status.state.stats[definition.id]?.allocated ?? 0),
      0,
    );
    const left = Math.max(0, status.state.points - spent);
    const approved = status.state.approved === true;
    item.querySelector(".progression").textContent = [
      state.viewer.exp ? expText(state.names, status.state.exp) : "",
      state.viewer.rank && status.rank ? status.rank : "",
      state.viewer.stats
        ? `능력치 포인트 ${status.state.points} (남은 ${left})`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    item.querySelector(".stats").replaceChildren();
    for (const definition of status.definitions) {
      const li = document.createElement("li");
      const stat = status.state.stats[definition.id];
      // 최대값 기준 출력 (st_use_max): against the stat's 최대값.
      li.textContent = `${definition.data.name ?? definition.id}: ${stat.current} / ${
        definition.data.useMax ? definition.data.max : stat.max
      }`;
      item.querySelector(".stats").append(li);
    }
    // Once approved, only the points left are spent, and no stat goes below
    // what it has (mypage/character/status.inc.php:17-25, 60).
    allocate.hidden =
      !state.viewer.stats ||
      !mine(character) ||
      !status.definitions.length ||
      (approved && !left);
    allocate.onclick = () =>
      edit(
        approved
          ? `남은 능력치 포인트 배분 (남은 ${left})`
          : "능력치 포인트 배분",
        status.definitions.map((definition) => ({
          name: definition.id,
          label: `${definition.data.name ?? definition.id}에 배분할 포인트${definition.data.help ? ` (${definition.data.help})` : ""}`,
          type: "number",
          value: status.state.stats[definition.id].allocated,
          min: approved ? status.state.stats[definition.id].allocated : 0,
        })),
        async (allocation) => {
          await mutate("characters/progression:allocateStats", {
            character: character.id,
            revision: status.revision,
            allocation: Object.fromEntries(
              Object.entries(allocation).map(([key, value]) => [
                key,
                Number(value),
              ]),
            ),
          });
          await refresh();
        },
      );
    const titles = shown.titles;
    const titleChoice = item.querySelector(".title-choice");
    item.querySelector(".titles").replaceChildren();
    titleChoice.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "타이틀 없음";
    titleChoice.append(none);
    for (const title of titles) {
      const span = document.createElement("span");
      span.textContent = `${title.data.name}${status.state.activeTitle === title.id ? " (표시 중)" : ""}`;
      if (title.data.image?.startsWith("https://")) {
        const image = document.createElement("img");
        image.src = title.data.image;
        image.alt = title.data.name;
        image.className = "title-image";
        span.prepend(image);
      }
      item.querySelector(".titles").append(span, " ");
      const option = document.createElement("option");
      option.value = title.id;
      option.textContent = title.data.name;
      titleChoice.append(option);
    }
    titleChoice.value = status.state.activeTitle ?? "";
    titleChoice.hidden = !mine(character) || !titles.length;
    titleChoice.onchange = () =>
      run(async () => {
        await mutate("characters/progression:equipTitle", {
          character: character.id,
          title: titleChoice.value || null,
        });
        await refresh();
      });
    item.querySelector(".couples").replaceChildren();
    for (const couple of shown.couples) {
      const li = document.createElement("li");
      li.textContent = `${couple.partner?.name ?? "삭제된 캐릭터"}${couple.data.since ? ` · ${couple.data.since}부터` : ""}`;
      item.querySelector(".couples").append(li);
    }
    const clothes = shown.wardrobe;
    item.querySelector(".relations").replaceChildren();
    // rm_order, then the newest first, as the query answers them; one with
    // no summary is not shown (relation_list.php:4, 31-34).
    for (const row of shown.relations.filter((row) =>
      String(row.data.memo ?? "").trim(),
    )) {
      const li = document.createElement("li");
      const target = row.target;
      // The other character's page (viewer.php?ch_id=), when it still exists.
      const name = target
        ? Object.assign(document.createElement("a"), {
            href: `/character/${encodeURIComponent(target.id)}`,
            textContent: target.name,
          })
        : "삭제된 캐릭터";
      li.append(
        name,
        " ",
        Object.assign(document.createElement("span"), {
          className: "affinity",
          textContent: hearts(row.data.affinity),
          title: `호감도 ${affinityOf(row.data.affinity)}`,
        }),
        `: ${row.data.memo}`,
      );
      // rm_link: several addresses, one per line (viewer.skin.php:243-251).
      const links = String(row.data.link ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("https://"));
      links.forEach((address, index) => {
        const link = document.createElement("a");
        link.href = address;
        link.textContent =
          links.length > 1 ? `관계 링크 ${index + 1}` : "관계 링크";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        li.append(" ", link);
      });
      if (mine(character)) {
        const change = document.createElement("button");
        change.type = "button";
        change.textContent = "수정";
        change.onclick = () => relationEditor(row);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            if (!confirm("이 관계를 지울까요?")) return;
            await mutate("characters/relations:removeRelation", {
              id: row.id,
            });
            await refresh();
          });
        li.append(" ", change, " ", remove);
      }
      item.querySelector(".relations").append(li);
    }
    item.querySelector(".wardrobe").replaceChildren();
    for (const clothing of clothes) {
      const li = document.createElement("li");
      const image = document.createElement("img");
      image.src = clothing.data.image;
      image.alt = clothing.data.name;
      image.className = "outfit-image";
      // closet.php's big viewer: the outfit at full size.
      const full = document.createElement("a");
      full.href = clothing.data.image;
      full.target = "_blank";
      full.rel = "noopener";
      full.append(image);
      li.append(full, clothing.data.name);
      if (mine(character)) {
        const wear = document.createElement("button");
        wear.type = "button";
        wear.textContent =
          character.data.outfit === clothing.id ? "사용 중" : "사용";
        wear.disabled = character.data.outfit === clothing.id;
        wear.onclick = () =>
          run(async () => {
            const result = await mutate("characters/wardrobe:wear", {
              character: character.id,
              outfit: clothing.id,
            });
            character = result.document;
            await refresh();
          });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.onclick = () =>
          run(async () => {
            if (!confirm("이 의상을 지울까요?")) return;
            await mutate("characters/wardrobe:removeOutfit", {
              id: clothing.id,
            });
            await refresh();
          });
        // cloest_path_update.php: a new name or address for the outfit.
        const change = document.createElement("button");
        change.type = "button";
        change.textContent = "수정";
        change.onclick = () =>
          edit(
            "의상 수정",
            [
              {
                name: "name",
                label: "의상 이름",
                value: clothing.data.name,
                required: true,
                max: 80,
              },
              {
                name: "image",
                label: "이미지 주소 (HTTPS)",
                value: clothing.data.image,
                max: 2000,
              },
              {
                name: "file",
                label: "또는 이미지 파일",
                type: "file",
                accept: "image/*",
              },
            ],
            async ({ name, image, file }) => {
              const uploaded = file ? await uploadMedia(file) : null;
              await mutate("characters/wardrobe:editOutfit", {
                id: clothing.id,
                name,
                image: uploaded?.url ?? image,
              });
              await refresh();
            },
          );
        li.append(" ", wear, " ", change, " ", remove);
      }
      item.querySelector(".wardrobe").append(li);
    }
    let portrait = item.querySelector(".character-image");
    // The outfit is the 전신 (member/viewer.php:76), never the 두상.
    const src = character.data.image;
    if (src && !portrait) {
      portrait = document.createElement("img");
      portrait.className = "character-image";
      portrait.alt = character.data.name;
      item.prepend(portrait);
    }
    if (portrait && src) portrait.src = src;
    else if (portrait) portrait.remove();
    loaded = true;
  };
  // mypage/character/relation_list.php: the other character is named, and
  // found by its name (relation_update.php), with one read.
  const relationEditor = (row?) =>
    run(async () => {
      const current = row?.target ?? null;
      edit(
        "캐릭터 관계",
        [
          {
            name: "target",
            label: "상대 캐릭터 이름",
            value: current?.name ?? "",
            required: true,
            max: 40,
            suggest: "character",
          },
          {
            name: "affinity",
            label: "호감도",
            value: String(affinityOf(row?.data.affinity)),
            options: [5, 4, 3, 2, 1, 0].map((n) => [
              String(n),
              n ? `${n} : ${"♡".repeat(n)}` : "0",
            ]),
          },
          {
            name: "memo",
            label: "관계 설명",
            value: row?.data.memo,
            multiline: true,
            max: 2000,
          },
          {
            name: "link",
            label: "관계 링크 (HTTPS, 여러 개는 한 줄에 하나씩)",
            value: row?.data.link,
            multiline: true,
            max: 2000,
          },
          {
            name: "order",
            label: "정렬 순서",
            value: row?.data.order ?? 0,
            type: "number",
          },
        ],
        async (data) => {
          const { document: target } = data.target.trim()
            ? await query("characters/sheet:named", {
                name: data.target.trim(),
                approved: true,
              })
            : { document: null };
          if (!target || target.id === character.id)
            return say("그 이름의 다른 캐릭터를 찾을 수 없습니다.");
          await mutate("characters/relations:relation", {
            ...data,
            target: target.id,
            ...(row ? { id: row.id, revision: row.revision } : {}),
            character: character.id,
            affinity: Number(data.affinity),
            order: Number(data.order),
          });
          await refresh();
        },
      );
    });
  addRelation.onclick = () => relationEditor();
  addOutfit.onclick = () =>
    edit(
      "의상 등록",
      [
        { name: "name", label: "의상 이름", required: true, max: 80 },
        { name: "image", label: "이미지 주소 (HTTPS)", max: 2000 },
        {
          name: "file",
          label: "또는 이미지 파일",
          type: "file",
          accept: "image/*",
        },
      ],
      async ({ name, image, file }) => {
        const uploaded = file ? await uploadMedia(file) : null;
        if (uploaded) image = uploaded.url;
        await mutate("characters/wardrobe:outfit", {
          character: character.id,
          name,
          image,
        });
        await refresh();
      },
    );
  defaultOutfit.onclick = () =>
    run(async () => {
      const result = await mutate("characters/wardrobe:wear", {
        character: character.id,
        outfit: null,
      });
      character = result.document;
      await refresh();
    });
  details.ontoggle = () => {
    if (details.open && !loaded) run(refresh);
  };
}
$("tabCharacters").onclick = () =>
  run(async () => {
    showTab("characters");
    if (!state.charactersLoaded) await loadCharacters();
  });
$("characterFilter").onchange = () => run(() => loadCharacters());
/**
 * The registration form's pictures (character_form.php's 캐릭터 이미지
 * 정보): each used one as an upload, or an address where the owner asks.
 */
function renderImageInputs() {
  const labels = state.images
    .filter((slot) => slot.use)
    .map((slot) => {
      const label = document.createElement("label");
      label.append(slot.label);
      if (slot.help)
        label.append(
          Object.assign(document.createElement("small"), {
            className: "help",
            textContent: ` ${slot.help}`,
          }),
        );
      const input = document.createElement("input");
      input.dataset.image = slot.key;
      if (slot.url) {
        input.type = "url";
        input.placeholder = "https://";
        input.maxLength = 2000;
      } else {
        input.type = "file";
        input.accept = "image/*";
      }
      label.append(input);
      return label;
    });
  $("characterImages").replaceChildren(...labels);
}
/** The edit dialog's fields for the used pictures. */
function imageEdits(current): EditField[] {
  return state.images
    .filter((slot) => slot.use)
    .map((slot) =>
      slot.url
        ? {
            name: `image:${slot.key}`,
            label: `${slot.label} (HTTPS 주소)`,
            value: current.data[slot.key] ?? "",
            max: 2000,
          }
        : {
            name: `imageUpload:${slot.key}`,
            label: `${slot.label} 바꾸기 (선택)`,
            type: "file",
            accept: "image/*",
          },
    );
}
/** A relation's affinity as 0 to 5 hearts; older values are clamped. */
const affinityOf = (value) =>
  Math.min(5, Math.max(0, Math.round(Number(value) || 0)));
const hearts = (value) =>
  "♥".repeat(affinityOf(value)) + "♡".repeat(5 - affinityOf(value));
const bodyUsed = () =>
  state.images.some((slot) => slot.slot === "body" && slot.use);
/** The 흉상 and 전신 on a character's page; the worn outfit is the 전신. */
function viewerFigures(character, outfit) {
  const figures = document.createElement("div");
  figures.className = "viewer-figures";
  for (const slot of state.images) {
    if (slot.slot === "thumb" || !slot.use) continue;
    const src =
      slot.slot === "body"
        ? (outfit ?? character.data.body)
        : character.data.head;
    if (typeof src !== "string" || !src.startsWith("https://")) continue;
    figures.append(
      Object.assign(new Image(), {
        src,
        alt: `${character.data.name} ${slot.label}`,
        className: `viewer-${slot.slot}`,
      }),
    );
  }
  return figures;
}
/** The owner's community settings, read once a page load. */
let settingsRead;
const communitySettings = () => (settingsRead ??= memberSettings());

/**
 * mypage/character/character_form.php: the registration form, with the
 * owner's custom fields and 소속·종족 lists, opened from 마이페이지.
 */
export async function openCharacterForm() {
  await loadChoices();
  renderImageInputs();
  $("characterForm").hidden = false;
  $("characterName").focus();
}
$("characterForm").onsubmit = (event) => {
  event.preventDefault?.();
  run(async () => {
    const name = $<HTMLInputElement>("characterName").value.trim();
    if (!name) return;
    const images = {};
    for (const input of $("characterImages").querySelectorAll<HTMLInputElement>(
      "[data-image]",
    )) {
      const file = input.files?.[0];
      const value = file
        ? (await uploadMedia(file)).url
        : input.type === "file"
          ? ""
          : input.value.trim();
      if (value) images[input.dataset.image] = value;
    }
    const fields = Object.fromEntries(
      [
        ...$("characterFields").querySelectorAll<HTMLInputElement>(
          "[data-field]",
        ),
      ]
        .map((input) => [input.dataset.field, input.value.trim()])
        .filter(([, value]) => value),
    );
    for (const input of $("characterFields").querySelectorAll<HTMLInputElement>(
      "[data-field-upload]",
    )) {
      const chosen = input.files?.[0];
      if (!chosen) continue;
      const uploaded = await uploadMedia(chosen);
      fields[input.dataset.fieldUpload] = uploaded.url;
    }
    const { document: character } = await mutate("characters/sheet:save", {
      data: {
        name,
        side: $<HTMLInputElement | HTMLSelectElement>(
          "characterSide",
        ).value.trim(),
        class: $<HTMLInputElement | HTMLSelectElement>(
          "characterClass",
        ).value.trim(),
        profile: $<HTMLTextAreaElement>("characterProfile").value.trim(),
        ...images,
        state: $<HTMLSelectElement>("characterState").value,
        ...(Object.keys(fields).length ? { fields } : {}),
      },
    });
    state.speakers = null;
    // A first character became the member's 대표 on the server.
    if (state.profile && !state.profile.data.mainCharacter)
      show((await query("community/profiles:own")).profile);
    // The lists read it again when next shown; 마이페이지 shows it now.
    state.charactersLoaded = false;
    $<HTMLFormElement>("characterForm").reset?.();
    $("characterForm").hidden = true;
    $("myAccountTab").click();
    say(`${character.data.name}을(를) 등록했습니다.`);
  });
};

/**
 * A character's own page (member/viewer.php): the whole sheet open, a large
 * picture, and what the viewer adds: the experience history (exp.php) and,
 * where the owner shows them, the inventory and the owner's money.
 */
export async function openCharacter(id) {
  showTab("character");
  route(`character/${id}`, { replace: true });
  $("characterSheet").replaceChildren();
  if (!state.sides) await loadChoices();
  const {
    document: character,
    nicks,
    outfitImage,
  } = await query("characters/sheet:sheet", { id });
  if (!character) throw new Error("캐릭터를 찾을 수 없습니다.");
  pageTitle(character.data.name);
  keepNicks(nicks);
  const item = await characterItem(character);
  item.classList.add("viewer");
  const details = item.querySelector<HTMLDetailsElement>(".character-details");
  details.open = true;
  details.ontoggle?.(undefined);
  const sheet = await query("characters/progression:characterSheet", {
    character: id,
  });
  // The inventory, where the owner shows it.
  const inventory = sheet.inventory ?? null;
  const extras = document.createElement("div");
  extras.className = "viewer-extras";
  const heading = (text) => {
    const h3 = document.createElement("h3");
    h3.textContent = text;
    return h3;
  };
  const exp = document.createElement("ul");
  exp.className = "viewer-exp";
  const showExp = (rows) => {
    for (const row of rows) {
      const li = document.createElement("li");
      li.textContent = `${formatTime(row.at)} · ${row.delta > 0 ? "+" : ""}${row.delta} (총 ${row.exp})${row.memo ? ` · ${row.memo}` : ""}`;
      exp.append(li);
    }
  };
  showExp(sheet.exp);
  // member/exp.php pages its history; here the next page follows on.
  let expCursor = sheet.expCursor ?? null;
  const moreExp = document.createElement("button");
  moreExp.type = "button";
  moreExp.className = "viewer-more-exp";
  moreExp.textContent = "더 보기";
  moreExp.hidden = !expCursor;
  moreExp.onclick = () =>
    run(async () => {
      const next = await query("characters/progression:characterSheet", {
        character: id,
        after: expCursor,
      });
      showExp(next.exp);
      expCursor = next.expCursor ?? null;
      moreExp.hidden = !expCursor;
    });
  if (!sheet.exp.length)
    exp.append(
      Object.assign(document.createElement("li"), {
        textContent: `${state.names.expName} 내역이 없습니다.`,
      }),
    );
  // The experience history (member/exp.php) follows ad_use_exp too.
  if (state.viewer.exp)
    extras.append(heading(`${state.names.expName} 내역`), exp, moreExp);
  if (inventory) {
    const title = heading("인벤토리");
    if (sheet.balance !== null) {
      const money = document.createElement("span");
      money.className = "viewer-money";
      money.textContent = moneyText(state.names, sheet.balance);
      title.append(" ", money);
    }
    const list = document.createElement("ul");
    list.className = "viewer-inventory";
    for (const entry of inventory) {
      const li = document.createElement("li");
      if (entry.image?.startsWith("https://"))
        li.append(
          Object.assign(new Image(), {
            src: entry.image,
            alt: "",
            loading: "lazy",
          }),
        );
      li.append(entry.name);
      list.append(li);
    }
    if (!inventory.length)
      list.append(
        Object.assign(document.createElement("li"), {
          textContent: "아이템이 없습니다.",
        }),
      );
    extras.append(title, list);
  } else if (sheet.balance !== null) {
    const money = heading("소지금");
    money.append(` ${moneyText(state.names, sheet.balance)}`);
    extras.append(money);
  }
  const outfit = bodyUsed() ? outfitImage : null;
  $("characterSheet").replaceChildren(
    viewerFigures(character, outfit),
    item,
    extras,
  );
}
