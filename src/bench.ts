import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { db } from "./drizzle";
import { sql } from "drizzle-orm";
import crypto from "node:crypto";

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

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreatedIds = {
  instructorId: number;
  keywordIds: number[];
  bookIds: number[];
};

async function cleanupCreated(
  prisma: PrismaClient,
  ids: CreatedIds
): Promise<void> {
  const { instructorId, keywordIds, bookIds } = ids;
  // Best-effort cleanup; ignore failures
  try {
    await prisma.instructor_keywords.deleteMany({
      where: { instructor_id: instructorId },
    });
    await prisma.instructor_books.deleteMany({
      where: { instructor_id: instructorId },
    });
    await prisma.instructors.delete({ where: { id: instructorId } });
  } catch {}
  try {
    if (keywordIds.length)
      await prisma.keywords.deleteMany({ where: { id: { in: keywordIds } } });
  } catch {}
  try {
    if (bookIds.length)
      await prisma.books.deleteMany({ where: { id: { in: bookIds } } });
  } catch {}
}

async function runCreateInstructorSupabase(
  supabase: ReturnType<typeof createClient>,
  prisma: PrismaClient
): Promise<{ label: string; ms: number; value: number }> {
  const suffix = uniqueSuffix();
  const firestoreId = `bench_${crypto.randomUUID?.() ?? suffix}`;
  const keywordNames = [`bench_kw1_${suffix}`, `bench_kw2_${suffix}`];
  const bookSpecs = [
    { title: `Bench Book A ${suffix}`, url: `https://example.com/a-${suffix}` },
    { title: `Bench Book B ${suffix}`, url: `https://example.com/b-${suffix}` },
  ];

  const t = await time("supabase.create instructor (multi-step)", async () => {
    const { data: kwRows, error: kwErr } = await supabase
      .from("keywords")
      .insert(keywordNames.map((name) => ({ name })))
      .select("id");
    if (kwErr) throw kwErr;
    const keywordIds = (kwRows ?? []).map((r: any) => r.id);

    const { data: bookRows, error: bookErr } = await supabase
      .from("books")
      .insert(bookSpecs)
      .select("id");
    if (bookErr) throw bookErr;
    const bookIds = (bookRows ?? []).map((r: any) => r.id);

    const { data: instRows, error: instErr } = await supabase
      .from("instructors")
      .insert({
        first_name: "Bench",
        last_name: `Run ${suffix}`,
        slug: `bench-${suffix}`,
        title: "Bench Title",
        bio: "bio",
        short_bio: "short",
        trailer_url: "https://example.com/trailer",
        is_published: true,
        firestore_id: firestoreId,
      })
      .select("id")
      .single();
    if (instErr) throw instErr;
    const instructorId = instRows?.id as number;

    if (bookIds.length) {
      const { error } = await supabase.from("instructor_books").insert(
        bookIds.map((bookId) => ({
          instructor_id: instructorId,
          book_id: bookId,
        }))
      );
      if (error) throw error;
    }

    if (keywordIds.length) {
      const { error } = await supabase.from("instructor_keywords").insert(
        keywordIds.map((keywordId, index) => ({
          instructor_id: instructorId,
          keyword_id: keywordId,
          order: index,
        }))
      );
      if (error) throw error;
    }

    // Cleanup not in timing
    void cleanupCreated(prisma, { instructorId, keywordIds, bookIds });
    return instructorId;
  });

  return t;
}

async function runCreateInstructorPrismaOrm(
  prisma: PrismaClient
): Promise<{ label: string; ms: number; value: number }> {
  const suffix = uniqueSuffix();
  const firestoreId = `bench_${crypto.randomUUID?.() ?? suffix}`;
  const keywordNames = [`bench_kw1_${suffix}`, `bench_kw2_${suffix}`];
  const bookRows = [
    { title: `Bench Book A ${suffix}`, url: `https://example.com/a-${suffix}` },
    { title: `Bench Book B ${suffix}`, url: `https://example.com/b-${suffix}` },
  ];
  let ids: CreatedIds = { instructorId: 0, keywordIds: [], bookIds: [] };
  const t = await time("prisma.create instructor (ORM tx)", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.keywords.createMany({
        data: keywordNames.map((name) => ({ name })),
      });
      await tx.books.createMany({ data: bookRows });

      const [keywords, books] = await Promise.all([
        tx.keywords.findMany({
          where: { name: { in: keywordNames } },
          select: { id: true, name: true },
        }),
        tx.books.findMany({
          where: { url: { in: bookRows.map((b) => b.url) } },
          select: { id: true, url: true },
        }),
      ]);

      const created = await tx.instructors.create({
        data: {
          first_name: "Bench",
          last_name: `Run ${suffix}`,
          slug: `bench-${suffix}`,
          title: "Bench Title",
          bio: "bio",
          short_bio: "short",
          trailer_url: "https://example.com/trailer",
          is_published: true,
          firestore_id: firestoreId,
        },
        select: { id: true },
      });

      if (books.length) {
        await tx.instructor_books.createMany({
          data: books.map((b) => ({
            instructor_id: created.id,
            book_id: b.id,
          })),
        });
      }
      if (keywords.length) {
        await tx.instructor_keywords.createMany({
          data: keywords.map((kw, idx) => ({
            instructor_id: created.id,
            keyword_id: kw.id,
            order: idx,
          })),
        });
      }

      ids = {
        instructorId: created.id,
        keywordIds: keywords.map((k) => k.id),
        bookIds: books.map((b) => b.id),
      };
    });
    return ids.instructorId;
  });
  if (ids.instructorId) await cleanupCreated(prisma, ids);
  return t;
}

async function runCreateInstructorPrismaRaw(
  prisma: PrismaClient
): Promise<{ label: string; ms: number; value: number }> {
  const suffix = uniqueSuffix();
  const firestoreId = `bench_${crypto.randomUUID?.() ?? suffix}`;
  return time("prisma.create instructor (RAW tx)", async () => {
    let ids: CreatedIds = { instructorId: 0, keywordIds: [], bookIds: [] };
    try {
      await prisma.$transaction(async (tx) => {
        const kw1 = (
          await tx.$queryRaw<any[]>`
          insert into keywords (name) values (${`bench_kw1_${suffix}`}) returning id
        `
        )[0];
        const kw2 = (
          await tx.$queryRaw<any[]>`
          insert into keywords (name) values (${`bench_kw2_${suffix}`}) returning id
        `
        )[0];

        const b1 = (
          await tx.$queryRaw<any[]>`
          insert into books (title, url) values (${`Bench Book A ${suffix}`}, ${`https://example.com/a-${suffix}`}) returning id
        `
        )[0];
        const b2 = (
          await tx.$queryRaw<any[]>`
          insert into books (title, url) values (${`Bench Book B ${suffix}`}, ${`https://example.com/b-${suffix}`}) returning id
        `
        )[0];

        const inst = (
          await tx.$queryRaw<any[]>`
          insert into instructors (first_name, last_name, slug, title, bio, short_bio, trailer_url, is_published, firestore_id)
          values ('Bench', ${`Run ${suffix}`}, ${`bench-${suffix}`}, 'Bench Title', 'bio', 'short', 'https://example.com/trailer', true, ${firestoreId})
          returning id
        `
        )[0];

        await tx.$executeRaw`
          insert into instructor_books (instructor_id, book_id) values (${inst.id}, ${b1.id}), (${inst.id}, ${b2.id})
        `;
        await tx.$executeRaw`
          insert into instructor_keywords (instructor_id, keyword_id, "order") values (${inst.id}, ${kw1.id}, 0), (${inst.id}, ${kw2.id}, 1)
        `;

        ids = {
          instructorId: inst.id,
          keywordIds: [kw1.id, kw2.id],
          bookIds: [b1.id, b2.id],
        };
      });
    } finally {
      if (ids.instructorId) await cleanupCreated(prisma, ids);
    }
    return 1;
  });
}

async function runCreateInstructorDrizzleTx(): Promise<{
  label: string;
  ms: number;
  value: number;
}> {
  const suffix = uniqueSuffix();
  const firestoreId = `bench_${crypto.randomUUID?.() ?? suffix}`;
  return time("drizzle.create instructor (tx)", async () => {
    let ids: CreatedIds = { instructorId: 0, keywordIds: [], bookIds: [] };
    await db.transaction(async (tx) => {
      const kw1 = (await tx.execute(
        sql`insert into keywords (name) values (${`bench_kw1_${suffix}`}) returning id`
      )) as any[];
      const kw2 = (await tx.execute(
        sql`insert into keywords (name) values (${`bench_kw2_${suffix}`}) returning id`
      )) as any[];

      const b1 = (await tx.execute(
        sql`insert into books (title, url) values (${`Bench Book A ${suffix}`}, ${`https://example.com/a-${suffix}`}) returning id`
      )) as any[];
      const b2 = (await tx.execute(
        sql`insert into books (title, url) values (${`Bench Book B ${suffix}`}, ${`https://example.com/b-${suffix}`}) returning id`
      )) as any[];

      const inst = (await tx.execute(
        sql`insert into instructors (first_name, last_name, slug, title, bio, short_bio, trailer_url, is_published, firestore_id)
            values ('Bench', ${`Run ${suffix}`}, ${`bench-${suffix}`}, 'Bench Title', 'bio', 'short', 'https://example.com/trailer', true, ${firestoreId})
            returning id`
      )) as any[];

      await tx.execute(
        sql`insert into instructor_books (instructor_id, book_id) values (${
          (inst as any)[0].id
        }, ${(b1 as any)[0].id}), (${(inst as any)[0].id}, ${
          (b2 as any)[0].id
        })`
      );
      await tx.execute(
        sql`insert into instructor_keywords (instructor_id, keyword_id, "order") values (${
          (inst as any)[0].id
        }, ${(kw1 as any)[0].id}, 0), (${(inst as any)[0].id}, ${
          (kw2 as any)[0].id
        }, 1)`
      );

      ids = {
        instructorId: (inst as any)[0].id,
        keywordIds: [(kw1 as any)[0].id, (kw2 as any)[0].id],
        bookIds: [(b1 as any)[0].id, (b2 as any)[0].id],
      };
    });

    // Cleanup using Prisma outside timing
    await cleanupCreated(new PrismaClient(), ids);
    return 1;
  });
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

  // Multi-step create instructor comparisons
  const createS = await runCreateInstructorSupabase(supabase, prisma);
  const createP = await runCreateInstructorPrismaOrm(prisma);
  const createPRaw = await runCreateInstructorPrismaRaw(prisma);
  const createD = await runCreateInstructorDrizzleTx();
  rows.push(
    { label: createS.label, ms: Math.round(createS.ms), rows: createS.value },
    { label: createP.label, ms: Math.round(createP.ms), rows: createP.value },
    {
      label: createPRaw.label,
      ms: Math.round(createPRaw.ms),
      rows: createPRaw.value,
    },
    { label: createD.label, ms: Math.round(createD.ms), rows: createD.value }
  );
  console.table(rows);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
