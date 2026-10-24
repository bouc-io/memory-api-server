import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// connectionTimeoutMillis restores Prisma 6's 5s connect timeout; pg's default waits forever,
// which would hang requests when Postgres is unreachable.
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  }),
});

export default prisma;
