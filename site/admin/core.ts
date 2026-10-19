// What every part of the admin page shares: the owner's client and the page's
// state, each section's calls, the forms' references and the owner's names,
// and run().
import { type NaruClient } from "https://sdk.naru.pub/sdk/1.1.0/naru.js";
import { type Names, NAME_DEFAULTS, namesOf, rename } from "../app/names.js";
import { imageSlotsOf } from "../_naru/modules/images.js";
import {
  type AdminCall,
  RECORD_CALLS,
  OWN_CALLS,
  SETTINGS_SECTIONS,
  adminCall,
} from "../_naru/modules/admin-calls.js";
import { renderNav } from "./main.js";

export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export let grantTitleId;
export let naru: NaruClient,
  owner,
  section = "main",
  cursor = null,
  selected = null;
// 기타 항목명 설정, from 커뮤니티 설정: the menu and labels use them.
export let itemNames: Names = NAME_DEFAULTS;
// 커뮤니티 설정's 한페이지당 라인수: a new board's rows a page.
export let newBoardRows = 15;
// 캐릭터 이미지 항목: the 두상, 흉상 and 전신, named as the owner set them.
export let imageSlots = imageSlotsOf();
// Rows the forms pick from, by kind (admin/references; the server checks
// what is picked against its own).
export let references: Record<string, any[]> = {
  fields: [],
  characters: [],
  titles: [],
  stats: [],
  items: [],
  profiles: [],
};
/**
 * Each section's calls (modules/admin-calls.ts): its own module's, a
 * settings form's, or admin/records', which every call names its section
 * for.
 */
export const CALLS: Record<
  string,
  Partial<Record<AdminCall, string>>
> = Object.fromEntries(
  [
    ...new Set([
      ...Object.keys(RECORD_CALLS),
      ...Object.keys(OWN_CALLS),
      ...SETTINGS_SECTIONS,
    ]),
  ].map((section) => [
    section,
    Object.fromEntries(
      (["list", "get", "save", "remove"] as const)
        .map((call) => [call, adminCall(section, call)])
        .filter(([, name]) => name),
    ),
  ]),
);
/** What the forms pick from, read again whenever one opens. */
export async function loadReferences() {
  references = await owner.query("admin/references:references");
  return references;
}
export function message(error) {
  // A site function's own ctx.fail message comes with a reason.
  if (error?.details?.reason) return error.message;
  return error?.code === "CONFLICT"
    ? "다른 창에서 바뀌었습니다. 다시 불러온 뒤 수정하세요."
    : error?.code === "NOT_FOUND"
      ? "자료를 찾을 수 없습니다. 삭제되었는지 확인하세요."
      : error?.code === "ACCESS_DENIED"
        ? "사이트 소유자 권한이 필요합니다."
        : error?.code === "AUTH_REQUIRED"
          ? "운영자 로그인이 끝났습니다. 다시 로그인하세요."
          : (error?.message ?? "처리하지 못했습니다.");
}
export async function run(action) {
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
export let routing = false;
/** A report's filters, from its address when it was opened by one. */
export let reportFilters = [];
/** The owner's names, read again after 커뮤니티 설정 is saved. */
export async function loadNames() {
  const settings = await owner.query(CALLS.settings.get, {
    section: "settings",
  });
  itemNames = namesOf(settings?.data);
  // cf_page_rows: a new board's 한 페이지 글 수 (bo_page_rows' default).
  const rows = settings?.data?.pageRows;
  newBoardRows =
    Number.isSafeInteger(rows) && rows >= 1 ? Math.min(rows, 100) : 15;
  const profile = await owner.query(CALLS.character_images.get, {
    section: "character_images",
  });
  imageSlots = imageSlotsOf(profile?.data);
  renderNav();
}
/** Template text in the owner's names; 커뮤니티 설정 keeps the original's. */
export function named(text) {
  return section === "settings" ? text : rename(text, itemNames);
}

// Writes to the shared state from the other modules.
export function setNaru(value: typeof naru) {
  naru = value;
}
export function setOwner(value: typeof owner) {
  owner = value;
}
export function setSection(value: typeof section) {
  section = value;
}
export function setCursor(value: typeof cursor) {
  cursor = value;
}
export function setSelected(value: typeof selected) {
  selected = value;
}
export function setItemNames(value: typeof itemNames) {
  itemNames = value;
}
export function setNewBoardRows(value: typeof newBoardRows) {
  newBoardRows = value;
}
export function setImageSlots(value: typeof imageSlots) {
  imageSlots = value;
}
export function setReferences(value: typeof references) {
  references = value;
}
export function setGrantTitleId(value: typeof grantTitleId) {
  grantTitleId = value;
}
export function setRouting(value: typeof routing) {
  routing = value;
}
export function setReportFilters(value: typeof reportFilters) {
  reportFilters = value;
}
