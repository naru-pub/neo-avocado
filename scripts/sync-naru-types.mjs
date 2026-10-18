// Copies Naru's own type declarations for SDK 1.1.0 from sdk.naru.pub:
// functions.d.ts for the site's code (types/naru-functions.d.ts, which
// site/_naru/modules/naru-types.ts re-exports) and naru.d.ts for the pages'
// client (types/naru.d.ts, which tsconfig.json maps
// the SDK's address to). Run after Naru changes them: npm run sync:naru.
import { writeFile } from "node:fs/promises";

const BASE = "https://sdk.naru.pub/sdk/1.1.0/";
const FILES = {
  "functions.d.ts": "types/naru-functions.d.ts",
  "naru.d.ts": "types/naru.d.ts",
};

for (const [name, target] of Object.entries(FILES)) {
  const response = await fetch(BASE + name);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  await writeFile(
    new URL(`../${target}`, import.meta.url),
    await response.text(),
  );
  console.log(`${target} ← ${BASE}${name}`);
}
