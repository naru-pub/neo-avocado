import { PRESENCE, PROFILES, VISITS, kstDay } from "../../modules/shared.js";
import type { Ctx } from "../../modules/naru-types.js";

// Who is here (bbs/current_connect.php) and each day's visits
// (adm/visit_list.php and its breakdowns). A browser counts once a Korean
// day, as the original's visit cookie does; a member also reports where they
// are as they move between pages. Nothing polls. Who is here, and where, is
// for members only: a place can name a members-only board.
export const visitors = ["seen"];
export const readOnly = ["online"];

/** How long a member counts as here after their last page. */
const HERE_FOR = 10 * 60 * 1000;

/** What a page may report: anything else counts as 기타, so counts stay few. */
const KNOWN = {
  browser: ["Chrome", "Safari", "Firefox", "Edge", "Samsung", "Whale"],
  os: ["Windows", "macOS", "iOS", "Android", "Linux"],
  device: ["PC", "모바일", "태블릿"],
};
const known = (kind: keyof typeof KNOWN, value: string | undefined): string =>
  KNOWN[kind].includes(value) ? value : "기타";
/** Referring sites, up to 200 a day; the rest count as 기타. */
const site = (counts: Record<string, number> = {}, value: unknown) =>
  typeof value === "string" &&
  /^[a-z0-9.-]{1,100}$/.test(value) &&
  (Object.hasOwn(counts, value) || Object.keys(counts).length < 200)
    ? value
    : "기타";

/**
 * A visit: for a member, where they are now; for everyone, the day's
 * counters (Korean days and hours), by browser, OS, device and the site that
 * sent them. Those four come from the page and are only counted.
 */
export async function seen(
  ctx: Ctx,
  {
    where = "",
    visit = false,
    browser,
    os,
    device,
    domain,
  }: {
    /** Where the member is: a page or board, at most 40 characters. */
    where?: string;
    /** A browser's first page of the Korean day. */
    visit?: boolean;
    browser?: string;
    os?: string;
    device?: string;
    /** The site that sent them. */
    domain?: string;
  } = {},
) {
  if (typeof where !== "string" || where.length > 40)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  // 현재접속자 leaves out the site's owner (bbs/current_connect.php:11).
  if (ctx.member && !ctx.owner) {
    const profile = await ctx.get(PROFILES, ctx.member.id);
    if (profile)
      await ctx.set(PRESENCE, ctx.member.id, {
        nick: profile.data.nick,
        where,
        at: ctx.now,
      });
  }
  // Only a visit is counted; a member's other calls only say where they are.
  if (visit !== true) return null;
  const day = kstDay(ctx.now);
  const hour = String(new Date(ctx.now + 9 * 3600 * 1000).getUTCHours());
  const visits = (await ctx.get(VISITS, day))?.data ?? {};
  const bump = (counts: Record<string, number> | undefined, key: string) => ({
    ...counts,
    [key]: (counts?.[key] ?? 0) + 1,
  });
  await ctx.set(VISITS, day, {
    day,
    total: (visits.total ?? 0) + 1,
    guests: (visits.guests ?? 0) + (ctx.member ? 0 : 1),
    members: ctx.member
      ? bump(visits.members, ctx.member.id)
      : (visits.members ?? {}),
    hours: bump(visits.hours, hour),
    browsers: bump(visits.browsers, known("browser", browser)),
    os: bump(visits.os, known("os", os)),
    devices: bump(visits.devices, known("device", device)),
    domains: domain
      ? bump(visits.domains, site(visits.domains, domain))
      : (visits.domains ?? {}),
  });
  return null;
}

/** The members seen in the last ten minutes, most recent first. */
export async function online(ctx: Ctx) {
  const { documents } = await ctx.list(PRESENCE, {
    where: { gte: ["at", ctx.now - HERE_FOR] },
    sort: [["at", "desc"]],
    size: 100,
  });
  return {
    members: documents.map((row) => ({
      nick: row.data.nick,
      where: row.data.where,
      at: row.data.at,
    })),
  };
}
