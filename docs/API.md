# Sourcemark API reference (for the frontend)

Base URL: `http://localhost:4000/api` locally. Every request needs `Authorization: Bearer <Supabase access token>`.
Request bodies are validated with the Zod schemas exported from `@sourcemark/contract` (`packages/contract/src/api.ts`),
so the frontend can import the same schemas for its forms.

Errors always look like `{ "error": { "code": "...", "message": "...", "details": ... } }`:

| Status | Code | Meaning |
|---|---|---|
| 400 | `validation_failed`, `bad_request`, `upload_rejected` | Body or file is not valid; `details` lists Zod issues |
| 401 | `unauthenticated` | Missing or invalid token |
| 403 | `forbidden` | Signed in, but the role or workflow does not allow it (`message` says why) |
| 404 | `not_found` | Does not exist **or belongs to another organisation** |
| 409 | `conflict` | Wrong workflow state, open violations, overlapping fixes, etc. |
| 502 | `analysis_unavailable` | The analysis service failed; the request can be retried |

## Account

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/me` | anyone | `{ user, memberships: [{ memberId, org, roles }] }`. The first call creates the user row. |
| POST | `/orgs` | anyone | `{ name }`. Creator becomes admin with all roles. |

Everything below is under `/orgs/:orgId`. Non-members get 404.

## Members and audit

| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/` | member | `{ org, members: [{ id, email, name, roles }] }` |
| POST | `/members` | ADMIN | `{ email, roles }` (the person must have signed in once) |
| PATCH | `/members/:memberId` | ADMIN | `{ roles }` |
| GET | `/audit?limit=100` | ADMIN | Organisation-wide audit log, newest first |

## Brand kit

| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/guidelines` | member | Guidelines with version summaries |
| GET | `/guidelines/:id` | member | Versions (newest first), each with `clauses` |
| POST | `/guidelines` | ADMIN | multipart: `title` + `file` (PDF/DOCX/TXT/MD) **or** JSON `{ title, text }`. Creates a DRAFT version with extracted clauses for review. |
| POST | `/guidelines/:id/versions` | ADMIN | New DRAFT version (same clause code prefix) |
| POST | `/guideline-versions/:vid/clauses` | ADMIN | `{ text, heading?, code? }` (draft only) |
| PATCH | `/clauses/:clauseId` | ADMIN | `{ text?, heading? }` (draft only) |
| DELETE | `/clauses/:clauseId` | ADMIN | draft only |
| DELETE | `/guideline-versions/:vid` | ADMIN | delete a draft version |
| POST | `/guideline-versions/:vid/publish` | ADMIN | Embeds clauses, publishes, supersedes the previous version. `{ embeddings: "stored" \| "skipped" }` |
| POST | `/guideline-versions/:vid/suggest-rules` | ADMIN | AI-suggested rules for the admin to confirm. Nothing is saved. |
| GET / POST | `/rules` | member / ADMIN | `{ type, severity, message, clauseCode?, config }`. Config shape per type: `RuleConfigByType` in the contract. Codes `R-n` are assigned. |
| PATCH | `/rules/:id` | ADMIN | `{ severity?, message?, clauseCode?, config?, active? }` |
| GET | `/facts?all=true` | member | `all=true` includes inactive facts |
| POST | `/facts` | ADMIN | `{ subject, attribute, kind, value, unit?, aliases?, validFrom?, source? }`. A new value for the same subject and attribute ends the old one the day before `validFrom`. |
| PATCH | `/facts/:id` | ADMIN | `{ aliases?, source?, active? }` |
| GET / POST / DELETE | `/assets`, `/assets/:id` | member / ADMIN | `{ name, type, url?, colors?, notes? }` |

Fact kinds: `money` (value `"549"`, unit `"INR"`), `quantity` (`"50"`, `"g"`), `name`, `date` (`"2026-11-14"`), `claim` (approved wording, used as context for the AI).

## Content and review

States: `DRAFT → CHECKING → IN_REVIEW → APPROVED | REJECTED`, with `IN_REVIEW → CHANGES_REQUESTED → DRAFT`.

| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/content?state=IN_REVIEW&mine=true` | member | Queue / list |
| POST | `/content` | CREATOR | JSON `{ title, channel, body, aiChecks? }` or multipart with `file` (DOCX/PDF/TXT). `aiChecks: false` = rule checks only, nothing sent to the LLM. |
| GET | `/content/:id` | member | See "Content detail" below |
| POST | `/content/:id/transitions` | depends | `{ action, note? }`. `SUBMIT`, `RESOLVE`, `REVISE`: author. `REQUEST_CHANGES`: reviewer/approver (note required). `APPROVE`, `REJECT`: approver (reject needs a note). Authors can never approve their own content. `SUBMIT` runs the checks and returns `{ state, run }`. |
| POST | `/content/:id/versions` | author, in DRAFT/CHECKING | `{ body }`, or `{ applyResponses: true }` to apply accepted/edited fixes, and/or `{ applyRewriteIds: ["rw-0"] }`. In CHECKING the new version is re-checked; returns `{ version, run }`. |
| POST | `/content/:id/analyze` | author, in CHECKING | Re-run checks on the latest version (after a failure) |
| POST | `/findings/:id/responses` | author (DRAFT/CHECKING); reviewer/approver (IN_REVIEW) | `{ action: "ACCEPT" }`, `{ action: "EDIT", editedText }`, `{ action: "DISPUTE", reason }` |
| POST | `/content/:id/comments` | member | `{ body, findingId?, versionId? }` |
| GET | `/content/:id/audit` | member | Every event for this content and its findings |

`RESOLVE` returns 409 with `details.findings` while any `violation` on the latest check is still `OPEN`.
A finding closes only when a new version no longer produces it; accepting a fix just records the choice.

### Content detail (`GET /content/:id`)

```jsonc
{
  "item": { "id", "title", "channel", "state", "aiChecks", "authorId", ... },
  "author": { "memberId", "email", "name" },
  "versions": [{ "id", "number", "body", "sourceFileName", "createdAt" }],   // newest first
  "latestRun": {
    "id", "versionId", "status": "COMPLETED" | "FAILED" | "RUNNING",
    "aiStatus": "ok" | "disabled" | "unavailable", "aiError", "model", "durationMs", "stats",
    "findings": [{
      "id", "fingerprint",
      "kind": "violation" | "needs_human_check",
      "category", "severity": "high" | "medium" | "low",
      "origins": ["rule"] | ["ai"] | ["rule", "ai"],   // show a "Rule" / "AI" badge
      "spanStart", "spanEnd", "quote",                   // highlight range in the version body; null = whole document
      "explanation",
      "sourceType": "rule" | "clause" | "fact" | null,
      "sourceCode",        // R-4, G-3.2, F-2
      "sourceClauseCode",  // the clause a rule rests on (G-2.1)
      "sourceText",        // the clause or fact text to show as the citation
      "confidence",
      "fixStart", "fixEnd", "fixReplacement",            // null when there is no single fix
      "status": "OPEN" | "DISPUTED" | "CLOSED" | "SUPERSEDED",
      "responses": [{ "action", "reason", "editedText", "memberId", "createdAt" }]
    }],
    "rewrites": [{ "key": "rw-0", "start", "end", "original", "text", "fingerprints" }]
  },
  "blockingFindingIds": ["..."],
  "closedFindingCount": 3,
  "comments": [...],
  "events": [{ "action", "fromState", "toState", "actorId", "note", "createdAt" }],
  "availableActions": ["RESOLVE"]          // what the current user may do now
}
```

## Local development tokens

`npm run db:seed` creates the demo organisation `org_northfern` with users
`admin@`, `creator@`, `reviewer@`, `approver@northfern.test` (and `admin@other.test` in a second org).
`npm run token -- creator@northfern.test` prints a 12-hour token signed with `AUTH_JWT_SECRET`.
In production the frontend sends the Supabase session's access token instead.
