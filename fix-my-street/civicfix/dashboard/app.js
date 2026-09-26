const API_BASE = window.CIVICFIX_API_BASE;
let token = localStorage.getItem('civicfix_token') || null;
let employee = JSON.parse(localStorage.getItem('civicfix_employee') || 'null');
let currentPage = 1;
const PAGE_SIZE = 20;
let totalReports = 0;

const loginView = document.getElementById('view-login');
const dashView = document.getElementById('view-dashboard');

function showLoggedIn() {
  loginView.classList.add('hidden');
  dashView.classList.remove('hidden');
  document.getElementById('whoName').textContent = employee.name;
  document.getElementById('whoDept').textContent = (employee.department || 'all departments').replace(/_/g, ' ');
  loadStats();
  loadReports();
}
function showLoggedOut() {
  dashView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

if (token && employee) showLoggedIn(); else showLoggedOut();

document.getElementById('loginBtn').onclick = async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    token = data.token;
    employee = data.employee;
    localStorage.setItem('civicfix_token', token);
    localStorage.setItem('civicfix_employee', JSON.stringify(employee));
    showLoggedIn();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
};

document.getElementById('logoutBtn').onclick = () => {
  localStorage.removeItem('civicfix_token');
  localStorage.removeItem('civicfix_employee');
  token = null; employee = null;
  showLoggedOut();
};

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function loadStats() {
  const res = await fetch(`${API_BASE}/reports/stats`, { headers: authHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  const t = data.totals;
  const stats = [
    ['Total', t.total], ['Submitted', t.submitted], ['Under Review', t.under_review],
    ['Assigned', t.assigned], ['In Progress', t.in_progress], ['Resolved', t.resolved],
    ['Safety Risks (open)', t.open_safety_risks],
  ];
  document.getElementById('statsBox').innerHTML = stats.map(([lbl, num]) =>
    `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`
  ).join('');
}

function buildQuery() {
  const params = new URLSearchParams();
  const q = document.getElementById('qFilter').value.trim();
  const status = document.getElementById('statusFilter').value;
  const department = document.getElementById('deptFilter').value;
  const severity = document.getElementById('severityFilter').value;
  const safety = document.getElementById('safetyFilter').value;
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (department) params.set('department', department);
  if (severity) params.set('severity', severity);
  if (safety) params.set('safety_risk', safety);
  params.set('page', currentPage);
  params.set('pageSize', PAGE_SIZE);
  return params.toString();
}

const STATUS_LABELS = {
  submitted: 'Submitted', under_review: 'Under Review', assigned: 'Assigned',
  in_progress: 'In Progress', resolved: 'Resolved', rejected: 'Rejected', duplicate: 'Duplicate',
};

async function loadReports() {
  const res = await fetch(`${API_BASE}/reports?${buildQuery()}`, { headers: authHeaders() });
  if (res.status === 401) { showLoggedOut(); return; }
  const data = await res.json();
  totalReports = data.total;
  const tbody = document.getElementById('reportsTbody');
  tbody.innerHTML = data.reports.map(r => `
    <tr data-id="${r.report_id}">
      <td>${r.tracking_code}</td>
      <td>${r.category.replace(/_/g, ' ')}${r.possible_duplicate ? ' <span class="muted">(possible dup)</span>' : ''}</td>
      <td><span class="badge ${r.severity}">${r.severity}</span></td>
      <td>${r.department.replace(/_/g, ' ')}</td>
      <td><span class="status-pill">${STATUS_LABELS[r.status] || r.status}</span></td>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
      <td>${r.safety_risk ? '<span class="safety-flag">⚠</span>' : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="muted">No reports match these filters.</td></tr>';

  Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
    tr.onclick = () => openReportModal(tr.dataset.id);
  });

  const totalPages = Math.max(1, Math.ceil(totalReports / PAGE_SIZE));
  document.getElementById('pageLabel').textContent = `Page ${currentPage} of ${totalPages}`;
}

document.getElementById('applyFiltersBtn').onclick = () => { currentPage = 1; loadReports(); };
document.getElementById('prevPageBtn').onclick = () => { if (currentPage > 1) { currentPage--; loadReports(); } };
document.getElementById('nextPageBtn').onclick = () => {
  const totalPages = Math.max(1, Math.ceil(totalReports / PAGE_SIZE));
  if (currentPage < totalPages) { currentPage++; loadReports(); }
};

// ---------- Detail modal ----------
const overlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');

async function openReportModal(reportId) {
  const res = await fetch(`${API_BASE}/reports/${reportId}`, { headers: authHeaders() });
  const data = await res.json();
  const r = data.report;

  modalContent.innerHTML = `
    <span class="close-x" id="closeModalBtn">✕</span>
    <h2 style="margin-top:0;">${r.tracking_code} — ${r.category.replace(/_/g, ' ')}</h2>
    <img src="${API_BASE.replace('/api', '')}${r.photo_url}" />
    <p><strong>Description:</strong> ${r.description || '<span class="muted">none provided</span>'}</p>
    <p><strong>Location:</strong> ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}
      — <a href="https://www.google.com/maps?q=${r.latitude},${r.longitude}" target="_blank">view on map</a></p>
    <p>
      <span class="badge ${r.severity}">${r.severity} severity</span>
      &nbsp;AI confidence: ${(r.confidence * 100).toFixed(0)}%
      ${r.safety_risk ? `<br><span class="safety-flag">⚠ Safety risk: ${r.safety_risk_reason || ''}</span>` : ''}
      ${r.possible_duplicate ? `<br><span class="muted">Possibly a duplicate of an existing open report.</span>` : ''}
    </p>
    <p><strong>Reporter:</strong> ${r.reporter_name || 'anonymous'} ${r.reporter_contact ? `(${r.reporter_contact})` : ''}</p>

    <h3>Update status</h3>
    <select id="newStatus">
      ${Object.keys(STATUS_LABELS).map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
    </select>
    <select id="newDept" style="margin-left:8px;">
      ${['roads_and_transportation','street_lighting','sidewalks_and_accessibility','signage','sanitation','public_works_general']
        .map(d => `<option value="${d}" ${d === r.department ? 'selected' : ''}>${d.replace(/_/g, ' ')}</option>`).join('')}
    </select>
    <textarea id="statusNote" placeholder="Add a note for this update (optional)"></textarea>
    <div class="row-actions">
      <button class="btn" id="saveStatusBtn">Save update</button>
      <span id="saveError" class="error hidden"></span>
    </div>

    <h3>History timeline</h3>
    <ul class="timeline">
      ${data.history.map(h => `
        <li><strong>${STATUS_LABELS[h.status] || h.status}</strong>${h.note ? ` — ${h.note}` : ''}
          <div class="ts">${new Date(h.created_at).toLocaleString()} · ${h.changed_by_name || 'System'}</div>
        </li>
      `).join('')}
    </ul>
  `;

  overlay.classList.remove('hidden');
  document.getElementById('closeModalBtn').onclick = closeModal;

  document.getElementById('saveStatusBtn').onclick = async () => {
    const status = document.getElementById('newStatus').value;
    const department = document.getElementById('newDept').value;
    const note = document.getElementById('statusNote').value;
    const errBox = document.getElementById('saveError');
    try {
      const res2 = await fetch(`${API_BASE}/reports/${reportId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status, department, note }),
      });
      const d2 = await res2.json();
      if (!res2.ok) throw new Error(d2.error || 'Update failed');
      closeModal();
      loadReports();
      loadStats();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  };
}

function closeModal() {
  overlay.classList.add('hidden');
  modalContent.innerHTML = '';
}
overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
