// Deploys dist/ to Naru from GitHub Actions (Naru's GitHub CI deploys, as
// its docs/github-ci.md describes): with the run's OIDC token, plans a
// deployment of every file's path, size and SHA-256, uploads the files Naru
// asks for, and finalizes, which publishes them. The site's GitHub Actions
// target must name this repository and the ref the workflow runs on.
//
//   node scripts/deploy-naru.mjs <directory> <naru login> [target folder]
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const [directory = "dist", site, targetPrefix = ""] = process.argv.slice(2);
if (!site) throw new Error("Usage: deploy-naru.mjs <directory> <naru login>");
const NARU = process.env.NARU_ORIGIN ?? "https://naru.pub";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token)
    throw new Error(
      "No OIDC token: the job needs `permissions: id-token: write`.",
    );
  const response = await fetch(`${url}&audience=${encodeURIComponent(NARU)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`OIDC token request: ${response.status}`);
  return (await response.json()).value;
}

async function files(root, folder = root) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await files(root, path)));
    else {
      const body = await readFile(path);
      found.push({
        path: relative(root, path).split(sep).join("/"),
        size: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
        contentType: TYPES[extname(path).toLowerCase()],
        body,
      });
    }
  }
  return found;
}

async function call(path, token, body) {
  const response = await fetch(`${NARU}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false)
    throw new Error(`${path}: ${result.message ?? response.status}`);
  return result;
}

const manifest = await files(directory);
const token = await oidcToken();
const plan = await call("/api/deploy/github/plan", token, {
  site,
  targetPrefix,
  manifest: {
    files: manifest.map(({ path, size, sha256, contentType }) => ({
      path,
      size,
      sha256,
      ...(contentType ? { contentType } : {}),
    })),
  },
});
const byPath = new Map(manifest.map((file) => [file.path, file]));
for (const upload of plan.uploads) {
  const response = await fetch(upload.url, {
    method: upload.method ?? "PUT",
    headers: upload.headers ?? {},
    body: byPath.get(upload.path).body,
  });
  if (!response.ok)
    throw new Error(`Uploading ${upload.path}: ${response.status}`);
}
// Plan and finalize each check the token, which lasts minutes: ask again.
const finalized = await call("/api/deploy/github/finalize", await oidcToken(), {
  deploymentId: plan.deploymentId,
});
// Finalize answers once the files are published; the site's code (_naru/)
// activates after, since its migrations can take minutes. Wait for it, so a
// release Naru refuses fails the deploy.
if (finalized.functions?.status === "activating") {
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const { functions } = await call(
      "/api/deploy/github/status",
      await oidcToken(),
      { deploymentId: plan.deploymentId },
    );
    if (!functions || functions.status === "active") break;
    if (functions.status === "refused")
      throw new Error(
        `Naru refused the site's code: ${functions.error?.message} ${JSON.stringify(functions.error?.details ?? {})}. The files are published; the previous code stays active.`,
      );
    if (Date.now() > deadline)
      throw new Error("The site's code is still activating after 15 minutes.");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
console.log(
  `Deployed ${manifest.length} files to ${site} (${plan.uploads.length} uploaded, ${plan.deletedPaths?.length ?? 0} removed).`,
);
