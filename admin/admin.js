const $ = (s) => document.querySelector(s);
const state = {
  admin: null,
  needsBootstrap: false,
  panel: "dashboard",
  views: [],
  products: {
    items: [],
    selectedId: null,
    form: null,
    filters: { query: "", category: "", featured: "" },
    saving: false,
    uploading: false,
  },
  orders: {
    items: [],
    selectedId: null,
    loading: false,
    error: "",
    filters: { query: "", status: "all", range: "7d" },
  },
  customers: {
    items: [],
    selectedId: null,
    loading: false,
    error: "",
    filters: { query: "", sort: "newest" },
  },
  verification: {
    items: [],
    selectedId: null,
    loading: false,
    error: "",
    filters: { query: "", status: "all" },
  },
};

const navItems = [["dashboard", "Dashboard"], ["csm", "CSM Dashboard"], ["orders", "Orders"], ["customers", "Customers"], ["products", "Products"], ["verification", "Verification"]];

const toast = (message, type = "ok") => {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  $("#toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 3000);
};

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "include", ...opts });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(res.ok ? "Unexpected server response" : "Server error – check logs"); }
  if (!res.ok) {
    const raw = String(data.error || data.msg || data.code || `Request failed (${res.status})`);
    if (/forbidden/i.test(raw)) throw new Error("You do not have access to this admin resource.");
    throw new Error(raw);
  }
  return data;
}

function money(cents) { return `$${(Number(cents || 0) / 100).toFixed(2)}`; }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function fmtDate(v) { return v ? new Date(v).toLocaleString() : "-"; }
function statusBadge(status = "") { const s = String(status || "").toLowerCase(); const tone = ["approved", "completed", "active"].includes(s) ? "green" : ["cancelled", "denied", "reject", "inactive"].includes(s) ? "red" : ""; return `<span class="badge ${tone}">${esc(status || "pending")}</span>`; }
function splitToolbar({ searchId, searchValue, searchPlaceholder, controls = "", refreshId }) { return `<div class="split-toolbar"><input id="${searchId}" type="search" placeholder="${esc(searchPlaceholder)}" value="${esc(searchValue)}" />${controls}<button id="${refreshId}" class="btn">Refresh</button></div>`; }
function stateBanner(loading, error, empty, retryId) {
  if (loading) return `<div class="card muted">Loading…</div>`;
  if (error) return `<div class="card error-card">Unable to load data. ${esc(error)} <button id="${retryId}" class="btn btn-small">Retry</button></div>`;
  if (empty) return `<div class="card muted">No records found.</div>`;
  return "";
}
function parseCartItems(cartJson) {
  if (!cartJson) return { items: [], error: "" };
  try {
    const parsed = typeof cartJson === "string" ? JSON.parse(cartJson) : cartJson;
    if (Array.isArray(parsed)) return { items: parsed, error: "" };
    if (parsed && Array.isArray(parsed.items)) return { items: parsed.items, error: "" };
    return { items: [], error: "" };
  } catch {
    return { items: [], error: "Unable to parse cart" };
  }
}

function setWorkspaceVisible(visible) {
  $(".sidebar").hidden = !visible;
  $("#workspace").hidden = !visible;
  $("#workspaceTopbar").hidden = !visible;
}

function isSuperAdminRole(role) { return role === "superadmin" || role === "super_admin" || role === "owner"; }

function openDrawer(title, obj) {
  $("#drawerTitle").textContent = title;
  $("#drawerBody").innerHTML = `<pre>${esc(JSON.stringify(obj, null, 2))}</pre>`;
  $("#detailDrawer").classList.add("open");
}

function normalizeProductForm(product = {}, variants = []) {
  return {
    id: product.id || null,
    slug: product.slug || "",
    name: product.name || "",
    brand: product.brand || "",
    category: product.category || "",
    type: product.subcategory || "",
    description: product.description || "",
    effectsInput: Array.isArray(product.effects) ? product.effects.join(", ") : "",
    is_featured: Number(product.is_featured || 0) ? 1 : 0,
    is_published: Number(product.is_published ?? 1) ? 1 : 0,
    image_url: product.image_url || "",
    image_key: product.image_key || "",
    image_path: product.image_path || "",
    variants: (variants || []).map((v, i) => ({ label: v.label || "", price_cents: Number(v.price_cents || 0), is_active: Number(v.is_active ?? 1), sort_order: Number(v.sort_order ?? i) })),
  };
}

async function loadProductsList() {
  const params = new URLSearchParams();
  if (state.products.filters.query) params.set("query", state.products.filters.query);
  if (state.products.filters.category) params.set("category", state.products.filters.category);
  if (state.products.filters.featured !== "") params.set("featured", state.products.filters.featured);
  const data = await api(`/api/admin/products?${params.toString()}`);
  state.products.items = data.products || [];
  if (!state.products.selectedId && state.products.items.length) state.products.selectedId = state.products.items[0].id;
  if (state.products.selectedId && !state.products.items.some((p) => p.id === state.products.selectedId)) state.products.selectedId = state.products.items[0]?.id || null;
}

async function loadSelectedProduct() {
  if (!state.products.selectedId) {
    state.products.form = normalizeProductForm();
    return;
  }
  const data = await api(`/api/admin/products/${state.products.selectedId}`);
  state.products.form = normalizeProductForm(data.product || {}, data.variants || []);
}

function productImagePreview(form) {
  const src = form.image_url || form.image_path || (form.image_key ? `/api/images/${encodeURIComponent(form.image_key)}` : "");
  return src ? `<img src="${esc(src)}" alt="Product image" class="product-image-preview" />` : `<div class="product-image-empty muted">No image uploaded</div>`;
}

function renderProductsPanelHtml() {
  const list = state.products.items;
  const categories = Array.from(new Set(list.map((p) => (p.category || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const form = state.products.form || normalizeProductForm();

  return `<div class="products-shell">
    <aside class="products-list panel">
      <div class="products-list-head">
        <h2>Products</h2>
        <button id="productsNewBtn" class="btn btn-gold">New Product</button>
      </div>
      <div class="products-filters">
        <input id="productsSearch" type="search" placeholder="Search products" value="${esc(state.products.filters.query)}" />
        <select id="productsCategoryFilter"><option value="">All categories</option>${categories.map((c) => `<option value="${esc(c)}" ${state.products.filters.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="productsFeaturedFilter">
          <option value="" ${state.products.filters.featured === "" ? "selected" : ""}>All</option>
          <option value="1" ${state.products.filters.featured === "1" ? "selected" : ""}>Featured</option>
          <option value="0" ${state.products.filters.featured === "0" ? "selected" : ""}>Not featured</option>
        </select>
      </div>
      <div class="products-list-scroll">${list.map((p) => `<button class="product-list-item ${state.products.selectedId === p.id ? "active" : ""}" data-product-id="${p.id}"><strong>${esc(p.name || "Untitled")}</strong><span class="muted">${esc(p.category || "Uncategorized")}</span></button>`).join("") || '<div class="muted">No products found.</div>'}</div>
    </aside>
    <section class="products-editor panel">
      <div class="products-editor-head"><h3>${form.id ? `Edit: ${esc(form.name || "Product")}` : "Create Product"}</h3><span id="productsStatus" class="muted"></span></div>
      <div class="product-form-grid">
        <label>Name<input id="pName" value="${esc(form.name)}" /></label>
        <label>Slug<input id="pSlug" value="${esc(form.slug)}" placeholder="auto-from-name" /></label>
        <label>Brand<input id="pBrand" value="${esc(form.brand)}" /></label>
        <label>Category<input id="pCategory" value="${esc(form.category)}" placeholder="Flower" /></label>
        <label>Type<input id="pType" value="${esc(form.type)}" placeholder="Indoor / Resin / Accessory" /></label>
        <label>Effects (comma separated)<input id="pEffects" value="${esc(form.effectsInput)}" placeholder="relaxed, creative" /></label>
        <label class="span-2">Description<textarea id="pDescription" rows="4">${esc(form.description)}</textarea></label>
      </div>
      <div class="products-inline-toggles">
        <label><input id="pPublished" type="checkbox" ${form.is_published ? "checked" : ""}/> Published</label>
        <label><input id="pFeatured" type="checkbox" ${form.is_featured ? "checked" : ""}/> Featured</label>
      </div>
      <div class="product-image-card"><div>${productImagePreview(form)}</div><div class="products-image-actions"><input id="productImageFile" type="file" accept="image/*" /><button id="productsUploadImageBtn" class="btn" ${state.products.uploading ? "disabled" : ""}>${state.products.uploading ? "Uploading..." : "Upload Image"}</button></div></div>
      <h4>Sizes / Prices</h4>
      <div id="variantsWrap">${(form.variants || []).map((v, i) => `<div class="variant-row" data-variant-index="${i}"><input class="v-label" placeholder="Size label" value="${esc(v.label)}" /><input class="v-price" type="number" min="0" step="0.01" value="${(Number(v.price_cents || 0) / 100).toFixed(2)}" /><label><input class="v-active" type="checkbox" ${Number(v.is_active ?? 1) ? "checked" : ""}/> Active</label><button class="btn btn-small variant-remove" data-variant-index="${i}">Remove</button></div>`).join("")}</div>
      <button id="addVariantBtn" class="btn btn-small">Add Size</button>
      <div class="products-editor-actions"><button id="productsDeleteBtn" class="btn" ${form.id ? "" : "disabled"}>Unpublish</button><button id="productsSaveBtn" class="btn btn-gold" ${state.products.saving ? "disabled" : ""}>${state.products.saving ? "Saving..." : "Save"}</button></div>
    </section>
  </div>`;
}

async function renderProductsPanel() {
  await loadProductsList();
  await loadSelectedProduct();
  $("#workspace").innerHTML = renderProductsPanelHtml();
  bindProductsEvents();
}

function collectProductFormFromDom() {
  const form = state.products.form || normalizeProductForm();
  const variants = Array.from(document.querySelectorAll("#variantsWrap .variant-row")).map((row, i) => ({
    label: row.querySelector(".v-label").value.trim(),
    price_cents: Math.round(Number(row.querySelector(".v-price").value || 0) * 100),
    is_active: row.querySelector(".v-active").checked ? 1 : 0,
    sort_order: i,
  })).filter((v) => v.label);
  return {
    ...form,
    name: $("#pName").value.trim(),
    slug: $("#pSlug").value.trim(),
    brand: $("#pBrand").value.trim(),
    category: $("#pCategory").value.trim(),
    subcategory: $("#pType").value.trim(),
    description: $("#pDescription").value.trim(),
    effects: $("#pEffects").value.split(",").map((x) => x.trim()).filter(Boolean),
    is_published: $("#pPublished").checked ? 1 : 0,
    is_featured: $("#pFeatured").checked ? 1 : 0,
    variants,
  };
}

async function saveProduct() {
  const payload = collectProductFormFromDom();
  if (!payload.name || !payload.category) {
    toast("Name and category are required.", "error");
    return;
  }
  state.products.saving = true;
  $("#productsStatus").textContent = "Saving...";
  try {
    let response;
    if (payload.id) {
      response = await api(`/api/admin/products/${payload.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      response = await api("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      state.products.selectedId = response.product?.id || null;
    }
    toast("Product saved.");
    await renderProductsPanel();
  } catch (e) {
    toast(e.message, "error");
    $("#productsStatus").textContent = e.message;
  } finally {
    state.products.saving = false;
  }
}

async function uploadProductImage() {
  const fileInput = $("#productImageFile");
  if (!fileInput?.files?.length) return toast("Choose an image file first.", "error");
  let form = collectProductFormFromDom();

  if (!form.id) {
    await saveProduct();
    if (!state.products.selectedId) return;
    await loadSelectedProduct();
    form = state.products.form;
  }

  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("product_id", form.id);

  state.products.uploading = true;
  try {
    const res = await fetch("/api/admin/products/upload-image", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const text = await res.text();
    let d = {};
    try {
      d = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(res.ok ? "Unexpected server response" : "Upload failed: invalid server response");
    }
    if (!res.ok) {
      throw new Error(String(d.error || d.msg || `Upload failed (${res.status})`));
    }

    state.products.form.image_key = d.key || "";
    state.products.form.image_url = d.url || "";
    state.products.form.image_path = d.url || "";
    await saveProduct();
    toast("Image uploaded and product updated.");
  } catch (e) {
    toast(e?.message || "Image upload failed.", "error");
  } finally {
    state.products.uploading = false;
  }
}

function bindProductsEvents() {
  document.querySelectorAll(".product-list-item").forEach((row) => row.onclick = async () => {
    state.products.selectedId = row.dataset.productId;
    await renderProductsPanel();
  });

  $("#productsNewBtn").onclick = async () => { state.products.selectedId = null; state.products.form = normalizeProductForm(); $("#workspace").innerHTML = renderProductsPanelHtml(); bindProductsEvents(); };
  $("#productsSearch").onchange = async (e) => { state.products.filters.query = e.target.value.trim(); await renderProductsPanel(); };
  $("#productsCategoryFilter").onchange = async (e) => { state.products.filters.category = e.target.value; await renderProductsPanel(); };
  $("#productsFeaturedFilter").onchange = async (e) => { state.products.filters.featured = e.target.value; await renderProductsPanel(); };

  $("#productsSaveBtn").onclick = async () => saveProduct();
  $("#productsUploadImageBtn").onclick = async () => uploadProductImage();
  $("#addVariantBtn").onclick = () => {
    const wrap = $("#variantsWrap");
    const idx = wrap.querySelectorAll(".variant-row").length;
    wrap.insertAdjacentHTML("beforeend", `<div class="variant-row" data-variant-index="${idx}"><input class="v-label" placeholder="Size label" /><input class="v-price" type="number" min="0" step="0.01" value="0.00" /><label><input class="v-active" type="checkbox" checked /> Active</label><button class="btn btn-small variant-remove" data-variant-index="${idx}">Remove</button></div>`);
    bindProductsEvents();
  };
  document.querySelectorAll(".variant-remove").forEach((btn) => btn.onclick = (e) => { e.preventDefault(); btn.closest(".variant-row").remove(); });

  const del = $("#productsDeleteBtn");
  if (del) del.onclick = async () => {
    if (!state.products.form?.id) return;
    await api(`/api/admin/products/${state.products.form.id}`, { method: "DELETE" });
    toast("Product unpublished.");
    state.products.selectedId = null;
    await renderProductsPanel();
  };
}

function renderSetPassword() { /* unchanged auth views */
  const root = $("#authView");
  setWorkspaceVisible(false);
  root.hidden = false;
  root.innerHTML = `<div class="card"><h3>Set New Password</h3><p class="muted">You must change your temporary password before continuing.</p><input id="newAdminPassword" placeholder="New password" type="password" /><input id="confirmAdminPassword" placeholder="Confirm new password" type="password" /><div id="passwordStatus" class="muted" style="min-height:18px;margin:8px 0 0;"></div><button id="setPasswordBtn" class="btn btn-gold">Update Password</button></div>`;
  $("#setPasswordBtn").onclick = async () => {
    const status = $("#passwordStatus");
    status.textContent = "";
    const next = $("#newAdminPassword").value || "";
    const confirm = $("#confirmAdminPassword").value || "";
    if (next.length < 8) { status.textContent = "Password must be at least 8 characters."; return; }
    if (next !== confirm) { status.textContent = "Passwords do not match."; return; }
    try {
      await api("/api/admin/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword: next }) });
      const me = await api("/api/admin/me");
      state.admin = me.data?.admin || me.admin;
      renderAuth();
    } catch (e) { status.textContent = e.message; toast(e.message, "error"); }
  };
}

function renderAuth() {
  const root = $("#authView");
  if (state.admin && state.admin.mustChangePassword) return renderSetPassword();
  if (state.admin) { root.hidden = true; setWorkspaceVisible(true); $("#adminIdentity").textContent = `${state.admin.name || state.admin.email || state.admin.username} (${state.admin.role})`; return renderApp(); }

  setWorkspaceVisible(false);
  root.hidden = false;
  root.innerHTML = `<div class="card"><h3>Admin Login</h3><input id="loginUsername" placeholder="Email" /><input id="loginSecret" placeholder="Secret" type="password" /><div id="loginStatus" class="muted" style="min-height:18px;margin:8px 0 0;"></div><button id="loginBtn" class="btn btn-gold">Login</button></div>
  <div class="card" ${state.needsBootstrap ? "" : "hidden"}><h3>Bootstrap Super Admin</h3><input id="bootSecret" placeholder="Bootstrap secret" type="password" /><input id="bootEmail" placeholder="Owner email" /><input id="bootName" placeholder="Owner name" /><input id="bootPassword" placeholder="Password" type="password" /><button id="bootBtn" class="btn btn-gold">Bootstrap</button></div>`;
  $("#loginBtn").onclick = async () => {
    const status = $("#loginStatus");
    status.textContent = "";
    try {
      const d = await api("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: $("#loginUsername").value, password: $("#loginSecret").value }) });
      state.admin = d.data?.admin || d.admin;
      renderAuth();
    } catch (e) { status.textContent = e.message; toast(e.message, "error"); }
  };
  if (state.needsBootstrap) $("#bootBtn").onclick = async () => { try { await api("/api/admin/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: $("#bootSecret").value, email: $("#bootEmail").value, name: $("#bootName").value, password: $("#bootPassword").value }) }); toast("Super admin bootstrapped."); } catch (e) { toast(e.message, "error"); } };
}

function renderNav() {
  const items = [...navItems];
  if (isSuperAdminRole(state.admin?.role)) items.push(["admin-users", "Admin Users"]);
  $("#sideNav").innerHTML = items.map(([k, label]) => `<button class="btn nav-btn ${state.panel === k ? "active" : ""}" data-panel="${k}">${label}</button>`).join("");
  document.querySelectorAll(".nav-btn").forEach((b) => b.onclick = () => { state.panel = b.dataset.panel; renderApp(); });
}

async function panelDashboard() { const range = $("#globalRange").value; const q = new URLSearchParams({ range }); if (range === "custom") { q.set("start", $("#customStart").value); q.set("end", $("#customEnd").value); } const d = await api(`/api/admin/dashboard?${q.toString()}`); const m = d.metrics || {}; return `<div class="dashboard-controls"><h2>Dashboard</h2><span class="muted">${esc(d.range.start)} → ${esc(d.range.end)}</span></div><div class="cards"><div class="card"><div class="muted">Revenue (Completed)</div><h3>${money(m.revenue_completed_cents)}</h3></div><div class="card"><div class="muted">Pending</div><h3>${money(m.pending_cents)}</h3></div><div class="card"><div class="muted">Cancelled</div><h3>${money(m.cancelled_cents)}</h3></div><div class="card"><div class="muted">AOV (Completed)</div><h3>${money(m.aov_completed_cents)}</h3></div></div>`; }
async function panelCsm() { const [dashboard, totalUsers, activeUsers, pendingVerification] = await Promise.all([api(`/api/admin/dashboard?range=7d`), api(`/api/admin/customers?limit=1`).catch(() => ({ customers: [] })), api(`/api/admin/customers?active=1&limit=1`).catch(() => ({ customers: [] })), api(`/api/admin/verification/pending`).catch(() => ({ users: [] }))]); const m = dashboard.metrics || {}; return `<div class="dashboard-controls"><h2>CSM Dashboard</h2><span class="muted">Customer lifecycle summary</span></div><div class="cards"><div class="card"><div class="muted">Total Users</div><h3>${Number(dashboard.totalUsers || totalUsers.customers?.length || 0)}</h3></div><div class="card"><div class="muted">Active Users</div><h3>${Number(dashboard.activeUsers || activeUsers.customers?.length || 0)}</h3></div><div class="card"><div class="muted">Orders (7d)</div><h3>${Number(dashboard.ordersLast7Days || m.orders_completed_count || 0)}</h3></div><div class="card"><div class="muted">Pending Verification</div><h3>${Number(dashboard.pendingVerification || pendingVerification.users?.length || 0)}</h3></div></div>`; }
async function loadOrders() {
  state.orders.loading = true; state.orders.error = "";
  const params = new URLSearchParams();
  if (state.orders.filters.status && state.orders.filters.status !== "all") params.set("status", state.orders.filters.status);
  if (state.orders.filters.query) params.set("query", state.orders.filters.query);
  const rangeMap = { "7d": 7, "30d": 30, "90d": 90 };
  const days = rangeMap[state.orders.filters.range] || 7;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  params.set("dateFrom", from);
  try {
    const d = await api(`/api/admin/orders?${params.toString()}`);
    state.orders.items = d.orders || [];
    if (!state.orders.selectedId && state.orders.items.length) state.orders.selectedId = state.orders.items[0].id;
    if (state.orders.selectedId && !state.orders.items.some((o) => o.id === state.orders.selectedId)) state.orders.selectedId = state.orders.items[0]?.id || null;
  } catch (e) { state.orders.error = e.message; state.orders.items = []; }
  finally { state.orders.loading = false; }
}
function renderOrderDetail(order) {
  if (!order) return `<div class="card muted">Select an order to view details.</div>`;
  const customerName = [order.customer_name, order.first_name, order.last_name].filter(Boolean).join(" ").trim();
  const parsed = parseCartItems(order.cart_json);
  return `<div class="detail-head"><h3>Order ${esc(order.id)}</h3>${statusBadge(order.status)}</div>
    <section class="detail-section"><h4>Summary</h4><div class="kv-grid"><div><span class="muted">Order ID</span><strong>${esc(order.id)}</strong></div><div><span class="muted">Created</span><strong>${esc(fmtDate(order.created_at))}</strong></div></div></section>
    <section class="detail-section"><h4>Financials</h4><div class="kv-grid"><div><span class="muted">Subtotal</span><strong>${money(order.subtotal_cents)}</strong></div><div><span class="muted">Tax</span><strong>${money(order.tax_cents)}</strong></div><div><span class="muted">Total</span><strong>${money(order.total_cents)}</strong></div><div><span class="muted">Points earned</span><strong>${Number(order.points_earned || 0)}</strong></div><div><span class="muted">Points redeemed</span><strong>${Number(order.points_redeemed || 0)}</strong></div><div><span class="muted">Credit used</span><strong>${money(order.credit_cents_used)}</strong></div></div></section>
    <section class="detail-section"><h4>Customer</h4><div class="kv-grid"><div><span class="muted">Name</span><strong>${esc(customerName || "-")}</strong></div><div><span class="muted">Email</span><strong>${esc(order.customer_email || "-")}</strong></div><div><span class="muted">Phone</span><strong>${esc(order.customer_phone || "-")}</strong></div></div></section>
    <section class="detail-section"><h4>Delivery</h4><div class="kv-grid"><div><span class="muted">Method</span><strong>${esc(order.delivery_method || "-")}</strong></div><div><span class="muted">Address</span><strong>${esc(order.address_json || "-")}</strong></div></div></section>
    <section class="detail-section"><h4>Items</h4>${parsed.error ? `<div class="muted">${parsed.error}</div>` : `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Variant</th><th>Qty</th><th>Price</th></tr></thead><tbody>${(parsed.items || []).map((it) => `<tr><td>${esc(it.name || it.title || "-")}</td><td>${esc(it.variant || it.size || it.label || "-")}</td><td>${Number(it.qty || it.quantity || 0)}</td><td>${money(it.price_cents ?? Math.round(Number(it.price || 0) * 100))}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No items found.</td></tr>`}</tbody></table></div>`}</section>
    <section class="detail-section"><h4>Status</h4><div class="kv-grid"><select id="orderStatusSelect"><option value="pending" ${String(order.status).toLowerCase()==='pending'?'selected':''}>pending</option><option value="placed" ${String(order.status).toLowerCase()==='placed'?'selected':''}>placed</option><option value="processing" ${String(order.status).toLowerCase()==='processing'?'selected':''}>processing</option><option value="completed" ${String(order.status).toLowerCase()==='completed'?'selected':''}>completed</option><option value="cancelled" ${String(order.status).toLowerCase()==='cancelled'?'selected':''}>cancelled</option></select></div><div class="detail-actions"><button id="saveOrderStatusBtn" class="btn btn-gold" data-order-id="${esc(order.id)}">Save status</button></div></section>
    ${isSuperAdminRole(state.admin?.role) ? `<section class="detail-section"><h4>Rewards override</h4><div class="kv-grid"><label><span class="muted">Points earned</span><input id="orderPointsEarned" type="number" value="${Number(order.points_earned || 0)}" /></label><label><span class="muted">Points redeemed</span><input id="orderPointsRedeemed" type="number" value="${Number(order.points_redeemed || 0)}" /></label><label><span class="muted">Credit cents used</span><input id="orderCreditUsed" type="number" value="${Number(order.credit_cents_used || 0)}" /></label></div><label><span class="muted">Notes</span><input id="orderRewardsNotes" value="" /></label><div class="detail-actions"><button id="saveOrderRewardsOverrideBtn" class="btn" data-order-id="${esc(order.id)}">Save rewards override</button></div></section>` : ""}`;
}
async function panelOrders() {
  await loadOrders();
  const statuses = Array.from(new Set(state.orders.items.map((o) => String(o.status || "pending").toLowerCase()))).sort();
  const list = state.orders.items.filter((o) => {
    const q = state.orders.filters.query.toLowerCase();
    if (!q) return true;
    return String(o.id || "").toLowerCase().includes(q) || String(o.customer_email || "").toLowerCase().includes(q);
  });
  const selected = list.find((o) => o.id === state.orders.selectedId) || null;
  return `<div class="split-shell">
    ${splitToolbar({ searchId: "ordersSearch", searchValue: state.orders.filters.query, searchPlaceholder: "Search by order ID or email", controls: `<select id="ordersStatusFilter"><option value="all">All statuses</option>${statuses.map((s) => `<option value="${esc(s)}" ${state.orders.filters.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select><select id="ordersRangeFilter"><option value="7d" ${state.orders.filters.range === "7d" ? "selected" : ""}>7 days</option><option value="30d" ${state.orders.filters.range === "30d" ? "selected" : ""}>30 days</option><option value="90d" ${state.orders.filters.range === "90d" ? "selected" : ""}>90 days</option></select>`, refreshId: "ordersRefreshBtn" })}
    ${stateBanner(state.orders.loading, state.orders.error, !list.length, "ordersRetryBtn")}
    <div class="split-content"><aside class="split-list panel">${list.map((o) => `<button class="split-row order-row ${state.orders.selectedId === o.id ? "active" : ""}" data-id="${o.id}"><div><strong>${esc(o.id.slice(0, 8))}</strong> ${statusBadge(o.status)}</div><div class="muted">${esc(fmtDate(o.created_at))}</div><div>${money(o.total_cents)} · ${esc(o.customer_email || o.customer_name || "-")}</div></button>`).join("")}</aside><section class="split-detail panel">${renderOrderDetail(selected)}</section></div>
  </div>`;
}
async function loadCustomers() {
  state.customers.loading = true; state.customers.error = "";
  try {
    const d = await api(`/api/admin/customers`);
    const all = d.customers || [];
    const q = state.customers.filters.query.toLowerCase();
    state.customers.items = all.filter((c) => !q || String(c.email || "").toLowerCase().includes(q) || `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase().includes(q));
    if (state.customers.filters.sort === "lifetime") state.customers.items.sort((a, b) => Number(b.lifetime_spend_cents || 0) - Number(a.lifetime_spend_cents || 0));
    if (!state.customers.selectedId && state.customers.items.length) state.customers.selectedId = state.customers.items[0].id;
    if (state.customers.selectedId && !state.customers.items.some((c) => c.id === state.customers.selectedId)) state.customers.selectedId = state.customers.items[0]?.id || null;
  } catch (e) { state.customers.error = e.message; state.customers.items = []; }
  finally { state.customers.loading = false; }
}
async function panelCustomers() {
  await loadCustomers();
  const selected = state.customers.items.find((c) => c.id === state.customers.selectedId);
  let detail = `<div class="card muted">Select a customer to view details.</div>`;
  if (selected) {
    const data = await api(`/api/admin/customers/${selected.id}`).catch(() => null);
    const c = data?.customer || selected;
    const tags = Array.isArray(data?.tags) ? data.tags : (Array.isArray(c.tags) ? c.tags : []);
    detail = `<div class="detail-head"><h3>${esc(c.email || "Customer")}</h3>${statusBadge(c.account_status)}</div>
      <section class="detail-section"><h4>Profile</h4>
        <div class="kv-grid"><label><span class="muted">Email</span><input id="customerEmail" value="${esc(c.email || "")}" /></label><label><span class="muted">First name</span><input id="customerFirstName" value="${esc(c.first_name || "")}" /></label><label><span class="muted">Last name</span><input id="customerLastName" value="${esc(c.last_name || "")}" /></label><label><span class="muted">Phone</span><input id="customerPhone" value="${esc(c.phone || "")}" /></label></div>
        <div class="detail-actions"><button id="saveCustomerProfileBtn" class="btn btn-gold" data-id="${esc(c.id)}">Save profile</button></div>
      </section>
      <section class="detail-section"><h4>Spend & loyalty</h4><div class="kv-grid"><div><span class="muted">Lifetime spend</span><strong>${money(c.lifetime_spend_cents)}</strong></div><div><span class="muted">Annual spend</span><strong>${money(c.annual_spend_cents || 0)}</strong></div><div><span class="muted">Orders</span><strong>${Number(c.orders_count || 0)}</strong></div><div><span class="muted">Points balance</span><strong>${Number(c.points_balance || 0)}</strong></div><div><span class="muted">Tier</span><strong>${esc(c.tier_code || c.effectiveTier || "member")}</strong></div></div></section>
      <section class="detail-section"><h4>Tags & points</h4><label><span class="muted">Tags (comma separated)</span><input id="customerTagsInput" value="${esc(tags.join(", "))}" /></label><div class="kv-grid"><label><span class="muted">Adjust points</span><input id="customerDeltaPoints" type="number" step="1" value="0" /></label><label><span class="muted">Reason</span><input id="customerPointsReason" value="Manual adjustment" /></label></div><div class="detail-actions"><button id="saveCustomerTagsBtn" class="btn" data-id="${esc(c.id)}">Save tags</button><button id="adjustCustomerPointsBtn" class="btn" data-id="${esc(c.id)}">Adjust points</button></div></section>
      ${isSuperAdminRole(state.admin?.role) ? `<section class="detail-section"><h4>Tier override</h4><div class="kv-grid"><select id="customerTierOverride"><option value="">Auto</option><option value="member">member</option><option value="insider">insider</option><option value="elite">elite</option><option value="black_reserve">black_reserve</option></select></div><div class="detail-actions"><button id="saveTierOverrideBtn" class="btn" data-id="${esc(c.id)}">Save tier override</button><button id="deleteCustomerBtn" class="btn danger" data-id="${esc(c.id)}">Delete account</button></div></section>` : ""}`;
  }
  return `<div class="split-shell">${splitToolbar({ searchId: "customersSearch", searchValue: state.customers.filters.query, searchPlaceholder: "Search by email or name", controls: `<select id="customersSort"><option value="newest" ${state.customers.filters.sort === "newest" ? "selected" : ""}>Newest</option><option value="lifetime" ${state.customers.filters.sort === "lifetime" ? "selected" : ""}>Lifetime spend</option></select>`, refreshId: "customersRefreshBtn" })}${stateBanner(state.customers.loading, state.customers.error, !state.customers.items.length, "customersRetryBtn")}<div class="split-content"><aside class="split-list panel">${state.customers.items.map((c) => `<button class="split-row customer-row ${state.customers.selectedId === c.id ? "active" : ""}" data-id="${c.id}"><strong>${esc(c.email || "-")}</strong><div class="muted">Spend ${money(c.lifetime_spend_cents)} · Orders ${Number(c.orders_count || 0)}</div><div>Points ${Number(c.points_balance || 0)}</div></button>`).join("")}</aside><section class="split-detail panel">${detail}</section></div></div>`;
}
async function loadVerification() {
  state.verification.loading = true; state.verification.error = "";
  try {
    const d = await api(`/api/admin/verifications`);
    const q = state.verification.filters.query.toLowerCase();
    state.verification.items = (d.verifications || []).filter((u) => {
      const status = String(u.account_status || "pending").toLowerCase();
      const statusMatch = state.verification.filters.status === "all" || status === state.verification.filters.status;
      const qMatch = !q || `${u.email || ""} ${u.first_name || ""} ${u.last_name || ""}`.toLowerCase().includes(q);
      return statusMatch && qMatch;
    });
    if (!state.verification.selectedId && state.verification.items.length) state.verification.selectedId = state.verification.items[0].user_id;
    if (state.verification.selectedId && !state.verification.items.some((v) => v.user_id === state.verification.selectedId)) state.verification.selectedId = state.verification.items[0]?.user_id || null;
  } catch (e) { state.verification.error = e.message; state.verification.items = []; }
  finally { state.verification.loading = false; }
}
async function panelVerification() {
  await loadVerification();
  const selected = state.verification.items.find((v) => v.user_id === state.verification.selectedId);
  const statuses = Array.from(new Set(state.verification.items.map((v) => String(v.account_status || "pending").toLowerCase())));
  const fields = selected ? Object.entries(selected).filter(([k]) => !["user_id", "email", "first_name", "last_name", "account_status", "updated_at", "created_at", "phone", "status_reason"].includes(k)) : [];
  const detail = selected ? `<div class="detail-head"><h3>${esc(`${selected.first_name || ""} ${selected.last_name || ""}`.trim() || selected.email || "Applicant")}</h3>${statusBadge(selected.account_status || "pending")}</div><section class="detail-section"><h4>Applicant</h4><div class="kv-grid"><div><span class="muted">Name</span><strong>${esc(`${selected.first_name || ""} ${selected.last_name || ""}`.trim() || "-")}</strong></div><div><span class="muted">Email</span><strong>${esc(selected.email || "-")}</strong></div><div><span class="muted">Phone</span><strong>${esc(selected.phone || "-")}</strong></div></div></section><section class="detail-section"><h4>Submission</h4><div class="kv-grid"><div><span class="muted">Submitted</span><strong>${esc(fmtDate(selected.updated_at || selected.created_at))}</strong></div><div><span class="muted">Notes</span><strong>${esc(selected.status_reason || "-")}</strong></div></div></section>${fields.length ? `<section class="detail-section"><h4>Stored fields</h4><div class="kv-list">${fields.map(([k, v]) => `<div><span class="muted">${esc(k)}</span><strong>${esc(v ?? "-")}</strong></div>`).join("")}</div></section>` : ""}<div class="detail-actions"><button id="verificationApproveBtn" class="btn btn-gold" data-id="${esc(selected.user_id)}">Approve</button><button id="verificationDenyBtn" class="btn danger" data-id="${esc(selected.user_id)}">Deny</button></div>` : `<div class="card muted">Select an application to view details.</div>`;
  return `<div class="split-shell">${splitToolbar({ searchId: "verificationSearch", searchValue: state.verification.filters.query, searchPlaceholder: "Search applicant", controls: `<select id="verificationStatus"><option value="all">All statuses</option>${statuses.map((s) => `<option value="${esc(s)}" ${state.verification.filters.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>`, refreshId: "verificationRefreshBtn" })}${stateBanner(state.verification.loading, state.verification.error, !state.verification.items.length, "verificationRetryBtn")}<div class="split-content"><aside class="split-list panel">${state.verification.items.map((u) => `<button class="split-row verification-row ${state.verification.selectedId === u.user_id ? "active" : ""}" data-id="${u.user_id}"><strong>${esc(`${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email || "-")}</strong><div>${esc(u.email || "-")}</div><div class="muted">${esc(fmtDate(u.updated_at || u.created_at))} · ${statusBadge(u.account_status || "pending")}</div></button>`).join("")}</aside><section class="split-detail panel">${detail}</section></div></div>`;
}
async function panelAdminUsers() { const d = await api("/api/admin/users"); const admins = d.admins || []; return `<div style='display:flex;justify-content:space-between;align-items:center;'><h2>Admin Users</h2><button id='newAdminBtn' class='btn btn-gold'>Create Admin</button></div><div class='table-wrap'><table><thead><tr><th>Email</th><th>Active</th><th>Role</th><th>Must Change Password</th><th>Password Updated</th></tr></thead><tbody>${admins.map((a) => `<tr><td>${esc(a.email)}</td><td>${Number(a.is_active) ? "Yes" : "No"}</td><td>${esc(a.role || "admin")}</td><td>${Number(a.must_change_password) ? "Yes" : "No"}</td><td>${esc(a.password_updated_at || "")}</td></tr>`).join("")}</tbody></table></div>`; }

async function renderApp() {
  renderNav();
  const root = $("#workspace");
  root.innerHTML = `<div class='skeleton'></div><div class='skeleton'></div>`;
  try {
    if (state.panel === "products") return renderProductsPanel();
    const panels = { dashboard: panelDashboard, csm: panelCsm, orders: panelOrders, customers: panelCustomers, verification: panelVerification, "admin-users": panelAdminUsers };
    root.innerHTML = await (panels[state.panel] || panelDashboard)();
    bindPanelEvents();
  } catch (e) { root.innerHTML = `<div class='card error-card'>${esc(e.message)}</div>`; }
}

function bindPanelEvents() {
  document.querySelectorAll(".order-row").forEach((r) => r.onclick = async () => { state.orders.selectedId = r.dataset.id; await renderApp(); });
  document.querySelectorAll(".customer-row").forEach((r) => r.onclick = async () => { state.customers.selectedId = r.dataset.id; await renderApp(); });
  document.querySelectorAll(".verification-row").forEach((r) => r.onclick = async () => { state.verification.selectedId = r.dataset.id; await renderApp(); });

  const wire = (id, handler) => { const el = $(id); if (el) el.onchange = handler; };
  wire("#ordersSearch", async (e) => { state.orders.filters.query = e.target.value.trim(); await renderApp(); });
  wire("#ordersStatusFilter", async (e) => { state.orders.filters.status = e.target.value; await renderApp(); });
  wire("#ordersRangeFilter", async (e) => { state.orders.filters.range = e.target.value; await renderApp(); });
  wire("#customersSearch", async (e) => { state.customers.filters.query = e.target.value.trim(); await renderApp(); });
  wire("#customersSort", async (e) => { state.customers.filters.sort = e.target.value; await renderApp(); });
  wire("#verificationSearch", async (e) => { state.verification.filters.query = e.target.value.trim(); await renderApp(); });
  wire("#verificationStatus", async (e) => { state.verification.filters.status = e.target.value; await renderApp(); });

  ["#ordersRefreshBtn", "#customersRefreshBtn", "#verificationRefreshBtn", "#ordersRetryBtn", "#customersRetryBtn", "#verificationRetryBtn"].forEach((id) => {
    const el = $(id);
    if (el) el.onclick = () => renderApp();
  });

  const saveOrderStatus = $("#saveOrderStatusBtn");
  if (saveOrderStatus) saveOrderStatus.onclick = async () => {
    const status = $("#orderStatusSelect")?.value;
    await api(`/api/admin/orders/${saveOrderStatus.dataset.orderId}/status`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    toast("Order status updated.");
    await renderApp();
  };

  const saveOrderRewardsOverrideBtn = $("#saveOrderRewardsOverrideBtn");
  if (saveOrderRewardsOverrideBtn) saveOrderRewardsOverrideBtn.onclick = async () => {
    await api(`/api/admin/orders/${saveOrderRewardsOverrideBtn.dataset.orderId}/rewards-override`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        points_earned: Number($("#orderPointsEarned")?.value || 0),
        points_redeemed: Number($("#orderPointsRedeemed")?.value || 0),
        credit_cents_used: Number($("#orderCreditUsed")?.value || 0),
        notes: $("#orderRewardsNotes")?.value || "",
      }),
    });
    toast("Order rewards overridden.");
    await renderApp();
  };

  const saveCustomerProfileBtn = $("#saveCustomerProfileBtn");
  if (saveCustomerProfileBtn) saveCustomerProfileBtn.onclick = async () => {
    const id = saveCustomerProfileBtn.dataset.id;
    await api(`/api/admin/customers/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: $("#customerEmail")?.value || "", first_name: $("#customerFirstName")?.value || "", last_name: $("#customerLastName")?.value || "", phone: $("#customerPhone")?.value || "" }) });
    toast("Customer profile saved.");
    await renderApp();
  };

  const saveCustomerTagsBtn = $("#saveCustomerTagsBtn");
  if (saveCustomerTagsBtn) saveCustomerTagsBtn.onclick = async () => {
    const id = saveCustomerTagsBtn.dataset.id;
    await api(`/api/admin/customers/${id}/tags`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tags: $("#customerTagsInput")?.value || "" }) });
    toast("Tags updated.");
    await renderApp();
  };

  const adjustCustomerPointsBtn = $("#adjustCustomerPointsBtn");
  if (adjustCustomerPointsBtn) adjustCustomerPointsBtn.onclick = async () => {
    const id = adjustCustomerPointsBtn.dataset.id;
    await api(`/api/admin/customers/${id}/points-adjust`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delta_points: Number($("#customerDeltaPoints")?.value || 0), reason: $("#customerPointsReason")?.value || "Manual adjustment" }) });
    toast("Points adjusted.");
    await renderApp();
  };

  const saveTierOverrideBtn = $("#saveTierOverrideBtn");
  if (saveTierOverrideBtn) saveTierOverrideBtn.onclick = async () => {
    const id = saveTierOverrideBtn.dataset.id;
    await api(`/api/admin/customers/${id}/tier-override`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier_override_code: $("#customerTierOverride")?.value || null }) });
    toast("Tier override saved.");
    await renderApp();
  };

  const deleteCustomerBtn = $("#deleteCustomerBtn");
  if (deleteCustomerBtn) deleteCustomerBtn.onclick = async () => {
    if (!confirm("Soft delete this customer account?")) return;
    await api(`/api/admin/customers/${deleteCustomerBtn.dataset.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    toast("Customer deleted.");
    await renderApp();
  };

  const approve = $("#verificationApproveBtn");
  if (approve) approve.onclick = async () => {
    await api("/api/admin/verification-action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: approve.dataset.id, action: "approve" }) });
    toast("Verification approved.");
    await renderApp();
  };
  const deny = $("#verificationDenyBtn");
  if (deny) deny.onclick = async () => {
    await api("/api/admin/verification-action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: deny.dataset.id, action: "deny" }) });
    toast("Verification denied.");
    await renderApp();
  };

  const n = $("#newAdminBtn");
  if (n) n.onclick = async () => { const email = prompt("Admin email"); if (!email) return; const tempPassword = prompt("Temp password (min 8 chars)"); if (!tempPassword) return; const role = prompt("Role (superadmin/admin)") || "admin"; await api("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, tempPassword, role }) }); renderApp(); };
}


async function init() {
  const requestedView = (new URL(window.location.href)).searchParams.get("view");
  if (requestedView) state.panel = requestedView;

  $("#logoutBtn").onclick = async () => { await api("/api/admin/logout", { method: "POST" }); state.admin = null; $("#detailDrawer").classList.remove("open"); renderAuth(); };
  $("#drawerClose").onclick = () => { const d = $("#detailDrawer"); d.classList.remove("open"); d.classList.remove("minimized"); };
  const m = $("#drawerMinimize");
  if (m) m.onclick = () => $("#detailDrawer").classList.toggle("minimized");
  $("#refreshBtn").onclick = () => renderApp();
  $("#globalSearch").onchange = () => renderApp();
  $("#globalRange").onchange = () => { const custom = $("#globalRange").value === "custom"; $("#customStart").hidden = !custom; $("#customEnd").hidden = !custom; renderApp(); };
  $("#customStart").onchange = () => renderApp();
  $("#customEnd").onchange = () => renderApp();

  const boot = await api("/api/admin/auth/bootstrap-create").catch(() => ({ needs_bootstrap: false }));
  state.needsBootstrap = !!boot.needs_bootstrap;

  try { const me = await api("/api/admin/me"); state.admin = me.data?.admin || me.admin; } catch { state.admin = null; }
  renderAuth();
}

document.addEventListener("DOMContentLoaded", () => init().catch((e) => toast(e.message, "error")));
