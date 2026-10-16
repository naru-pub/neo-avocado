// 기타 항목명 설정 (adm/community_form.php): the owner's names for money,
// experience, rank, 소속 and 종족. The same defaults as the server's
// NAME_DEFAULTS in _naru/modules/shared.js.

export const NAME_DEFAULTS = Object.freeze({
  moneyName: "아보",
  moneyUnit: "아보",
  expName: "경험치",
  expUnit: "",
  rankName: "랭킹",
  sideTitle: "소속",
  classTitle: "종족",
});

/** The names in stored settings, defaults for what the owner left unset. */
export function namesOf(settings = {}) {
  const names = {};
  for (const [key, fallback] of Object.entries(NAME_DEFAULTS)) {
    const value = settings?.[key];
    names[key] =
      typeof value === "string" &&
      (value.trim() || ["expUnit", "sideTitle", "classTitle"].includes(key))
        ? value.trim().slice(0, 20)
        : fallback;
  }
  return names;
}

/** An amount of money: "100 아보". */
export function moneyText(names, amount) {
  return names.moneyUnit ? `${amount} ${names.moneyUnit}` : String(amount);
}

/** An amount of experience: "경험치 30" or, with a unit, "경험치 30exp". */
export function expText(names, amount) {
  return `${names.expName} ${amount}${names.expUnit}`;
}

/**
 * Template text in the owner's names: 아보 (not 아보카도), 경험치, 소속 and
 * 세력, 종족. A hidden 소속 or 종족 keeps its default word.
 */
export function rename(text, names) {
  return String(text)
    .replace(/아보(?!카)/g, names.moneyName)
    .replace(/경험치/g, names.expName)
    .replace(/소속|세력/g, names.sideTitle || "소속")
    .replace(/종족/g, names.classTitle || "종족");
}
