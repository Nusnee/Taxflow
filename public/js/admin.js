// admin.js — หน้าผู้ดูแลระบบ: ตรวจสอบและอนุมัติการยืนยันตัวตนของผู้ใช้

let ADMIN_ME = null;
let CUR_STATUS = 'pending';

const STATUS_META = {
  unverified: { text: 'ยังไม่ส่งเอกสาร', cls: 'st-grey' },
  pending: { text: 'รอตรวจสอบ', cls: 'st-amber' },
  verified: { text: 'ยืนยันแล้ว', cls: 'st-green' },
  rejected: { text: 'ไม่อนุมัติ', cls: 'st-red' },
};
const TITLE = {
  pending: 'คำขอรอตรวจสอบ', verified: 'ผู้ใช้ที่ยืนยันตัวตนแล้ว',
  rejected: 'คำขอที่ไม่อนุมัติ', unverified: 'ผู้ใช้ที่ยังไม่ส่งเอกสาร', '': 'ผู้ใช้ทั้งหมด',
};
const ROLE_TEXT = {
  creator: 'อินฟลูเอนเซอร์', agency: 'เอเจนซี่', corporate: 'บริษัทผู้ว่าจ้าง',
};

async function loadList(status, btn) {
  CUR_STATUS = status;
  document.getElementById('page-title').textContent = TITLE[status] || 'ผู้ใช้ทั้งหมด';
  if (btn) document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));

  const { items } = await api.get('/api/admin/users' + (status ? '?status=' + status : ''));
  const box = document.getElementById('user-list');
  if (!items.length) {
    box.innerHTML = '<div class="empty">ไม่มีรายการในหมวดนี้</div>';
    return;
  }
  box.innerHTML = items.map((u) => {
    const st = STATUS_META[u.verifyStatus] || STATUS_META.unverified;
    return `<div class="admin-row" onclick="openUser(${u.id})">
      <div>
        <b>${esc(u.companyName || u.displayName)}</b>
        <small>${ROLE_TEXT[u.role] || u.role} · ${u.entityType === 'juristic' ? 'นิติบุคคล' : 'บุคคลธรรมดา'} · ${esc(u.email)}</small>
        <small>เลขผู้เสียภาษี ${formatTaxId(u.taxId) || '—'} · เอกสารแนบ ${u.docCount} ฉบับ</small>
      </div>
      <span class="st-pill ${st.cls}">${st.text}</span>
    </div>`;
  }).join('');
  updatePendingBadge();
}

async function updatePendingBadge() {
  const { items } = await api.get('/api/admin/users?status=pending');
  const b = document.getElementById('cnt-pending');
  b.textContent = items.length;
  b.classList.toggle('hidden', items.length === 0);
}

async function openUser(id) {
  const d = await api.get('/api/admin/users/' + id);
  const u = d.user;
  const st = STATUS_META[u.verifyStatus] || STATUS_META.unverified;
  const juristic = d.profile.isJuristic;
  const bank = u.bank || {};

  const rows = [
    ['บทบาท', (ROLE_TEXT[u.role] || u.role) + ' · ' + (juristic ? 'นิติบุคคล' : 'บุคคลธรรมดา')],
    [juristic ? 'ชื่อนิติบุคคล' : 'ชื่อ-นามสกุล', u.companyName || u.displayName],
    juristic ? ['ประเภทนิติบุคคล', u.companyType || '—'] : null,
    ['เลขประจำตัวผู้เสียภาษี', formatTaxId(u.taxId) || '—'],
    juristic ? ['สำนักงานใหญ่/สาขา', d.branchText || '—'] : null,
    juristic ? ['กรรมการผู้มีอำนาจ', (u.authName || '—') + (u.authPosition ? ' (' + u.authPosition + ')' : '')] : null,
    ['สถานะ VAT', u.vatRegistered ? 'จดทะเบียนแล้ว — ออกใบกำกับภาษีได้' : 'ยังไม่จดทะเบียน — ออกใบกำกับภาษีไม่ได้'],
    ['ที่อยู่', d.addressText || '—'],
    ['เบอร์ติดต่อ', u.phone || '—'],
    ['อีเมล', u.email + (u.emailVerified ? ' (ยืนยันแล้ว)' : ' (ยังไม่ยืนยัน)')],
    ['บัญชีธนาคาร', bank.accountNo ? `${bank.bankName || ''} ${bank.accountNo} — ${bank.accountName || ''}` : '—'],
    ['ความครบถ้วนโปรไฟล์', d.profile.completeness.percent + '%'
      + (d.profile.completeness.ok ? '' : ' (ขาด: ' + d.profile.completeness.missing.join(', ') + ')')],
  ].filter(Boolean);

  const docs = d.kycDocs.length
    ? d.kycDocs.map((k) => `<div class="admin-doc">
        <div><b>${esc(k.label)}</b><small>${esc(k.filename || 'ไฟล์')} · ${Math.round((k.size || 0) / 1024)} KB</small></div>
        <a class="btn btn-ghost btn-sm" href="/api/kyc/${k.id}/file" target="_blank">เปิดดู</a>
      </div>`).join('')
    : '<div class="muted">ผู้ใช้ยังไม่ได้แนบเอกสาร</div>';

  document.getElementById('detail-panel').innerHTML = `
    <div class="panel-title">${esc(u.companyName || u.displayName)} <span class="st-pill ${st.cls}">${st.text}</span></div>
    ${u.verifyNote ? `<div class="note-box warn" style="margin-bottom:12px">หมายเหตุล่าสุด: ${esc(u.verifyNote)}</div>` : ''}
    <table class="kv-table">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join('')}</table>

    <div class="divider-label" style="margin-top:16px">เอกสารยืนยันตัวตน</div>
    ${docs}

    <div class="divider-label" style="margin-top:16px">ผลการตรวจสอบ</div>
    <div class="field">
      <label>หมายเหตุ / เหตุผล (บังคับกรอกเมื่อไม่อนุมัติ)</label>
      <textarea id="verify-note" rows="2" placeholder="เช่น หนังสือรับรองนิติบุคคลคัดเกิน 6 เดือน กรุณาแนบฉบับใหม่"></textarea>
    </div>
    <div class="btn-row">
      <button class="btn btn-success" onclick="decide(${u.id}, true)">อนุมัติการยืนยันตัวตน</button>
      <button class="btn btn-danger" onclick="decide(${u.id}, false)">ไม่อนุมัติ</button>
    </div>`;
}

async function decide(id, approve) {
  const note = document.getElementById('verify-note').value.trim();
  if (!approve && !note) return toast('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'err');
  if (!confirm(approve ? 'ยืนยันการอนุมัติผู้ใช้รายนี้?' : 'ยืนยันการไม่อนุมัติ?')) return;
  const { ok, data } = await api.post(`/api/admin/users/${id}/verify`, { approve, note });
  if (!ok) return toast(data.error || 'บันทึกผลไม่สำเร็จ', 'err');
  toast(approve ? 'อนุมัติแล้ว — ระบบแจ้งเตือนผู้ใช้เรียบร้อย' : 'บันทึกผลไม่อนุมัติแล้ว');
  await loadList(CUR_STATUS);
  openUser(id);
}

(async function init() {
  ADMIN_ME = await guard('admin');
  if (!ADMIN_ME) return;
  document.getElementById('u-av').textContent = (ADMIN_ME.displayName || 'A').trim()[0];
  document.getElementById('u-name').textContent = ADMIN_ME.displayName;
  document.getElementById('u-email').textContent = ADMIN_ME.email;
  loadList('pending');
})();
