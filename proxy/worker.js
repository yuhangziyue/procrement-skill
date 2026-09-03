/**
 * 小采 · Coding Plan CORS 代理（Cloudflare Worker，免费额度 10 万次/天）
 *
 * 为什么需要它：火山方舟 Coding Plan 端点 /api/coding/v3 的 CORS 预检不放行 Authorization 头
 * （2026-09-03 实测 access-control-allow-headers: Origin,Content-Length,Content-Type），
 * 浏览器直连必被拦。本 Worker 做两件事：① 透传请求到上游；② 补齐 CORS 头。
 *
 * 两种 Key 模式（二选一，由环境变量决定）：
 *  - 透传模式（默认）：前端在 Authorization 头里带自己的 Key，Worker 原样转发，不存任何 Key。
 *  - 托管模式：设置 secret ARK_API_KEY 后，Worker 用自己的 Key 调上游，前端只需带 X-Proxy-Token
 *    （与 secret PROXY_TOKEN 比对）——适合站长自用、不想把 Key 填进浏览器的场景。
 *
 * 部署：npm i -g wrangler && wrangler login && wrangler deploy
 *      （托管模式再执行 wrangler secret put ARK_API_KEY / wrangler secret put PROXY_TOKEN）
 */

const UPSTREAM = "https://ark.cn-beijing.volces.com/api/coding/v3";

// 允许的前端来源：GitHub Pages + 本地开发。只回显命中的 origin，不用 *（带凭据时 * 无效）。
const ALLOW_ORIGINS = [
  "https://yuhangziyue.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Proxy-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response("method not allowed", { status: 405, headers: cors });
    }

    // 只允许打 chat/completions 与 models，别把 Worker 变成通用代理
    const url = new URL(request.url);
    if (!/^\/(chat\/completions|models)$/.test(url.pathname)) {
      return new Response("not found", { status: 404, headers: cors });
    }

    // 决定上游用哪把 Key
    let auth = request.headers.get("Authorization") || "";
    if (env.ARK_API_KEY) {
      const token = request.headers.get("X-Proxy-Token") || "";
      if (!env.PROXY_TOKEN || token !== env.PROXY_TOKEN) {
        return new Response(JSON.stringify({ error: { code: "ProxyUnauthorized", message: "bad proxy token" } }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      auth = `Bearer ${env.ARK_API_KEY}`;
    }
    if (!auth) {
      return new Response(JSON.stringify({ error: { code: "MissingKey", message: "no Authorization header" } }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: {
        Authorization: auth,
        "Content-Type": request.headers.get("Content-Type") || "application/json",
        Accept: request.headers.get("Accept") || "*/*",
      },
      body: request.method === "POST" ? request.body : undefined,
    });

    // 流式响应（SSE）原样透传 body，只改头
    const headers = new Headers(upstream.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
