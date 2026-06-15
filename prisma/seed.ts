/**
 * Seed: demo company "NestIQ" at /dashboard/nestiq-22 with the full
 * five-agent fleet. Run with `npm run seed`.
 */

import { PrismaClient } from "@prisma/client";
import { DEFAULT_AGENTS } from "../src/lib/defaultAgents";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const company = await prisma.company.upsert({
    where: { slug: "nestiq-22" },
    create: {
      slug: "nestiq-22",
      name: "NestIQ",
      arrCents: BigInt(48_750_000), // $487.5K ARR
      monthlyTokenBudget: 5_000_000,
      modelCallsPerMinute: 30,
    },
    update: {},
  });

  for (const agent of DEFAULT_AGENTS) {
    await prisma.agent.upsert({
      where: { companyId_role: { companyId: company.id, role: agent.role } },
      create: {
        companyId: company.id,
        role: agent.role,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
      },
      update: { name: agent.name, systemPrompt: agent.systemPrompt },
    });
  }

  console.log(`Seeded company "${company.name}" → http://localhost:3000/dashboard/${company.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
