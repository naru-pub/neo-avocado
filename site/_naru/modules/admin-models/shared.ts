// What the admin sections' models (admin-model.ts and its areas) share: the
// shape of a form and of a section, and the checks more than one makes.
import type { Data } from "../json.js";

/** A record's data, as an admin form makes it and the tables keep it. */
export type { Data };
/** A row of one of the owner's lists a form picks from. */
export interface Reference {
  id: string;
  data: Data;
  createdBy?: string | null;
}
/** The owner's lists a form picks from, by name (references[field.from]). */
export type References = Record<string, Reference[]>;
/** A choice's options: [value, text] pairs. */
export type Options = readonly (readonly [value: string, text: string])[];
/** One field of a section's form. */
export interface ModelField {
  // Headings (type "heading") have no key.
  key?: string;
  label: string;
  type?: string;
  default?: unknown;
  /** A new record's value, where a saved one without the key means `default`. */
  newDefault?: unknown;
  max?: number;
  optional?: boolean;
  required?: boolean;
  options?: Options;
  image?: boolean;
  from?: string;
  valueBy?: string;
  transient?: boolean;
  maxCount?: number;
  fallbackText?: boolean;
  multiple?: boolean;
  images?: boolean;
  consumes?: boolean;
}
/** One admin section: its form and how its records are kept. */
export interface Model {
  label: string;
  help?: string;
  // Reports have none.
  fields?: ModelField[];
  fixedId?: string;
  readOnly?: boolean;
  /** Rows that only come with something else: nothing to register here. */
  noCreate?: boolean;
  noDelete?: boolean;
  memberKey?: boolean;
  characterKey?: boolean;
  holdings?: boolean;
  report?: string;
  review?: boolean;
  /**
   * The section's own rules, after its fields are read: refusing what its
   * form does not allow (with an Error the owner sees), or completing `data`.
   */
  check?(
    data: Data,
    context: {
      id: string;
      values: Data;
      previous: { data: Data } | null;
      references: References;
    },
  ): void;
}

export const nonnegative = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("숫자는 0 이상의 정수여야 합니다.");
  return value;
};
/** A Korean local datetime-local value as milliseconds; null when blank, NaN when invalid. */
export function kstStamp(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return NaN;
  const stamp = Date.parse(`${value}+09:00`);
  return Number.isFinite(stamp) &&
    new Date(stamp + 9 * 3600000).toISOString().slice(0, value.length) === value
    ? stamp
    : NaN;
}
/** An HTTPS address with no user name or password in it. */
export function plainHttps(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** A menu's or banner's 보기 등급, 1–10. */
export function viewLevel(data: Data) {
  if (data.level < 1 || data.level > 10)
    throw new Error("보기 등급은 1~10입니다.");
}

/** An item's or listing's 진열 기간's hours (0–23) and weekdays. */
export function displayWindow(data: Data) {
  if (!data.display) return;
  const { fromHour, untilHour, weekdays } = data.display;
  for (const hour of [fromHour, untilHour])
    if (
      hour !== undefined &&
      hour !== null &&
      !(Number.isInteger(hour) && hour >= 0 && hour <= 23)
    )
      throw new Error("진열 시각은 0~23시로 입력하세요.");
  if (
    Array.isArray(weekdays) &&
    weekdays.some(
      (day) => !["일", "월", "화", "수", "목", "금", "토"].includes(day),
    )
  )
    throw new Error(
      "진열 요일은 일, 월, 화, 수, 목, 금, 토 중에서 적어 주세요.",
    );
}

export const schedule = [
  {
    key: "startsAt",
    label: "시작 (한국 시간, 빈칸: 제한 없음)",
    type: "datetime-local",
    max: 19,
  },
  {
    key: "endsAt",
    label: "종료 (한국 시간, 빈칸: 제한 없음)",
    type: "datetime-local",
    max: 19,
  },
];
