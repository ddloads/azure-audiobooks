#!/usr/bin/env bash
# Sets up a resilient mount of the Unraid audiobook share for the Azure stack.
# See docs/homelab-storage-setup.md for the why.
#
# Run as root on:
#   - the Docker host, if it is a VM or bare metal          → mounts there
#   - the Proxmox node, if the Docker host is an LXC        → mounts on the node
#     and passes it into the container (use --ctid <id>)
#
# What it does (idempotent; safe to re-run):
#   1. installs cifs-utils (SMB) or nfs-common (NFS)
#   2. test-mounts the share with your credentials before touching anything
#   3. replaces any existing fstab entry for the mount point (backup kept)
#      with a systemd automount entry
#   4. makes docker.service wait for the mount (Docker hosts)
#   5. installs a 1-minute watchdog that remounts a stale share and restarts
#      the Azure container
#   6. creates the .azure-library sentinel, remounts, and verifies
#
# Usage:
#   sudo ./scripts/setup-library-mount.sh                 # SMB, defaults below
#   sudo ./scripts/setup-library-mount.sh --nfs           # hardened NFS instead
#   sudo ./scripts/setup-library-mount.sh --ctid 105      # on the Proxmox node, LXC 105
#   sudo ./scripts/setup-library-mount.sh --dry-run       # show what would change
#
# Options (or the matching environment variables):
#   --nas-ip IP          NAS_IP          default 192.168.1.37
#   --share NAME         SHARE           default data
#   --mount-point DIR    MOUNT_POINT     default /mnt/unraid/data
#   --library PATH       LIBRARY_SUBPATH default media/audiobooks  (inside the share)
#   --user NAME          SMB_USER        default azure             (SMB only)
#                        SMB_PASSWORD    prompted if not set       (SMB only)
#   --container NAME     CONTAINER       default azure-server
#   --ctid ID            CTID            LXC to pass the mount into (Proxmox node only)
#   --nfs                PROTO=nfs       use NFS instead of SMB
#   --dry-run            DRY_RUN=1
set -euo pipefail

NAS_IP="${NAS_IP:-192.168.1.37}"
SHARE="${SHARE:-data}"
MOUNT_POINT="${MOUNT_POINT:-/mnt/unraid/data}"
LIBRARY_SUBPATH="${LIBRARY_SUBPATH:-media/audiobooks}"
SMB_USER="${SMB_USER:-azure}"
CONTAINER="${CONTAINER:-azure-server}"
CTID="${CTID:-}"
PROTO="${PROTO:-smb}"
DRY_RUN="${DRY_RUN:-0}"
NFS_EXPORT_ROOT="${NFS_EXPORT_ROOT:-/mnt/user}"
SENTINEL_NAME=".azure-library"
CRED_FILE="/etc/samba/azure-library.cred"

while [ $# -gt 0 ]; do
  case "$1" in
    --nas-ip) NAS_IP="$2"; shift 2 ;;
    --share) SHARE="$2"; shift 2 ;;
    --mount-point) MOUNT_POINT="$2"; shift 2 ;;
    --library) LIBRARY_SUBPATH="$2"; shift 2 ;;
    --user) SMB_USER="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --ctid) CTID="$2"; shift 2 ;;
    --nfs) PROTO="nfs"; shift ;;
    --smb) PROTO="smb"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

MOUNT_POINT="${MOUNT_POINT%/}"
LIBRARY_DIR="$MOUNT_POINT/${LIBRARY_SUBPATH#/}"
SENTINEL="$LIBRARY_DIR/$SENTINEL_NAME"
UNIT_NAME="$(systemd-escape --path "$MOUNT_POINT" 2>/dev/null || echo "mnt-unraid-data")"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*" >&2; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}
write_file() { # write_file <path> <mode>  (content on stdin)
  local path="$1" mode="$2" content
  content="$(cat)"
  if [ "$DRY_RUN" = 1 ]; then
    printf '  [dry-run] write %s:\n%s\n' "$path" "$(printf '%s\n' "$content" | sed 's/^/      /')"
    return
  fi
  install -d "$(dirname "$path")"
  printf '%s\n' "$content" > "$path"
  chmod "$mode" "$path"
}

[ "$(id -u)" -eq 0 ] || die "run as root (sudo $0)"
command -v systemctl >/dev/null || die "systemd is required"

# ── Where are we? ───────────────────────────────────────────────────────────
VIRT="$(systemd-detect-virt 2>/dev/null || true)"
IS_PROXMOX_NODE=0
[ -d /etc/pve ] && command -v pct >/dev/null && IS_PROXMOX_NODE=1

bold "Azure library mount setup"
info "Machine type:  ${VIRT:-none} $([ "$IS_PROXMOX_NODE" = 1 ] && echo '(Proxmox node)')"
info "Share:         $([ "$PROTO" = smb ] && echo "//$NAS_IP/$SHARE (SMB)" || echo "$NAS_IP:$NFS_EXPORT_ROOT/$SHARE (NFS)")"
info "Mount point:   $MOUNT_POINT"
info "Library:       $LIBRARY_DIR"
[ "$DRY_RUN" = 1 ] && info "Dry run: nothing will be changed."

if [ "$VIRT" = "lxc" ]; then
  die "this is an LXC container. Unprivileged containers can't mount network shares.
Run this script on the Proxmox node instead, with --ctid <this container's ID>,
e.g.  sudo ./setup-library-mount.sh --ctid 105"
fi
if [ -n "$CTID" ] && [ "$IS_PROXMOX_NODE" != 1 ]; then
  die "--ctid only works on the Proxmox node"
fi

# Ownership of files on an SMB mount. Docker containers run as root and the
# Unraid share squashes to nobody:users (99:100). For an unprivileged LXC,
# container root is host uid 100000, so map files to that instead.
OWNER_UID=99
OWNER_GID=100
if [ -n "$CTID" ]; then
  pct config "$CTID" >/dev/null 2>&1 || die "LXC $CTID not found"
  if pct config "$CTID" | grep -q '^unprivileged: 1'; then
    OWNER_UID=100000
    OWNER_GID=100000
    info "LXC $CTID is unprivileged: mapping files to its root user (100000)."
  fi
fi

# ── 1. Packages ─────────────────────────────────────────────────────────────
bold "1/6  Packages"
PKG=$([ "$PROTO" = smb ] && echo cifs-utils || echo nfs-common)
HELPER=$([ "$PROTO" = smb ] && echo mount.cifs || echo mount.nfs)
if command -v "$HELPER" >/dev/null; then
  info "$PKG already installed"
elif command -v apt-get >/dev/null; then
  run apt-get update -qq
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$PKG"
elif command -v dnf >/dev/null; then
  run dnf install -y "$([ "$PROTO" = smb ] && echo cifs-utils || echo nfs-utils)"
else
  die "install $PKG yourself, then re-run"
fi

# ── 2. Credentials + test mount ─────────────────────────────────────────────
bold "2/6  Test the share"
COMMON_OPTS="nofail,_netdev,x-systemd.mount-timeout=30,x-systemd.requires=network-online.target,x-systemd.after=network-online.target"
# Automount (remount on first access) suits a Docker host. An LXC bind of an
# autofs mount point doesn't trigger it from inside the container, so on a
# Proxmox node the share is mounted normally at boot instead.
if [ -z "$CTID" ]; then
  COMMON_OPTS="$COMMON_OPTS,x-systemd.automount,x-systemd.idle-timeout=0"
  MOUNT_UNIT="$UNIT_NAME.automount"
else
  MOUNT_UNIT="$UNIT_NAME.mount"
fi
if [ "$PROTO" = smb ]; then
  SOURCE="//$NAS_IP/$SHARE"
  FSTYPE=cifs
  if [ -z "${SMB_PASSWORD:-}" ] && [ -f "$CRED_FILE" ] && grep -q "^username=$SMB_USER$" "$CRED_FILE"; then
    info "Using saved credentials in $CRED_FILE"
  else
    if [ -z "${SMB_PASSWORD:-}" ]; then
      read -r -s -p "  Unraid password for SMB user '$SMB_USER': " SMB_PASSWORD; echo
    fi
    [ -n "$SMB_PASSWORD" ] || die "no password given"
    if [ "$DRY_RUN" = 1 ]; then
      info "[dry-run] write $CRED_FILE (mode 600) for user $SMB_USER"
    else
      printf 'username=%s\npassword=%s\n' "$SMB_USER" "$SMB_PASSWORD" | write_file "$CRED_FILE" 600
    fi
  fi
  MOUNT_OPTS="credentials=$CRED_FILE,uid=$OWNER_UID,gid=$OWNER_GID,file_mode=0664,dir_mode=0775,vers=3.1.1,cache=loose,actimeo=30,$COMMON_OPTS"
  TEST_OPTS="credentials=$CRED_FILE,vers=3.1.1,ro"
else
  SOURCE="$NAS_IP:$NFS_EXPORT_ROOT/$SHARE"
  FSTYPE=nfs
  MOUNT_OPTS="nfsvers=4.2,soft,timeo=150,retrans=3,noatime,rsize=1048576,wsize=1048576,$COMMON_OPTS"
  TEST_OPTS="nfsvers=4.2,soft,timeo=50,retrans=1,ro"
fi

if [ "$DRY_RUN" = 1 ]; then
  info "[dry-run] would test-mount $SOURCE read-only"
else
  TEST_DIR="$(mktemp -d /tmp/azure-mount-test.XXXX)"
  cleanup_test() { umount "$TEST_DIR" 2>/dev/null || true; rmdir "$TEST_DIR" 2>/dev/null || true; }
  trap cleanup_test EXIT
  if ! timeout 45 mount -t "$FSTYPE" -o "$TEST_OPTS" "$SOURCE" "$TEST_DIR" 2>/tmp/azure-mount-test.err; then
    cat /tmp/azure-mount-test.err >&2
    if [ "$PROTO" = smb ]; then
      rm -f "$CRED_FILE"   # so the next run asks for the password again
      die "could not mount $SOURCE. Check: the NAS is up and the array started; SMB export is on for '$SHARE';
user '$SMB_USER' exists in Unraid (Users) with Read/Write on '$SHARE'; the password is right.
Then run this script again; it will ask for the password."
    else
      die "could not mount $SOURCE. Check the NFS export rule for '$SHARE' allows this machine's IP."
    fi
  fi
  [ -d "$TEST_DIR/${LIBRARY_SUBPATH#/}" ] || die "mounted the share, but '$LIBRARY_SUBPATH' doesn't exist in it. Pass --library <path inside the share>."
  BOOK_DIRS="$(find "$TEST_DIR/${LIBRARY_SUBPATH#/}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
  info "OK: $SOURCE mounts; '$LIBRARY_SUBPATH' has $BOOK_DIRS folders."
  [ "$BOOK_DIRS" -gt 0 ] || warn "the library folder is empty on the NAS. Continuing, but double-check --library."
  cleanup_test
  trap - EXIT
fi

# ── 3. fstab ────────────────────────────────────────────────────────────────
bold "3/6  /etc/fstab"
FSTAB_LINE="$SOURCE  $MOUNT_POINT  $FSTYPE  $MOUNT_OPTS  0  0"
if grep -qsF "$FSTAB_LINE" /etc/fstab; then
  info "Entry already present"
else
  BACKUP="/etc/fstab.azure-backup.$(date +%Y%m%d%H%M%S)"
  run cp /etc/fstab "$BACKUP"
  info "Backup: $BACKUP"
  # Comment out any other entry for the same mount point.
  if awk -v mp="$MOUNT_POINT" '$0 !~ /^[[:space:]]*#/ && $2 == mp { found = 1 } END { exit !found }' /etc/fstab; then
    info "Disabling the old entry for $MOUNT_POINT:"
    awk -v mp="$MOUNT_POINT" '$0 !~ /^[[:space:]]*#/ && $2 == mp { print "    " $0 }' /etc/fstab
    if [ "$DRY_RUN" != 1 ]; then
      awk -v mp="$MOUNT_POINT" '{ if ($0 !~ /^[[:space:]]*#/ && $2 == mp) print "# replaced by setup-library-mount.sh: " $0; else print }' \
        /etc/fstab > /etc/fstab.azure-tmp && cat /etc/fstab.azure-tmp > /etc/fstab && rm -f /etc/fstab.azure-tmp
    fi
  fi
  if [ "$DRY_RUN" = 1 ]; then
    info "[dry-run] append: $FSTAB_LINE"
  else
    printf '\n# Unraid library share for Azure (setup-library-mount.sh)\n%s\n' "$FSTAB_LINE" >> /etc/fstab
    info "Added: $FSTAB_LINE"
  fi
fi
run install -d "$MOUNT_POINT"

# ── 4. Docker waits for the mount ───────────────────────────────────────────
bold "4/6  Boot order"
if [ -z "$CTID" ] && systemctl list-unit-files docker.service >/dev/null 2>&1 && systemctl cat docker.service >/dev/null 2>&1; then
  write_file /etc/systemd/system/docker.service.d/azure-library-mount.conf 644 <<EOF
# Start Docker only once the library share is available (setup-library-mount.sh)
[Unit]
RequiresMountsFor=$MOUNT_POINT
After=remote-fs.target
EOF
  info "docker.service now waits for $MOUNT_POINT"
elif [ -n "$CTID" ]; then
  run pct set "$CTID" --startup "order=10,up=60"
  info "LXC $CTID starts after the node's mounts (startup delay 60s)"
else
  info "Docker not found here; skipping"
fi

# ── 5. Watchdog ─────────────────────────────────────────────────────────────
bold "5/6  Watchdog"
if [ -n "$CTID" ]; then
  # The container's bind still points at the dead mount; only a restart of
  # the LXC picks up the new one.
  RESTART_CMD="pct reboot $CTID"
else
  RESTART_CMD="docker restart $CONTAINER"
fi
write_file /usr/local/bin/azure-library-mount-check 755 <<EOF
#!/bin/sh
# Remounts the library share when it stops answering, then restarts the Azure
# container: a running container keeps its view of a dead mount.
# Installed by setup-library-mount.sh.
SENTINEL="$SENTINEL"
LIBRARY="$LIBRARY_DIR"
if timeout 10 stat "\$SENTINEL" >/dev/null 2>&1; then exit 0; fi
# No sentinel yet but the library answers: nothing to fix.
if [ ! -e "\$SENTINEL" ] && timeout 10 ls "\$LIBRARY" 2>/dev/null | head -n 1 | grep -q .; then exit 0; fi
logger -t azure-library "library share unreachable; remounting $MOUNT_POINT"
umount -f -l "$MOUNT_POINT" 2>/dev/null
sleep 2
systemctl restart $MOUNT_UNIT 2>/dev/null || mount "$MOUNT_POINT" 2>/dev/null
if timeout 40 ls "\$LIBRARY" 2>/dev/null | head -n 1 | grep -q .; then
  logger -t azure-library "remounted; running: $RESTART_CMD"
  $RESTART_CMD >/dev/null 2>&1 || logger -t azure-library "could not restart $CONTAINER"
else
  logger -t azure-library "remount failed: is the NAS up and the array started?"
fi
EOF
write_file /etc/systemd/system/azure-library-mount-check.service 644 <<EOF
[Unit]
Description=Check the Azure library share
[Service]
Type=oneshot
ExecStart=/usr/local/bin/azure-library-mount-check
EOF
write_file /etc/systemd/system/azure-library-mount-check.timer 644 <<EOF
[Unit]
Description=Check the Azure library share every minute
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s
[Install]
WantedBy=timers.target
EOF

# ── 6. Switch over and verify ───────────────────────────────────────────────
bold "6/6  Switch over"
run systemctl daemon-reload
if findmnt -rn "$MOUNT_POINT" >/dev/null 2>&1; then
  info "Unmounting the current mount (lazy, so running containers aren't killed)"
  run umount -f -l "$MOUNT_POINT"
fi
run systemctl restart "$MOUNT_UNIT"
run systemctl enable --now azure-library-mount-check.timer

if [ "$DRY_RUN" = 1 ]; then
  bold "Dry run finished. Re-run without --dry-run to apply."
  exit 0
fi

timeout 45 ls "$LIBRARY_DIR" >/dev/null 2>&1 || die "the share didn't come up at $LIBRARY_DIR. See: journalctl -u $UNIT_NAME.mount"
info "Mounted: $(findmnt -rn -o SOURCE,FSTYPE "$MOUNT_POINT" | tail -n 1)"

if [ ! -e "$SENTINEL" ]; then
  if touch "$SENTINEL" 2>/dev/null; then info "Created $SENTINEL"
  else warn "couldn't create $SENTINEL (read-only?). Create it on Unraid: touch /mnt/user/$SHARE/${LIBRARY_SUBPATH#/}/$SENTINEL_NAME"
  fi
fi

if [ -n "$CTID" ]; then
  if pct config "$CTID" | grep -q "mp=$MOUNT_POINT"; then
    info "LXC $CTID already has $MOUNT_POINT mounted in"
  else
    FREE_MP=""
    for i in $(seq 0 9); do pct config "$CTID" | grep -q "^mp$i:" || { FREE_MP="mp$i"; break; }; done
    [ -n "$FREE_MP" ] || die "no free mount slot (mp0-mp9) on LXC $CTID"
    pct set "$CTID" "-$FREE_MP" "$MOUNT_POINT,mp=$MOUNT_POINT"
    info "Added $FREE_MP to LXC $CTID. Restarting it so it sees the mount."
    pct reboot "$CTID" || warn "restart LXC $CTID yourself"
  fi
elif command -v docker >/dev/null && docker inspect "$CONTAINER" >/dev/null 2>&1; then
  info "Restarting $CONTAINER so it sees the new mount"
  docker restart "$CONTAINER" >/dev/null
  sleep 15
  if command -v curl >/dev/null; then
    HEALTH="$(curl -s -m 10 http://127.0.0.1:4000/health || true)"
    info "Health: ${HEALTH:-no answer yet (it may still be starting)}"
  fi
  COUNT="$(docker exec "$CONTAINER" sh -c 'ls /app/library | wc -l' 2>/dev/null || echo '?')"
  info "Container sees $COUNT entries in /app/library"
else
  info "Container '$CONTAINER' not found here; redeploy the stack in Portainer."
fi

bold "Done."
cat <<EOF
  Check any time:   findmnt $MOUNT_POINT && ls $LIBRARY_DIR | head
  Watchdog log:     journalctl -t azure-library -f
  Undo:             restore the newest /etc/fstab.azure-backup.* and run
                    systemctl disable --now azure-library-mount-check.timer
EOF
