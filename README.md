Minimal Supabase vs Prisma benchmark

Setup

- Get `.env` from the `web` project
- Install deps: `pnpm i` or `npm i`
- Generate Prisma client: `pnpm prisma:generate`

Run

- `pnpm bench` (or `npm run bench`)
- Optional: set `BENCH_LIMIT` to control row count

Notes

- This reads from existing tables (`posts`, `post_comments`, `instructors`) to compare Supabase SDK vs Prisma `.findMany()`.
