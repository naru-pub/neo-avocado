import {
  PROFILES,
  MEMBERS,
  communityAccess,
  text,
} from "../../modules/shared.js";

export function membership(ctx) {
  const access = communityAccess(ctx);
  return {
    ok: true,
    ...access,
    memberId: ctx.member.id,
    profile: ctx.get(PROFILES, ctx.member.id),
  };
}

export function join(ctx, { nick, acceptMessages = true } = {}) {
  const access = communityAccess(ctx);
  const old = ctx.get(PROFILES, ctx.member.id);
  const profile = ctx.set(PROFILES, ctx.member.id, {
    ...old?.data,
    owner: ctx.member.id,
    nick: text(nick, 20, true),
    acceptMessages: acceptMessages !== false,
  });
  if (!ctx.get(MEMBERS, ctx.member.id))
    ctx.set(MEMBERS, ctx.member.id, {
      role: "member",
      requestedAt: ctx.now,
    });
  return { ok: true, profile, ...access };
}
