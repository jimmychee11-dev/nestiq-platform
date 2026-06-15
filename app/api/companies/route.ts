import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { toErrorResponse } from "@/src/lib/apiError";
import { DEFAULT_AGENTS } from "@/src/lib/defaultAgents";
import { BUSINESS_STAGES, type BusinessProfile } from "@/src/lib/businessProfile";
import { generateLeanCanvas } from "@/src/engine/canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const CreateCompanySchema = z.object({
  name: z.string().min(2).max(80),
  idea: z.string().min(10).max(2_000),
  industry: z.string().min(2).max(120),
  targetMarket: z.string().min(2).max(500),
  stage: z.enum(BUSINESS_STAGES),
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export async function GET(): Promise<NextResponse> {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, slug: true, name: true, createdAt: true },
    });
    return NextResponse.json({ companies });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = CreateCompanySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { name, idea, industry, targetMarket, stage } = parsed.data;

  try {
    const base = slugify(name) || "company";
    let slug = base;
    for (let i = 2; await prisma.company.findUnique({ where: { slug } }); i++) {
      slug = `${base}-${i}`;
    }

    const profile: BusinessProfile = { idea, industry, targetMarket, stage, canvas: null };

    const company = await prisma.company.create({
      data: {
        slug,
        name,
        businessProfile: profile,
        agents: {
          create: DEFAULT_AGENTS.map((agent) => ({
            role: agent.role,
            name: agent.name,
            systemPrompt: agent.systemPrompt,
          })),
        },
      },
    });

    let canvas = null;
    let canvasError: string | null = null;
    try {
      canvas = await generateLeanCanvas(profile);
      await prisma.company.update({
        where: { id: company.id },
        data: { businessProfile: { ...profile, canvas } },
      });
    } catch (error) {
      canvasError = error instanceof Error ? error.message : String(error);
    }

    return NextResponse.json(
      { id: company.id, slug: company.slug, name: company.name, canvas, canvasError },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
