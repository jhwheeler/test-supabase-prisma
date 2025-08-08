import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { db } from "./drizzle";
import { sql } from "drizzle-orm";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;
const LIMIT = Number(process.env.BENCH_LIMIT ?? 100);

function hrtimeMs(): number {
  const [sec, ns] = process.hrtime();
  return sec * 1000 + ns / 1e6;
}

async function time<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ label: string; ms: number; value: T }> {
  const start = hrtimeMs();
  const value = await fn();
  const ms = hrtimeMs() - start;
  return { label, ms, value };
}

async function runPosts(
  supabase: ReturnType<typeof createClient>,
  prisma: PrismaClient
) {
  const table = "posts";
  const supabaseResult = await time("supabase.select posts", async () => {
    const { data, error } = await supabase
      .from(table)
      .select("id, user_id, created_at, is_deleted")
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw error;
    return data?.length ?? 0;
  });
  const prismaResult = await time("prisma.findMany posts", async () => {
    const rows = await prisma.posts.findMany({
      select: { id: true, user_id: true, created_at: true, is_deleted: true },
      orderBy: { created_at: "desc" },
      take: LIMIT,
    });
    return rows.length;
  });
  const drizzleResult = await time("drizzle.select posts", async () => {
    const rows = await db.execute(
      sql`select id, user_id, created_at, is_deleted from posts order by created_at desc limit ${LIMIT}`
    );
    return (rows as unknown[]).length;
  });
  return [supabaseResult, prismaResult, drizzleResult] as const;
}

async function runPostComments(
  supabase: ReturnType<typeof createClient>,
  prisma: PrismaClient
) {
  const supabaseComplex = await time("supabase.post_comments", async () => {
    const { data, error } = await supabase
      .from("post_comments")
      .select("id, post_id, user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw error;
    return data?.length ?? 0;
  });
  const prismaComplex = await time("prisma.post_comments", async () => {
    const rows = await prisma.post_comments.findMany({
      select: { id: true, post_id: true, user_id: true, created_at: true },
      orderBy: { created_at: "desc" },
      take: LIMIT,
    });
    return rows.length;
  });
  const drizzleComplex = await time("drizzle.post_comments", async () => {
    const rows = await db.execute(
      sql`select id, post_id, user_id, created_at from post_comments order by created_at desc limit ${LIMIT}`
    );
    return (rows as unknown[]).length;
  });
  return [supabaseComplex, prismaComplex, drizzleComplex] as const;
}

async function runInstructors(
  supabase: ReturnType<typeof createClient>,
  prisma: PrismaClient
) {
  const selectShape = {
    id: true,
    first_name: true,
    last_name: true,
    honorific: true,
    slug: true,
    title: true,
    bio: true,
    short_bio: true,
    trailer_url: true,
    is_published: true,
    user_id: true,
    instructor_social_links: {
      select: {
        facebook: true,
        twitter: true,
        instagram: true,
        youtube: true,
        tiktok: true,
        website: true,
      },
    },
    instructor_books: {
      select: { books: { select: { id: true, title: true, url: true } } },
    },
    instructor_keywords: {
      select: { keywords: { select: { id: true, name: true } }, order: true },
    },
    featured_instructors: { select: { order: true } },
  } as const;
  const prismaResult = await time(
    "prisma.instructors (app-select)",
    async () => {
      const rows = await prisma.instructors.findMany({
        select: selectShape,
        orderBy: [{ created_at: "desc" }],
        take: LIMIT,
      });
      return rows.length;
    }
  );
  const selectString = [
    "id, first_name, last_name, honorific, slug, title, bio, short_bio, trailer_url, is_published, user_id",
    "instructor_social_links ( facebook, twitter, instagram, youtube, tiktok, website )",
    "instructor_books ( books ( id, title, url ) )",
    "instructor_keywords ( order, keywords ( id, name ) )",
    "featured_instructors ( order )",
  ].join(", ");
  const supabaseResult = await time(
    "supabase.instructors (app-select)",
    async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select(selectString)
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return data?.length ?? 0;
    }
  );
  const drizzleFlat = await time("drizzle.instructors (flat)", async () => {
    const rows = await db.execute(
      sql`select id, first_name, last_name, honorific, slug, title, bio, short_bio, trailer_url, is_published, user_id from instructors order by created_at desc limit ${LIMIT}`
    );
    return (rows as unknown[]).length;
  });
  return [supabaseResult, prismaResult, drizzleFlat] as const;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const prisma = new PrismaClient();
  const rows: Array<{ label: string; ms: number; rows: number }> = [];
  const [postsS, postsP, postsD] = await runPosts(supabase, prisma);
  rows.push(
    { label: postsS.label, ms: Math.round(postsS.ms), rows: postsS.value },
    { label: postsP.label, ms: Math.round(postsP.ms), rows: postsP.value },
    { label: postsD.label, ms: Math.round(postsD.ms), rows: postsD.value }
  );
  const [pcS, pcP, pcD] = await runPostComments(supabase, prisma);
  rows.push(
    { label: pcS.label, ms: Math.round(pcS.ms), rows: pcS.value },
    { label: pcP.label, ms: Math.round(pcP.ms), rows: pcP.value },
    { label: pcD.label, ms: Math.round(pcD.ms), rows: pcD.value }
  );
  const [instS, instP, instD] = await runInstructors(supabase, prisma);
  rows.push(
    { label: instS.label, ms: Math.round(instS.ms), rows: instS.value },
    { label: instP.label, ms: Math.round(instP.ms), rows: instP.value },
    { label: instD.label, ms: Math.round(instD.ms), rows: instD.value }
  );
  console.table(rows);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
