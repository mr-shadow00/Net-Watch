1. make folders and move the files there (change the app name if you want)
   /DATA/AppData/netwatch/app/    ← app.py, requirements.txt, templates/, static/ go here
   /DATA/AppData/netwatch/data/   ← leave empty

2. open "netwatch compose.yaml" and edit:
   - SUBNET → your LAN range, e.g. 192.168.1.0/24
   - DISCORD_WEBHOOK_URL → from Discord: Server Settings → Integrations → Webhooks
   - TZ → your timezone

3. use it on App Store → "Install a Customized App" → Docker Compose tab

4. w8 (first start installs nmap + pip packages inside the container, takes ~30-60s)

5. open http://<your-zimaos-ip>:8642

6. enjoy — new devices get posted to Discord automatically

No Dockerfile, no build step — it pulls the stock python:3.12-slim image and
just runs the code straight off the mounted volume, same as Smart Budget does.

Note: network_mode is set to "host" so nmap can actually see your LAN. If
your ZimaOS install is itself running inside a VM, make sure that VM's
network adapter is bridged (not NAT'd) to your physical network, or the
scan will only see the VM's isolated network segment.

## Optional features (all off/default unless you set the env var)

- **Password login** — set `AUTH_PASSWORD` to require a password before the
  dashboard loads. Also set `SECRET_KEY` to a random string if you want
  logins to survive a container restart (otherwise a new key is generated
  each start and everyone gets logged out).
- **Stale device auto-archive** — `STALE_DAYS` (default 30, set to 0 to
  disable) hides devices that haven't been seen in that many days. Pinned
  and known devices are never auto-archived. Archived devices aren't
  deleted — toggle "show archived" in the UI to see them, or clean up
  manually anytime with the "Clean up stale" button.
- **Daily Discord digest** — `DAILY_DIGEST_ENABLED` / `DAILY_DIGEST_INTERVAL`
  (seconds, default 86400) posts a daily summary so you know netwatch is
  still alive even on quiet days.
- **Online vendor lookup** — `VENDOR_LOOKUP_ENABLED` (default true) falls
  back to a free online MAC-vendor API when nmap's bundled database comes
  up blank, since that database only updates when nmap itself is upgraded.
- **IPv6** — set `SUBNET_V6` (e.g. `fe80::/64`) to scan IPv6 addresses
  alongside your regular `SUBNET`.
- **Multiple subnets** — `SUBNET` accepts a comma-separated list if you
  have more than one LAN segment.
- **Backup/restore** — "Backup" downloads a JSON file of every device and
  its labels/notes/settings; "Restore" uploads one back. Handy before
  container updates or migrating to a new box.
- **Groups & critical devices** — tag devices (Family/IoT/Guest/etc.) and
  filter by group in the toolbar. Mark infrastructure like your router or
  NAS as "critical" so it still alerts on disconnect even if also marked
  "known."
- **Install as an app (PWA)** — open the dashboard on your phone and use
  "Add to Home Screen" for an app-like icon and window.


## Offline use

Fonts are bundled locally (app/static/fonts), so the UI loads with no internet.
The compose installs nmap and the Python packages only if missing, so restarts work offline.
If there is no internet, online MAC-vendor lookups pause for 10 minutes instead of slowing every scan.
The public-IP check and Discord alerts need internet and simply fail quietly until it returns.
