# Local database: move from Supabase into the stack

**Why:** the server used a Supabase database in `us-west-2`. Every query crossed the internet (roughly 50–150 ms each), and a page load or library scan makes many of them. A PostgreSQL container next to the server answers in under a millisecond, and the app no longer depends on your internet connection or on Supabase.

The stack now includes an `azure-db` service (`postgres:17-alpine`):
- Its data lives in the Docker volume `azure-db-data` on the Docker host's **local disk**. Never put a database on the NFS/SMB share: a dropped mount can corrupt it.
- It is only reachable inside the stack's network. No port is published.
- The server's existing backups (`server/data/backups`, 7 kept) keep working, because the image's `pg_dump` 17 matches the database.

The server uses `azure-db` **unless `DATABASE_URL` / `DIRECT_URL` are set** in the stack environment. That lets you deploy the new service first and switch over only after the data has been copied.

---

## 1. Add a password and deploy the database (no switch yet)

1. Generate a password. Use letters and digits only, because it goes into a URL:
   ```bash
   openssl rand -hex 24
   ```
2. In **Portainer → Stacks → azure-audiobooks → Editor → Environment variables**:
   - add `POSTGRES_PASSWORD` = that value;
   - **leave `DATABASE_URL` and `DIRECT_URL` as they are for now.**
3. Click **Pull and redeploy**.

`azure-db` starts with an empty database. The server keeps using Supabase.

## 2. Copy the data from Supabase

Stop the server first, so no listening progress is written to Supabase after the copy. In Portainer, go to **Containers → azure-server → Stop**.

Then open **Containers → azure-db → Console** (connect with `/bin/sh`) and run the commands below. Replace `SUPABASE_URL` with the value of your current `DIRECT_URL` from the stack environment, keeping the quotes:

```sh
# Dump only the app's tables (Supabase's own schemas are not needed)
pg_dump "SUPABASE_URL" --schema=public --format=custom --no-owner --no-privileges --file=/tmp/supabase.dump

# Replace the empty local schema with the dump
psql -U azure -d azure -c 'DROP SCHEMA public CASCADE;'
pg_restore -U azure -d azure --no-owner --no-privileges /tmp/supabase.dump

# Check: these counts should match what you see in the app
psql -U azure -d azure -c 'SELECT (SELECT count(*) FROM "Book") AS books, (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Progress") AS progress;'
psql -U azure -d azure -c 'SELECT count(*) AS migrations FROM "_prisma_migrations";'

rm /tmp/supabase.dump
```

A few `pg_restore` warnings about Supabase-only roles or extensions are harmless. An error mentioning one of the app's tables is not: stop and check it before switching.

## 3. Switch the server to the local database

1. In the stack's environment variables, **delete `DATABASE_URL` and `DIRECT_URL`**. The defaults in `docker-compose.yml` then point at `azure-db`.
2. Click **Update the stack** (or **Pull and redeploy**).
3. Check the server logs. You should see:
   - `Datasource "db": PostgreSQL database "azure" ... at "azure-db:5432"`;
   - `No pending migrations to apply.`;
   - a new `Database backed up to ...` line.
4. Sign in to the app and confirm your books, progress and users are there.

## Rolling back

Supabase is untouched by all of this. To go back, put the old `DATABASE_URL` and `DIRECT_URL` values back into the stack environment and redeploy. Anything written to the local database after the switch stays in the local database.

Once you've run on the local database for a while and are happy with it, you can pause or delete the Supabase project.

## Backups

- The server writes a `pg_dump` to `server/data/backups/` on every start, keeping the last 7. On the Docker host that folder is `/data/compose/<stack id>/server/data/backups`.
- The Docker volume itself is not backed up by anything. Copy the backups folder somewhere else on a schedule, for example to the NAS, or include the Docker VM in your Proxmox backup jobs.
