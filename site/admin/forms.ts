// The admin page's sections: their forms and checks are the server's
// (_naru/modules/admin-model.ts, which the owner's mutations check each save
// with); the menu and how a section and a member are named are the page's.
import { rename } from "../app/names.js";
import { models } from "../_naru/modules/admin-model.js";

export {
  models,
  buildRecord,
  fieldValue,
  formValues,
  REVIEW_STATES,
} from "../_naru/modules/admin-model.js";
export type { Model, ModelField } from "../_naru/modules/admin-model.js";

/**
 * The admin menu, in the original's groups (adm/admin.menu100–900.php), each
 * section once. The site's own additions sit with what they belong to.
 */
export const menu = [
  { label: "환경설정", sections: ["settings", "design", "menus", "banners"] },
  { label: "회원관리", sections: ["members", "activity", "visits"] },
  {
    label: "게시판관리",
    sections: ["boards", "board_groups", "content", "quests", "emoticons"],
  },
  {
    label: "캐릭터관리",
    sections: [
      "character_fields",
      "character_images",
      "character_review",
      "character_state",
      "titles",
      "title_holdings",
      "levels",
      "stat_config",
      "couples",
      "sides",
      "classes",
    ],
  },
  {
    label: "아이템 관리",
    sections: [
      "items",
      "shop_entries",
      "inventory",
      "gacha",
      "explore",
      "recipes",
      "history",
      "wallets",
      "grants",
    ],
  },
  // adm/admin.menu900.php's 기타관리.
  { label: "기타관리", sections: ["popups", "polls", "backup"] },
];

/**
 * A group's sections as the menu lists them: as in the original, 소속 and
 * 종족 are left out while untitled, unless one is open.
 */
export function shownSections(group, names, current = null) {
  return group.sections.filter(
    (name) =>
      name === current ||
      !(
        (name === "sides" && !names.sideTitle) ||
        (name === "classes" && !names.classTitle)
      ),
  );
}

/**
 * A section's name in the owner's names (기타 항목명 설정), as the original's
 * menu says "랭킹 설정 관리", "화폐 관리", "소속 관리".
 */
export function sectionLabel(name, names) {
  if (name === "levels") return `${names.rankName} 설정`;
  if (name === "wallets") return `${names.moneyName} 관리`;
  if (name === "sides") return `${names.sideTitle || "소속"} 관리`;
  if (name === "classes") return `${names.classTitle || "종족"} 관리`;
  return rename(models[name].label, names);
}

/**
 * One member's line in 회원 관리 (adm/member_list.php): what the original's
 * columns show, from a row of admin/members:list.
 */
export function memberSummary({ row, lastSeen }) {
  const data = row.data;
  return [
    `등급 ${Number.isSafeInteger(data.level) ? data.level : 2}`,
    data.role === "moderator" ? "게시물 운영자" : "회원",
    data.warnings > 0 ? `경고 ${data.warnings}회` : "",
    data.left ? `탈퇴 ${data.left}` : "",
    data.blocked ? `차단 ${data.blocked}` : "",
    row.deleted ? "삭제된 회원" : "",
    row.recommender ? `추천인 ${row.recommender}` : "",
    `최종 접속 ${lastSeen ? new Date(lastSeen).toLocaleString("ko-KR") : "기록 없음"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
