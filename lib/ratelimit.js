'use strict';

/**
 * ratelimit.js — จำกัดจำนวนครั้งการเรียก endpoint ที่เสี่ยงถูกยิงถล่ม
 * (login, register, /api/otp/request) แบบ in-memory ไม่มี dependency ภายนอก
 * ใช้ sliding-window แบบง่าย: นับจำนวนครั้งต่อ key ภายในช่วงเวลาที่กำหนด
 *
 * หมายเหตุ: เก็บสถานะในหน่วยความจำของโปรเซสเดียว ถ้ารันหลายอินสแตนซ์
 * (เช่นหลัง load balancer) ต้องย้ายไปเก็บที่ store ร่วม (เช่น Redis) แทน
 */

const buckets = new Map(); // key -> { count, resetAt }

/** ตรวจ/นับการเรียกครั้งนี้ คืน { allowed, remaining, retryAfterSec } */
function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return {
    allowed: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
  };
}

// ล้าง bucket ที่หมดอายุแล้วเป็นระยะ กัน memory รั่ว
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
}, 5 * 60 * 1000).unref();

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { hit, clientIp };
