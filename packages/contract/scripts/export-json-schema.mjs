// Writes JSON Schema files for the analysis wire format, generated from the Zod schemas.
// The Python service validates its real output against these files in its tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as contract from "../dist/index.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(outDir, { recursive: true });

const names = [
  "AnalyzeRequest",
  "AnalyzeResponse",
  "ParseResponse",
  "ExtractGuidelineResponse",
  "EmbedRequest",
  "EmbedResponse",
  "SuggestRulesRequest",
  "SuggestRulesResponse",
];

for (const name of names) {
  const schema = z.toJSONSchema(contract[name], { target: "draft-2020-12" });
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(schema, null, 2) + "\n");
}
console.log(`Wrote ${names.length} schemas to ${outDir}`);
