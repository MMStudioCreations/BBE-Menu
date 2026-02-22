const $ = (s, r = document) => r.querySelector(s);
const views = ["dashboard", "orders", "customers", "products", "verification"];
const state = { view: "dashboard", unlocked: false, selectedRow: "", drawer: { type: "", id: "", tab: "" }, data: {} };

const navItems = [
  ["dashboard", "Dashboard"],
  ["orders", "Orders"],
  ["customers", "Customers"],
  ["products", "Products"],
  ["verification", "Verification"],
];

function secret() { return sessionStorage.getItem("bb_admin_secret") || ""; }
function setSecret(v) { sessionStorage.setItem("bb_admin_secret", v); }
function money(c) { return c == null ? "—" : `$${(Number(c) / 100).toFixed(2)}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleString() : "—"; }

function toast(message, type = "ok") {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (secret()) headers["x-admin-secret"] = secret();
  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { error: res.ok ? "Unexpected response" : "Request failed" }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function buildNav() {
  const nav = $("#sidebarNav"); nav.innerHTML = "";
  navItems.forEach(([id, label]) => {
    const b = document.createElement("button");
    b.className = "btn" + (state.view === id ? " active" : "");
    b.textContent = label;
    b.disabled = !state.unlocked;
    b.onclick = () => { state.view = id; state.selectedRow = ""; renderView(); buildNav(); };
    nav.appendChild(b);
  });
}

function setLocked(locked) {
  state.unlocked = !locked;
  $("#unlockStatus").textContent = locked ? "Locked" : "Unlocked";
  $("#lockIndicator").textContent = locked ? "Locked" : "Unlocked";
  buildNav();
}

function clearDrawer() {
  const drawer = $("#drawer");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  $("#drawerTab").hidden = true;
  state.drawer = { type: "", id: "", tab: "" };
}
function openDrawer(title) {
  const drawer = $("#drawer");
  $("#drawerTitle").textContent = title;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function rowSkeleton(count = 6) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const d = document.createElement("div"); d.className = "skeleton"; frag.appendChild(d);
  }
  return frag;
}

function makeTable(columns, rows, onClick) {
  const wrap = document.createElement("div"); wrap.className = "table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead"); const trh = document.createElement("tr");
  columns.forEach((c) => { const th = document.createElement("th"); th.textContent = c; trh.appendChild(th); });
  thead.appendChild(trh);
  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    if (state.selectedRow === r.key) tr.classList.add("selected");
    r.cells.forEach((cell) => { const td = document.createElement("td"); if (cell instanceof HTMLElement) td.appendChild(cell); else td.textContent = String(cell ?? ""); tr.appendChild(td); });
    tr.onclick = () => { state.selectedRow = r.key; onClick?.(r); renderView(); };
    tbody.appendChild(tr);
  });
  table.append(thead, tbody); wrap.appendChild(table); return wrap;
}

async function renderDashboard(root) {
  root.innerHTML = ""; root.appendChild(rowSkeleton(5));
  const [dash, orders] = await Promise.all([api("/api/admin/dashboard"), api("/api/admin/orders?limit=1")]);
  root.innerHTML = "";
  const cards = document.createElement("div"); cards.className = "cards";
  const metrics = [
    ["Total Users", dash.metrics?.totalUsers || 0],
    ["Total Orders", orders.orders?.length ? "Live" : "0"],
    ["Orders (7d)", dash.metrics?.ordersLast7Days || 0],
    ["Pending Verification", dash.metrics?.pendingVerification || 0],
  ];
  metrics.forEach(([k, v]) => { const c = document.createElement("div"); c.className = "card"; c.append(Object.assign(document.createElement("div"), { textContent: k, className: "muted" }), Object.assign(document.createElement("h3"), { textContent: String(v) })); cards.appendChild(c); });
  const quick = document.createElement("div"); quick.className = "filters";
  ["orders", "customers", "products"].forEach((v) => { const b = document.createElement("button"); b.className = "btn"; b.textContent = `Go to ${v}`; b.onclick = () => { state.view = v; buildNav(); renderView(); }; quick.appendChild(b); });
  root.append(cards, quick);
}

function drawerTabs(tabs) {
  const wrap = document.createElement("div"); wrap.className = "tabs";
  tabs.forEach((t) => { const b = document.createElement("button"); b.className = "btn" + (state.drawer.tab === t ? " active" : ""); b.textContent = t; b.onclick = () => { state.drawer.tab = t; renderDrawer(); }; wrap.appendChild(b); });
  return wrap;
}

async function renderOrders(root) {
  root.innerHTML = "";
  const filters = document.createElement("div"); filters.className = "filters";
  filters.append(Object.assign(document.createElement("select"), { id: "ordStatus" }), Object.assign(document.createElement("select"), { id: "ordDate" }), Object.assign(document.createElement("label"), { textContent: "Guest only" }));
  const statusSel = filters.children[0]; ["all", "pending", "completed", "cancelled"].forEach((s) => { const o = document.createElement("option"); o.value = s; o.textContent = s; statusSel.appendChild(o); });
  const dateSel = filters.children[1]; [["", "Any"], ["today", "Today"], ["7", "7d"], ["30", "30d"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; dateSel.appendChild(o); });
  const guest = document.createElement("input"); guest.type = "checkbox"; filters.children[2].prepend(guest);
  root.append(filters); root.appendChild(rowSkeleton(6));

  const params = new URLSearchParams({ query: $("#globalSearch").value.trim(), status: statusSel.value, limit: "200" });
  if (dateSel.value) params.set("dateFrom", new Date(Date.now() - Number(dateSel.value === "today" ? 1 : dateSel.value) * 86400000).toISOString());
  const d = await api(`/api/admin/orders?${params.toString()}`);
  let orders = d.orders || [];
  if (guest.checked) orders = orders.filter((o) => !o.user_id);

  root.innerHTML = ""; root.appendChild(filters);
  const rows = orders.map((o) => ({ key: o.id, data: o, cells: [fmtDate(o.created_at), o.status, o.customer_email || o.customer_name || "Guest", money(o.subtotal_cents), money(o.total_cents), String(o.points_earned || 0), String(o.points_redeemed || 0)] }));
  root.appendChild(makeTable(["Date", "Status", "Customer", "Subtotal", "Total", "Points +", "Redeemed"], rows, (r) => openOrderDrawer(r.data.id)));
  filters.onchange = () => renderOrders(root);
}

async function openOrderDrawer(id) {
  state.drawer = { type: "order", id, tab: "Summary" }; openDrawer(`Order ${id}`); renderDrawer();
}

async function renderCustomers(root) {
  root.innerHTML = "";
  const f = document.createElement("div"); f.className = "filters";
  const status = document.createElement("select"); ["all", "pending", "approved", "denied"].forEach((v) => status.add(new Option(v, v)));
  const tier = document.createElement("select"); ["all", "member", "insider", "elite", "reserve"].forEach((v) => tier.add(new Option(v, v)));
  const active = document.createElement("select"); [["", "all"], ["1", "active"], ["0", "inactive"]].forEach(([v, t]) => active.add(new Option(t, v)));
  const tag = document.createElement("input"); tag.placeholder = "tag";
  f.append(status, tier, active, tag); root.append(f); root.appendChild(rowSkeleton(8));

  const qs = new URLSearchParams({ query: $("#globalSearch").value.trim(), status: status.value, tier: tier.value, active: active.value, tag: tag.value, limit: "200" });
  const d = await api(`/api/admin/customers?${qs.toString()}`);
  root.innerHTML = ""; root.append(f);
  const rows = (d.customers || []).map((u) => {
    const activeBadge = document.createElement("span"); activeBadge.className = `badge ${Number(u.is_active) === 1 ? "green" : "red"}`; activeBadge.textContent = Number(u.is_active) === 1 ? "Active" : "Deactivated";
    return { key: u.id, data: u, cells: [`${u.first_name || ""} ${u.last_name || ""}`.trim() || "—", u.email || "", u.phone || "", (() => { const b = document.createElement("span"); b.className = "badge tier"; b.textContent = u.effectiveTier || "member"; return b; })(), money(u.lifetime_spend_cents), String(u.points_balance || 0), activeBadge, (u.tags || "")] };
  });
  root.appendChild(makeTable(["Name", "Email", "Phone", "Tier", "Lifetime Spend", "Points", "Active", "Tags"], rows, (r) => openCustomerDrawer(r.data.id)));
  f.onchange = () => renderCustomers(root);
}

async function openCustomerDrawer(id) { state.drawer = { type: "customer", id, tab: "Profile" }; openDrawer("Customer"); renderDrawer(); }
async function openProductDrawer(id) { state.drawer = { type: "product", id, tab: "General" }; openDrawer("Product"); renderDrawer(); }

async function renderProducts(root) {
  root.innerHTML = "";
  const f = document.createElement("div"); f.className = "filters";
  const category = document.createElement("input"); category.placeholder = "category";
  const published = document.createElement("select"); [["", "All"], ["1", "Published"], ["0", "Unpublished"]].forEach(([v, t]) => published.add(new Option(t, v)));
  const gridToggle = document.createElement("button"); gridToggle.className = "btn"; gridToggle.textContent = "Grid/Table";
  const newBtn = document.createElement("button"); newBtn.className = "btn btn-gold"; newBtn.textContent = "New Product";
  f.append(category, published, gridToggle, newBtn); root.append(f); root.appendChild(rowSkeleton(8));

  const qs = new URLSearchParams({ query: $("#globalSearch").value.trim(), category: category.value, published: published.value, limit: "200" });
  const d = await api(`/api/admin/products?${qs.toString()}`);
  const rows = (d.products || []).map((p) => {
    const img = document.createElement("img"); img.src = p.image_path || ""; img.alt = p.name; img.width = 34; img.height = 34;
    const pub = document.createElement("span"); pub.className = `badge ${Number(p.is_published) ? "green" : "gray"}`; pub.textContent = Number(p.is_published) ? "Published" : "Unpublished";
    return { key: p.id, data: p, cells: [img, p.name, p.category || "", p.subcategory || "", pub, Number(p.is_featured) ? "Yes" : "No", fmtDate(p.updated_at)] };
  });

  root.innerHTML = ""; root.append(f, makeTable(["Image", "Name", "Category", "Subcategory", "Published", "Featured", "Updated"], rows, (r) => openProductDrawer(r.data.id)));
  f.onchange = () => renderProducts(root);
  newBtn.onclick = async () => {
    const name = prompt("Product name?"); if (!name) return;
    await api("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, brand: "Bobby Black Exclusive", category: "Flower", is_published: true }) });
    toast("Product created"); renderProducts(root);
  };
}

async function renderVerification(root) {
  root.innerHTML = ""; root.appendChild(rowSkeleton(6));
  const d = await api("/api/admin/verifications");
  const rows = (d.verifications || []).map((v) => ({ key: v.user_id, data: v, cells: [v.email || "", v.account_status || v.status || "pending", fmtDate(v.updated_at), `${v.id_key ? "id" : "-"}/${v.selfie_key ? "selfie" : "-"}`] }));
  root.innerHTML = "";
  root.appendChild(makeTable(["Customer", "Status", "Updated", "Files"], rows, (r) => { state.drawer = { type: "verification", id: r.data.user_id, tab: "Review" }; state.data.verification = r.data; openDrawer("Verification"); renderDrawer(); }));
}

async function renderDrawer() {
  const body = $("#drawerBody"); const actions = $("#drawerActions");
  body.innerHTML = ""; actions.innerHTML = "";
  body.appendChild(rowSkeleton(4));
  if (state.drawer.type === "order") {
    const d = await api(`/api/admin/orders/${state.drawer.id}`); const o = d.order || {};
    body.innerHTML = ""; body.appendChild(drawerTabs(["Summary", "Items", "Customer"]));
    const sec = document.createElement("div");
    if (state.drawer.tab === "Summary") sec.textContent = `Date: ${fmtDate(o.created_at)} | Status: ${o.status} | Subtotal: ${money(o.subtotal_cents)} | Total: ${money(o.total_cents)} | Points: +${o.points_earned || 0} / -${o.points_redeemed || 0}`;
    if (state.drawer.tab === "Customer") sec.textContent = `Name: ${o.customer_name || "—"}\nEmail: ${o.customer_email || "—"}\nPhone: ${o.customer_phone || "—"}\nUser ID: ${o.user_id || "guest"}`;
    if (state.drawer.tab === "Items") sec.textContent = String(o.cart_json || "No items payload.");
    sec.style.whiteSpace = "pre-wrap"; body.appendChild(sec);
    const status = document.createElement("select"); ["pending", "completed", "cancelled"].forEach((s) => status.add(new Option(s, s))); status.value = o.status || "pending";
    const save = document.createElement("button"); save.className = "btn btn-gold"; save.textContent = "Update Status";
    const copy = document.createElement("button"); copy.className = "btn"; copy.textContent = "Copy Summary";
    save.onclick = async () => { await api("/api/admin/orders-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: state.drawer.id, status: status.value }) }); toast("Order status updated"); };
    copy.onclick = async () => { await navigator.clipboard.writeText(sec.textContent || ""); toast("Copied order summary"); };
    actions.append(status, save, copy);
  }
  if (state.drawer.type === "customer") {
    const [d, t, orders] = await Promise.all([api(`/api/admin/customers/${state.drawer.id}`), api(`/api/admin/customers/${state.drawer.id}/tags`), api(`/api/admin/users/${state.drawer.id}/orders`)]);
    const c = d.customer || {};
    body.innerHTML = ""; body.appendChild(drawerTabs(["Profile", "Orders", "Rewards"]));
    const sec = document.createElement("div"); sec.style.whiteSpace = "pre-wrap";
    if (state.drawer.tab === "Profile") {
      const first = document.createElement("input"); first.value = c.first_name || "";
      const last = document.createElement("input"); last.value = c.last_name || "";
      const phone = document.createElement("input"); phone.value = c.phone || "";
      const tier = document.createElement("select"); [["", "No override"], ["member", "member"], ["insider", "insider"], ["elite", "elite"], ["reserve", "reserve"]].forEach(([v, tx]) => tier.add(new Option(tx, v)));
      tier.value = c.tier_override || "";
      const tagText = document.createElement("div"); tagText.textContent = `Tags: ${(t.tags || []).map((x) => x.tag).join(", ") || "none"}`;
      const addTag = document.createElement("input"); addTag.placeholder = "add tag";
      const points = document.createElement("input"); points.type = "number"; points.placeholder = "+/- points";
      const reason = document.createElement("input"); reason.placeholder = "reason";
      sec.append(first, last, phone, tier, tagText, addTag, points, reason);
      const save = document.createElement("button"); save.className = "btn btn-gold"; save.textContent = "Save";
      const deactivate = document.createElement("button"); deactivate.className = "btn"; deactivate.textContent = Number(c.is_active) ? "Deactivate" : "Reactivate";
      const del = document.createElement("button"); del.className = "btn"; del.textContent = "Hard Delete";
      save.onclick = async () => {
        await api(`/api/admin/customers/${state.drawer.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ first_name: first.value, last_name: last.value, phone: phone.value }) });
        await api(`/api/admin/customers/${state.drawer.id}/tier`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier_override: tier.value || null, reason: "Admin workspace update" }) });
        if (addTag.value.trim()) await api(`/api/admin/customers/${state.drawer.id}/tags`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tag: addTag.value.trim() }) });
        if (points.value && reason.value) await api(`/api/admin/customers/${state.drawer.id}/points-adjust`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points_delta: Number(points.value), reason: reason.value }) });
        toast("Customer updated");
      };
      deactivate.onclick = async () => { await api(`/api/admin/customers/${state.drawer.id}/${Number(c.is_active) ? "deactivate" : "reactivate"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Admin workspace" }) }); toast("Status changed"); renderDrawer(); };
      del.onclick = async () => { const email = prompt("Type customer email to confirm delete"); if (!email) return; await api(`/api/admin/customers/${state.drawer.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmEmail: email, anonymizeOrders: true }) }); toast("Customer deleted"); clearDrawer(); renderView(); };
      actions.append(save, deactivate, del);
    }
    if (state.drawer.tab === "Orders") {
      sec.textContent = (orders.orders || []).map((o) => `${o.id} • ${fmtDate(o.created_at)} • ${o.status} • ${money(o.total_cents)}`).join("\n") || "No orders";
    }
    if (state.drawer.tab === "Rewards") {
      sec.textContent = "Rewards ledger read endpoint not available in current API. Manual adjustments are shown after save operations.";
    }
    body.appendChild(sec);
  }
  if (state.drawer.type === "product") {
    const d = await api(`/api/admin/products/${state.drawer.id}`); const p = d.product || {}; const variants = d.variants || [];
    body.innerHTML = ""; body.appendChild(drawerTabs(["General", "Variants", "Inventory", "Visibility"]));
    const sec = document.createElement("div");
    const name = document.createElement("input"); name.value = p.name || "";
    const slug = document.createElement("input"); slug.value = p.slug || "";
    const category = document.createElement("input"); category.value = p.category || "";
    const subcategory = document.createElement("input"); subcategory.value = p.subcategory || "";
    const brand = document.createElement("input"); brand.value = p.brand || "";
    const image = document.createElement("input"); image.value = p.image_path || "";
    const img = document.createElement("img"); img.src = p.image_path || ""; img.width = 88;
    const desc = document.createElement("textarea"); desc.value = p.description || "";
    if (state.drawer.tab === "General") sec.append(name, slug, category, subcategory, brand, image, img, desc);
    if (state.drawer.tab === "Variants") sec.textContent = variants.map((v) => `${v.id} • ${v.label} • ${money(v.price_cents)} • inv ${v.inventory_qty}`).join("\n") || "No variants";
    if (state.drawer.tab === "Inventory") sec.textContent = variants.map((v) => `${v.label}: ${v.inventory_qty}`).join("\n") || "No inventory";
    if (state.drawer.tab === "Visibility") {
      const pub = document.createElement("label"); const c1 = document.createElement("input"); c1.type = "checkbox"; c1.checked = Number(p.is_published) === 1; pub.append(c1, " Published");
      const feat = document.createElement("label"); const c2 = document.createElement("input"); c2.type = "checkbox"; c2.checked = Number(p.is_featured) === 1; feat.append(c2, " Featured");
      sec.append(pub, feat);
    }
    sec.style.whiteSpace = "pre-wrap"; body.appendChild(sec);
    const save = document.createElement("button"); save.className = "btn btn-gold"; save.textContent = "Save / Update";
    const unpublish = document.createElement("button"); unpublish.className = "btn"; unpublish.textContent = "Unpublish";
    save.onclick = async () => {
      await api(`/api/admin/products/${state.drawer.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.value, slug: slug.value, category: category.value, subcategory: subcategory.value, brand: brand.value, image_path: image.value, description: desc.value, effects: p.effects || [], is_published: p.is_published, is_featured: p.is_featured }) });
      toast("Product saved"); renderView();
    };
    unpublish.onclick = async () => { await api(`/api/admin/products/${state.drawer.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...p, is_published: 0, effects: p.effects || [] }) }); toast("Unpublished"); renderView(); };
    actions.append(save, unpublish);
  }
  if (state.drawer.type === "verification") {
    const v = state.data.verification || {};
    body.innerHTML = "";
    const info = document.createElement("div"); info.style.whiteSpace = "pre-wrap";
    info.textContent = `Email: ${v.email || "—"}\nStatus: ${v.account_status || v.status || "pending"}\nUpdated: ${fmtDate(v.updated_at)}\nID Key: ${v.id_key || "—"}\nSelfie Key: ${v.selfie_key || "—"}`;
    body.appendChild(info);
    const approve = document.createElement("button"); approve.className = "btn btn-gold"; approve.textContent = "Approve";
    const deny = document.createElement("button"); deny.className = "btn"; deny.textContent = "Deny";
    approve.onclick = async () => { await api("/api/admin/verification-action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: v.user_id, action: "approve" }) }); toast("Approved"); renderView(); clearDrawer(); };
    deny.onclick = async () => { await api("/api/admin/verification-action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: v.user_id, action: "deny", reason: "Denied by admin" }) }); toast("Denied"); renderView(); clearDrawer(); };
    actions.append(approve, deny);
  }
}

async function renderView() {
  const root = $("#viewContent");
  if (!state.unlocked) {
    root.innerHTML = "";
    const card = document.createElement("div"); card.className = "card"; card.textContent = "Unlock to access admin tools."; root.appendChild(card);
    return;
  }
  try {
    if (state.view === "dashboard") await renderDashboard(root);
    if (state.view === "orders") await renderOrders(root);
    if (state.view === "customers") await renderCustomers(root);
    if (state.view === "products") await renderProducts(root);
    if (state.view === "verification") await renderVerification(root);
  } catch (e) {
    root.innerHTML = "";
    const err = document.createElement("div"); err.className = "card"; err.textContent = `Error: ${e.message}`; root.appendChild(err);
    toast(e.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  buildNav(); setLocked(true); renderView();
  $("#unlockBtn").onclick = async () => {
    try {
      const sec = $("#secret").value.trim();
      const res = await fetch("/api/admin/unlock", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: sec }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Unlock failed");
      setSecret(sec); setLocked(false); toast("Unlocked"); renderView();
    } catch (e) { setLocked(true); toast(e.message, "error"); }
  };
  $("#refreshBtn").onclick = () => renderView();
  $("#globalSearch").addEventListener("input", () => renderView());
  $("#drawerClose").onclick = clearDrawer;
  $("#drawerMinimize").onclick = () => { $("#drawer").classList.remove("open"); $("#drawerTab").hidden = false; };
  $("#drawerTab").onclick = () => { $("#drawer").classList.add("open"); $("#drawerTab").hidden = true; };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearDrawer();
    if (e.key === "/") { e.preventDefault(); $("#globalSearch").focus(); }
  });
});
