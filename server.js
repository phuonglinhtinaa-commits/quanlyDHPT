const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// MẬT KHẨU QUẢN TRỊ CỐ ĐỊNH
const ADMIN_PASSWORD = 'OPTC140921';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phục vụ tĩnh giao diện
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

// Khởi tạo CSDL SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (!err) {
        console.log('Đã kết nối CSDL SQLite.');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS volunteers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullName TEXT NOT NULL,
            studentId TEXT NOT NULL UNIQUE,
            isApproved INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            jobContent TEXT NOT NULL,
            date TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            campaignName TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            error TEXT NOT NULL,
            date TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS general_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);
    });
}

// Tác vụ dọn dẹp tài khoản chưa duyệt quá 24h
setInterval(() => {
    const query = `DELETE FROM volunteers WHERE isApproved = 0 AND createdAt <= datetime('now', '-1 day')`;
    db.run(query);
}, 60 * 60 * 1000);

function findVolunteer(fullName, studentId, callback) {
    const cleanName = normalizeString(fullName);
    const cleanId = normalizeString(studentId);

    db.all(`SELECT * FROM volunteers`, [], (err, rows) => {
        if (err) return callback(err, null);
        const match = rows.find(v => {
            const matchId = cleanId && normalizeString(v.studentId) === cleanId;
            const matchName = cleanName && normalizeString(v.fullName) === cleanName;
            return matchId || matchName;
        });
        callback(null, match);
    });
}

// --- API ROUTES ---

app.post('/api/volunteers/register', (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) return res.status(400).json({ error: 'Vui lòng điền đầy đủ Họ tên và MSSV!' });

    const cleanId = normalizeString(studentId);
    db.get(`SELECT * FROM volunteers WHERE LOWER(TRIM(studentId)) = ?`, [cleanId], (err, row) => {
        if (row) return res.status(400).json({ error: 'MSSV này đã tồn tại!' });

        db.run(`INSERT INTO volunteers (fullName, studentId, isApproved) VALUES (?, ?, 0)`, 
            [fullName.trim(), studentId.trim()], 
            function(err) {
                if (err) return res.status(500).json({ error: 'Không thể đăng ký!' });
                res.json({ message: 'Đăng ký khởi tạo thành công! Vui lòng chờ Admin duyệt.' });
            }
        );
    });
});

app.post('/api/volunteers/activity', (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV!' });
        db.run(`INSERT INTO activities (volunteerId, jobContent, date) VALUES (?, ?, ?)`,
            [volunteer.id, jobContent.trim(), date],
            () => res.json({ message: 'Thêm buổi tình nguyện thành công!' })
        );
    });
});

app.post('/api/volunteers/campaign', (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV!' });
        db.run(`INSERT INTO campaigns (volunteerId, campaignName) VALUES (?, ?)`,
            [volunteer.id, campaignName.trim()],
            () => res.json({ message: 'Ghi nhận chiến dịch thành công!' })
        );
    });
});

app.post('/api/volunteers/additional-info', verifyAdmin, (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;
    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy TNV!' });

        if (category === 'violation') {
            db.run(`INSERT INTO violations (volunteerId, error, date) VALUES (?, ?, ?)`, [volunteer.id, violationError.trim(), violationDate], 
                () => res.json({ message: 'Cập nhật vi phạm thành công!' }));
        } else if (category === 'achievement') {
            db.run(`INSERT INTO achievements (volunteerId, content) VALUES (?, ?)`, [volunteer.id, achievementContent.trim()], 
                () => res.json({ message: 'Cập nhật thành tích thành công!' }));
        } else if (category === 'note') {
            db.run(`INSERT INTO general_notes (volunteerId, content) VALUES (?, ?)`, [volunteer.id, noteContent.trim()], 
                () => res.json({ message: 'Cập nhật ghi chú thành công!' }));
        }
    });
});

app.post('/api/volunteers/my-profile', (req, res) => {
    const { fullName, studentId } = req.body;
    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (!volunteer) return res.status(404).json({ error: 'Không tìm thấy dữ liệu!' });
        const vId = volunteer.id;
        db.all(`SELECT id, jobContent, date FROM activities WHERE volunteerId = ?`, [vId], (err, activities) => {
            db.all(`SELECT id, campaignName FROM campaigns WHERE volunteerId = ?`, [vId], (err, campaigns) => {
                db.all(`SELECT id, error, date FROM violations WHERE volunteerId = ?`, [vId], (err, violations) => {
                    db.all(`SELECT id, content FROM achievements WHERE volunteerId = ?`, [vId], (err, achievements) => {
                        db.all(`SELECT id, content FROM general_notes WHERE volunteerId = ?`, [vId], (err, notes) => {
                            res.json({
                                fullName: volunteer.fullName,
                                studentId: volunteer.studentId,
                                isApproved: volunteer.isApproved,
                                activityCount: activities ? activities.length : 0,
                                activities: activities || [],
                                campaignCount: campaigns ? campaigns.length : 0,
                                campaigns: (campaigns || []).map(c => c.campaignName),
                                violationCount: violations ? violations.length : 0,
                                violations: violations || [],
                                achievements: (achievements || []).map(a => a.content),
                                generalNotes: (notes || []).map(n => n.content)
                            });
                        });
                    });
                });
            });
        });
    });
});

// Bảng tổng kết lấy ID từng mục để cho phép xóa lẻ
app.get('/api/volunteers', verifyAdmin, (req, res) => {
    const query = `SELECT * FROM volunteers ORDER BY id DESC`;

    db.all(query, [], async (err, volunteers) => {
        if (err) return res.status(500).json({ error: 'Lỗi lấy dữ liệu!' });

        const result = await Promise.all(volunteers.map(v => {
            return new Promise((resolve) => {
                db.all(`SELECT id, jobContent, date FROM activities WHERE volunteerId = ?`, [v.id], (e, activities) => {
                    db.all(`SELECT id, campaignName FROM campaigns WHERE volunteerId = ?`, [v.id], (e, campaigns) => {
                        db.all(`SELECT id, error, date FROM violations WHERE volunteerId = ?`, [v.id], (e, violations) => {
                            db.all(`SELECT id, content FROM achievements WHERE volunteerId = ?`, [v.id], (e, achievements) => {
                                db.all(`SELECT id, content FROM general_notes WHERE volunteerId = ?`, [v.id], (e, notes) => {
                                    resolve({
                                        ...v,
                                        activities: activities || [],
                                        activityCount: activities ? activities.length : 0,
                                        campaigns: campaigns || [],
                                        campaignCount: campaigns ? campaigns.length : 0,
                                        violations: violations || [],
                                        violationCount: violations ? violations.length : 0,
                                        achievements: achievements || [],
                                        generalNotes: notes || []
                                    });
                                });
                            });
                        });
                    });
                });
            });
        }));

        res.json(result);
    });
});

app.post('/api/volunteers/:id/approve', verifyAdmin, (req, res) => {
    db.run(`UPDATE volunteers SET isApproved = 1 WHERE id = ?`, [req.params.id], () => res.json({ message: 'Đã duyệt!' }));
});

// Xóa toàn bộ hồ sơ TNV
app.delete('/api/volunteers/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM volunteers WHERE id = ?`, [req.params.id], () => res.json({ message: 'Đã xóa hồ sơ!' }));
});

// --- BỔ SUNG CÁC API XÓA LẺ TỪNG MỤC ---
app.delete('/api/items/activity/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM activities WHERE id = ?`, [req.params.id], () => res.json({ message: 'Đã xóa buổi tình nguyện!' }));
});

app.delete('/api/items/violation/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM violations WHERE id = ?`, [req.params.id], () => res.json({ message: 'Đã xóa lỗi vi phạm!' }));
});

app.delete('/api/items/campaign/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM campaigns WHERE id = ?`, [req.params.id], () => res.json({ message: 'Đã xóa chiến dịch!' }));
});

app.delete('/api/items/achievement/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM achievements WHERE id = ?`, [req.params.id], () => res.json({ message: 'Đã xóa thành tích!' }));
});

app.delete('/api/items/note/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM general_notes WHERE id = ?`, [req.params.id], () => res.json({ message: 'Đã xóa ghi chú!' }));
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
