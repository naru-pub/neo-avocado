// The owner's names for money, experience, rank, 소속 and 종족, as the
// site's code reads them (_naru/modules/names.ts), and how pages write
// amounts in them.
export { NAME_DEFAULTS, namesOf, type Names } from "../_naru/modules/names.js";

/** 1,000, as the original's number_format. */
export function amountText(amount) {
  return typeof amount === "number"
    ? amount.toLocaleString("ko-KR")
    : String(amount);
}

/** An amount of money: "1,000 아보". */
export function moneyText(names, amount) {
  return names.moneyUnit
    ? `${amountText(amount)} ${names.moneyUnit}`
    : amountText(amount);
}

/** An amount of experience: "경험치 30" or, with a unit, "경험치 30exp". */
export function expText(names, amount) {
  return `${names.expName} ${amountText(amount)}${names.expUnit}`;
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
