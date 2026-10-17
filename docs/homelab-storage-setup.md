# Homelab storage: a library mount that doesn't break

**Setup:** Dell R630 running Proxmox → Docker host (VM or LXC) running Portainer and the Azure stack → audiobooks on the Unraid NAS (`192.168.1.37`), share `data`, path `media/audiobooks`.

**Problem:** the library mount on the Docker host drops or goes stale (`ESTALE`). The server then sees an empty `/app/library`, so covers go blank, books vanish and redeploys fail.

This guide fixes it in layers. Each layer helps on its own, and together they make the failure rare, visible and harmless.

| Layer | What it fixes |
| --- | --- |
| 1. Unraid share settings | Stops the NAS from invalidating NFS file handles in the first place |
| 2. Mount type: SMB for Azure | SMB resolves paths, not file handles, so it can't go stale |
| 3. systemd mount on the Docker host | Remounts on access, waits for the network, Docker waits for it |
| 4. Docker refuses to start without it | No more empty library from an unmounted folder |
| 5. Sentinel file + health check | Portainer shows the stack *unhealthy* the moment the share is gone |
| 6. Server-side delete guard | A scan of an empty or missing share can never wipe the library (built in) |
| 7. Network and boot order | Static addressing, a storage link, and the NAS up before the stack |

---

## Why it breaks

- `/mnt/user/...` on Unraid is a **user share** served by `shfs`, a FUSE overlay that combines the cache and array disks. NFS identifies files by *handle*. When `shfs` forgets a handle, or the **mover** moves a file from cache to array, the remote client's handle goes stale (`ESTALE`).
- Your `data` share is **Cache → Array**, so the mover moves every newly added audiobook to the array on a schedule, which triggers exactly that.
- When the mount is stale or missing, `/mnt/unraid/data/...` on the Docker host is just an empty local folder. Docker bind-mounts it anyway and the server starts normally on "nothing".

---

## 1. Unraid settings (on the NAS)

1. **Settings → NFS → Tunable (fuse_remember)** → set to `-1`, then *Apply*.
   - This keeps `shfs` from forgetting NFS file handles, which is the common Unraid fix for stale handles on user shares.
   - Cost: a little RAM per file handle, which is negligible for an audiobook library.
2. **Shares → data → NFS Security**: change **Security** from *Public* to **Private**, with a rule that only lets the Docker host in (replace `192.168.1.50` with its IP):
   ```
   192.168.1.50(rw,sec=sys,insecure,anongid=100,anonuid=99,all_squash)
   ```
   *Public* lets every device on your LAN read and write the whole `data` share.
3. **Shares → data → SMB Security**: keep it *Private*. Under **Users**, create a user such as `azure` with **Read/Write** on `data`. Layer 2 uses this user.
4. *(Optional, the strongest fix)* Keep audiobooks off the mover entirely. Either move the library to a share whose primary storage is a pool or the array **only** (no secondary storage), or put it on a ZFS/btrfs pool share. Real filesystems give stable handles. *Caveat:* audiobooks hardlinked from `torrents/books` must stay on the same share as the torrents (see `audiobooks-nfs-hostmount-setup.md`). That is why steps 1–3 come first.

## 2. Use SMB (CIFS) for the Azure mount

NFS gives you hardlinks and Unix permissions, which only the *arr apps need. Azure only reads, writes covers and tags, and merges files, all of which work fine over SMB. Because SMB resolves files by **path**, the mover and `shfs` can't make it go stale.

On the **Docker host** (the VM/LXC running Portainer):

```bash
sudo apt install -y cifs-utils
sudo install -d -m 700 /etc/samba
sudo tee /etc/samba/azure.cred >/dev/null <<'EOF'
username=azure
password=CHANGE_ME
EOF
sudo chmod 600 /etc/samba/azure.cred
```

*(Prefer to stay on NFS? Skip the CIFS steps and use the NFS options shown in section 3 instead. The rest of the guide is the same.)*

## 3. Mount it with systemd, not a plain fstab line

Replace the old `/mnt/unraid/data` fstab line with this **SMB** version:

```fstab
//192.168.1.37/data  /mnt/unraid/data  cifs  credentials=/etc/samba/azure.cred,uid=99,gid=100,file_mode=0664,dir_mode=0775,vers=3.1.1,cache=loose,actimeo=30,nofail,_netdev,x-systemd.automount,x-systemd.idle-timeout=0,x-systemd.mount-timeout=30,x-systemd.requires=network-online.target  0  0
```

**NFS version**, if you stay on NFS (`soft`/`timeo` make the mount return errors instead of hanging the whole container forever):

```fstab
192.168.1.37:/mnt/user/data  /mnt/unraid/data  nfs  nfsvers=4.2,soft,timeo=150,retrans=3,noatime,rsize=1048576,wsize=1048576,nofail,_netdev,x-systemd.automount,x-systemd.idle-timeout=0,x-systemd.mount-timeout=30,x-systemd.requires=network-online.target  0  0
```

Apply it:

```bash
sudo systemctl daemon-reload
sudo umount -f -l /mnt/unraid/data 2>/dev/null
sudo systemctl restart mnt-unraid-data.automount
ls /mnt/unraid/data/media/audiobooks | head     # should list author folders (this access mounts it)
docker restart azure-server                     # containers must restart to see a new mount
```

**Make Docker wait for the share at boot.** Without this, containers can start before the network share is mounted:

```bash
sudo systemctl edit docker.service
# add:
[Unit]
RequiresMountsFor=/mnt/unraid/data
After=remote-fs.target
```

**Watchdog: remount automatically if the share goes stale.** This script checks the share every minute. When it stops answering, the script remounts it and restarts the containers that use it. The restart matters because a running container keeps its view of the old, dead mount even after the host remounts.

```bash
sudo tee /usr/local/bin/library-mount-check >/dev/null <<'EOF'
#!/bin/sh
# Remount the library share if it is stale or missing.
SENTINEL=/mnt/unraid/data/media/audiobooks/.azure-library
if ! timeout 10 stat "$SENTINEL" >/dev/null 2>&1; then
  logger -t library-mount "library share unreachable, remounting"
  umount -f -l /mnt/unraid/data 2>/dev/null
  sleep 2
  # Touching the path makes the systemd automount mount it again.
  if timeout 30 stat "$SENTINEL" >/dev/null 2>&1; then
    logger -t library-mount "remounted OK, restarting containers"
    docker restart azure-server >/dev/null 2>&1
  else
    logger -t library-mount "remount failed; is the NAS up and the array started?"
  fi
fi
EOF
sudo chmod +x /usr/local/bin/library-mount-check

sudo tee /etc/systemd/system/library-mount-check.service >/dev/null <<'EOF'
[Unit]
Description=Check the Unraid library share
[Service]
Type=oneshot
ExecStart=/usr/local/bin/library-mount-check
EOF
sudo tee /etc/systemd/system/library-mount-check.timer >/dev/null <<'EOF'
[Unit]
Description=Check the Unraid library share every minute
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now library-mount-check.timer
journalctl -t library-mount -f      # watch it work
```

### If the Docker host is a Proxmox **LXC**, not a VM

Unprivileged LXCs can't mount NFS or SMB themselves. Mount the share on the **Proxmox host** instead, using the same fstab line, unit drop-in and watchdog as above but run on the Proxmox node. Then pass it into the container:

```bash
pct set <CTID> -mp0 /mnt/unraid/data,mp=/mnt/unraid/data
```

Also set the LXC's start delay (Options → Start/Shutdown order → Startup delay `60`) so it boots after the mount.

## 4. The stack refuses to start without the share (built in)

`docker-compose.yml` now uses the long bind syntax with `create_host_path: false`. If `/mnt/unraid/data/media/audiobooks` doesn't exist, the container fails to start with a clear error, instead of Docker creating an empty folder.

To point the stack at a different location, set `AUDIOBOOKS_PATH` in the Portainer stack's environment.

## 5. Sentinel file + health check (built in, one step to enable)

Create an empty marker file in the library root, from any machine that sees the share:

```bash
touch /mnt/user/data/media/audiobooks/.azure-library     # on Unraid (or via SMB from your PC)
```

From then on:
- `GET /health` returns `503 {"status":"degraded", ...}` whenever the library is empty, unreadable or missing that file.
- Docker marks `azure-server` **unhealthy**, and Portainer shows it in red.
- The watchdog from section 3 uses the same file.

Set `REQUIRE_LIBRARY_SENTINEL=true` in the stack's environment to require the file from the very first start.

**Get alerted:** add an Uptime Kuma (or similar) HTTP monitor on `http://<docker-host>:4000/health` that alerts on non-200. It catches a dropped share within a minute.

## 6. The server won't delete books when the share looks wrong (built in)

The server skips removing books when:
- any of the library's source folders is empty, unreadable or missing its sentinel; or
- a scan would remove **more than 20% (and at least 25) of a library's books at once**. That is the signature of a wrong or partial mount, not real deletions.

Both cases log `[library-guard] …` and leave the library untouched. If you really did delete many books, set `ALLOW_MASS_BOOK_REMOVAL=true`, rescan once, then remove the setting.

## 7. Network and boot order

- **Static addresses:** give the NAS, the Proxmox node and the Docker host DHCP reservations or static IPs, and use IPs (not hostnames) in the mount lines, so DNS problems can't break storage.
- **Dedicated storage link** *(recommended)*: the R630 has 4 onboard NICs. If the NAS has a free port:
  1. Cable them directly, or put them on a storage VLAN.
  2. Create `vmbr1` in Proxmox on that port, with no gateway.
  3. Give the Docker host a second NIC on `vmbr1`, e.g. `10.10.10.2/24`, and the NAS `10.10.10.1/24`.
  4. Mount via `10.10.10.1`.

  Storage traffic then never competes with streaming or downloads, and switch or router reboots can't drop it. Enable jumbo frames (MTU 9000) on both ends only if every hop supports it.
- **Boot order after a power cut:** in Proxmox, set the Docker host VM's *Start at boot* = yes, *Startup delay* = 120 s. That gives the Unraid array time to start, since Unraid only exports shares once the array is running. Better still:
  1. Put the R630 and the NAS on a UPS.
  2. Use NUT so both shut down cleanly and come back in order.
- **Unraid disk spin-down** doesn't cause stale handles, but the first access after spin-up can take several seconds. The `mount-timeout` and `timeo` values above allow for that.

---

## Quick health check

```bash
# Docker host
findmnt /mnt/unraid/data                                  # mounted? which type?
stat /mnt/unraid/data/media/audiobooks/.azure-library     # share answering?
docker exec azure-server ls /app/library | head           # container sees books?
curl -s localhost:4000/health                             # {"status":"ok",...}
journalctl -t library-mount --since today                 # any remounts?
```

## Recovering a stale mount by hand

```bash
sudo umount -f -l /mnt/unraid/data
ls /mnt/unraid/data/media/audiobooks | head     # the automount mounts it again
docker restart azure-server
```

**Never run a library rescan while the share is unmounted.** The server now refuses to delete books in that case, but there's no reason to test it.
