// How long each screen takes to finish loading, on naru-dev with the delays
// measured from Korea to naru.pub added to every request: a request with a
// member's token goes through the edge to the control plane (CONTROL_MS),
// anything else is answered at the edge (EDGE_MS).
//
//   NARU_REPO_PATH=/path/to/naru PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
//     node tests/bench.mjs [site directory]
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = process.env.NARU_REPO_PATH;
if (!repo) throw new Error("Set NARU_REPO_PATH to a Naru checkout.");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const site = resolve(
  process.argv[2] ?? fileURLToPath(new URL("../dist/", import.meta.url)),
);
const EDGE_MS = Number(process.env.EDGE_MS ?? 300);
const CONTROL_MS = Number(process.env.CONTROL_MS ?? 1000);
// Set to model every SDK request (with a token or not) served from one place.
const API_MS = process.env.API_MS ? Number(process.env.API_MS) : null;
const RUNS = Number(process.env.RUNS ?? 3);
const port = Number(process.env.BENCH_PORT ?? 4400);
const origin = `http://localhost:${port}`;
const state = await mkdtemp(join(tmpdir(), "neo-avocado-bench-"));

const naru = spawn(
  "pnpm",
  ["naru-dev", site, "--site", "neo-avocado", "--port", String(port)].concat([
    "--state",
    state,
  ]),
  {
    cwd: join(repo, "control-plane"),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
naru.stdout.on("data", (chunk) => (log += chunk));
naru.stderr.on("data", (chunk) => (log += chunk));
for (let tries = 0; !log.includes("naru-dev: neo-avocado"); tries++) {
  if (tries > 600) throw new Error(`naru-dev did not start:\n${log}`);
  await new Promise((done) => setTimeout(done, 200));
}

const browser = await chromium.launch();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A browser of its own, whose requests to Naru take as long as from Korea. */
async function person() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const meter = { slow: false, pending: 0, last: 0, edge: 0, control: 0 };
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const control =
      Boolean(request.headers().authorization) ||
      new URL(request.url()).pathname.startsWith("/api/membership/");
    if (!meter.slow) return route.continue();
    meter.pending++;
    meter[control ? "control" : "edge"]++;
    const api = new URL(request.url()).pathname.startsWith("/api/");
    await sleep(
      API_MS !== null && api ? API_MS : control ? CONTROL_MS : EDGE_MS,
    );
    try {
      await route.continue();
    } finally {
      // The response arrives once the request has gone through.
      request
        .response()
        .then((response) => response?.finished())
        .catch(() => {})
        .finally(() => {
          meter.pending--;
          meter.last = performance.now();
        });
    }
  });
  return { page, meter };
}

/** Times `action` until Naru has been quiet for a while; the page is done. */
async function measure({ page, meter }, action) {
  meter.slow = true;
  meter.edge = meter.control = 0;
  const start = performance.now();
  meter.last = start;
  await action(page);
  // Settled: nothing in flight for 2 s (longer than any delay we add).
  while (meter.pending > 0 || performance.now() - meter.last < 2000)
    await sleep(50);
  meter.slow = false;
  return {
    ms: Math.round(meter.last - start),
    edge: meter.edge,
    control: meter.control,
  };
}

async function signInAs(page, name) {
  await page.goto(`${origin}/`);
  await page.locator("#signIn").click();
  await page.waitForURL(/members\/sign-in/);
  await page.locator("input[name=as]:not([type=hidden])").fill(name);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(`${origin}/`);
}

const results = [];
const record = (name, sample) => {
  let row = results.find((entry) => entry.name === name);
  if (!row) results.push((row = { name, samples: [] }));
  row.samples.push(sample);
};

try {
  // Setup, without delays: a public board, fields, two members, posts.
  const owner = await person();
  await owner.page.goto(`${origin}/admin/`);
  await owner.page.locator("#adminSignIn").click();
  await owner.page.locator("#adminWorkspace").waitFor();
  await owner.page.evaluate(async () => {
    const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
    const admin = await createNaru().auth.session();
    const save = (section, id, values) =>
      admin.mutate(`admin/${section}:save`, { id, values, create: true });
    await save("boards", "default", {
      name: "자유",
      kind: "text",
      listLevel: 1,
      readLevel: 1,
      writeLevel: 1,
      commentLevel: 1,
      actions: true,
    });
    await save("character_fields", "age", { label: "나이", type: "text" });
    await save("items", "apple", { name: "사과", price: 10, hidden: false });
  });
  const people = {};
  for (const [name, nick] of [
    ["alice", "앨리스"],
    ["bob", "밥"],
  ]) {
    const who = await person();
    await signInAs(who.page, name);
    await who.page.locator("#nick").fill(nick);
    await who.page.locator("#profileForm button").click();
    await who.page.locator("#community").waitFor();
    await who.page.evaluate(async (nick) => {
      const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
      const member = await createNaru().members.session();
      await member.mutate("characters/sheet:save", {
        data: { name: `${nick}의 캐릭터`, profile: "", fields: { age: "17" } },
      });
      for (let n = 0; n < 8; n++) {
        const { document: post } = await member.mutate(
          "community/posts:write",
          {
            data: {
              board: "default",
              image: null,
              text: `${nick}의 로그 ${n}`,
            },
          },
        );
        if (n % 2)
          await member.mutate("community/comments:write", {
            data: { logId: post.id, text: "댓글" },
          });
      }
      await member.mutate("community/presence:seen", { where: "home" });
    }, nick);
    people[name] = who;
  }
  const visitor = await person();
  await visitor.page.goto(`${origin}/`);
  await visitor.page
    .locator("#logs .log")
    .first()
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      console.error(await visitor.page.locator("body").innerText());
      throw error;
    });

  for (let run = 0; run < RUNS; run++) {
    record(
      "visitor: page load",
      await measure(visitor, (page) => page.reload()),
    );
    const { page } = people.alice;
    record(
      "member: page load",
      await measure(people.alice, (page) => page.reload()),
    );
    await page.locator("#logs .log").first().waitFor();
    record(
      "member: open comments",
      await measure(people.alice, (page) =>
        page.locator("#logs .log .comments > summary").first().click(),
      ),
    );
    record(
      "member: post a log",
      await measure(people.alice, async (page) => {
        await page.locator("#board").selectOption("default");
        await page.locator("#logText").fill(`벤치 ${run}`);
        await page.locator('#logForm [type="submit"]').click();
      }),
    );
    record(
      "member: 멤버목록 tab",
      await measure(people.alice, (page) =>
        page.locator("#tabCharacters").click(),
      ),
    );
    await page.locator("#characters .character").first().waitFor();
    record(
      "member: character details",
      await measure(people.alice, (page) =>
        page
          .locator("#characters .character .character-details summary")
          .first()
          .click(),
      ),
    );
    record(
      "member: 상점 tab",
      await measure(people.alice, (page) => page.locator("#tabShop").click()),
    );
    record(
      "member: 쪽지 tab",
      await measure(people.alice, (page) =>
        page.locator("#tabMessages").click(),
      ),
    );
    // Tabs load once per page; the next run starts from a fresh page.
  }
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(
    JSON.stringify(
      results.map(({ name, samples }) => ({
        name,
        ms: median(samples.map((s) => s.ms)),
        edge: median(samples.map((s) => s.edge)),
        control: median(samples.map((s) => s.control)),
      })),
    ),
  );
} catch (error) {
  console.error(log.split("\n").slice(-30).join("\n"));
  throw error;
} finally {
  await browser.close();
  try {
    process.kill(-naru.pid);
  } catch {
    /* already gone */
  }
  await rm(state, { recursive: true, force: true });
}
