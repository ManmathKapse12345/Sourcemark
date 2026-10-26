# Sourcemark

Pre-publication review of content against an organisation's own approved guidelines, facts and assets.
Every issue cites the exact rule or fact behind it; anything the system cannot ground in an approved
source is marked "needs human check", never reported as a violation. People make every decision.

This repository holds the Round 2 core: brand kit, text and document review, cited findings and fixes,
roles and approvals, version history and audit log, the evaluation harness, and deployment.

```
apps/web/            Next.js frontend (Aditya)          — not in this repo yet
apps/api/            Express + TypeScript + Prisma      — workflow, roles, versions, audit, brand kit
services/analysis/   FastAPI (Python), internal only    — parsing, rules, facts, retrieval, Gemini, citation check
packages/contract/   Zod schemas shared by both sides   — exported to JSON Schema for the Python tests
eval/                demo brand kit, 30-piece labelled test set, scoring script
docs/API.md          endpoint reference for the frontend
```

## How a review works

1. **Rules first.** Banned and preferred terms, product names, capitals, exclamation marks, sentence length
   and disclosure tags are checked by code (`services/analysis/app/rules.py`).
2. **Facts in context.** Prices, sizes, names and dates are compared with the approved fact sheet, but a number
   is only compared with a fact when that fact's subject is in the same sentence
   (`app/facts.py`). Outdated values are explained: "₹499 was the approved value until 2026-06-30".
3. **Retrieval.** For each passage, the most relevant clauses are fetched from pgvector (filtered by organisation
   and published versions) and sent to Gemini with their ids (`app/retrieval.py`, `app/judgement.py`).
4. **Structured output.** Gemini must return JSON in which every violation names a source id and quotes it.
5. **Citation check.** The id must exist in the organisation's brand kit and the quote must appear in that
   clause or fact. Otherwise the finding becomes "needs human check" (`app/citations.py`). Quotes from the draft
   that the model invented are dropped.
6. **Merge and fix.** A rule and the AI flagging the same words become one finding with both origins.
   Sentence rewrites are re-checked by the rules and discarded if they still break them (`app/rewrite.py`).

Workflow states are enforced by the API (`apps/api/src/workflow/stateMachine.ts`): a creator can submit but
never approve, authors can never approve their own content, and the AI never changes a state. Findings are
matched across versions by fingerprint, so a finding closes only when a new version stops producing it.

## Run it locally

Needs Node 24, Python 3.12+ and Docker.

```sh
npm install
docker compose up -d db                      # Postgres + pgvector on localhost:5434
cp apps/api/.env.example apps/api/.env       # set ANALYSIS_TOKEN to a long random string
cp services/analysis/.env.example services/analysis/.env   # same value as INTERNAL_TOKEN; add GEMINI_API_KEY
npm run migrate:deploy -w apps/api
npm run db:seed                              # demo brand (fictional Northfern Skincare) and users

cd services/analysis && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --env-file .env     # terminal 1
npm run dev:api                                                             # terminal 2 (repo root)

npm run demo -w apps/api                     # walks the seeded caption from submit to approval
npm run token -- creator@northfern.test      # token for trying endpoints by hand
```

Without `GEMINI_API_KEY` everything works with rule and fact checks only, and each run reports
`aiStatus: "unavailable"` with the reason.

## Tests and evaluation

```sh
npm test                                     # contract + API (unit and integration; uses database sourcemark_test)
cd services/analysis && .venv/Scripts/python -m pytest -q
services/analysis/.venv/Scripts/python eval/run.py --no-ai     # deterministic baseline
services/analysis/.venv/Scripts/python eval/run.py             # full pipeline (needs GEMINI_API_KEY)
```

The evaluation reports precision, recall (split into rule-checkable and judgement errors), the false-alarm
rate on the 6 clean pieces, invalid citations and timing, and saves a JSON report in `eval/results/`.

## Deploy

`render.yaml` defines the API (public web service), the analysis service (private service, reachable only
from the API) and Postgres. Set `GEMINI_API_KEY`, `SUPABASE_URL` (and/or `AUTH_JWT_SECRET`) and `CORS_ORIGINS`
in the Render dashboard. The internal token is generated and shared automatically. The frontend deploys to Vercel.

## Notes for maintainers

- Prisma cannot declare the HNSW index on clause embeddings. Remove `DROP INDEX "Clause_embedding_hnsw"` from any
  migration Prisma generates.
- Changing the analysis wire format: edit `packages/contract/src/analysis.ts` and `services/analysis/app/contract.py`,
  then run `npm run contract:export`. The contract tests fail until both sides agree.
