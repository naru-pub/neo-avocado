// The character viewer (member/viewer.php): a character's official record
// and its experience history, open to visitors while the site is
// (사이트공개).
import { communitySettings } from "../../modules/access.js";
import {
  characterRow,
  characterState,
  rankAt,
  viewable,
} from "../../modules/characters.js";
import { historyPage, walletOf } from "../../modules/members.js";
import type { QueryCtx } from "../../modules/naru-types.js";

/** Experience history rows a page (member/exp.php's cf_page_rows). */
const EXP_PAGE = 20;

/**
 * What the character viewer adds to the profile: the character's experience
 * history (member/exp.php) a page at a time, newest first, and, where the
 * owner turns it on (ad_use_money), its owner's money; `showsInventory` is
 * whether the owner shows its inventory (ad_use_inven), which economy's
 * inventory:characterInventory answers. A later page (`after`, the
 * `expCursor` of the one before) carries only the history.
 */
export async function characterSheet(
  ctx: QueryCtx,
  {
    character,
    after = null,
    size = EXP_PAGE,
  }: { character?: string; after?: string | null; size?: number } = {},
) {
  await viewable(ctx);
  if (
    (after !== null && typeof after !== "string") ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 50
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const row = await characterRow(ctx, character);
  if (!row)
    ctx.fail("NOT_FOUND", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const page = await historyPage(
    ctx,
    { character: String(row.id), kind: "exp" },
    { size, after },
  );
  const exp = page.documents.map((entry) => ({
    at: entry.data.at,
    delta: entry.data.expDelta,
    exp: entry.data.exp,
    memo: entry.data.memo ?? "",
  }));
  const expCursor = page.nextCursor ?? null;
  if (after !== null) return { exp, expCursor };
  const settings = await communitySettings(ctx);
  const balance =
    settings.viewerMoney === true
      ? (await walletOf(ctx, row.owner)).balance
      : null;
  return {
    exp,
    expCursor,
    showsInventory: settings.viewerInventory === true,
    balance,
  };
}

/** Public character progression is separate from member-editable profile fields. */
export async function characterStatus(
  ctx: QueryCtx,
  { character }: { character?: string } = {},
) {
  await viewable(ctx);
  if (!(await characterRow(ctx, character)))
    ctx.fail("INVALID_REQUEST", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const state = await characterState(ctx, character);
  const { purchases, ...shown } = state.data;
  return {
    state: shown,
    revision: state.revision,
    definitions: state.definitions,
    rank: await rankAt(ctx, state.data.exp),
  };
}
