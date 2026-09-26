const API_BASE = window.CIVICFIX_API_BASE;

// ---------- View switching ----------
const views = {
  report: document.getElementById('view-report'),
  success: document.getElementById('view-success'),
  track: document.getElementById('view-track'),
};
function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
  document.getElementById('nav-report').classList.toggle('active', name === 'report' || name === 'success');
  document.getElementById('nav-track').classList.toggle('active', name === 'track');
}
document.getElementById('nav-report').onclick = () => showView('report');
document.getElementById('nav-track').onclick = () => showView('track');

// ---------- Photo capture ----------
let selectedPhotoFile = null;
const photoBox = document.getElementById('photoBox');
const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const photoPlaceholder = document.getElementById('photoPlaceholder');

photoBox.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedPhotoFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    photoPreview.src = e.target.result;
    photoPreview.classList.remove('hidden');
    photoPlaceholder.classList.add('hidden');
  };
  reader.readAsDataURL(file);
});

// ---------- Location detection ----------
let detectedLat = null, detectedLng = null;
document.getElementById('detectLocBtn').onclick = () => {
  const status = document.getElementById('locStatus');
  if (!navigator.geolocation) {
    status.textContent = 'Geolocation not supported by this browser.';
    return;
  }
  status.textContent = 'Detecting…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      detectedLat = pos.coords.latitude;
      detectedLng = pos.coords.longitude;
      status.textContent = `📍 ${detectedLat.toFixed(5)}, ${detectedLng.toFixed(5)}`;
    },
    (err) => {
      status.textContent = 'Could not get location: ' + err.message;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

// ---------- Submit report ----------
document.getElementById('submitBtn').onclick = async () => {
  const errBox = document.getElementById('submitError');
  errBox.classList.add('hidden');

  if (!selectedPhotoFile) return showError('Please add a photo of the issue.');
  if (detectedLat === null || detectedLng === null) return showError('Please detect your location first.');

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Analyzing photo…';

  try {
    const form = new FormData();
    form.append('photo', selectedPhotoFile);
    form.append('latitude', detectedLat);
    form.append('longitude', detectedLng);
    form.append('description', document.getElementById('descInput').value);
    form.append('reporter_name', document.getElementById('nameInput').value);
    form.append('reporter_contact', document.getElementById('contactInput').value);

    const res = await fetch(`${API_BASE}/reports`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed');

    document.getElementById('successCode').textContent = data.report.tracking_code;
    document.getElementById('aiSummary').textContent = data.ai_summary
      ? `AI note: ${data.ai_summary}`
      : '';
    renderNearby(data.nearby_reports || [], 'nearbyCard', 'nearbyList');
    showView('success');
    resetForm();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Report';
  }

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  }
};

function resetForm() {
  selectedPhotoFile = null;
  photoInput.value = '';
  photoPreview.classList.add('hidden');
  photoPlaceholder.classList.remove('hidden');
  detectedLat = null; detectedLng = null;
  document.getElementById('locStatus').textContent = 'Not detected yet';
  document.getElementById('descInput').value = '';
  document.getElementById('nameInput').value = '';
  document.getElementById('contactInput').value = '';
}

document.getElementById('newReportBtn').onclick = () => showView('report');
document.getElementById('trackNowBtn').onclick = () => {
  document.getElementById('trackInput').value = document.getElementById('successCode').textContent;
  showView('track');
  lookupReport();
};

// ---------- Nearby reports rendering (transparency feature) ----------
const STATUS_LABELS = {
  submitted: 'Submitted', under_review: 'Under Review', assigned: 'Assigned',
  in_progress: 'In Progress', resolved: 'Resolved', rejected: 'Rejected', duplicate: 'Duplicate',
};

function renderNearby(nearby, cardId, listId) {
  const card = document.getElementById(cardId);
  const list = document.getElementById(listId);
  if (!nearby.length) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  list.innerHTML = nearby.map(n => `
    <div class="nearby-item">
      <div>
        <strong style="text-transform:capitalize;">${n.category.replace(/_/g, ' ')}</strong>
        <div class="meta">${n.distance_m}m away · reported ${new Date(n.created_at).toLocaleDateString()} · ${n.tracking_code}</div>
      </div>
      <span class="status-pill">${STATUS_LABELS[n.status] || n.status}</span>
    </div>
  `).join('');
}

// ---------- Tracking ----------
document.getElementById('trackBtn').onclick = lookupReport;
document.getElementById('trackInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') lookupReport();
});

async function lookupReport() {
  const code = document.getElementById('trackInput').value.trim();
  const errBox = document.getElementById('trackError');
  const resultBox = document.getElementById('trackResult');
  errBox.classList.add('hidden');
  resultBox.classList.add('hidden');
  if (!code) return;

  try {
    const res = await fetch(`${API_BASE}/reports/track/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Report not found');

    const r = data.report;
    document.getElementById('trackCategory').textContent = r.category.replace(/_/g, ' ');
    document.getElementById('trackStatus').textContent = STATUS_LABELS[r.status] || r.status;
    document.getElementById('trackDept').textContent = `Department: ${r.department.replace(/_/g, ' ')}`;
    document.getElementById('trackDesc').textContent = r.description || '(no description provided)';
    document.getElementById('trackPhoto').src = `${API_BASE.replace('/api', '')}${r.photo_url}`;
    const sevBadge = document.getElementById('trackSeverity');
    sevBadge.textContent = r.severity + ' severity';
    sevBadge.className = 'badge ' + r.severity;
    document.getElementById('trackSafety').textContent = r.safety_risk ? '⚠️ Flagged as a safety risk' : '';

    const timeline = document.getElementById('trackTimeline');
    timeline.innerHTML = '';
    data.history.forEach(h => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${STATUS_LABELS[h.status] || h.status}</strong>` +
        (h.note ? ` — ${h.note}` : '') +
        `<div class="ts">${new Date(h.created_at).toLocaleString()} · ${h.changed_by_name || 'System'}</div>`;
      timeline.appendChild(li);
    });

    renderNearby(data.nearby_reports || [], 'trackNearbyCard', 'trackNearbyList');
    resultBox.classList.remove('hidden');
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
}
