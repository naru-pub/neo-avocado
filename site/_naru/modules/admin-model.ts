// The admin's sections (admin/): each one's form, and `buildRecord`, which
// checks what a form sends and makes the record its table keeps. The page
// draws its forms from these; the owner's mutations in admin/ check every
// save with them (modules/admin.ts), so a form's rules hold on the server.
// Each area's sections, with their own rules, are in admin-models/, as the
// admin menu groups them.
import { colorOf } from "./design.js";
import { boardsModels } from "./admin-models/boards.js";
import { charactersModels } from "./admin-models/characters.js";
import { configModels } from "./admin-models/config.js";
import { itemsModels } from "./admin-models/items.js";
import { membersModels } from "./admin-models/members.js";
import { otherModels } from "./admin-models/other.js";
import {
  kstStamp,
  nonnegative,
  plainHttps,
  type Model,
} from "./admin-models/shared.js";

export type { Model, ModelField } from "./admin-models/shared.js";

/** Every section's model, by section. */
export const models: Record<string, Model> = {
  ...configModels,
  ...membersModels,
  ...boardsModels,
  ...charactersModels,
  ...itemsModels,
  ...otherModels,
};

export function fieldValue(data, key) {
  return key.split(".").reduce((value, part) => value?.[part], data);
}
function setField(data, key, value) {
  const path = key.split(".");
  let target = data;
  for (const part of path.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== "object") target[part] = {};
    target = target[part];
  }
  if (value === undefined) delete target[path.at(-1)];
  else target[path.at(-1)] = value;
}
/**
 * A pick from one of the owner's lists (references[field.from]): its ID, or
 * its name with valueBy "name"; several with `multiple`. With an empty list
 * and `fallbackText`, any short text.
 */
function picked(field, value, references) {
  const rows = references[field.from] ?? [];
  const choices = rows.map((row) =>
    field.valueBy === "name" ? row.data.name : row.id,
  );
  if (field.multiple) {
    const list = Array.isArray(value) ? value : [];
    if (list.some((entry) => !choices.includes(entry)))
      throw new Error(`${field.label}을(를) 확인하세요.`);
    return [...new Set(list)];
  }
  if (!value) return field.valueBy === "name" ? "" : null;
  if (!choices.length && field.fallbackText) {
    if (typeof value !== "string" || value.length > (field.max ?? 40))
      throw new Error(`${field.label}을(를) 확인하세요.`);
    return value.trim();
  }
  if (!choices.includes(value))
    throw new Error(`${field.label}을(를) 선택하세요.`);
  return value;
}
export function buildRecord(section, values, previous, references) {
  const model = models[section];
  if (!model) throw new Error("알 수 없는 관리 항목입니다.");
  const id = model.fixedId ?? values.id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw new Error("ID는 영문·숫자·밑줄·하이픈 1~64자로 입력하세요.");
  const data = structuredClone(previous?.data ?? {});
  for (const field of model.fields) {
    // A section title on the form, as the original's settings page has.
    if (field.type === "heading" || field.type === "group") continue;
    const value = values[field.key];
    if (field.transient) {
      if (value === undefined && !field.required) continue;
      if (
        typeof value !== "string" ||
        (field.required && !value.trim()) ||
        value.length > field.max
      )
        throw new Error(`${field.label}을(를) 입력하세요.`);
      continue;
    }
    let result;
    if (field.type === "checkbox") result = Boolean(value);
    // A whole number that may be negative (글읽기 포인트).
    else if (field.type === "signed") {
      result = Number(value ?? 0);
      if (!Number.isSafeInteger(result) || Math.abs(result) > 1_000_000_000)
        throw new Error(`${field.label}을(를) 정수로 입력하세요.`);
    } else if (field.type === "number" || field.type === "optional-number")
      result =
        field.type === "optional-number" &&
        (value === "" || value === undefined)
          ? undefined
          : nonnegative(Number(value));
    else if (field.type === "decimal") {
      result = Number(value);
      if (!Number.isFinite(result) || result < 0)
        throw new Error("무게는 유한한 0 이상의 수여야 합니다.");
    } else if (field.type === "tokens") {
      if (typeof value !== "string" || value.length > 2000)
        throw new Error("세력·종족 목록을 확인하세요.");
      result = [
        ...new Set(
          value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      ];
    } else if (field.type === "ingredients") {
      if (!Array.isArray(value)) throw new Error("재료 목록을 확인하세요.");
      const ids = new Set();
      let total = 0;
      result = value.map((row) => {
        const count = nonnegative(Number(row.count));
        if (
          !count ||
          ids.has(row.item) ||
          !references.items.some((item) => item.id === row.item)
        )
          throw new Error(
            "재료는 존재하는 아이템을 중복 없이 선택하고 개수를 입력하세요.",
          );
        ids.add(row.item);
        total += count;
        return {
          item: row.item,
          count,
          ...(field.consumes ? { consume: row.consume === true } : {}),
        };
      });
      if (total > field.maxCount || (section === "recipes" && !total))
        throw new Error(`재료는 1~${field.maxCount}개로 설정하세요.`);
    } else if (field.type === "pick") {
      result = picked(field, value, references);
    } else if (field.type === "choice" && field.multiple) {
      // Several of a choice's options (design_form.php's 상·하·좌·우).
      const choices = field.options.map(([id]) => id);
      const list = Array.isArray(value) ? value : [];
      if (list.some((entry) => !choices.includes(entry)))
        throw new Error(`${field.label}을(를) 확인하세요.`);
      result = choices.filter((choice) => list.includes(choice));
    } else if (field.type === "css-color") {
      // A colour design_form.php's text fields take, or nothing.
      if (
        typeof value !== "string" ||
        (value.trim() !== "" && colorOf(value) === null)
      )
        throw new Error(
          `${field.label}은(는) #000000, rgba(0, 0, 0, .5) 꼴로 입력하세요.`,
        );
      result = value.trim();
    } else if (
      ["item", "stat", "title", "choice", "profile"].includes(field.type)
    ) {
      if (field.optional && !value)
        result = ["gacha", "explore"].includes(section) ? null : undefined;
      else {
        const choices = field.options
          ? field.options.map(([id]) => id)
          : references[
              field.type === "item"
                ? "items"
                : field.type === "stat"
                  ? "stats"
                  : field.type === "profile"
                    ? "profiles"
                    : "titles"
            ].map((row) => row.id);
        if (!choices.includes(value))
          throw new Error(`${field.label}을(를) 선택하세요.`);
        result = value;
      }
    } else if (field.type === "titles") {
      if (
        !Array.isArray(value) ||
        value.some((id) => !references.titles.some((row) => row.id === id))
      )
        throw new Error("지급할 타이틀을 확인하세요.");
      result = [...new Set(value)];
    } else {
      if (
        typeof value !== "string" ||
        value.length > (field.max ?? 2000) ||
        (field.required && !value.trim())
      )
        throw new Error(`${field.label}을(를) 확인하세요.`);
      result = value.trim();
      if (field.type === "url" && value && !plainHttps(value))
        throw new Error("이미지는 인증 정보 없는 HTTPS 주소여야 합니다.");
      if (field.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(result))
        throw new Error(`${field.label}을(를) 확인하세요.`);
      if (
        field.type === "date" &&
        value &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new Error("날짜를 확인하세요.");
      if (
        field.type === "character" &&
        !(field.optional && !value) &&
        !references.characters.some((row) => row.id === value)
      )
        throw new Error("존재하는 캐릭터를 선택하세요.");
    }
    setField(data, field.key, result);
  }
  if (model.readOnly) throw new Error("기록은 수정할 수 없습니다.");
  model.check?.(data, { id, values, previous, references });
  return { id, data };
}

/** The review's states, as the original's 수정중, 신청, 승인. */
export const REVIEW_STATES = ["editing", "submitted", "approved", "deleted"];

/**
 * A record's data as its form shows it (what `buildRecord` reads back): a
 * saved record's values, or a new one's defaults. A save that sends only
 * some fields keeps the others from this. `references.stats` gives a
 * character record's stat fields.
 */
export function formValues(
  section: string,
  data: Record<string, any> | null,
  references: { stats?: { id: string }[] } = {},
): Record<string, unknown> {
  const model = models[section];
  const values: Record<string, unknown> = {};
  for (const field of model?.fields ?? []) {
    if (["heading", "group"].includes(field.type) || field.transient) continue;
    const value =
      section === "quests" && field.key === "images"
        ? Array.isArray(data?.images)
          ? data.images.join("\n")
          : ""
        : (fieldValue(data, field.key) ??
          (data ? field.default : (field.newDefault ?? field.default)));
    values[field.key] =
      field.type === "checkbox"
        ? Boolean(value)
        : field.type === "tokens"
          ? Array.isArray(value)
            ? value.join(", ")
            : (value ?? "")
          : ["ingredients", "titles"].includes(field.type) ||
              (["pick", "choice"].includes(field.type) && field.multiple)
            ? Array.isArray(value)
              ? value
              : []
            : field.type === "choice"
              ? (value ?? field.options[0][0])
              : (value ?? "");
  }
  if (section === "character_state")
    for (const definition of references.stats ?? []) {
      const stat = data?.stats?.[definition.id];
      const initial = (definition as any).data?.initial ?? 0;
      values[`allocated:${definition.id}`] = stat?.allocated ?? 0;
      values[`damage:${definition.id}`] =
        stat?.damage ?? (stat?.max ?? initial) - (stat?.current ?? initial);
    }
  return values;
}
