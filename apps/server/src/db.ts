import { PrismaClient } from "@prisma/client"
import { singleConnectionUrl } from "@/dbUrl"

const url = process.env.DATABASE_URL

export const prisma = new PrismaClient(url ? { datasources: { db: { url: singleConnectionUrl(url) } } } : undefined)
