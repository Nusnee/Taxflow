'use strict';

/**
 * docview.js — สร้างเอกสารรูปแบบราชการเป็น HTML สำหรับพิมพ์/บันทึกเป็น PDF
 * -------------------------------------------------------------
 * ใช้ความสามารถ "พิมพ์เป็น PDF" ของเบราว์เซอร์ ซึ่งรองรับภาษาไทย
 * ได้สมบูรณ์โดยไม่ต้องฝังฟอนต์เอง เหมาะกับระบบต้นแบบ
 *
 * >> อนาคต: หากต้องการไฟล์ PDF/A-3 + XML จริงตามมาตรฐาน ETDA
 *    ให้เพิ่มการสร้างฝั่งเซิร์ฟเวอร์ด้วย pdfkit/node-signpdf และ XML builder
 */

const baht = (n) =>
  (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// รูปลายเซ็น/โลโก้ต้องเป็น data URI รูปภาพเท่านั้น (กัน XSS ผ่าน src="...")
// (เป็นด่านที่สองต่อจากการตรวจสอบตอนรับข้อมูลใน server.js — กันไว้กรณีข้อมูลเก่าที่ยังไม่ผ่านการตรวจ)
const SAFE_IMAGE_SRC_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
function safeImageSrc(v) {
  return typeof v === 'string' && SAFE_IMAGE_SRC_RE.test(v) ? v : '';
}

// แปลงจำนวนเงินเป็นตัวอักษรภาษาไทย (บาทถ้วน)
const profileLib = require('./profile');

function bahtText(amount) {
  const num = Math.round((Number(amount) || 0) * 100) / 100;
  const [intPart, decPart] = num.toFixed(2).split('.');
  const t = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const p = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];
  function conv(numStr) {
    let s = '';
    const len = numStr.length;
    for (let i = 0; i < len; i++) {
      const d = +numStr[i];
      const pos = (len - i - 1) % 6;
      if (d !== 0) {
        if (pos === 1 && d === 1) s += 'สิบ';
        else if (pos === 1 && d === 2) s += 'ยี่สิบ';
        else if (pos === 0 && d === 1 && len > 1 && i === len - 1) s += 'เอ็ด';
        else s += t[d] + p[pos];
      }
      if (pos === 0 && i !== len - 1) s += 'ล้าน';
    }
    return s;
  }
  let result = intPart === '0' ? 'ศูนย์บาท' : conv(intPart) + 'บาท';
  if (decPart === '00') result += 'ถ้วน';
  else result += conv(decPart) + 'สตางค์';
  return result;
}

const CSS = `
  @page { size: A4 portrait; margin: 12mm; }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Sarabun','TH Sarabun New','IBM Plex Sans Thai',sans-serif;color:#1a1a1a;font-size:13px;line-height:1.5;background:#f3f3f3;}
  .toolbar{max-width:210mm;margin:14px auto;display:flex;gap:10px;justify-content:flex-end;}
  .btn{font-family:inherit;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;}
  .btn-primary{background:#D94E00;color:#fff;}
  .btn-ghost{background:#fff;border:1px solid #ddd;color:#333;}
  .sheet{background:#fff;width:210mm;min-height:297mm;margin:0 auto 30px;padding:16mm 15mm;box-shadow:0 6px 30px rgba(0,0,0,.1);box-sizing:border-box;position:relative;overflow:hidden;}
  .brand-head{display:flex;align-items:flex-start;gap:14px;padding-bottom:12px;margin-bottom:14px;border-bottom:1px solid #eee;}
  .brand-head img.brand-logo{max-height:60px;max-width:190px;object-fit:contain;flex-shrink:0;}
  .brand-head .brand-info{font-size:11.5px;color:#555;line-height:1.55;}
  .brand-head .brand-info b{display:block;font-size:14.5px;color:#1a1a1a;font-weight:700;margin-bottom:2px;}
  .brand-seal{max-height:74px;max-width:110px;object-fit:contain;opacity:.92;}
  .seal-wrap{display:flex;justify-content:flex-end;align-items:center;margin-top:-8px;}
  .doc-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #D94E00;padding-bottom:16px;margin-bottom:18px;}
  .doc-title{font-size:20px;font-weight:700;}
  .doc-sub{font-size:12px;color:#666;margin-top:2px;}
  .doc-meta{text-align:right;font-size:12px;}
  .doc-meta .no{font-weight:700;font-size:14px;color:#D94E00;}
  .party-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:18px;}
  .party h4{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;}
  .party .name{font-weight:700;font-size:14px;}
  .party .detail{font-size:12px;color:#555;margin-top:2px;}
  table{width:100%;border-collapse:collapse;margin:14px 0;}
  th{background:#FFF3E8;text-align:left;font-size:11px;padding:9px 10px;border:1px solid #F0E4DA;}
  th.r,td.r{text-align:right;}
  td{padding:9px 10px;border:1px solid #F0E4DA;font-size:12px;}
  .totals{margin-left:auto;width:52%;margin-top:6px;}
  .totals .row{display:flex;justify-content:space-between;padding:6px 10px;font-size:13px;}
  .totals .row.grand{border-top:2px solid #D94E00;font-weight:700;font-size:15px;color:#D94E00;margin-top:4px;}
  .baht-text{background:#FFF3E8;border:1px solid #F0E4DA;border-radius:6px;padding:8px 12px;font-size:12px;margin:12px 0;text-align:center;}
  .sign-area{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:30px;}
  .sign-box{border:1px dashed #ccc;border-radius:8px;padding:14px;text-align:center;font-size:11px;color:#666;}
  .sign-box.digital{border-color:#1E8E5A;background:#E4F5EC;}
  .sign-box .status{color:#1E8E5A;font-weight:700;font-size:12px;margin-top:6px;}
  .qr{width:54px;height:54px;margin:8px auto;display:grid;grid-template-columns:repeat(5,1fr);gap:2px;}
  .qr span{background:#1a1a1a;}
  .qr span:nth-child(3n){background:#D94E00;}
  .footnote{font-size:10px;color:#999;text-align:center;margin-top:22px;border-top:1px solid #eee;padding-top:10px;}

  .dochead{display:flex;justify-content:space-between;align-items:flex-start;}
  .dochead h1{font-size:21px;margin:0;}
  .docsub{font-size:11px;color:#999;}
  .docmeta{text-align:right;font-size:12.5px;line-height:1.7;}
  .orange{color:#D94E00;}
  .rule{height:3px;background:#D94E00;margin:10px 0 16px;}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:18px;font-size:13px;margin-bottom:16px;}
  .plabel{font-size:10.5px;color:#999;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;}
  table.items{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;}
  table.items th{background:#FFF3E8;border:1px solid #F0D9C8;padding:8px;font-size:12px;}
  table.items td{border:1px solid #EEE;padding:8px;}
  table.items td.num,table.items th.num{text-align:right;}
  table.items tr.sum td{border:none;padding:6px 8px;font-size:12.5px;}
  table.items tr.sum td:first-child{text-align:right;color:#666;}
  table.items tr.total td{font-weight:700;font-size:14px;color:#D94E00;background:#FFF8F2;}
  .bahttext{background:#FFF3E8;text-align:center;font-weight:700;font-size:13px;padding:9px;border-radius:6px;margin-top:10px;}
  .clause{font-size:13px;line-height:1.9;margin-top:12px;}

  .sign-box .sig-img{max-height:46px;max-width:85%;display:block;margin:2px auto 4px;}
  .sign-box.signed-box{border-style:solid;border-color:#BDE5CE;background:#F4FBF7;}
  .sig-name{font-weight:700;font-size:12px;}
  .sig-role{font-size:10px;color:#1E8E5A;font-weight:600;}
  .sig-date{font-size:9.5px;color:#999;margin-top:2px;}
  .verify-mini{display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:14px;font-size:9.5px;color:#999;text-align:right;line-height:1.4;}
  .verify-mini svg{width:64px;height:64px;}

  .wm-cancel{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;z-index:50;transform:rotate(-22deg);-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .wm-cancel b{font-size:86px;font-weight:800;color:rgba(214,40,40,.22);border:6px solid rgba(214,40,40,.22);border-radius:18px;padding:6px 34px;letter-spacing:.08em;white-space:nowrap;}
  .wm-cancel small{margin-top:14px;font-size:15px;font-weight:700;color:rgba(214,40,40,.4);background:rgba(255,255,255,.6);padding:4px 14px;border-radius:8px;}
  .cancel-strip{background:#FBE9E9;border:1.5px solid #E8B4B4;color:#B42323;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:700;text-align:center;margin-bottom:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @media print{ body{background:#fff;margin:0;} .toolbar{display:none;} .sheet{box-shadow:none;margin:0;width:210mm;min-height:auto;padding:2mm 0;} }
`;

function toolbar() {
  return `<div class="toolbar">
    <button class="btn btn-ghost" onclick="window.close()">ปิด</button>
    <button class="btn btn-primary" onclick="window.print()">บันทึกเป็น PDF / พิมพ์</button>
  </div>`;
}

function issuerAddress(user) {
  return profileLib.formatAddress(user.addr || {}) || user.address || '';
}
// ประมวลรัษฎากร มาตรา 86/4 กำหนดให้ใบกำกับภาษีเต็มรูปต้องระบุว่าเป็น
// "สำนักงานใหญ่" หรือ "สาขาที่ ....." ของผู้ประกอบการจดทะเบียน
function branchLine(user) {
  const b = profileLib.branchLabel(user);
  return b ? `<div class="detail">${esc(b)}</div>` : '';
}

function sellerBlock(user) {
  return `<div class="party">
    <h4>ผู้ออกเอกสาร (ผู้ประกอบการ)</h4>
    <div class="name">${esc(user.companyName || user.displayName)}</div>
    <div class="detail">เลขประจำตัวผู้เสียภาษี: ${esc(user.taxId || '-')}</div>
    ${branchLine(user)}
    <div class="detail">${esc(issuerAddress(user))}</div>
  </div>`;
}

function qr() {
  return `<div class="qr">${Array.from({ length: 25 }).map(() => '<span></span>').join('')}</div>`;
}

/* ---------- e-Tax Invoice ---------- */
function renderEtax(doc, user, opts) {
  const rows = (doc.items || []).map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${baht(it.price)}</td>
      <td class="r">${baht((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
    </tr>`).join('');
  return sheet(`
    <div class="doc-head">
      <div><div class="doc-title">ใบกำกับภาษี / ใบเสร็จรับเงิน</div>
      <div class="doc-sub">e-Tax Invoice &nbsp;·&nbsp; ต้นฉบับ (Original)</div></div>
      <div class="doc-meta">เลขที่ <span class="no">${esc(doc.docNo)}</span><br>
      วันที่ ${new Date(doc.createdAt).toLocaleDateString('th-TH')}</div>
    </div>
    <div class="party-grid">
      ${sellerBlock(user)}
      <div class="party">
        <h4>ลูกค้า / ผู้ซื้อ</h4>
        <div class="name">${esc(doc.buyer || '-')}</div>
        <div class="detail">เลขประจำตัวผู้เสียภาษี: ${esc(doc.buyerTaxId || '-')}</div>
      </div>
    </div>
    <table>
      <thead><tr><th style="width:36px">#</th><th>รายการ</th><th class="r" style="width:70px">จำนวน</th><th class="r" style="width:110px">ราคา/หน่วย</th><th class="r" style="width:120px">จำนวนเงิน</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>มูลค่าก่อนภาษี</span><span>${baht(doc.base)}</span></div>
      <div class="row"><span>ภาษีมูลค่าเพิ่ม ${doc.vatRate}%</span><span>${baht(doc.vat)}</span></div>
      <div class="row grand"><span>จำนวนเงินรวมทั้งสิ้น</span><span>${baht(doc.total)}</span></div>
    </div>
    <div class="baht-text">(${bahtText(doc.total)})</div>
    ${signArea(doc, user, opts)}
  `, 'ใบกำกับภาษี ' + doc.docNo);
}

/* ---------- หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ / e-Withholding) ---------- */
function renderWithholding(doc, user, opts = {}) {
  opts = opts || {};
  const isEwht = doc.type === 'EWHT';
  const payer = isEwht ? (user.companyName || user.displayName) : (doc.payer || '-');
  const payerTax = isEwht ? user.taxId : '';
  const payee = isEwht ? (doc.payee || '-') : (user.displayName);
  const payeeTax = isEwht ? doc.payeeTaxId : (user.taxId || '');
  return sheet(`
    <div class="doc-head">
      <div><div class="doc-title">หนังสือรับรองการหักภาษี ณ ที่จ่าย</div>
      <div class="doc-sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ${isEwht ? '· e-Withholding Tax' : ''}</div></div>
      <div class="doc-meta">เลขที่ <span class="no">${esc(doc.docNo)}</span><br>
      วันที่ ${new Date(doc.createdAt).toLocaleDateString('th-TH')}</div>
    </div>
    <div class="party-grid">
      <div class="party">
        <h4>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ผู้จ่ายเงิน)</h4>
        <div class="name">${esc(payer)}</div>
        <div class="detail">เลขประจำตัวผู้เสียภาษี: ${esc(payerTax || '-')}</div>
      </div>
      <div class="party">
        <h4>ผู้ถูกหักภาษี ณ ที่จ่าย (ผู้รับเงิน)</h4>
        <div class="name">${esc(payee)}</div>
        <div class="detail">เลขประจำตัวผู้เสียภาษี: ${esc(payeeTax || '-')}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>ประเภทเงินได้</th><th class="r" style="width:130px">จำนวนเงินที่จ่าย</th><th class="r" style="width:130px">ภาษีที่หักและนำส่ง</th></tr></thead>
      <tbody>
        <tr>
          <td>${esc(doc.incomeType || 'เงินได้ตามมาตรา 40')} — ${esc(doc.description || 'ค่าจ้าง')}</td>
          <td class="r">${baht(doc.base)}</td>
          <td class="r">${baht(doc.wht)}</td>
        </tr>
        <tr>
          <td style="text-align:right;font-weight:700">รวม</td>
          <td class="r" style="font-weight:700">${baht(doc.base)}</td>
          <td class="r" style="font-weight:700;color:#D94E00">${baht(doc.wht)}</td>
        </tr>
      </tbody>
    </table>
    <div class="baht-text">ภาษีที่หักและนำส่ง (${bahtText(doc.wht)})</div>
    <p style="font-size:12px;margin:10px 0;">อัตราภาษีหัก ณ ที่จ่าย ${doc.rate}% &nbsp;·&nbsp; ยอดจ่ายสุทธิ ${baht(doc.net)} บาท</p>
    ${signArea(doc, user, opts)}
  `, 'หนังสือรับรองหัก ณ ที่จ่าย ' + doc.docNo);
}

function signArea(doc, user, opts = {}) {
  const cs = doc.counterpartySignature;
  const sig = doc.signature;
  const cpName = doc.party || doc.buyer || doc.payee || doc.payer || '';
  const sigBlock = (sObj, roleLabel, fallbackName) => sObj
    ? `<div class="sign-box signed-box">
        ${sObj.image ? `<img src="${safeImageSrc(sObj.image)}" class="sig-img" alt="ลายเซ็น">` : '<div style="height:34px"></div>'}
        <div class="sig-name">${esc(sObj.signerName)}</div>
        <div class="sig-role">${esc(roleLabel)} · ✓ ลงนามดิจิทัลแล้ว</div>
        <div class="sig-date">${new Date(sObj.signedAt).toLocaleString('th-TH')}</div>
      </div>`
    : `<div class="sign-box">
        <div style="height:34px"></div>
        ลงชื่อ ..............................................<br>${esc(roleLabel)}
        ${fallbackName ? `<div class="sig-date">(${esc(fallbackName)})</div>` : ''}
      </div>`;
  const qrBlock = opts.qrSvg
    ? `<div class="verify-mini">${opts.qrSvg}<div>สแกน QR<br>ตรวจสอบเอกสาร</div></div>` : '';
  const sealBlock = (opts.brand && opts.brand.seal)
    ? `<div class="seal-wrap"><img src="${safeImageSrc(opts.brand.seal)}" class="brand-seal" alt="ตราประทับบริษัท"></div>` : '';
  return `${sealBlock}<div class="sign-area">
    ${sigBlock(cs, cs && cs.signAs ? cs.signAs : 'ผู้รับเงิน / คู่สัญญา', cpName)}
    ${sigBlock(sig, 'ผู้มีอำนาจลงนาม (ผู้ออกเอกสาร)', user.companyName || user.displayName)}
  </div>
  ${qrBlock}
  ${opts.attachmentsHtml || ''}`;
}

function attachmentsHtml(attachments) {
  if (!attachments || !attachments.length) return '';
  const KIND = { receipt: 'ใบเสร็จ', invoice: 'ใบกำกับภาษี', wht: 'หนังสือรับรองหัก ณ ที่จ่าย', payment: 'หลักฐานการโอนเงิน', other: 'อื่นๆ' };
  const rows = attachments.map((a) => `<li style="font-size:11px;color:#555">${esc(KIND[a.kind] || a.kind)} — ${esc(a.filename)} (${Math.round((a.size || 0) / 1024)} KB)</li>`).join('');
  return `<div style="margin-top:18px;border-top:1px solid #eee;padding-top:10px">
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">เอกสารแนบ (${attachments.length})</div>
    <ul style="margin:0;padding-left:16px">${rows}</ul></div>`;
}

function sheet(inner, title) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${CSS}</style></head><body>
  ${toolbar()}
  <div class="sheet">${inner}
    <div class="footnote">เอกสารนี้จัดทำโดยระบบ TaxFlow (ระบบต้นแบบเพื่อการศึกษา) — โครงสร้างข้อมูลอ้างอิงมาตรฐาน มพศ. 3-2560 ของ ETDA · ยังไม่ได้นำส่งเข้าระบบจริงของกรมสรรพากร</div>
  </div>
  <script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),400)});</script>
  </body></html>`;
}

/* ---------- เอกสารธุรกิจทั่วไป (ใบเสร็จ/ใบแจ้งหนี้/ใบเสนอราคา/PO/ใบส่งมอบงาน/ใบสำคัญจ่าย) ---------- */
const BIZ_META = {
  RECEIPT:   { title: 'ใบเสร็จรับเงิน', sub: 'Receipt', party: 'ได้รับเงินจาก', totalLabel: 'รวมเงินที่ได้รับ' },
  INVOICE:   { title: 'ใบแจ้งหนี้', sub: 'Invoice', party: 'เรียกเก็บจาก', totalLabel: 'รวมยอดที่ต้องชำระ' },
  QUOTATION: { title: 'ใบเสนอราคา', sub: 'Quotation', party: 'เสนอต่อ', totalLabel: 'รวมราคาเสนอ' },
  PO:        { title: 'ใบสั่งซื้อ', sub: 'Purchase Order (PO)', party: 'สั่งซื้อจาก', totalLabel: 'รวมมูลค่าสั่งซื้อ' },
  DELIVERY:  { title: 'ใบส่งมอบงาน', sub: 'Delivery Note', party: 'ส่งมอบให้', totalLabel: 'มูลค่างานที่ส่งมอบ', extra: 'ผู้รับได้ตรวจรับงานตามรายการข้างต้นครบถ้วนแล้ว' },
  PAYMENT:   { title: 'ใบสำคัญจ่าย / หลักฐานการชำระเงิน', sub: 'Payment Voucher', party: 'จ่ายให้แก่', totalLabel: 'รวมเงินที่ชำระ' },
};

function renderBusiness(doc, user, opts = {}) {
  const m = BIZ_META[doc.type] || BIZ_META.INVOICE;
  const items = Array.isArray(doc.items) && doc.items.length ? doc.items : [{ name: doc.description || 'รายการ', qty: 1, price: doc.base }];
  const rows = items.map((it, i) => {
    const amt = (Number(it.qty) || 0) * (Number(it.price) || 0);
    return `<tr><td style="text-align:center">${i + 1}</td><td>${esc(it.name)}</td>
      <td class="num">${it.qty}</td><td class="num">${money(it.price)}</td><td class="num">${money(amt)}</td></tr>`;
  }).join('');
  const vatRow = Number(doc.vat) > 0
    ? `<tr class="sum"><td colspan="4">ภาษีมูลค่าเพิ่ม ${doc.vatRate}%</td><td class="num">${money(doc.vat)}</td></tr>`
    : '';
  const payMethod = doc.type === 'PAYMENT' && doc.method
    ? `<div style="margin-top:10px;font-size:13px;">ชำระโดย: <b>${esc(doc.method)}</b>${doc.payRef ? ' · อ้างอิง: ' + esc(doc.payRef) : ''}</div>` : '';
  const inner = `
    ${docHead(m.title, m.sub, doc)}
    ${partyBlock(user, doc, m.party)}
    <table class="items">
      <thead><tr><th style="width:34px">ลำดับ</th><th>รายการ</th><th class="num" style="width:60px">จำนวน</th><th class="num" style="width:100px">ราคา/หน่วย</th><th class="num" style="width:110px">จำนวนเงิน</th></tr></thead>
      <tbody>${rows}
        <tr class="sum"><td colspan="4">รวมเป็นเงิน</td><td class="num">${money(doc.base)}</td></tr>
        ${vatRow}
        <tr class="sum total"><td colspan="4">${m.totalLabel}</td><td class="num">${money(doc.total || doc.base)}</td></tr>
      </tbody>
    </table>
    <div class="bahttext">(${bahtText(doc.total || doc.base)})</div>
    ${payMethod}
    ${doc.note ? `<div style="margin-top:10px;font-size:12.5px;color:#555">หมายเหตุ: ${esc(doc.note)}</div>` : ''}
    ${bizDetailLine(doc)}
    ${m.extra ? `<div style="margin-top:8px;font-size:12px;color:#888">${m.extra}</div>` : ''}
    ${signArea(doc, user, opts)}`;
  return sheet(inner, `${m.title} ${doc.docNo}`);
}


function bizDetailLine(doc) {
  const lines = [];
  if (doc.type === 'INVOICE' && doc.dueDate) lines.push('กำหนดชำระภายในวันที่ ' + thDate(doc.dueDate));
  if (doc.type === 'QUOTATION') lines.push('กำหนดยืนราคา ' + (doc.validDays || 30) + ' วันนับจากวันที่ในเอกสาร');
  if (doc.type === 'PO' && doc.deliveryDate) lines.push('กำหนดส่งมอบภายในวันที่ ' + thDate(doc.deliveryDate));
  if (doc.type === 'DELIVERY') {
    if (doc.phase) lines.push('งวดงาน: ' + esc(doc.phase));
    if (doc.deliveryDate) lines.push('ส่งมอบเมื่อวันที่ ' + thDate(doc.deliveryDate));
  }
  return lines.length ? `<div style="margin-top:8px;font-size:12.5px;color:#555">${lines.join(' · ')}</div>` : '';
}

/* ---------- สัญญาจ้าง ---------- */
function renderContract(doc, user, opts = {}) {
  const isBrand = doc.type === 'CONTRACT_BRAND';
  const title = isBrand ? 'สัญญาจ้างบริหารงานโฆษณา (กับแบรนด์)' : 'สัญญาจ้างผลิตเนื้อหา (Influencer)';
  const employer = isBrand ? (doc.party || '') : (user.companyName || user.displayName);
  const contractor = isBrand ? (user.companyName || user.displayName) : (doc.party || '');
  const inner = `
    ${docHead(title, 'Service Agreement', doc)}
    <div style="font-size:13.5px;line-height:2;margin-top:8px;">
      สัญญาฉบับนี้ทำขึ้นเมื่อวันที่ ${thDate(doc.createdAt)} ระหว่าง
      <b>${esc(employer)}</b> (ต่อไปเรียกว่า "ผู้ว่าจ้าง") ฝ่ายหนึ่ง กับ
      <b>${esc(contractor)}</b> ${doc.partyTaxId ? '(เลขประจำตัวผู้เสียภาษี ' + esc(doc.partyTaxId) + ')' : ''} (ต่อไปเรียกว่า "ผู้รับจ้าง") อีกฝ่ายหนึ่ง ทั้งสองฝ่ายตกลงกันดังนี้
    </div>
    <div class="clause"><b>ข้อ 1. ขอบเขตงาน</b><br>${esc(doc.scope || '-').replace(/\n/g, '<br>')}</div>
    <div class="clause"><b>ข้อ 2. ค่าตอบแทน</b><br>ผู้ว่าจ้างตกลงชำระค่าตอบแทนรวมทั้งสิ้น ${money(doc.base)} บาท (${bahtText(doc.base)}) ${esc(doc.paymentTerms || 'โดยชำระภายใน 30 วันหลังส่งมอบงานครบถ้วน')} ทั้งนี้ผู้ว่าจ้างมีหน้าที่หักภาษี ณ ที่จ่ายตามอัตราที่กฎหมายกำหนดและออกหนังสือรับรอง (50 ทวิ) ให้ผู้รับจ้าง</div>
    <div class="clause"><b>ข้อ 3. ระยะเวลา</b><br>เริ่ม ${doc.startDate ? thDate(doc.startDate) : '-'} สิ้นสุด ${doc.endDate ? thDate(doc.endDate) : '-'}</div>
    <div class="clause"><b>ข้อ 4. ลิขสิทธิ์และการใช้ผลงาน</b><br>ผลงานที่ผลิตขึ้นตามสัญญานี้ ผู้ว่าจ้างมีสิทธิ์ใช้เผยแพร่ตามช่องทางและระยะเวลาที่ตกลง ส่วนลิขสิทธิ์อื่นใดยังคงเป็นของผู้รับจ้าง เว้นแต่ตกลงเป็นลายลักษณ์อักษรเป็นอย่างอื่น (ตาม พ.ร.บ.ลิขสิทธิ์ พ.ศ. 2537)</div>
    <div class="clause"><b>ข้อ 5. ข้อมูลส่วนบุคคล</b><br>คู่สัญญาตกลงเก็บ ใช้ และเปิดเผยข้อมูลส่วนบุคคลของอีกฝ่ายเท่าที่จำเป็นต่อการปฏิบัติตามสัญญา ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562</div>
    ${doc.note ? `<div class="clause"><b>ข้อ 6. ข้อตกลงเพิ่มเติม</b><br>${esc(doc.note).replace(/\n/g, '<br>')}</div>` : ''}
    ${contractSignArea(doc, employer, contractor, isBrand)}`;
  return sheet(inner, `${title} ${doc.docNo}`);
}


function contractSignArea(doc, employer, contractor, isBrand) {
  // ผู้ออกเอกสาร: CONTRACT_INF = ผู้ว่าจ้าง · CONTRACT_BRAND = ผู้รับจ้าง (เอเจนซี่)
  const issuerSig = doc.signature;
  const cpSig = doc.counterpartySignature;
  const empSig = isBrand ? cpSig : issuerSig;
  const conSig = isBrand ? issuerSig : cpSig;
  const box = (sObj, role, name) => `<div class="sign-box ${sObj ? 'signed-box' : ''}">
    ${sObj && sObj.image ? `<img src="${safeImageSrc(sObj.image)}" class="sig-img">` : '<div style="height:40px"></div>'}
    ลงชื่อ ..............................................<br>${role}<br><small>(${esc(sObj ? sObj.signerName : name)})</small>
    ${sObj ? `<div class="sig-date">✓ ลงนามดิจิทัล · ${new Date(sObj.signedAt).toLocaleString('th-TH')}</div>` : ''}
  </div>`;
  return `<div class="sign-area" style="margin-top:34px">
    ${box(empSig, 'ผู้ว่าจ้าง', employer)}
    ${box(conSig, 'ผู้รับจ้าง', contractor)}
  </div>`;
}


/* ---------- หนังสือมอบอำนาจ (POA) ---------- */
function renderPOA(doc, user, opts = {}) {
  // ผู้ออกเป็น corporate → ผู้ออกคือผู้มอบ · ผู้ออกเป็น agency → ผู้ออกคือผู้รับมอบ
  const issuerIsGrantor = doc.issuerRole !== 'agency';
  const grantor = issuerIsGrantor ? (user.companyName || user.displayName) : (doc.party || '');
  const grantee = issuerIsGrantor ? (doc.party || '') : (user.companyName || user.displayName);
  const grantorSig = issuerIsGrantor ? doc.signature : doc.counterpartySignature;
  const granteeSig = issuerIsGrantor ? doc.counterpartySignature : doc.signature;
  const box = (sObj, role, name, sealNote) => `<div class="sign-box ${sObj ? 'signed-box' : ''}">
    ${sObj && sObj.image ? `<img src="${safeImageSrc(sObj.image)}" class="sig-img">` : '<div style="height:40px"></div>'}
    ลงชื่อ ..............................................<br>${role}<br><small>(${esc(sObj ? sObj.signerName : name)})</small>
    ${sealNote ? '<div class="sig-date">ประทับตราบริษัท (ถ้ามี)</div>' : ''}
    ${sObj ? `<div class="sig-date">✓ ลงนามดิจิทัล · ${new Date(sObj.signedAt).toLocaleString('th-TH')}</div>` : ''}
  </div>`;
  const inner = `
    ${docHead('หนังสือมอบอำนาจ', 'Power of Attorney', doc)}
    <div style="font-size:13.5px;line-height:2;margin-top:8px;">
      เขียนที่ ${esc(user.address || '.......................')}<br>
      วันที่ ${thDate(doc.createdAt)}<br><br>
      โดยหนังสือฉบับนี้ ข้าพเจ้า <b>${esc(grantor)}</b> ${doc.issuerRole !== 'agency' && user.taxId ? '(เลขประจำตัวผู้เสียภาษี ' + esc(user.taxId) + ')' : doc.partyTaxId ? '(เลขประจำตัวผู้เสียภาษี ' + esc(doc.partyTaxId) + ')' : ''}
      ("ผู้มอบอำนาจ") ขอมอบอำนาจให้ <b>${esc(grantee)}</b> ("ผู้รับมอบอำนาจ") เป็นผู้มีอำนาจกระทำการแทนข้าพเจ้าในเรื่องดังต่อไปนี้
    </div>
    <div class="clause"><b>ขอบเขตอำนาจที่มอบ</b><br>${esc(doc.scope || '-').replace(/\n/g, '<br>')}</div>
    <div class="clause"><b>ระยะเวลา</b><br>มีผลตั้งแต่วันที่ ${thDate(doc.createdAt)}${doc.effectiveUntil ? ' ถึงวันที่ ' + thDate(doc.effectiveUntil) : ' จนกว่าจะมีการเพิกถอนเป็นลายลักษณ์อักษร'}</div>
    <div class="clause">การใดที่ผู้รับมอบอำนาจได้กระทำไปภายในขอบเขตแห่งหนังสือนี้ ให้ถือเสมือนว่าผู้มอบอำนาจได้กระทำด้วยตนเองทุกประการ จึงลงลายมือชื่อไว้เป็นหลักฐานต่อหน้าพยาน</div>
    ${doc.note ? `<div class="clause"><b>หมายเหตุ</b><br>${esc(doc.note)}</div>` : ''}
    <div class="sign-area" style="margin-top:30px">
      ${box(grantorSig, 'ผู้มอบอำนาจ', grantor, true)}
      ${box(granteeSig, 'ผู้รับมอบอำนาจ', grantee, false)}
    </div>
    <div class="sign-area" style="margin-top:16px">
      <div class="sign-box"><div style="height:28px"></div>ลงชื่อ ..............................................<br>พยาน</div>
      <div class="sign-box"><div style="height:28px"></div>ลงชื่อ ..............................................<br>พยาน</div>
    </div>
    <div style="margin-top:12px;font-size:11px;color:#888">หมายเหตุ: การมอบอำนาจทั่วไปติดอากรแสตมป์ 10 บาท / มอบอำนาจให้กระทำการมากกว่าครั้งเดียว 30 บาท (ตามบัญชีอัตราอากรแสตมป์)</div>`;
  return sheet(inner, `หนังสือมอบอำนาจ ${doc.docNo}`);
}

/* ---------- ตัวช่วยส่วนหัว/คู่สัญญา ---------- */
function docHead(title, sub, doc) {
  return `<div class="dochead">
    <div><h1>${esc(title)}</h1><div class="docsub">${esc(sub)}</div></div>
    <div class="docmeta">เลขที่ <b class="orange">${esc(doc.docNo)}</b><br>วันที่ ${thDate(doc.createdAt)}</div>
  </div><div class="rule"></div>`;
}
function partyBlock(user, doc, partyLabel) {
  return `<div class="parties">
    <div><div class="plabel">ผู้ออกเอกสาร</div><b>${esc(user.companyName || user.displayName)}</b><br><small>เลขประจำตัวผู้เสียภาษี: ${esc(user.taxId || '-')}${profileLib.branchLabel(user) ? ' · ' + esc(profileLib.branchLabel(user)) : ''}${issuerAddress(user) ? '<br>' + esc(issuerAddress(user)) : ''}</small></div>
    <div><div class="plabel">${esc(partyLabel)}</div><b>${esc(doc.party || doc.buyer || doc.payee || doc.payer || '-')}</b><br><small>เลขประจำตัวผู้เสียภาษี: ${esc(doc.partyTaxId || doc.buyerTaxId || doc.payeeTaxId || '-')}${doc.partyAddress ? '<br>' + esc(doc.partyAddress) : ''}</small></div>
  </div>`;
}
function thDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}
function money(n) { return (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const BIZ_TYPES = Object.keys(BIZ_META);

function render(doc, user, ctx = {}) {
  const opts = {
    qrSvg: ctx.qrSvg || null,
    attachmentsHtml: attachmentsHtml(ctx.attachments),
    brand: ctx.brand || null,
  };
  let html = renderInner(doc, user, opts);
  // หัวกระดาษที่ผู้ใช้ตั้งค่าเอง (โลโก้บริษัท) — แทรกไว้บนสุดของหน้ากระดาษ
  const bh = brandHeader(user, ctx.brand);
  if (bh) html = html.replace('<div class="sheet">', '<div class="sheet">' + bh);
  if (doc.status !== 'cancelled') return html;
  // เอกสารถูกยกเลิก: ประทับลายน้ำสีแดง ห้ามนำไปใช้งาน
  const wm = `<div class="wm-cancel"><b>ยกเลิกแล้ว</b><small>เอกสารนี้ถูกยกเลิก ไม่สามารถนำไปใช้อ้างอิงหรือใช้งานตามกฎหมายได้</small></div>`;
  const strip = `<div class="cancel-strip">เอกสารฉบับนี้ถูกยกเลิกเมื่อ ${new Date(doc.updatedAt || Date.now()).toLocaleString('th-TH')} — ห้ามนำไปใช้งานต่อ</div>`;
  return html.replace('<div class="sheet">', '<div class="sheet">' + wm + strip);
}

/**
 * หัวกระดาษของผู้ประกอบการ — แสดงเฉพาะเมื่อผู้ใช้อัปโหลดโลโก้เอง
 * วางไว้เหนือเนื้อหาเอกสาร เพื่อไม่ให้บังรายการที่กฎหมายบังคับให้ปรากฏ
 * (ชื่อเอกสาร เลขที่ วันที่ ชื่อผู้ประกอบการ เลขผู้เสียภาษี และสาขา)
 */
function brandHeader(user, brand) {
  if (!brand || !brand.logo) return '';
  const name = user.companyName || user.displayName || '';
  const line2 = [
    user.taxId ? 'เลขประจำตัวผู้เสียภาษี ' + user.taxId : '',
    profileLib.branchLabel(user),
  ].filter(Boolean).join(' · ');
  return `<div class="brand-head">
    <img src="${safeImageSrc(brand.logo)}" class="brand-logo" alt="โลโก้ผู้ประกอบการ">
    <div class="brand-info"><b>${esc(name)}</b>${line2 ? esc(line2) + '<br>' : ''}${esc(issuerAddress(user))}</div>
  </div>`;
}

function renderInner(doc, user, opts) {
  if (doc.type === 'ETAX') return renderEtax(doc, user, opts);
  if (BIZ_TYPES.includes(doc.type)) return renderBusiness(doc, user, opts);
  if (doc.type === 'CONTRACT_INF' || doc.type === 'CONTRACT_BRAND') return renderContract(doc, user, opts);
  if (doc.type === 'POA') return renderPOA(doc, user, opts);
  return renderWithholding(doc, user, opts); // WHT และ EWHT
}

module.exports = { render, bahtText };
