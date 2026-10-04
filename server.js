const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hàm gọi Google Apps Script Web App
async function callScript(payload) {
    if (!SCRIPT_URL) throw new Error("Chưa cấu hình GOOGLE_SCRIPT_URL");
    const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return await res.json();
}

// --- KHÔI PHỤC TOÀN BỘ DỮ LIỆU TỪ GOOGLE SHEETS ---
app.get('/api/volunteers/restore-from-turso', async (req, res) => {
    try {
        if (!SCRIPT_URL) return res.status(500).json({ error: "Thiếu GOOGLE_SCRIPT_URL" });
        const response = await fetch(`${SCRIPT_URL}?action=restore`);
        const result = await response.json();
        
        if (!result.success) throw new Error("Không thể lấy dữ liệu từ Google Sheets");

        const db = result.data;
        const volunteersMap = {};

        db.volunteers.forEach(v => {
            volunteersMap[v.id] = {
                id: Number(v.id),
                fullName: v.fullName,
                studentId: String(v.studentId),
                isApproved: Boolean(Number(v.isApproved)),
                createdAt: v.createdAt,
                activities: [],
                campaigns: [],
                violations: [],
                achievements: [],
                generalNotes: []
            };
        });

        db.activities.forEach(a => {
            const vId = Number(a.volunteerId);
            if (volunteersMap[vId]) {
                volunteersMap[vId].activities.push({
                    id: Number(a.id),
                    jobContent: a.jobContent,
                    date: a.date
                });
            }
        });

        db.campaigns.forEach(c => {
            const vId = Number(c.volunteerId);
            if (volunteersMap[vId]) {
                volunteersMap[vId].campaigns.push({
                    id: Number(c.id),
                    campaignName: c.campaignName
                });
            }
        });

        db.violations.forEach(vi => {
            const vId = Number(vi.volunteerId);
            if (volunteersMap[vId]) {
                volunteersMap[vId].violations.push({
                    id: Number(vi.id),
                    error: vi.error,
                    date: vi.date
                });
            }
        });

        db.achievements.forEach(ac => {
            const vId = Number(ac.volunteerId);
            if (volunteersMap[vId]) {
                volunteersMap[vId].achievements.push({
                    id: Number(ac.id),
                    content: ac.content
                });
            }
        });

        db.general_notes.forEach(g => {
            const vId = Number(g.volunteerId);
            if (volunteersMap[vId]) {
                volunteersMap[vId].generalNotes.push({
                    id: Number(g.id),
                    content: g.content
                });
            }
        });

        res.json({ success: true, data: Object.values(volunteersMap) });
    } catch (err) {
        console.error("Lỗi restore Google Sheets:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- LẤY DANH SÁCH TÌNH NGUYỆN VIÊN ---
app.get('/api/volunteers', async (req, res) => {
    try {
        if (!SCRIPT_URL) return res.json([]);
        const response = await fetch(`${SCRIPT_URL}?action=restore`);
        const result = await response.json();
        if (!result.success) return res.json([]);

        const volunteers = result.data.volunteers.map(v => ({
            id: Number(v.id),
            fullName: v.fullName,
            studentId: String(v.studentId),
            isApproved: Boolean(Number(v.isApproved)),
            createdAt: v.createdAt
        })).sort((a, b) => b.id - a.id);

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
    try {
        const result = await callScript({ action: 'register', fullName, studentId });
        res.json({ id: result.id, fullName, studentId, isApproved: false, createdAt: result.createdAt });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PHÊ DUYỆT / HUỶ DUYỆT ---
app.put('/api/volunteers/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { isApproved } = req.body;
    try {
        await callScript({ action: 'approve', id: Number(id), isApproved });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- XÓA TÌNH NGUYỆN VIÊN ---
app.delete('/api/volunteers/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await callScript({ action: 'delete', id: Number(id) });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- THÊM DỮ LIỆU CON (HOẠT ĐỘNG, CHIẾN DỊCH, VI PHẠM, THÀNH TÍCH, GHI CHÚ) ---
app.post('/api/volunteers/:id/activities', async (req, res) => {
    const { id } = req.params;
    const { jobContent, date } = req.body;
    try {
        const r = await callScript({ action: 'activities', volunteerId: Number(id), jobContent, date });
        res.json({ id: r.id, volunteerId: Number(id), jobContent, date });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/campaigns', async (req, res) => {
    const { id } = req.params;
    const { campaignName } = req.body;
    try {
        const r = await callScript({ action: 'campaigns', volunteerId: Number(id), campaignName });
        res.json({ id: r.id, volunteerId: Number(id), campaignName });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/violations', async (req, res) => {
    const { id } = req.params;
    const { error, date } = req.body;
    try {
        const r = await callScript({ action: 'violations', volunteerId: Number(id), error, date });
        res.json({ id: r.id, volunteerId: Number(id), error, date });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/achievements', async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    try {
        const r = await callScript({ action: 'achievements', volunteerId: Number(id), content });
        res.json({ id: r.id, volunteerId: Number(id), content });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volunteers/:id/general_notes', async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    try {
        const r = await callScript({ action: 'general_notes', volunteerId: Number(id), content });
        res.json({ id: r.id, volunteerId: Number(id), content });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- FALLBACK CLIENT ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
