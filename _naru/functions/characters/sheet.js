import {
  PREFIX,
  SETTINGS,
  SIDES,
  CLASSES,
  deleteCommunityDocument,
  text,
  imageUrl,
} from "../../modules/shared.js";
import { notDeleted, startValue, startWrite } from "../../modules/community.js";
import { memberSheet, presentCharacter } from "../../modules/characters.js";

// A member's character sheets: name, side, profile, picture and the custom
// fields the admin defines. Members read them natively (rules/characters.js).

const CHARACTERS = `${PREFIX}characters`;

/**
 * Registers a character (no `id`) or edits one of the member's own (`id`,
 * with the `revision` it was read at). Custom fields are checked against
 * their definitions, and the sheet's type and state against the review.
 */
/**
 * A value from the owner's list (소속 or 종족), or any short text while the
 * list is empty. A value the character already has stays, so deleting it
 * from the list does not stop the member editing the rest.
 */
async function listed(ctx, collection, value, kept, label) {
  const chosen = text(value ?? "", 40);
  if (!chosen || chosen === kept) return chosen;
  const { documents } = await ctx.list(collection, { size: 100 });
  const names = documents
    .filter((row) => !row.data.deleted)
    .map((row) => row.data.name);
  if (names.length && !names.includes(chosen))
    ctx.fail("INVALID_REQUEST", `${label}을(를) 목록에서 골라 주세요.`, {
      reason: "invalid_input",
    });
  return chosen;
}

/**
 * The owner's switches, as the original's 캐릭터생성 가능 and 수정 가능
 * (cf_2, cf_3) and cf_character_count: a member registers only while
 * creation is open and below the limit, and edits an approved character only
 * while editing is.
 */
async function checkPeriod(ctx, previous) {
  if (ctx.owner) return;
  const settings = (await ctx.get(SETTINGS, "community"))?.data ?? {};
  if (previous) {
    // An application can always be finished, as the original's viewer
    // offers 수정 on any unapproved character (viewer.php:101).
    if (
      settings.characterEditing === false &&
      previous.data.state === "approved"
    )
      ctx.fail("ACCESS_DENIED", "현재 캐릭터 수정 기간이 아닙니다.", {
        reason: "editing_closed",
      });
    return;
  }
  if (settings.characterCreation === false)
    ctx.fail("ACCESS_DENIED", "현재 캐릭터 생성 기간이 아닙니다.", {
      reason: "creation_closed",
    });
  const limit = Number.isSafeInteger(settings.characterLimit)
    ? settings.characterLimit
    : CHARACTER_LIMIT;
  if (limit > 0) {
    const owned = await ctx.count(CHARACTERS, {
      filter: { owner: ctx.member.id },
      where: { ne: ["deleted", true] },
    });
    if (owned >= limit)
      ctx.fail("CONFLICT", `캐릭터는 ${limit}명까지 만들 수 있습니다.`, {
        reason: "character_limit",
        limit,
      });
  }
}
/** Characters a member may have unless the owner sets another number. */
const CHARACTER_LIMIT = 1;

export async function save(
  ctx,
  { id = null, data = {}, revision = null } = {},
) {
  const { previous } = await startWrite(ctx, CHARACTERS, { id, revision });
  notDeleted(ctx, previous);
  await checkPeriod(ctx, previous);
  if (!data || typeof data !== "object")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  let value = startValue(ctx, previous, null);
  const sheet = await memberSheet(ctx, previous, data);
  const catalogue = sheet.catalogue;
  value = {
    ...value,
    name: text(data.name, 40, true),
    side: await listed(ctx, SIDES, data.side, previous?.data.side, "소속"),
    class: await listed(ctx, CLASSES, data.class, previous?.data.class, "종족"),
    profile: text(data.profile ?? "", 4000),
    type: sheet.type,
    state: sheet.state,
    fields: sheet.fields,
  };
  delete value.fieldMedia;
  if (data.image !== previous?.data.image)
    value.image = data.image ? imageUrl(data.image) : null;
  delete value.imageId;
  const document = previous
    ? await ctx.set(CHARACTERS, previous.id, value)
    : await ctx.add(CHARACTERS, value);
  return { document: await presentCharacter(ctx, document, { catalogue }) };
}

/**
 * Deletes one of the member's characters with what hangs off it, in bounded
 * steps: call again until it answers `done`.
 */
export async function remove(ctx, { id } = {}) {
  const { previous } = await startWrite(ctx, CHARACTERS, { id });
  return await deleteCommunityDocument(ctx, CHARACTERS, "characters", previous);
}
