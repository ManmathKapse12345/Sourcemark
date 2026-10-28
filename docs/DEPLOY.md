# Deploying Sourcemark on free plans

| Part | Where | Plan |
|---|---|---|
| Database (Postgres + pgvector) | Supabase | Free |
| Sign-in | Supabase Auth (same project) | Free |
| API (`apps/api`) | Render web service | Free |
| Analysis service (`services/analysis`) | Render web service | Free |
| Website (`apps/web`) | Vercel | Hobby (free) |

Limits to know:

- Free Render services sleep after about 15 minutes without traffic. The first request after that takes 30–60 s,
  and the first check can take a minute or more while both services wake up. The API waits up to 180 s.
- A free Supabase project pauses after about a week without activity. Resume it from the dashboard; data is kept.
- A free Gemini key allows 15 requests per minute; checks slow down when several people use the app at once.

To move to paid plans later, set `plan: starter` on both services in `render.yaml`.

## 1. Supabase: database and sign-in

1. Create a project at supabase.com. Keep the database password.
2. **Database → Extensions**: turn on `vector`.
3. **Connect** (top of the dashboard) → **Session pooler**: copy the connection string and put the password in it.
   This is `DATABASE_URL` for both Render services. Use the session pooler, not the direct connection
   (IPv6 only) or the transaction pooler (port 6543), so that migrations work.
4. **Project Settings → API**: note the project URL, the `anon` public key and the JWT secret.

## 2. Render: API and analysis service

1. Render → **New → Blueprint** → choose this repository. Render reads `render.yaml` and creates
   `sourcemark-analysis` and `sourcemark-api` on the free plan.
2. Fill in the values it asks for:

   | Service | Variable | Value |
   |---|---|---|
   | sourcemark-analysis | `DATABASE_URL` | Supabase session pooler string |
   | sourcemark-analysis | `GEMINI_API_KEY` | your Gemini key |
   | sourcemark-api | `DATABASE_URL` | the same string |
   | sourcemark-api | `ANALYSIS_URL` | the analysis service's URL, e.g. `https://sourcemark-analysis.onrender.com` (Render shows it on the service page; enter a placeholder first if needed and correct it after the first deploy) |
   | sourcemark-api | `SUPABASE_URL` | `https://<project>.supabase.co` |
   | sourcemark-api | `AUTH_JWT_SECRET` | Supabase's JWT secret |
   | sourcemark-api | `CORS_ORIGINS` | the Vercel URL from step 3 (a placeholder until then) |

   `INTERNAL_TOKEN` and `ANALYSIS_TOKEN` are generated and linked automatically.
3. The API creates the database tables on start (`prisma migrate deploy`). Check: `https://<api>.onrender.com/health`.

## 3. Vercel: website

1. Vercel → **Add New → Project** → this repository.
2. Root directory `apps/web`; install command `cd ../.. && npm ci`; build command
   `cd ../.. && npm run build -w packages/contract && npm run build -w apps/web`. The commands run inside
   `apps/web`, so they first move to the repository root, where the npm workspaces are defined.
3. Environment variables:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<api>.onrender.com/api` |
   | `NEXT_PUBLIC_SUPABASE_URL` | the Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` key |
   | `NEXT_PUBLIC_DEMO_LOGIN` | `false` |
   | `DEMO_AUTH_SECRET` | leave empty; it signs demo-account tokens and must never be set in production |

## 4. Connect them

1. Render → `sourcemark-api` → **Environment**: set `CORS_ORIGINS` to the Vercel URL (no trailing slash).
2. Supabase → **Authentication → URL Configuration**: set the site URL to the Vercel URL and add
   `https://<vercel-domain>/login` and `https://<vercel-domain>/reset-password` to the redirect URLs.

## 5. Smoke test

1. Open the Vercel URL, sign up, confirm the email and sign in. The onboarding creates a workspace with you as admin.
2. Brand kit: add a guideline (paste a few paragraphs), publish it, add a rule.
3. Give yourself the creator role on **Team**, create a caption that breaks the rule and run **Check & send for review**.
   Expect findings within a minute (longer on the first request while the services wake up).
