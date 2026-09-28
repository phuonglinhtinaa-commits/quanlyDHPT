const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// MẬT KHẨU QUẢN TRỊ (Có thể đổi qua Environment Variable trên Render)
const ADMIN_PASSWORD ='OPTC140921';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phục vụ file giao diện tĩnh
app.use(express.static(path.join(__dirname, 'public')));

// Middleware kiểm tra mật khẩu Admin
function verifyAdmin(req, res, next) {
    const adminPassword = req.headers['x-admin-password'];
    if (adminPassword !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác!' });
    }
    next();
}

// Helper: Chuẩn hóa chuỗi văn bản
function normalizeText(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/^(mua\s+he\s+xanh|he\s+xanh)$/i, 'hè xanh')
        .replace(/\s+/g, ' ')
        .trim();
}

// Khởi tạo CSDL SQLite
const db = new sqlite3.Database('./tnv_database.sqlite', (err) => {
    if (err) console.error('Lỗi kết nối CSDL:', err.message);
    else console.log('Đã kết nối CSDL SQLite thành công.');
});

// Tạo bảng (Thêm trường isApproved và createdAt)
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
            isApproved INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// TỰ ĐỘNG XÓA CÁC HỒ SƠ CHƯA DUYỆT SẠCH SẼ SAU 24 GIỜ (Chạy định kỳ mỗi giờ)
setInterval(() => {
    const cleanupSql = `
        DELETE FROM volunteers 
        WHERE isApproved = 0 
        AND datetime(createdAt) <= datetime('now', '-24 hours')
    `;
    db.run(cleanupSql, function (err) {
        if (!err && this.changes > 0) {
            console.log(`Đã tự động xóa ${this.changes} hồ sơ khởi tạo chưa được duyệt quá 24h.`);
        }
    });
}, 3600000); // 1 giờ kiểm tra 1 lần

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

// --- API ENDPOINTS ---

// 1. Khởi tạo TNV mới (KHÔNG CẦN MẬT KHẨU - Mặc định 0 buổi, Chờ duyệt)
app.post('/api/volunteers/register', (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ Họ tên và MSSV!' });
    }

    const sql = `INSERT INTO volunteers (fullName, studentId, isApproved) VALUES (?, ?, 0)`;
    db.run(sql, [fullName.trim(), studentId.trim()], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: `MSSV "${studentId.trim()}" đã tồn tại trên hệ thống!` });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Khởi tạo thành công! Hồ sơ đang ở trạng thái chờ Admin duyệt (Sẽ tự hủy sau 24h nếu không duyệt).' });
    });
});

// 2. Lấy toàn bộ danh sách (Bảo mật - Cần Admin)
app.get('/api/volunteers', verifyAdmin, (req, res) => {
    db.all(`SELECT * FROM volunteers ORDER BY isApproved ASC, id ASC`, [], (err, rows) => {
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

// 3. Admin Duyệt Hồ Sơ Khởi Tạo (Cần Admin)
app.post('/api/volunteers/:id/approve', verifyAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE volunteers SET isApproved = 1 WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Đã duyệt hồ sơ Tình nguyện viên chính thức!' });
    });
});

// 4. Tra cứu thành tích cá nhân (Chỉ hiện khi đã được duyệt)
app.post('/api/volunteers/my-profile', (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) {
        return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Họ tên và MSSV!' });
    }

    db.get(
        `SELECT * FROM volunteers WHERE studentId = ? AND LOWER(fullName) = LOWER(?)`,
        [studentId.trim(), fullName.trim()],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) {
                return res.status(404).json({ error: 'Không tìm thấy thông tin TNV phù hợp!' });
            }
            if (row.isApproved === 0) {
                return res.status(403).json({ error: 'Hồ sơ của bạn đang chờ Admin duyệt. Chưa thể tra cứu thành tích!' });
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

// 5. Form 1: Điền buổi tình nguyện (CÔNG KHAI - Chỉ áp dụng cho hồ sơ đã duyệt)
app.post('/api/volunteers/activity', (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    if (!fullName || !studentId || !jobContent || !date) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    db.get(`SELECT * FROM volunteers WHERE studentId = ?`, [studentId.trim()], (err, volunteer) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!volunteer) {
            return res.status(404).json({ error: 'TNV chưa tồn tại. Vui lòng tạo khởi tạo TNV trước!' });
        }
        if (volunteer.isApproved === 0) {
            return res.status(403).json({ error: 'Hồ sơ của bạn đang chờ Admin duyệt, chưa thể ghi nhận buổi tình nguyện!' });
        }

        volunteer.activities = JSON.parse(volunteer.activities || '[]');
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

// 6. Form 2: Điền chiến dịch lớn (CÔNG KHAI)
app.post('/api/volunteers/campaign', (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    if (!fullName || !studentId || !campaignName) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    db.get(`SELECT * FROM volunteers WHERE studentId = ?`, [studentId.trim()], (err, volunteer) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!volunteer) {
            return res.status(404).json({ error: 'TNV chưa tồn tại. Vui lòng tạo khởi tạo TNV trước!' });
        }
        if (volunteer.isApproved === 0) {
            return res.status(403).json({ error: 'Hồ sơ của bạn đang chờ Admin duyệt, chưa thể ghi nhận chiến dịch!' });
        }

        volunteer.campaigns = JSON.parse(volunteer.campaigns || '[]');
        const normCamp = normalizeText(campaignName);
        const isDuplicate = volunteer.campaigns.some(camp => normalizeText(camp) === normCamp);

        if (isDuplicate) {
            return res.status(400).json({ error: 'Bạn đã được ghi nhận chiến dịch này rồi!' });
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

// 7. Form 3: Nhập thông tin bổ sung Vi phạm / Thành tích / Ghi chú (CẦN ADMIN)
app.post('/api/volunteers/additional-info', verifyAdmin, (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;

    if (!fullName || !category) return res.status(400).json({ error: 'Vui lòng điền đủ thông tin!' });

    const sqlSearch = studentId 
        ? `SELECT * FROM volunteers WHERE studentId = ?`
        : `SELECT * FROM volunteers WHERE LOWER(fullName) = LOWER(?)`;
    const params = studentId ? [studentId.trim()] : [fullName.trim()];

    db.all(sqlSearch, params, (err, rows) => {
        if (err || rows.length === 0) {
            return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });
        }

        const volunteer = rows[0];
        volunteer.violations = JSON.parse(volunteer.violations || '[]');
        volunteer.achievements = JSON.parse(volunteer.achievements || '[]');
        volunteer.generalNotes = JSON.parse(volunteer.generalNotes || '[]');

        let updateSql = '', updateParams = [];

        if (category === 'violation') {
            if (!violationError || !violationDate) {
                return res.status(400).json({ error: 'Vui lòng nhập Tên lỗi và Ngày vi phạm!' });
            }
            const updated = [...volunteer.violations, { error: violationError, date: violationDate }];
            updateSql = `UPDATE volunteers SET violations = ?, violationCount = ? WHERE id = ?`;
            updateParams = [JSON.stringify(updated), updated.length, volunteer.id];

        } else if (category === 'achievement') {
            if (!achievementContent) {
                return res.status(400).json({ error: 'Vui lòng nhập Nội dung thành tích!' });
            }
            const updated = [...volunteer.achievements, achievementContent];
            updateSql = `UPDATE volunteers SET achievements = ? WHERE id = ?`;
            updateParams = [JSON.stringify(updated), volunteer.id];

        } else if (category === 'note') {
            if (!noteContent) {
                return res.status(400).json({ error: 'Vui lòng nhập Nội dung ghi chú!' });
            }
            const updated = [...volunteer.generalNotes, noteContent];
            updateSql = `UPDATE volunteers SET generalNotes = ? WHERE id = ?`;
            updateParams = [JSON.stringify(updated), volunteer.id];
        }

        db.run(updateSql, updateParams, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Cập nhật thông tin bổ sung thành công!' });
        });
    });
});

// 8. Xóa dữ liệu (Cần Admin)
app.delete('/api/volunteers/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM volunteers WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Đã xóa hồ sơ TNV!' });
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên port: ${PORT}`);
});
