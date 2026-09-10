/* notify.js — กระดิ่งแจ้งเตือน (ใช้ร่วมทุกหน้า dashboard)
 * แสดง badge จำนวนที่ยังไม่อ่าน + dropdown รายการแจ้งเตือน + poll ทุก 30 วิ */

async function loadNotifications() {
  const d = await api.get('/api/notifications');
  const badge = document.getElementById('ntf-badge');
  if (badge) {
    badge.textContent = d.unread;
    badge.classList.toggle('hidden', d.unread === 0);
  }
  const list = document.getElementById('ntf-list');
  if (list) {
    const IMPORTANT = ['request', 'rejected', 'signed'];
    const row = (n) => `
      <div class="ntf-item ${n.read ? '' : 'unread'}" onclick="readNtf(${n.id},${n.docId || 'null'},${n.reqId || 'null'})">
        <div class="ntf-msg">${n.message}</div>
        <small class="muted">${new Date(n.at).toLocaleString('th-TH')}</small>
      </div>`;
    const imp = d.items.filter((n) => IMPORTANT.includes(n.kind)).slice(0, 8);
    const gen = d.items.filter((n) => !IMPORTANT.includes(n.kind)).slice(0, 8);
    list.innerHTML = (imp.length || gen.length)
      ? (imp.length ? '<div class="ntf-group">สำคัญ — ต้องดำเนินการ</div>' + imp.map(row).join('') : '')
        + (gen.length ? '<div class="ntf-group">ทั่วไป</div>' + gen.map(row).join('') : '')
      : '<div class="ntf-empty">ยังไม่มีการแจ้งเตือน</div>';
  }
  return d;
}

async function readNtf(id, docId, reqId) {
  await api.post(`/api/notifications/${id}/read`, {});
  loadNotifications();
  toggleNtf(false);
  if (reqId && typeof switchView === 'function') { switchView('inbox'); return; }
  if (docId && typeof openDoc === 'function') openDoc(docId);
}

async function readAllNtf() {
  await api.post('/api/notifications/read-all', {});
  loadNotifications();
  toast('อ่านทั้งหมดแล้ว');
}

function toggleNtf(force) {
  const dd = document.getElementById('ntf-dropdown');
  if (!dd) return;
  const show = force !== undefined ? force : dd.classList.contains('hidden');
  dd.classList.toggle('hidden', !show);
  if (show) loadNotifications();
}

// ปิด dropdown เมื่อคลิกที่อื่น
document.addEventListener('click', (e) => {
  const bell = document.getElementById('ntf-bell');
  const dd = document.getElementById('ntf-dropdown');
  if (dd && bell && !bell.contains(e.target) && !dd.contains(e.target)) dd.classList.add('hidden');
});

// poll เบาๆ ทุก 30 วินาที
setInterval(() => {
  if (document.getElementById('ntf-badge')) loadNotifications();
  if (typeof loadInbox === 'function' && document.getElementById('inbox-badge')) {
    api.get('/api/requests/inbox').then((d) => updateInboxBadge(d.actionCount));
  }
}, 30000);
