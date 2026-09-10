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
          try {
            r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          } catch {
            return { error: 400 };
          }
          return { handler: r.handler, params };
        }
      }
      return null;
    },
  };
}

const MAX_BODY_SIZE = 15 * 1024 * 1024; // 15 MB — เผื่อไฟล์แนบ/รูปที่เข้ารหัส base64

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        aborted = true;
        req.destroy();
        reject(Object.assign(new Error('ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); }
    });
    req.on('error', () => { if (!aborted) resolve({}); });
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
