import {
  PROFILES,
  MEMBERS,
  communityAccess,
  text,
} from "../../modules/shared.js";

export async function membership(ctx) {
  const access = await communityAccess(ctx);
  return {
    ok: true,
    ...access,
    memberId: ctx.member.id,
    profile: await ctx.get(PROFILES, ctx.member.id),
  };
}

export async function join(ctx, { nick, acceptMessages = true } = {}) {
  const access = await communityAccess(ctx);
  const old = await ctx.get(PROFILES, ctx.member.id);
  const profile = await ctx.set(PROFILES, ctx.member.id, {
    ...old?.data,
    owner: ctx.member.id,
    nick: text(nick, 20, true),
    acceptMessages: acceptMessages !== false,
  });
  if (!(await ctx.get(MEMBERS, ctx.member.id)))
    await ctx.set(MEMBERS, ctx.member.id, {
      role: "member",
      requestedAt: ctx.now,
    });
  return { ok: true, profile, ...access };
}
