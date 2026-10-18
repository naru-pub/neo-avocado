// Who is here (bbs/current_connect.php) and each day's visits
// (adm/visit_list.php and its breakdowns). A browser counts once a Korean
// day, as the original's visit cookie does; a member also reports where they
// are as they move between pages. Nothing polls.
import { kstDay, one, parsed } from "../../modules/access.js";
import { loginReward } from "../../modules/members.js";
import type { MutationCtx } from "../../modules/naru-types.js";

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

const MAPS = [
  "members",
  "hours",
  "browsers",
  "os",
  "devices",
  "domains",
] as const;

/**
 * A visit: for a member, where they are now; for everyone, the day's
 * counters (Korean days and hours), by browser, OS, device and the site that
 * sent them. Those four come from the page and are only counted.
 */
export async function seen(
  ctx: MutationCtx,
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
  const joined = ctx.member
    ? Boolean(
        await one(ctx, "SELECT 1 FROM profiles WHERE member = ?", [
          ctx.member.id,
        ]),
      )
    : false;
  // 현재접속자 leaves out the site's owner (bbs/current_connect.php:11).
  if (joined && !ctx.owner)
    await ctx.sql`
      INSERT INTO presence (member, place, at) VALUES (${ctx.member.id}, ${where}, ${ctx.now})
      ON CONFLICT (member) DO UPDATE SET place = excluded.place, at = excluded.at`;
  // The day's first page pays the login reward, as the original's first
  // login of the day does (common.php:401); any later page that day finds
  // the day in the wallet and pays nothing.
  if (joined) await loginReward(ctx);
  // Only a visit is counted; a member's other calls only say where they are.
  if (visit !== true) return null;
  const day = kstDay(ctx.now);
  const hour = String(new Date(ctx.now + 9 * 3600 * 1000).getUTCHours());
  const row = await one<Record<string, any>>(
    ctx,
    "SELECT * FROM visits WHERE day = ?",
    [day],
  );
  const counts = Object.fromEntries(
    MAPS.map((key) => [key, parsed<Record<string, number>>(row?.[key], {})]),
  ) as Record<(typeof MAPS)[number], Record<string, number>>;
  const bump = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };
  // A member is one visitor a day, however many visits their browser
  // says it makes (the original's one row an IP a day).
  if (ctx.member && counts.members[ctx.member.id]) return null;
  if (ctx.member) bump(counts.members, ctx.member.id);
  bump(counts.hours, hour);
  bump(counts.browsers, known("browser", browser));
  bump(counts.os, known("os", os));
  bump(counts.devices, known("device", device));
  if (domain) bump(counts.domains, site(counts.domains, domain));
  const json = (key: (typeof MAPS)[number]) => JSON.stringify(counts[key]);
  await ctx.sql`
    INSERT INTO visits (day, total, guests, members, hours, browsers, os, devices, domains)
    VALUES (${day}, ${(row?.total ?? 0) + 1}, ${(row?.guests ?? 0) + (ctx.member ? 0 : 1)},
      ${json("members")}, ${json("hours")}, ${json("browsers")}, ${json("os")},
      ${json("devices")}, ${json("domains")})
    ON CONFLICT (day) DO UPDATE SET total = excluded.total, guests = excluded.guests,
      members = excluded.members, hours = excluded.hours, browsers = excluded.browsers,
      os = excluded.os, devices = excluded.devices, domains = excluded.domains`;
  return null;
}
