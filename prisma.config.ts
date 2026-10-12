import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // process.env, not env(): env() throws when the variable is unset, which would break
    // `prisma generate` in CI and Docker builds where no database is configured.
    url: process.env.DATABASE_URL ?? "",
  },
});
