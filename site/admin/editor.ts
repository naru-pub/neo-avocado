// An entry's form, drawn from its section's model (forms.ts), its uploads, and
// saving it.
import { models, sectionLabel, fieldValue } from "./forms.js";
import {
  $,
  CALLS,
  itemNames,
  loadNames,
  loadReferences,
  message,
  named,
  newBoardRows,
  owner,
  references,
  run,
  section,
  selected,
  setSelected,
} from "./core.js";
import { adminRoute } from "./main.js";
import { boardApply } from "./boards.js";
import { load } from "./list.js";
import { openCharacterForm } from "./characters.js";

/**
 * An ID for a new row: the section's name and four random characters, which
 * every section's ID rules accept (a lowercase letter first, then lowercase
 * letters, digits and underscores).
 */
export function suggestedId(section) {
  const prefix = section.replace(/s$/, "").replace(/[^a-z0-9_]/g, "") || "id";
  const random = crypto
    .getRandomValues(new Uint32Array(1))[0]
    .toString(36)
    .padStart(4, "0")
    .slice(-4);
  return `${prefix}_${random}`;
}
export async function openForm(row = null) {
  const requestedSection = section;
  await loadReferences();
  if (requestedSection !== section || !owner) return;
  setSelected(row);
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
      input.type = ["optional-number", "decimal", "signed"].includes(field.type)
        ? "number"
        : ["tokens", "pick", "css-color"].includes(field.type)
          ? "text"
          : (field.type ?? "text");
    if (field.type === "css-color") input.placeholder = "#000000";
    if (["number", "optional-number", "decimal"].includes(field.type)) {
      input.min = "0";
      input.step = field.type === "decimal" ? "any" : "1";
    }
    if (field.type === "signed") input.step = "1";
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
 * A file picker beside an image field: saving uploads the file to Naru Media
 * and its address takes the field's place (quest images: joins the list).
 * Naru's media library searches the site's tables for each upload when it
 * opens, and marks those no row names 참조 없음 (unreferenced).
 */
export function imageUpload(field, value) {
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
    setSelected(
      models[section].fixedId
        ? await owner.mutate(CALLS[section].save, { section, values })
        : await owner.mutate(CALLS[section].save, {
            section,
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
          }),
    );
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
