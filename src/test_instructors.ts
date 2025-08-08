import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

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

async function main() {
  const prisma = new PrismaClient();
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SUPABASE_KEY = process.env.SUPABASE_KEY!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const pageSize = Number(process.env.BENCH_LIMIT ?? 50);

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
      select: {
        books: {
          select: {
            id: true,
            title: true,
            url: true,
          },
        },
      },
    },

    instructor_keywords: {
      select: {
        keywords: {
          select: {
            id: true,
            name: true,
          },
        },
        order: true,
      },
    },

    featured_instructors: {
      select: {
        order: true,
      },
    },
  } as const;

  const where = {};
  const orderBy = [{ created_at: "desc" as const }];

  const prismaResult = await time(
    "prisma.instructors.findMany (app-select)",
    async () => {
      const rows = await prisma.instructors.findMany({
        select: selectShape,
        where,
        orderBy,
        take: pageSize,
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
    "supabase.instructors.select (app-select)",
    async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select(selectString)
        .order("created_at", { ascending: false })
        .limit(pageSize);
      if (error) throw error;
      return data?.length ?? 0;
    }
  );

  console.table([
    {
      label: supabaseResult.label,
      ms: Math.round(supabaseResult.ms),
      rows: supabaseResult.value,
    },
    {
      label: prismaResult.label,
      ms: Math.round(prismaResult.ms),
      rows: prismaResult.value,
    },
  ]);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
