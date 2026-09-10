/* dashboard.js — ver10: สรุปภาษี + To-do + Onboarding + Empty state helper */

/* ---------- สรุปภาษี (#16) + To-do (#3) ---------- */
async function loadDashExtra() {
  const statBox = document.getElementById('dash-stats');
  const todoBox = document.getElementById('dash-todo');
  if (!statBox && !todoBox) return;
  const [{ items: docs = [] }, inbox] = await Promise.all([
    api.get('/api/documents'),
    api.get('/api/requests/inbox').catch(() => ({ items: [], actionCount: 0 })),
  ]);

  if (statBox) {
    const approved = docs.filter((d) => ['approved', 'archived'].includes(d.status));
    const isWht = (d) => ['WHT', 'EWHT'].includes(d.type);
    const income = approved.reduce((t, d) => t + Number(isWht(d) ? d.net || 0 : d.total || d.base || 0), 0);
    const vat = approved.reduce((t, d) => t + Number(!isWht(d) ? d.vat || 0 : 0), 0);
    const wht = approved.reduce((t, d) => t + Number(isWht(d) ? d.wht || 0 : 0), 0);
    const open = docs.filter((d) => ['draft', 'pending', 'rejected'].includes(d.status)).length;
    const card = (label, val, sub, accent) => `
      <div class="dstat-card ${accent ? 'accent' : ''}">
        <div class="dstat-label">${label}</div>
        <div class="dstat-val">${val}</div>
        <div class="dstat-sub">${sub}</div>
      </div>`;
    statBox.innerHTML =
      card('มูลค่าเอกสารที่อนุมัติ', '฿' + baht(income), 'รวมยอดสุทธิเอกสารสถานะอนุมัติ/เก็บถาวร', true) +
      card('VAT ในเอกสาร', '฿' + baht(vat), 'ภาษีมูลค่าเพิ่มจากเอกสารที่อนุมัติ') +
      card('ภาษีหัก ณ ที่จ่าย', '฿' + baht(wht), 'ยอดหักจากเอกสาร WHT ที่อนุมัติ') +
      card('เอกสารค้างดำเนินการ', String(open), 'แบบร่าง + รอตรวจสอบ + ถูกตีกลับ');
  }

  if (todoBox) {
    const todos = [];
    (inbox.items || []).filter((r) => r.status === 'sent').slice(0, 4).forEach((r) => todos.push({
      text: `${r.purpose === 'sign' ? 'ลงนาม' : 'ตรวจสอบ'}เอกสาร ${esc(r.doc ? r.doc.docNo : '')} จาก ${esc(r.fromName)}${r.dueDate ? ' ภายใน ' + esc(r.dueDate) : ''}`,
      overdue: r.overdue, action: `switchView('inbox')`, btn: 'ไปกล่องรับเอกสาร',
    }));
    docs.filter((d) => d.status === 'rejected').slice(0, 3).forEach((d) => todos.push({
      text: `แก้ไขเอกสาร ${esc(d.docNo)} ที่ถูกตีกลับ`, action: `openDoc(${d.id})`, btn: 'เปิดเอกสาร',
    }));
    docs.filter((d) => d.status === 'pending' && d.sentTo && d.sentTo.status === 'sent' && d.sentTo.dueDate && d.sentTo.dueDate < new Date().toISOString().slice(0, 10)).slice(0, 3).forEach((d) => todos.push({
      text: `คำขอของ ${esc(d.docNo)} ถึง ${esc(d.sentTo.name)} เกินกำหนดแล้ว — ติดตามหรือส่งใหม่`, overdue: true, action: `openDoc(${d.id})`, btn: 'เปิดเอกสาร',
    }));
    docs.filter((d) => d.status === 'draft').slice(0, 3).forEach((d) => todos.push({
      text: `จัดการแบบร่างเอกสาร (${DOC_LABEL[d.type] || d.type}) ให้เสร็จ (บันทึกเสร็จสิ้น หรือส่งให้คู่ค้า)`, action: `openDoc(${d.id})`, btn: 'เปิดเอกสาร',
    }));
    todoBox.innerHTML = todos.length ? todos.slice(0, 7).map((t) => `
      <div class="todo-item ${t.overdue ? 'overdue' : ''}">
        <div class="todo-dot"></div>
        <div class="todo-text">${t.text}</div>
        <button class="btn btn-ghost btn-sm" onclick="${t.action}">${t.btn}</button>
      </div>`).join('') : '<p class="muted" style="padding:6px 2px">ไม่มีงานค้าง — เยี่ยมมาก</p>';
  }
}

/* ---------- Empty state (#5) ---------- */
function emptyStateRow(colspan) {
  return `<tr><td colspan="${colspan}">
    <div class="empty-state">
      <div class="es-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2h9l4 4v16H6V2z"/><path d="M15 2v4h4M9 13h7M9 17h7"/></svg></div>
      <b>ยังไม่มีเอกสาร</b>
      <p>เริ่มจากสร้างเอกสารฉบับแรกของคุณ — ระบบจะพาไปทีละขั้นตอน</p>
      <button class="btn btn-solid btn-sm" onclick="switchView('create')">สร้างเอกสารแรก</button>
    </div>
  </td></tr>`;
}

/* ---------- Onboarding ครั้งแรก (#10) ---------- */
const OB_STEPS = [
  { t: 'ยินดีต้อนรับสู่ TaxFlow', d: 'ระบบจัดการเอกสารภาษีสำหรับอินฟลูเอนเซอร์ บริษัท และเอเจนซี่ — ใช้เวลา 30 วินาทีทำความรู้จักเมนูหลัก' },
  { t: 'สร้างเอกสาร (4 ขั้นตอน)', d: 'เลือกจุดประสงค์ → เลือกประเภท → กรอกข้อมูล → ตรวจสอบและยืนยัน มีแถบขั้นตอนบอกตลอดว่าอยู่ตรงไหน' },
  { t: 'ส่งให้คู่ค้าลงนาม', d: 'ลงนามฝั่งคุณก่อน แล้วส่งขอลายเซ็นผ่านอีเมลบัญชีคู่ค้า — อีกฝ่ายเห็นใน "กล่องรับเอกสาร" พร้อมกำหนดเวลา' },
  { t: 'ติดตามได้ทุกที่', d: 'แดชบอร์ดสรุปยอดภาษีและงานค้าง · กระดิ่งแจ้งเตือนแยกเรื่องสำคัญ · อ่านเพิ่มที่ "คู่มือการใช้งาน" ในเมนูล่างซ้าย' },
];
let OB_IDX = 0;
function maybeOnboard() {
  try {
    const key = 'tf_onboard_' + ((typeof ME !== 'undefined' && ME) ? ME.email : '');
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    OB_IDX = 0;
    showOnboard();
  } catch {}
}
function showOnboard() {
  const old = document.getElementById('ob-modal');
  if (old) old.remove();
  const st = OB_STEPS[OB_IDX];
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.id = 'ob-modal';
  wrap.style.zIndex = '250';
  wrap.innerHTML = `
    <div class="modal confirm-modal" style="max-width:430px">
      <div class="ob-num">${OB_IDX + 1}</div>
      <h3>${st.t}</h3>
      <p>${st.d}</p>
      <div class="ob-dots">${OB_STEPS.map((_, i) => `<span class="${i === OB_IDX ? 'on' : ''}"></span>`).join('')}</div>
      <div class="btn-row confirm-actions">
        <button class="btn btn-ghost" onclick="document.getElementById('ob-modal').remove()">ข้าม</button>
        <button class="btn btn-solid" onclick="obNext()">${OB_IDX < OB_STEPS.length - 1 ? 'ถัดไป →' : 'เริ่มใช้งาน'}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
}
function obNext() {
  OB_IDX++;
  if (OB_IDX >= OB_STEPS.length) { const m = document.getElementById('ob-modal'); if (m) m.remove(); return; }
  showOnboard();
}
