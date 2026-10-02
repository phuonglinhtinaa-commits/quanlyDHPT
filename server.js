const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'OPTC140921';

// Lấy URL và Token từ biến môi trường Render
let rawUrl = (process.env.TURSO_DATABASE_URL || '').trim();
if (rawUrl.startsWith('libsql://')) {
    rawUrl = rawUrl.replace('libsql://', 'https://');
}
const TURSO_URL = rawUrl;
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();

async function tursoQuery(sql, args = []) {
    const response = await fetch(`${TURSO_URL}/v2/pipeline`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TURSO_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            requests: [
                {
                    type: 'execute',
                    stmt: { 
                        sql, 
                        args: args.map(val => 
                            val === null ? { type: 'null' } : 
                            typeof val === 'number' ? { type: 'integer', value: val.toString() } : 
                            { type: 'text', value: val.toString() }
                        ) 
                    }
                },
                { type: 'close' }
            ]
        })
    });
    
    const data = await response.json();
    if (!response.ok || data.batched_results?.[0]?.type === 'error') {
        const errDetails = data.batched_results?.[0]?.error?.message || JSON.stringify(data);
        throw new Error(errDetails);
    }
    
    const result = data.batched_results?.[0]?.response?.result;
    if (!result || !result.cols || !result.rows) {
        return { rows: [] };
    }

    const cols = result.cols.map(c => c.name);
    const rows = result.rows.map(row => {
        let obj = {};
        row.forEach((cell, idx) => {
            obj[cols[idx]] = cell.value;
        });
        return obj;
    });
    return { rows };
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

// Khởi tạo bảng qua Turso HTTP API
async function initDatabase() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS volunteers (id INTEGER PRIMARY KEY AUTOINCREMENT, fullName TEXT NOT NULL, studentId TEXT NOT NULL UNIQUE, isApproved INTEGER DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, volunteerId INTEGER NOT NULL, jobContent TEXT NOT NULL, date TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, volunteerId INTEGER NOT NULL, campaignName TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS violations (id INTEGER PRIMARY KEY AUTOINCREMENT, volunteerId INTEGER NOT NULL, error TEXT NOT NULL, date TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, volunteerId INTEGER NOT NULL, content TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS general_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, volunteerId INTEGER NOT NULL, content TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`
    ];

    try {
        for (const sql of tables) {
            await tursoQuery(sql);
        }
        console.log("✅ Khởi tạo và kết nối Turso HTTP thành công!");
    } catch (e) {
        console.error("❌ Lỗi khởi tạo Turso HTTP:", e.message);
    }
}
initDatabase();

async function findVolunteer(fullName, studentId) {
    const cleanName = normalizeString(fullName);
    const cleanId = normalizeString(studentId);

    const res = await tursoQuery(`SELECT * FROM volunteers`);
    return res.rows.find(v => {
        const matchId = cleanId && normalizeString(v.studentId) === cleanId;
        const matchName = cleanName && normalizeString(v.fullName) === cleanName;
        return matchId || matchName;
    });
}

// --- API ROUTES ---
app.post('/api/volunteers/register', async (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) return res.status(400).json({ error: 'Vui lòng nhập đủ Họ tên và MSSV!' });

    try {
        const exist = await tursoQuery(`SELECT * FROM volunteers WHERE LOWER(TRIM(studentId)) = ?`, [studentId.trim().toLowerCase()]);
        if (exist.rows.length > 0) return res.status(400).json({ error: 'MSSV này đã tồn tại!' });

        await tursoQuery(`INSERT INTO volunteers (fullName, studentId, isApproved) VALUES (?, ?, 0)`, [fullName.trim(), studentId.trim()]);
        res.json({ message: 'Đăng ký khởi tạo thành công! Vui lòng chờ Admin duyệt.' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi lưu dữ liệu!' });
    }
});

app.post('/api/volunteers/activity', async (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

        await tursoQuery(`INSERT INTO activities (volunteerId, jobContent, date) VALUES (?, ?, ?)`, [volunteer.id, jobContent.trim(), date]);
        res.json({ message: 'Thêm buổi tình nguyện thành công!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi cập nhật buổi tình nguyện!' });
    }
});

app.post('/api/volunteers/campaign', async (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

        await tursoQuery(`INSERT INTO campaigns (volunteerId, campaignName) VALUES (?, ?)`, [volunteer.id, campaignName.trim()]);
        res.json({ message: 'Ghi nhận chiến dịch thành công!' });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi ghi nhận chiến dịch!' });
    }
});

app.post('/api/volunteers/additional-info', verifyAdmin, async (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

        if (category === 'violation') {
            await tursoQuery(`INSERT INTO violations (volunteerId, error, date) VALUES (?, ?, ?)`, [volunteer.id, violationError.trim(), violationDate]);
            return res.json({ message: 'Cập nhật vi phạm thành công!' });
        } else if (category === 'achievement') {
            await tursoQuery(`INSERT INTO achievements (volunteerId, content) VALUES (?, ?)`, [volunteer.id, achievementContent.trim()]);
            return res.json({ message: 'Cập nhật thành tích thành công!' });
        } else if (category === 'note') {
            await tursoQuery(`INSERT INTO general_notes (volunteerId, content) VALUES (?, ?)`, [volunteer.id, noteContent.trim()]);
            return res.json({ message: 'Cập nhật ghi chú thành công!' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Lỗi cập nhật thông tin bổ sung!' });
    }
});

app.post('/api/volunteers/my-profile', async (req, res) => {
    const { fullName, studentId } = req.body;
    try {
        const volunteer = await findVolunteer(fullName, studentId);
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy dữ liệu!' });

        const vId = volunteer.id;
        const acts = await tursoQuery(`SELECT id, jobContent, date FROM activities WHERE volunteerId = ?`, [vId]);
        const camps = await tursoQuery(`SELECT id, campaignName FROM campaigns WHERE volunteerId = ?`, [vId]);
        const viols = await tursoQuery(`SELECT id, error, date FROM violations WHERE volunteerId = ?`, [vId]);
        const achs = await tursoQuery(`SELECT id, content FROM achievements WHERE volunteerId = ?`, [vId]);
        const notes = await tursoQuery(`SELECT id, content FROM general_notes WHERE volunteerId = ?`, [vId]);

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

app.get('/api/volunteers', verifyAdmin, async (req, res) => {
    try {
        const volunteers = await tursoQuery(`SELECT * FROM volunteers ORDER BY id DESC`);

        const result = await Promise.all(volunteers.rows.map(async (v) => {
            const acts = await tursoQuery(`SELECT id, jobContent, date FROM activities WHERE volunteerId = ?`, [v.id]);
            const camps = await tursoQuery(`SELECT id, campaignName FROM campaigns WHERE volunteerId = ?`, [v.id]);
            const viols = await tursoQuery(`SELECT id, error, date FROM violations WHERE volunteerId = ?`, [v.id]);
            const achs = await tursoQuery(`SELECT id, content FROM achievements WHERE volunteerId = ?`, [v.id]);
            const notes = await tursoQuery(`SELECT id, content FROM general_notes WHERE volunteerId = ?`, [v.id]);

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

app.post('/api/volunteers/:id/approve', verifyAdmin, async (req, res) => {
    await tursoQuery(`UPDATE volunteers SET isApproved = 1 WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Đã duyệt!' });
});

app.delete('/api/volunteers/:id', verifyAdmin, async (req, res) => {
    await tursoQuery(`DELETE FROM volunteers WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Đã xóa hồ sơ!' });
});

app.delete('/api/items/activity/:id', verifyAdmin, async (req, res) => {
    await tursoQuery(`DELETE FROM activities WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Đã xóa!' });
});

app.delete('/api/items/violation/:id', verifyAdmin, async (req, res) => {
    await tursoQuery(`DELETE FROM violations WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Đã xóa!' });
});

app.delete('/api/items/campaign/:id', verifyAdmin, async (req, res) => {
    await tursoQuery(`DELETE FROM campaigns WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Đã xóa!' });
});

app.delete('/api/items/achievement/:id', verifyAdmin, async (req, res) => {
    await tursoQuery(`DELETE FROM achievements WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Đã xóa!' });
});

app.delete('/api/items/note/:id', verifyAdmin, async (req, res) => {
    await tursoQuery(`DELETE FROM general_notes WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Đã xóa!' });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
        
