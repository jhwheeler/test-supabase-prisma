Minimal Supabase vs Prisma benchmark

Setup

- Copy `env.example` to `.env` and fill:
  - `SUPABASE_URL`, `SUPABASE_KEY` for the REST client
  - `SUPABASE_DB_CONNECTION_STRING`, `SUPABASE_DB_DIRECT_URL` for Prisma (same variables used in `web_v2/prisma/schema.prisma`)
- Install deps: `pnpm i` or `npm i`
- Generate Prisma client: `pnpm prisma:generate`

Run

- `pnpm bench` (or `npm run bench`)
- Optional: set `BENCH_LIMIT` to control row count

Notes

- This reads from existing tables (`posts`, `post_comments`) to compare Supabase SDK vs Prisma `.findMany()`.
