/**
 * 桌面便签 Pages Functions 2.1.39.1
 * 与网页同域提供 /api/health 与 /api/workspace，避免 workers.dev 被网络阻断。
 * KV 绑定：DESKNOTE_KV
 * Secret：AUTH_TOKEN
 */
const API_PATH = "/api/workspace";
const MAX_BODY_BYTES = 20 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

function authToken(request) {
  const raw = request.headers.get("Authorization") || "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

function emptyWorkspace() {
  return {
    revision: 0,
    updated_at: null,
    device: "",
    data: {
      version: 1,
      settings: { title: "我的便签", pages: [], current_page: "all" },
      items: [],
    },
  };
}

function validate(data) {
  if (!data || typeof data !== "object") return "data 必须是对象";
  if (!Array.isArray(data.items)) return "data.items 必须是数组";
  if (data.items.length > 5000) return "事项超过 5000 条";
  const settings = data.settings;
  if (!settings || typeof settings !== "object") return "data.settings 必须是对象";
  if (!Array.isArray(settings.pages)) return "settings.pages 必须是数组";
  for (const item of data.items) {
    if (!item || typeof item !== "object") return "事项格式不正确";
    if (!item.id || typeof item.id !== "string") return "事项缺少 id";
    if (typeof item.text !== "string") return "事项缺少文本";
  }
  return "";
}

async function readWorkspace(env) {
  const stored = await env.DESKNOTE_KV.get("workspace", "json");
  if (!stored || typeof stored !== "object" || !stored.data) return emptyWorkspace();
  return stored;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  const url = new URL(request.url);
  if (url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "desknote-pages",
      version: "2.1.39.1",
      auth_configured: Boolean(env.AUTH_TOKEN),
      kv_configured: Boolean(env.DESKNOTE_KV),
    });
  }
  if (url.pathname !== API_PATH) {
    return fail("not found", 404);
  }
  if (!env.AUTH_TOKEN) {
    return fail("服务端未配置 AUTH_TOKEN", 500);
  }
  if (!env.DESKNOTE_KV) {
    return fail("服务端未绑定 DESKNOTE_KV", 500);
  }
  const token = authToken(request);
  if (!token || token !== env.AUTH_TOKEN) {
    return fail("同步密钥不正确", 401);
  }

  if (request.method === "GET") {
    const workspace = await readWorkspace(env);
    return json(workspace);
  }
  if (request.method !== "PUT") {
    return fail("只支持 GET / PUT", 405);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return fail("数据超过 20 MB", 413);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("请求不是有效 JSON", 400);
  }
  const base = Number(body.base_revision ?? 0);
  if (!Number.isInteger(base) || base < 0) {
    return fail("base_revision 不正确", 400);
  }
  const invalid = validate(body.data);
  if (invalid) return fail(invalid, 400);

  const current = await readWorkspace(env);
  if (base !== current.revision) {
    return json(current, 409);
  }
  const next = {
    revision: current.revision + 1,
    updated_at: new Date().toISOString(),
    device: String(body.device || "").slice(0, 40),
    data: body.data,
  };
  await env.DESKNOTE_KV.put("workspace", JSON.stringify(next));
  return json({
    revision: next.revision,
    updated_at: next.updated_at,
    device: next.device,
  });
}
