const API_URL = '/api/volunteers';
let volunteersData = [];

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const formTab = urlParams.get('form');
    if (formTab && ['1', '2', '3'].includes(formTab)) {
        switchTab(`form${formTab}`);
    } else {
        loadVolunteers();
    }
});

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('bg-blue-600', 'text-white');
        el.classList.add('bg-white', 'text-gray-700');
    });

    const targetSec = document.getElementById(`sec-${tabName}`);
    if (targetSec) targetSec.classList.remove('hidden');

    const activeBtn = document.getElementById(`btn-${tabName}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-700');
        activeBtn.classList.add('bg-blue-600', 'text-white');
    }

    if (tabName === 'dashboard') {
        loadVolunteers();
    }
}

function showToast(message, isSuccess = true) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `p-4 mb-4 rounded-lg font-medium text-white shadow-md block ${
        isSuccess ? 'bg-emerald-600' : 'bg-red-600'
    }`;
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

function copyShareLink(formNum) {
    const link = `${window.location.origin}/?form=${formNum}`;
    navigator.clipboard.writeText(link).then(() => {
        showToast(`Đã sao chép Link Form ${formNum}! Bạn có thể gửi link này.`);
    });
}

// Yêu cầu nhập mật khẩu Quản trị
function promptAdminPassword() {
    const pass = prompt("🔐 Nhập Mật Khẩu Quản Trị (Admin):");
    if (!pass) return null;
    return pass;
}

// Thêm TNV mới (Cần Mật Khẩu Admin)
async function handleCreateTNV(e) {
    e.preventDefault();
    const adminPassword = promptAdminPassword();
    if (!adminPassword) return;

    const payload = {
        fullName: document.getElementById('add-fullName').value,
        studentId: document.getElementById('add-studentId').value
    };

    try {
        const res = await fetch(`${API_URL}/create`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message);
            document.getElementById('form-create-tnv').reset();
            switchTab('dashboard');
        } else {
            showToast(result.error, false);
        }
    } catch (err) {
        showToast('Lỗi kết nối máy chủ!', false);
    }
}

async function loadVolunteers() {
    try {
        const response = await fetch(API_URL);
        volunteersData = await response.json();
        renderTable(volunteersData);
    } catch (err) {
        showToast('Không thể kết nối đến máy chủ!', false);
    }
}

function formatList(arr, keyFormatter) {
    if (!arr || arr.length === 0) return '-';
    return arr.map(item => keyFormatter(item)).join('<br>');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function renderTable(volunteers) {
    const tbody = document.getElementById('volunteer-table-body');
    tbody.innerHTML = '';

    if (volunteers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-4 text-center text-gray-500">Chưa có dữ liệu tình nguyện viên. Hãy bấm Tab "Thêm TNV Ban Đầu" để khởi tạo!</td></tr>`;
        return;
    }

    volunteers.forEach((tnv, index) => {
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-white' : 'bg-slate-50';

        let html = `
            <td class="p-2 font-medium">${index + 1}</td>
            <td class="p-2 text-left font-bold text-slate-800">${tnv.fullName}</td>
            <td class="p-2 font-mono">${tnv.studentId}</td>
        `;

        html += `
            <td class="p-2 text-left">${formatList(tnv.activities, a => `• ${a.jobContent}`)}</td>
            <td class="p-2 whitespace-nowrap">${formatList(tnv.activities, a => formatDate(a.date))}</td>
            <td class="p-2 font-bold text-blue-700">${tnv.activityCount}</td>
        `;

        html += `
            <td class="p-2 text-left text-red-600">${formatList(tnv.violations, v => `• ${v.error}`)}</td>
            <td class="p-2 whitespace-nowrap">${formatList(tnv.violations, v => formatDate(v.date))}</td>
            <td class="p-2 font-bold text-red-600">${tnv.violationCount}</td>
        `;

        html += `
            <td class="p-2 text-left">${formatList(tnv.campaigns, c => `• ${c}`)}</td>
            <td class="p-2 text-left text-emerald-700">${formatList(tnv.achievements, ac => `• ${ac}`)}</td>
            <td class="p-2 font-bold text-emerald-700">${tnv.campaignCount}</td>
        `;

        html += `
            <td class="p-2 text-left text-gray-600">${formatList(tnv.generalNotes, n => `• ${n}`)}</td>
            <td class="p-2">
                <button onclick="openDetailModal(${tnv.id})" class="bg-slate-700 hover:bg-slate-900 text-white text-xs px-2 py-1 rounded shadow">
                    ⚙️ Quản lý
                </button>
            </td>
        `;

        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

// MỞ MODAL XEM & XÓA CHI TIẾT TỪNG MỤC / DÒNG SAI
function openDetailModal(id) {
    const tnv = volunteersData.find(v => v.id === id);
    if (!tnv) return;

    document.getElementById('modal-title').textContent = `Quản lý Chi Tiết Dữ Liệu: ${tnv.fullName} (${tnv.studentId})`;
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = '';

    // Section: Danh sách Buổi Tình Nguyện
    let actHtml = `<div class="border rounded-lg p-3 bg-blue-50/50">
        <h4 class="font-bold text-blue-900 mb-2">📝 Buổi Tình Nguyện (${tnv.activityCount})</h4>`;
    if (tnv.activities.length === 0) {
        actHtml += `<p class="text-xs text-gray-500 italic">Chưa có thông tin</p>`;
    } else {
        actHtml += `<ul class="space-y-1">`;
        tnv.activities.forEach((act, idx) => {
            actHtml += `<li class="text-xs flex justify-between items-center bg-white p-2 rounded border">
                <span>• <b>${act.jobContent}</b> (${formatDate(act.date)})</span>
                <button onclick="deleteSingleItem(${tnv.id}, 'activity', ${idx})" class="text-red-600 font-bold hover:underline">Xóa mục này</button>
            </li>`;
        });
        actHtml += `</ul>`;
    }
    actHtml += `</div>`;

    // Section: Danh sách Vi Phạm
    let vioHtml = `<div class="border rounded-lg p-3 bg-red-50/50">
        <h4 class="font-bold text-red-900 mb-2">⚠️ Vi Phạm Kỷ Luật (${tnv.violationCount})</h4>`;
    if (tnv.violations.length === 0) {
        vioHtml += `<p class="text-xs text-gray-500 italic">Chưa có thông tin</p>`;
    } else {
        vioHtml += `<ul class="space-y-1">`;
        tnv.violations.forEach((vio, idx) => {
            vioHtml += `<li class="text-xs flex justify-between items-center bg-white p-2 rounded border">
                <span>• <b>${vio.error}</b> (${formatDate(vio.date)})</span>
                <button onclick="deleteSingleItem(${tnv.id}, 'violation', ${idx})" class="text-red-600 font-bold hover:underline">Xóa mục này</button>
            </li>`;
        });
        vioHtml += `</ul>`;
    }
    vioHtml += `</div>`;

    // Section: Chiến Dịch & Thành Tích
    let camHtml = `<div class="border rounded-lg p-3 bg-emerald-50/50">
        <h4 class="font-bold text-emerald-900 mb-2">🚩 Chiến Dịch & Thành Tích (${tnv.campaignCount})</h4>`;
    if (tnv.campaigns.length === 0 && tnv.achievements.length === 0) {
        camHtml += `<p class="text-xs text-gray-500 italic">Chưa có thông tin</p>`;
    } else {
        camHtml += `<ul class="space-y-1">`;
        tnv.campaigns.forEach((cam, idx) => {
            camHtml += `<li class="text-xs flex justify-between items-center bg-white p-2 rounded border">
                <span>• Chiến dịch: <b>${cam}</b></span>
                <button onclick="deleteSingleItem(${tnv.id}, 'campaign', ${idx})" class="text-red-600 font-bold hover:underline">Xóa mục này</button>
            </li>`;
        });
        tnv.achievements.forEach((ach, idx) => {
            camHtml += `<li class="text-xs flex justify-between items-center bg-white p-2 rounded border">
                <span>• Thành tích: <b>${ach}</b></span>
                <button onclick="deleteSingleItem(${tnv.id}, 'achievement', ${idx})" class="text-red-600 font-bold hover:underline">Xóa mục này</button>
            </li>`;
        });
        camHtml += `</ul>`;
    }
    camHtml += `</div>`;

    // Section: Ghi chú
    let noteHtml = `<div class="border rounded-lg p-3 bg-slate-50">
        <h4 class="font-bold text-gray-800 mb-2">📌 Ghi Chú Chung</h4>`;
    if (tnv.generalNotes.length === 0) {
        noteHtml += `<p class="text-xs text-gray-500 italic">Chưa có thông tin</p>`;
    } else {
        noteHtml += `<ul class="space-y-1">`;
        tnv.generalNotes.forEach((note, idx) => {
            noteHtml += `<li class="text-xs flex justify-between items-center bg-white p-2 rounded border">
                <span>• <b>${note}</b></span>
                <button onclick="deleteSingleItem(${tnv.id}, 'note', ${idx})" class="text-red-600 font-bold hover:underline">Xóa mục này</button>
            </li>`;
        });
        noteHtml += `</ul>`;
    }
    noteHtml += `</div>`;

    modalBody.innerHTML = actHtml + vioHtml + camHtml + noteHtml;

    // Nút Xóa Toàn Bộ Dòng
    document.getElementById('btn-delete-all').onclick = () => deleteAllVolunteer(tnv.id, tnv.fullName);

    const modal = document.getElementById('detail-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModal() {
    const modal = document.getElementById('detail-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// Xóa 1 mục lẻ sai trong dòng (CẦN MẬT KHẨU)
async function deleteSingleItem(id, type, index) {
    if (!confirm("Bạn có chắc muốn xóa mục lẻ bị sai này không?")) return;

    const adminPassword = promptAdminPassword();
    if (!adminPassword) return;

    try {
        const res = await fetch(`${API_URL}/${id}/item`, {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify({ type, index })
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message);
            await loadVolunteers();
            openDetailModal(id);
        } else {
            showToast(result.error, false);
        }
    } catch (err) {
        showToast('Lỗi khi xóa dữ liệu!', false);
    }
}

// Xóa toàn bộ dòng bị sai (CẦN MẬT KHẨU)
async function deleteAllVolunteer(id, fullName) {
    if (!confirm(`⚠️ CẢNH BÁO: Bạn có chắc chắn muốn XÓA DÒNG DỮ LIỆU của TNV "${fullName}" không?`)) return;

    const adminPassword = promptAdminPassword();
    if (!adminPassword) return;

    try {
        const res = await fetch(`${API_URL}/${id}`, {
            method: 'DELETE',
            headers: { 'x-admin-password': adminPassword }
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message);
            closeModal();
            loadVolunteers();
        } else {
            showToast(result.error, false);
        }
    } catch (err) {
        showToast('Lỗi khi xóa dòng!', false);
    }
}

// Form 1: CÔNG KHAI
async function handleForm1Submit(e) {
    e.preventDefault();
    const payload = {
        fullName: document.getElementById('f1-fullName').value,
        studentId: document.getElementById('f1-studentId').value,
        jobContent: document.getElementById('f1-jobContent').value,
        date: document.getElementById('f1-date').value
    };

    try {
        const res = await fetch(`${API_URL}/activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message);
            document.getElementById('form-activity').reset();
            switchTab('dashboard');
        } else {
            showToast(result.error, false);
        }
    } catch (err) {
        showToast('Đã xảy ra lỗi gửi dữ liệu!', false);
    }
}

// Form 2: CẦN MẬT KHẨU ADMIN
async function handleForm2Submit(e) {
    e.preventDefault();
    const adminPassword = promptAdminPassword();
    if (!adminPassword) return;

    const payload = {
        fullName: document.getElementById('f2-fullName').value,
        studentId: document.getElementById('f2-studentId').value,
        campaignName: document.getElementById('f2-campaignName').value
    };

    try {
        const res = await fetch(`${API_URL}/campaign`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message);
            document.getElementById('form-campaign').reset();
            switchTab('dashboard');
        } else {
            showToast(result.error, false);
        }
    } catch (err) {
        showToast('Đã xảy ra lỗi gửi dữ liệu!', false);
    }
}

function toggleForm3Fields() {
    const category = document.getElementById('f3-category').value;
    document.getElementById('field-violation').classList.add('hidden');
    document.getElementById('field-achievement').classList.add('hidden');
    document.getElementById('field-note').classList.add('hidden');

    if (category === 'violation') {
        document.getElementById('field-violation').classList.remove('hidden');
    } else if (category === 'achievement') {
        document.getElementById('field-achievement').classList.remove('hidden');
    } else if (category === 'note') {
        document.getElementById('field-note').classList.remove('hidden');
    }
}

async function checkDuplicateName() {
    const name = document.getElementById('f3-fullName').value.trim();
    const container = document.getElementById('f3-studentId-container');
    const studentIdInput = document.getElementById('f3-studentId');

    if (!name) return;

    try {
        const res = await fetch(`${API_URL}/search-by-name?name=${encodeURIComponent(name)}`);
        const rows = await res.json();

        if (rows.length >= 2) {
            container.classList.remove('hidden');
            studentIdInput.required = true;
        } else {
            container.classList.add('hidden');
            studentIdInput.required = false;
        }
    } catch (err) {
        console.error('Lỗi kiểm tra trùng tên:', err);
    }
}

// Form 3: CẦN MẬT KHẨU ADMIN
async function handleForm3Submit(e) {
    e.preventDefault();
    const adminPassword = promptAdminPassword();
    if (!adminPassword) return;

    const payload = {
        fullName: document.getElementById('f3-fullName').value,
        studentId: document.getElementById('f3-studentId').value,
        category: document.getElementById('f3-category').value,
        violationError: document.getElementById('f3-violationError').value,
        violationDate: document.getElementById('f3-violationDate').value,
        achievementContent: document.getElementById('f3-achievementContent').value,
        noteContent: document.getElementById('f3-noteContent').value
    };

    try {
        const res = await fetch(`${API_URL}/additional-info`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message);
            document.getElementById('form-additional').reset();
            toggleForm3Fields();
            document.getElementById('f3-studentId-container').classList.add('hidden');
            switchTab('dashboard');
        } else {
            showToast(result.error, false);
        }
    } catch (err) {
        showToast('Đã xảy ra lỗi kết nối!', false);
    }
}
