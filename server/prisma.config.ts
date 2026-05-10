import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  migrations: {
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
})
