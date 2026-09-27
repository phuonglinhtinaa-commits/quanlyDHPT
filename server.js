const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// MẬT KHẨU QUẢN TRỊ (Có thể đổi tùy ý)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware kiểm tra mật khẩu Admin
function verifyAdmin(req, res, next) {
    const adminPassword = req.headers['x-admin-password'];
    if (adminPassword !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác!' });
    }
    next();
}

// Khởi tạo CSDL SQLite
const db = new sqlite3.Database('./tnv_database.sqlite', (err) => {
    if (err) {
        console.error('Lỗi kết nối CSDL SQLite:', err.message);
    } else {
        console.log('Đã kết nối thành công tới CSDL SQLite (tnv_database.sqlite).');
    }
});

// Tạo bảng lưu trữ dữ liệu Tình nguyện viên
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

// Helper: Lấy thông tin TNV theo ID và parse JSON
function getVolunteerById(id, callback) {
    const sql = `SELECT * FROM volunteers WHERE id = ?`;
    db.get(sql, [id], (err, row) => {
        if (err || !row) return callback(err || new Error('Không tìm thấy TNV'));
        row.activities = JSON.parse(row.activities || '[]');
        row.violations = JSON.parse(row.violations || '[]');
        row.campaigns = JSON.parse(row.campaigns || '[]');
        row.achievements = JSON.parse(row.achievements || '[]');
        row.generalNotes = JSON.parse(row.generalNotes || '[]');
        callback(null, row);
    });
}

// Helper: Tìm hoặc Tạo mới TNV
function getOrCreateVolunteer(fullName, studentId, callback) {
    const findSql = `SELECT * FROM volunteers WHERE studentId = ?`;
    db.get(findSql, [studentId.trim()], (err, row) => {
        if (err) return callback(err);
        if (row) {
            row.activities = JSON.parse(row.activities || '[]');
            row.violations = JSON.parse(row.violations || '[]');
            row.campaigns = JSON.parse(row.campaigns || '[]');
            row.achievements = JSON.parse(row.achievements || '[]');
            row.generalNotes = JSON.parse(row.generalNotes || '[]');
            return callback(null, row);
        } else {
            const insertSql = `INSERT INTO volunteers (fullName, studentId) VALUES (?, ?)`;
            db.run(insertSql, [fullName.trim(), studentId.trim()], function (err) {
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

// 1. Lấy danh sách tất cả Tình nguyện viên (Công khai)
app.get('/api/volunteers', (req, res) => {
    const sql = `SELECT * FROM volunteers ORDER BY id ASC`;
    db.all(sql, [], (err, rows) => {
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

// 2. Thêm TNV ban đầu (Cần Mật Khẩu Admin)
app.post('/api/volunteers/create', verifyAdmin, (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ Họ tên và MSSV!' });
    }

    const sql = `INSERT INTO volunteers (fullName, studentId) VALUES (?, ?)`;
    db.run(sql, [fullName.trim(), studentId.trim()], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: `MSSV "${studentId.trim()}" đã tồn tại trong hệ thống!` });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: `Đã thêm thành công TNV: ${fullName.trim()} (${studentId.trim()}) vào danh sách!` });
    });
});

// 3. Xóa toàn bộ hồ sơ TNV / dòng dữ liệu sai (Cần Mật Khẩu Admin)
app.delete('/api/volunteers/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const sql = `DELETE FROM volunteers WHERE id = ?`;
    db.run(sql, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Không tìm thấy TNV để xóa!' });
        res.json({ message: 'Đã xóa toàn bộ dòng dữ liệu của tình nguyện viên!' });
    });
});

// 4. Xóa lẻ 1 mục sai trong 1 dòng (1 buổi TN, 1 lỗi vi phạm, 1 chiến dịch...) (Cần Mật Khẩu Admin)
app.delete('/api/volunteers/:id/item', verifyAdmin, (req, res) => {
    const { id } = req.params;
    const { type, index } = req.body;

    getVolunteerById(id, (err, volunteer) => {
        if (err) return res.status(404).json({ error: 'Không tìm thấy TNV!' });

        let updateSql = '';
        let params = [];

        if (type === 'activity') {
            volunteer.activities.splice(index, 1);
            updateSql = `UPDATE volunteers SET activities = ?, activityCount = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.activities), volunteer.activities.length, id];
        } else if (type === 'violation') {
            volunteer.violations.splice(index, 1);
            updateSql = `UPDATE volunteers SET violations = ?, violationCount = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.violations), volunteer.violations.length, id];
        } else if (type === 'campaign') {
            volunteer.campaigns.splice(index, 1);
            updateSql = `UPDATE volunteers SET campaigns = ?, campaignCount = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.campaigns), volunteer.campaigns.length, id];
        } else if (type === 'achievement') {
            volunteer.achievements.splice(index, 1);
            updateSql = `UPDATE volunteers SET achievements = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.achievements), id];
        } else if (type === 'note') {
            volunteer.generalNotes.splice(index, 1);
            updateSql = `UPDATE volunteers SET generalNotes = ? WHERE id = ?`;
            params = [JSON.stringify(volunteer.generalNotes), id];
        } else {
            return res.status(400).json({ error: 'Loại mục xóa không hợp lệ!' });
        }

        db.run(updateSql, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Đã xóa thành công mục được chọn!' });
        });
    });
});

// 5. Form 1: Ghi nhận buổi tình nguyện (CÔNG KHAI cho TNV điền)
app.post('/api/volunteers/activity', (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    if (!fullName || !studentId || !jobContent || !date) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    getOrCreateVolunteer(fullName, studentId, (err, volunteer) => {
        if (err) return res.status(500).json({ error: err.message });

        const updatedActivities = [...volunteer.activities, { jobContent, date }];
        const updatedCount = volunteer.activityCount + 1;

        const updateSql = `UPDATE volunteers SET activities = ?, activityCount = ?, fullName = ? WHERE id = ?`;
        db.run(updateSql, [JSON.stringify(updatedActivities), updatedCount, fullName.trim(), volunteer.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Cập nhật buổi tình nguyện thành công!' });
        });
    });
});

// 6. Form 2: Ghi nhận Chiến dịch lớn (CẦN MẬT KHẨU ADMIN)
app.post('/api/volunteers/campaign', verifyAdmin, (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    if (!fullName || !studentId || !campaignName) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    getOrCreateVolunteer(fullName, studentId, (err, volunteer) => {
        if (err) return res.status(500).json({ error: err.message });

        const updatedCampaigns = [...volunteer.campaigns, campaignName];
        const updatedCount = volunteer.campaignCount + 1;

        const updateSql = `UPDATE volunteers SET campaigns = ?, campaignCount = ?, fullName = ? WHERE id = ?`;
        db.run(updateSql, [JSON.stringify(updatedCampaigns), updatedCount, fullName.trim(), volunteer.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Ghi nhận chiến dịch thành công!' });
        });
    });
});

// 7. Form 3: Tìm kiếm TNV theo tên
app.get('/api/volunteers/search-by-name', (req, res) => {
    const { name } = req.query;
    if (!name) return res.json([]);

    const sql = `SELECT * FROM volunteers WHERE LOWER(fullName) = LOWER(?)`;
    db.all(sql, [name.trim()], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 8. Form 3: Nhập thông tin bổ sung (CẦN MẬT KHẨU ADMIN)
app.post('/api/volunteers/additional-info', verifyAdmin, (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;

    if (!fullName || !category) {
        return res.status(400).json({ error: 'Vui lòng điền đủ Họ tên và Lựa chọn mục!' });
    }

    const sqlSearch = studentId 
        ? `SELECT * FROM volunteers WHERE studentId = ?`
        : `SELECT * FROM volunteers WHERE LOWER(fullName) = LOWER(?)`;

    const paramSearch = studentId ? [studentId.trim()] : [fullName.trim()];

    db.all(sqlSearch, paramSearch, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống. Vui lòng nhập đúng MSSV để định danh hoặc tạo mới.' });
        }

        if (rows.length > 1 && !studentId) {
            return res.status(400).json({ error: 'Phát hiện trùng tên! Bắt buộc phải cung cấp MSSV để xác định chính xác.' });
        }

        const volunteer = rows[0];
        volunteer.violations = JSON.parse(volunteer.violations || '[]');
        volunteer.achievements = JSON.parse(volunteer.achievements || '[]');
        volunteer.generalNotes = JSON.parse(volunteer.generalNotes || '[]');

        let updateSql = '';
        let params = [];

        if (category === 'violation') {
            if (!violationError || !violationDate) {
                return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Lỗi vi phạm và Ngày vi phạm!' });
            }
            const updatedViolations = [...volunteer.violations, { error: violationError, date: violationDate }];
            const newCount = volunteer.violationCount + 1;
            updateSql = `UPDATE volunteers SET violations = ?, violationCount = ? WHERE id = ?`;
            params = [JSON.stringify(updatedViolations), newCount, volunteer.id];

        } else if (category === 'achievement') {
            if (!achievementContent) {
                return res.status(400).json({ error: 'Vui lòng nhập Nội dung thành tích!' });
            }
            const updatedAchievements = [...volunteer.achievements, achievementContent];
            updateSql = `UPDATE volunteers SET achievements = ? WHERE id = ?`;
            params = [JSON.stringify(updatedAchievements), volunteer.id];

        } else if (category === 'note') {
            if (!noteContent) {
                return res.status(400).json({ error: 'Vui lòng nhập Nội dung ghi chú!' });
            }
            const updatedNotes = [...volunteer.generalNotes, noteContent];
            updateSql = `UPDATE volunteers SET generalNotes = ? WHERE id = ?`;
            params = [JSON.stringify(updatedNotes), volunteer.id];
        }

        db.run(updateSql, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Cập nhật thông tin bổ sung thành công!' });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại address: http://localhost:${PORT}`);
});