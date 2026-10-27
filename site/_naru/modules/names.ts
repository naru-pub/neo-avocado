import type { Data } from "./json.js";
// 기타 항목명 설정 (adm/community_form.php): the owner's names for money,
// experience, rank, 소속 and 종족 (cf_money, cf_money_pice, cf_exp_name,
// cf_exp_pice, cf_rank_name, cf_side_title, cf_class_title), the template's
// own until changed. The site's code and its pages (app/names.ts) read them
// alike. An empty 소속 or 종족 title hides it, as in the original.

export const NAME_DEFAULTS = Object.freeze({
  moneyName: "아보",
  moneyUnit: "아보",
  expName: "경험치",
  expUnit: "",
  rankName: "랭킹",
  sideTitle: "소속",
  classTitle: "종족",
});

/** The owner's names, by the keys of NAME_DEFAULTS. */
export type Names = { -readonly [K in keyof typeof NAME_DEFAULTS]: string };

/** The names in stored settings, defaults for what the owner left unset. */
export function namesOf(settings: Data = {}): Names {
  const names = {} as Names;
  for (const [key, fallback] of Object.entries(NAME_DEFAULTS)) {
    const value = settings?.[key];
    names[key as keyof Names] =
      typeof value === "string" &&
      (value.trim() || ["expUnit", "sideTitle", "classTitle"].includes(key))
        ? value.trim().slice(0, 20)
        : fallback;
  }
  return names;
}
