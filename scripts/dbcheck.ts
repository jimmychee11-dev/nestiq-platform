import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

prisma.company
  .findFirst({ where: { slug: "nestiq-22" }, include: { agents: true } })
  .then((company) => {
    if (company) {
      console.log(`DB OK — company "${company.name}" with ${company.agents.length} agents`);
    } else {
      console.log("DB OK — but company missing, needs reseed");
    }
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("DB FAIL:", error.message);
    process.exit(1);
  });
