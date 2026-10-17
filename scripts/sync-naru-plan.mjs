// Copies Naru's plan rule (naru-pub edge/src/plan.ts) into tests/naru-plan.mjs,
// for tests/sql-ctx.mjs to hold statements to it as Naru does:
//
//   node scripts/sync-naru-plan.mjs ../naru-pub/edge/src/plan.ts
//
// Its one import, Naru's DataError, becomes a plain Error with the same
// message.
import ts from "typescript";
import { format } from "prettier";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [source] = process.argv.slice(2);
if (!source) {
  console.error(
    "usage: node scripts/sync-naru-plan.mjs <naru-pub>/edge/src/plan.ts",
  );
  process.exit(1);
}
const text = await readFile(source, "utf8");
const IMPORT =
  /^import \{ DataError \} from "[^"]*\/site-data\/validation";\n/m;
if (!IMPORT.test(text))
  throw new Error(
    "plan.ts no longer imports only DataError; update this script.",
  );
const { outputText } = ts.transpileModule(
  text.replace(
    IMPORT,
    "class DataError extends Error {\n  constructor(_status: number, message: string) {\n    super(message);\n  }\n}\n",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
);
const out = fileURLToPath(new URL("../tests/naru-plan.mjs", import.meta.url));
await writeFile(
  out,
  await format(
    "// Naru's plan rule, from naru-pub edge/src/plan.ts by\n" +
      "// scripts/sync-naru-plan.mjs: don't edit; sync it when Naru's changes.\n" +
      outputText,
    { parser: "babel" },
  ),
);
console.log(`wrote ${out}`);
