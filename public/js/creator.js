// creator.js — ตรรกะหน้าผู้ผลิตเนื้อหาดิจิทัล

let ME = null;

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('v-' + name).classList.add('active');
  if (name === 'overview') loadOverview();
  if (name === 'docs') loadDocs();
  if (name === 'library') loadLibrary();
  if (name === 'inbox') loadInbox();
  if (name === 'overview') loadDashExtra();
  if (name === 'create') { renderCreateCards(); fillCreateDatalist(); crWireAutofill(); }
  if (name === 'profile') initProfile(ME);
}

document.querySelectorAll('.nav-item').forEach((b) =>
  b.addEventListener('click', () => switchView(b.dataset.view))
);

/* ---------- WHT preview + store ---------- */
let pvTimer;
function previewWht() {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(async () => {
    const amount = Number(document.getElementById('c-amount').value);
    const rate = Number(document.getElementById('c-rate').value);
    const box = document.getElementById('c-preview');
    if (!amount) { box.innerHTML = '<div class="empty">กรอกยอดเงินเพื่อดูผลการคำนวณ</div>'; return; }
    const { data: r } = await api.post('/api/wht/calc', { amount, rate });
    box.innerHTML = `
      <div class="line"><span>ฐานภาษี</span><b>฿${baht(r.base)}</b></div>
      <div class="line"><span>ภาษีหัก ณ ที่จ่าย ${r.rate}%</span><b style="color:var(--orange-deep)">-฿${baht(r.wht)}</b></div>
      <div class="line total"><span>ยอดสุทธิที่ได้รับ</span><b>฿${baht(r.net)}</b></div>`;
  }, 120);
}

async function storeWht() {
  const amount = Number(document.getElementById('c-amount').value);
  if (!amount) return toast('กรุณากรอกยอดเงิน', 'err');
  const { ok: created, data: createdDoc } = await api.post('/api/wht/store', {
    payer: document.getElementById('c-payer').value,
    description: document.getElementById('c-desc').value,
    incomeType: document.getElementById('c-income').value,
    amount, rate: Number(document.getElementById('c-rate').value) || 3,
  });
  if (!created) return toast((createdDoc.errors ? createdDoc.errors.join(' · ') : createdDoc.error) || 'บันทึกไม่สำเร็จ', 'err');
  toast('บันทึกเอกสารเรียบร้อย');
  document.getElementById('c-amount').value = '';
  document.getElementById('c-payer').value = '';
  document.getElementById('c-preview').innerHTML = '<div class="empty">กรอกยอดเงินเพื่อดูผลการคำนวณ</div>';
  switchView('docs');
}

/* ---------- Overview ---------- */
async function loadOverview() {
  const s = await api.get('/api/creator/summary');
  document.getElementById('s-count').textContent = s.documentCount;
  document.getElementById('s-gross').textContent = '฿' + baht(s.grossIncome);
  document.getElementById('s-wht').textContent = '฿' + baht(s.withholdingPaid);
  document.getElementById('s-pit').textContent = '฿' + baht(s.estimate.totalTax);

  const { items } = await api.get('/api/documents?type=WHT');
  const body = document.getElementById('ov-body');
  body.innerHTML = items.slice(0, 5).map((d) => `
    <tr class="row-click" onclick="openDoc(${d.id})">
      <td class="docno">${d.docNo}</td><td>${d.payer || '-'}</td>
      <td class="num">${baht(d.base)}</td><td class="num" style="color:var(--orange-deep)">${baht(d.wht)}</td>
      <td class="num">${baht(d.net)}</td>
      <td class="actions" onclick="event.stopPropagation()"><a class="btn btn-ghost btn-sm" href="/api/documents/${d.id}/pdf" target="_blank">PDF</a></td>
    </tr>`).join('') || emptyRow(6);
}

/* ---------- Docs ---------- */
async function loadDocs() {
  const q = document.getElementById('doc-search').value;
  const status = document.getElementById('f-status').value;
  const from = document.getElementById('f-from').value;
  const to = document.getElementById('f-to').value;
  const params = new URLSearchParams({ q, status, from, to });
  const { items } = await api.get('/api/documents?' + params);
  const body = document.getElementById('doc-body');
  body.innerHTML = items.map((d) => {
    const isWhtT = ['WHT', 'EWHT'].includes(d.type);
    const cp = d.party || d.payer || d.buyer || d.payee || '-';
    const total = isWhtT ? d.net : (d.total ?? d.base);
    return `
    <tr class="row-click" onclick="openDoc(${d.id})">
      <td class="docno">${d.docNo}</td><td>${badge(d.type)}</td><td>${cp}</td>
      <td class="num">${baht(d.base)}</td>
      <td class="num">${baht(total)}</td>
      <td>${statusChip(d.status)}${d.sentTo && d.status === 'pending' ? `<div class="sent-to">ส่งถึง ${d.sentTo.name}</div>` : ''}</td>
      <td class="actions" onclick="event.stopPropagation()">
        <a class="btn btn-ghost btn-sm" href="/api/documents/${d.id}/pdf" target="_blank">PDF</a>
        <button class="btn btn-ghost btn-sm" onclick="openDoc(${d.id})">จัดการ</button>
      </td>
    </tr>`;
  }).join('') || emptyRow(7);
}

/* ---------- PIT ---------- */
async function fillFromDocs() {
  const s = await api.get('/api/creator/summary');
  document.getElementById('p-gross').value = s.grossIncome;
  toast('ดึงยอดรวม ฿' + baht(s.grossIncome) + ' แล้ว');
}
async function estimatePit() {
  const gross = Number(document.getElementById('p-gross').value);
  if (!gross) return toast('กรุณากรอกรายได้', 'err');
  const { data: r } = await api.post('/api/pit/estimate', { grossIncome: gross });
  const steps = r.steps.map((st) => `<div class="line"><span>${st.range} (${st.rate}%)</span><b>฿${baht(st.tax)}</b></div>`).join('');
  document.getElementById('p-result').innerHTML = `
    <div class="line"><span>รายได้รวม</span><b>฿${baht(r.grossIncome)}</b></div>
    <div class="line"><span>หักค่าใช้จ่าย</span><b>-฿${baht(r.expense)}</b></div>
    <div class="line"><span>หักลดหย่อนส่วนตัว</span><b>-฿${baht(r.personalAllowance)}</b></div>
    <div class="line"><span>เงินได้สุทธิ</span><b>฿${baht(r.netIncome)}</b></div>
    ${steps ? '<div style="height:8px"></div>' + steps : ''}
    <div class="line total"><span>ภาษีที่ต้องชำระโดยประมาณ</span><b>฿${baht(r.totalTax)}</b></div>
    <div class="line"><span>อัตราภาษีเฉลี่ย</span><b>${r.effectiveRate}%</b></div>`;
}

function emptyRow(cols) { return emptyStateRow(cols); }

/* ---------- init ---------- */
(async function init() {
  ME = await guard('creator');
  if (!ME) return;
  buildLibraryCategorySelects();
  document.getElementById('u-av').textContent = initials(ME.displayName);
  document.getElementById('u-name').textContent = ME.displayName;
  document.getElementById('u-email').textContent = ME.email;
  showProfileReminder();
  setDocsChangeHandler(() => { loadOverview(); loadDocs(); });
  loadNotifications();
  loadInbox();
  loadDashExtra();
  maybeOnboard();
  crWireAutosave();
  loadOverview();
  // เปิดหน้าโปรไฟล์ทันทีเมื่อถูกส่งมาจากขั้นตอนสมัครสมาชิก (#profile)
  if (location.hash === '#profile') switchView('profile');
})();

/**
 * เตือนเมื่อโปรไฟล์ยังไม่ครบตามที่กฎหมายกำหนด — ถ้าไม่ครบจะออกเอกสารไม่ได้
 * ใช้ข้อมูล PROFILE_META ที่ /api/auth/me ส่งมาพร้อมกับผู้ใช้
 */
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

let CONTACTS = [];
async function fillCreateDatalist() {
  if (!CONTACTS.length) { const { items } = await api.get('/api/contacts'); CONTACTS = items || []; }
}
