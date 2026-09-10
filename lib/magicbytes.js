'use strict';

/**
 * magicbytes.js — ตรวจชนิดไฟล์จริงจาก "เลขวิเศษ" (magic bytes) ที่ต้นไฟล์
 * -------------------------------------------------------------
 * ไม่ควรเชื่อ MIME type ที่ฝั่ง client ส่งมาเพียงอย่างเดียว เพราะปลอมแปลงได้ง่าย
 * (เช่น เปลี่ยนนามสกุล/แก้ header request) ระบบรับอัปโหลดไฟล์ PDF, PNG, JPG, WEBP
 * เท่านั้น จึงตรวจ byte จริงของไฟล์ให้ตรงกับ MIME ที่แจ้งมาก่อนบันทึกทุกครั้ง
 */

function matches(buf, mime) {
  if (!buf || buf.length < 4) return false;
  switch (mime) {
    case 'application/pdf':
      return buf.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png':
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/webp':
      return buf.length >= 12
        && buf.subarray(0, 4).toString('latin1') === 'RIFF'
        && buf.subarray(8, 12).toString('latin1') === 'WEBP';
    default:
      return false;
  }
}

module.exports = { matches };
