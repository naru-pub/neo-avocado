// What every community write shares: who is writing (a member, or a guest
// with a name and password), the document they are changing, and whether
// they may. The site functions in functions/community/posts.js and
// comments.js start from here.
import { author, communityAccess } from "./shared.js";
import type {
  Ctx,
  Data,
  GuestCredentials,
  NaruDocument,
} from "./naru-types.js";

/** Who may make a write, for startWrite. */
export interface StartWriteOptions {
  id?: string | null;
  guest?: GuestCredentials | null;
  revision?: string | null;
  guests?: boolean;
  moderated?: boolean;
  owners?: boolean;
}

/** A guest writer: the name they post under and their password. */
export interface GuestWriter {
  name: string;
  secret: string;
}

/**
 * Checks a write to `collection` and returns the writer's access, the
 * document as it is now (null for a new one) and, for a guest, their name
 * and password. Members change their own documents, and with `moderated`
 * a moderator changes anyone's. A guest (`guests`) proves a post is theirs
 * with its password (bbs/password_check.php), which Naru keeps as the
 * document's secret. With `owners`, the site owner changes anyone's, as the
 * original's admin edits every character (adm/character_form_update.php).
 */
export async function startWrite(
  ctx: Ctx,
  collection: string,
  {
    id = null,
    guest: given = null,
    revision = null,
    guests = false,
    moderated = false,
    owners = false,
  }: StartWriteOptions,
) {
  const asOwner = owners && ctx.owner === true;
  if (!ctx.member && !guests && !asOwner)
    ctx.fail("ACCESS_DENIED", "권한이 없습니다.", { reason: "access_denied" });
  if (id !== null && typeof id !== "string")
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const access = await communityAccess(ctx);
  const previous = id === null ? null : await ctx.get(collection, id);
  if (id !== null && !previous)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
  let guest: GuestWriter | null = null;
  if (asOwner) {
    // The site owner needs no password or authorship.
  } else if (!ctx.member) {
    const password = given?.password;
    if (
      typeof password !== "string" ||
      password.length < 4 ||
      password.length > 64
    )
      ctx.fail("ACCESS_DENIED", "비밀번호를 확인해 주세요. (4~64자)", {
        reason: "guest_password",
      });
    if (previous) {
      if (
        !previous.data.guest ||
        !(await ctx.secretMatches(collection, previous.id, password))
      )
        ctx.fail("ACCESS_DENIED", "비밀번호를 확인해 주세요. (4~64자)", {
          reason: "guest_password",
        });
      guest = { name: previous.data.guest.name, secret: password };
    } else {
      const name = given?.name;
      if (typeof name !== "string" || !name.trim() || name.length > 20)
        ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
          reason: "invalid_input",
        });
      guest = { name: name.trim(), secret: password };
    }
  } else if (
    previous &&
    author(previous) !== ctx.member.id &&
    !(moderated && access.role === "moderator")
  )
    ctx.fail("ACCESS_DENIED", "직접 쓴 것만 고치거나 지울 수 있습니다.", {
      reason: "not_owned",
    });
  if (revision && previous?.revision !== revision)
    ctx.fail(
      "CONFLICT",
      "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
      { reason: "conflict" },
    );
  return { access, previous, guest };
}

/** What a new or edited document starts as: its old data, and who owns it. */
export function startValue(
  ctx: Ctx,
  previous: NaruDocument | null,
  guest: GuestWriter | null,
): Data {
  return {
    ...previous?.data,
    owner: previous ? author(previous) : (ctx.member?.id ?? null),
    ...(guest ? { guest: { name: guest.name } } : {}),
  };
}

/** Fails when the document was deleted (deletion may still be finishing). */
export function notDeleted(ctx: Ctx, previous: NaruDocument | null) {
  if (previous?.data.deleted)
    ctx.fail("NOT_FOUND", "자료를 찾을 수 없습니다.", {
      reason: "document_not_found",
    });
}
