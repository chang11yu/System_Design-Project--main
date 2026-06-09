const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());
const CONFIGURED_API_BASE = String(window.APP_CONFIG?.API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const IS_GITHUB_PAGES = window.location.hostname.endsWith(".github.io");
const API_BASE = CONFIGURED_API_BASE || (
  window.location.protocol === "file:" ? "http://127.0.0.1:5000" : ""
);

let products = [];
let inventory = [];
let suppliers = [];
let purchaseOrders = [];
let salesRecord = [];
let wasteRecord = [];
let bomRecords = [];
let bomRules = {};
let forecastResult = null; // 儲存後端回傳的備貨建議結果

let currentOrder = {};
let hasPendingSale = false;
let activeReportHasData = true;
let toastTimer;
const expiryOverrides = JSON.parse(localStorage.getItem("inventoryExpiryDays") || "{}");

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

async function apiFetch(path, options = {}) {
  if (IS_GITHUB_PAGES && !CONFIGURED_API_BASE) {
    throw new Error("GitHub Pages 尚未設定線上 API 網址");
  }

  const response = await fetch(`${API_BASE}${path}`, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "系統處理失敗");
  }
  return result;
}

function setConnectionStatus(online, message) {
  const status = $("#connectionStatus");
  status.textContent = message;
  status.classList.toggle("offline", !online);
}

function enhanceRequiredFields() {
  $$("form").forEach((form) => {
    const requiredFields = [...form.querySelectorAll("[required]")];
    if (requiredFields.length === 0) return;

    if (!form.querySelector(".required-note")) {
      const note = document.createElement("p");
      note.className = "required-note form-full";
      note.innerHTML = '<span aria-hidden="true">*</span> 表示必填項目';
      form.prepend(note);
    }

    requiredFields.forEach((field) => {
      const label = field.closest("label");
      if (!label || label.querySelector(".field-label-text")) return;

      const labelText = [...label.childNodes]
        .filter((node) => node !== field)
        .map((node) => node.textContent)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      [...label.childNodes]
        .filter((node) => node !== field)
        .forEach((node) => node.remove());

      const text = document.createElement("span");
      text.className = "field-label-text";
      text.textContent = labelText;

      const mark = document.createElement("span");
      mark.className = "required-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = " *";
      text.append(mark);
      label.prepend(text);
    });
  });
}

// 1. 初始化：從後端大打包 API 載入所有基礎資料
async function loadData() {
  try {
    setConnectionStatus(true, "正在同步資料...");
    const result = await apiFetch("/api/get_all_data");

    if (!result.success) {
      throw new Error(result.message || "讀取資料失敗");
    }

    products = result.products.map((item) => ({
      id: item.product_id,
      name: item.product_name,
      price: Number(item.price),
      isNoodle: item.product_name.includes("涼麵"),
      stock: 999
    }));

    inventory = result.inventory.map((item) => ({
      id: item.material_id,
      name: item.material_name,
      stock: Number(item.stock ?? 0),
      unit: item.unit,
      safeStock: Number(item.safe_stock ?? 0),
      expiryDays: item.expiry_days == null
        ? (expiryOverrides[item.material_id] == null ? null : Number(expiryOverrides[item.material_id]))
        : Number(item.expiry_days)
    }));

    suppliers = result.suppliers.map((item) => ({
      id: item.supplier_id,
      name: item.name,
      contact: item.contact,
      phone: item.phone,
      address: item.address,
      used: false
    }));

    purchaseOrders = result.purchaseOrders.map((item) => ({
      id: String(item.purchase_id),
      date: String(item.purchase_date || "").slice(0, 10),
      supplierId: item.supplier_id,
      itemId: item.material_id,
      qty: Number(item.ordered_qty ?? item.qty),
      receivedQty: item.received_qty == null ? null : Number(item.received_qty),
      qualityNote: item.quality_note || "",
      status: item.status || "已下單"
    }));

    salesRecord = result.salesRecords.map((item) => ({
      id: String(item.sale_id),
      date: String(item.sale_date || "").slice(0, 10),
      productId: item.product_id,
      qty: Number(item.qty),
      subtotal: Number(item.subtotal)
    }));

    wasteRecord = (result.wasteRecords || []).map((item) => ({
      id: String(item.id),
      date: String(item.scrap_date || "").slice(0, 10),
      itemId: item.material_id,
      itemName: item.material_name,
      qty: Number(item.quantity),
      reason: item.reason || ""
    }));

    bomRecords = (result.bomRecords || []).map((item) => ({
      productId: item.product_id,
      itemId: item.material_id,
      qty: Number(item.consume_qty)
    }));
    rebuildDerivedData();

    // 若尚未計算過備貨，先初始化一次預設預估
    if (!forecastResult) {
      await fetchForecastFromServer();
    }

    setConnectionStatus(true, `資料已同步 ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`);
    renderAll();
  } catch (error) {
    console.error(error);
    setConnectionStatus(false, "離線：請雙擊 START_SYSTEM.bat");
    renderAll();
    const message = error instanceof TypeError ? "無法連接後端服務" : (error.message || "無法連接資料庫 API");
    showToast(message, "error");
  }
}

function rebuildDerivedData() {
  bomRules = {};
  bomRecords.forEach((record) => {
    if (!bomRules[record.productId]) bomRules[record.productId] = [];
    bomRules[record.productId].push({ itemId: record.itemId, qty: record.qty });
  });

  purchaseOrders.forEach((order) => {
    order.itemName = getInventoryItem(order.itemId)?.name || order.itemId;
  });
  salesRecord.forEach((record) => {
    const product = getProduct(record.productId);
    record.productName = product?.name || record.productId;
    record.price = record.qty > 0 ? record.subtotal / record.qty : (product?.price || 0);
  });
  wasteRecord.forEach((record) => {
    record.itemName = record.itemName || getInventoryItem(record.itemId)?.name || record.itemId;
    record.unit = getInventoryItem(record.itemId)?.unit || "單位";
  });
  suppliers.forEach((supplier) => {
    supplier.used = purchaseOrders.some((order) => order.supplierId === supplier.id);
  });
}

// 2. 銷售紀錄：點擊完成銷售對接 Flask POST /sales/create
async function submitSaleToDatabase() {
  const selected = products.filter((product) => currentOrder[product.id] > 0);

  if (selected.length === 0) {
    showToast("請至少選擇一項商品", "error");
    return;
  }

  try {
    for (const [index, product] of selected.entries()) {
      const result = await apiFetch("/sales/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale_id: `S${Date.now().toString().slice(-9)}${index}`,
          product_id: product.id,
          qty: currentOrder[product.id]
        })
      });

      if (!result.success) throw new Error(result.message || "銷售新增失敗");
    }

    currentOrder = {};
    hasPendingSale = false;
    showToast("銷售已完成；同日相同商品已自動合併");
    await loadData();

  } catch (error) {
    console.error(error);
    showToast("銷售資料寫入失敗", "error");
  }
}

// 3. 備貨建議：呼叫後端 POST /forecast/calculate 進行複雜算力預估
async function fetchForecastFromServer() {
  const weather = $("#weather")?.value || "cloudy";
  const holiday = $("#holiday")?.value || "weekday";
  const festival = $("#festival")?.value || "no";
  const cityEvent = $("#cityEvent")?.value || "none";

  try {
    const result = await apiFetch("/forecast/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weather: weather,
        holiday: holiday,
        festival: festival,
        city_event: cityEvent
      })
    });

    if (result.success) {
      // 將後端回傳欄位映射成前端格式
      forecastResult = {
        baseBowls: result.base_bowls,
        safeBowls: result.safe_bowls,
        rows: result.material_requirements.map(m => ({
          itemId: m.material_id,
          name: m.name,
          unit: m.unit,
          need: m.required_qty
        }))
      };
    }
  } catch (error) {
    console.error("無法從後端取得備貨建議數據:", error);
    return false;
  }
  return true;
}

//輔助轉換與格式化函數
function formatMoney(value) {
  return `$${Math.round(Number(value)).toLocaleString("zh-TW")}`;
}

function formatQty(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type === "success" ? "" : type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 2600);
}

function switchPage(pageId) {
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === pageId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === pageId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getProduct(productId) { return products.find((p) => p.id === productId); }
function getInventoryItem(itemId) { return inventory.find((item) => item.id === itemId); }
function supplierNameById(id) { return suppliers.find((s) => s.id === id)?.name || "未指定"; }

function statusInfo(item) {
  if (Number.isFinite(item.expiryDays) && item.expiryDays < 0) return { text: "已過期", className: "tag-expired" };
  if (Number.isFinite(item.expiryDays) && item.expiryDays <= 1) return { text: "即將過期", className: "tag-danger" };
  if (item.stock < item.safeStock) return { text: "低庫存", className: "tag-low" };
  return { text: "正常", className: "tag-normal" };
}

function purchaseStatusClass(status) {
  if (status === "已驗收") return "tag-done";
  if (status === "異常") return "tag-abnormal";
  return "tag-ordered";
}

function getOrderUsage(orderMap) {
  const usage = {};
  Object.entries(orderMap).forEach(([productId, qty]) => {
    if (qty <= 0) return;
    (bomRules[productId] || []).forEach((rule) => {
      usage[rule.itemId] = (usage[rule.itemId] || 0) + rule.qty * qty;
    });
  });
  return usage;
}

function getSalesRecordUsage(record) { return getOrderUsage({ [record.productId]: record.qty }); }

function todaySales() { return salesRecord.filter((record) => record.date === TODAY); }
function reportFilteredSales() {
  const startDate = $("#startDate")?.value || "0000-01-01";
  const endDate = $("#endDate")?.value || "9999-12-31";
  const productFilter = $("#filterProduct")?.value || "all";
  return salesRecord.filter((r) => r.date >= startDate && r.date <= endDate && (productFilter === "all" || r.productId === productFilter));
}

function reportFilteredWaste() {
  const startDate = $("#startDate")?.value || "0000-01-01";
  const endDate = $("#endDate")?.value || "9999-12-31";
  const materialFilter = $("#filterMaterial")?.value || "all";
  return wasteRecord.filter((r) => r.date >= startDate && r.date <= endDate && (materialFilter === "all" || r.itemId === materialFilter));
}

function renderProducts() {
  $("#productGrid").innerHTML = products.length ? products.map((product) => {
    const qty = currentOrder[product.id] || 0;
    return `
      <div class="product-card">
        <h4>${product.name}</h4>
        <div class="price">${formatMoney(product.price)}</div>
        <div class="qty-control">
          <button type="button" data-action="minus" data-id="${product.id}">-</button>
          <input type="number" min="0" step="1" value="${qty}" data-qty-input="${product.id}" aria-label="${product.name}數量">
          <button type="button" data-action="plus" data-id="${product.id}">+</button>
        </div>
      </div>
    `;
  }).join("") : `<div class="empty form-full">尚未建立餐點商品</div>`;
}

function renderCurrentOrder() {
  const selected = products.filter((product) => currentOrder[product.id] > 0);
  const total = selected.reduce((sum, product) => sum + product.price * currentOrder[product.id], 0);

  $("#salesTotal").textContent = formatMoney(total);
  $("#currentOrder").classList.toggle("empty", selected.length === 0);
  $("#currentOrder").innerHTML = selected.length
    ? selected.map((p) => `<div class="order-line"><span>${p.name} x ${currentOrder[p.id]}</span><strong>${formatMoney(p.price * currentOrder[p.id])}</strong></div>`).join("")
    : "尚未選擇商品";
}

function renderSalesTable() {
  const table = $("#salesTable");
  const today = todaySales();
  if (today.length === 0) {
    table.innerHTML = `<tr><td colspan="5" class="empty">今日尚無銷售明細</td></tr>`;
    return;
  }
  table.innerHTML = today.map((r) => `
    <tr>
      <td>${r.productName}</td><td>${formatQty(r.qty)}</td><td>${formatMoney(r.price)}</td><td>${formatMoney(r.price * r.qty)}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-secondary btn-small" data-edit-sale="${r.id}">修改</button>
          <button class="btn btn-danger btn-small" data-delete-sale="${r.id}">刪除</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderInventoryTable() {
  $("#inventoryTable").innerHTML = inventory.length ? inventory.map((item) => {
    const status = statusInfo(item);
    return `
      <tr>
        <td>${item.id}</td><td>${item.name}</td><td>${formatQty(item.stock)}</td><td>${item.unit}</td><td>${formatQty(item.safeStock)}</td>
        <td>${Number.isFinite(item.expiryDays) ? (item.expiryDays < 0 ? "已過期" : `${item.expiryDays} 天`) : "未設定"}</td><td><span class="tag ${status.className}">${status.text}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn btn-secondary btn-small" data-adjust-stock="${item.id}" data-delta="1">+1</button>
            <button class="btn btn-ghost btn-small" data-adjust-stock="${item.id}" data-delta="-1">-1</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="8" class="empty">尚未建立原料資料</td></tr>`;

  $("#wasteItem").innerHTML = inventory.map((i) => `<option value="${i.id}">${i.name}（目前 ${formatQty(i.stock)}${i.unit}）</option>`).join("");
  $("#poItem").innerHTML = inventory.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
}

function renderBomSection() {
  $("#bomProduct").innerHTML = products.map((product) => `<option value="${product.id}">${product.name}</option>`).join("");
  $("#bomMaterial").innerHTML = inventory.map((item) => `<option value="${item.id}">${item.name}（${item.unit}）</option>`).join("");
  $("#bomTable").innerHTML = bomRecords.length ? bomRecords.map((record) => {
    const product = getProduct(record.productId);
    const item = getInventoryItem(record.itemId);
    return `
      <tr>
        <td>${product?.name || record.productId}</td>
        <td>${item?.name || record.itemId}</td>
        <td>${formatQty(record.qty)} ${item?.unit || ""}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-secondary btn-small" data-edit-bom="${record.productId}|${record.itemId}">修改</button>
            <button class="btn btn-danger btn-small" data-delete-bom="${record.productId}|${record.itemId}">刪除</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="4" class="empty">尚未設定 BOM 配方</td></tr>`;
}

function renderWasteTable() {
  const rows = [...wasteRecord].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  $("#wasteTable").innerHTML = rows.length ? rows.map((record) => `
    <tr>
      <td>${record.date || "-"}</td>
      <td>${record.itemName}</td>
      <td>${formatQty(record.qty)} ${record.unit}</td>
      <td>${record.reason || "未填寫"}</td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty">目前沒有報廢紀錄</td></tr>`;
}

function renderSupplierOptions() {
  $("#poSupplier").innerHTML = suppliers.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
}

function renderPurchaseTable() {
  $("#purchaseTable").innerHTML = purchaseOrders.length ? purchaseOrders.map((order) => {
    const disabled = order.status === "已驗收" || order.status === "異常";
    return `
      <tr>
        <td>${order.id}</td><td>${order.date}</td><td>${supplierNameById(order.supplierId)}</td><td>${order.itemName}</td>
        <td>${formatQty(order.qty)}</td>
        <td>${order.receivedQty == null ? "尚未驗收" : formatQty(order.receivedQty)}</td>
        <td>${order.qualityNote || "尚未驗收"}</td>
        <td><span class="tag ${purchaseStatusClass(order.status)}">${order.status}</span></td>
        <td><button class="btn btn-secondary btn-small" data-receive="${order.id}" ${disabled ? "disabled" : ""}>${disabled ? "已完成" : "驗收"}</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="9" class="empty">尚未建立進貨單</td></tr>`;
}

function renderForecastTable() {
  if (!forecastResult) return;
  $("#forecastBase").textContent = `${forecastResult.baseBowls} 碗`;
  $("#forecastSafe").textContent = `${forecastResult.safeBowls} 碗`;
  $("#forecastTable").innerHTML = forecastResult.rows.map((row) => `
    <tr>
      <td>${row.name}</td>
      <td class="text-right"><strong>${formatQty(row.need)} ${row.unit}</strong></td>
    </tr>
  `).join("");
}

function renderReportFilters() {
  const currentProduct = $("#filterProduct").value || "all";
  const currentMaterial = $("#filterMaterial").value || "all";
  $("#filterProduct").innerHTML = `<option value="all">全部商品</option>` + products.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  $("#filterMaterial").innerHTML = `<option value="all">全部原料</option>` + inventory.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
  $("#filterProduct").value = products.some((p) => p.id === currentProduct) ? currentProduct : "all";
  $("#filterMaterial").value = inventory.some((i) => i.id === currentMaterial) ? currentMaterial : "all";
}

function renderReports() {
  renderReportFilters();
  const sales = reportFilteredSales();
  const wastes = reportFilteredWaste();
  const startDate = $("#startDate")?.value || "0000-01-01";
  const endDate = $("#endDate")?.value || "9999-12-31";
  const materialFilter = $("#filterMaterial")?.value || "all";
  const purchaseInRange = purchaseOrders.filter((order) =>
    order.date >= startDate &&
    order.date <= endDate &&
    (materialFilter === "all" || order.itemId === materialFilter)
  );

  activeReportHasData = sales.length > 0 || wastes.length > 0 || purchaseInRange.length > 0;
  $("#reportEmpty").classList.toggle("hidden", activeReportHasData);
  $("#reportContent").classList.toggle("hidden", !activeReportHasData);
  if (!activeReportHasData) return;

  const revenue = sales.reduce((sum, r) => sum + r.price * r.qty, 0);
  const saleQty = sales.reduce((sum, r) => sum + r.qty, 0);
  const purchaseQty = purchaseInRange.reduce((sum, o) => sum + (o.receivedQty ?? 0), 0);
  const wasteQty = wastes.reduce((sum, r) => sum + r.qty, 0);
  const selectedMaterial = materialFilter === "all" ? null : getInventoryItem(materialFilter);
  const completedPurchases = purchaseInRange.filter((order) => order.receivedQty !== null);
  const purchaseMetric = selectedMaterial
    ? {
        label: `${selectedMaterial.name}期間進貨量`,
        value: `${formatQty(purchaseQty)} ${selectedMaterial.unit}`,
        note: "此日期區間內完成驗收並加入庫存的數量"
      }
    : {
        label: "期間進貨紀錄",
        value: `${completedPurchases.length} 筆`,
        note: "全部原料單位不同，數量請查看下方進銷存總覽"
      };
  const wasteMetric = selectedMaterial
    ? {
        label: `${selectedMaterial.name}期間報廢量`,
        value: `${formatQty(wasteQty)} ${selectedMaterial.unit}`,
        note: "此日期區間內登記並從庫存扣除的數量"
      }
    : {
        label: "期間報廢紀錄",
        value: `${wastes.length} 筆`,
        note: "全部原料單位不同，數量請查看下方損耗分析"
      };

  $("#reportSummary").innerHTML = [
    { label: "期間營收", value: formatMoney(revenue), note: `${startDate} 至 ${endDate}` },
    { label: "期間銷售量", value: `${formatQty(saleQty)} 份`, note: "依上方商品條件統計" },
    purchaseMetric,
    wasteMetric
  ].map((metric) => `
    <article class="metric-card"><span>${metric.label}</span><strong>${metric.value}</strong><small>${metric.note}</small></article>
  `).join("");

  // 營收圖表、熱門品項與報廢分析圖表更新
  const dayMap = {};
  sales.forEach((r) => { dayMap[r.date] = (dayMap[r.date] || 0) + r.price * r.qty; });
  const revenueDays = [];
  const chartStart = new Date(`${startDate}T00:00:00`);
  const chartEnd = new Date(`${endDate}T00:00:00`);
  for (let date = chartStart, count = 0; date <= chartEnd && count < 31; date.setDate(date.getDate() + 1), count += 1) {
    const key = new Intl.DateTimeFormat("en-CA").format(date);
    revenueDays.push({ label: key.slice(5).replace("-", "/"), value: dayMap[key] || 0 });
  }
  const safeRevenueDays = revenueDays.length ? revenueDays : [{ label: "無資料", value: 0 }];
  const maxRevenue = Math.max(1, ...safeRevenueDays.map((d) => d.value));
  $("#revenueChart").innerHTML = safeRevenueDays.map((d) => `
    <div class="bar-item"><span class="bar-value">${formatMoney(d.value)}</span><div class="bar" style="height:${Math.max(24, (d.value / maxRevenue) * 175)}px"></div><span class="bar-label">${d.label}</span></div>
  `).join("");

  const productMap = {};
  sales.forEach((r) => { productMap[r.productName] = (productMap[r.productName] || 0) + r.qty; });
  const productRank = Object.entries(productMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const rankMax = Math.max(1, ...productRank.map((i) => i.value));
  $("#productRankChart").innerHTML = productRank.length 
    ? productRank.map((i) => `<div class="rank-row"><strong>${i.name}</strong><div class="rank-track"><div class="rank-fill" style="width:${(i.value / rankMax) * 100}%"></div></div><span>${formatQty(i.value)} 份</span></div>`).join("")
    : `<div class="empty">目前查無商品銷售資料</div>`;

  const wasteMap = {};
  wastes.forEach((r) => { wasteMap[r.itemName] = (wasteMap[r.itemName] || 0) + r.qty; });
  const wasteRows = Object.entries(wasteMap).map(([name, value]) => ({ name, value }));
  const wasteMax = Math.max(1, ...wasteRows.map((i) => i.value));
  $("#wasteChart").innerHTML = wasteRows.length
    ? wasteRows.map((i) => `<div class="waste-row"><strong>${i.name}</strong><div class="waste-track"><div class="waste-fill" style="width:${(i.value / wasteMax) * 100}%"></div></div><span>${formatQty(i.value)} 單位</span></div>`).join("")
    : `<div class="empty">目前沒有報廢紀錄</div>`;

  // 進銷存整合表
  const salesUsage = {};
  sales.forEach((r) => { Object.entries(getSalesRecordUsage(r)).forEach(([itemId, qty]) => { salesUsage[itemId] = (salesUsage[itemId] || 0) + qty; }); });
  const purchaseMap = {};
  purchaseInRange.forEach((o) => { purchaseMap[o.itemId] = (purchaseMap[o.itemId] || 0) + (o.receivedQty ?? 0); });
  const wasteByItem = {};
  wastes.forEach((r) => { wasteByItem[r.itemId] = (wasteByItem[r.itemId] || 0) + r.qty; });

  $("#stockOverviewTable").innerHTML = inventory
    .filter((item) => materialFilter === "all" || item.id === materialFilter)
    .map((item) => {
    const status = statusInfo(item);
    return `
      <tr>
        <td>${item.name}</td><td>${formatQty(item.stock)} ${item.unit}</td><td>${formatQty(purchaseMap[item.id] || 0)} ${item.unit}</td>
        <td>${formatQty(salesUsage[item.id] || 0)} ${item.unit}</td><td>${formatQty(wasteByItem[item.id] || 0)} ${item.unit}</td>
        <td><span class="tag ${status.className}">${status.text}</span></td>
      </tr>
    `;
    }).join("");
}

function renderSupplierTable() {
  $("#supplierTable").innerHTML = suppliers.length ? suppliers.map((supplier) => {
    const suppliedItems = [...new Set(
      purchaseOrders
        .filter((order) => order.supplierId === supplier.id)
        .map((order) => order.itemName)
    )];
    return `
      <tr>
        <td>${supplier.id}</td><td>${supplier.name}</td><td>${supplier.contact || "未填寫"}</td><td>${supplier.phone}</td><td>${supplier.address || "未填寫"}</td><td>${suppliedItems.join("、") || "尚無進貨紀錄"}</td>
        <td><div class="table-actions"><button class="btn btn-secondary btn-small" data-edit-supplier="${supplier.id}">修改</button><button class="btn btn-danger btn-small" data-delete-supplier="${supplier.id}">刪除</button></div></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="7" class="empty">尚未建立供應商資料</td></tr>`;
}

function resetSupplierForm() {
  $("#supplierFormTitle").textContent = "新增供應商";
  $("#supplierEditId").value = "";
  $("#supplierForm").reset();
}

function renderAll() {
  renderProducts();
  renderCurrentOrder();
  renderSalesTable();
  renderInventoryTable();
  renderBomSection();
  renderWasteTable();
  renderSupplierOptions();
  renderSupplierTable();
  renderPurchaseTable();
  renderForecastTable();
  renderReports();
}

//事件綁定群
function bindNavigation() {
  $$(".nav-item").forEach((item) => { item.addEventListener("click", () => switchPage(item.dataset.page)); });
  $$("[data-jump]").forEach((button) => { button.addEventListener("click", () => switchPage(button.dataset.jump)); });
}

function bindSalesEvents() {
  $("#productGrid").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    const product = getProduct(button.dataset.id);
    const currentQty = currentOrder[product.id] || 0;
    currentOrder[product.id] = button.dataset.action === "minus" ? Math.max(0, currentQty - 1) : currentQty + 1;

    renderProducts();
    renderCurrentOrder();
  });

  $("#productGrid").addEventListener("input", (event) => {
    const input = event.target.closest("[data-qty-input]");
    if (!input) return;
    const qty = Math.max(0, Math.floor(Number(input.value) || 0));
    input.value = qty;
    currentOrder[input.dataset.qtyInput] = qty;
    renderCurrentOrder();
  });

  $("#completeSaleBtn").addEventListener("click", submitSaleToDatabase);

  $("#salesTable").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-sale]");
    const deleteButton = event.target.closest("[data-delete-sale]");

    if (editButton) {
      const record = salesRecord.find((item) => item.id === editButton.dataset.editSale);
      if (!record) return;
      $("#saleEditId").value = record.id;
      $("#saleEditProduct").textContent = `商品：${record.productName}（目前 ${formatQty(record.qty)} 份）`;
      $("#saleEditQty").value = record.qty;
      $("#saleEditModal").classList.remove("hidden");
      $("#saleEditQty").focus();
      return;
    }

    if (!deleteButton || !confirm("確定刪除這筆銷售紀錄嗎？庫存將自動加回。")) return;
    try {
      const result = await apiFetch(`/sales/delete/${deleteButton.dataset.deleteSale}`, { method: "DELETE" });
      showToast(result.message || "銷售紀錄已刪除");
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#saleEditForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const saleId = $("#saleEditId").value;
    const qty = Number($("#saleEditQty").value);
    if (!Number.isInteger(qty) || qty <= 0) {
      showToast("銷售數量必須是大於 0 的整數", "error");
      return;
    }
    try {
      const result = await apiFetch(`/sales/update/${saleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty })
      });
      $("#saleEditModal").classList.add("hidden");
      showToast(result.message || "銷售數量已修改");
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#closeSaleEditModal").addEventListener("click", () => $("#saleEditModal").classList.add("hidden"));
}

function bindInventoryEvents() {
  $("#inventoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#invName").value.trim();
    const stock = Number($("#invStock").value);
    const unit = $("#invUnit").value.trim();
    const safeStock = Number($("#invSafe").value);
    const expiryDays = Number($("#invExpiry").value);
    const materialId = `M${Date.now().toString().slice(-7)}`;

    try {
      const result = await apiFetch("/inventory/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material_id: materialId,
          material_name: name,
          stock,
          safe_stock: safeStock,
          unit,
          expiry_days: expiryDays
        })
      });
      expiryOverrides[materialId] = expiryDays;
      localStorage.setItem("inventoryExpiryDays", JSON.stringify(expiryOverrides));
      showToast(result.message || "原料新增成功");
      event.target.reset();
      $("#invStock").value = 0;
      $("#invSafe").value = 1;
      $("#invExpiry").value = 3;
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#inventoryTable").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-adjust-stock]");
    if (!button) return;
    try {
      const result = await apiFetch(`/inventory/adjust/${button.dataset.adjustStock}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: Number(button.dataset.delta) })
      });
      showToast(result.message || "庫存已更新");
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  // 報廢登記完全對接 Flask POST /scrap/create
  $("#wasteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const materialId = $("#wasteItem").value;
    const qty = Number($("#wasteQty").value);
    const reason = $("#wasteReason").value.trim();

    if (!reason || qty <= 0) {
      showToast("請填寫正確的報廢原因與數量", "error");
      return;
    }

    try {
      const result = await apiFetch("/inventory/scrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_id: materialId, quantity: qty, reason: reason })
      });

      if (result.success) {
        showToast(result.message || "已記錄報廢資料並同步扣除庫存");
        event.target.reset();
        $("#wasteQty").value = 0;
        await loadData();
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function bindBomEvents() {
  $("#bomForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const productId = $("#bomProduct").value;
    const materialId = $("#bomMaterial").value;
    const consumeQty = Number($("#bomQty").value);
    const editProduct = event.target.dataset.editProduct;
    const editMaterial = event.target.dataset.editMaterial;

    try {
      const path = editProduct
        ? `/bom/update/${editProduct}/${editMaterial}`
        : "/bom/add";
      const result = await apiFetch(path, {
        method: editProduct ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, material_id: materialId, consume_qty: consumeQty })
      });
      showToast(result.message);
      event.target.reset();
      delete event.target.dataset.editProduct;
      delete event.target.dataset.editMaterial;
      $("#bomProduct").disabled = false;
      $("#bomMaterial").disabled = false;
      $("#bomForm button[type='submit']").textContent = "新增配方";
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#bomTable").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-bom]");
    const deleteButton = event.target.closest("[data-delete-bom]");
    const key = editButton?.dataset.editBom || deleteButton?.dataset.deleteBom;
    if (!key) return;
    const [productId, materialId] = key.split("|");

    if (editButton) {
      const record = bomRecords.find((item) => item.productId === productId && item.itemId === materialId);
      $("#bomProduct").value = productId;
      $("#bomMaterial").value = materialId;
      $("#bomQty").value = record.qty;
      $("#bomProduct").disabled = true;
      $("#bomMaterial").disabled = true;
      $("#bomForm").dataset.editProduct = productId;
      $("#bomForm").dataset.editMaterial = materialId;
      $("#bomForm button[type='submit']").textContent = "儲存配方修改";
      $("#bomQty").focus();
      return;
    }

    if (!confirm("確定刪除這筆 BOM 配方嗎？")) return;
    try {
      const result = await apiFetch(`/bom/delete/${productId}/${materialId}`, { method: "DELETE" });
      showToast(result.message);
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function bindPurchaseEvents() {
  // 進貨單新增對接 Flask POST /purchase/create
  $("#purchaseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const supplierId = $("#poSupplier").value;
    const itemId = $("#poItem").value;
    const qty = Number($("#poQty").value);

    if (!supplierId || qty <= 0) {
      showToast("請填寫正確進貨資訊", "error");
      return;
    }

    try {
      const result = await apiFetch("/purchase/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchase_id: `PO${Date.now().toString().slice(-9)}`,
          supplier_id: supplierId,
          material_id: itemId,
          qty: qty
        })
      });

      if (result.success) {
        showToast("已成功建立進貨單！");
        $("#poQty").value = 1;
        await loadData();
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  // 打開驗收彈窗
  $("#purchaseTable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-receive]");
    if (!button || button.disabled) return;
    const order = purchaseOrders.find((item) => item.id === button.dataset.receive);
    $("#receiveId").value = order.id;
    $("#receiveQty").value = order.qty;
    $("#receiveNote").value = "品質正常";
    $("#modal").classList.remove("hidden");
  });

  // 進貨單驗收對接 Flask PUT /purchase/receive/<id>
  $("#receiveForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const poId = $("#receiveId").value;
    const receiveQty = Number($("#receiveQty").value);
    const note = $("#receiveNote").value.trim();

    try {
      const result = await apiFetch(`/purchase/receive/${poId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          received_qty: receiveQty,
          note: note
        })
      });

      if (result.success) {
        showToast(result.message || "驗收完成，庫存已更新！");
        $("#modal").classList.add("hidden");
        await loadData();
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#closeModal").addEventListener("click", () => $("#modal").classList.add("hidden"));
}

function bindForecastEvents() {
  // 重新計算備貨按鈕：呼叫後端預估計演算法
  $("#forecastForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    showToast("正在連線後端核心計算備貨量...");
    const success = await fetchForecastFromServer();
    if (!success) {
      showToast("備貨計算失敗，請確認後端服務", "error");
      return;
    }
    renderAll();
    showToast("已完成今日備貨建議計算");
  });
}

function bindReportEvents() {
  $("#reportFilter").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("#startDate").value > $("#endDate").value) {
      showToast("日期區間不可開始日大於結束日", "error");
      return;
    }
    renderAll();
    showToast(activeReportHasData ? "報表篩選已套用" : "目前查無資料", activeReportHasData ? "success" : "warning");
  });
}

function bindSupplierEvents() {
  $("#supplierForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const editId = $("#supplierEditId").value;
    const name = $("#supplierName").value.trim();
    const phone = $("#supplierPhone").value.trim();
    const contact = $("#supplierContact").value.trim();
    const address = $("#supplierAddress").value.trim();

    if (!name || !phone) {
      showToast("供應商名稱與電話不可空白", "error");
      return;
    }

    const payload = {
      supplier_id: editId ? editId : `S${String(Math.max(0, ...suppliers.map((supplier) => Number(supplier.id.replace(/\D/g, "")) || 0)) + 1).padStart(2, "0")}`,
      name: name, phone: phone, contact: contact, address: address
    };

    try {
      const result = await apiFetch(
        editId ? `/supplier/update/${editId}` : "/supplier/add",
        { method: editId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      showToast(result.message);
      resetSupplierForm();
      await loadData();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#supplierTable").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-supplier]");
    const deleteButton = event.target.closest("[data-delete-supplier]");

    if (editButton) {
      const supplierId = editButton.dataset.editSupplier;
      const supplier = suppliers.find((item) => item.id === supplierId);
      if (!supplier) return;
      $("#supplierFormTitle").textContent = "修改供應商";
      $("#supplierEditId").value = supplier.id;
      $("#supplierName").value = supplier.name;
      $("#supplierContact").value = supplier.contact || "";
      $("#supplierPhone").value = supplier.phone;
      $("#supplierAddress").value = supplier.address || "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    
    if (deleteButton) {
      const supplierId = deleteButton.dataset.deleteSupplier;
      if (!confirm("確定要刪除此供應商嗎？")) return;
      try {
        const result = await apiFetch(`/supplier/delete/${supplierId}`, { method: "DELETE" });
        showToast(result.message);
        await loadData();
      } catch (error) { showToast(error.message, "error"); }
    }
  });

  $("#cancelSupplierEdit").addEventListener("click", resetSupplierForm);
}

//初始化：網頁載入完成後綁定所有事件並同步後端
document.addEventListener("DOMContentLoaded", () => {
  const endDate = new Date(`${TODAY}T00:00:00`);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  $("#startDate").value = new Intl.DateTimeFormat("en-CA").format(startDate);
  $("#endDate").value = TODAY;

  enhanceRequiredFields();
  bindNavigation();
  bindSalesEvents();
  bindInventoryEvents();
  bindBomEvents();
  bindPurchaseEvents();
  bindForecastEvents();
  bindReportEvents();
  bindSupplierEvents();
  
  loadData();
});
