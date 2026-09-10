/* library.js — คลังเอกสารตามหมวด ใช้ร่วมทุกบทบาท */

/* ---------- คลังเอกสาร (ข้อ 6-8) ---------- */
let LIB_FILE = null;

function buildLibraryCategorySelects() {
  const groups = DOC_LIBRARY[ME.role] || [];
  const sel = document.getElementById('lib-cat');
  const filter = document.getElementById('lib-filter');
  if (!sel) return;
  sel.innerHTML = groups.map((g) =>
    `<optgroup label="${g.group}">` + g.items.map((it) => `<option value="${it.id}">${it.label}</option>`).join('') + '</optgroup>').join('');
  if (filter) filter.innerHTML = '<option value="">ทุกหมวด</option>' + groups.map((g) =>
    `<optgroup label="${g.group}">` + g.items.map((it) => `<option value="${it.id}">${it.label}</option>`).join('') + '</optgroup>').join('');
  wireLibDropzone();
}

function wireLibDropzone() {
  const dz = document.getElementById('lib-dropzone');
  const input = document.getElementById('lib-file');
  if (!dz || dz.dataset.wired) return;
  dz.dataset.wired = '1';
  const handle = (file) => {
    const okTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!okTypes.includes(file.type)) return toast('รองรับเฉพาะ PDF, PNG, JPG, WEBP', 'err');
    if (file.size > 10 * 1024 * 1024) return toast('ไฟล์เกิน 10 MB', 'err');
    const reader = new FileReader();
    reader.onload = () => {
      LIB_FILE = { filename: file.name, mime: file.type, dataUrl: reader.result };
      const isImg = file.type.startsWith('image/');
      document.getElementById('lib-preview').innerHTML = `
        <div class="preview-card">
          <div class="mlabel">ตัวอย่างก่อนบันทึก</div>
          ${isImg ? `<img src="${reader.result}" class="preview-img">` : `<div class="pdf-badge">PDF · ${file.name}</div>`}
        </div>`;
      document.getElementById('lib-save').classList.remove('hidden');
      if (!document.getElementById('lib-title').value) document.getElementById('lib-title').value = file.name.replace(/\.[^.]+$/, '');
    };
    reader.readAsDataURL(file);
  };
  input.addEventListener('change', () => input.files[0] && handle(input.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handle(f); });
}

async function saveLibrary() {
  if (!LIB_FILE) return toast('กรุณาเลือกไฟล์ก่อน', 'err');
  const { ok, data } = await api.post('/api/library', {
    category: document.getElementById('lib-cat').value,
    title: document.getElementById('lib-title').value.trim(),
    year: document.getElementById('lib-year').value,
    note: document.getElementById('lib-note').value.trim(),
    filename: LIB_FILE.filename, mime: LIB_FILE.mime,
    dataBase64: LIB_FILE.dataUrl.split(',')[1],
  });
  if (!ok) return toast(data.error || 'บันทึกไม่สำเร็จ', 'err');
  toast('บันทึกเข้าคลังเอกสารแล้ว');
  LIB_FILE = null;
  document.getElementById('lib-preview').innerHTML = '';
  document.getElementById('lib-save').classList.add('hidden');
  ['lib-title', 'lib-note', 'lib-year'].forEach((i) => document.getElementById(i).value = '');
  loadLibrary();
}

async function loadLibrary() {
  const q = document.getElementById('lib-search').value;
  const cat = document.getElementById('lib-filter').value;
  const { items } = await api.get('/api/library?q=' + encodeURIComponent(q) + '&category=' + encodeURIComponent(cat));
  document.getElementById('lib-grid').innerHTML = items.map((l) => `
    <div class="lib-card">
      <span class="lib-cat">${libCategoryLabel(l.category)}</span>
      <div class="lib-title">${l.title}</div>
      <div class="lib-meta">${l.filename} · ${Math.round((l.size || 0) / 1024)} KB${l.year ? ' · ปี ' + l.year : ''}${l.note ? '<br>หมายเหตุ: ' + l.note : ''}</div>
      <div class="btn-row">
        <a class="btn btn-ghost btn-sm" href="/api/library/${l.id}/file" target="_blank">เปิด</a>
        <button class="btn btn-danger btn-sm" onclick="delLibrary(${l.id})">ลบ</button>
      </div>
    </div>`).join('') || '<div class="empty" style="color:var(--ink-soft);font-size:13px;padding:20px;grid-column:1/-1;text-align:center;">ยังไม่มีเอกสารในคลัง — อัปโหลดไฟล์แรกทางซ้าย</div>';
}

async function delLibrary(id) {
  if (!(await uiConfirm('เอกสารนี้จะถูกลบออกจากคลังถาวร', { title: 'ลบจากคลังเอกสาร?', confirmText: 'ลบ', cancelText: 'กลับ' }))) return;
  await api.del('/api/library/' + id);
  toast('ลบแล้ว');
  loadLibrary();
}
