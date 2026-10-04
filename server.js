const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- KHỞI TẠO TURSO CLIENT ---
let turso = null;
try {
    let dbUrl = (process.env.TURSO_DATABASE_URL || '').trim();
    const dbToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

    if (dbUrl.startsWith('libsql://')) {
        dbUrl = dbUrl.replace('libsql://', 'https://');
    } else if (dbUrl.startsWith('wss://')) {
        dbUrl = dbUrl.replace('wss://', 'https://');
    } else if (!dbUrl.startsWith('http://') && !dbUrl.startsWith('https://')) {
        dbUrl = 'https://' + dbUrl;
    }

    if (dbUrl && dbToken) {
        turso = createClient({
            url: dbUrl,
            authToken: dbToken
        });
        console.log("⚡ [TURSO] Khởi tạo SDK Turso thành công với URL:", dbUrl);
    } else {
        console.error("❌ [TURSO] Thiếu TURSO_DATABASE_URL hoặc TURSO_AUTH_TOKEN!");
    }
} catch (err) {
    console.error("❌ [TURSO] Lỗi kết nối CSDL:", err.message);
}

// --- TỰ ĐỘNG TẠO BẢNG AN TOÀN ---
async function initTables() {
    if (!turso) return;

    const queries = [
        `CREATE TABLE IF NOT EXISTS volunteers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            fullName TEXT, 
            studentId TEXT, 
            isApproved INTEGER DEFAULT 0, 
            createdAt TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            volunteerId INTEGER, 
            jobContent TEXT, 
            date TEXT, 
            createdAt TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            volunteerId INTEGER, 
            campaignName TEXT, 
            createdAt TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            volunteerId INTEGER, 
            error TEXT, 
            date TEXT, 
            createdAt TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            volunteerId INTEGER, 
            content TEXT, 
            createdAt TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS general_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            volunteerId INTEGER, 
            content TEXT, 
            createdAt TEXT
        )`
    ];

    for (const sql of queries) {
        try {
            await turso.execute(sql);
        } catch (err) {
            console.error("❌ [TURSO LỖI CREATETABLE]:", err.message);
        }
    }
    console.log("✅ [TURSO] Kiểm tra và khởi tạo các bảng CSDL hoàn tất!");
}
initTables();

// --- KHÔI PHỤC DỮ LIỆU TỪ TURSO (RESTORE) ---
app.get('/api/volunteers/restore-from-turso', async (req, res) => {
    if (!turso) return res.status(500).json({ error: "Chưa kết nối Turso" });
    try {
        const vRes = await turso.execute("SELECT * FROM volunteers");
        const aRes = await turso.execute("SELECT * FROM activities");
        const cRes = await turso.execute("SELECT * FROM campaigns");
        const viRes = await turso.execute("SELECT * FROM violations");
        const acRes = await turso.execute("SELECT * FROM achievements");
        const gRes = await turso.execute("SELECT * FROM general_notes");

        const volunteersMap = {};

        vRes.rows.forEach(v => {
            volunteersMap[v.id] = {
                id: v.id,
                fullName: v.fullName,
                studentId: v.studentId,
                isApproved: Boolean(v.isApproved),
                createdAt: v.createdAt,
                activities: [],
                campaigns: [],
                violations: [],
                achievements: [],
                generalNotes: []
            };
        });

        aRes.rows.forEach(a => {
            if (volunteersMap[a.volunteerId]) volunteersMap[a.volunteerId].activities.push(a);
        });
        cRes.rows.forEach(c => {
            if (volunteersMap[c.volunteerId]) volunteersMap[c.volunteerId].campaigns.push(c);
        });
        viRes.rows.forEach(vi => {
            if (volunteersMap[vi.volunteerId]) volunteersMap[vi.volunteerId].violations.push(vi);
        });
        acRes.rows.forEach(ac => {
            if (volunteersMap[ac.volunteerId]) volunteersMap[ac.volunteerId].achievements.push(ac);
        });
        gRes.rows.forEach(g => {
            if (volunteersMap[g.volunteerId]) volunteersMap[g.volunteerId].generalNotes.push(g);
        });

        res.json({ success: true, data: Object.values(volunteersMap) });
    } catch (err) {
        console.error("Lỗi restore từ Turso:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- LẤY DANH SÁCH TÌNH NGUYỆN VIÊN ---
app.get('/api/volunteers', async (req, res) => {
    if (!turso) return res.json([]);
    try {
        const result = await turso.execute("SELECT * FROM volunteers ORDER BY id DESC");
        const volunteers = result.rows.map(v => ({
            id: v.id,
            fullName: v.fullName,
            studentId: v.studentId,
            isApproved: Boolean(v.isApproved),
            createdAt: v.createdAt
        }));
        res.json(volunteers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ĐĂNG KÝ TÌNH NGUYỆN VIÊN MỚI ---
app.post('/api/volunteers/register', async (req, res) => {
    const { fullName, studentId } = req.body;
    if (!fullName || !studentId) {
        return res.status(400).json({ error: "Thiếu Họ tên hoặc MSSV" });
    }
    const createdAt = new Date().toISOString();
    try {
        if (turso) {
            const result = await turso.execute({
                sql: "INSERT INTO volunteers (fullName, studentId, isApproved, createdAt) VALUES (?, ?, 0, ?)",
                args: [fullName, studentId, createdAt]
            });
            const newId = Number(result.lastInsertRowid);
            return res.json({ id: newId, fullName, studentId, isApproved: false, createdAt });
        }
        res.status(500).json({ error: "Lỗi CSDL Turso" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PHÊ DUYỆT / HUỶ DUYỆT ---
app.put('/api/volunteers/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { isApproved } = req.body;
    try {
        if (turso) {
            await turso.execute({
                sql: "UPDATE volunteers SET isApproved = ? WHERE id = ?",
                args: [isApproved ? 1 : 0, id]
            });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- XÓA TÌNH NGUYỆN VIÊN ---
app.delete('/api/volunteers/:id', async (req, res) => {
    const { id } = req.params;
    try {
        if (turso) {
            await turso.execute({ sql: "DELETE FROM volunteers WHERE id = ?", args: [id] });
            await turso.execute({ sql: "DELETE FROM activities WHERE volunteerId = ?", args: [id] });
            await turso.execute({ sql: "DELETE FROM campaigns WHERE volunteerId = ?", args: [id] });
            await turso.execute({ sql: "DELETE FROM violations WHERE volunteerId = ?", args: [id] });
            await turso.execute({ sql: "DELETE FROM achievements WHERE volunteerId = ?", args: [id] });
            await turso.execute({ sql: "DELETE FROM general_notes WHERE volunteerId = ?", args: [id] });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- THÊM DỮ LIỆU CON (HOẠT ĐỘNG, VI PHẠM, ...) ---
app.post('/api/volunteers/:id/activities', async (req, res) => {
    const { id } = req.params;
    const { jobContent, date } = req.body;
    try {
        if (turso) {
            const result = await turso.execute({
                sql: "INSERT INTO activities (volunteerId, jobContent, date, createdAt) VALUES (?, ?, ?, ?)",
                args: [id, jobContent, date, new Date().toISOString()]
            });
            return res.json({ id: Number(result.lastInsertRowid), volunteerId: Number(id), jobContent, date });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/campaigns', async (req, res) => {
    const { id } = req.params;
    const { campaignName } = req.body;
    try {
        if (turso) {
            const result = await turso.execute({
                sql: "INSERT INTO campaigns (volunteerId, campaignName, createdAt) VALUES (?, ?, ?)",
                args: [id, campaignName, new Date().toISOString()]
            });
            return res.json({ id: Number(result.lastInsertRowid), volunteerId: Number(id), campaignName });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/violations', async (req, res) => {
    const { id } = req.params;
    const { error, date } = req.body;
    try {
        if (turso) {
            const result = await turso.execute({
                sql: "INSERT INTO violations (volunteerId, error, date, createdAt) VALUES (?, ?, ?, ?)",
                args: [id, error, date, new Date().toISOString()]
            });
            return res.json({ id: Number(result.lastInsertRowid), volunteerId: Number(id), error, date });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/achievements', async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    try {
        if (turso) {
            const result = await turso.execute({
                sql: "INSERT INTO achievements (volunteerId, content, createdAt) VALUES (?, ?, ?)",
                args: [id, content, new Date().toISOString()]
            });
            return res.json({ id: Number(result.lastInsertRowid), volunteerId: Number(id), content });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/general_notes', async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    try {
        if (turso) {
            const result = await turso.execute({
                sql: "INSERT INTO general_notes (volunteerId, content, createdAt) VALUES (?, ?, ?)",
                args: [id, content, new Date().toISOString()]
            });
            return res.json({ id: Number(result.lastInsertRowid), volunteerId: Number(id), content });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- FALLBACK CLIENT ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
