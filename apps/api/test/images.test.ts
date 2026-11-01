import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, newUser, signIn } from "./helpers.js";

type Client = Awaited<ReturnType<typeof signIn>>;
const images = join(import.meta.dirname, "..", "..", "..", "eval", "images");
const POSTER = readFileSync(join(images, "i15.png"));
const LOGO = readFileSync(join(images, "northfern-logo.png"));

describe("image posts", () => {
  const { app, analysis } = makeApp();
  let admin: Client, creator: Client;
  let base: string;

  beforeAll(async () => {
    const users = { admin: newUser("admin"), creator: newUser("creator") };
    admin = await signIn(app, users.admin);
    creator = await signIn(app, users.creator);
    const orgId = (await admin.post("/api/orgs", { name: "Image Org" }).expect(201)).body.org.id;
    base = `/api/orgs/${orgId}`;
    await admin.post(`${base}/members`, { email: users.creator.email, roles: ["CREATOR"] }).expect(201);
  });

  it("stores the palette and an approved logo file as citable assets", async () => {
    const palette = await admin.post(`${base}/assets`, { name: "Palette", type: "palette", colors: ["#1F4D3A", "#F4EFE6"] }).expect(201);
    expect(palette.body).toMatchObject({ code: "A-1", hasImage: false });
    const logo = await admin.raw().post(`${base}/assets`).set(admin.auth)
      .field("name", "Logo").field("type", "logo").attach("file", LOGO, "logo.png").expect(201);
    expect(logo.body).toMatchObject({ code: "A-2", hasImage: true });
    expect(logo.body.imageData).toBeUndefined();

    const listed = await creator.get(`${base}/assets`).expect(200);
    expect(listed.body.assets.map((a: { code: string }) => a.code)).toEqual(["A-1", "A-2"]);
    expect(listed.body.assets.every((a: object) => !("imageData" in a))).toBe(true);
    const file = await creator.get(`${base}/assets/${logo.body.id}/image`).expect(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(file.body as Buffer, LOGO)).toBe(0);
  });

  it("reviews an image post with the brand assets and keeps boxes and the text read from it", async () => {
    const created = await creator.raw().post(`${base}/content`).set(creator.auth)
      .field("title", "Poster").field("channel", "instagram").attach("file", POSTER, "poster.png").expect(201);
    expect(created.body.item.kind).toBe("image");
    const id = created.body.item.id;

    const detail = await creator.get(`${base}/content/${id}`).expect(200);
    expect(detail.body.versions[0]).toMatchObject({ hasImage: true, imageMime: "image/png" });
    expect(detail.body.versions[0].imageData).toBeUndefined();
    const img = await creator.get(`${base}/content/${id}/versions/${detail.body.versions[0].id}/image`).expect(200);
    expect(img.headers["content-type"]).toBe("image/png");

    await creator.post(`${base}/content/${id}/transitions`, { action: "SUBMIT" }).expect(200);
    const call = analysis.imageCalls.at(-1)!;
    expect(call.bytes).toBe(POSTER.length);
    expect(call.req.alt_text).toBeNull();
    expect(call.req.assets.map((a) => [a.code, a.type, !!a.image_b64])).toEqual([["A-1", "palette", false], ["A-2", "logo", true]]);

    const checked = await creator.get(`${base}/content/${id}`).expect(200);
    const run = checked.body.latestRun;
    expect(run).toMatchObject({ status: "COMPLETED", ocrText: "Now just ₹499" });
    expect(run.notes).toHaveLength(1);
    const colour = run.findings.find((f: { fingerprint: string }) => f.fingerprint === "fp-colour");
    expect(colour).toMatchObject({ sourceType: "asset", sourceCode: "A-1", boxX: 0, boxY: 0.5, boxW: 1, boxH: 0.2 });
    expect(checked.body.versions[0]).toMatchObject({ imageWidth: 1080, imageHeight: 1080 });

    // Adding alt text makes a new version with the same image; the alt-text problem closes, the colour stays.
    const v2 = await creator.post(`${base}/content/${id}/versions`, { altText: "Gentle Oat Cleanser poster, 100 ml, ₹349." }).expect(201);
    expect(v2.body.version).toMatchObject({ number: 2, altText: "Gentle Oat Cleanser poster, 100 ml, ₹349." });
    expect(analysis.imageCalls.at(-1)!.bytes).toBe(POSTER.length);
    const after = await creator.get(`${base}/content/${id}`).expect(200);
    expect(after.body.latestRun.findings.map((f: { fingerprint: string }) => f.fingerprint)).toEqual(["fp-colour"]);
    expect(after.body.closedFindingCount).toBe(1);

    // Image posts change through the image or its alt text, not text edits.
    await creator.post(`${base}/content/${id}/versions`, { body: "New text" }).expect(409);
    await creator.raw().post(`${base}/content/${id}/versions`).set(creator.auth).attach("file", POSTER, "poster.png").expect(201);
  });

  it("checks file types by their contents", async () => {
    await creator.raw().post(`${base}/content`).set(creator.auth)
      .field("title", "Fake").field("channel", "instagram").attach("file", Buffer.from("not really a png"), "fake.png").expect(400);
    await admin.raw().post(`${base}/guidelines`).set(admin.auth).field("title", "Guide").attach("file", POSTER, "guide.png").expect(400);
  });
});
