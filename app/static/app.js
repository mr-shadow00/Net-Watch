let knownIps = new Set();
let firstLoad = true;
let allDevices = [];
let activeIp = null;
let publicIpVisible = false;
let currentPublicIp = null;
let publicIpNotifyEnabled = true;
let sortKey = "last_seen";
let sortDir = "desc";
let scanIntervalSec = 120;

const GATEWAY_IP = document.body.dataset.gateway || "";
let deviceTypes = [];
let groupTags = [];
let showArchived = false;
let groupFilterValue = "";

function eyeIconMarkup(visible, color) {
  color = color || "#ffffff";
  if (visible) {
    return `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="${color}" stroke-width="2"/>`;
  }
  return `<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
}

function shieldIconMarkup(color) {
  color = color || "currentColor";
  return `<path d="M12 2.5l7.5 3.2v5.3c0 4.8-3.1 8.6-7.5 10.5-4.4-1.9-7.5-5.7-7.5-10.5V5.7z" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function criticalIconSvg(size) {
  size = size || 12;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5L1.5 21h21z"/><line x1="12" y1="9.5" x2="12" y2="14.5"/><circle cx="12" cy="17.5" r="0.6" fill="var(--amber)" stroke="none"/></svg>`;
}

function bellIconMarkup(enabled, color) {
  color = color || "#ffffff";
  if (enabled) {
    return `<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 8a6 6 0 0 0-9.33-5" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
}

// Modern outline icon set (24x24, stroke-based), consistent with the eye
// icon style used elsewhere — replaces emoji, which looked out of place
// against the rest of the dark, minimal UI.
const TYPE_ICON_PATHS = {
  router: `<rect x="3" y="10" width="18" height="7" rx="1.5"/><circle cx="7.5" cy="13.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="11" cy="13.5" r="0.6" fill="currentColor" stroke="none"/><path d="M9 10V7a2 2 0 0 1 2-2h1"/><path d="M14.5 3.5c1.6 0 2.9 1.3 2.9 3M17 2c2.5 0 4.5 2 4.5 4.5"/>`,
  computer: `<rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>`,
  laptop: `<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5V16H5z"/><path d="M2.5 19.5h19L20 16H4z"/>`,
  phone: `<rect x="7" y="2.5" width="10" height="19" rx="2"/><line x1="10.5" y1="18" x2="13.5" y2="18"/>`,
  tablet: `<rect x="5" y="2.5" width="14" height="19" rx="2"/><line x1="11" y1="18.3" x2="13" y2="18.3"/>`,
  tv: `<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M9 20.5h6M12 17v3.5"/>`,
  speaker: `<rect x="6" y="2.5" width="12" height="19" rx="2.2"/><circle cx="12" cy="8" r="2"/><circle cx="12" cy="15" r="3.4"/>`,
  camera: `<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H8l1.2-1.8A1.5 1.5 0 0 1 10.4 4.5h3.2a1.5 1.5 0 0 1 1.25.7L16 7h3.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="12.5" r="3.6"/>`,
  printer: `<path d="M6 8V3.5h12V8"/><rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M6 14.5h12V21H6z"/>`,
  console: `<path d="M6 8h6.2c3 0 5.3.6 6.6 3l1.6 3.2c.7 1.5-.3 3.3-2 3.3-.7 0-1.4-.3-1.8-.9L15 14.5H9l-1.6 2.1c-.4.6-1.1.9-1.8.9-1.7 0-2.7-1.8-2-3.3L5.2 11C6.5 8.6 8.8 8 11.8 8"/><line x1="8.3" y1="11" x2="8.3" y2="13.4"/><line x1="7.1" y1="12.2" x2="9.5" y2="12.2"/><circle cx="15.5" cy="11.2" r="0.6" fill="currentColor" stroke="none"/><circle cx="17" cy="12.6" r="0.6" fill="currentColor" stroke="none"/>`,
  server: `<rect x="3.5" y="3.5" width="17" height="6" rx="1.3"/><rect x="3.5" y="12" width="17" height="6" rx="1.3"/><circle cx="7" cy="6.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="7" cy="15" r="0.6" fill="currentColor" stroke="none"/>`,
  switch: `<rect x="3" y="7" width="18" height="9" rx="1.5"/><line x1="6.5" y1="11" x2="6.5" y2="12.5"/><line x1="10" y1="11" x2="10" y2="12.5"/><line x1="13.5" y1="11" x2="13.5" y2="12.5"/><line x1="17" y1="11" x2="17" y2="12.5"/>`,
  hub: `<circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1"/>`,
  access_point: `<circle cx="12" cy="17" r="1.4" fill="currentColor" stroke="none"/><path d="M8.5 14a5 5 0 0 1 7 0M5.8 11a9 9 0 0 1 12.4 0M3 8a13 13 0 0 1 18 0"/>`,
  firewall: `<path d="M12 2.5l7.5 3.2v5.3c0 4.8-3.1 8.6-7.5 10.5-4.4-1.9-7.5-5.7-7.5-10.5V5.7z"/><line x1="12" y1="7" x2="12" y2="16"/><line x1="8.5" y1="9" x2="15.5" y2="9"/><line x1="8.5" y1="13" x2="15.5" y2="13"/>`,
  microcontroller: `<rect x="7" y="7" width="10" height="10" rx="1"/><circle cx="12" cy="12" r="2"/><line x1="9" y1="3" x2="9" y2="7"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="15" y1="3" x2="15" y2="7"/><line x1="9" y1="17" x2="9" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="15" y1="17" x2="15" y2="21"/><line x1="3" y1="9" x2="7" y2="9"/><line x1="3" y1="15" x2="7" y2="15"/><line x1="17" y1="9" x2="21" y2="9"/><line x1="17" y1="15" x2="21" y2="15"/>`,
  raspberry_pi: `<rect x="4" y="6" width="16" height="12" rx="1.5"/><circle cx="8" cy="10" r="1"/><circle cx="8" cy="14" r="1"/><line x1="12" y1="9" x2="17" y2="9"/><line x1="12" y1="12" x2="17" y2="12"/><line x1="12" y1="15" x2="15" y2="15"/><line x1="6" y1="6" x2="6" y2="3.5"/><line x1="9" y1="6" x2="9" y2="3.5"/>`,
  nas: `<rect x="4" y="3.5" width="16" height="8" rx="1.3"/><rect x="4" y="12.5" width="16" height="8" rx="1.3"/><circle cx="8" cy="7.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="8" cy="16.5" r="0.6" fill="currentColor" stroke="none"/><line x1="12" y1="7.5" x2="17" y2="7.5"/><line x1="12" y1="16.5" x2="17" y2="16.5"/>`,
  iot: `<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9v.2h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/>`,
  other: `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.5 2.5 0 1 1 3.9 2.1c-.9.6-1.4 1-1.4 2.1"/><circle cx="12" cy="16.7" r="0.4" fill="currentColor" stroke="none"/>`,
};
TYPE_ICON_PATHS[""] = TYPE_ICON_PATHS.other;

function typeIconSvg(t, size) {
  size = size || 16;
  const path = TYPE_ICON_PATHS[t] || TYPE_ICON_PATHS[""];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// Plain-text fallback used only where SVG can't render (e.g. <option> labels)
function typeIcon(t) {
  return "●";
}

function effectiveVendor(d) {
  if (d.vendor_override && d.vendor_override.trim()) return d.vendor_override;
  if (d.vendor && d.vendor.trim()) return d.vendor;
  // nmap's bundled MAC-vendor database only updates when nmap itself is
  // upgraded, so newer devices often come back blank — vendor_api is an
  // online lookup fallback for exactly those cases
  if (d.vendor_api && d.vendor_api.trim()) return d.vendor_api;
  return "";
}

function fmtTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function relTime(iso) {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function displayName(d) {
  return d.label && d.label.trim() ? d.label : (d.hostname || "");
}

// ---------- tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "topology") renderTopology();
  });
});

// ---------- search ----------
document.getElementById("searchBox").addEventListener("input", (e) => {
  renderDeviceTable(e.target.value.trim().toLowerCase());
});

// ---------- group filter ----------
document.getElementById("groupFilterSelect").addEventListener("change", (e) => {
  groupFilterValue = e.target.value;
  renderDeviceTable(document.getElementById("searchBox").value.trim().toLowerCase());
});

// ---------- archived devices toggle ----------
document.getElementById("showArchivedToggle").addEventListener("change", (e) => {
  showArchived = e.target.checked;
  refreshDevices();
});

// ---------- stale device cleanup ----------
document.getElementById("cleanupBtn").addEventListener("click", async () => {
  const btn = document.getElementById("cleanupBtn");
  btn.disabled = true;
  try {
    await fetch("/api/devices/cleanup", { method: "POST" });
    await Promise.all([refreshStatus(), refreshDevices()]);
  } catch (e) {
    alert("Cleanup failed — could not reach the server.");
  }
  btn.disabled = false;
});

// ---------- backup / restore ----------
document.getElementById("restoreBtn").addEventListener("click", () => {
  document.getElementById("restoreFileInput").click();
});

document.getElementById("restoreFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!confirm(`Restore ${data.devices ? data.devices.length : "?"} device(s) from this backup? Existing devices with matching IPs will be overwritten.`)) {
      e.target.value = "";
      return;
    }
    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Restore failed.");
    } else {
      const result = await res.json();
      alert(`Restored ${result.restored} device(s).`);
      await Promise.all([refreshStatus(), refreshDevices()]);
    }
  } catch (err) {
    alert("Could not read that file — make sure it's a netwatch backup JSON file.");
  }
  e.target.value = "";
});

// ---------- data fetch ----------
async function refreshStatus() {
  const res = await fetch("/api/status");
  const data = await res.json();
  document.getElementById("statOnline").textContent = data.online_devices;
  const topoOnline = document.getElementById("topoStatOnline");
  const topoScan = document.getElementById("topoStatScan");
  if (topoOnline) topoOnline.textContent = `${data.online_devices}/${data.total_devices} online`;
  if (topoScan) topoScan.textContent = data.scanning ? "scanning…" : `scanned ${relTime(data.last_scan)}`;
  const tabBadge = document.getElementById("tabDeviceCount");
  if (tabBadge) tabBadge.textContent = data.total_devices > 0 ? data.total_devices : "";
  document.getElementById("statTotal").textContent = data.total_devices;
  const badgeEl = document.getElementById("statNewToday");
  if (badgeEl) {
    badgeEl.textContent = data.new_today > 0 ? `+${data.new_today} today` : "";
  }
  document.getElementById("statLastScan").textContent = data.scanning ? "scanning…" : relTime(data.last_scan);
  if (data.interval) scanIntervalSec = data.interval;
  currentPublicIp = data.public_ip || null;
  if (typeof data.public_ip_notify_enabled === "boolean") {
    publicIpNotifyEnabled = data.public_ip_notify_enabled;
  }
  const ipEl = document.getElementById("statPublicIp");
  const actionsEl = document.getElementById("publicIpActions");
  if (ipEl) {
    const shownText = data.public_ip
      ? (publicIpVisible ? currentPublicIp : maskIp(currentPublicIp))
      : "checking…";
    ipEl.textContent = shownText;
    ipEl.title = data.public_ip_checked ? `last checked ${relTime(data.public_ip_checked)}` : "";
  }
  if (actionsEl && data.public_ip) {
    actionsEl.innerHTML = `
      <button class="eye-toggle-btn" id="statIpEyeBtn" type="button" aria-label="toggle IP visibility" title="Show/hide public IP">
        <svg width="14" height="14" viewBox="0 0 24 24">${eyeIconMarkup(publicIpVisible)}</svg>
      </button>
      <button class="eye-toggle-btn" id="statIpBellBtn" type="button" aria-label="toggle public IP change notifications" title="${publicIpNotifyEnabled ? "Public IP change alerts on" : "Public IP change alerts off"}">
        <svg width="14" height="14" viewBox="0 0 24 24">${bellIconMarkup(publicIpNotifyEnabled)}</svg>
      </button>
    `;
    document.getElementById("statIpEyeBtn").addEventListener("click", () => {
      publicIpVisible = !publicIpVisible;
      refreshStatus();
      if (document.getElementById("tab-topology").classList.contains("active")) renderTopology();
    });
    document.getElementById("statIpBellBtn").addEventListener("click", async () => {
      publicIpNotifyEnabled = !publicIpNotifyEnabled;
      refreshStatus();
      try {
        await fetch("/api/public-ip/notify", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: publicIpNotifyEnabled }),
        });
      } catch (e) {
        // best-effort; next refreshStatus() will resync from the server if this failed
      }
    });
  } else if (actionsEl) {
    actionsEl.innerHTML = "";
  }

  if (data.device_types && deviceTypes.length === 0) {
    deviceTypes = data.device_types;
    const select = document.getElementById("editType");
    for (const t of deviceTypes) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t.replace(/_/g, " ");
      select.appendChild(opt);
    }
  }

  if (data.group_tags && groupTags.length === 0) {
    groupTags = data.group_tags;
    const editSelect = document.getElementById("editGroup");
    const filterSelect = document.getElementById("groupFilterSelect");
    for (const g of groupTags) {
      const label = g.replace(/_/g, " ");
      const opt1 = document.createElement("option");
      opt1.value = g;
      opt1.textContent = label;
      editSelect.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = g;
      opt2.textContent = label;
      filterSelect.appendChild(opt2);
    }
  }

  const logoutForm = document.getElementById("logoutForm");
  if (logoutForm) logoutForm.style.display = data.auth_enabled ? "block" : "none";

  const archivedCountEl = document.getElementById("archivedCount");
  if (archivedCountEl) {
    archivedCountEl.textContent = data.archived_devices > 0 ? `(${data.archived_devices})` : "";
  }

  const btn = document.getElementById("scanNowBtn");
  if (data.scanning) {
    btn.disabled = true;
    document.getElementById("scanNowLabel").textContent = "Scanning…";
  } else {
    btn.disabled = false;
    document.getElementById("scanNowLabel").textContent = "Scan now";
  }
}

document.getElementById("scanNowBtn").addEventListener("click", async () => {
  const btn = document.getElementById("scanNowBtn");
  btn.disabled = true;
  document.getElementById("scanNowLabel").textContent = "Scanning…";
  try {
    const res = await fetch("/api/scan-now", { method: "POST" });
    if (res.status === 409) {
      // already scanning, just let the poll loop catch up
    }
  } catch (e) {
    btn.disabled = false;
    document.getElementById("scanNowLabel").textContent = "Scan now";
  }
  // poll a bit faster right after triggering so the UI updates promptly
  setTimeout(refreshAll, 1500);
});

async function refreshDevices() {
  const url = showArchived ? "/api/devices?include_archived=true" : "/api/devices";
  const res = await fetch(url);
  allDevices = await res.json();

  const currentIps = new Set(allDevices.map((d) => d.ip));
  knownIps = firstLoad ? currentIps : knownIps;
  firstLoad = false;

  renderDeviceTable(document.getElementById("searchBox").value.trim().toLowerCase());

  if (document.getElementById("tab-topology").classList.contains("active")) {
    renderTopology();
  }

  knownIps = currentIps;
}

function uptimePct(d) {
  const total = d.total_scans || 0;
  const online = d.online_scans || 0;
  return total > 0 ? Math.round((100 * online) / total) : null;
}

// Total time this device has actually been seen online, derived from how
// many scans caught it up multiplied by the scan interval.
function onlineSeconds(d) {
  const online = d.online_scans || 0;
  if (!online) return null;
  return online * scanIntervalSec;
}

function fmtDuration(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return "<1m";
}

function offlineDuration(d) {
  if (d.status !== "offline" || !d.last_seen) return "";
  const diff = (Date.now() - new Date(d.last_seen).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function sortDevices(devices) {
  const dir = sortDir === "asc" ? 1 : -1;
  return devices.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned; // pinned always first
    let av, bv;
    switch (sortKey) {
      case "name": av = displayName(a) || a.hostname || ""; bv = displayName(b) || b.hostname || ""; break;
      case "vendor": av = effectiveVendor(a); bv = effectiveVendor(b); break;
      case "group": av = a.group_tag || ""; bv = b.group_tag || ""; break;
      case "uptime": av = onlineSeconds(a) ?? -1; bv = onlineSeconds(b) ?? -1; break;
      case "status": av = a.status; bv = b.status; break;
      case "ip":
        av = a.ip.split(".").map((n) => n.padStart(3, "0")).join(".");
        bv = b.ip.split(".").map((n) => n.padStart(3, "0")).join(".");
        break;
      default: av = a.last_seen || ""; bv = b.last_seen || "";
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = "asc";
    }
    document.querySelectorAll("th.sortable").forEach((h) => h.classList.remove("sort-active"));
    th.classList.add("sort-active");
    renderDeviceTable(document.getElementById("searchBox").value.trim().toLowerCase());
  });
});

function renderDeviceTable(filter) {
  const tbody = document.getElementById("deviceRows");

  let devices = allDevices;
  if (filter) {
    devices = devices.filter((d) =>
      [d.ip, d.label, d.hostname, d.mac, d.vendor].join(" ").toLowerCase().includes(filter)
    );
  }
  if (groupFilterValue) {
    devices = devices.filter((d) => (d.group_tag || "") === groupFilterValue);
  }
  devices = sortDevices(devices);

  if (devices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">${allDevices.length === 0 ? "waiting for first scan…" : "no devices match that filter"}</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  for (const d of devices) {
    const isNew = !knownIps.has(d.ip) && knownIps.size > 0;
    const tr = document.createElement("tr");
    const classes = [];
    if (isNew) classes.push("new-row");
    if (d.pinned) classes.push("is-pinned");
    if (d.archived) classes.push("is-archived");
    if (classes.length) tr.className = classes.join(" ");

    const name = displayName(d);
    const pinHtml = d.pinned ? '<span class="pin-icon">📌</span>' : "";
    const knownHtml = d.known ? `<span class="known-icon" title="known device — no connect/disconnect alerts"><svg width="12" height="12" viewBox="0 0 24 24">${shieldIconMarkup("var(--cyan)")}</svg></span>` : "";
    const criticalHtml = d.alert_critical ? `<span class="critical-icon" title="critical device — always alerts on disconnect">${criticalIconSvg()}</span>` : "";
    const ipv6Html = d.ip_version === 6 ? '<span class="ipv6-badge" title="IPv6 address">v6</span>' : "";
    const nameHtml = name
      ? `${pinHtml}${knownHtml}${criticalHtml}<span class="device-name">${name}</span>`
      : `${pinHtml}${knownHtml}${criticalHtml}<span class="device-name fallback">—</span>`;
    const mutedHtml = d.muted ? '<span class="muted-icon" title="notifications muted">MUTED</span>' : "";
    const archivedHtml = d.archived ? '<span class="archived-badge" title="archived — hasn\'t been seen in a while">ARCHIVED</span>' : "";

    const vendor = effectiveVendor(d) || "—";
    const mac = effectiveMac(d) || "—";
    const groupHtml = d.group_tag
      ? `<span class="group-badge">${d.group_tag.replace(/_/g, " ")}</span>`
      : `<span class="group-badge-empty">—</span>`;

    const pct = uptimePct(d);
    const secs = onlineSeconds(d);
    let uptimeClass = "uptime-good";
    if (pct !== null && pct < 60) uptimeClass = "uptime-bad";
    else if (pct !== null && pct < 90) uptimeClass = "uptime-warn";
    const uptimeHtml = pct === null
      ? "—"
      : `<span class="uptime-text ${uptimeClass}" title="${pct}% of scans found this device online">${secs !== null ? fmtDuration(secs) : pct + "%"}</span>`;

    const offDur = offlineDuration(d);
    const lastSeenHtml = offDur
      ? `${fmtTime(d.last_seen)}<span class="offline-duration">down ${offDur}</span>`
      : fmtTime(d.last_seen);

    tr.innerHTML = `
      <td><span class="device-icon" title="${d.device_type || 'unknown'}">${typeIconSvg(d.device_type, 18)}</span></td>
      <td><span class="status-pill ${d.status}"><span class="dot"></span>${d.status}</span></td>
      <td class="col-name">${nameHtml}${mutedHtml}${archivedHtml}</td>
      <td class="col-ip">${d.ip}${ipv6Html}</td>
      <td class="col-mac">${mac}</td>
      <td class="col-vendor"><span title="${vendor}">${vendor}</span></td>
      <td class="col-group">${groupHtml}</td>
      <td class="col-uptime">${uptimeHtml}</td>
      <td class="col-lastseen">${lastSeenHtml}</td>
      <td class="col-actions"><button class="edit-btn" data-ip="${d.ip}">edit</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditModal(btn.dataset.ip));
  });
}

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshDevices()]);
}

refreshAll();
setInterval(refreshAll, 10000);

// ---------- edit modal ----------
const backdrop = document.getElementById("editBackdrop");

function effectiveMac(d) {
  return (d.mac_override && d.mac_override.trim()) ? d.mac_override : (d.mac || "");
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = value;
}

function openEditModal(ip) {
  const d = allDevices.find((x) => x.ip === ip);
  if (!d) return;
  activeIp = ip;
  document.getElementById("modalIp").textContent = ip;
  setVal("editType", d.device_type || "");
  setVal("editGroup", d.group_tag || "");
  setVal("editVendor", effectiveVendor(d));
  setVal("editIp", d.ip);
  setVal("editMac", effectiveMac(d));
  setVal("editLabel", d.label || "");
  setVal("editNotes", d.notes || "");
  setChecked("editMuted", !!d.muted);
  setChecked("editPinned", !!d.pinned);
  setChecked("editKnown", !!d.known);
  setChecked("editCritical", !!d.alert_critical);
  const rawVendorNote = d.vendor && d.vendor !== effectiveVendor(d) ? ` · nmap detected vendor "${d.vendor}"` : "";
  const apiVendorNote = !d.vendor && d.vendor_api ? ` · vendor from online lookup` : "";
  const rawMacNote = d.mac && d.mac !== effectiveMac(d) ? ` · nmap detected MAC "${d.mac}"` : "";
  const ipvNote = d.ip_version === 6 ? " · IPv6" : "";
  document.getElementById("modalMeta").innerHTML =
    `first seen ${fmtTime(d.first_seen)} · last seen ${fmtTime(d.last_seen)}${rawVendorNote}${apiVendorNote}${rawMacNote}${ipvNote}`;
  backdrop.classList.add("open");
}

function closeModal() {
  backdrop.classList.remove("open");
  activeIp = null;
}

document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("modalCancel").addEventListener("click", closeModal);
backdrop.addEventListener("click", (e) => {
  if (e.target === backdrop) closeModal();
});

function getVal(id, fallback) {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}

function getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

document.getElementById("modalSave").addEventListener("click", async () => {
  if (!activeIp) return;
  const saveBtn = document.getElementById("modalSave");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  let targetIp = activeIp;
  const newIpValue = getVal("editIp", activeIp).trim();

  if (newIpValue && newIpValue !== activeIp) {
    const moveRes = await fetch(`/api/devices/${encodeURIComponent(activeIp)}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_ip: newIpValue }),
    });
    if (!moveRes.ok) {
      const err = await moveRes.json().catch(() => ({}));
      alert(err.error || "Could not change IP address.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      return;
    }
    targetIp = newIpValue;
  }

  const body = {
    label: getVal("editLabel", ""),
    notes: getVal("editNotes", ""),
    muted: getChecked("editMuted"),
    pinned: getChecked("editPinned"),
    known: getChecked("editKnown"),
    alert_critical: getChecked("editCritical"),
    device_type: getVal("editType", ""),
    group_tag: getVal("editGroup", ""),
    vendor_override: getVal("editVendor", ""),
    mac_override: getVal("editMac", ""),
  };
  await fetch(`/api/devices/${encodeURIComponent(targetIp)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  saveBtn.disabled = false;
  saveBtn.textContent = "Save";
  closeModal();
  refreshDevices();
});

document.getElementById("modalForget").addEventListener("click", async () => {
  if (!activeIp) return;
  if (!confirm(`Forget ${activeIp}? It'll reappear (and re-notify) if it's seen again.`)) return;
  await fetch(`/api/devices/${encodeURIComponent(activeIp)}`, { method: "DELETE" });
  closeModal();
  refreshDevices();
});

// ---------- topology ----------
function maskIp(ip) {
  if (!ip) return "•••.•••.•.•";
  return ip.split(".").map((seg) => "•".repeat(seg.length)).join(".");
}

function renderTopology() {
  const svg = document.getElementById("topoSvg");
  const width = 920;
  const routerX = 380, routerY = 300;
  const routerR = 34;
  const netX = 80, netY = 300;
  const cloudEdgeX = netX + 46; // approx right edge of the cloud icon

  // the router's own IP is already drawn as the ROUTER hub below, so drop
  // it from the device column to avoid showing the same box twice
  const devices = allDevices
    .filter((d) => !GATEWAY_IP || d.ip !== GATEWAY_IP)
    .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  const n = devices.length;

  // devices stacked vertically in a column, connected via right-angle
  // (L-shaped) elbow lines instead of a radial fan
  const deviceX = 660;
  const nodeR = 20;
  const topMargin = 60, bottomMargin = 60;
  const height = Math.max(600, topMargin + bottomMargin + Math.max(0, n - 1) * 70);
  const usableHeight = height - topMargin - bottomMargin;

  const positions = devices.map((d, i) => {
    const y = n <= 1 ? routerY : topMargin + (usableHeight * i) / (n - 1);
    return { d, x: deviceX, y };
  });

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  let html = "";

  // radar pulse rings behind the router hub
  html += `
    <circle class="topo-hub-ring r1" cx="${routerX}" cy="${routerY}" r="30" />
    <circle class="topo-hub-ring r2" cx="${routerX}" cy="${routerY}" r="30" />
    <circle class="topo-hub-ring r3" cx="${routerX}" cy="${routerY}" r="30" />
  `;

  // public IP pill dimensions, worked out first so the flow line below can
  // trace its outline
  const pillX = (cloudEdgeX + (routerX - routerR)) / 2, pillY = netY;
  const ipText = publicIpVisible ? (currentPublicIp || "unknown") : maskIp(currentPublicIp);
  const eyeSize = 16;
  const pillWidth = Math.max(130, ipText.length * 8 + 56);
  const pillLeftX = pillX - pillWidth / 2, pillRightX = pillX + pillWidth / 2;
  const capR = 15; // pill height is 30, so its ends are perfect semicircles

  // internet cloud node — single clean path (Feather "cloud" icon), given
  // its own blue identity distinct from cyan (already used for "online"),
  // with a soft gradient fill and glow so it doesn't read as flat/generic
  const cloudScale = 3.4;
  html += `
    <defs>
      <radialGradient id="cloudGradient" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="rgba(143, 192, 255, 0.16)" />
        <stop offset="100%" stop-color="var(--panel)" />
      </radialGradient>
    </defs>
    <g transform="translate(${netX - 12 * cloudScale}, ${netY - 12 * cloudScale}) scale(${cloudScale})"
       style="filter: drop-shadow(0 0 3px rgba(91, 157, 240, 0.55));">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"
            fill="url(#cloudGradient)" stroke="var(--net-blue)" stroke-width="0.8" stroke-linejoin="round" />
    </g>
    <circle cx="${netX + 26}" cy="${netY - 22}" r="2.5" fill="var(--net-blue-bright)">
      <animate attributeName="opacity" values="1;0.3;1" dur="2.2s" repeatCount="indefinite" />
    </circle>
    <text x="${netX}" y="${netY + 52}" text-anchor="middle" fill="var(--net-blue)" font-family="var(--display)" font-size="12" font-weight="700" letter-spacing="0.5">INTERNET</text>
  `;

  // public IP pill background — fill only, drawn *before* the flow line so
  // the line's full stroke width stays visible instead of being half-hidden
  // under the pill's fill
  html += `<rect x="${pillLeftX}" y="${pillY - capR}" width="${pillWidth}" height="30" rx="${capR}" fill="var(--panel)" />`;

  // internet <-> router link: a straight run in from the cloud, then the
  // line itself splits in two and traces the pill's rounded outline (over
  // the top, under the bottom) as its border, merging back into a single
  // line that continues on to the router. The pill has no border of its
  // own — this flowing line *is* the border.
  const leadIn = `M ${cloudEdgeX} ${netY} L ${pillLeftX} ${netY}`;
  const topRoute = `M ${pillLeftX} ${pillY} A ${capR} ${capR} 0 0 1 ${pillLeftX + capR} ${pillY - capR} L ${pillRightX - capR} ${pillY - capR} A ${capR} ${capR} 0 0 1 ${pillRightX} ${pillY}`;
  const bottomRoute = `M ${pillLeftX} ${pillY} A ${capR} ${capR} 0 0 0 ${pillLeftX + capR} ${pillY + capR} L ${pillRightX - capR} ${pillY + capR} A ${capR} ${capR} 0 0 0 ${pillRightX} ${pillY}`;
  const leadOut = `M ${pillRightX} ${netY} L ${routerX - routerR} ${netY}`;
  html += `
    <path d="${leadIn}" fill="none" stroke="var(--amber)" stroke-width="2" opacity="0.6" class="topo-flow-line" />
    <path d="${topRoute}" fill="none" stroke="var(--amber)" stroke-width="2" opacity="0.6" class="topo-flow-line" />
    <path d="${bottomRoute}" fill="none" stroke="var(--amber)" stroke-width="2" opacity="0.6" class="topo-flow-line" />
    <path d="${leadOut}" fill="none" stroke="var(--amber)" stroke-width="2" opacity="0.6" class="topo-flow-line" />
  `;

  // hidden reference paths (one per arc) so a pulse dot can travel along
  // the top route and another along the bottom route
  const netPulsePathTopId = "topo-net-pulse-path-top";
  const netPulsePathBottomId = "topo-net-pulse-path-bottom";
  const netPulsePathTop = `${leadIn} ${topRoute.replace("M", "L")} L ${routerX - routerR} ${netY}`;
  const netPulsePathBottom = `${leadIn} ${bottomRoute.replace("M", "L")} L ${routerX - routerR} ${netY}`;
  html += `
    <path id="${netPulsePathTopId}" d="${netPulsePathTop}" fill="none" stroke="none" />
    <path id="${netPulsePathBottomId}" d="${netPulsePathBottom}" fill="none" stroke="none" />
    <circle r="3" fill="var(--amber)">
      <animateMotion dur="3.2s" repeatCount="indefinite">
        <mpath href="#${netPulsePathTopId}" />
      </animateMotion>
    </circle>
    <circle r="3" fill="var(--amber)">
      <animateMotion dur="3.2s" repeatCount="indefinite">
        <mpath href="#${netPulsePathBottomId}" />
      </animateMotion>
    </circle>
  `;

  // public IP pill contents (text + eye toggle), on top of the flow line
  // so they stay legible; data-role click target covers the same area
  html += `
    <g class="topo-ip-pill" data-role="ip-toggle" style="cursor:pointer">
      <rect x="${pillLeftX}" y="${pillY - capR}" width="${pillWidth}" height="30" rx="${capR}" fill="transparent" />
      <text x="${pillX - 14}" y="${pillY + 4}" text-anchor="middle" fill="var(--text)" font-family="var(--mono)" font-size="12">${ipText}</text>
      <svg x="${pillX + pillWidth / 2 - eyeSize - 10}" y="${pillY - eyeSize / 2}" width="${eyeSize}" height="${eyeSize}" viewBox="0 0 24 24">${eyeIconMarkup(publicIpVisible)}</svg>
    </g>
  `;



  // router / gateway hub node
  const routerIconSize = 16;
  html += `
    <g>
      <circle cx="${routerX}" cy="${routerY}" r="${routerR}" fill="var(--panel)" stroke="var(--amber)" stroke-width="2.5" />
      <svg x="${routerX - routerIconSize / 2}" y="${routerY - 22}" width="${routerIconSize}" height="${routerIconSize}" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICON_PATHS.router}</svg>
      <text x="${routerX}" y="${routerY + 4}" text-anchor="middle" fill="var(--amber)" font-family="var(--display)" font-size="12" font-weight="700">ROUTER</text>
      <text x="${routerX}" y="${routerY + 18}" text-anchor="middle" fill="var(--text-dim)" font-family="var(--mono)" font-size="10">${GATEWAY_IP || "gateway"}</text>
    </g>
  `;

  // router <-> device connectors: L-shaped elbow lines, all exiting the
  // router at the same point on its right edge (not from inside the node).
  // Each device's IP sits in a pill on the final stretch, styled the same
  // way as the public IP pill — the line itself splits and traces the
  // pill's rounded outline (over the top, under the bottom) rather than
  // a separately drawn bordered rect sitting on top of a plain line.
  //
  // The run from the router to the pill is a smooth flowing bezier curve
  // (classic node-graph style) instead of a right-angle elbow — softer
  // and more modern, and it still arrives dead level into the pill since
  // the curve's end tangent is horizontal.
  const routerExitX = routerX + routerR;
  const trunkEndX = routerExitX + 100;
  positions.forEach((p, i) => {
    const online = p.d.status === "online";
    const cls = online ? "topo-flow-line" : "topo-static-line";
    const color = online ? "var(--cyan)" : "var(--panel-line)";
    const opacity = online ? 0.7 : 0.3;

    const segStart = trunkEndX, segEnd = p.x - nodeR;
    const pillH = 20, capR2 = 10;
    const pillW = Math.max(70, p.d.ip.length * 6.4 + 20);
    const pillCx = (segStart + segEnd) / 2, pillCy = p.y;
    const pillLeft = pillCx - pillW / 2, pillRight = pillCx + pillW / 2;

    // trunk-to-pill and pill-to-node leads
    const dLeadIn = `M ${segStart} ${p.y} L ${pillLeft} ${p.y}`;
    const dTop = `M ${pillLeft} ${pillCy} A ${capR2} ${capR2} 0 0 1 ${pillLeft + capR2} ${pillCy - capR2} L ${pillRight - capR2} ${pillCy - capR2} A ${capR2} ${capR2} 0 0 1 ${pillRight} ${pillCy}`;
    const dBottom = `M ${pillLeft} ${pillCy} A ${capR2} ${capR2} 0 0 0 ${pillLeft + capR2} ${pillCy + capR2} L ${pillRight - capR2} ${pillCy + capR2} A ${capR2} ${capR2} 0 0 0 ${pillRight} ${pillCy}`;
    const dLeadOut = `M ${pillRight} ${p.y} L ${segEnd} ${p.y}`;

    // smooth bezier from the router's edge to the start of the pill run —
    // symmetric horizontal control points give a flowing S-curve
    const trunkPathId = `topo-trunk-${i}`;
    const ctrlOffset = (segStart - routerExitX) * 0.55;
    const cp1x = routerExitX + ctrlOffset, cp2x = segStart - ctrlOffset;
    const trunkPath = `M ${routerExitX} ${routerY} C ${cp1x} ${routerY}, ${cp2x} ${p.y}, ${segStart} ${p.y}`;

    // pill background fill, drawn before the line so the line's full
    // stroke stays visible instead of half-hidden under the fill
    html += `<rect x="${pillLeft}" y="${pillCy - capR2}" width="${pillW}" height="${pillH}" rx="${capR2}" fill="var(--panel)" />`;

    html += `<path id="${trunkPathId}" class="${cls}" d="${trunkPath}" fill="none" stroke="${color}" stroke-width="2.2" opacity="${opacity}" stroke-linecap="round" />`;
    html += `<path class="${cls}" d="${dLeadIn}" fill="none" stroke="${color}" stroke-width="2.2" opacity="${opacity}" />`;
    html += `<path class="${cls}" d="${dTop}" fill="none" stroke="${color}" stroke-width="2.2" opacity="${opacity}" />`;
    html += `<path class="${cls}" d="${dBottom}" fill="none" stroke="${color}" stroke-width="2.2" opacity="${opacity}" />`;
    html += `<path class="${cls}" d="${dLeadOut}" fill="none" stroke="${color}" stroke-width="2.2" opacity="${opacity}" />`;

    if (online) {
      // continuous hidden reference paths (top-hugging and bottom-hugging)
      // so the traveling pulse dot follows the curve and the pill's
      // outline smoothly instead of jumping at a corner
      const pulseTopId = `topo-pulse-top-${i}`;
      const pulseBottomId = `topo-pulse-bottom-${i}`;
      const pulseTop = `${trunkPath} L ${pillLeft} ${p.y} ${dTop.replace("M", "L")} L ${segEnd} ${p.y}`;
      const pulseBottom = `${trunkPath} L ${pillLeft} ${p.y} ${dBottom.replace("M", "L")} L ${segEnd} ${p.y}`;
      const dur = (2.4 + (i % 5) * 0.35).toFixed(2);
      html += `
        <path id="${pulseTopId}" d="${pulseTop}" fill="none" stroke="none" />
        <path id="${pulseBottomId}" d="${pulseBottom}" fill="none" stroke="none" />
        <circle r="3" fill="var(--cyan)">
          <animateMotion dur="${dur}s" repeatCount="indefinite"><mpath href="#${pulseTopId}" /></animateMotion>
        </circle>
        <circle r="3" fill="var(--cyan)">
          <animateMotion dur="${dur}s" repeatCount="indefinite"><mpath href="#${pulseBottomId}" /></animateMotion>
        </circle>
      `;
    }

    const textColor = online ? "var(--text)" : "var(--text-dim)";
    html += `<text x="${pillCx}" y="${pillCy + 3.5}" text-anchor="middle" fill="${textColor}" font-family="var(--mono)" font-size="9.5">${p.d.ip}</text>`;
  });

  // device nodes
  for (const p of positions) {
    const d = p.d;
    const online = d.status === "online";
    const color = online ? "var(--cyan)" : "var(--text-dim)";
    const name = displayName(d) || d.ip;
    const label = name.length > 18 ? name.slice(0, 17) + "…" : name;
    const ring = online ? `<circle cx="${p.x}" cy="${p.y}" r="24" fill="none" stroke="${color}" stroke-width="1" opacity="0.25" />` : "";

    const iconSize = 16;
    html += `
      <g class="topo-node-circle" data-ip="${d.ip}">
        ${ring}
        <circle cx="${p.x}" cy="${p.y}" r="${nodeR}" fill="var(--panel)" stroke="${color}" stroke-width="2" />
        <svg x="${p.x - iconSize / 2}" y="${p.y - iconSize / 2}" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICON_PATHS[d.device_type] || TYPE_ICON_PATHS[""]}</svg>
        <text x="${p.x + 30}" y="${p.y + 4}" text-anchor="start" fill="var(--text)" font-family="var(--mono)" font-size="12">${label}</text>
      </g>
    `;
  }

  svg.innerHTML = html;

  svg.querySelectorAll(".topo-node-circle").forEach((g) => {
    g.addEventListener("click", () => openEditModal(g.dataset.ip));
  });

  const pillEl = svg.querySelector(".topo-ip-pill");
  if (pillEl) {
    pillEl.addEventListener("click", () => {
      publicIpVisible = !publicIpVisible;
      renderTopology();
    });
  }

  if (devices.length === 0) {
    svg.innerHTML += `<text x="${routerX}" y="${routerY + 90}" text-anchor="middle" fill="var(--text-dim)" font-family="var(--mono)" font-size="13">no devices yet</text>`;
  }
}

// ---------- topology pan & zoom ----------
(function initTopoZoom() {
  const wrap = document.getElementById("topoWrap");
  const svg = document.getElementById("topoSvg");
  if (!wrap || !svg) return;

  const MIN_SCALE = 0.4, MAX_SCALE = 3;
  let scale = 1, panX = 0, panY = 0;

  function apply() {
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function clamp(s) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = wrap.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const newScale = clamp(scale * factor);
    const ratio = newScale / scale;
    panX = px - ratio * (px - panX);
    panY = py - ratio * (py - panY);
    scale = newScale;
    apply();
  }

  function reset() {
    scale = 1; panX = 0; panY = 0;
    apply();
  }

  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  const pointers = new Map();
  let dragStart = null;
  let pinchStart = null;
  let moved = false;
  let suppressNextClick = false;

  function mid() {
    const pts = Array.from(pointers.values());
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  function dist() {
    const pts = Array.from(pointers.values());
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  wrap.addEventListener("pointerdown", (e) => {
    // Don't start a pan/capture gesture if the press started on something
    // clickable — capturing the pointer here redirects the resulting click
    // event to `wrap` instead of the button/pill/node, silently breaking
    // their click handlers.
    if (e.target.closest("button, .topo-ip-pill, .topo-node-circle")) {
      return;
    }
    wrap.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, panX, panY };
      wrap.classList.add("panning");
    } else if (pointers.size === 2) {
      dragStart = null;
      const rect = wrap.getBoundingClientRect();
      const m = mid();
      pinchStart = { dist: dist(), scale, midX: m.x - rect.left, midY: m.y - rect.top, panX, panY };
    }
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStart) {
      const newScale = clamp(pinchStart.scale * (dist() / pinchStart.dist));
      const ratio = newScale / pinchStart.scale;
      panX = pinchStart.midX - ratio * (pinchStart.midX - pinchStart.panX);
      panY = pinchStart.midY - ratio * (pinchStart.midY - pinchStart.panY);
      scale = newScale;
      moved = true;
      apply();
    } else if (pointers.size === 1 && dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      panX = dragStart.panX + dx;
      panY = dragStart.panY + dy;
      apply();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      if (moved) suppressNextClick = true;
      dragStart = null;
      wrap.classList.remove("panning");
    } else if (pointers.size === 1) {
      const p = Array.from(pointers.values())[0];
      dragStart = { x: p.x, y: p.y, panX, panY };
    }
  }
  wrap.addEventListener("pointerup", endPointer);
  wrap.addEventListener("pointercancel", endPointer);
  wrap.addEventListener("pointerleave", endPointer);

  // dragging across a device node or the IP pill shouldn't also trigger its click
  wrap.addEventListener("click", (e) => {
    if (suppressNextClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressNextClick = false;
    }
  }, true);

  wrap.addEventListener("dblclick", reset);

  document.getElementById("topoZoomIn").addEventListener("click", () => {
    const rect = wrap.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.3);
  });
  document.getElementById("topoZoomOut").addEventListener("click", () => {
    const rect = wrap.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.3);
  });
  document.getElementById("topoZoomReset").addEventListener("click", reset);
})();

// ---------- PWA service worker registration ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/static/sw.js").catch(() => {
      // non-fatal — installability just won't be available
    });
  });
}
