let volunteersData = [];
let detailModal = null;

document.addEventListener('DOMContentLoaded', () => {
    detailModal = new bootstrap.Modal(document.getElementById('detailModal'));
    syncDataFromCloud();

    // Form Đăng ký TNV
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = document.getElementById('fullName').value.trim();
        const studentId = document.getElementById('studentId').value.trim();

        try {
            const res = await fetch('/api/volunteers/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullName, studentId })
            });
            const data = await res.json();
            if (res.ok) {
                document.getElementById('registerForm').reset();
                syncDataFromCloud();
            } else {
                alert(data.error || 'Có lỗi xảy ra');
            }
        } catch (err) {
            console.error(err);
            alert('Lỗi kết nối máy chủ');
        }
    });

    // Các form chi tiết con trong Modal
    document.getElementById('activityForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('currentModalTnvId').value;
        const jobContent = document.getElementById('jobContent').value;
        const date = document.getElementById('activityDate').value;
        await postSubData(id, 'activities', { jobContent, date }, 'activityForm');
    });

    document.getElementById('campaignForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('currentModalTnvId').value;
        const campaignName = document.getElementById('campaignName').value;
        await postSubData(id, 'campaigns', { campaignName }, 'campaignForm');
    });

    document.getElementById('violationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('currentModalTnvId').value;
        const error = document.getElementById('violationError').value;
        const date = document.getElementById('violationDate').value;
        await postSubData(id, 'violations', { error, date }, 'violationForm');
    });

    document.getElementById('achievementForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('currentModalTnvId').value;
        const content = document.getElementById('achievementContent').value;
        await postSubData(id, 'achievements', { content }, 'achievementForm');
    });

    document.getElementById('noteForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('currentModalTnvId').value;
        const content = document.getElementById('noteContent').value;
        await postSubData(id, 'general_notes', { content }, 'noteForm');
    });
});

// Tải toàn bộ dữ liệu từ Google Sheets qua backend
async function syncDataFromCloud() {
    try {
        const res = await fetch('/api/volunteers/restore-from-turso');
        const json = await res.json();
        if (json.success) {
            volunteersData = json.data;
            renderTable(volunteersData);
            updateStats();
        }
    } catch (err) {
        console.error("Lỗi đồng bộ dữ liệu:", err);
    }
}

function renderTable(data) {
    const tbody = document.getElementById('volunteerTableBody');
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">Chưa có dữ liệu tình nguyện viên</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(v => `
        <tr>
            <td><strong>${v.studentId}</strong></td>
            <td>${v.fullName}</td>
            <td>
                <span class="badge badge-status ${v.isApproved ? 'bg-success' : 'bg-secondary'}">
                    ${v.isApproved ? 'Đã duyệt' : 'Chưa duyệt'}
                </span>
            </td>
            <td class="text-center">
                <button class="btn btn-sm btn-outline-primary me-1" onclick="openDetail(${v.id})" title="Xem chi tiết">
                    <i class="bi bi-folder2-open"></i> Chi tiết
                </button>
                <button class="btn btn-sm ${v.isApproved ? 'btn-outline-warning' : 'btn-outline-success'} me-1" onclick="toggleApprove(${v.id}, ${!v.isApproved})">
                    <i class="bi ${v.isApproved ? 'bi-x-circle' : 'bi-check-circle'}"></i> ${v.isApproved ? 'Huỷ' : 'Duyệt'}
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteVolunteer(${v.id})" title="Xóa">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function updateStats() {
    document.getElementById('totalVolunteers').innerText = volunteersData.length;
    document.getElementById('totalApproved').innerText = volunteersData.filter(v => v.isApproved).length;
}

function filterTable() {
    const keyword = document.getElementById('searchInput').value.toLowerCase();
    const filtered = volunteersData.filter(v => 
        v.fullName.toLowerCase().includes(keyword) || v.studentId.toLowerCase().includes(keyword)
    );
    renderTable(filtered);
}

async function toggleApprove(id, isApproved) {
    try {
        await fetch(`/api/volunteers/${id}/approve`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isApproved })
        });
        syncDataFromCloud();
        // Nếu modal đang mở đúng TNV đó thì cập nhật lại modal luôn
        const currentModalId = document.getElementById('currentModalTnvId').value;
        if (currentModalId == id) openDetail(id);
    } catch (err) {
        console.error(err);
    }
}

async function deleteVolunteer(id) {
    if (!confirm('Bạn có chắc muốn xóa tình nguyện viên này và toàn bộ dữ liệu liên quan?')) return;
    try {
        await fetch(`/api/volunteers/${id}`, { method: 'DELETE' });
        syncDataFromCloud();
        detailModal.hide();
    } catch (err) {
        console.error(err);
    }
}

// Mở Modal chi tiết
function openDetail(id) {
    const v = volunteersData.find(item => item.id == id);
    if (!v) return;

    document.getElementById('currentModalTnvId').value = v.id;
    document.getElementById('modalTnvName').innerText = `${v.fullName} (${v.studentId})`;

    // Render các bảng con
    document.getElementById('activitiesList').innerHTML = v.activities.map(a => `<tr><td>${a.jobContent}</td><td>${a.date}</td></tr>`).join('') || '<tr><td colspan="2" class="text-muted">Chưa có dữ liệu</td></tr>';
    document.getElementById('campaignsList').innerHTML = v.campaigns.map(c => `<tr><td>${c.campaignName}</td></tr>`).join('') || '<tr><td class="text-muted">Chưa có dữ liệu</td></tr>';
    document.getElementById('violationsList').innerHTML = v.violations.map(vi => `<tr><td>${vi.error}</td><td>${vi.date}</td></tr>`).join('') || '<tr><td colspan="2" class="text-muted">Chưa có dữ liệu</td></tr>';
    document.getElementById('achievementsList').innerHTML = v.achievements.map(ac => `<tr><td>${ac.content}</td></tr>`).join('') || '<tr><td class="text-muted">Chưa có dữ liệu</td></tr>';
    document.getElementById('notesList').innerHTML = v.generalNotes.map(g => `<tr><td>${g.content}</td></tr>`).join('') || '<tr><td class="text-muted">Chưa có dữ liệu</td></tr>';

    detailModal.show();
}

async function postSubData(volunteerId, endpoint, payload, formId) {
    try {
        const res = await fetch(`/api/volunteers/${volunteerId}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            document.getElementById(formId).reset();
            // Lấy lại dữ liệu mới nhất từ cloud rồi update lại modal
            const refreshRes = await fetch('/api/volunteers/restore-from-turso');
            const json = await refreshRes.json();
            if (json.success) {
                volunteersData = json.data;
                renderTable(volunteersData);
                updateStats();
                openDetail(volunteerId);
            }
        }
    } catch (err) {
        console.error(err);
        alert('Không thể thêm dữ liệu');
    }
}
