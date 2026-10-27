# Sourcemark frontend

The web app in `apps/web`. It is the only thing users see: the public overview page, sign-in and sign-up,
the review queue, the review screen with cited findings, the brand kit, team and audit pages.
It talks only to the Express API (`docs/API.md`); it never calls the analysis service or the LLM directly.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · TanStack Query ·
Supabase Auth (optional) · request schemas shared with the API through `@sourcemark/contract`.

## Run it locally

Start the backend first (see the root `README.md`: database, analysis service, `npm run dev:api`). Then:

```sh
cp apps/web/.env.example apps/web/.env.local
npm run dev:web                      # http://localhost:3000
```

| Variable | Where it is read | What it does |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | browser | API base URL, default `http://localhost:4000/api`. The site's origin must be in the API's `CORS_ORIGINS`. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | Turn on email sign-in, sign-up and password reset. Leave empty for local work. |
| `NEXT_PUBLIC_DEMO_LOGIN` | browser | `true` shows the sample-workspace accounts on the sign-in page. |
| `DEMO_AUTH_SECRET` | server only | Signs sample-account tokens in `/api/demo-login`. Must equal `AUTH_JWT_SECRET` in `apps/api/.env`. **Leave empty in production.** |

## Pages

| Route | Who | Purpose |
|---|---|---|
| `/welcome` | everyone | Overview for new visitors and judges: hero, evidence, live checker, how it works, workflow. Signed-out visitors land here. |
| `/login` | signed out | Email and password (Supabase), sample-workspace accounts, developer token sign-in. |
| `/signup` | signed out | Name, work email, password with strength meter, consent. Ends on "Check your inbox". |
| `/forgot-password` | signed out | Sends a reset link. Always answers the same way, so it never reveals whether an email has an account. |
| `/reset-password` | via email link | Choose a new password (entered twice). Supabase signs the user in for this step. |
| `/onboarding` | signed in, no organisation | First sign-in: create a workspace (you become admin) or join your team (shows the email to give your admin). |
| `/` | member | Dashboard, different per role: **Creator** sees what is waiting on them; **Reviewer** what to review; **Approver** what needs sign-off; **Admin** a workspace overview with brand-kit counts and links. All roles get the filterable list of all content below. |
| `/content/new` | Creator | Paste text or upload DOCX/PDF/TXT; option to run rule checks only. Shows channel hints from the workspace's disclosure rules (for example "start creator posts with #ad"). Other roles see an explanation instead. |
| `/content/:id` | member | Review screen (below). |
| `/brand-kit` | member (edits: Admin) | Guidelines (upload or paste, review and edit clauses, publish, start a new version, suggest rules), rules (create, change severity, switch on/off), facts (add, switch off, show old values), assets. Tabs are linkable: `/brand-kit?tab=Rules`. |
| `/team` | Admin | Add members by email, change roles. |
| `/audit` | Admin | Organisation-wide audit log. |

The routing rules live in `src/components/Shell.tsx`: public pages render without the app header; a signed-out
visitor is sent to `/welcome`; a signed-in user without an organisation is sent to `/onboarding`.

## The review screen

`src/app/content/[id]/page.tsx` is the heart of the product. From top to bottom:

1. **Verdict** (`components/Verdict.tsx`): one sentence that answers "can this be published?", a ring showing the
   share of issues resolved, counts of problems / to confirm / fixed, disputed findings, and a four-step tracker
   (Written → Checked → Reviewed → Approved). While a check runs (10–30 s with AI) it is replaced by
   `CheckingPanel`, which shows the steps the server goes through. A check that failed or ran without AI shows a
   banner with the reason (`aiStatus`, `aiError`) and a **Re-check** button (`POST /content/:id/analyze`).
2. **The content** with highlights (`components/HighlightedBody.tsx`): wavy red = breaks a rule or fact,
   dotted gold = needs a person to confirm. Clicking a highlight scrolls to its finding. Authors can
   **Edit the text** directly; saving creates a new version and re-runs the checks.
3. **Findings** (`components/FindingCard.tsx`): plain words ("Problem", "Please confirm"), the fix as
   *before → after*, the cited rule or fact with its code (R-4, F-2, G-3.2), and who found it (rule, AI, or both).
   Answers: **Use this fix**, **Write my own** (with a live preview of the whole sentence, so people type only the
   replacement words), **This is wrong**. After answering, the card shows the choice and a *Change* link. Reviewers see
   disputed findings highlighted with the writer's reason.
   Suggested rewrites have a **Use this rewrite** button (`applyRewriteIds`).
4. **Actions**: only what the API lists in `availableActions`, in plain words ("Send to approver",
   "Approve for publishing"). A disabled button always says why underneath ("2 problems are still open",
   "Add a note for the writer first"). Errors are cleared when a new version arrives.
5. Tabs: **Discussion**, **History** (`GET /content/:id/audit`, with names) and **Changes since vN** (word-level
   comparison of the last two versions, `lib/diff.ts`).

A problem closes only when a new version no longer produces it (the API's rule). The UI says so, so nobody expects
"Use this fix" alone to clear it.

## Code layout

```
apps/web/src
  app/                    routes (one folder per page), globals.css, layout.tsx (fonts, theme bootstrap)
  app/api/demo-login/     server route that signs sample-account tokens (demo only)
  components/             Shell, Verdict, Stepper, FindingCard, HighlightedBody, ThemeToggle, ui.tsx
  components/auth/        AuthLayout (split screen), PasswordInput, SampleAccounts
  components/landing/     InkShader (WebGL hero art), HeroScan, TryIt, CountUp, SectionNav
  lib/api.ts              fetch wrapper: bearer token, JSON or FormData, typed ApiError from { error: { code, message } }
  lib/auth.tsx            AuthProvider: session (Supabase or local token), /me, current organisation, roles, can()
  lib/types.ts            response shapes from docs/API.md
  lib/format.ts           state labels and colours, dates
```

Data fetching uses TanStack Query. Organisation-scoped calls go through `useOrgApi()`, which prefixes
`/orgs/:orgId`. Forms validate with the same Zod schemas the API uses (for example `AddMemberBody`, `CreateOrgBody`).

## Design system

- **Themes.** Light (porcelain and ink, indigo accent) and dark (night, gold accent). Every colour is a CSS variable
  in `globals.css` (`--c-*`); Tailwind's colour names (`slate-*`, `red-*`, `brand`, `ink` …) point at those
  variables through `@theme inline`, so the same classes render correctly in both themes. The theme follows the
  operating system until the user picks one with the toggle; the choice is stored in `localStorage`
  (`sourcemark.theme`) and applied before first paint by a small script in `layout.tsx`.
- **Type.** Instrument Serif for headings, Geist for text, Geist Mono for codes such as `R-4`.
- **Building blocks.** `btn-primary`, `btn-secondary`, `btn-danger`, `input`, `card`, `glass` (frosted panel),
  `gold-text` (gradient accent text), `hl` (animated highlighter stroke) are defined in `globals.css`.
- **Semantic colours** are separate from the accent: red = problem, gold/amber = please confirm, green = fixed or approved.
- **Avoid** `white`/`black` literals in components. `white` is mapped to the surface colour, so `text-white` on a
  dark button turns dark in dark mode. Use the tokens.

## The overview page (`/welcome`)

- **Hero:** a framed panel with `InkShader`, an animated WebGL "ink in water" field coloured from the theme. It
  follows the pointer slightly, pauses when off-screen, and falls back to a CSS gradient without WebGL.
  `HeroScan` plays once: a scan line passes, three words are highlighted, footnotes with their sources appear,
  and the verdict lands.
- **Evidence:** ASCI and Lucidpress figures from the Round 1 plan, counting up when scrolled into view.
- **Live checker (`TryIt`):** a small copy of the Northfern Skincare sample rules that runs in the browser, so
  visitors can type and see findings instantly. It is labelled "runs in your browser"; the real checks run on
  the server.
- **Navigation:** "Try it", "How it works" and "Workflow" scroll with easing; after the hero a floating bar
  shows the current section (`SectionNav`).

## Accessibility

Visible focus rings, labelled form fields, `aria-live` for the strength meter and live findings, `aria-current`
for the active section, and all motion is switched off under `prefers-reduced-motion`. Colour is never the only
signal: highlights also use wavy or dotted underlines, and findings carry text labels. Layouts are checked at
400 px wide with no horizontal scrolling.

## Testing

`npm run lint -w apps/web` runs the TypeScript check; CI also runs a production build (`.github/workflows/ci.yml`, job `web`).
Before a release, these were checked against the real API with the seeded sample workspace:

- Every link and in-page anchor, signed out and as each role: no 404s, no script errors, no failed API calls.
- Full workflow: the creator submits a caption → 5 cited problems → edits the text → clean re-check → sends it on →
  the approver approves → "Approved. Safe to publish."
- New user: first sign-in → onboarding → workspace created → brand kit, as admin.
- Sign-up form: show/hide password, strength meter; reset page: mismatch and length errors.

## Deploying (Vercel)

Set the project root to `apps/web`, the install command to `npm ci` at the repository root, and the build command to
`npm run build -w packages/contract && npm run build -w apps/web`. Set `NEXT_PUBLIC_API_URL` to the Render API URL and
the two Supabase variables. Add the Vercel domain to the API's `CORS_ORIGINS`. In Supabase, add
`https://<domain>/login` and `https://<domain>/reset-password` to the allowed redirect URLs.

## Known gaps

- Rule configs can be created and switched on or off, but an existing rule's config (for example its word list) can't yet be edited in the UI.
- "Use this rewrite" and "Suggest rules" need the AI service (`GEMINI_API_KEY`); without it the page explains that.
- Image review, guideline health and insights are Round 3 features and have no screens yet.
- The overview page's hero art is generated in code. A commissioned or AI-generated image can replace
  `InkShader` inside the same frame.
