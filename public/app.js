/* 桌面便签网页版 2.1.39.1 — 无框架，直接调同域 Pages Functions。 */
"use strict";

const $ = (id) => document.getElementById(id);
const LS_ENDPOINT = "desknote.sync.endpoint";
const LS_TOKEN = "desknote.sync.token";

const state = {
  revision: 0,
  data: null,
  page: "all",
  filter: "pending",
  busy: false,
  dirty: false,
  loaded: false,
};

function defaultEndpoint() {
  return (location.protocol === "http:" || location.protocol === "https:") ? location.origin : "";
}

let config = {
  endpoint: localStorage.getItem(LS_ENDPOINT) || defaultEndpoint(),
  token: localStorage.getItem(LS_TOKEN) || "",
};

let toastTimer = 0;

function setStatus(text, kind = "") {
  const el = $("sync-status");
  el.textContent = text;
  el.className = "status " + kind;
}

function toast(text, error = false) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast" + (error ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localIso(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function stamp(item) {
  return String(item?.updated_at || item?.created_at || "");
}

function mergeItems(local, remote) {
  const remoteMap = new Map();
  for (const item of remote || []) {
    if (item && item.id) remoteMap.set(String(item.id), item);
  }
  const merged = [];
  const used = new Set();
  for (const item of local || []) {
    if (!item || !item.id) continue;
    const other = remoteMap.get(String(item.id));
    if (!other) merged.push(item);
    else merged.push(stamp(other) > stamp(item) ? other : item);
    used.add(String(item.id));
  }
  for (const [id, item] of remoteMap) {
    if (!used.has(id)) merged.push(item);
  }
  return merged.slice(0, 5000);
}

function apiUrl() {
  const base = String(config.endpoint || defaultEndpoint()).trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填写接口地址");
  return base.endsWith("/api/workspace") ? base : base + "/api/workspace";
}

async function api(path = "") {
  const url = apiUrl() + path;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${String(config.token || "").trim()}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (response.status === 401) throw new Error("同步密钥不正确（401）");
  return response;
}

function pages() {
  const raw = state.data?.settings?.pages;
  const list = Array.isArray(raw) ? raw.filter((p) => p && p.id && p.name) : [];
  if (!list.some((p) => p.id === "all")) {
    list.unshift({ id: "all", name: "全部", kind: "tasks", units: [], note_html: "" });
  }
  return list;
}

function pageById(id) {
  return pages().find((p) => p.id === id) || pages()[0];
}

function pageItems() {
  const all = Array.isArray(state.data?.items) ? state.data.items : [];
  if (state.page === "all") return all;
  return all.filter((item) => String(item.page_id || "all") === state.page);
}

function filteredItems() {
  if (state.filter === "done") return pageItems().filter((i) => i.done && !i.deleted_at);
  if (state.filter === "deleted") return pageItems().filter((i) => i.deleted_at);
  return pageItems().filter((i) => !i.done && !i.deleted_at);
}

function renderPageTabs() {
  const nav = $("page-tabs");
  nav.textContent = "";
  for (const page of pages()) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = page.name + (page.kind === "note" ? " · 正文" : "");
    if (page.id === state.page) button.classList.add("active");
    button.addEventListener("click", () => {
      state.page = page.id;
      state.filter = "pending";
      render();
    });
    nav.appendChild(button);
  }
}

function countFor(kind) {
  const list = pageItems();
  if (kind === "done") return list.filter((i) => i.done && !i.deleted_at).length;
  if (kind === "deleted") return list.filter((i) => i.deleted_at).length;
  return list.filter((i) => !i.done && !i.deleted_at).length;
}

function renderCounts() {
  $("count-pending").textContent = countFor("pending");
  $("count-done").textContent = countFor("done");
  $("count-deleted").textContent = countFor("deleted");
  for (const button of document.querySelectorAll("#filters button")) {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  }
}

function pageName(item) {
  return String(pageById(String(item.page_id || "all")).name || "全部");
}

function actionButton(text, handler, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (danger) button.classList.add("danger");
  button.addEventListener("click", handler);
  return button;
}

function renderTask(item) {
  const li = document.createElement("li");
  li.className = "task";
  if (item.deleted_at) li.classList.add("deleted");
  else if (item.done) li.classList.add("done");

  const check = document.createElement("label");
  check.className = "check";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = Boolean(item.done);
  box.disabled = Boolean(item.deleted_at);
  box.setAttribute("aria-label", item.done ? "标记未完成" : "标记完成");
  box.addEventListener("change", () => toggleItem(item));
  check.appendChild(box);

  const body = document.createElement("div");
  body.className = "body";
  const text = document.createElement("div");
  text.className = "text";
  text.textContent = String(item.text || "");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = pageName(item);
  if (item.deleted_at) meta.textContent += " · 已删除";
  else if (item.done && item.done_at) meta.textContent += " · 已完成";
  body.append(text, meta);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  if (item.deleted_at) {
    actions.append(
      actionButton("恢复", () => restoreItem(item)),
      actionButton("彻底删除", () => permanentDelete(item), true),
    );
  } else {
    actions.append(
      actionButton("改名", () => renameItem(item)),
      actionButton("删除", () => deleteItem(item), true),
    );
  }

  li.append(check, body, actions);
  return li;
}

function render() {
  if (!state.data) {
    $("task-panel").classList.remove("hidden");
    $("note-panel").classList.add("hidden");
    return;
  }
  const page = pageById(state.page);
  $("app-title").textContent = String(state.data?.settings?.title || "桌面便签");
  renderPageTabs();
  renderCounts();

  if (page.kind === "note") {
    $("task-panel").classList.add("hidden");
    $("note-panel").classList.remove("hidden");
    $("note-title").textContent = page.name;
    const html = String(page.note_html || "<p style='color:#8b8275'>这一页还没有正文。</p>");
    $("note-frame").srcdoc =
      "<!doctype html><meta charset='utf-8'><style>" +
      "body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#3f3a33;" +
      "line-height:1.7;padding:18px;background:#fff;word-break:break-word}" +
      "img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>" + html;
    $("add-form").classList.add("hidden");
    return;
  }

  $("task-panel").classList.remove("hidden");
  $("note-panel").classList.add("hidden");
  $("add-form").classList.remove("hidden");
  renderAddPages();
  const list = $("task-list");
  list.textContent = "";
  const items = filteredItems();
  $("empty").classList.toggle("hidden", items.length > 0);
  for (const item of items) list.appendChild(renderTask(item));
}

function renderAddPages() {
  const select = $("new-page");
  select.textContent = "";
  for (const page of pages()) {
    if (page.kind === "note") continue;
    const option = document.createElement("option");
    option.value = page.id;
    option.textContent = page.name;
    select.appendChild(option);
  }
  const wanted = state.page !== "all" ? state.page : "day";
  const exists = [...select.options].some((o) => o.value === wanted);
  select.value = exists ? wanted : (select.options[0]?.value || "all");
}

function ensureData() {
  if (!state.data) {
    state.data = {
      version: 1,
      settings: { title: "我的便签", pages: [], current_page: "all" },
      items: [],
    };
  }
  if (!Array.isArray(state.data.items)) state.data.items = [];
  if (!state.data.settings) state.data.settings = {};
  if (!Array.isArray(state.data.settings.pages)) state.data.settings.pages = [];
}

async function load() {
  if (!config.endpoint || !config.token) {
    setStatus("未连接");
    openDrawer();
    return;
  }
  setStatus("正在读取云端…");
  try {
    const response = await api();
    if (!response.ok) throw new Error(`读取失败：HTTP ${response.status}`);
    const remote = await response.json();
    state.revision = Number(remote.revision || 0);
    state.data = remote.data || null;
    ensureData();
    state.loaded = true;
    state.dirty = false;
    const pageIds = pages().map((p) => p.id);
    if (!pageIds.includes(state.page)) state.page = pageIds[0] || "all";
    setStatus(`已连接 · 版本 ${state.revision}`, "ok");
    render();
  } catch (error) {
    setStatus("连接失败", "err");
    toast(String(error.message || error), true);
  }
}

async function save() {
  ensureData();
  if (!config.endpoint || !config.token) {
    openDrawer();
    return false;
  }
  if (state.busy) return false;
  state.busy = true;
  setStatus("正在同步…");
  try {
    let base = state.revision;
    let payload = {
      version: 1,
      settings: {
        title: String(state.data.settings.title || "我的便签"),
        pages: pages(),
        current_page: String(state.data.settings.current_page || "all"),
      },
      items: state.data.items,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const request = await fetch(apiUrl(), {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${String(config.token || "").trim()}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ base_revision: base, device: "web", data: payload }),
      });
      if (response.status === 401) throw new Error("同步密钥不正确（401）");
      if (response.status === 409) {
        const remote = await request.json();
        state.revision = Number(remote.revision || 0);
        ensureData();
        state.data.items = mergeItems(state.data.items, remote.data?.items || []);
        if (Array.isArray(remote.data?.settings?.pages) && remote.data.settings.pages.length) {
          state.data.settings.pages = remote.data.settings.pages;
          state.data.settings.title = remote.data.settings.title || state.data.settings.title;
        }
        payload = {
          version: 1,
          settings: {
            title: String(state.data.settings.title || "我的便签"),
            pages: pages(),
            current_page: String(state.data.settings.current_page || "all"),
          },
          items: state.data.items,
        };
        base = state.revision;
        continue;
      }
      if (!request.ok) {
        const detail = await request.json().catch(() => ({}));
        throw new Error(detail.error || `保存失败：HTTP ${request.status}`);
      }
      const result = await request.json();
      state.revision = Number(result.revision || base + 1);
      state.dirty = false;
      setStatus(`已同步 · 版本 ${state.revision}`, "ok");
      render();
      state.busy = false;
      return true;
    }
    throw new Error("云端连续冲突，请稍后再试");
  } catch (error) {
    state.dirty = true;
    setStatus("同步失败", "err");
    toast(String(error.message || error), true);
    state.busy = false;
    return false;
  }
}

async function mutate(mutator) {
  ensureData();
  mutator();
  render();
  setStatus("有本地修改，正在保存…");
  await save();
}

function toggleItem(item) {
  mutate(() => {
    item.done = !item.done;
    item.done_at = item.done ? localIso() : null;
    item.updated_at = localIso();
  });
}

function deleteItem(item) {
  mutate(() => {
    item.deleted_at = localIso();
    item.updated_at = localIso();
  });
}

function restoreItem(item) {
  mutate(() => {
    item.deleted_at = null;
    item.updated_at = localIso();
  });
}

function permanentDelete(item) {
  if (!confirm(`彻底删除“${item.text}”？无法恢复。`)) return;
  mutate(() => {
    state.data.items = state.data.items.filter((entry) => entry.id !== item.id);
  });
}

function renameItem(item) {
  const next = prompt("修改事项文字", String(item.text || ""));
  if (next === null) return;
  const trimmed = next.trim().slice(0, 500);
  if (!trimmed) return;
  mutate(() => {
    item.text = trimmed;
    item.updated_at = localIso();
  });
}

async function addTask(event) {
  event.preventDefault();
  const input = $("new-text");
  const text = input.value.trim().slice(0, 500);
  if (!text) return;
  const pageId = $("new-page").value || "all";
  const now = localIso();
  const item = {
    id: "w" + ((window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : String(Date.now()).slice(-12)),
    text,
    page_id: pageId,
    created_at: now,
    recurrence: { unit: "none", interval: 1, weekdays: [], month_day: 0, time: "00:00", anchor: "" },
    done: false,
    done_at: null,
    next_at: null,
    timer_at: null,
    timer_fired: false,
    deleted_at: null,
    updated_at: now,
  };
  input.value = "";
  await mutate(() => {
    state.data.items.unshift(item);
    state.filter = "pending";
    if (pageId !== "all") state.page = pageId;
  });
}

function openDrawer() {
  $("endpoint-input").value = config.endpoint || defaultEndpoint();
  $("token-input").value = config.token;
  $("drawer").classList.add("open");
  $("drawer-mask").classList.remove("hidden");
}

function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawer-mask").classList.add("hidden");
}

function bind() {
  $("filters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    render();
  });
  $("add-form").addEventListener("submit", addTask);
  $("config-btn").addEventListener("click", openDrawer);
  $("close-drawer").addEventListener("click", closeDrawer);
  $("drawer-mask").addEventListener("click", closeDrawer);
  $("save-config").addEventListener("click", async () => {
    config.endpoint = $("endpoint-input").value.trim() || defaultEndpoint();
    config.token = $("token-input").value.trim();
    if (!config.endpoint || !config.token) {
      toast("请填写同步密钥", true);
      return;
    }
    localStorage.setItem(LS_ENDPOINT, config.endpoint);
    localStorage.setItem(LS_TOKEN, config.token);
    closeDrawer();
    state.loaded = false;
    await load();
  });
  $("clear-config").addEventListener("click", () => {
    localStorage.removeItem(LS_ENDPOINT);
    localStorage.removeItem(LS_TOKEN);
    config = { endpoint: defaultEndpoint(), token: "" };
    state.data = null;
    state.loaded = false;
    setStatus("未连接");
    closeDrawer();
    openDrawer();
  });
  $("sync-btn").addEventListener("click", async () => {
    if (state.busy) return;
    if (!state.loaded) {
      await load();
      return;
    }
    const ok = await save();
    if (ok) await load();
  });
}

bind();
if (config.endpoint && config.token) {
  load();
} else {
  setStatus("未连接");
  setTimeout(openDrawer, 300);
}
