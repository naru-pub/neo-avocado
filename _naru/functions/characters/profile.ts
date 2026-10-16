import { ownCharacter } from "../../modules/shared.js";
import { profileOf, setMainCharacter } from "../../modules/members.js";
import type { Ctx } from "../../modules/naru-types.js";

export async function mainCharacter(
  ctx: Ctx,
  { character }: { character?: string } = {},
) {
  if (!(await ownCharacter(ctx, character)))
    ctx.fail("ACCESS_DENIED", "내 캐릭터만 대표로 정할 수 있습니다.", {
      reason: "not_owned",
    });
  if (!(await profileOf(ctx, ctx.member.id)))
    ctx.fail("CONFLICT", "먼저 닉네임을 등록해 주세요.", {
      reason: "no_profile",
    });
  await setMainCharacter(ctx, ctx.member.id, character);
  return { document: await profileOf(ctx, ctx.member.id) };
}
