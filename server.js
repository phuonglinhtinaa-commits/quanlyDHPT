const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// MẬT KHẨU QUẢN TRỊ CỐ ĐỊNH (Không phân biệt chữ hoa/thường hay khoảng trắng)
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

// Chuẩn hóa chuỗi tìm kiếm / so sánh
function normalizeString(str) {
    if (!str) return '';
    return str.toString().trim().toLowerCase();
}

// Khởi tạo Cơ sở dữ liệu SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Lỗi kết nối CSDL:', err.message);
    } else {
        console.log('Đã kết nối thành công với CSDL SQLite.');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        // Bảng Tình nguyện viên chính
        db.run(`CREATE TABLE IF NOT EXISTS volunteers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullName TEXT NOT NULL,
            studentId TEXT NOT NULL UNIQUE,
            isApproved INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Bảng Buổi tình nguyện (Form 1)
        db.run(`CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            jobContent TEXT NOT NULL,
            date TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        // Bảng Chiến dịch lớn (Form 2)
        db.run(`CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            campaignName TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        // Bảng Vi phạm (Form 3)
        db.run(`CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            error TEXT NOT NULL,
            date TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        // Bảng Thành tích (Form 3)
        db.run(`CREATE TABLE IF NOT EXISTS achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);

        // Bảng Ghi chú (Form 3)
        db.run(`CREATE TABLE IF NOT EXISTS general_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            volunteerId INTEGER NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (volunteerId) REFERENCES volunteers (id) ON DELETE CASCADE
        )`);
    });
}

// Tác vụ dọn dẹp định kỳ: Tự động xóa tài khoản chưa duyệt quá 24h
setInterval(() => {
    const query = `DELETE FROM volunteers WHERE isApproved = 0 AND createdAt <= datetime('now', '-1 day')`;
    db.run(query, function(err) {
        if (!err && this.changes > 0) {
            console.log(`[TỰ ĐỘNG DỌN DẸP] Đã xóa ${this.changes} tài khoản chưa duyệt quá 24 giờ.`);
        }
    });
}, 60 * 60 * 1000); // 1 giờ kiểm tra 1 lần

// Helper: Tìm TNV theo Tên hoặc MSSV
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

// Form 0: Đăng ký khởi tạo TNV mới
app.post('/api/volunteers/register', (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ Họ tên và MSSV!' });
    }

    const cleanId = normalizeString(studentId);
    db.get(`SELECT * FROM volunteers WHERE LOWER(TRIM(studentId)) = ?`, [cleanId], (err, row) => {
        if (err) return res.status(500).json({ error: 'Lỗi CSDL!' });
        if (row) {
            return res.status(400).json({ error: 'MSSV này đã tồn tại trong hệ thống!' });
        }

        db.run(`INSERT INTO volunteers (fullName, studentId, isApproved) VALUES (?, ?, 0)`, 
            [fullName.trim(), studentId.trim()], 
            function(err) {
                if (err) return res.status(500).json({ error: 'Không thể đăng ký!' });
                res.json({ message: 'Đăng ký khởi tạo thành công! Vui lòng chờ Admin duyệt trong vòng 24h.' });
            }
        );
    });
});

// Form 1: Ghi nhận buổi TN
app.post('/api/volunteers/activity', (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    if (!fullName || !studentId || !jobContent || !date) {
        return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin!' });
    }

    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (err || !volunteer) {
            return res.status(404).json({ error: 'Không tìm thấy TNV. Vui lòng kiểm tra lại Họ tên/MSSV hoặc đăng ký khởi tạo!' });
        }

        db.run(`INSERT INTO activities (volunteerId, jobContent, date) VALUES (?, ?, ?)`,
            [volunteer.id, jobContent.trim(), date],
            function(err) {
                if (err) return res.status(500).json({ error: 'Lỗi ghi nhận buổi tình nguyện!' });
                res.json({ message: 'Thêm buổi tình nguyện thành công!' });
            }
        );
    });
});

// Form 2: Ghi nhận Chiến dịch lớn
app.post('/api/volunteers/campaign', (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    if (!fullName || !studentId || !campaignName) {
        return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin!' });
    }

    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (err || !volunteer) {
            return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });
        }

        db.run(`INSERT INTO campaigns (volunteerId, campaignName) VALUES (?, ?)`,
            [volunteer.id, campaignName.trim()],
            function(err) {
                if (err) return res.status(500).json({ error: 'Lỗi ghi nhận chiến dịch!' });
                res.json({ message: 'Ghi nhận chiến dịch lớn thành công!' });
            }
        );
    });
});

// Form 3: Cập nhật thông tin bổ sung (Cần Admin)
app.post('/api/volunteers/additional-info', verifyAdmin, (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;
    
    if (!fullName) {
        return res.status(400).json({ error: 'Vui lòng nhập tên Tình nguyện viên!' });
    }

    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (err || !volunteer) {
            return res.status(404).json({ error: 'Không tìm thấy Tình nguyện viên!' });
        }

        if (category === 'violation') {
            if (!violationError || !violationDate) return res.status(400).json({ error: 'Vui lòng nhập đủ thông tin lỗi vi phạm!' });
            db.run(`INSERT INTO violations (volunteerId, error, date) VALUES (?, ?, ?)`, [volunteer.id, violationError.trim(), violationDate], (err) => {
                if (err) return res.status(500).json({ error: 'Lỗi lưu vi phạm!' });
                res.json({ message: 'Cập nhật lỗi vi phạm thành công!' });
            });
        } else if (category === 'achievement') {
            if (!achievementContent) return res.status(400).json({ error: 'Vui lòng nhập nội dung thành tích!' });
            db.run(`INSERT INTO achievements (volunteerId, content) VALUES (?, ?)`, [volunteer.id, achievementContent.trim()], (err) => {
                if (err) return res.status(500).json({ error: 'Lỗi lưu thành tích!' });
                res.json({ message: 'Cập nhật thành tích thành công!' });
            });
        } else if (category === 'note') {
            if (!noteContent) return res.status(400).json({ error: 'Vui lòng nhập nội dung ghi chú!' });
            db.run(`INSERT INTO general_notes (volunteerId, content) VALUES (?, ?)`, [volunteer.id, noteContent.trim()], (err) => {
                if (err) return res.status(500).json({ error: 'Lỗi lưu ghi chú!' });
                res.json({ message: 'Cập nhật ghi chú thành công!' });
            });
        } else {
            res.status(400).json({ error: 'Loại ghi nhận không hợp lệ!' });
        }
    });
});

// Form 4: Tra cứu thông tin cá nhân
app.post('/api/volunteers/my-profile', (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) {
        return res.status(400).json({ error: 'Vui lòng nhập Họ tên và MSSV!' });
    }

    findVolunteer(fullName, studentId, (err, volunteer) => {
        if (err || !volunteer) {
            return res.status(404).json({ error: 'Không tìm thấy dữ liệu cá nhân!' });
        }

        const vId = volunteer.id;
        db.all(`SELECT jobContent, date FROM activities WHERE volunteerId = ?`, [vId], (err, activities) => {
            db.all(`SELECT campaignName FROM campaigns WHERE volunteerId = ?`, [vId], (err, campaigns) => {
                db.all(`SELECT error, date FROM violations WHERE volunteerId = ?`, [vId], (err, violations) => {
                    db.all(`SELECT content FROM achievements WHERE volunteerId = ?`, [vId], (err, achievements) => {
                        db.all(`SELECT content FROM general_notes WHERE volunteerId = ?`, [vId], (err, notes) => {
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

// Form 5: Bảng tổng kết đầy đủ (Cần Admin)
app.get('/api/volunteers', verifyAdmin, (req, res) => {
    const query = `
        SELECT 
            v.id, v.fullName, v.studentId, v.isApproved, v.createdAt,
            (SELECT COUNT(*) FROM activities WHERE volunteerId = v.id) as activityCount,
            (SELECT COUNT(*) FROM campaigns WHERE volunteerId = v.id) as campaignCount,
            (SELECT COUNT(*) FROM violations WHERE volunteerId = v.id) as violationCount,
            (SELECT GROUP_CONCAT(content, '||') FROM achievements WHERE volunteerId = v.id) as achievementsStr,
            (SELECT GROUP_CONCAT(content, '||') FROM general_notes WHERE volunteerId = v.id) as notesStr
        FROM volunteers v
        ORDER BY v.id DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Lỗi lấy dữ liệu bảng tổng kết!' });
        
        const formatted = rows.map(r => ({
            ...r,
            achievements: r.achievementsStr ? r.achievementsStr.split('||') : [],
            generalNotes: r.notesStr ? r.notesStr.split('||') : []
        }));

        res.json(formatted);
    });
});

// Admin Duyệt TNV
app.post('/api/volunteers/:id/approve', verifyAdmin, (req, res) => {
    db.run(`UPDATE volunteers SET isApproved = 1 WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Không thể duyệt!' });
        res.json({ message: 'Đã duyệt Tình nguyện viên thành công!' });
    });
});

// Admin Xóa TNV
app.delete('/api/volunteers/:id', verifyAdmin, (req, res) => {
    db.run(`DELETE FROM volunteers WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Không thể xóa!' });
        res.json({ message: 'Đã xóa Tình nguyện viên khỏi hệ thống!' });
    });
});

// Chạy Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
