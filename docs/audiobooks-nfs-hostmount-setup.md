# Audiobooks / Unraid NFS — Host-Mount Setup for the Azure (Docker) Box

**Date:** 2026-06-12
**Goal:** Stop the recurring NFS ESTALE failures on the remote Docker host, keep the
unified `/data` hardlink pipeline intact, and establish the mount pattern for migrating
the rest of the containers off Unraid later.

---

## Background / why this approach

- The remote box was mounting the audiobooks folder as a **per-container Docker NFS
  volume** pointed at `:/mnt/user/data/media/audiobooks`.
- `/mnt/user/...` is an Unraid **user share = shfs (FUSE) overlay**, not a real
  filesystem. shfs does not guarantee stable NFS file handles. When a file moves between
  disks (the `data` share is `cache=yes`, so **mover runs weekly, Wed 00:00**) or shfs
  re-evaluates a path, a client's cached handle silently goes stale (ESTALE).
- On container redeploy, runc re-`stat`s the volume mountpoint, hits the now-stale
  handle, and container init fails. (booksync didn't fail only because nothing forced it
  to re-stat.)
- **Only the remote NFS client suffers this.** Local Unraid apps read through FUSE
  directly, which re-resolves every call and never goes stale.

### Why NOT split audiobooks onto a dedicated ZFS share
- ~366 audiobook files (~18.8 GB) are **hardlinked** to seeding torrents in
  `/data/torrents/books` (verified by inode match). Audiobooks are part of the active
  unified-`/data` hardlink pipeline (readarr/qBit import-by-hardlink, then seed).
- Splitting them to a separate filesystem would break those hardlinks (extra space),
  break readarr's `/data` view, and permanently force future book imports to copy
  instead of hardlink. Disproportionate for a remote-only problem.

### The fix
Mount the Unraid share **once at the host level** on the Azure box (held by the host, not
re-mounted per container), then **bind-mount** subpaths into containers. This removes the
redeploy re-stat trigger and is the exact pattern to reuse for the full migration.

---

## Server facts (confirmed on Unraid 2026-06-12)

- Unraid server IP: **192.168.1.37**
- NFS versions enabled: 3, 4, 4.1, **4.2**
- `/data` export: `"/mnt/user/data" -fsid=111,async,no_subtree_check *(rw,sec=sys,insecure,anongid=100,anonuid=99,all_squash)`
- All NFS access is squashed to **uid 99 (nobody) / gid 100 (users)**.

---

## 1. Host-level NFS mount (`/etc/fstab` on the Azure box)

Mount the **whole `/data` share** — not the audiobooks subpath — so the hardlink pipeline
works unchanged when qBit/readarr migrate later.

```fstab
# Unraid NAS — mounted once at host level, bind-mounted into containers
192.168.1.37:/mnt/user/data  /mnt/unraid/data  nfs  _netdev,nofail,hard,noatime,nfsvers=4.2,rsize=1048576,wsize=1048576,x-systemd.automount,x-systemd.mount-timeout=30  0 0
```

Then:

```bash
sudo mkdir -p /mnt/unraid/data
sudo systemctl daemon-reload
sudo mount /mnt/unraid/data
ls /mnt/unraid/data/media/audiobooks      # sanity check — should list your authors
```

**Why this fixes ESTALE:** the mount is established once at host boot and held by the
host, so a container redeploy no longer re-stats / re-mounts an NFS handle. `hard` keeps
I/O safe; `nofail` keeps it from blocking boot if Unraid is down.

> Non-systemd host? Drop the `x-systemd.*` options and use:
> `_netdev,nofail,hard,noatime,nfsvers=4.2,rsize=1048576,wsize=1048576`

---

## 2. docker-compose — swap the named volume for bind mounts

Remove the `Audiobooks` named NFS volume entirely and point containers at the host path.

```yaml
services:
  azure-server:
    # ...
    user: "99:100"            # match Unraid squash (uid 99 / gid 100)
    volumes:
      - ./server/data:/app/data
      - /mnt/unraid/data/media/audiobooks:/app/library

  booksync:
    # ...
    user: "99:100"
    volumes:
      - /mnt/unraid/data/media/audiobooks:/downloads

# DELETE this block:
# volumes:
#   Audiobooks:
#     driver: local
#     driver_opts:
#       type: nfs
#       o: addr=192.168.1.37,rw,nfsvers=4.2
#       device: ":/mnt/user/data/media/audiobooks"
```

`user: "99:100"` (or `PUID=99` / `PGID=100` for LinuxServer-style images) matters because
the server squashes all NFS writes to 99:100. Running as 99:100 keeps ownership
consistent with the rest of the share.

---

## 3. Cutover (on the Azure box, in order)

```bash
# 1. Stop the containers releasing the old volume
docker compose stop azure-server booksync

# 2. Drop the stale Docker NFS volume (force-clear the mount if it resists)
docker volume rm Audiobooks \
  || { sudo umount -f -l /var/lib/docker/volumes/Audiobooks/_data; docker volume rm Audiobooks; }

# 3. Set up the host mount (section 1) and verify ls works

# 4. Apply the compose edits (section 2), then:
docker compose up -d
```

---

## Caveat (stated plainly)

The library watcher polls every 60 s, so the mount never goes idle — meaning
`x-systemd.automount`'s "remount-on-access" self-heal won't fire on its own. The
host-level `hard` mount makes a stale handle **rare** (the redeploy trigger is gone), but
if Unraid ever reboots out from under it, recover with:

```bash
sudo umount -f -l /mnt/unraid/data && sudo mount /mnt/unraid/data
```

---

## When you migrate the rest of the containers (template in action)

One host mount of `/data`, bind subpaths per container:

- **qBittorrent** -> `/mnt/unraid/data/torrents:/data/torrents`
- **readarr / sonarr / radarr** -> `/mnt/unraid/data:/data` (whole share — sees torrents AND media)
- **Plex / Emby / Audiobookshelf** -> `/mnt/unraid/data/media:/media` (read-only is fine)

### The one rule that keeps hardlinks alive
Every app in the import chain must reach **torrents** and **media** through the **same
single mount** (`/mnt/unraid/data`). If you ever mount `torrents` and `media` as two
*separate* NFS mounts, the kernel treats them as different filesystems and hardlinking
fails with `EXDEV` (cross-device) — readarr silently falls back to copying. Mount the
parent, bind the children.

---

## Related follow-up (not covered here)

- **qBittorrent auto-removal:** `GlobalMaxRatio=1` is set but `MaxRatioAction` is not, so
  it defaults to **Pause** — seeded torrents pause and linger in `torrents/books` forever.
  Set "When ratio reaches 1 -> Remove torrent and its files" (safe with hardlinks: the
  library copy survives). Triage the ~263 never-imported downloads (~7.6 GB:
  multi-book bundles, unmatched LitRPG, dupes, `incomplete/`) BEFORE enabling aggressive
  removal, or they'll be deleted un-saved.
