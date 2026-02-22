const $ = (s, r = document) => r.querySelector(s);
const views = ["dashboard", "orders", "customers", "products", "verification"];
const navItems = [["dashboard", "Dashboard"], ["orders", "Orders"], ["customers", "Customers"], ["products", "Products"], ["verification", "Verification"]];
const TIER_THRESHOLDS = { Bronze: 0, Silver: 250, Gold: 750, Platinum: 1500 };
const DEFAULT_LOW_STOCK = 5;
let confirmResolve = null;
let confirmFailsafeTimeout = null;

const state = {
  view: "dashboard",
  unlocked: false,
  selectedRow: "",
  drawer: { type: "", id: "", tab: "" },
  cache: { orders: null, customers: null, products: null },
  filters: { orders: "", customers: "", products: "" },
  focusReturn: null,
  palette: { open: false, query: "", active: 0, results: [] },
  data: {},
};

function secret() { return sessionStorage.getItem("bb_admin_secret") || ""; }
function setSecret(v) { sessionStorage.setItem("bb_admin_secret", v); }
const money = (c) => (c == null ? "—" : `$${(Number(c) / 100).toFixed(2)}`);
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");

function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  $("#toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function safeFetchJson(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (secret()) headers["x-admin-secret"] = secret();
  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { error: "Unexpected response" }; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function buildNav() {
  const nav = $("#sidebarNav"); nav.replaceChildren();
  navItems.forEach(([id, label]) => {
    const b = document.createElement("button");
    b.className = `btn ${state.view === id ? "active" : ""}`;
    b.textContent = label;
    b.disabled = !state.unlocked;
    b.onclick = () => { state.view = id; state.selectedRow = ""; renderView(); buildNav(); };
    nav.appendChild(b);
  });
}

function setLocked(locked) { state.unlocked = !locked; $("#unlockStatus").textContent = locked ? "Locked" : "Unlocked"; $("#lockIndicator").textContent = locked ? "Locked" : "Unlocked"; buildNav(); }
function rowSkeleton(count = 8) { const f = document.createDocumentFragment(); for (let i = 0; i < count; i++) { const d = document.createElement("div"); d.className = "skeleton"; f.appendChild(d); } return f; }

function makeCopyButton(text, label = "Copy") { const b = document.createElement("button"); b.className = "btn btn-small"; b.textContent = label; b.onclick = async () => { await navigator.clipboard.writeText(text || ""); toast("Copied"); }; return b; }

function openDrawer(title) {
  state.focusReturn = document.activeElement;
  const drawer = $("#drawer"); $("#drawerTitle").textContent = title;
  drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); $("#drawerTab").hidden = true;
  trapFocus(drawer);
}
function clearDrawer() { const drawer = $("#drawer"); drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); $("#drawerTab").hidden = true; state.drawer = { type: "", id: "", tab: "" }; releaseFocus(); }

function releaseFocus() { if (state.focusReturn && typeof state.focusReturn.focus === "function") state.focusReturn.focus(); state.focusReturn = null; }
function trapFocus(container) {
  const first = container.querySelector("button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
  first?.focus();
  container.onkeydown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); if (state.palette.open) closePalette(); else clearDrawer(); return; }
    if (e.key !== "Tab") return;
    const els = [...container.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.disabled);
    if (!els.length) return;
    const idx = els.indexOf(document.activeElement);
    if (e.shiftKey && idx <= 0) { e.preventDefault(); els[els.length - 1].focus(); }
    if (!e.shiftKey && idx === els.length - 1) { e.preventDefault(); els[0].focus(); }
  };
}

function renderErrorCard(root, message) { const card = document.createElement("div"); card.className = "card error-card"; card.textContent = message; root.appendChild(card); }

function makeTable(columns, rows, onClick) {
  const wrap = document.createElement("div"); wrap.className = "table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead"); const trh = document.createElement("tr");
  columns.forEach((c) => { const th = document.createElement("th"); th.textContent = c; trh.appendChild(th); });
  thead.appendChild(trh);
  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    if (state.selectedRow === r.key) tr.classList.add("selected");
    r.cells.forEach((cell) => { const td = document.createElement("td"); if (cell instanceof HTMLElement) td.appendChild(cell); else td.textContent = String(cell ?? ""); tr.appendChild(td); });
    tr.onclick = () => { state.selectedRow = r.key; onClick?.(r); renderView(); };
    tbody.appendChild(tr);
  });
  table.append(thead, tbody); wrap.appendChild(table); return wrap;
}

function buildCommandResults(query) {
  const q = query.trim().toLowerCase();
  const commands = [
    { label: "New Product", action: () => { state.view = "products"; buildNav(); openProductDrawer("new"); } },
    { label: `Find Customer ${query}`, action: () => { state.view = "customers"; state.filters.customers = query; buildNav(); renderView(); } },
    { label: `Find Order ${query}`, action: () => { state.view = "orders"; state.filters.orders = query; buildNav(); renderView(); } },
    { label: `Open Product ${query}`, action: async () => { state.view = "products"; buildNav(); await renderView(); const first = (state.cache.products || []).find((p) => (`${p.name} ${p.slug}`).toLowerCase().includes(q)); if (first) openProductDrawer(first.id); } },
  ];
  const local = [];
  ["customers", "orders", "products"].forEach((type) => {
    (state.cache[type] || []).forEach((item) => {
      const hay = JSON.stringify(item).toLowerCase();
      if (q && hay.includes(q)) local.push({ label: `${type.slice(0, -1)} • ${item.name || item.email || item.id || item.slug}`, action: () => openByType(type, item) });
    });
  });
  return [...commands, ...local].slice(0, 12);
}

function openByType(type, item) { if (type === "customers") openCustomerDrawer(item.id); if (type === "orders") openOrderDrawer(item.id); if (type === "products") openProductDrawer(item.id); }
function openPalette() { state.focusReturn = document.activeElement; state.palette.open = true; const pal = $("#commandPalette"); pal.hidden = false; pal.classList.add("open"); trapFocus(pal); $("#paletteInput").focus(); }
function closePalette() { state.palette.open = false; const pal = $("#commandPalette"); pal.hidden = true; pal.classList.remove("open"); releaseFocus(); }

async function renderPalette() {
  const query = $("#paletteInput").value;
  const root = $("#paletteResults");
  state.palette.results = buildCommandResults(query);
  if (query.trim().length > 1) {
    const remote = await Promise.all(["customers", "orders", "products"].map((type) => safeFetchJson(`/api/admin/search?q=${encodeURIComponent(query)}&type=${type}`).catch(() => ({ results: [] }))));
    remote.forEach((packet) => (packet.results || []).forEach((r) => state.palette.results.push({ label: `${r.type} • ${r.name || r.email || r.id || r.slug}`, action: () => openByType(`${r.type}s`, r) })));
  }
  root.replaceChildren();
  state.palette.results.slice(0, 14).forEach((res, idx) => {
    const btn = document.createElement("button"); btn.className = `palette-row ${idx === state.palette.active ? "active" : ""}`; btn.textContent = res.label; btn.onclick = () => { res.action(); closePalette(); };
    root.appendChild(btn);
  });
}

async function renderDashboard(root) {
  root.replaceChildren(); root.appendChild(rowSkeleton(6));
  const cards = document.createElement("div"); cards.className = "cards";
  const topLists = document.createElement("div"); topLists.className = "cards";
  root.replaceChildren(cards, topLists);
  try {
    const [summary, topProducts, topCustomers] = await Promise.all([
      safeFetchJson("/api/admin/analytics/summary?range=30"),
      safeFetchJson("/api/admin/analytics/top-products?range=30"),
      safeFetchJson("/api/admin/analytics/top-customers?range=all"),
    ]);
    const metrics = [
      ["Orders Today", summary.snapshots.today.orders], ["Revenue Today", money(summary.snapshots.today.revenue_cents)],
      ["Orders Last 7 Days", summary.snapshots.last7.orders], ["Revenue Last 7 Days", money(summary.snapshots.last7.revenue_cents)],
      ["Orders Last 30 Days", summary.snapshots.last30.orders], ["Revenue Last 30 Days", money(summary.snapshots.last30.revenue_cents)],
      ["Redemption Rate", `${Math.round((summary.period.redemption_rate || 0) * 100)}%`],
    ];
    metrics.forEach(([k, v]) => { const c = document.createElement("div"); c.className = "card clickable"; c.append(Object.assign(document.createElement("div"), { className: "muted", textContent: k }), Object.assign(document.createElement("h3"), { textContent: String(v) })); cards.appendChild(c); });
    const p = document.createElement("div"); p.className = "card"; p.appendChild(Object.assign(document.createElement("h4"), { textContent: "Top 5 Products" }));
    (topProducts.products || []).forEach((x) => { const row = document.createElement("div"); row.className = "rank-row"; row.textContent = `${x.product_name} • ${x.quantity} units`; p.appendChild(row); });
    const c = document.createElement("div"); c.className = "card"; c.appendChild(Object.assign(document.createElement("h4"), { textContent: "Top 5 Customers" }));
    (topCustomers.customers || []).forEach((x) => { const row = document.createElement("div"); row.className = "rank-row"; row.textContent = `${x.name || x.email} • ${money(x.spend_cents)}`; c.appendChild(row); });
    topLists.append(p, c);
  } catch (e) { renderErrorCard(root, `Analytics unavailable: ${e.message}`); }
}

async function renderOrders(root) {
  root.replaceChildren();
  const q = state.filters.orders || $("#globalSearch").value.trim();
  root.appendChild(rowSkeleton(8));
  const d = await safeFetchJson(`/api/admin/orders?query=${encodeURIComponent(q)}&limit=200`);
  state.cache.orders = d.orders || [];
  const rows = state.cache.orders.map((o) => ({ key: o.id, data: o, cells: [fmtDate(o.created_at), o.status, o.customer_email || "Guest", makeCopyButton(o.id, "Copy ID"), money(o.total_cents), String(o.points_redeemed || 0)] }));
  root.replaceChildren(makeTable(["Date", "Status", "Customer", "Order", "Total", "Redeemed"], rows, (r) => openOrderDrawer(r.data.id)));
}

async function renderCustomers(root) {
  root.replaceChildren(); root.appendChild(rowSkeleton(8));
  const q = state.filters.customers || $("#globalSearch").value.trim();
  const d = await safeFetchJson(`/api/admin/customers?query=${encodeURIComponent(q)}&limit=200`);
  state.cache.customers = d.customers || [];
  const rows = state.cache.customers.map((u) => ({ key: u.id, data: u, cells: [u.first_name || "", u.email || "", makeCopyButton(u.email || "", "Copy"), u.effectiveTier, money(u.lifetime_spend_cents), String(u.points_balance || 0)] }));
  root.replaceChildren(makeTable(["Name", "Email", "Copy", "Tier", "Lifetime", "Points"], rows, (r) => openCustomerDrawer(r.data.id)));
}

async function renderProducts(root) {
  root.replaceChildren(); root.appendChild(rowSkeleton(8));
  const q = state.filters.products || $("#globalSearch").value.trim();
  const d = await safeFetchJson(`/api/admin/products?query=${encodeURIComponent(q)}&limit=200`);
  state.cache.products = d.products || [];
  const rows = state.cache.products.map((p) => {
    const badge = document.createElement("span");
    badge.className = `badge ${Number(p.low_stock) ? "red" : "green"}`;
    badge.textContent = Number(p.low_stock) ? "Low Stock" : "Healthy";
    return { key: p.id, data: p, cells: [p.name, makeCopyButton(p.slug, "Copy slug"), p.category, money(p.total_inventory), badge] };
  });
  root.replaceChildren(makeTable(["Product", "Slug", "Category", "Inventory", "Status"], rows, (r) => openProductDrawer(r.data.id)));
}

async function renderVerification(root) {
  root.replaceChildren();
  const data = await safeFetchJson("/api/admin/verification/pending");
  const rows = (data.pending || []).map((v) => ({ key: v.user_id, data: v, cells: [v.email || "", v.account_status || "pending", fmtDate(v.updated_at)] }));
  root.appendChild(makeTable(["Email", "Status", "Updated"], rows, (r) => { state.data = { verification: r.data }; state.drawer = { type: "verification", id: r.data.user_id, tab: "Profile" }; openDrawer("Verification"); renderDrawer(); }));
}

function tierProgress(customer) {
  const current = Number(customer.lifetime_spend_cents || 0) / 100;
  const entries = Object.entries(TIER_THRESHOLDS);
  let currName = entries[0][0];
  let next = null;
  entries.forEach(([name, threshold], idx) => { if (current >= threshold) currName = name; if (!next && current < threshold && idx > 0) next = [name, threshold]; });
  const wrap = document.createElement("div"); wrap.className = "card";
  const label = document.createElement("div");
  label.textContent = customer.tier_override ? `${customer.tier_override} (manual override)` : currName;
  const progress = document.createElement("div"); progress.className = "progress";
  const bar = document.createElement("div"); bar.className = "progress-bar";
  let pct = 100; let hint = "Top tier reached";
  if (next) { const prev = entries[Math.max(0, entries.findIndex(([n]) => n === next[0]) - 1)][1]; pct = ((current - prev) / (next[1] - prev)) * 100; hint = `$${(next[1] - current).toFixed(2)} to reach ${next[0]}`; }
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`; progress.appendChild(bar);
  wrap.append(Object.assign(document.createElement("h4"), { textContent: "Tier Progress" }), label, progress, Object.assign(document.createElement("div"), { className: "muted", textContent: hint }));
  return wrap;
}

async function openOrderDrawer(id) { state.drawer = { type: "order", id, tab: "Summary" }; openDrawer(`Order ${id}`); await renderDrawer(); }
async function openCustomerDrawer(id) { state.drawer = { type: "customer", id, tab: "Profile" }; openDrawer("Customer"); await renderDrawer(); }
async function openProductDrawer(id) { state.drawer = { type: "product", id, tab: "General" }; openDrawer(id === "new" ? "New Product" : "Product"); await renderDrawer(); }

function hideConfirmModal() {
  const modal = $("#confirmModal");
  if (!modal) return;
  modal.hidden = true;
  if (confirmFailsafeTimeout) {
    clearTimeout(confirmFailsafeTimeout);
    confirmFailsafeTimeout = null;
  }
}

function forceHideConfirmModal() {
  confirmResolve = null;
  hideConfirmModal();
}

function dismissConfirmWithResult(result) {
  const resolve = confirmResolve;
  confirmResolve = null;
  hideConfirmModal();
  if (resolve) resolve(result);
  releaseFocus();
}

function enforceConfirmModalFailsafe() {
  const modal = $("#confirmModal");
  if (!modal || modal.hidden) return;
  if (!confirmResolve) {
    forceHideConfirmModal();
    return;
  }
  if (confirmFailsafeTimeout) clearTimeout(confirmFailsafeTimeout);
  confirmFailsafeTimeout = setTimeout(() => {
    const activeModal = $("#confirmModal");
    if (activeModal && !activeModal.hidden && !confirmResolve) forceHideConfirmModal();
  }, 2000);
}

window.bbConfirm = ({ title = "Confirm action?", message = "", confirmText = "Confirm", cancelText = "Cancel" } = {}) => new Promise((resolve) => {
  const modal = $("#confirmModal");
  const confirmTextNode = $("#confirmText");
  if (!modal || !confirmTextNode) { resolve(false); return; }

  confirmResolve = resolve;
  confirmTextNode.textContent = message ? `${title}\n${message}` : title;
  $("#confirmOk").textContent = confirmText;
  $("#confirmCancel").textContent = cancelText;
  modal.hidden = false;
  trapFocus(modal);
  enforceConfirmModalFailsafe();
});

async function renderDrawer() {
  const body = $("#drawerBody"); const actions = $("#drawerActions"); body.replaceChildren(rowSkeleton(6)); actions.replaceChildren();
  if (!state.drawer.type) return;
  if (state.drawer.type === "order") {
    const d = await safeFetchJson(`/api/admin/orders/${state.drawer.id}`); const o = d.order || {};
    body.replaceChildren();
    const timeline = document.createElement("div"); timeline.className = "timeline";
    [["Created", o.created_at], ["Verified", o.verified_at], ["Points Applied", Number(o.points_redeemed || 0) > 0 ? o.updated_at || o.created_at : ""], ["Completed", /completed|fulfilled/i.test(o.status || "") ? o.updated_at || o.created_at : ""]].forEach(([label, time]) => { if (!time) return; const item = document.createElement("div"); item.className = "timeline-item"; item.textContent = `${label} • ${fmtDate(time)}`; timeline.appendChild(item); });
    body.append(timeline, Object.assign(document.createElement("pre"), { textContent: `Status: ${o.status}\nCustomer: ${o.customer_email || "Guest"}\nTotal: ${money(o.total_cents)}` }));
    const status = document.createElement("select"); ["pending", "completed", "cancelled"].forEach((s) => status.add(new Option(s, s))); status.value = o.status || "pending";
    const save = document.createElement("button"); save.className = "btn btn-gold"; save.textContent = "Update Status";
    save.onclick = async () => { await safeFetchJson("/api/admin/orders-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: o.id, status: status.value }) }); toast("Status updated"); };
    actions.append(status, save);
  }
  if (state.drawer.type === "customer") {
    const d = await safeFetchJson(`/api/admin/customers/${state.drawer.id}`); const c = d.customer || {};
    body.replaceChildren(tierProgress(c));
  }
  if (state.drawer.type === "product") {
    if (state.drawer.id === "new") {
      const name = document.createElement("input"); name.placeholder = "Name";
      const brand = document.createElement("input"); brand.placeholder = "Brand";
      const category = document.createElement("input"); category.placeholder = "Category";
      body.replaceChildren(name, brand, category);
      const create = document.createElement("button"); create.className = "btn btn-gold"; create.textContent = "Create Product";
      create.onclick = async () => { await safeFetchJson("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.value, brand: brand.value, category: category.value }) }); toast("Created product"); renderView(); };
      actions.appendChild(create); return;
    }
    const d = await safeFetchJson(`/api/admin/products/${state.drawer.id}`); const p = d.product || {}; const variants = d.variants || [];
    const inv = document.createElement("div"); inv.className = "card"; inv.appendChild(Object.assign(document.createElement("h4"), { textContent: "Inventory Intelligence" }));
    const orders = await safeFetchJson("/api/admin/orders?limit=300").catch(() => ({ orders: [] }));
    variants.forEach((v) => {
      const sold30 = (orders.orders || []).reduce((sum, o) => { try { const items = JSON.parse(o.cart_json || "[]"); return sum + (Array.isArray(items) ? items.filter((x) => String(x.variant_id || x.variantId) === String(v.id)).reduce((s, x) => s + Number(x.quantity || 1), 0) : 0); } catch { return sum; } }, 0);
      const threshold = v.low_stock_threshold == null ? DEFAULT_LOW_STOCK : Number(v.low_stock_threshold);
      const daysSupply = sold30 > 0 ? Math.round((Number(v.inventory_qty || 0) / (sold30 / 30)) * 10) / 10 : "∞";
      const row = document.createElement("div"); row.className = "rank-row";
      const low = Number(v.inventory_qty || 0) <= threshold;
      row.textContent = `${v.label}: on-hand ${v.inventory_qty} | threshold ${threshold} | sold30 ${sold30} | supply ${daysSupply}d`;
      if (low) row.classList.add("low-stock");
      inv.appendChild(row);
    });
    body.replaceChildren(inv);
  }
}

async function renderView() {
  const root = $("#viewContent");
  if (!state.unlocked) { root.replaceChildren(Object.assign(document.createElement("div"), { className: "card", textContent: "Unlock to access admin tools." })); return; }
  try {
    if (state.view === "dashboard") await renderDashboard(root);
    if (state.view === "orders") await renderOrders(root);
    if (state.view === "customers") await renderCustomers(root);
    if (state.view === "products") await renderProducts(root);
    if (state.view === "verification") await renderVerification(root);
  } catch (e) { root.replaceChildren(); renderErrorCard(root, `Error loading view: ${e.message}`); toast(e.message, "error"); }
}

document.addEventListener("DOMContentLoaded", () => {
  forceHideConfirmModal();
  buildNav(); setLocked(true); renderView();
  $("#unlockBtn").onclick = async () => {
    try {
      const sec = $("#secret").value.trim();
      const data = await safeFetchJson("/api/admin/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: sec }) });
      if (!data.ok) throw new Error("Unlock failed");
      setSecret(sec); setLocked(false); toast("Unlocked"); renderView();
    } catch (e) { setLocked(true); toast(e.message, "error"); }
  };
  $("#refreshBtn").onclick = () => renderView();
  $("#globalSearch").addEventListener("input", () => renderView());
  $("#drawerClose").onclick = clearDrawer;
  $("#drawerMinimize").onclick = () => { $("#drawer").classList.remove("open"); $("#drawerTab").hidden = false; };
  $("#drawerTab").onclick = () => { $("#drawer").classList.add("open"); $("#drawerTab").hidden = true; trapFocus($("#drawer")); };

  $("#paletteInput").addEventListener("input", () => { state.palette.active = 0; renderPalette(); });
  $("#paletteClose").onclick = closePalette;
  $("#confirmCancel").onclick = () => dismissConfirmWithResult(false);
  $("#confirmOk").onclick = () => dismissConfirmWithResult(true);

  const confirmModal = $("#confirmModal");
  new MutationObserver(() => enforceConfirmModalFailsafe()).observe(confirmModal, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
  enforceConfirmModalFailsafe();

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); state.palette.active = 0; openPalette(); renderPalette(); }
    if (e.key === "Escape") {
      const confirmModalOpen = !$("#confirmModal").hidden;
      if (confirmModalOpen) {
        e.preventDefault();
        dismissConfirmWithResult(false);
        return;
      }
      if (state.palette.open) closePalette(); else clearDrawer();
    }
    if (state.palette.open && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "ArrowDown") state.palette.active = Math.min(state.palette.active + 1, state.palette.results.length - 1);
      if (e.key === "ArrowUp") state.palette.active = Math.max(state.palette.active - 1, 0);
      if (e.key === "Enter") { state.palette.results[state.palette.active]?.action?.(); closePalette(); return; }
      renderPalette();
    }
  });
});
