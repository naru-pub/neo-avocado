// The member's 대표 character, the one their card shows.
import { signedIn } from "../../modules/access.js";
import { ownCharacter } from "../../modules/characters.js";
import { profileOf, setMainCharacter } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

export async function mainCharacter(
  ctx: MutationCtx,
  { character }: { character?: string } = {},
) {
  const member = signedIn(ctx);
  const row = await ownCharacter(ctx, character);
  if (!row)
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 대표로 정할 수 있습니다.", {
      reason: "not_owned",
    });
  if (!(await profileOf(ctx, member)))
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  await setMainCharacter(ctx, member, String(row.id));
  return { document: await profileOf(ctx, member) };
}
