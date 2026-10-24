import fcntl
import hmac
import ipaddress
import os
import re
import socket
import sqlite3
import struct
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

# ---------- config (all via env vars) ----------
SUBNET = os.environ.get("SUBNET", "192.168.1.0/24")
SUBNETS = [s.strip() for s in SUBNET.split(",") if s.strip()]
SUBNET_V6 = os.environ.get("SUBNET_V6", "").strip()
SUBNETS_V6 = [s.strip() for s in SUBNET_V6.split(",") if s.strip()]
SCAN_INTERVAL = int(os.environ.get("SCAN_INTERVAL", "120"))  # seconds
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
DB_PATH = os.environ.get("DB_PATH", "/data/netwatch.db")
NMAP_ARGS = os.environ.get("NMAP_ARGS", "-sn")  # ping/ARP sweep, no port scan by default
PUBLIC_IP_INTERVAL = int(os.environ.get("PUBLIC_IP_INTERVAL", "600"))  # seconds between WAN IP checks
PUBLIC_IP_ENABLED = os.environ.get("PUBLIC_IP_ENABLED", "true").strip().lower() != "false"

AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "").strip()  # blank = no login required
SECRET_KEY = os.environ.get("SECRET_KEY", "").strip() or os.urandom(32).hex()

STALE_DAYS = int(os.environ.get("STALE_DAYS", "30"))  # 0 disables auto-archiving of stale devices

DAILY_DIGEST_ENABLED = os.environ.get("DAILY_DIGEST_ENABLED", "true").strip().lower() != "false"
DAILY_DIGEST_INTERVAL = int(os.environ.get("DAILY_DIGEST_INTERVAL", str(24 * 3600)))

VENDOR_LOOKUP_ENABLED = os.environ.get("VENDOR_LOOKUP_ENABLED", "true").strip().lower() != "false"

# Gateway IP shown as the hub in the topology view. Defaults to the first
# usable address in the first configured subnet (typically the router)
# unless overridden.
try:
    _net = ipaddress.ip_network(SUBNETS[0], strict=False)
    DEFAULT_GATEWAY = str(list(_net.hosts())[0]) if _net.num_addresses > 2 else str(_net.network_address)
except Exception:
    DEFAULT_GATEWAY = ""
GATEWAY_IP = os.environ.get("GATEWAY_IP", DEFAULT_GATEWAY).strip()

GROUP_TAGS = ["family", "iot", "guest", "work", "infrastructure", "other"]

DEVICE_TYPES = [
    "router", "computer", "laptop", "phone", "tablet", "tv",
    "speaker", "camera", "printer", "console", "server", "switch", "hub", "access_point", "firewall", "microcontroller", "raspberry_pi", "nas", "iot", "other",
]


# ---------- self-detection ----------
# nmap can't ARP-resolve the box it's running on (you don't ARP yourself),
# so the host running netwatch often shows up missing entirely, or present
# with no MAC address. We detect our own LAN IP + MAC here so we can patch
# that in automatically.
SIOCGIFADDR = 0x8915


def _iface_ip(ifname):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        return socket.inet_ntoa(
            fcntl.ioctl(s.fileno(), SIOCGIFADDR, struct.pack("256s", ifname[:15].encode()))[20:24]
        )
    except OSError:
        return None
    finally:
        s.close()


def detect_self():
    self_ip = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        self_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    self_mac = None
    try:
        for iface in os.listdir("/sys/class/net"):
            if iface == "lo":
                continue
            if _iface_ip(iface) == self_ip and self_ip:
                mac_path = f"/sys/class/net/{iface}/address"
                if os.path.exists(mac_path):
                    with open(mac_path) as f:
                        self_mac = f.read().strip().upper()
                break
    except Exception:
        pass

    return self_ip, self_mac


SELF_IP, SELF_MAC = detect_self()

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = timedelta(days=30)
db_lock = threading.Lock()
scan_state_lock = threading.Lock()
scan_in_progress = False
scan_now_event = threading.Event()


# ---------- auth (only enforced if AUTH_PASSWORD is set) ----------
def is_authenticated():
    if not AUTH_PASSWORD:
        return True
    return session.get("authed") is True


@app.before_request
def require_login():
    if not AUTH_PASSWORD:
        return
    if request.path in ("/login", "/manifest.json", "/sw.js") or request.path.startswith("/static/"):
        return
    if is_authenticated():
        return
    if request.path.startswith("/api/"):
        return jsonify({"error": "authentication required"}), 401
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        submitted = request.form.get("password", "")
        if hmac.compare_digest(submitted, AUTH_PASSWORD):
            session.permanent = True
            session["authed"] = True
            return redirect(url_for("index"))
        error = "Incorrect password"
    return render_template("login.html", error=error)


@app.route("/logout", methods=["POST"])
def logout():
    session.pop("authed", None)
    return redirect(url_for("login"))


# ---------- database ----------
def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS devices (
            ip TEXT PRIMARY KEY,
            mac TEXT,
            hostname TEXT,
            vendor TEXT,
            vendor_override TEXT DEFAULT '',
            mac_override TEXT DEFAULT '',
            device_type TEXT DEFAULT '',
            label TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            muted INTEGER DEFAULT 0,
            pinned INTEGER DEFAULT 0,
            known INTEGER DEFAULT 0,
            total_scans INTEGER DEFAULT 0,
            online_scans INTEGER DEFAULT 0,
            first_seen TEXT,
            last_seen TEXT,
            status TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ran_at TEXT,
            devices_found INTEGER
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS public_ip (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            ip TEXT,
            first_seen TEXT,
            last_seen TEXT,
            last_checked TEXT,
            notify_enabled INTEGER DEFAULT 1
        )
        """
    )
    # separate migration pass for the public_ip table (different columns
    # than devices, so it needs its own existing-columns check)
    existing_pubip_cols = {row["name"] for row in conn.execute("PRAGMA table_info(public_ip)")}
    if "notify_enabled" not in existing_pubip_cols:
        conn.execute("ALTER TABLE public_ip ADD COLUMN notify_enabled INTEGER DEFAULT 1")
    # lightweight migration for upgrades from earlier schema versions
    existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(devices)")}
    for col, ddl in [
        ("label", "ALTER TABLE devices ADD COLUMN label TEXT DEFAULT ''"),
        ("notes", "ALTER TABLE devices ADD COLUMN notes TEXT DEFAULT ''"),
        ("vendor_override", "ALTER TABLE devices ADD COLUMN vendor_override TEXT DEFAULT ''"),
        ("mac_override", "ALTER TABLE devices ADD COLUMN mac_override TEXT DEFAULT ''"),
        ("device_type", "ALTER TABLE devices ADD COLUMN device_type TEXT DEFAULT ''"),
        ("pinned", "ALTER TABLE devices ADD COLUMN pinned INTEGER DEFAULT 0"),
        ("known", "ALTER TABLE devices ADD COLUMN known INTEGER DEFAULT 0"),
        ("total_scans", "ALTER TABLE devices ADD COLUMN total_scans INTEGER DEFAULT 0"),
        ("online_scans", "ALTER TABLE devices ADD COLUMN online_scans INTEGER DEFAULT 0"),
        ("muted", "ALTER TABLE devices ADD COLUMN muted INTEGER DEFAULT 0"),
        ("group_tag", "ALTER TABLE devices ADD COLUMN group_tag TEXT DEFAULT ''"),
        ("alert_critical", "ALTER TABLE devices ADD COLUMN alert_critical INTEGER DEFAULT 0"),
        ("ip_version", "ALTER TABLE devices ADD COLUMN ip_version INTEGER DEFAULT 4"),
        ("vendor_api", "ALTER TABLE devices ADD COLUMN vendor_api TEXT DEFAULT ''"),
        ("archived", "ALTER TABLE devices ADD COLUMN archived INTEGER DEFAULT 0"),
    ]:
        if col not in existing_cols:
            conn.execute(ddl)
    conn.commit()
    conn.close()


# ---------- nmap ----------
HOST_LINE = re.compile(r"Nmap scan report for (?:(\S+) \()?([0-9a-fA-F:.]+)\)?")
MAC_LINE = re.compile(r"MAC Address: ([0-9A-Fa-f:]{17})(?: \((.+)\))?")


def _parse_nmap_output(stdout, ip_version):
    devices = []
    current = None
    for line in stdout.splitlines():
        host_match = HOST_LINE.search(line)
        if host_match:
            hostname, ip = host_match.groups()
            current = {"ip": ip, "hostname": hostname or "", "mac": "", "vendor": "", "ip_version": ip_version}
            devices.append(current)
            continue
        mac_match = MAC_LINE.search(line)
        if mac_match and current:
            mac, vendor = mac_match.groups()
            current["mac"] = mac
            current["vendor"] = vendor or ""
    return devices


def run_scan():
    devices = []

    if SUBNETS:
        try:
            result = subprocess.run(
                ["nmap"] + NMAP_ARGS.split() + SUBNETS,
                capture_output=True,
                text=True,
                timeout=300,
            )
            devices.extend(_parse_nmap_output(result.stdout, 4))
        except Exception as e:
            print(f"[scan] nmap (v4) failed: {e}")

    if SUBNETS_V6:
        try:
            result = subprocess.run(
                ["nmap", "-6"] + NMAP_ARGS.split() + SUBNETS_V6,
                capture_output=True,
                text=True,
                timeout=300,
            )
            devices.extend(_parse_nmap_output(result.stdout, 6))
        except Exception as e:
            print(f"[scan] nmap (v6) failed: {e}")

    return devices


def patch_self_entry(devices):
    """Make sure the host netwatch runs on always appears in scan results
    with a correct MAC — nmap can't ARP-resolve its own scanning host."""
    if not SELF_IP:
        return devices

    for d in devices:
        if d["ip"] == SELF_IP and not d["mac"] and SELF_MAC:
            d["mac"] = SELF_MAC
            return devices

    if not any(d["ip"] == SELF_IP for d in devices):
        devices.append(
            {
                "ip": SELF_IP,
                "hostname": socket.gethostname(),
                "mac": SELF_MAC or "",
                "vendor": "",
            }
        )
    return devices


_vendor_offline_until = 0.0


def lookup_vendor_online(ip, mac):
    """nmap's vendor lookup uses a bundled MAC-prefix database that only
    updates when nmap itself is upgraded, so newer device vendors often
    just show blank. Fall back to a free online lookup for those cases —
    only called for devices nmap couldn't identify, and only once per
    device (result cached in vendor_api) so this stays lightweight."""
    global _vendor_offline_until
    if time.time() < _vendor_offline_until:
        return  # no internet a moment ago — don't stall the scan again
    try:
        resp = requests.get(f"https://api.macvendors.com/{mac}", timeout=6)
        if resp.status_code == 200 and resp.text.strip():
            vendor = resp.text.strip()
            with db_lock:
                conn = get_db()
                conn.execute("UPDATE devices SET vendor_api=? WHERE ip=?", (vendor, ip))
                conn.commit()
                conn.close()
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        _vendor_offline_until = time.time() + 600
        print(f"[vendor-lookup] offline, pausing lookups for 10 min: {e}")
    except Exception as e:
        print(f"[vendor-lookup] failed for {mac}: {e}")


EVENT_STYLE = {
    "new":          {"title": "New device joined the network", "color": 0x5EEAEA, "emoji": "🆕"},
    "connected":    {"title": "Device connected",               "color": 0x57F287, "emoji": "🟢"},
    "disconnected": {"title": "Device disconnected",             "color": 0xE2555A, "emoji": "🔴"},
}


def notify_discord_event(row, event):
    if not DISCORD_WEBHOOK_URL:
        return

    style = EVENT_STYLE[event]
    name = (row.get("label") or "").strip() or (row.get("hostname") or "").strip() or row["ip"]
    vendor = (row.get("vendor_override") or "").strip() or (row.get("vendor") or "").strip()
    mac = (row.get("mac_override") or "").strip() or (row.get("mac") or "").strip()
    dtype = (row.get("device_type") or "").strip()

    fields = [{"name": "IP address", "value": f"`{row['ip']}`", "inline": True}]
    if mac:
        fields.append({"name": "MAC address", "value": f"`{mac}`", "inline": True})
    if vendor:
        fields.append({"name": "Vendor", "value": vendor, "inline": True})
    if dtype:
        fields.append({"name": "Type", "value": dtype.capitalize(), "inline": True})
    if row.get("hostname") and row.get("label"):
        fields.append({"name": "Hostname", "value": row["hostname"], "inline": True})

    embed = {
        "title": f"{style['emoji']} {style['title']}",
        "description": f"**{name}**",
        "color": style["color"],
        "fields": fields,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        print(f"[discord] notify failed: {e}")


def scan_and_store():
    global scan_in_progress
    with scan_state_lock:
        scan_in_progress = True
    try:
        _scan_and_store()
    finally:
        with scan_state_lock:
            scan_in_progress = False


def _scan_and_store():
    now = datetime.now(timezone.utc).isoformat()
    found = run_scan()
    found = patch_self_entry(found)
    found_ips = {d["ip"] for d in found}
    needs_vendor_lookup = []

    with db_lock:
        conn = get_db()
        prior_rows = {
            row["ip"]: row
            for row in conn.execute("SELECT ip, status, known, muted, alert_critical FROM devices")
        }
        existing_ips = set(prior_rows.keys())

        for d in found:
            is_new = d["ip"] not in existing_ips
            prior = prior_rows.get(d["ip"])
            was_offline = bool(prior) and prior["status"] == "offline"
            ip_version = d.get("ip_version", 4)

            conn.execute(
                """
                INSERT INTO devices (ip, mac, hostname, vendor, ip_version, first_seen, last_seen, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'online')
                ON CONFLICT(ip) DO UPDATE SET
                    mac=CASE WHEN excluded.mac != '' THEN excluded.mac ELSE devices.mac END,
                    hostname=CASE WHEN excluded.hostname != '' THEN excluded.hostname ELSE devices.hostname END,
                    vendor=CASE WHEN excluded.vendor != '' THEN excluded.vendor ELSE devices.vendor END,
                    ip_version=excluded.ip_version,
                    last_seen=excluded.last_seen,
                    status='online',
                    archived=0
                """,
                (d["ip"], d["mac"], d["hostname"], d["vendor"], ip_version, now, now),
            )

            if is_new:
                row = conn.execute("SELECT * FROM devices WHERE ip=?", (d["ip"],)).fetchone()
                notify_discord_event(dict(row), "new")
            elif was_offline and not prior["muted"] and (not prior["known"] or prior["alert_critical"]):
                row = conn.execute("SELECT * FROM devices WHERE ip=?", (d["ip"],)).fetchone()
                notify_discord_event(dict(row), "connected")

            if VENDOR_LOOKUP_ENABLED and not d["vendor"] and d["mac"]:
                row = conn.execute(
                    "SELECT vendor_api FROM devices WHERE ip=?", (d["ip"],)
                ).fetchone()
                if row and not row["vendor_api"]:
                    needs_vendor_lookup.append((d["ip"], d["mac"]))

        # mark devices not seen in this scan as offline
        offline_ips = existing_ips - found_ips
        for ip in offline_ips:
            prior = prior_rows[ip]
            conn.execute("UPDATE devices SET status='offline' WHERE ip=?", (ip,))
            should_notify = prior["status"] == "online" and not prior["muted"] and (
                not prior["known"] or prior["alert_critical"]
            )
            if should_notify:
                row = conn.execute("SELECT * FROM devices WHERE ip=?", (ip,)).fetchone()
                notify_discord_event(dict(row), "disconnected")

        # uptime/reliability counters — used for the presence % shown in the UI
        for ip in found_ips:
            conn.execute(
                "UPDATE devices SET total_scans = total_scans + 1, online_scans = online_scans + 1 WHERE ip=?",
                (ip,),
            )
        for ip in offline_ips:
            conn.execute("UPDATE devices SET total_scans = total_scans + 1 WHERE ip=?", (ip,))

        conn.execute(
            "INSERT INTO scans (ran_at, devices_found) VALUES (?, ?)",
            (now, len(found)),
        )
        conn.commit()
        conn.close()

    print(f"[scan] {now} — {len(found)} devices found, {len(found_ips - existing_ips)} new")

    # online vendor lookups happen after the DB transaction closes since
    # they're network calls — done sequentially and only for devices nmap
    # couldn't identify, so we don't hammer the lookup API every cycle
    for ip, mac in needs_vendor_lookup:
        lookup_vendor_online(ip, mac)


def scan_loop():
    while True:
        scan_and_store()
        scan_now_event.wait(timeout=SCAN_INTERVAL)
        scan_now_event.clear()


# ---------- public / WAN IP tracking ----------
# This is what ISPs assign to your router, not a LAN device — separate
# concept from the local scan entirely. Checked via public echo services.
PUBLIC_IP_SERVICES = [
    "https://api.ipify.org",
    "https://icanhazip.com",
    "https://ifconfig.me/ip",
]


def fetch_public_ip():
    for url in PUBLIC_IP_SERVICES:
        try:
            resp = requests.get(url, timeout=8)
            candidate = resp.text.strip()
            ipaddress.ip_address(candidate)  # validates it's a real IP
            return candidate
        except Exception:
            continue
    return None


def notify_public_ip_change(old_ip, new_ip):
    if not DISCORD_WEBHOOK_URL:
        return
    embed = {
        "title": "🌐 Public IP changed",
        "description": f"Your ISP-assigned IP changed from `{old_ip or 'unknown'}` to `{new_ip}`",
        "color": 0xF2A65A,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        print(f"[discord] public ip notify failed: {e}")


def check_public_ip():
    new_ip = fetch_public_ip()
    if not new_ip:
        print("[public-ip] could not reach any IP-echo service")
        return

    now = datetime.now(timezone.utc).isoformat()
    with db_lock:
        conn = get_db()
        row = conn.execute("SELECT * FROM public_ip WHERE id=1").fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO public_ip (id, ip, first_seen, last_seen, last_checked) VALUES (1, ?, ?, ?, ?)",
                (new_ip, now, now, now),
            )
        elif row["ip"] != new_ip:
            if row["notify_enabled"]:
                notify_public_ip_change(row["ip"], new_ip)
            conn.execute(
                "UPDATE public_ip SET ip=?, first_seen=?, last_seen=?, last_checked=? WHERE id=1",
                (new_ip, now, now, now),
            )
        else:
            conn.execute("UPDATE public_ip SET last_seen=?, last_checked=? WHERE id=1", (now, now))
        conn.commit()
        conn.close()

    print(f"[public-ip] {now} — current WAN IP: {new_ip}")


def public_ip_loop():
    if not PUBLIC_IP_ENABLED:
        return
    while True:
        check_public_ip()
        time.sleep(PUBLIC_IP_INTERVAL)


# ---------- stale device cleanup ----------
def archive_stale_devices():
    """Devices that haven't been seen in STALE_DAYS get archived (hidden
    from the default view, not deleted) — keeps the list honest without
    losing history. Pinned and known devices are never auto-archived,
    since those are usually infrastructure you don't want to lose track
    of even if it's rebooting or temporarily off the network."""
    if STALE_DAYS <= 0:
        return
    cutoff = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat()
    with db_lock:
        conn = get_db()
        cur = conn.execute(
            """
            UPDATE devices SET archived=1
            WHERE archived=0 AND pinned=0 AND known=0
              AND status='offline' AND last_seen < ?
            """,
            (cutoff,),
        )
        conn.commit()
        archived_count = cur.rowcount
        conn.close()
    if archived_count:
        print(f"[cleanup] archived {archived_count} device(s) not seen in {STALE_DAYS}+ days")


def stale_cleanup_loop():
    if STALE_DAYS <= 0:
        return
    while True:
        time.sleep(6 * 3600)  # check a few times a day, no need to be precise
        archive_stale_devices()


# ---------- daily digest ----------
def send_daily_digest():
    if not DISCORD_WEBHOOK_URL:
        return
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) c FROM devices WHERE archived=0").fetchone()["c"]
    online = conn.execute("SELECT COUNT(*) c FROM devices WHERE archived=0 AND status='online'").fetchone()["c"]
    today = datetime.now(timezone.utc).date().isoformat()
    new_today = conn.execute(
        "SELECT COUNT(*) c FROM devices WHERE substr(first_seen, 1, 10) = ?", (today,)
    ).fetchone()["c"]
    pub_ip_row = conn.execute("SELECT ip FROM public_ip WHERE id=1").fetchone()
    conn.close()

    embed = {
        "title": "📋 Daily network summary",
        "color": 0x5EEAEA,
        "fields": [
            {"name": "Online", "value": f"{online}/{total}", "inline": True},
            {"name": "New today", "value": str(new_today), "inline": True},
            {"name": "Public IP", "value": (pub_ip_row["ip"] if pub_ip_row else "unknown"), "inline": True},
        ],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    except Exception as e:
        print(f"[digest] failed to send: {e}")


def daily_digest_loop():
    if not DAILY_DIGEST_ENABLED:
        return
    while True:
        time.sleep(DAILY_DIGEST_INTERVAL)
        send_daily_digest()


# ---------- web ----------
@app.route("/")
def index():
    return render_template(
        "index.html", subnet=SUBNET, interval=SCAN_INTERVAL, gateway=GATEWAY_IP
    )


@app.route("/api/devices")
def api_devices():
    include_archived = request.args.get("include_archived", "").lower() == "true"
    conn = get_db()
    where = "" if include_archived else "WHERE archived=0"
    rows = conn.execute(
        f"SELECT * FROM devices {where} ORDER BY pinned DESC, status ASC, last_seen DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/devices/export.csv")
def api_devices_export_csv():
    import csv
    import io

    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM devices ORDER BY pinned DESC, status ASC, last_seen DESC"
    ).fetchall()
    conn.close()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "ip", "name", "mac", "vendor", "device_type", "status", "known", "muted",
        "pinned", "notes", "uptime_pct", "first_seen", "last_seen",
    ])
    for r in rows:
        row = dict(r)
        mac = (row.get("mac_override") or "").strip() or (row.get("mac") or "").strip()
        vendor = (row.get("vendor_override") or "").strip() or (row.get("vendor") or "").strip()
        name = (row.get("label") or "").strip() or (row.get("hostname") or "").strip()
        total = row.get("total_scans") or 0
        online = row.get("online_scans") or 0
        uptime_pct = round(100 * online / total, 1) if total else ""
        writer.writerow([
            row["ip"], name, mac, vendor, row.get("device_type", ""), row["status"],
            bool(row.get("known")), bool(row.get("muted")), bool(row.get("pinned")),
            row.get("notes", ""), uptime_pct, row.get("first_seen", ""), row.get("last_seen", ""),
        ])

    resp = app.response_class(buf.getvalue(), mimetype="text/csv")
    resp.headers["Content-Disposition"] = "attachment; filename=netwatch-devices.csv"
    return resp


@app.route("/api/devices/<ip>", methods=["PATCH"])
def api_update_device(ip):
    data = request.get_json(silent=True) or {}
    fields = []
    values = []
    if "label" in data:
        fields.append("label=?")
        values.append(str(data["label"])[:100])
    if "notes" in data:
        fields.append("notes=?")
        values.append(str(data["notes"])[:500])
    if "muted" in data:
        fields.append("muted=?")
        values.append(1 if data["muted"] else 0)
    if "pinned" in data:
        fields.append("pinned=?")
        values.append(1 if data["pinned"] else 0)
    if "known" in data:
        fields.append("known=?")
        values.append(1 if data["known"] else 0)
    if "vendor_override" in data:
        fields.append("vendor_override=?")
        values.append(str(data["vendor_override"])[:100])
    if "mac_override" in data:
        fields.append("mac_override=?")
        values.append(str(data["mac_override"])[:30])
    if "device_type" in data:
        dtype = str(data["device_type"]).strip().lower()
        if dtype and dtype not in DEVICE_TYPES:
            return jsonify({"error": f"invalid device_type, must be one of {DEVICE_TYPES}"}), 400
        fields.append("device_type=?")
        values.append(dtype)
    if "group_tag" in data:
        tag = str(data["group_tag"]).strip().lower()
        if tag and tag not in GROUP_TAGS:
            return jsonify({"error": f"invalid group_tag, must be one of {GROUP_TAGS}"}), 400
        fields.append("group_tag=?")
        values.append(tag)
    if "alert_critical" in data:
        fields.append("alert_critical=?")
        values.append(1 if data["alert_critical"] else 0)
    if "archived" in data:
        fields.append("archived=?")
        values.append(1 if data["archived"] else 0)

    if not fields:
        return jsonify({"error": "nothing to update"}), 400

    with db_lock:
        conn = get_db()
        cur = conn.execute(
            f"UPDATE devices SET {', '.join(fields)} WHERE ip=?", (*values, ip)
        )
        conn.commit()
        updated = cur.rowcount
        row = conn.execute("SELECT * FROM devices WHERE ip=?", (ip,)).fetchone()
        conn.close()

    if not updated:
        return jsonify({"error": "device not found"}), 404
    return jsonify(dict(row))


@app.route("/api/devices/<ip>/move", methods=["POST"])
def api_move_device(ip):
    data = request.get_json(silent=True) or {}
    new_ip = str(data.get("new_ip", "")).strip()

    if not new_ip:
        return jsonify({"error": "new_ip required"}), 400
    try:
        ipaddress.ip_address(new_ip)
    except ValueError:
        return jsonify({"error": "new_ip is not a valid IP address"}), 400

    if new_ip == ip:
        return jsonify({"error": "new_ip is the same as current ip"}), 400

    with db_lock:
        conn = get_db()
        exists = conn.execute("SELECT 1 FROM devices WHERE ip=?", (new_ip,)).fetchone()
        if exists:
            conn.close()
            return jsonify({"error": f"a device already exists at {new_ip}"}), 409

        row = conn.execute("SELECT * FROM devices WHERE ip=?", (ip,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "device not found"}), 404

        cols = [c for c in row.keys() if c != "ip"]
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(cols)
        conn.execute(
            f"INSERT INTO devices (ip, {col_names}) VALUES (?, {placeholders})",
            (new_ip, *[row[c] for c in cols]),
        )
        conn.execute("DELETE FROM devices WHERE ip=?", (ip,))
        conn.commit()
        updated_row = conn.execute("SELECT * FROM devices WHERE ip=?", (new_ip,)).fetchone()
        conn.close()

    return jsonify(dict(updated_row))


@app.route("/api/devices/<ip>", methods=["DELETE"])
def api_delete_device(ip):
    with db_lock:
        conn = get_db()
        cur = conn.execute("DELETE FROM devices WHERE ip=?", (ip,))
        conn.commit()
        deleted = cur.rowcount
        conn.close()
    if not deleted:
        return jsonify({"error": "device not found"}), 404
    return jsonify({"deleted": ip})


@app.route("/api/devices/cleanup", methods=["POST"])
def api_cleanup_now():
    archive_stale_devices()
    return jsonify({"status": "ok"})


@app.route("/api/backup")
def api_backup():
    import json

    conn = get_db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM devices")]
    conn.close()
    payload = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "devices": rows,
    }
    resp = app.response_class(json.dumps(payload, indent=2), mimetype="application/json")
    resp.headers["Content-Disposition"] = "attachment; filename=netwatch-backup.json"
    return resp


@app.route("/api/restore", methods=["POST"])
def api_restore():
    data = request.get_json(silent=True) or {}
    devices = data.get("devices")
    if not isinstance(devices, list):
        return jsonify({"error": "expected a 'devices' array — use a backup file exported from netwatch"}), 400

    restored = 0
    with db_lock:
        conn = get_db()
        cols = [row["name"] for row in conn.execute("PRAGMA table_info(devices)")]
        for d in devices:
            if "ip" not in d:
                continue
            row_cols = [c for c in cols if c in d]
            placeholders = ", ".join("?" for _ in row_cols)
            col_names = ", ".join(row_cols)
            update_clause = ", ".join(f"{c}=excluded.{c}" for c in row_cols if c != "ip")
            conn.execute(
                f"INSERT INTO devices ({col_names}) VALUES ({placeholders}) "
                f"ON CONFLICT(ip) DO UPDATE SET {update_clause}",
                [d[c] for c in row_cols],
            )
            restored += 1
        conn.commit()
        conn.close()

    return jsonify({"restored": restored})


@app.route("/api/status")
def api_status():
    conn = get_db()
    last_scan = conn.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 1").fetchone()
    total = conn.execute("SELECT COUNT(*) c FROM devices WHERE archived=0").fetchone()["c"]
    online = conn.execute("SELECT COUNT(*) c FROM devices WHERE archived=0 AND status='online'").fetchone()["c"]
    archived_count = conn.execute("SELECT COUNT(*) c FROM devices WHERE archived=1").fetchone()["c"]
    today = datetime.now(timezone.utc).date().isoformat()
    new_today = conn.execute(
        "SELECT COUNT(*) c FROM devices WHERE substr(first_seen, 1, 10) = ?", (today,)
    ).fetchone()["c"]
    conn.close()
    with scan_state_lock:
        scanning = scan_in_progress
    conn2 = get_db()
    public_ip_row = conn2.execute("SELECT * FROM public_ip WHERE id=1").fetchone()
    conn2.close()
    return jsonify(
        {
            "subnet": SUBNET,
            "interval": SCAN_INTERVAL,
            "gateway": GATEWAY_IP,
            "total_devices": total,
            "online_devices": online,
            "archived_devices": archived_count,
            "new_today": new_today,
            "last_scan": last_scan["ran_at"] if last_scan else None,
            "scanning": scanning,
            "device_types": DEVICE_TYPES,
            "group_tags": GROUP_TAGS,
            "stale_days": STALE_DAYS,
            "auth_enabled": bool(AUTH_PASSWORD),
            "public_ip": public_ip_row["ip"] if public_ip_row else None,
            "public_ip_checked": public_ip_row["last_checked"] if public_ip_row else None,
            "public_ip_notify_enabled": bool(public_ip_row["notify_enabled"]) if public_ip_row else True,
        }
    )


@app.route("/api/public-ip/notify", methods=["PATCH"])
def api_toggle_public_ip_notify():
    data = request.get_json(silent=True) or {}
    if "enabled" not in data:
        return jsonify({"error": "enabled required"}), 400
    enabled = 1 if data["enabled"] else 0

    with db_lock:
        conn = get_db()
        row = conn.execute("SELECT 1 FROM public_ip WHERE id=1").fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO public_ip (id, notify_enabled) VALUES (1, ?)", (enabled,)
            )
        else:
            conn.execute("UPDATE public_ip SET notify_enabled=? WHERE id=1", (enabled,))
        conn.commit()
        conn.close()

    return jsonify({"public_ip_notify_enabled": bool(enabled)})


@app.route("/api/scan-now", methods=["POST"])
def api_scan_now():
    with scan_state_lock:
        if scan_in_progress:
            return jsonify({"status": "already_scanning"}), 409
    scan_now_event.set()
    return jsonify({"status": "triggered"})


if __name__ == "__main__":
    init_db()
    threading.Thread(target=scan_loop, daemon=True).start()
    threading.Thread(target=public_ip_loop, daemon=True).start()
    threading.Thread(target=stale_cleanup_loop, daemon=True).start()
    threading.Thread(target=daily_digest_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=8642, threaded=True)
