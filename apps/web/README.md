# Sourcemark web

Next.js 15 (App Router) + TypeScript + Tailwind 4 + TanStack Query. Talks only to the Express API (`docs/API.md`).

```sh
cp .env.example .env.local     # set DEMO_AUTH_SECRET = AUTH_JWT_SECRET from apps/api/.env for one-click demo sign-in
npm run dev:web                # from repo root; the API must be running on :4000
```

- `/welcome` – public landing page (WebGL hero, live in-browser demo of the checks)
- `/login` – demo accounts (Creator, Reviewer, Approver, Admin) when `NEXT_PUBLIC_DEMO_LOGIN=true`; Supabase or a pasted token otherwise
- `/` review queue · `/content/:id` review screen · `/brand-kit` · `/team` · `/audit`

Light and dark themes follow the OS setting; the toggle in the header remembers a choice.
Structure: `src/lib` (api client, auth, types) · `src/components` (`landing/` for the welcome page) · `src/app` (routes).
