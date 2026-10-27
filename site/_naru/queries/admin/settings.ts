// The owner's settings, one form each: 커뮤니티 설정 (adm/community_form.php),
// 디자인 (adm/design_form.php) and 프로필 기본 항목
// (adm/character_article_list.php's 기본 항목).

import { ownerOnly } from "../../modules/access.js";
import { settingsRecord } from "../../modules/admin.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** A settings section's record (`section`: settings, design or character_images), or null. */
export const get = ownerOnly(
  (ctx: QueryCtx, { section }: { section?: string }) =>
    settingsRecord(ctx, section),
);
