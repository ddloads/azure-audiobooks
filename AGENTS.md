# Repository Guidelines

## Project Structure & Module Organization

This repository is a monorepo for Azure Audiobooks. The root contains orchestration files such as `package.json`, `docker-compose.yml`, and `scripts/dev-runner.mjs`.

- `client/`: React 19, TypeScript, Vite, Tailwind CSS, and PWA frontend. Source is in `client/src/`; static assets are in `client/public/`.
- `server/`: Node.js, Express, Socket.IO, Prisma backend.
- `server/src/`: API entry points, routes, controllers, middleware, utilities, and workers.
- `server/prisma/`: schema, migrations, and seed script.

## Build, Test, and Development Commands

Run commands from the repository root unless noted.

- `npm run dev`: starts client and server together through `scripts/dev-runner.mjs`.
- `npm run dev:host`: starts both services with host network exposure.
- `npm run start:client`: runs the Vite dev server in `client/`.
- `npm run start:server`: runs Express with `ts-node-dev`.
- `cd client && npm run build`: type-checks and builds the frontend.
- `cd client && npm run lint`: runs ESLint for frontend code.
- `cd server && npm run seed`: seeds the Prisma database.
- `docker-compose up -d`: starts the containerized stack.

## Coding Style & Naming Conventions

Use TypeScript throughout application code. Follow the existing React functional component style. Component files use PascalCase, for example `BookCard.tsx`; hooks use `use` plus camelCase, for example `useIsMobile.ts`; server files use camelCase names such as `libraryRoutes.ts`.

Run `cd client && npm run lint` before frontend changes. Prefer helpers in `client/src/api/` and `server/src/utils/`.

## Testing Guidelines

The project currently has no committed automated test suite; `server` has a placeholder `npm test`. Validate changes with targeted build and lint commands, plus manual checks of affected flows. Run `cd client && npm run build` for frontend changes and restart the dev server for backend route, Prisma, or worker changes.

When adding tests, place them near the code they cover and use clear names such as `BookCard.test.tsx` or `scanner.test.ts`.

## Commit & Pull Request Guidelines

Recent history uses concise conventional prefixes such as `fix:` and `feat:`. Keep commit subjects imperative and specific, for example `fix: preserve matched metadata in queue navigation`.

Pull requests should include a short description, commands run, linked issues when applicable, and screenshots or recordings for UI/mobile changes. Mention required environment variables, Prisma migrations, or deployment steps.

## Security & Configuration Tips

Do not commit `.env` files, database URLs, JWT secrets, Audible credentials, or local library paths. Required runtime configuration includes `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, and `CLIENT_ORIGIN`; see `README.md` for deployment defaults and Supabase notes.
