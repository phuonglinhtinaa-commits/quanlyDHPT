const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// MẬT KHẨU QUẢN TRỊ (Có thể chỉnh sửa tại Render Environment Variable)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware kiểm tra mật khẩu Admin
function verifyAdmin(req, res, next) {
    const adminPassword = req.headers['x-admin-password'];
    if (adminPassword !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác!' });
    }
    next();
}

// Helper: Chuẩn hóa chuỗi văn bản (Loại bỏ dấu, ký tự đặc biệt, chuyển chữ thường)
function normalizeText(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/^(mua\s+he\s+xanh|he\s+xanh)$/i, 'hè xanh') // Nhận diện 'Mùa hè xanh' và 'hè xanh' là một
        .replace(/\s+/g, ' ')
        .trim();
}

// Khởi tạo CSDL SQLite
const db = new sqlite3.Database('./tnv_database.sqlite', (err) => {
    if (err) console.error('Lỗi kết nối CSDL:', err.message);
    else console.log('Đã kết nối CSDL SQLite thành công.');
});

// Tạo bảng
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS volunteers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullName TEXT NOT NULL,
            studentId TEXT NOT NULL UNIQUE,
            activities JSON DEFAULT '[]',
            activityCount INTEGER DEFAULT 0,
            violations JSON DEFAULT '[]',
            violationCount INTEGER DEFAULT 0,
            campaigns JSON DEFAULT '[]',
            campaignCount INTEGER DEFAULT 0,
            achievements JSON DEFAULT '[]',
            generalNotes JSON DEFAULT '[]',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Helper DB
function getVolunteerById(id, callback) {
    db.get(`SELECT * FROM volunteers WHERE id = ?`, [id], (err, row) => {
        if (err || !row) return callback(err || new Error('Không tìm thấy TNV'));
        row.activities = JSON.parse(row.activities || '[]');
        row.violations = JSON.parse(row.violations || '[]');
        row.campaigns = JSON.parse(row.campaigns || '[]');
        row.achievements = JSON.parse(row.achievements || '[]');
        row.generalNotes = JSON.parse(row.generalNotes || '[]');
        callback(null, row);
    });
}

function getOrCreateVolunteer(fullName, studentId, callback) {
    db.get(`SELECT * FROM volunteers WHERE studentId = ?`, [studentId.trim()], (err, row) => {
        if (err) return callback(err);
        if (row) {
            row.activities = JSON.parse(row.activities || '[]');
            row.violations = JSON.parse(row.violations || '[]');
            row.campaigns = JSON.parse(row.campaigns || '[]');
            row.achievements = JSON.parse(row.achievements || '[]');
            row.generalNotes = JSON.parse(row.generalNotes || '[]');
            return callback(null, row);
        } else {
            db.run(`INSERT INTO volunteers (fullName, studentId) VALUES (?, ?)`, [fullName.trim(), studentId.trim()], function (err) {
                if (err) return callback(err);
                callback(null, {
                    id: this.lastID,
                    fullName: fullName.trim(),
                    studentId: studentId.trim(),
                    activities: [], activityCount: 0,
                    violations: [], violationCount: 0,
                    campaigns: [], campaignCount: 0,
                    achievements: [], generalNotes: []
                });
            });
        }
    });
}

// --- API ENDPOINTS ---

// 1. Lấy toàn bộ danh sách (BẢO MẬT: Cần Mật khẩu Admin để xem Bảng tổng kết)
app.get('/api/volunteers', verifyAdmin, (req, res) => {
    db.all(`SELECT * FROM volunteers ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const data = rows.map(row => ({
            ...row,
            activities: JSON.parse(row.activities || '[]'),
            violations: JSON.parse(row.violations || '[]'),
            campaigns: JSON.parse(row.campaigns || '[]'),
            achievements: JSON.parse(row.achievements || '[]'),
            generalNotes: JSON.parse(row.generalNotes || '[]')
        }));
        res.json(data);
    });
});

// 2. Tra cứu thành tích cá nhân (CÔNG KHAI cho TNV - Yêu cầu nhập đúng Họ tên và MSSV)
app.post('/api/volunteers/my-profile', (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) {
        return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Họ tên và MSSV để tra cứu!' });
    }

    db.get(
        `SELECT * FROM volunteers WHERE studentId = ? AND LOWER(fullName) = LOWER(?)`,
        [studentId.trim(), fullName.trim()],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) {
                return res.status(404).json({ error: 'Không tìm thấy thông tin TNV phù hợp với Họ tên và MSSV này!' });
            }
            res.json({
                ...row,
                activities: JSON.parse(row.activities || '[]'),
                violations: JSON.parse(row.violations || '[]'),
                campaigns: JSON.parse(row.campaigns || '[]'),
                achievements: JSON.parse(row.achievements || '[]'),
                generalNotes: JSON.parse(row.generalNotes || '[]')
            });
        }
    );
});

// 3. Thêm TNV mới thủ công (Cần Admin)
app.post('/api/volunteers/create', verifyAdmin, (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) return res.status(400).json({ error: 'Vui lòng điền đủ Họ tên và MSSV!' });

    db.run(`INSERT INTO volunteers (fullName, studentId) VALUES (?, ?)`, [fullName.trim(), studentId.trim()], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: `MSSV "${studentId.trim()}" đã tồn tại!` });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: `Đã thêm thành công TNV: ${fullName.trim()} (${studentId.trim()})` });
    });
});

// 4. Form 1: Điền buổi tình nguyện (CÔNG KHAI - Chống trùng lặp na ná nhau)
app.post('/api/volunteers/activity', (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    if (!fullName || !studentId || !jobContent || !date) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    getOrCreateVolunteer(fullName, studentId, (err, volunteer) => {
        if (err) return res.status(500).json({ error: err.message });

        const normJob = normalizeText(jobContent);
        const isDuplicate = volunteer.activities.some(act => act.date === date && normalizeText(act.jobContent) === normJob);

        if (isDuplicate) {
            return res.status(400).json({ error: 'Bạn đã ghi nhận buổi tình nguyện này trước đó rồi!' });
        }

        const updatedActivities = [...volunteer.activities, { jobContent, date }];
        db.run(
            `UPDATE volunteers SET activities = ?, activityCount = ?, fullName = ? WHERE id = ?`,
            [JSON.stringify(updatedActivities), updatedActivities.length, fullName.trim(), volunteer.id],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Cập nhật buổi tình nguyện thành công!' });
            }
        );
    });
});

// 5. Form 2: Điền chiến dịch lớn (CÔNG KHAI - KHÔNG CẦN MAT KHÂU ADMIN)
app.post('/api/volunteers/campaign', (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    if (!fullName || !studentId || !campaignName) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    getOrCreateVolunteer(fullName, studentId, (err, volunteer) => {
        if (err) return res.status(500).json({ error: err.message });

        const normCamp = normalizeText(campaignName);
        const isDuplicate = volunteer.campaigns.some(camp => normalizeText(camp) === normCamp);

        if (isDuplicate) {
            return res.status(400).json({ error: 'Bạn đã được ghi nhận tham gia chiến dịch này rồi!' });
        }

        const updatedCampaigns = [...volunteer.campaigns, campaignName];
        db.run(
            `UPDATE volunteers SET campaigns = ?, campaignCount = ?, fullName = ? WHERE id = ?`,
            [JSON.stringify(updatedCampaigns), updatedCampaigns.length, fullName.trim(), volunteer.id],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Ghi nhận chiến dịch thành công!' });
            }
        );
    });
});

// 6. Nhập thông tin bổ sung Vi phạm/Thành tích (Cần Admin)
app.post('/api/volunteers/additional-info', verifyAdmin, (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;

    if (!fullName || !category) return res.status(400).json({ error: 'Vui lòng điền đủ thông tin!' });

    const sqlSearch = studentId ? `SELECT * FROM volunteers WHERE studentId = ?` : `SELECT * FROM volunteers WHERE LOWER(fullName) = LOWER(?)`;
    const params = studentId ? [studentId.trim()] : [fullName.trim()];

    db.all(sqlSearch, params, (err, rows) => {
        if (err || rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy TNV!' });

        const volunteer = rows[0];
        volunteer.violations = JSON.parse(volunteer.violations || '[]');
        volunteer.achievements = JSON.parse(volunteer.achievements || '[]');
        volunteer.generalNotes = JSON.parse(volunteer.generalNotes || '[]');

        let updateSql = '', updateParams = [];

        if (category === 'violation') {
            const updated = [...volunteer.violations, { error: violationError, date: violationDate }];
            updateSql = `UPDATE volunteers SET violations = ?, violationCount = ? WHERE id = ?`;
            updateParams = [JSON.stringify(updated), updated.length, volunteer.id];
        } else if (category === 'achievement') {
            const updated = [...volunteer.achievements, achievementContent];
            updateSql = `UPDATE volunteers SET achievements = ? WHERE id = ?`;
            updateParams = [JSON.stringify(updated), volunteer.id];
        } else if (category === 'note') {
            const updated = [...volunteer.generalNotes, noteContent];
            updateSql = `UPDATE volunteers SET generalNotes = ? WHERE id = ?`;
            updateParams = [JSON.stringify(updated), volunteer.id];
        }

        db.run(updateSql, updateParams, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Cập nhật thông tin thành công!' });
        });
    });
});

// 7. Xóa dữ liệu (Cần Admin)
app.delete('/api/volunteers/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM volunteers WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Đã xóa hồ sơ TNV!' });
    });
});

app.delete('/api/volunteers/:id/item', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { type, index } = req.body;

    getVolunteerById(id, (err, volunteer) => {
        if (err) return res.status(404).json({ error: 'Không tìm thấy TNV!' });

        let updateSql = '', params = [];
        if (type === 'activity') {
            volunteer.activities.splice(index, 1);
            updateSql = `UPDATE volunteers SET activities = ?, activityCount = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.activities), volunteer.activities.length, id];
        } else if (type === 'campaign') {
            volunteer.campaigns.splice(index, 1);
            updateSql = `UPDATE volunteers SET campaigns = ?, campaignCount = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.campaigns), volunteer.campaigns.length, id];
        } else if (type === 'violation') {
            volunteer.violations.splice(index, 1);
            updateSql = `UPDATE volunteers SET violations = ?, violationCount = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.violations), volunteer.violations.length, id];
        } else if (type === 'achievement') {
            volunteer.achievements.splice(index, 1);
            updateSql = `UPDATE volunteers SET achievements = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.achievements), id];
        } else if (type === 'note') {
            volunteer.generalNotes.splice(index, 1);
            updateSql = `UPDATE volunteers SET generalNotes = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.generalNotes), id];
        }

        db.run(updateSql, params, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Đã xóa mục được chọn!' });
        });
    });
});

// Catch-all route cho frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên port: ${PORT}`);
});
