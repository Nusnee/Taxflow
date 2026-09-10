// agency.js — ตรรกะหน้าเอเจนซี่ / องค์กรธุรกิจ

let ME = null;
let CONTACTS = [];

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('v-' + name).classList.add('active');
  if (name === 'overview') loadOverview();
  if (name === 'docs') loadDocs();
  if (name === 'contacts') loadContacts();
  if (name === 'library') loadLibrary();
  if (name === 'inbox') loadInbox();
  if (name === 'overview') loadDashExtra();
  if (name === 'create') { renderCreateCards(); fillCreateDatalist(); crWireAutofill(); }
  if (name === 'profile') initProfile(ME);
}
document.querySelectorAll('.nav-item').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view))
);

/* ---------- e-Tax invoice builder ---------- */
function addItem(desc = '', qty = 1, price = '') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input placeholder="เช่น ค่าผลิตวิดีโอโฆษณา" value="${desc}" oninput="previewEtax()">
    <input type="number" value="${qty}" oninput="previewEtax()">
    <input type="number" placeholder="0.00" value="${price}" oninput="previewEtax()">
    <button class="item-remove" onclick="this.parentElement.remove();previewEtax()">×</button>`;
  document.getElementById('e-items').appendChild(row);
}
function readItems() {
  return [...document.querySelectorAll('#e-items .item-row')].map((r) => {
    const [d, q, p] = r.querySelectorAll('input');
    return { name: d.value, qty: Number(q.value) || 0, price: Number(p.value) || 0 };
  }).filter((i) => i.name || i.price);
}
async function previewEtax() {
  const items = readItems();
  const vatRate = Number(document.getElementById('e-vat').value) || 0;
  const subtotal = items.reduce((s, it) => s + it.qty * it.price, 0);
  const box = document.getElementById('e-preview');
  if (!subtotal) { box.innerHTML = '<div class="empty">เพิ่มรายการเพื่อดูยอดรวม</div>'; return; }
  const vat = subtotal * (vatRate / 100);
  box.innerHTML = `
    <div class="line"><span>มูลค่าก่อนภาษี</span><b>฿${baht(subtotal)}</b></div>
    <div class="line"><span>VAT ${vatRate}%</span><b>฿${baht(vat)}</b></div>
    <div class="line total"><span>ยอดรวมทั้งสิ้น</span><b>฿${baht(subtotal + vat)}</b></div>`;
}
async function issueEtax() {
  const items = readItems();
  if (!items.length) return toast('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ', 'err');
  const { ok: created, data } = await api.post('/api/etax/invoice', {
    buyer: document.getElementById('e-buyer').value,
    buyerTaxId: document.getElementById('e-taxid').value,
    items, vatRate: Number(document.getElementById('e-vat').value) || 7,
  });
  if (!created) return toast((data.errors ? data.errors.join(' · ') : data.error) || 'สร้างไม่สำเร็จ', 'err');
  toast('ออกใบกำกับภาษีเรียบร้อย (สถานะ: แบบร่าง)');
  document.getElementById('e-items').innerHTML = '';
  addItem();
  document.getElementById('e-buyer').value = '';
  document.getElementById('e-taxid').value = '';
  previewEtax();
  switchView('docs');
  openDoc(data.id);
}

/* ---------- e-Withholding ---------- */
let wTimer;
function previewEwht() {
  clearTimeout(wTimer);
  wTimer = setTimeout(async () => {
    const amount = Number(document.getElementById('w-amount').value);
    const rate = Number(document.getElementById('w-rate').value);
    const box = document.getElementById('w-preview');
    if (!amount) { box.innerHTML = '<div class="empty">กรอกยอดเงินเพื่อดูผลการคำนวณ</div>'; return; }
    const { data: r } = await api.post('/api/wht/calc', { amount, rate });
    box.innerHTML = `
      <div class="line"><span>ฐานภาษี</span><b>฿${baht(r.base)}</b></div>
      <div class="line"><span>ภาษีหัก ณ ที่จ่าย ${r.rate}%</span><b style="color:var(--orange-deep)">-฿${baht(r.wht)}</b></div>
      <div class="line total"><span>ยอดจ่ายสุทธิ</span><b>฿${baht(r.net)}</b></div>`;
  }, 120);
}
async function issueEwht() {
  const amount = Number(document.getElementById('w-amount').value);
  if (!amount) return toast('กรุณากรอกยอดเงิน', 'err');
  const { ok: created2, data } = await api.post('/api/ewht/certificate', {
    payee: document.getElementById('w-payee').value,
    payeeTaxId: document.getElementById('w-taxid').value,
    incomeType: document.getElementById('w-income').value,
    description: document.getElementById('w-desc').value,
    amount, rate: Number(document.getElementById('w-rate').value) || 3,
  });
  if (!created2) return toast((data.errors ? data.errors.join(' · ') : data.error) || 'สร้างไม่สำเร็จ', 'err');
  toast('ออกหนังสือรับรองเรียบร้อย (สถานะ: แบบร่าง)');
  document.getElementById('w-amount').value = '';
  document.getElementById('w-payee').value = '';
  document.getElementById('w-preview').innerHTML = '<div class="empty">กรอกยอดเงินเพื่อดูผลการคำนวณ</div>';
  switchView('docs');
  openDoc(data.id);
}

/* ---------- Overview ---------- */
async function loadOverview() {
  const s = await api.get('/api/agency/summary');
  document.getElementById('d-total').textContent = s.counts.total;
  document.getElementById('d-etax').textContent = s.counts.eTaxInvoice;
  document.getElementById('d-ewht').textContent = s.counts.eWithholding;
  document.getElementById('d-revenue').textContent = '฿' + baht(s.totals.revenue);
  document.getElementById('d-expense').textContent = 'ค่าใช้จ่าย ฿' + baht(s.totals.expense);
  document.getElementById('d-wht').textContent = '฿' + baht(s.totals.withholding);
  document.getElementById('d-vat').textContent = 'VAT ฿' + baht(s.totals.vat);

  const { items } = await api.get('/api/documents');
  document.getElementById('ov-body').innerHTML = items.slice(0, 6).map((d) => {
    const cp = d.buyer || d.payee || '-';
    const amt = d.type === 'ETAX' ? d.total : d.net;
    return `<tr class="row-click" onclick="openDoc(${d.id})"><td class="docno">${d.docNo}</td><td>${badge(d.type)}</td><td>${cp}</td>
      <td class="num">${baht(amt)}</td><td>${statusChip(d.status)}${d.sentTo && d.status === 'pending' ? `<div class="sent-to">ส่งถึง ${esc(d.sentTo.name)}</div>` : ''}</td>
      <td class="actions" onclick="event.stopPropagation()"><a class="btn btn-ghost btn-sm" href="/api/documents/${d.id}/pdf" target="_blank">PDF</a></td></tr>`;
  }).join('') || emptyRow(6);
}

/* ---------- Docs ---------- */
async function loadDocs() {
  const q = document.getElementById('doc-search').value;
  const type = document.getElementById('f-type').value;
  const status = document.getElementById('f-status').value;
  const from = document.getElementById('f-from').value;
  const to = document.getElementById('f-to').value;
  const params = new URLSearchParams({ q, type, status, from, to });
  const { items } = await api.get('/api/documents?' + params);
  document.getElementById('doc-body').innerHTML = items.map((d) => {
    const cp = d.buyer || d.payee || '-';
    const taxVal = d.type === 'ETAX' ? d.vat : d.wht;
    const total = d.type === 'ETAX' ? d.total : d.net;
    return `<tr class="row-click" onclick="openDoc(${d.id})">
      <td class="docno">${d.docNo}</td><td>${badge(d.type)}</td><td>${cp}</td>
      <td class="num">${baht(d.base)}</td><td class="num">${baht(taxVal)}</td><td class="num">${baht(total)}</td>
      <td>${statusChip(d.status)}${d.sentTo && d.status === 'pending' ? `<div class="sent-to">ส่งถึง ${esc(d.sentTo.name)}</div>` : ''}</td>
      <td class="actions" onclick="event.stopPropagation()">
        <a class="btn btn-ghost btn-sm" href="/api/documents/${d.id}/pdf" target="_blank">PDF</a>
        <button class="btn btn-ghost btn-sm" onclick="openDoc(${d.id})">จัดการ</button>
      </td></tr>`;
  }).join('') || emptyRow(8);
}

/* ---------- Contacts ---------- */
async function loadContacts() {
  const { items } = await api.get('/api/contacts');
  CONTACTS = items;
  document.getElementById('ct-count').textContent = items.length + ' รายการ';
  document.getElementById('ct-list').innerHTML = items.map((c) => `
    <div class="contact-item">
      <div style="min-width:0">
        <b>${esc(c.name)}</b>
        <small>${c.kind === 'buyer' ? 'ลูกค้า' : 'อินฟลู/ผู้รับเงิน'} · ${esc(c.taxId || 'ไม่มีเลขภาษี')}</small>
        ${c.phone || c.email ? `<small>${esc([c.phone, c.email].filter(Boolean).join(' · '))}</small>` : ''}
        ${c.bank ? `<small>บัญชี: ${esc(c.bank)}</small>` : ''}
        ${c.note ? `<small style="color:var(--orange-deep)">${esc(c.note)}</small>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" onclick="delContact(${c.id})">ลบ</button>
    </div>`).join('') || '<div class="empty" style="color:var(--ink-soft);font-size:13px;padding:10px;">ยังไม่มีคู่ค้า</div>';
  fillDatalists();
}
function fillDatalists() {
  const buyers = CONTACTS.filter((c) => c.kind === 'buyer');
  const payees = CONTACTS.filter((c) => c.kind === 'payee');
  const bl = document.getElementById('buyers'), pl = document.getElementById('payees');
  if (bl) bl.innerHTML = buyers.map((c) => `<option value="${esc(c.name)}">`).join('');
  if (pl) pl.innerHTML = payees.map((c) => `<option value="${esc(c.name)}">`).join('');
}
async function addContact() {
  const name = document.getElementById('ct-name').value.trim();
  if (!name) return toast('กรุณากรอกชื่อ', 'err');
  await api.post('/api/contacts', {
    name, taxId: document.getElementById('ct-taxid').value.trim(),
    kind: document.getElementById('ct-kind').value,
    email: document.getElementById('ct-email').value.trim(),
    phone: document.getElementById('ct-phone').value.trim(),
    address: document.getElementById('ct-address').value.trim(),
    bank: document.getElementById('ct-bank').value.trim(),
    note: document.getElementById('ct-note').value.trim(),
  });
  ['ct-name','ct-taxid','ct-email','ct-phone','ct-address','ct-bank','ct-note'].forEach((i) => document.getElementById(i).value = '');
  toast('เพิ่มคู่ค้าแล้ว');
  loadContacts();
}
async function delContact(id) { await api.del('/api/contacts/' + id); loadContacts(); }

// เติมเลขภาษีอัตโนมัติเมื่อเลือกชื่อจาก datalist
function wireAutofill() {
  const eb = document.getElementById('e-buyer');
  eb && eb.addEventListener('input', () => {
    const c = CONTACTS.find((x) => x.name === eb.value && x.kind === 'buyer');
    if (c) document.getElementById('e-taxid').value = c.taxId || '';
  });
  const wp = document.getElementById('w-payee');
  wp && wp.addEventListener('input', () => {
    const c = CONTACTS.find((x) => x.name === wp.value && x.kind === 'payee');
    if (c) document.getElementById('w-taxid').value = c.taxId || '';
  });
}

function emptyRow(cols) { return emptyStateRow(cols); }

/* ---------- init ---------- */
(async function init() {
  ME = await guard(['agency', 'corporate']);
  if (!ME) return;
  // ป้ายบทบาท + หัวเรื่องตามบทบาท (ข้อ 9)
  const roleTag = document.getElementById('role-tag');
  if (roleTag) roleTag.textContent = ROLE_LABEL[ME.role] || ME.role;
  buildLibraryCategorySelects();
  document.getElementById('u-av').textContent = initials(ME.companyName || ME.displayName);
  document.getElementById('u-name').textContent = ME.companyName || ME.displayName;
  document.getElementById('u-email').textContent = ME.email;
  showProfileReminder();
  addItem();
  await loadContacts();
  wireAutofill();
  setDocsChangeHandler(() => { loadOverview(); loadDocs(); });
  loadNotifications();
  loadInbox();
  loadDashExtra();
  maybeOnboard();
  crWireAutosave();
  loadOverview();
  if (location.hash === '#profile') switchView('profile');
})();

/** เตือนเมื่อโปรไฟล์ยังไม่ครบตามที่กฎหมายกำหนด (ออกเอกสารไม่ได้จนกว่าจะครบ) */
function showProfileReminder() {
  const c = PROFILE_META && PROFILE_META.completeness;
  if (!c || c.ok) return;
  const host = document.querySelector('#v-overview .page-head');
  if (!host) return;
  const box = document.createElement('div');
  box.className = 'note-box warn';
  box.style.marginTop = '12px';
  box.innerHTML = `ข้อมูลโปรไฟล์ยังไม่ครบ (${c.percent}%) — ยังออกเอกสารไม่ได้จนกว่าจะกรอกครบ<br>
    ขาด: ${c.missing.join(', ')} &nbsp; <a onclick="switchView('profile')">ไปกรอกข้อมูลโปรไฟล์</a>`;
  host.appendChild(box);
}

async function fillCreateDatalist() {
  if (!CONTACTS || !CONTACTS.length) { const { items } = await api.get('/api/contacts'); CONTACTS = items || []; }
}
