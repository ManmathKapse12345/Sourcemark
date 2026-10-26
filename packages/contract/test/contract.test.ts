import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contract from "../src/index.js";

const root = join(import.meta.dirname, "..");
const load = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

describe("analysis wire contract", () => {
  it("fixtures parse with the Zod schemas", () => {
    expect(() => contract.AnalyzeRequest.parse(load("fixtures/analyze-request.json"))).not.toThrow();
    expect(() => contract.AnalyzeResponse.parse(load("fixtures/analyze-response.json"))).not.toThrow();
  });

  it("exported JSON Schema files are up to date with the Zod schemas", () => {
    for (const file of readdirSync(join(root, "schema"))) {
      const name = file.replace(/\.json$/, "") as keyof typeof contract;
      const fresh = z.toJSONSchema(contract[name] as z.ZodType, { target: "draft-2020-12" });
      expect(load(`schema/${file}`), `${file} is stale: run npm run contract:export`).toEqual(
        JSON.parse(JSON.stringify(fresh)),
      );
    }
  });

  it("fixtures validate against the exported JSON Schema", () => {
    const ajv = new Ajv2020.default({ strict: false });
    addFormats.default(ajv);
    expect(ajv.validate(load("schema/AnalyzeRequest.json"), load("fixtures/analyze-request.json"))).toBe(true);
    expect(ajv.validate(load("schema/AnalyzeResponse.json"), load("fixtures/analyze-response.json"))).toBe(true);
  });

  it("rejects a finding without an origin", () => {
    const bad = load("fixtures/analyze-response.json");
    bad.findings[0].origins = [];
    expect(contract.AnalyzeResponse.safeParse(bad).success).toBe(false);
  });
});

describe("API bodies", () => {
  it("requires a reason for disputes", () => {
    expect(contract.FindingResponseBody.safeParse({ action: "DISPUTE" }).success).toBe(false);
    expect(contract.FindingResponseBody.safeParse({ action: "DISPUTE", reason: "Approved by legal" }).success).toBe(true);
  });

  it("requires some content for a new version", () => {
    expect(contract.CreateVersionBody.safeParse({}).success).toBe(false);
    expect(contract.CreateVersionBody.safeParse({ applyResponses: true }).success).toBe(true);
  });
});
