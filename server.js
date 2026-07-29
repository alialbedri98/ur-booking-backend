const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { pool, initDb } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' })); // allow room for the 3 attached images

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

// ---------- auth middleware ----------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'الجلسة منتهية، يرجى تسجيل الدخول مجدداً' });
  }
}

// ---------- health check ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ================= PUBLIC ROUTES =================

// list available (not-booked, upcoming) slots for citizens
app.get('/api/slots/available', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.id, s.date, s.time
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id
      WHERE b.id IS NULL AND s.date >= CURRENT_DATE
      ORDER BY s.date, s.time
    `);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// list ALL upcoming slots (available + taken) for the calendar view — no personal booker data exposed
app.get('/api/slots/calendar', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.id, s.date, s.time, (b.id IS NOT NULL) AS taken
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id
      WHERE s.date >= CURRENT_DATE
      ORDER BY s.date, s.time
    `);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// create a booking (first-come-first-served, enforced by DB unique constraint)
app.post('/api/bookings', async (req, res) => {
  const { slotId, name, phone, university, college, department, idFront, idBack, letter } = req.body;

  if (!slotId || !name || !phone || !university || !college || !department || !idFront || !idBack || !letter) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول وإرفاق الصور الثلاث' });
  }

  const ref = 'UR-' + Date.now().toString().slice(-6) + '-' + Math.floor(1000 + Math.random() * 9000);

  try {
    const result = await pool.query(
      `INSERT INTO bookings (slot_id, ref, name, phone, university, college, department, id_front, id_back, letter)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ref`,
      [slotId, ref, name, phone, university, college, department, idFront, idBack, letter]
    );
    res.json({ ok: true, ref: result.rows[0].ref });
  } catch (e) {
    if (e.code === '23505') { // unique_violation -> slot already booked
      return res.status(409).json({ error: 'عذراً، تم حجز هذا الموعد للتو من قِبل مستخدم آخر' });
    }
    console.error(e);
    res.status(500).json({ error: 'تعذّر حفظ الحجز، حاول مرة أخرى' });
  }
});

// admin login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM admins WHERE username=$1', [username]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    const admin = r.rows[0];
    const match = await bcrypt.compare(password || '', admin.password_hash);
    if (!match) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ================= ADMIN ROUTES (require JWT) =================

// full slot list with booking status + booker name (no images, kept light)
app.get('/api/admin/slots', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.id, s.date, s.time,
             b.id AS booking_id, b.ref, b.name
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id
      ORDER BY s.date, s.time
    `);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// add new slots: { date: '2026-08-01', times: ['09:00','10:00'] }
app.post('/api/admin/slots', requireAuth, async (req, res) => {
  const { date, times } = req.body;
  if (!date || !Array.isArray(times) || times.length === 0) {
    return res.status(400).json({ error: 'يرجى إدخال التاريخ ووقت واحد على الأقل' });
  }
  try {
    for (const t of times) {
      await pool.query(
        `INSERT INTO slots (date, time) VALUES ($1,$2) ON CONFLICT (date, time) DO NOTHING`,
        [date, t]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// delete a slot (cascades to its booking, if any)
app.delete('/api/admin/slots/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM slots WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// full booking detail including images, for the admin "view details" modal
app.get('/api/admin/bookings/:slotId', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM bookings WHERE slot_id=$1', [req.params.slotId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'لم يتم العثور على الحجز' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// cancel a booking (frees the slot again)
app.delete('/api/admin/bookings/:slotId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM bookings WHERE slot_id=$1', [req.params.slotId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// change admin password
app.post('/api/admin/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة قصيرة جداً (6 أحرف على الأقل)' });
  }
  try {
    const r = await pool.query('SELECT * FROM admins WHERE id=$1', [req.admin.id]);
    const admin = r.rows[0];
    const match = await bcrypt.compare(oldPassword || '', admin.password_hash);
    if (!match) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admins SET password_hash=$1 WHERE id=$2', [hash, req.admin.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => console.log(`✔ Server running on port ${PORT}`));
});
