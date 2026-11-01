# Round 3: frontend work

The back end for all three Round 3 improvements is built and tested: image review, guideline health, and Hindi and
Hinglish review. This file lists what the web app needs so judges can use them. Endpoints and fields are in
`docs/API.md` (sections "Image posts", "Language" and "Guideline health"). Every change is additive: nothing that
works today changes shape.

To see real data locally: `npm run db:seed` now creates, in the Northfern workspace, a logo asset with its file
(`A-2`), an image post ("Festive poster", which shows last season's price), and a review history in which clause
G-3.5 comes out as unclear.

## 1. Image review

### New content (`/content/new`)
- Accept PNG, JPEG and WebP in the upload as well as DOCX/PDF/TXT. When an image is chosen, show a preview and an
  **Alt text** field ("Describe the image and any text in it, for people using screen readers"). Send it as
  multipart: `file` and `altText`.
- Missing alt text is reported as a problem by the check, so the field can stay optional in the form.

### Review screen (`/content/[id]`) when `item.kind === "image"`
- **The image with boxes.** Load `GET /content/:id/versions/:vid/image` with the bearer token and show it through a
  blob URL (revoke it on unmount). Draw each finding that has `boxX`/`boxY`/`boxW`/`boxH` as an absolutely positioned
  outline in percentages (`left: boxX*100%` and so on). Use the same colours as text highlights: red for a problem, gold
  for please confirm. Clicking a box selects its finding card, and selecting a card outlines its box, using the same
  `select()` as text highlights.
- **Text read from the image.** Show `latestRun.ocrText` with the existing `HighlightedBody`. Text findings'
  `spanStart`/`spanEnd` point into `ocrText`, not into the version body.
- **Changing the post.** Replace "Edit the text" with two actions: **Edit alt text** (`POST /content/:id/versions` with
  `{ altText }`, which keeps the image) and **Upload a new image** (multipart `file`). Hide "Apply accepted fixes as
  new version" and the sentence rewrites for image posts. A text fix on an image finding is a suggested wording for the
  writer to use in the design, so label it "Suggested wording" and add a copy button.
- **Checks that did not run.** Show `latestRun.notes` as a small info list, for example "The brand kit has no logo file,
  so logo use was not checked."
- **Finding cards.** Two new source types:
  - `asset`: "Brand asset A-1 · Northfern palette". Draw swatches from the hex codes in `sourceText`.
  - `standard`: "Accessibility · WCAG 2.1 1.4.3".

  Two new categories need labels: `visual` and `accessibility`. Findings with no box (missing alt text) are about the
  whole image.
- **Changes tab.** For image posts, show the previous and current image side by side, and the alt text before and
  after, instead of the word diff.

### Lists and brand kit
- Dashboard and content list: an "Image" badge or a small thumbnail for `kind === "image"`.
- Brand kit → **Assets**:
  - show each asset's code (`A-1`), palette swatches, and the logo preview (`GET /assets/:id/image`);
  - add **Upload logo**: `POST /assets` multipart with `name`, `type: "logo"` and `file`;
  - add a line explaining that image review checks colours against the palette and logos against these files.

**Done when:**
- an image upload shows the poster with boxes on the wrong price and the off-palette area;
- adding alt text closes the alt-text problem;
- uploading a corrected image re-runs the checks.

## 2. Guideline health (admins)

- **Where it lives.** A new page `/guideline-health`, with a header link visible to admins. Alternatively, a "Health"
  tab in the brand kit.
- **Data.** Load `GET /guideline-health`. Flagged entries come first.
- **Each row shows:**
  - code and heading, and the current wording (`text`);
  - a stacked bar of accepted / edited / disputed / overridden;
  - `challengeRate` against `orgAverage`;
  - "found by" rule or AI counts;
  - for flagged rows, an **Unclear?** badge with the `why` sentence.
- **Opening a row shows the cases:**
  - content title, linked to `/content/:contentItemId`;
  - the flagged words (`quote`) and an outcome badge;
  - the person's `reason`;
  - who answered (map `by` to a name with the members list from `GET /orgs/:id`) and when.
- **Suggesting a clearer wording.**
  - **Suggest clearer wording** calls `POST /guideline-health/:code/suggest`.
  - Show the current text and the suggestion as a word diff (`lib/diff.ts`), the `rationale`, and mark the cases listed
    in `caseIds`.
  - The suggestion goes into an editable textarea. **Save as draft version** calls `POST /guideline-health/:code/apply`
    with `{ text }`.
  - Then link to the brand kit, where the admin reviews and publishes the draft as today.
- **Errors and empty states.**
  - Show 409 messages as they come (for example "This guideline already has a draft version; publish or delete it
    first").
  - Empty state: "Not enough decisions yet. A clause needs at least 5 before it can be judged."

**Done when:** with the seeded data, G-3.5 is first and flagged, and a suggested wording can be saved as a draft and
published.

## 3. Hindi and Hinglish

- **Language badge.** On the review screen, show a badge from `latestRun.stats.language`: "Hindi" or "Hinglish". Show
  nothing for English. Set `lang="hi"` on the content block for Hindi, so screen readers use the right voice.
- **Fonts.** Geist has no Devanagari. Add Noto Sans Devanagari through `next/font` as a fallback in the text font
  stack, so Hindi drafts, highlights and finding cards render properly.
- **Highlights.** No change is needed: offsets are counted in characters, and Devanagari and ₹ are single characters
  in JavaScript strings.
- **Optional.** A Hindi example in the new-content placeholder and on the overview page's try-it box.

**Done when:** "Calm Barrier Moisturiser एक चमत्कार है। सिर्फ ₹४९९ में!" shows the Hindi badge, renders cleanly, and
highlights "चमत्कार" and "₹४९९".

## 4. Shared

- `lib/types.ts` needs these additions:
  - `Run`: `ocrText`, `notes`, `stats.language`;
  - `Finding`: `boxX`, `boxY`, `boxW`, `boxH`, and the source types `asset` and `standard`;
  - `Version`: `hasImage`, `imageMime`, `imageWidth`, `imageHeight`, `altText`;
  - `Item`: `kind`;
  - `Asset`: `code`, `hasImage`.
- `lib/api.ts`: a helper that fetches an authenticated image and returns a blob URL, used by the review screen and
  the assets tab.
- User testing at the start of Round 3 is shared: Manmath runs the measurement, Aditya runs the sessions.
