'use strict';

/**
 * router.js — ตัวจัดเส้นทางแบบเบา ด้วย Node core (คล้าย Express)
 */
function createRouter() {
  const routes = [];
  function add(method, path, handler) {
    const keys = [];
    const pattern = new RegExp(
      '^' + path.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$'
    );
    routes.push({ method, pattern, keys, handler });
  }
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, url) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.pattern.exec(url);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          return { handler: r.handler, params };
        }
      }
      return null;
    },
  };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

module.exports = { createRouter, readJsonBody, sendJson, sendHtml };
