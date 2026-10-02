const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

// MẬT KHẨU QUẢN TRỊ CỐ ĐỊNH
const ADMIN_PASSWORD = 'OPTC140921';

// Kết nối Cơ sở dữ liệu Cloud Turso
const db = createClient({
  url: process.env.TURSO_DATABASE_URL ? process.env.TURSO_DATABASE_URL.trim() : '',
  authToken: process.env.TURSO_AUTH_TOKEN ? process.env.TURSO_AUTH_TOKEN.trim() : '',
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware kiểm tra mật khẩu Admin
function verifyAdmin(req, res, next) {
    const adminPassword = req.headers['x-admin-password'];
    if (!adminPassword || adminPassword.trim().toUpperCase() !== ADMIN_PASSWORD.toUpperCase()) {
        return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác!' });
    }
    next();
}

function normalizeString(str) {
    if (!str) return '';
    return str.toString().trim().toLowerCase();
}

// Khởi tạo từng bảng riêng lẻ tránh lỗi Migration 400
async function initDatabase() {
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS volunteers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullName TEXT NOT NULL,
            studentId TEXT NOT NULL UNIQUE,
            isApproved INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            jobContent TEXT NOT NULL,
            date TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            campaignName TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            error TEXT NOT NULL,
            date TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS general_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log("✅ Đã kết nối & khởi tạo bảng thành công trên Turso Cloud Database.");
    } catch (e) {
        console.error("❌ Lỗi khởi tạo bảng Turso:", e.message || e);
    }
}
initDatabase();

async function findVolunteer(fullName, studentId) {
    const cleanName = normalizeString(fullName);
    const cleanId = normalizeString(studentId);

    const res = await db.execute(`SELECT * FROM volunteers`);
    return res.rows.find(v => {
        const matchId = cleanId && normalizeString(v.studentId) === cleanId;
        const matchName = cleanName && normalizeString(v.fullName) === cleanName;
        return matchId || matchName;
    });
}

// --- API ROUTES ---

// 0. Đăng ký khởi tạo TNV
app.post('/api/volunteers/register', async (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) return res.status(400).json({ error: 'Vui lòng nhập đủ Họ tên và MSSV!' });

    try {
        const exist = await db.execute({
            sql: `SELECT * FROM volunteers WHERE LOWER(TRIM(studentId)) = ?`,
            args: [studentId.trim().toLowerCase()]
        });
        if (exist.rows.length > 0) return res.status(400).json({ error: 'MSSV này đã tồn tại!' });

        await db.execute({
            sql: `INSERT INTO volunteers (fullName, studentId, isApproved) VALUES (?, ?, 0)`,
            args: [fullName.trim(), studentId.trim()]
        });
        res.json({ message: 'Đăng ký khởi tạo thành công! Vui lòng chờ Admin duyệt.' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi lưu dữ liệu!' });
    }
});

// 1. Điền buổi tình nguyện
app.post('/api/volunteers/activity', async (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

        await db.execute({
            sql: `INSERT INTO activities (volunteerId, jobContent, date) VALUES (?, ?, ?)`,
            args: [volunteer.id, jobContent.trim(), date]
        });
        res.json({ message: 'Thêm buổi tình nguyện thành công!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi cập nhật buổi tình nguyện!' });
    }
});

// 2. Điền chiến dịch lớn
app.post('/api/volunteers/campaign', async (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

        await db.execute({
            sql: `INSERT INTO campaigns (volunteerId, campaignName) VALUES (?, ?)`,
            args: [volunteer.id, campaignName.trim()]
        });
        res.json({ message: 'Ghi nhận chiến dịch thành công!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi ghi nhận chiến dịch!' });
    }
});

// 3. Ghi nhận vi phạm / thành tích / ghi chú (Admin)
app.post('/api/volunteers/additional-info', verifyAdmin, async (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

        if (category === 'violation') {
            await db.execute({
                sql: `INSERT INTO violations (volunteerId, error, date) VALUES (?, ?, ?)`,
                args: [volunteer.id, violationError.trim(), violationDate]
            });
            return res.json({ message: 'Cập nhật vi phạm thành công!' });
        } else if (category === 'achievement') {
            await db.execute({
                sql: `INSERT INTO achievements (volunteerId, content) VALUES (?, ?)`,
                args: [volunteer.id, achievementContent.trim()]
            });
            return res.json({ message: 'Cập nhật thành tích thành công!' });
        } else if (category === 'note') {
            await db.execute({
                sql: `INSERT INTO general_notes (volunteerId, content) VALUES (?, ?)`,
                args: [volunteer.id, noteContent.trim()]
            });
            return res.json({ message: 'Cập nhật ghi chú thành công!' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Lỗi cập nhật thông tin bổ sung!' });
    }
});

// 4. Tra cứu cá nhân
app.post('/api/volunteers/my-profile', async (req, res) => {
    const { fullName, studentId } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy dữ liệu!' });

        const vId = volunteer.id;
        const acts = await db.execute({ sql: `SELECT id, jobContent, date FROM activities WHERE volunteerId = ?`, args: [vId] });
        const camps = await db.execute({ sql: `SELECT id, campaignName FROM campaigns WHERE volunteerId = ?`, args: [vId] });
        const viols = await db.execute({ sql: `SELECT id, error, date FROM violations WHERE volunteerId = ?`, args: [vId] });
        const achs = await db.execute({ sql: `SELECT id, content FROM achievements WHERE volunteerId = ?`, args: [vId] });
        const notes = await db.execute({ sql: `SELECT id, content FROM general_notes WHERE volunteerId = ?`, args: [vId] });

        res.json({
            fullName: volunteer.fullName,
            studentId: volunteer.studentId,
            isApproved: volunteer.isApproved,
            activityCount: acts.rows.length,
            activities: acts.rows,
            campaignCount: camps.rows.length,
            campaigns: camps.rows.map(c => c.campaignName),
            violationCount: viols.rows.length,
            violations: viols.rows,
            achievements: achs.rows.map(a => a.content),
            generalNotes: notes.rows.map(n => n.content)
        });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi tra cứu dữ liệu!' });
    }
});

// 5. Bảng tổng kết Admin
app.get('/api/volunteers', verifyAdmin, async (req, res) => {
    try {
        const volunteers = await db.execute(`SELECT * FROM volunteers ORDER BY id DESC`);

        const result = await Promise.all(volunteers.rows.map(async (v) => {
            const acts = await db.execute({ sql: `SELECT id, jobContent, date FROM activities WHERE volunteerId = ?`, args: [v.id] });
            const camps = await db.execute({ sql: `SELECT id, campaignName FROM campaigns WHERE volunteerId = ?`, args: [v.id] });
            const viols = await db.execute({ sql: `SELECT id, error, date FROM violations WHERE volunteerId = ?`, args: [v.id] });
            const achs = await db.execute({ sql: `SELECT id, content FROM achievements WHERE volunteerId = ?`, args: [v.id] });
            const notes = await db.execute({ sql: `SELECT id, content FROM general_notes WHERE volunteerId = ?`, args: [v.id] });

            return {
                ...v,
                activities: acts.rows,
                activityCount: acts.rows.length,
                campaigns: camps.rows,
                campaignCount: camps.rows.length,
                violations: viols.rows,
                violationCount: viols.rows.length,
                achievements: achs.rows,
                generalNotes: notes.rows
            };
        }));

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Lỗi tải dữ liệu bảng tổng kết!' });
    }
});

// Duyệt & Xóa hồ sơ TNV
app.post('/api/volunteers/:id/approve', verifyAdmin, async (req, res) => {
    try {
        await db.execute({ sql: `UPDATE volunteers SET isApproved = 1 WHERE id = ?`, args: [req.params.id] });
        res.json({ message: 'Đã duyệt!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi duyệt!' });
    }
});

app.delete('/api/volunteers/:id', verifyAdmin, async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM volunteers WHERE id = ?`, args: [req.params.id] });
        res.json({ message: 'Đã xóa hồ sơ!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi xóa!' });
    }
});

// API XÓA LẺ TỪNG MỤC
app.delete('/api/items/activity/:id', verifyAdmin, async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM activities WHERE id = ?`, args: [req.params.id] });
        res.json({ message: 'Đã xóa buổi tình nguyện!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi xóa!' });
    }
});

app.delete('/api/items/violation/:id', verifyAdmin, async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM violations WHERE id = ?`, args: [req.params.id] });
        res.json({ message: 'Đã xóa lỗi vi phạm!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi xóa!' });
    }
});

app.delete('/api/items/campaign/:id', verifyAdmin, async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM campaigns WHERE id = ?`, args: [req.params.id] });
        res.json({ message: 'Đã xóa chiến dịch!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi xóa!' });
    }
});

app.delete('/api/items/achievement/:id', verifyAdmin, async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM achievements WHERE id = ?`, args: [req.params.id] });
        res.json({ message: 'Đã xóa thành tích!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi xóa!' });
    }
});

app.delete('/api/items/note/:id', verifyAdmin, async (req, res) => {
    try {
        await db.execute({ sql: `DELETE FROM general_notes WHERE id = ?`, args: [req.params.id] });
        res.json({ message: 'Đã xóa ghi chú!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi xóa!' });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
