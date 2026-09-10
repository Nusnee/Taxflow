// common.js — ฟังก์ชันช่วยที่ใช้ร่วมทุกหน้า

const api = {
  async get(url) { return (await fetch(url)).json(); },
  async post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async put(url, body) {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
};

function baht(n) {
  return (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// escape ข้อความก่อนแทรกลง innerHTML — ใช้กับข้อมูลทุกอย่างที่มาจากผู้ใช้/คู่ค้า (กัน stored XSS)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, kind = 'ok') {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'toast ' + kind;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// หน้าเริ่มต้นของแต่ละบทบาท (ใช้ร่วมกันทุกหน้า เพื่อไม่ให้ตรรกะการ redirect กระจัดกระจาย)
function homeFor(role) {
  if (role === 'admin') return '/admin.html';
  if (role === 'creator') return '/creator.html';
  return '/agency.html';   // agency และ corporate ใช้หน้าเดียวกัน
}

// ข้อมูลโปรไฟล์ล่าสุด (ความครบถ้วน / สถานะยืนยันตัวตน) ที่ /api/auth/me ส่งมาด้วย
let PROFILE_META = null;

// ตรวจสอบว่าเข้าสู่ระบบแล้วหรือยัง + บทบาทถูกต้อง ถ้าไม่ redirect
async function guard(requiredRoles) {
  const r = await fetch('/api/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const data = await r.json();
  const user = data.user;
  PROFILE_META = data.profile || null;
  const allowed = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  if (requiredRoles && !allowed.includes(user.role)) {
    location.href = homeFor(user.role);
    return null;
  }
  return user;
}

// ปิดบังเลขบัญชีธนาคารก่อนแสดงผลในหน้าจอทั่วไป (PDPA — แสดงเท่าที่จำเป็น)
function maskAccount(no) {
  const d = String(no || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length < 4) return '****';
  return '*'.repeat(d.length - 4) + d.slice(-4);
}

// จัดรูปเลขประจำตัวผู้เสียภาษีให้อ่านง่าย
function formatTaxId(id) {
  const d = String(id || '').replace(/\D/g, '');
  if (d.length !== 13) return String(id || '');
  return `${d[0]}-${d.slice(1,5)}-${d.slice(5,10)}-${d.slice(10,12)}-${d[12]}`;
}

// อ่านไฟล์จาก input เป็น base64 (ใช้ร่วมกันทั้งอัปโหลดโลโก้และเอกสารยืนยันตัวตน)
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    fr.readAsDataURL(file);
  });
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
}

const DOC_LABEL = {
  WHT: 'หัก ณ ที่จ่าย (รับ)', ETAX: 'ใบกำกับภาษี', EWHT: 'หนังสือรับรองหัก ณ ที่จ่าย',
  RECEIPT: 'ใบเสร็จรับเงิน', INVOICE: 'ใบแจ้งหนี้', QUOTATION: 'ใบเสนอราคา',
  PO: 'ใบสั่งซื้อ (PO)', DELIVERY: 'ใบส่งมอบงาน', PAYMENT: 'ใบสำคัญจ่าย',
  CONTRACT_INF: 'สัญญาจ้าง Influencer', CONTRACT_BRAND: 'สัญญากับแบรนด์', POA: 'หนังสือมอบอำนาจ',
  CREDIT_NOTE: 'ใบลดหนี้', DEBIT_NOTE: 'ใบเพิ่มหนี้',
};
const STATUS_LABEL = { issued: 'ออกแล้ว', stored: 'จัดเก็บแล้ว' };
function badge(type) {
  const cls = { WHT: 'wht', ETAX: 'etax', EWHT: 'ewht' }[type] || 'wht';
  return `<span class="badge ${cls}">${DOC_LABEL[type] || type}</span>`;
}
function statusBadge(s) { return `<span class="badge ${s}">${STATUS_LABEL[s] || s}</span>`; }
function initials(name) { return (name || '?').trim().charAt(0).toUpperCase(); }


/* ---------- บทบาทผู้ใช้ ---------- */
const ROLE_LABEL = {
  creator: 'อินฟลูเอนเซอร์ / ครีเอเตอร์',
  corporate: 'บริษัท (Brand)',
  agency: 'เอเจนซี่โฆษณา',
};

/* ---------- หมวดคลังเอกสาร แยกตามบทบาท ---------- */
const DOC_LIBRARY = {
  creator: [
    { group: 'เอกสารภาษี', items: [
      { id: 'WHT50', label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)' },
      { id: 'PND90', label: 'แบบ ภ.ง.ด.90 / ภ.ง.ด.94' },
      { id: 'RECEIPT', label: 'ใบเสร็จรับเงิน / ใบรับเงิน' },
      { id: 'INV', label: 'ใบแจ้งหนี้ (Invoice)' },
      { id: 'FULLTAX', label: 'ใบกำกับภาษีเต็มรูป (กรณีจด VAT)' },
    ]},
  ],
  corporate: [
    { group: 'เอกสารภาษี', items: [
      { id: 'PP20', label: 'ภ.พ.20 (ทะเบียน VAT)' },
      { id: 'TAXINV', label: 'ใบกำกับภาษี' },
      { id: 'WHT50', label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)' },
      { id: 'PND53', label: 'แบบ ภ.ง.ด.53' },
      { id: 'PND50', label: 'แบบ ภ.ง.ด.50' },
      { id: 'PND51', label: 'แบบ ภ.ง.ด.51' },
    ]},
    { group: 'เอกสารการจ้างงาน', items: [
      { id: 'CONTRACT_INF', label: 'สัญญาจ้าง Influencer' },
      { id: 'PO', label: 'Purchase Order (PO)' },
      { id: 'QUOTATION', label: 'ใบเสนอราคา (Quotation)' },
      { id: 'INV', label: 'Invoice' },
      { id: 'DELIVERY', label: 'ใบส่งมอบงาน' },
      { id: 'PAYMENT', label: 'หลักฐานการชำระเงิน' },
    ]},
  ],
  agency: [
    { group: 'เอกสารบริษัท', items: [
      { id: 'CERT', label: 'หนังสือรับรองนิติบุคคล' },
      { id: 'PP20', label: 'ภ.พ.20 (ทะเบียน VAT)' },
      { id: 'POA', label: 'หนังสือมอบอำนาจ' },
      { id: 'IDCARD', label: 'บัตรประชาชนผู้มีอำนาจ' },
      { id: 'BANKBOOK', label: 'สมุดบัญชีบริษัท' },
    ]},
    { group: 'เอกสารภาษี', items: [
      { id: 'PND53', label: 'แบบ ภ.ง.ด.53' },
      { id: 'WHT50', label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)' },
      { id: 'PP30', label: 'แบบ ภ.พ.30' },
      { id: 'PND50', label: 'แบบ ภ.ง.ด.50' },
      { id: 'PND51', label: 'แบบ ภ.ง.ด.51' },
    ]},
    { group: 'เอกสารการดำเนินงาน', items: [
      { id: 'CONTRACT_BRAND', label: 'สัญญากับแบรนด์' },
      { id: 'CONTRACT_INF', label: 'สัญญากับ Influencer' },
      { id: 'QUOTATION', label: 'ใบเสนอราคา' },
      { id: 'INV', label: 'Invoice' },
      { id: 'TAXINV', label: 'ใบกำกับภาษี' },
      { id: 'DELIVERY', label: 'ใบส่งมอบงาน' },
    ]},
  ],
};

// หา label ของหมวดจาก id (ค้นทุกบทบาท)
function libCategoryLabel(id) {
  for (const role of Object.values(DOC_LIBRARY))
    for (const g of role)
      for (const it of g.items)
        if (it.id === id) return it.label;
  return id;
}


/* ---------- ประเภทเอกสารที่สร้างได้ แยกตามบทบาท (ข้อ 3) ---------- */
const CREATE_TYPES = {
  creator: [
    { id: 'RECEIPT', icon: 'receipt', desc: 'ออกให้ผู้ว่าจ้างเมื่อได้รับเงิน' },
    { id: 'INVOICE', icon: 'invoice', desc: 'เรียกเก็บค่าจ้างจากผู้ว่าจ้าง' },
    { id: 'ETAX', icon: 'calc', desc: 'ใบกำกับภาษีเต็มรูป (กรณีจด VAT)' },
    { id: 'QUOTATION', icon: 'quote', desc: 'เสนอราคางานก่อนรับงาน' },
  ],
  corporate: [
    { id: 'QUOTATION', icon: 'quote', desc: 'เสนอราคาต่อลูกค้า' },
    { id: 'PO', icon: 'cart', desc: 'สั่งซื้อ/สั่งจ้างอย่างเป็นทางการ' },
    { id: 'INVOICE', icon: 'invoice', desc: 'เรียกเก็บเงินคู่ค้า' },
    { id: 'RECEIPT', icon: 'receipt', desc: 'ออกเมื่อได้รับชำระเงิน' },
    { id: 'DELIVERY', icon: 'box', desc: 'ยืนยันการส่งมอบงาน' },
    { id: 'PAYMENT', icon: 'banknote', desc: 'หลักฐานการชำระเงิน/ใบสำคัญจ่าย' },
    { id: 'CONTRACT_INF', icon: 'pen', desc: 'สัญญาจ้าง Influencer' },
    { id: 'POA', icon: 'scroll', desc: 'มอบอำนาจให้เอเจนซี่/บุคคลทำการแทน' },
  ],
  agency: [
    { id: 'QUOTATION', icon: 'quote', desc: 'เสนอราคาต่อแบรนด์' },
    { id: 'PO', icon: 'cart', desc: 'สั่งซื้อ/สั่งจ้างอย่างเป็นทางการ' },
    { id: 'INVOICE', icon: 'invoice', desc: 'เรียกเก็บเงินแบรนด์' },
    { id: 'RECEIPT', icon: 'receipt', desc: 'ออกเมื่อได้รับชำระเงิน' },
    { id: 'DELIVERY', icon: 'box', desc: 'ยืนยันการส่งมอบงานต่อแบรนด์' },
    { id: 'PAYMENT', icon: 'banknote', desc: 'หลักฐานจ่ายค่าจ้างอินฟลู' },
    { id: 'CONTRACT_BRAND', icon: 'handshake', desc: 'สัญญารับจ้างบริหารงานกับแบรนด์' },
    { id: 'CONTRACT_INF', icon: 'pen', desc: 'สัญญาจ้าง Influencer' },
    { id: 'POA', icon: 'scroll', desc: 'หนังสือมอบอำนาจ (เตรียมให้ลูกค้าลงนาม)' },
  ],
};


/* คำอธิบาย + ข้อกฎหมายประจำประเภทเอกสาร (ข้อ 4 — กันสับสน) */
const CREATE_HINTS = {
  RECEIPT: 'ออกได้เฉพาะเมื่อ "ได้รับเงินแล้วจริง" — ผู้รับเงินมีหน้าที่ออกใบเสร็จตามมาตรา 105 แห่งประมวลรัษฎากร',
  INVOICE: 'ใบแจ้งหนี้คือการ "ขอเก็บเงิน" ยังไม่ใช่หลักฐานว่าได้รับเงิน — เมื่อได้รับชำระแล้วจึงออกใบเสร็จรับเงินอีกฉบับ',
  QUOTATION: 'เอกสารเสนอราคาก่อนตกลงงาน ยังไม่ผูกพันจนกว่าอีกฝ่ายตอบรับ — ระบุวันยืนราคาให้ชัด',
  PO: 'คำสั่งซื้อ/สั่งจ้างอย่างเป็นทางการจากฝั่งผู้ซื้อ มีผลผูกพันเมื่อผู้ขายตอบรับ',
  DELIVERY: 'หลักฐานการส่งมอบงาน — ควรส่งให้ผู้รับลงนามตรวจรับ ใช้ประกอบการวางบิล/ขอเบิกเงินงวด',
  PAYMENT: 'หลักฐานฝั่ง "ผู้จ่ายเงิน" ใช้คู่กับหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) เมื่อมีการหักภาษี',
  CONTRACT_INF: 'สัญญาจ้างทำของตามประมวลกฎหมายแพ่งฯ — ระบบใส่ข้อสัญญามาตรฐานให้: ค่าตอบแทน+หัก ณ ที่จ่าย, ลิขสิทธิ์ (พ.ร.บ.2537), PDPA',
  CONTRACT_BRAND: 'สัญญารับจ้างบริหารงานระหว่างเอเจนซี่กับแบรนด์ — เงื่อนไขต้องสอดคล้องกับสัญญาที่ทำกับอินฟลูฯ',
  POA: 'ต้องลงลายมือชื่อทั้ง "ผู้มอบอำนาจ" (กรรมการผู้มีอำนาจ + ตราประทับถ้าบริษัทกำหนด) และ "ผู้รับมอบอำนาจ" — ติดอากรแสตมป์ 10/30 บาทตามกรณี',
  ETAX: 'ออกได้เฉพาะผู้ประกอบการจด VAT — รายการต้องครบตามมาตรา 86/4 แห่งประมวลรัษฎากร',
};


/* ---------- ไอคอน SVG ทางการ (แทนอิโมจิ) ---------- */
const SVG_ICONS = {
  receipt:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21l-2.3-1.5L5 21V3z"/><path d="M9 8h6M9 12h6"/></svg>',
  invoice:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2h9l4 4v16H6V2z"/><path d="M15 2v4h4M9 12h7M9 16h7M9 8h3"/></svg>',
  quote:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z"/><path d="M9 11h6"/></svg>',
  cart:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 4h2l2.5 11h10L20 7H6"/></svg>',
  box:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  banknote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M5.5 9.5h.01M18.5 14.5h.01"/></svg>',
  pen:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  handshake:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l4-6h8l4 6"/><path d="M4 12l5 6 3-2.5L15 18l5-6"/><path d="M12 15.5L9 12l3-3 3 3-3 3.5z"/></svg>',
  scroll:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h12a2 2 0 012 2v2h-4"/><path d="M17 3a2 2 0 00-2 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2v-2h10"/><path d="M8 8h5M8 12h5"/></svg>',
  calc:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M9 19h6"/></svg>',
  book:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5"/></svg>',
  scale:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M8 21h8"/><path d="M5 7l7-2 7 2"/><path d="M5 7l-2.5 6a3 3 0 005 0L5 7zM19 7l-2.5 6a3 3 0 005 0L19 7z"/></svg>',
  bell:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 9a6 6 0 10-12 0c0 6-2 7-2 7h16s-2-1-2-7z"/><path d="M10.5 20a1.7 1.7 0 003 0"/></svg>',
  send:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  info:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 11v5"/></svg>',
};
const icon = (name, cls = '') => `<span class="sicon ${cls}">${SVG_ICONS[name] || ''}</span>`;

/* จุดประสงค์การสร้างเอกสาร (ข้อ 8) */
const DOC_PURPOSES = [
  { id: 'send', label: 'ยื่นต่อลูกค้า / คู่ค้า', desc: 'สร้างแล้วส่งให้อีกฝ่ายตรวจสอบหรือลงนามผ่านระบบ มีสถานะรอการอนุมัติ' },
  { id: 'self', label: 'ใช้ภายในเอง', desc: 'เอกสารใช้งานภายใน ปิดงานได้ทันที ไม่ต้องรอการอนุมัติจากใคร' },
  { id: 'record', label: 'เก็บเป็นบันทึกดีลย้อนหลัง', desc: 'บันทึกงานที่เคยตกลงหรือจบไปแล้ว เพื่อเก็บประวัติและรวมยอด' },
];
const PURPOSE_LABEL = { send: 'ยื่นต่อคู่ค้า', self: 'ใช้ภายใน', record: 'บันทึกย้อนหลัง' };

/* ---------- กล่องยืนยัน/กรอกข้อความของระบบ (แทน confirm/prompt ของ browser) ---------- */
function uiConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const old = document.getElementById('ui-confirm');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className = 'modal-bg';
    wrap.id = 'ui-confirm';
    wrap.style.zIndex = '300';
    wrap.innerHTML = `
      <div class="modal confirm-modal">
        <div class="confirm-icon ${opts.danger !== false ? 'danger' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>
        </div>
        <h3>${opts.title || 'ยืนยันการดำเนินการ'}</h3>
        <p>${message}</p>
        <div class="btn-row confirm-actions">
          <button class="btn btn-ghost" id="uic-no">${opts.cancelText || 'ยกเลิก'}</button>
          <button class="btn ${opts.danger !== false ? 'btn-danger-solid' : 'btn-solid'}" id="uic-yes">${opts.confirmText || 'ยืนยัน'}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); resolve(v); };
    document.getElementById('uic-yes').addEventListener('click', () => done(true));
    document.getElementById('uic-no').addEventListener('click', () => done(false));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
  });
}

function uiPrompt(message, opts = {}) {
  return new Promise((resolve) => {
    const old = document.getElementById('ui-prompt');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className = 'modal-bg';
    wrap.id = 'ui-prompt';
    wrap.style.zIndex = '300';
    wrap.innerHTML = `
      <div class="modal confirm-modal" style="text-align:left">
        <h3 style="text-align:center">${opts.title || 'กรอกข้อมูล'}</h3>
        <p style="text-align:center">${message}</p>
        <input id="uip-input" class="uip-input" placeholder="${opts.placeholder || ''}" value="${(opts.value || '').replace(/"/g, '&quot;')}">
        <div class="btn-row confirm-actions">
          <button class="btn btn-ghost" id="uip-no">${opts.cancelText || 'ยกเลิก'}</button>
          <button class="btn btn-solid" id="uip-yes">${opts.confirmText || 'ตกลง'}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = document.getElementById('uip-input');
    setTimeout(() => input.focus(), 50);
    const done = (v) => { wrap.remove(); resolve(v); };
    document.getElementById('uip-yes').addEventListener('click', () => done(input.value));
    document.getElementById('uip-no').addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
  });
}

/**
 * หน้าต่างยืนยันตัวตนด้วย OTP ก่อนทำรายการสำคัญ (ใช้ก่อนลงลายมือชื่อดิจิทัลทุกครั้ง)
 * - purpose/refId: ส่งไปขอรหัส OTP ที่ /api/otp/request (ต้องเข้าสู่ระบบอยู่แล้ว)
 * - action(otpId, code): ฟังก์ชันที่ทำรายการจริงเมื่อกรอกรหัสแล้ว ต้องคืนค่า {ok, data}
 *   ถ้า ok=false จะโชว์ data.error ในหน้าต่างเดิมให้กรอกรหัสใหม่ (ไม่ปิดหน้าต่าง)
 * คืนค่า data จาก action เมื่อสำเร็จ, หรือ null ถ้าผู้ใช้กดยกเลิก/ปิดหน้าต่าง
 */
async function otpGate({ purpose, refId, title, subtitle, action }) {
  const req = await api.post('/api/otp/request', { purpose, refId });
  if (!req.ok) { toast(req.data.error || 'ขอรหัส OTP ไม่สำเร็จ', 'err'); return null; }
  let otpId = req.data.otpId;
  return new Promise((resolve) => {
    const old = document.getElementById('ui-otp');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className = 'modal-bg';
    wrap.id = 'ui-otp';
    wrap.style.zIndex = '300';
    wrap.innerHTML = `
      <div class="modal confirm-modal" style="text-align:left;max-width:380px">
        <h3 style="text-align:center">${title || 'ยืนยันตัวตนด้วย OTP'}</h3>
        <p style="text-align:center">${subtitle || 'ระบบส่งรหัสยืนยัน 6 หลักไปที่'} <b>${req.data.emailMasked || ''}</b></p>
        <div id="uio-dev" class="otp-dev-banner ${req.data.devCode ? '' : 'hidden'}">โหมดพัฒนา (ยังไม่ได้ตั้งค่าอีเมลผู้ส่งจริง): รหัส OTP ของคุณคือ <b id="uio-dev-code">${req.data.devCode || ''}</b></div>
        <div id="uio-err" class="error-msg hidden"></div>
        <input id="uio-input" class="otp-box" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="······">
        <div class="btn-row confirm-actions">
          <button class="btn btn-ghost" id="uio-no">ยกเลิก</button>
          <button class="btn btn-solid" id="uio-yes">ยืนยัน</button>
        </div>
        <div class="otp-resend">ไม่ได้รับรหัส? <a id="uio-resend" class="hidden">ส่งรหัสอีกครั้ง</a><span id="uio-cd"></span></div>
      </div>`;
    document.body.appendChild(wrap);
    const input = document.getElementById('uio-input');
    const errBox = document.getElementById('uio-err');
    const yesBtn = document.getElementById('uio-yes');
    const resendA = document.getElementById('uio-resend');
    const cdEl = document.getElementById('uio-cd');
    setTimeout(() => input.focus(), 50);
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });

    let timer = null;
    function startCd(sec = 45) {
      let left = sec;
      resendA.classList.add('hidden');
      clearInterval(timer);
      cdEl.textContent = ` (${left} วิ)`;
      timer = setInterval(() => {
        left--;
        if (left <= 0) { clearInterval(timer); cdEl.textContent = ''; resendA.classList.remove('hidden'); }
        else cdEl.textContent = ` (${left} วิ)`;
      }, 1000);
    }
    startCd();

    const done = (v) => { clearInterval(timer); wrap.remove(); resolve(v); };
    const submit = async () => {
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) { errBox.textContent = 'กรุณากรอกรหัส 6 หลักให้ครบ'; errBox.classList.remove('hidden'); return; }
      yesBtn.disabled = true; const origTxt = yesBtn.textContent; yesBtn.textContent = 'กำลังตรวจสอบ…';
      const r = await action(otpId, code);
      yesBtn.disabled = false; yesBtn.textContent = origTxt;
      if (!r.ok) {
        errBox.textContent = (r.data && r.data.error) || 'รหัสไม่ถูกต้อง';
        errBox.classList.remove('hidden');
        input.value = ''; input.focus();
        return;
      }
      done(r.data);
    };
    yesBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    document.getElementById('uio-no').addEventListener('click', () => done(null));
    resendA.addEventListener('click', async () => {
      resendA.classList.add('hidden');
      const rr = await api.post('/api/otp/resend', { otpId });
      if (!rr.ok) { toast(rr.data.error || 'ส่งรหัสใหม่ไม่สำเร็จ', 'err'); resendA.classList.remove('hidden'); return; }
      if (rr.data.otpId) otpId = rr.data.otpId;
      document.getElementById('uio-dev').classList.toggle('hidden', !rr.data.devCode);
      if (rr.data.devCode) document.getElementById('uio-dev-code').textContent = rr.data.devCode;
      toast('ส่งรหัสใหม่แล้ว กรุณาตรวจสอบอีเมล');
      startCd();
    });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
  });
}
