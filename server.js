const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'OPTC140921';

// --- BỘ NHỚ TẠM (RAM) ---
let memoryData = {
    volunteers: [],
    activities: [],
    campaigns: [],
    violations: [],
    achievements: [],
    general_notes: [],
    autoIncId: 1
};

// --- KHỞI TẠO TURSO CLIENT CHÍNH THỨC ---
let turso = null;
try {
    let dbUrl = (process.env.TURSO_DATABASE_URL || '').trim();
    const dbToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

    if (dbUrl && dbToken) {
        if (dbUrl.startsWith('https://')) {
            dbUrl = dbUrl.replace('https://', 'libsql://');
        }
        turso = createClient({
            url: dbUrl,
            authToken: dbToken
        });
        console.log("⚡ [TURSO] Khởi tạo SDK Turso thành công!");
    } else {
        console.error("❌ [TURSO] Thiếu TURSO_DATABASE_URL hoặc TURSO_AUTH_TOKEN!");
    }
} catch (err) {
    console.error("❌ [TURSO] Lỗi kết nối CSDL:", err.message);
}

// Hàm thực thi SQL an toàn qua SDK
async function tursoQuery(sql, args = []) {
    if (!turso) {
        console.error("⚠️ [TURSO] Bỏ qua query vì chưa kết nối được Turso!");
        return { rows: [] };
    }
    try {
        const result = await turso.execute({ sql, args });
        return { rows: result.rows || [] };
    } catch (e) {
        console.error(`❌ [TURSO ERROR] Lỗi SQL (${sql}):`, e.message);
        return { rows: [] };
    }
}

// Tạo đủ 6 bảng trên Turso nếu chưa có
async function ensureTursoTables() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS volunteers (id INTEGER PRIMARY KEY, fullName TEXT, studentId TEXT, isApproved INTEGER DEFAULT 0, createdAt TEXT)`,
        `CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, volunteerId INTEGER, jobContent TEXT, date TEXT, createdAt TEXT)`,
        `CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY, volunteerId INTEGER, campaignName TEXT, createdAt TEXT)`,
        `CREATE TABLE IF NOT EXISTS violations (id INTEGER PRIMARY KEY, volunteerId INTEGER, error TEXT, date TEXT, createdAt TEXT)`,
        `CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY, volunteerId INTEGER, content TEXT, createdAt TEXT)`,
        `CREATE TABLE IF NOT EXISTS general_notes (id INTEGER PRIMARY KEY, volunteerId INTEGER, content TEXT, createdAt TEXT)`
    ];
    for (const sql of tables) {
        await tursoQuery(sql);
    }
}
ensureTursoTables();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

function verifyAdmin(req, res, next) {
    const adminPassword = req.headers['x-admin-password'];
    if (!adminPassword || adminPassword.toString().trim().toUpperCase() !== ADMIN_PASSWORD.toUpperCase()) {
        return res.status(401).json({ error: 'Mật khẩu quản trị không chính xác!' });
    }
    next();
}

function normalizeString(str) {
    if (!str) return '';
    return str.toString().trim().toLowerCase();
}

function findVolunteerInMemory(fullName, studentId) {
    const cleanName = normalizeString(fullName);
    const cleanId = normalizeString(studentId);
    return memoryData.volunteers.find(v => {
        const matchId = cleanId && normalizeString(v.studentId) === cleanId;
        const matchName = cleanName && normalizeString(v.fullName) === cleanName;
        return (cleanId && matchId) || (matchId && matchName);
    });
}

// --- API ROUTES ---

// 1. Đăng ký TNV
app.post('/api/volunteers/register', async (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) return res.status(400).json({ error: 'Nhập đủ Họ tên và MSSV!' });

    const cleanId = studentId.trim().toLowerCase();
    const exist = memoryData.volunteers.find(v => normalizeString(v.studentId) === cleanId);
    if (exist) return res.status(400).json({ error: 'MSSV này đã tồn tại!' });

    const newId = memoryData.autoIncId++;
    const createdAt = new Date().toISOString();
    const newVol = { id: newId, fullName: fullName.trim(), studentId: studentId.trim(), isApproved: 0, createdAt };

    // 1. Lưu RAM
    memoryData.volunteers.push(newVol);

    // 2. Lưu Turso
    await ensureTursoTables();
    await tursoQuery(`INSERT INTO volunteers (id, fullName, studentId, isApproved, createdAt) VALUES (?, ?, ?, 0, ?)`, [newId, fullName.trim(), studentId.trim(), createdAt]);

    res.json({ message: 'Đăng ký khởi tạo thành công! Vui lòng chờ Admin duyệt.' });
});

// 2. Thêm buổi TN
app.post('/api/volunteers/activity', async (req, res) => {
    const { fullName, studentId, jobContent, date } = req.body;
    const vol = findVolunteerInMemory(fullName, studentId);
    if (!vol) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

    const actId = memoryData.autoIncId++;
    const createdAt = new Date().toISOString();
    const newAct = { id: actId, volunteerId: vol.id, jobContent: jobContent.trim(), date, createdAt };

    memoryData.activities.push(newAct);
    
    await ensureTursoTables();
    await tursoQuery(`INSERT INTO activities (id, volunteerId, jobContent, date, createdAt) VALUES (?, ?, ?, ?, ?)`, [actId, vol.id, jobContent.trim(), date, createdAt]);

    res.json({ message: 'Thêm buổi tình nguyện thành công!' });
});

// 3. Thêm chiến dịch
app.post('/api/volunteers/campaign', async (req, res) => {
    const { fullName, studentId, campaignName } = req.body;
    const vol = findVolunteerInMemory(fullName, studentId);
    if (!vol) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

    const cId = memoryData.autoIncId++;
    const createdAt = new Date().toISOString();
    const newCamp = { id: cId, volunteerId: vol.id, campaignName: campaignName.trim(), createdAt };

    memoryData.campaigns.push(newCamp);

    await ensureTursoTables();
    await tursoQuery(`INSERT INTO campaigns (id, volunteerId, campaignName, createdAt) VALUES (?, ?, ?, ?)`, [cId, vol.id, campaignName.trim(), createdAt]);

    res.json({ message: 'Ghi nhận chiến dịch thành công!' });
});

// 4. Thông tin bổ sung
app.post('/api/volunteers/additional-info', verifyAdmin, async (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;
    const vol = findVolunteerInMemory(fullName, studentId);
    if (!vol) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

    const itemId = memoryData.autoIncId++;
    const createdAt = new Date().toISOString();

    await ensureTursoTables();

    if (category === 'violation') {
        memoryData.violations.push({ id: itemId, volunteerId: vol.id, error: violationError.trim(), date: violationDate, createdAt });
        await tursoQuery(`INSERT INTO violations (id, volunteerId, error, date, createdAt) VALUES (?, ?, ?, ?, ?)`, [itemId, vol.id, violationError.trim(), violationDate, createdAt]);
        return res.json({ message: 'Cập nhật vi phạm thành công!' });
    } else if (category === 'achievement') {
        memoryData.achievements.push({ id: itemId, volunteerId: vol.id, content: achievementContent.trim(), createdAt });
        await tursoQuery(`INSERT INTO achievements (id, volunteerId, content, createdAt) VALUES (?, ?, ?, ?)`, [itemId, vol.id, achievementContent.trim(), createdAt]);
        return res.json({ message: 'Cập nhật thành tích thành công!' });
    } else if (category === 'note') {
        memoryData.general_notes.push({ id: itemId, volunteerId: vol.id, content: noteContent.trim(), createdAt });
        await tursoQuery(`INSERT INTO general_notes (id, volunteerId, content, createdAt) VALUES (?, ?, ?, ?)`, [itemId, vol.id, noteContent.trim(), createdAt]);
        return res.json({ message: 'Cập nhật ghi chú thành công!' });
    }
});

// 5. Tra cứu cá nhân
app.post('/api/volunteers/my-profile', async (req, res) => {
    const { fullName, studentId } = req.body;
    const vol = findVolunteerInMemory(fullName, studentId);
    if (!vol) return res.status(404).json({ error: 'Không tìm thấy dữ liệu!' });

    const acts = memoryData.activities.filter(a => a.volunteerId === vol.id);
    const camps = memoryData.campaigns.filter(c => c.volunteerId === vol.id);
    const viols = memoryData.violations.filter(v => v.volunteerId === vol.id);

    res.json({
        fullName: vol.fullName,
        studentId: vol.studentId,
        isApproved: vol.isApproved,
        activityCount: acts.length,
        activities: acts,
        campaignCount: camps.length,
        campaigns: camps,
        violationCount: viols.length,
        violations: viols
    });
});

// 6. Bảng tổng kết Admin
app.get('/api/volunteers', verifyAdmin, (req, res) => {
    const result = memoryData.volunteers.map(v => {
        const acts = memoryData.activities.filter(a => a.volunteerId === v.id);
        const camps = memoryData.campaigns.filter(c => c.volunteerId === v.id);
        const viols = memoryData.violations.filter(vl => vl.volunteerId === v.id);
        const achs = memoryData.achievements.filter(a => a.volunteerId === v.id);
        const notes = memoryData.general_notes.filter(n => n.volunteerId === v.id);

        return {
            id: v.id,
            fullName: v.fullName,
            studentId: v.studentId,
            isApproved: Number(v.isApproved || 0),
            createdAt: v.createdAt,
            activities: acts,
            campaigns: camps,
            violations: viols,
            achievements: achs,
            generalNotes: notes
        };
    }).sort((a, b) => b.id - a.id);

    res.json(result);
});

// 7. Duyệt hồ sơ
app.post('/api/volunteers/:id/approve', verifyAdmin, async (req, res) => {
    const vId = Number(req.params.id);
    const vol = memoryData.volunteers.find(v => v.id === vId);
    if (vol) vol.isApproved = 1;

    await tursoQuery(`UPDATE volunteers SET isApproved = 1 WHERE id = ?`, [vId]);
    res.json({ message: 'Đã duyệt thành công!' });
});

// 8. Xóa hồ sơ
app.delete('/api/volunteers/:id', verifyAdmin, async (req, res) => {
    const vId = Number(req.params.id);
    memoryData.volunteers = memoryData.volunteers.filter(v => v.id !== vId);
    memoryData.activities = memoryData.activities.filter(a => a.volunteerId !== vId);
    memoryData.campaigns = memoryData.campaigns.filter(c => c.volunteerId !== vId);
    memoryData.violations = memoryData.violations.filter(v => v.volunteerId !== vId);
    memoryData.achievements = memoryData.achievements.filter(a => a.volunteerId !== vId);
    memoryData.general_notes = memoryData.general_notes.filter(n => n.volunteerId !== vId);

    await tursoQuery(`DELETE FROM volunteers WHERE id = ?`, [vId]);
    await tursoQuery(`DELETE FROM activities WHERE volunteerId = ?`, [vId]);
    await tursoQuery(`DELETE FROM campaigns WHERE volunteerId = ?`, [vId]);
    await tursoQuery(`DELETE FROM violations WHERE volunteerId = ?`, [vId]);
    await tursoQuery(`DELETE FROM achievements WHERE volunteerId = ?`, [vId]);
    await tursoQuery(`DELETE FROM general_notes WHERE volunteerId = ?`, [vId]);

    res.json({ message: 'Đã xóa hồ sơ!' });
});

// 9. KHÔI PHỤC DỮ LIỆU TỪ TURSO VỀ RAM
app.post('/api/volunteers/restore-from-turso', verifyAdmin, async (req, res) => {
    try {
        await ensureTursoTables();

        const resVol = await tursoQuery(`SELECT * FROM volunteers`);
        const resAct = await tursoQuery(`SELECT * FROM activities`);
        const resCamp = await tursoQuery(`SELECT * FROM campaigns`);
        const resViol = await tursoQuery(`SELECT * FROM violations`);
        const resAch = await tursoQuery(`SELECT * FROM achievements`);
        const resNote = await tursoQuery(`SELECT * FROM general_notes`);

        const rawVols = resVol.rows || [];
        if (rawVols.length === 0) {
            return res.json({ message: 'Trên Turso hiện chưa có bản ghi nào để khôi phục!' });
        }

        memoryData.volunteers = rawVols.map(r => ({
            id: Number(r.id),
            fullName: String(r.fullName || ''),
            studentId: String(r.studentId || ''),
            isApproved: Number(r.isApproved || 0),
            createdAt: r.createdAt || new Date().toISOString()
        }));

        memoryData.activities = (resAct.rows || []).map(r => ({
            id: Number(r.id),
            volunteerId: Number(r.volunteerId),
            jobContent: String(r.jobContent || ''),
            date: String(r.date || '')
        }));

        memoryData.campaigns = (resCamp.rows || []).map(r => ({
            id: Number(r.id),
            volunteerId: Number(r.volunteerId),
            campaignName: String(r.campaignName || '')
        }));

        memoryData.violations = (resViol.rows || []).map(r => ({
            id: Number(r.id),
            volunteerId: Number(r.volunteerId),
            error: String(r.error || ''),
            date: String(r.date || '')
        }));

        memoryData.achievements = (resAch.rows || []).map(r => ({
            id: Number(r.id),
            volunteerId: Number(r.volunteerId),
            content: String(r.content || '')
        }));

        memoryData.general_notes = (resNote.rows || []).map(r => ({
            id: Number(r.id),
            volunteerId: Number(r.volunteerId),
            content: String(r.content || '')
        }));

        let maxId = 0;
        const allItems = [...memoryData.volunteers, ...memoryData.activities, ...memoryData.campaigns, ...memoryData.violations, ...memoryData.achievements, ...memoryData.general_notes];
        allItems.forEach(item => { if (item.id > maxId) maxId = item.id; });
        memoryData.autoIncId = maxId + 1;

        res.json({ message: `Khôi phục thành công ${memoryData.volunteers.length} hồ sơ từ Turso vào bộ nhớ RAM!` });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi khôi phục dữ liệu: ' + e.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
