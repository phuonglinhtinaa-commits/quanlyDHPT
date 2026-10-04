const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'OPTC140921';

// --- BỘ NHỚ TẠM (IN-MEMORY DATABASE) ---
let memoryData = {
    volunteers: [],
    activities: [],
    campaigns: [],
    violations: [],
    achievements: [],
    general_notes: [],
    autoIncId: 1
};

// Cấu hình Turso
let rawUrl = (process.env.TURSO_DATABASE_URL || '').trim();
if (rawUrl.startsWith('libsql://')) {
    rawUrl = rawUrl.replace('libsql://', 'https://');
}
const TURSO_URL = rawUrl;
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();

function parseTursoCell(cell) {
    if (cell === null || cell === undefined) return null;
    if (typeof cell === 'object') {
        if (cell.type === 'null') return null;
        if (cell.value !== undefined) return cell.value;
    }
    return cell;
}

async function tursoQuery(sql, args = []) {
    if (!TURSO_URL || !TURSO_TOKEN) return { rows: [] };
    const formattedArgs = args.map(val => {
        if (val === null || val === undefined) return { type: 'null' };
        if (typeof val === 'number') return { type: 'integer', value: val.toString() };
        return { type: 'text', value: val.toString() };
    });

    try {
        const response = await fetch(`${TURSO_URL}/v2/pipeline`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TURSO_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requests: [
                    { type: 'execute', stmt: { sql, args: formattedArgs } },
                    { type: 'close' }
                ]
            })
        });

        const data = await response.json();
        if (!response.ok || data.batched_results?.[0]?.type === 'error') {
            return { rows: [] };
        }

        const result = data.batched_results?.[0]?.response?.result;
        if (!result || !result.cols || !result.rows) return { rows: [] };

        const cols = result.cols.map(c => c.name);
        return {
            rows: result.rows.map(row => {
                let obj = {};
                row.forEach((cell, idx) => { obj[cols[idx]] = parseTursoCell(cell); });
                return obj;
            })
        };
    } catch (e) {
        return { rows: [] };
    }
}

async function initTursoTables() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS volunteers (id INTEGER PRIMARY KEY, fullName TEXT, studentId TEXT, isApproved INTEGER, createdAt TEXT)`,
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
initTursoTables();

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
        return matchId || matchName;
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

    // Lưu vào RAM
    memoryData.volunteers.push(newVol);

    // Backup ngầm vào Turso
    tursoQuery(`INSERT INTO volunteers (id, fullName, studentId, isApproved, createdAt) VALUES (?, ?, ?, 0, ?)`, [newId, fullName.trim(), studentId.trim(), createdAt]);

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
    tursoQuery(`INSERT INTO activities (id, volunteerId, jobContent, date, createdAt) VALUES (?, ?, ?, ?, ?)`, [actId, vol.id, jobContent.trim(), date, createdAt]);

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
    tursoQuery(`INSERT INTO campaigns (id, volunteerId, campaignName, createdAt) VALUES (?, ?, ?, ?)`, [cId, vol.id, campaignName.trim(), createdAt]);

    res.json({ message: 'Ghi nhận chiến dịch thành công!' });
});

// 4. Thêm thông tin bổ sung (Vi phạm, thành tích, ghi chú)
app.post('/api/volunteers/additional-info', verifyAdmin, async (req, res) => {
    const { fullName, studentId, category, violationError, violationDate, achievementContent, noteContent } = req.body;
    const vol = findVolunteerInMemory(fullName, studentId);
    if (!vol) return res.status(404).json({ error: 'Không tìm thấy TNV trong hệ thống!' });

    const itemId = memoryData.autoIncId++;
    const createdAt = new Date().toISOString();

    if (category === 'violation') {
        memoryData.violations.push({ id: itemId, volunteerId: vol.id, error: violationError.trim(), date: violationDate, createdAt });
        tursoQuery(`INSERT INTO violations (id, volunteerId, error, date, createdAt) VALUES (?, ?, ?, ?, ?)`, [itemId, vol.id, violationError.trim(), violationDate, createdAt]);
        return res.json({ message: 'Cập nhật vi phạm thành công!' });
    } else if (category === 'achievement') {
        memoryData.achievements.push({ id: itemId, volunteerId: vol.id, content: achievementContent.trim(), createdAt });
        tursoQuery(`INSERT INTO achievements (id, volunteerId, content, createdAt) VALUES (?, ?, ?, ?)`, [itemId, vol.id, achievementContent.trim(), createdAt]);
        return res.json({ message: 'Cập nhật thành tích thành công!' });
    } else if (category === 'note') {
        memoryData.general_notes.push({ id: itemId, volunteerId: vol.id, content: noteContent.trim(), createdAt });
        tursoQuery(`INSERT INTO general_notes (id, volunteerId, content, createdAt) VALUES (?, ?, ?, ?)`, [itemId, vol.id, noteContent.trim(), createdAt]);
        return res.json({ message: 'Cập nhật ghi chú thành công!' });
    }
});

// 5. Tra cứu cá nhân (Lấy từ RAM)
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

// 6. Đọc toàn bộ danh sách Admin (Lấy trực tiếp từ RAM cực nhanh)
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

// 7. Duyệt hồ sơ (Cập nhật RAM + Turso)
app.post('/api/volunteers/:id/approve', verifyAdmin, (req, res) => {
    const vId = Number(req.params.id);
    const vol = memoryData.volunteers.find(v => v.id === vId);
    if (vol) vol.isApproved = 1;

    tursoQuery(`UPDATE volunteers SET isApproved = 1 WHERE id = ?`, [vId]);
    res.json({ message: 'Đã duyệt thành công!' });
});

// 8. Xóa hồ sơ (Cập nhật RAM + Turso)
app.delete('/api/volunteers/:id', verifyAdmin, (req, res) => {
    const vId = Number(req.params.id);
    memoryData.volunteers = memoryData.volunteers.filter(v => v.id !== vId);
    memoryData.activities = memoryData.activities.filter(a => a.volunteerId !== vId);
    memoryData.campaigns = memoryData.campaigns.filter(c => c.volunteerId !== vId);
    memoryData.violations = memoryData.violations.filter(v => v.volunteerId !== vId);
    memoryData.achievements = memoryData.achievements.filter(a => a.volunteerId !== vId);
    memoryData.general_notes = memoryData.general_notes.filter(n => n.volunteerId !== vId);

    tursoQuery(`DELETE FROM volunteers WHERE id = ?`, [vId]);
    tursoQuery(`DELETE FROM activities WHERE volunteerId = ?`, [vId]);
    tursoQuery(`DELETE FROM campaigns WHERE volunteerId = ?`, [vId]);
    tursoQuery(`DELETE FROM violations WHERE volunteerId = ?`, [vId]);
    tursoQuery(`DELETE FROM achievements WHERE volunteerId = ?`, [vId]);
    tursoQuery(`DELETE FROM general_notes WHERE volunteerId = ?`, [vId]);

    res.json({ message: 'Đã xóa hồ sơ!' });
});

// 9. NÚT KHÔI PHỤC: Kéo dữ liệu Turso nạp đè vào Bộ Nhớ Tạm
app.post('/api/volunteers/restore-from-turso', verifyAdmin, async (req, res) => {
    try {
        const resVol = await tursoQuery(`SELECT * FROM volunteers`);
        const resAct = await tursoQuery(`SELECT * FROM activities`);
        const resCamp = await tursoQuery(`SELECT * FROM campaigns`);
        const resViol = await tursoQuery(`SELECT * FROM violations`);
        const resAch = await tursoQuery(`SELECT * FROM achievements`);
        const resNote = await tursoQuery(`SELECT * FROM general_notes`);

        memoryData.volunteers = resVol.rows.map(r => ({ ...r, id: Number(r.id), isApproved: Number(r.isApproved || 0) }));
        memoryData.activities = resAct.rows.map(r => ({ ...r, id: Number(r.id), volunteerId: Number(r.volunteerId) }));
        memoryData.campaigns = resCamp.rows.map(r => ({ ...r, id: Number(r.id), volunteerId: Number(r.volunteerId) }));
        memoryData.violations = resViol.rows.map(r => ({ ...r, id: Number(r.id), volunteerId: Number(r.volunteerId) }));
        memoryData.achievements = resAch.rows.map(r => ({ ...r, id: Number(r.id), volunteerId: Number(r.volunteerId) }));
        memoryData.general_notes = resNote.rows.map(r => ({ ...r, id: Number(r.id), volunteerId: Number(r.volunteerId) }));

        let maxId = 0;
        const allRows = [...memoryData.volunteers, ...memoryData.activities, ...memoryData.campaigns, ...memoryData.violations, ...memoryData.achievements, ...memoryData.general_notes];
        allRows.forEach(r => { if (r.id > maxId) maxId = r.id; });
        memoryData.autoIncId = maxId + 1;

        res.json({ message: `Đã khôi phục thành công ${memoryData.volunteers.length} hồ sơ từ Turso vào bộ nhớ tạm!` });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi khôi phục dữ liệu từ Turso: ' + e.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
