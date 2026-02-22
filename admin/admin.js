const $ = (s) => document.querySelector(s);
const state = { admin: null, needsBootstrap: false, panel: "dashboard", views: [] };

const navItems = [
  ["dashboard", "Dashboard"],
  ["orders", "Orders"],
  ["customers", "Customers"],
  ["products", "Products"],
  ["verification", "Verification"],
];

const toast = (message, type = "ok") => {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  $("#toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 3000);
};

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "include", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.msg || `Request failed (${res.status})`);
  return data;
}

function money(cents) { return `$${(Number(cents || 0) / 100).toFixed(2)}`; }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

function setWorkspaceVisible(visible) {
  $(".sidebar").hidden = !visible;
  $("#workspace").hidden = !visible;
  $("#workspaceTopbar").hidden = !visible;
}

function renderAuth() {
  const root = $("#authView");
  if (state.admin) {
    root.hidden = true;
    setWorkspaceVisible(true);
    $("#adminIdentity").textContent = `${state.admin.name || state.admin.email} (${state.admin.role})`;
    return renderApp();
  }

  setWorkspaceVisible(false);
  root.hidden = false;
  root.innerHTML = `<div class="card"><h3>Admin Login</h3><input id="loginEmail" placeholder="Email" /><input id="loginPassword" placeholder="Password" type="password" /><button id="loginBtn" class="btn btn-gold">Login</button></div>
  <div class="card" ${state.needsBootstrap ? "" : "hidden"}><h3>Bootstrap Super Admin</h3><input id="bootSecret" placeholder="Bootstrap secret" type="password" /><input id="bootEmail" placeholder="Owner email" /><input id="bootName" placeholder="Owner name" /><input id="bootPassword" placeholder="Password" type="password" /><button id="bootBtn" class="btn btn-gold">Bootstrap</button></div>`;

  $("#loginBtn").onclick = async () => {
    try {
      const d = await api("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: $("#loginEmail").value, password: $("#loginPassword").value }) });
      state.admin = d.data?.admin || d.admin; renderAuth();
    } catch (e) { toast(e.message, "error"); }
  };

  if (state.needsBootstrap) {
    $("#bootBtn").onclick = async () => {
      try {
        await api("/api/admin/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: $("#bootSecret").value, email: $("#bootEmail").value, name: $("#bootName").value, password: $("#bootPassword").value }) });
        toast("Super admin bootstrapped.");
      } catch (e) { toast(e.message, "error"); }
    };
  }
}

function renderNav() {
  const items = [...navItems];
  if (state.admin?.role === "super_admin") items.push(["admin-users", "Admin Users"]);
  $("#sideNav").innerHTML = items.map(([k, label]) => `<button class="btn nav-btn ${state.panel === k ? "active" : ""}" data-panel="${k}">${label}</button>`).join("");
  document.querySelectorAll(".nav-btn").forEach((b) => b.onclick = () => { state.panel = b.dataset.panel; renderApp(); });
}

function openDrawer(title, obj) {
  $("#drawerTitle").textContent = title;
  $("#drawerBody").innerHTML = `<pre>${esc(JSON.stringify(obj, null, 2))}</pre>`;
  $("#detailDrawer").classList.add("open");
}

async function panelDashboard() {
  const range = $("#globalRange").value;
  const q = new URLSearchParams({ range });
  if (range === "custom") {
    q.set("start", $("#customStart").value);
    q.set("end", $("#customEnd").value);
  }
  const d = await api(`/api/admin/dashboard?${q.toString()}`);
  const m = d.metrics || {};
  return `<div class="dashboard-controls"><h2>Dashboard</h2><span class="muted">${esc(d.range.start)} → ${esc(d.range.end)}</span></div>
  <div class="cards">
  <div class="card"><div class="muted">Revenue (Completed)</div><h3>${money(m.revenue_completed_cents)}</h3></div>
  <div class="card"><div class="muted">Pending</div><h3>${money(m.pending_cents)}</h3></div>
  <div class="card"><div class="muted">Cancelled</div><h3>${money(m.cancelled_cents)}</h3></div>
  <div class="card"><div class="muted">AOV (Completed)</div><h3>${money(m.aov_completed_cents)}</h3></div>
  </div>
  <div class="cards">
  <div class="card">Orders: completed ${m.orders_completed_count}, pending ${m.orders_pending_count}, cancelled ${m.orders_cancelled_count}</div>
  <div class="card">Customers: total ${m.customers_total}, active ${m.customers_active}, new ${m.new_customers_count}</div>
  <div class="card">Points: issued ${m.points_issued}, redeemed ${m.points_redeemed}, outstanding ${m.points_outstanding}</div>
  </div>
  <div class="table-wrap"><table><thead><tr><th>Top customers</th><th>Completed lifetime spend</th><th>Points</th></tr></thead><tbody>
  ${(d.top_customers || []).map((c) => `<tr><td>${esc(c.email)} (${esc([c.first_name, c.last_name].filter(Boolean).join(" "))})</td><td>${money(c.lifetime_spend_completed_cents)}</td><td>${Number(c.points_balance || 0)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

async function panelOrders() {
  const q = encodeURIComponent($("#globalSearch").value || "");
  const d = await api(`/api/admin/orders?query=${q}`);
  return `<h2>Orders</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Status</th><th>Total</th><th>Created</th></tr></thead><tbody>
  ${(d.orders || []).map((o) => `<tr class='clickable-row order-row' data-id='${o.id}'><td>${esc(o.id)}</td><td>${esc(o.status)}</td><td>${money(o.total_cents)}</td><td>${esc(o.created_at)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

async function panelCustomers() {
  const q = encodeURIComponent($("#globalSearch").value || "");
  const d = await api(`/api/admin/customers?query=${q}`);
  return `<h2>Customers</h2><div class='table-wrap'><table><thead><tr><th>Email</th><th>Status</th><th>Lifetime Spend</th></tr></thead><tbody>
  ${(d.customers || []).map((c) => `<tr class='clickable-row customer-row' data-id='${c.id}'><td>${esc(c.email)}</td><td>${esc(c.account_status)}</td><td>${money(c.lifetime_spend_cents)}</td></tr>`).join("")}</tbody></table></div>`;
}

async function panelProducts() {
  const q = encodeURIComponent($("#globalSearch").value || "");
  const d = await api(`/api/admin/products?query=${q}`);
  return `<h2>Products</h2><div class='table-wrap'><table><thead><tr><th>Name</th><th>Category</th><th>Published</th></tr></thead><tbody>
  ${(d.products || []).map((p) => `<tr class='clickable-row product-row' data-id='${p.id}'><td>${esc(p.name)}</td><td>${esc(p.category || "")}</td><td>${Number(p.is_published) ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table></div>`;
}

async function panelVerification() {
  const d = await api(`/api/admin/verification/pending`);
  return `<h2>Verification</h2><div class='table-wrap'><table><thead><tr><th>User</th><th>Status</th><th>Updated</th></tr></thead><tbody>
  ${(d.users || []).map((u) => `<tr><td>${esc(u.email)}</td><td>${esc(u.account_status || "pending")}</td><td>${esc(u.updated_at || "")}</td></tr>`).join("")}</tbody></table></div>`;
}

async function panelAdminUsers() {
  const d = await api("/api/admin/users");
  const admins = d.data?.admins || d.admins || [];
  return `<div style='display:flex;justify-content:space-between;align-items:center;'><h2>Admin Users</h2><button id='newAdminBtn' class='btn btn-gold'>Create Admin</button></div>
  <div class='table-wrap'><table><thead><tr><th>Email</th><th>Name</th><th>Active</th><th>Role</th><th>Actions</th></tr></thead><tbody>
  ${admins.map((a) => `<tr><td>${esc(a.email)}</td><td>${esc(a.name || "")}</td><td>${Number(a.is_active) ? "Yes" : "No"}</td><td>${esc(a.role || "admin")}</td><td>
  <button class='btn btn-small t-active' data-id='${a.id}'>Toggle Active</button>
  <button class='btn btn-small t-super' data-id='${a.id}'>Toggle Super</button>
  <button class='btn btn-small t-del' data-id='${a.id}'>Delete</button>
  </td></tr>`).join("")}</tbody></table></div>`;
}

async function renderApp() {
  renderNav();
  const root = $("#workspace");
  const panels = { dashboard: panelDashboard, orders: panelOrders, customers: panelCustomers, products: panelProducts, verification: panelVerification, "admin-users": panelAdminUsers };
  const fn = panels[state.panel] || panelDashboard;
  root.innerHTML = `<div class='skeleton'></div><div class='skeleton'></div>`;
  try {
    root.innerHTML = await fn();
    bindPanelEvents();
  } catch (e) {
    root.innerHTML = `<div class='card error-card'>${esc(e.message)}</div>`;
  }
}

function bindPanelEvents() {
  document.querySelectorAll(".order-row").forEach((r) => r.onclick = async () => openDrawer("Order", await api(`/api/admin/orders/${r.dataset.id}`)));
  document.querySelectorAll(".customer-row").forEach((r) => r.onclick = async () => openDrawer("Customer", await api(`/api/admin/customers/${r.dataset.id}`)));
  document.querySelectorAll(".product-row").forEach((r) => r.onclick = async () => openDrawer("Product", await api(`/api/admin/products/${r.dataset.id}`)));
  document.querySelectorAll(".t-active").forEach((b) => b.onclick = async () => { if (confirm("Toggle active?")) { await api(`/api/admin/users/${b.dataset.id}/toggle-active`, { method: "POST" }); renderApp(); } });
  document.querySelectorAll(".t-super").forEach((b) => b.onclick = async () => { if (confirm("Toggle super admin?")) { await api(`/api/admin/users/${b.dataset.id}/toggle-super`, { method: "POST" }); renderApp(); } });
  document.querySelectorAll(".t-del").forEach((b) => b.onclick = async () => { if (prompt("Type DELETE to confirm") === "DELETE") { await api(`/api/admin/users/${b.dataset.id}`, { method: "DELETE" }); renderApp(); } });
  const n = $("#newAdminBtn");
  if (n) n.onclick = async () => {
    const email = prompt("Admin email"); if (!email) return;
    const name = prompt("Name") || "";
    const password = prompt("Temp password (min 8 chars)"); if (!password) return;
    const role = prompt("Role (super_admin/admin/staff)") || "admin";
    await api("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, name, password, role }) });
    renderApp();
  };
}

async function init() {
  $("#logoutBtn").onclick = async () => { await api("/api/admin/logout", { method: "POST" }); state.admin = null; $("#detailDrawer").classList.remove("open"); renderAuth(); };
  $("#drawerClose").onclick = () => $("#detailDrawer").classList.remove("open");
  $("#refreshBtn").onclick = () => renderApp();
  $("#globalSearch").onchange = () => renderApp();
  $("#globalRange").onchange = () => {
    const custom = $("#globalRange").value === "custom";
    $("#customStart").hidden = !custom;
    $("#customEnd").hidden = !custom;
    renderApp();
  };
  $("#customStart").onchange = () => renderApp();
  $("#customEnd").onchange = () => renderApp();

  const boot = await api("/api/admin/auth/bootstrap-create").catch(() => ({ needs_bootstrap: false }));
  state.needsBootstrap = !!boot.needs_bootstrap;

  try {
    const me = await api("/api/admin/me");
    state.admin = me.data?.admin || me.admin;
  } catch { state.admin = null; }

  renderAuth();
}

document.addEventListener("DOMContentLoaded", () => init().catch((e) => toast(e.message, "error")));
