const $ = (s) => document.querySelector(s);
const EFFECTS = ["Relaxed", "Creative", "Euphoric", "Focused", "Sleepy", "Hungry", "Uplifted"];

const state = { admin: null, products: [], editing: null, needsBootstrap: false };

const toast = (message, type = "ok") => {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  $("#toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "include", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.msg || data.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

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
    return;
  }

  setWorkspaceVisible(false);
  root.hidden = false;
  root.innerHTML = `
    <div class="card">
      <h3>Admin Login</h3>
      <input id="loginEmail" placeholder="Email" />
      <input id="loginPassword" placeholder="Password" type="password" />
      <button id="loginBtn" class="btn btn-gold">Login</button>
    </div>
    <div class="card" ${state.needsBootstrap ? "" : "hidden"}>
      <h3>Bootstrap Owner</h3>
      <input id="bootSecret" placeholder="Bootstrap secret" type="password" />
      <input id="bootEmail" placeholder="Owner email" />
      <input id="bootName" placeholder="Owner name" />
      <input id="bootPassword" placeholder="Password" type="password" />
      <button id="bootBtn" class="btn btn-gold">Create Owner</button>
    </div>
  `;

  $("#loginBtn").onclick = async () => {
    try {
      const d = await api("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: $("#loginEmail").value, password: $("#loginPassword").value }),
      });
      state.admin = d.admin;
      renderAuth();
      await loadProducts();
    } catch (e) {
      toast(`Login failed: ${e.message}`, "error");
    }
  };

  if (state.needsBootstrap) {
    $("#bootBtn").onclick = async () => {
      try {
        await api("/api/admin/auth/bootstrap-create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            secret: $("#bootSecret").value,
            email: $("#bootEmail").value,
            password: $("#bootPassword").value,
            name: $("#bootName").value,
          }),
        });
        toast("Owner created. Please sign in.");
        await init();
      } catch (e) {
        toast(`Bootstrap failed: ${e.message}`, "error");
      }
    };
  }
}

function productForm(p = {}) {
  const effects = new Set(p.effects || []);
  return `
    <div class="card">
      <input id="fName" placeholder="Name" value="${p.name || ""}" />
      <input id="fSlug" placeholder="Slug" value="${p.slug || ""}" />
      <input id="fBrand" placeholder="Brand" value="${p.brand || ""}" />
      <input id="fCategory" placeholder="Category" value="${p.category || ""}" />
      <input id="fSubcategory" placeholder="Subcategory" value="${p.subcategory || ""}" />
      <textarea id="fDescription" placeholder="Description">${p.description || ""}</textarea>
      <label><input id="fPublished" type="checkbox" ${Number(p.is_published ?? 1) ? "checked" : ""}/> Published</label>
      <input id="fImageUrl" placeholder="Image URL fallback" value="${p.image_url || ""}" />
      <input id="fImageFile" type="file" accept="image/*" />
      <div>${EFFECTS.map((e) => `<label><input class='fx' type='checkbox' value='${e}' ${effects.has(e) ? "checked" : ""}/> ${e}</label>`).join(" ")}</div>
      <h4>Variants</h4>
      <div id="variants">${(p.variants || []).map((v, i) => `<div class='vrow'><input class='vlabel' value='${v.label || ""}' placeholder='label'/><input class='vprice' type='number' value='${v.price_cents || 0}' placeholder='price_cents'/><input class='vsort' type='number' value='${v.sort_order ?? i}'/><label><input class='vactive' type='checkbox' ${Number(v.is_active ?? 1) ? "checked" : ""}/>active</label></div>`).join("")}</div>
      <button id="addVariant" class="btn">Add Variant</button>
      <button id="saveProduct" class="btn btn-gold">Save</button>
    </div>`;
}

function collectForm(id = null) {
  return {
    id,
    name: $("#fName").value,
    slug: $("#fSlug").value,
    brand: $("#fBrand").value,
    category: $("#fCategory").value,
    subcategory: $("#fSubcategory").value,
    description: $("#fDescription").value,
    image_url: $("#fImageUrl").value,
    is_published: $("#fPublished").checked ? 1 : 0,
    effects: [...document.querySelectorAll(".fx:checked")].map((x) => x.value),
    variants: [...document.querySelectorAll("#variants .vrow")].map((row, i) => ({ label: row.querySelector(".vlabel").value, price_cents: Number(row.querySelector(".vprice").value || 0), sort_order: Number(row.querySelector(".vsort").value || i), is_active: row.querySelector(".vactive").checked ? 1 : 0 })),
  };
}

async function maybeUploadImage(productId) {
  const file = $("#fImageFile")?.files?.[0];
  if (!file) return {};
  const fd = new FormData();
  fd.append("image", file);
  fd.append("productId", productId || crypto.randomUUID());
  try {
    return await api("/api/admin/uploads/product-image", { method: "POST", body: fd });
  } catch (e) {
    toast(`Upload unavailable (${e.message}), using URL fallback`, "error");
    return {};
  }
}

async function editProduct(id = null) {
  let p = { variants: [], effects: [] };
  if (id) {
    const d = await api(`/api/admin/products/${id}`);
    p = { ...d.product, variants: d.variants || [] };
  }
  const root = $("#authView");
  root.hidden = false;
  $("#workspace").hidden = true;
  $("#workspaceTopbar").hidden = true;
  root.innerHTML = productForm(p);
  $("#addVariant").onclick = () => {
    const row = document.createElement("div");
    row.className = "vrow";
    row.innerHTML = "<input class='vlabel' placeholder='label'/><input class='vprice' type='number' value='0'/><input class='vsort' type='number' value='0'/><label><input class='vactive' type='checkbox' checked/>active</label>";
    $("#variants").appendChild(row);
  };
  $("#saveProduct").onclick = async () => {
    try {
      const upload = await maybeUploadImage(id);
      const payload = collectForm(id);
      if (upload.image_key) payload.image_key = upload.image_key;
      if (upload.public_url) payload.image_path = upload.public_url;
      if (id) await api(`/api/admin/products/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      else await api("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast("Saved");
      renderAuth();
      await loadProducts();
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

async function loadProducts() {
  const q = encodeURIComponent($("#search").value || "");
  const category = encodeURIComponent($("#categoryFilter").value || "");
  const published = encodeURIComponent($("#publishedFilter").value || "");
  const d = await api(`/api/admin/products?query=${q}&category=${category}&published=${published}`);
  state.products = d.products || [];
  $("#productsList").innerHTML = state.products.map((p) => `<div class='card'><div><strong>${p.name}</strong> <span class='muted'>${p.category || ""}/${p.subcategory || ""}</span></div><div><img src='${p.image_url || (p.image_key ? `/api/images/${encodeURIComponent(p.image_key)}` : p.image_path || "")}' style='max-width:80px;max-height:80px'/></div><div>${p.effects.map((e) => `<span class='badge'>${e}</span>`).join(" ")}</div><div><button class='btn edit' data-id='${p.id}'>Edit</button><button class='btn del' data-id='${p.id}'>Delete</button><button class='btn unpub' data-id='${p.id}'>Unpublish</button></div></div>`).join("");
  document.querySelectorAll(".edit").forEach((b) => (b.onclick = () => editProduct(b.dataset.id)));
  document.querySelectorAll(".del").forEach((b) => (b.onclick = async () => { await api(`/api/admin/products/${b.dataset.id}`, { method: "DELETE" }); await loadProducts(); }));
  document.querySelectorAll(".unpub").forEach((b) => (b.onclick = async () => { await api(`/api/admin/products/${b.dataset.id}?mode=unpublish`, { method: "DELETE" }); await loadProducts(); }));
}

async function init() {
  $("#logoutBtn").onclick = async () => {
    await api("/api/admin/auth/logout", { method: "POST" });
    state.admin = null;
    await init();
  };
  $("#newProductBtn").onclick = () => editProduct(null);
  ["#search", "#categoryFilter", "#publishedFilter"].forEach((sel) => {
    $(sel).onchange = () => loadProducts().catch((e) => toast(e.message, "error"));
  });

  const boot = await api("/api/admin/auth/bootstrap-create");
  state.needsBootstrap = !!boot.needs_bootstrap;

  try {
    const me = await api("/api/admin/auth/me");
    state.admin = me.ok ? me.admin : null;
  } catch {
    state.admin = null;
  }

  renderAuth();
  if (state.admin) await loadProducts();
}

document.addEventListener("DOMContentLoaded", () => init().catch((e) => toast(e.message, "error")));
