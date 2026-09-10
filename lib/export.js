'use strict';
/**
 * export.js — ส่งออกรายการเอกสารเป็น CSV และ Excel (ไม่มี dependency)
 * - CSV: มี BOM ให้ Excel อ่านภาษาไทยถูกต้อง
 * - Excel: ตาราง HTML แบบ .xls ที่ Microsoft Excel เปิดได้
 *
 * ทั้งสองรูปแบบรองรับ "หัวรายงานของผู้ประกอบการ" (brand)
 *   { name, taxId, address, branch, logo }  โดย logo เป็น data URI
 * ผู้ใช้อัปโหลดโลโก้เองได้ที่หน้าโปรไฟล์ ระบบจะพิมพ์ลงหัวรายงานให้อัตโนมัติ
 */

const TYPE_LABEL = {
  WHT: 'หัก ณ ที่จ่าย (รับ)', ETAX: 'ใบกำกับภาษี', EWHT: 'หนังสือรับรองหัก ณ ที่จ่าย',
  RECEIPT: 'ใบเสร็จรับเงิน', INVOICE: 'ใบแจ้งหนี้', QUOTATION: 'ใบเสนอราคา', PO: 'ใบสั่งซื้อ',
  DELIVERY: 'ใบส่งมอบงาน', PAYMENT: 'ใบสำคัญจ่าย', CONTRACT_INF: 'สัญญาจ้าง Influencer', CONTRACT_BRAND: 'สัญญากับแบรนด์',
  CREDIT_NOTE: 'ใบลดหนี้', DEBIT_NOTE: 'ใบเพิ่มหนี้',
};
const STATUS_LABEL = {
  draft: 'แบบร่าง', pending: 'รอตรวจสอบ', approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก', archived: 'เก็บถาวร',
};

function rowsOf(docs) {
  return docs.map((d) => ({
    docNo: d.docNo || '',
    type: TYPE_LABEL[d.type] || d.type,
    status: STATUS_LABEL[d.status] || d.status || '',
    counterparty: d.party || d.buyer || d.payee || d.payer || '',
    date: (d.createdAt || '').slice(0, 10),
    base: Number(d.base || 0),
    tax: Number(['WHT', 'EWHT'].includes(d.type) ? d.wht || 0 : d.vat || 0),
    total: Number(['WHT', 'EWHT'].includes(d.type) ? d.net || 0 : d.total || 0),
  }));
}
const HEAD = ['เลขที่เอกสาร', 'ประเภท', 'สถานะ', 'คู่ค้า/ลูกค้า', 'วันที่', 'ฐานภาษี', 'ภาษี/VAT', 'ยอดรวม'];

/** หัวรายงานสำหรับไฟล์ CSV (โลโก้เป็นรูปภาพ จึงใส่ได้เฉพาะไฟล์ Excel) */
function csvHeadLines(brand) {
  if (!brand || !brand.name) return [];
  const lines = [`รายงานเอกสารภาษี - ${brand.name}`];
  const meta = [];
  if (brand.taxId) meta.push(`เลขประจำตัวผู้เสียภาษี ${brand.taxId}`);
  if (brand.branch) meta.push(brand.branch);
  if (meta.length) lines.push(meta.join('  '));
  if (brand.address) lines.push(brand.address);
  lines.push(`วันที่ออกรายงาน ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  lines.push('');
  return lines;
}

// กัน CSV/Excel formula injection: ถ้าค่าขึ้นต้นด้วย = + - @ (หรือ tab/CR ตามด้วยอักขระเหล่านี้)
// โปรแกรมสเปรดชีตจะตีความเป็นสูตรและรันได้ทันทีที่เปิดไฟล์ จึงต้องเติม ' นำหน้าเพื่อบังคับให้เป็นข้อความ
function sanitizeCsvValue(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function toCSV(docs, brand) {
  const esc = (v) => {
    const s = sanitizeCsvValue(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [...csvHeadLines(brand).map(esc), HEAD.join(',')];
  for (const r of rowsOf(docs)) {
    lines.push([r.docNo, r.type, r.status, r.counterparty, r.date, r.base.toFixed(2), r.tax.toFixed(2), r.total.toFixed(2)].map(esc).join(','));
  }
  return '\uFEFF' + lines.join('\r\n'); // BOM
}

function toXLS(docs, brand) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const b = brand || {};
  const logoCell = b.logo
    ? `<img src="${b.logo}" style="max-height:56px;max-width:200px" alt="">`
    : '';
  const brandMeta = [
    b.taxId ? `เลขประจำตัวผู้เสียภาษี ${esc(b.taxId)}` : '',
    b.branch ? esc(b.branch) : '',
  ].filter(Boolean).join(' &nbsp; ');
  const brandHead = b.name ? `
    <tr><td colspan="${HEAD.length}" style="border:none;padding:10px 6px 2px">
      ${logoCell}
    </td></tr>
    <tr><td colspan="${HEAD.length}" style="border:none;padding:0 6px;font-size:16px;font-weight:bold">${esc(b.name)}</td></tr>
    <tr><td colspan="${HEAD.length}" style="border:none;padding:0 6px;font-size:12px;color:#666">${brandMeta}</td></tr>
    <tr><td colspan="${HEAD.length}" style="border:none;padding:0 6px 2px;font-size:12px;color:#666">${esc(b.address || '')}</td></tr>
    <tr><td colspan="${HEAD.length}" style="border:none;padding:0 6px 12px;font-size:12px;color:#666">รายงานเอกสารภาษี · ออกเมื่อ ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
  ` : '';
  const th = HEAD.map((h) => `<th style="background:#FF6A00;color:#fff;border:1px solid #ccc;padding:6px">${esc(h)}</th>`).join('');
  const body = rowsOf(docs).map((r) =>
    `<tr>
      <td style="border:1px solid #ccc;padding:6px">${esc(sanitizeCsvValue(r.docNo))}</td>
      <td style="border:1px solid #ccc;padding:6px">${esc(r.type)}</td>
      <td style="border:1px solid #ccc;padding:6px">${esc(r.status)}</td>
      <td style="border:1px solid #ccc;padding:6px">${esc(sanitizeCsvValue(r.counterparty))}</td>
      <td style="border:1px solid #ccc;padding:6px">${esc(r.date)}</td>
      <td style="border:1px solid #ccc;padding:6px;text-align:right">${r.base.toFixed(2)}</td>
      <td style="border:1px solid #ccc;padding:6px;text-align:right">${r.tax.toFixed(2)}</td>
      <td style="border:1px solid #ccc;padding:6px;text-align:right">${r.total.toFixed(2)}</td>
    </tr>`).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
  <head><meta charset="UTF-8"></head>
  <body><table border="1" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
  <thead>${brandHead}<tr>${th}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

module.exports = { toCSV, toXLS };
