'use strict';

/**
 * thaiid.js — ตรวจสอบความถูกต้องของเลขประจำตัวผู้เสียภาษี 13 หลัก
 * -------------------------------------------------------------
 * ใช้ได้ทั้งเลขบัตรประชาชน (บุคคลธรรมดา) และเลขทะเบียนนิติบุคคล
 * เพราะทั้งสองใช้สูตรตรวจสอบหลักสุดท้าย (check digit) แบบเดียวกัน
 *
 *   ผลรวม = Σ (หลักที่ i × (13 - i))   เมื่อ i = 0..11
 *   หลักตรวจสอบ = (11 - (ผลรวม mod 11)) mod 10
 *
 * หมายเหตุ PDPA: ระบบเก็บเฉพาะ "ตัวเลข 13 หลัก" เท่านั้น
 * ไม่มีการขอสำเนาบัตรประชาชน จึงไม่มีข้อมูลอ่อนไหวตามมาตรา 26
 * (ศาสนา / หมู่เลือด) เข้าสู่ระบบ
 */

/** เหลือเฉพาะตัวเลข */
function digitsOnly(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

/** ตรวจสอบว่าเลข 13 หลักถูกต้องตามสูตร check digit หรือไม่ */
function isValidTaxId(value) {
  const id = digitsOnly(value);
  if (id.length !== 13) return false;
  if (/^(\d)\1{12}$/.test(id)) return false; // เลขซ้ำกันหมด เช่น 1111111111111
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(id[12]);
}

/** อธิบายผลการตรวจเป็นภาษาไทย ใช้ส่งกลับเป็นข้อความ error */
function explain(value) {
  const id = digitsOnly(value);
  if (!id) return 'กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก';
  if (id.length !== 13) return `เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก (กรอกมา ${id.length} หลัก)`;
  if (!isValidTaxId(id)) return 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบตัวเลขอีกครั้ง';
  return '';
}

/** จัดรูปแบบให้อ่านง่ายบนเอกสาร เช่น 0-1055-61112-23-3 */
function format(value) {
  const id = digitsOnly(value);
  if (id.length !== 13) return String(value || '');
  return `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`;
}

/** ปิดบังบางส่วนสำหรับแสดงผลทั่วไป เช่น 0-1055-*****-**-3 */
function mask(value) {
  const id = digitsOnly(value);
  if (id.length !== 13) return String(value || '');
  return `${id[0]}-${id.slice(1, 5)}-*****-**-${id[12]}`;
}

module.exports = { isValidTaxId, explain, format, mask, digitsOnly };
