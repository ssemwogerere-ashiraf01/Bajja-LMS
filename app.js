// ========== SUPABASE CONFIGURATION ==========
const SUPABASE_URL = "https://dsbvxsqgehlomcrofakh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JXTHmcLJVoi3IOIQsCAtYA_AoAHA56n";

// ========== SUPABASE CLIENT ==========
let supabaseClient = null;
let supabaseReady = false;
let saveTimer = null;

// ========== STATE ==========
let classes = [];
let currentClassId = null;
let learners = [];
let assessments = [];
let marks = {};
let classCounters = {};
let individualReports = {};

let currentMarksAssessmentId = null;
let editingLearnerId = null;
let performanceChartInstance = null;
let gradeDistChartInstance = null;
let currentReportLearnerId = null;
let reportSubjects = [];
let lastIndividualReport = null;

const NAVY = "#1B2A4A";
const GREEN = "#1E5631";
const GOLD = "#C9A227";
const BLUE = "#0066CC";
const RED = "#B91C1C";
const SCHOOL_NAME = "Comprehensive High School Bajja — Lukaya";

const BANDS = {
  cbc: [
    { label: "Exceptional", min: 80, color: GREEN },
    { label: "Adequate", min: 55, color: "#2E7D32" },
    { label: "Moderate", min: 30, color: GOLD },
    { label: "Basic", min: 1, color: "#B45309" },
    { label: "Below Basic", min: 0, color: RED },
  ],
  uce: [
    { label: "D1", min: 90, color: "#1B5E20" },
    { label: "D2", min: 80, color: "#2E7D32" },
    { label: "C3", min: 75, color: "#388E3C" },
    { label: "C4", min: 70, color: "#43A047" },
    { label: "C5", min: 65, color: "#7CB342" },
    { label: "C6", min: 60, color: GOLD },
    { label: "P7", min: 50, color: "#F57C00" },
    { label: "P8", min: 40, color: "#E65100" },
    { label: "F9", min: 0, color: RED },
  ],
  letter: [
    { label: "A", min: 80, color: "#1B5E20" },
    { label: "B", min: 70, color: "#388E3C" },
    { label: "C", min: 60, color: GOLD },
    { label: "D", min: 50, color: "#E65100" },
    { label: "F", min: 0, color: RED },
  ],
};

const PRINCIPAL_POINT_GRADES = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E', 0: 'F' };

// ========== UTILITY FUNCTIONS ==========
function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function flashSuccess(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showErr(id, msg) {
  $(id).textContent = msg;
}

function clearErr(id) {
  $(id).textContent = '';
}

function showCloudStatus(msg, isError) {
  const el = $('cloudStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#B91C1C' : '#6B7680';
}

function bandFor(pct, scale) {
  const bands = BANDS[scale] || BANDS.cbc;
  const p = Number(pct);
  for (const b of bands) {
    if (p >= b.min) return b;
  }
  return bands[bands.length - 1];
}

function scoreOutOf3(mark, total) {
  return ((mark / total) * 3).toFixed(2);
}

function computeSubjectGrade(subject) {
  const m = Number(subject.marks);
  const t = Number(subject.total) || 1;
  const pct = (m / t) * 100;
  if (subject.type === 'subsidiary') {
    const pass = pct >= 30;
    return { point: pass ? 1 : 0, grade: pass ? 'A' : 'F', pct };
  }
  let point = Math.round((m / t) * 5);
  point = Math.max(0, Math.min(5, point));
  return { point, grade: PRINCIPAL_POINT_GRADES[point], pct };
}

function getCurrentClass() {
  return classes.find(c => c.id === currentClassId);
}

function getClassLearners(classId = currentClassId) {
  return learners.filter(l => l.class_id === classId);
}

function getClassAssessments(classId = currentClassId) {
  return assessments.filter(a => a.class_id === classId);
}

function getNextLearnerId() {
  const cls = getCurrentClass();
  if (!cls) return null;
  const code = cls.code;
  const last = classCounters[currentClassId] || 0;
  const next = last + 1;
  const padded = next.toString().padStart(2, '0');
  return `${code}${padded}`;
}

function updateNextIdPreview() {
  const nextId = getNextLearnerId();
  $('nextIdPreview').textContent = nextId ? nextId : '(no class or no code)';
}

// ========== SUPABASE DATA OPERATIONS ==========

function initSupabase() {
  if (SUPABASE_URL === "YOUR_SUPABASE_URL" || SUPABASE_ANON_KEY === "YOUR_SUPABASE_ANON_KEY") {
    showCloudStatus('Supabase not configured yet.', true);
    return false;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseReady = true;
    return true;
  } catch (e) {
    console.error(e);
    showCloudStatus('Could not connect to Supabase. Check your configuration.', true);
    return false;
  }
}

async function deleteMultiple(table, column, values) {
  if (!supabaseReady || values.length === 0) return;
  const { error } = await supabaseClient
    .from(table)
    .delete()
    .in(column, values);
  if (error) throw error;
}

async function saveClass(classObj) {
  if (!supabaseReady) return classObj;
  const { data, error } = await supabaseClient
    .from('classes')
    .upsert(classObj, { onConflict: 'id' })
    .select();
  if (error) throw error;
  return data && data.length > 0 ? data[0] : classObj;
}

async function saveLearner(learnerObj) {
  if (!supabaseReady) return learnerObj;
  const { data, error } = await supabaseClient
    .from('learners')
    .upsert(learnerObj, { onConflict: 'id' })
    .select();
  if (error) throw error;
  return data && data.length > 0 ? data[0] : learnerObj;
}

async function saveAssessment(assessmentObj) {
  if (!supabaseReady) return assessmentObj;
  const { data, error } = await supabaseClient
    .from('assessments')
    .upsert(assessmentObj, { onConflict: 'id' })
    .select();
  if (error) throw error;
  return data && data.length > 0 ? data[0] : assessmentObj;
}

async function saveMarkRecord(assessmentId, learnerId, mark) {
  if (!supabaseReady) return;
  const { data, error } = await supabaseClient
    .from('marks')
    .upsert({ assessment_id: assessmentId, learner_id: learnerId, mark: mark }, { onConflict: 'assessment_id, learner_id' })
    .select();
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

async function saveClassCounter(classId, lastNumber) {
  if (!supabaseReady) return;
  const { data, error } = await supabaseClient
    .from('class_counters')
    .upsert({ class_id: classId, last_number: lastNumber }, { onConflict: 'class_id' })
    .select();
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

async function saveIndividualReport(learnerId, subjects) {
  if (!supabaseReady) return;
  const { data, error } = await supabaseClient
    .from('individual_reports')
    .upsert({ learner_id: learnerId, level: 'alevel', subjects: subjects }, { onConflict: 'learner_id' })
    .select();
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

async function deleteLearnerRecords(learnerIds) {
  if (!supabaseReady || learnerIds.length === 0) return;
  await deleteMultiple('learners', 'id', learnerIds);
}

async function deleteAssessmentRecords(assessmentIds) {
  if (!supabaseReady || assessmentIds.length === 0) return;
  await deleteMultiple('assessments', 'id', assessmentIds);
}

async function deleteClassRecords(classIds) {
  if (!supabaseReady || classIds.length === 0) return;
  await deleteMultiple('classes', 'id', classIds);
}

async function loadAllData() {
  if (!supabaseReady) return false;
  showCloudStatus('Loading data from Supabase...');

  try {
    const { data: classesData, error: classesError } = await supabaseClient
      .from('classes')
      .select('*')
      .order('id');
    if (classesError) throw classesError;
    classes = classesData || [];

    const { data: learnersData, error: learnersError } = await supabaseClient
      .from('learners')
      .select('*')
      .order('name');
    if (learnersError) throw learnersError;
    learners = learnersData || [];

    const { data: assessmentsData, error: assessmentsError } = await supabaseClient
      .from('assessments')
      .select('*')
      .order('id');
    if (assessmentsError) throw assessmentsError;
    assessments = assessmentsData || [];

    const { data: marksData, error: marksError } = await supabaseClient
      .from('marks')
      .select('*');
    if (marksError) throw marksError;
    marks = {};
    (marksData || []).forEach(m => {
      marks[`${m.assessment_id}-${m.learner_id}`] = m.mark;
    });

    const { data: countersData, error: countersError } = await supabaseClient
      .from('class_counters')
      .select('*');
    if (countersError) throw countersError;
    classCounters = {};
    (countersData || []).forEach(c => {
      classCounters[c.class_id] = c.last_number;
    });

    const { data: reportsData, error: reportsError } = await supabaseClient
      .from('individual_reports')
      .select('*');
    if (reportsError) throw reportsError;
    individualReports = {};
    (reportsData || []).forEach(r => {
      individualReports[r.learner_id] = r.subjects || [];
    });

    const savedClassId = localStorage.getItem('currentClassId');
    if (savedClassId && classes.some(c => c.id === Number(savedClassId))) {
      currentClassId = Number(savedClassId);
    } else if (classes.length > 0) {
      currentClassId = classes[0].id;
    } else {
      currentClassId = null;
    }

    showCloudStatus('Data loaded successfully from Supabase.');
    setTimeout(() => showCloudStatus(''), 2000);
    return true;
  } catch (e) {
    console.error(e);
    showCloudStatus('Could not load data from Supabase: ' + e.message, true);
    return false;
  }
}

// ========== CLASS MANAGEMENT ==========

function populateExistingClassSelect() {
  const sel = $('existingClassSelect');
  sel.innerHTML = '<option value="">-- Select a class --</option>' +
    classes.map(c => `<option value="${c.id}" ${c.id === currentClassId ? 'selected' : ''}>${c.name} [${c.code}]</option>`).join('');
}

function renderClasses() {
  const cls = getCurrentClass();
  if (cls) {
    $('currentClassBadge').textContent = `${cls.name} (${cls.teacher || 'No teacher'}) [${cls.code}]`;
    $('className').value = cls.name;
    $('classTeacher').value = cls.teacher || '';
    $('classCode').value = cls.code;
  } else {
    $('currentClassBadge').textContent = 'No class selected';
  }
  populateExistingClassSelect();
  updateNextIdPreview();
  $('deleteClassBtn').disabled = !cls;
}

async function createOrSwitchClass() {
  const name = $('className').value.trim();
  const teacher = $('classTeacher').value.trim();
  const code = $('classCode').value.trim().toUpperCase();
  if (!name || !code) {
    alert('Please enter a class name and class code (e.g., S1)');
    return;
  }

  const existing = classes.find(c => c.code === code);
  if (existing) {
    currentClassId = existing.id;
    existing.name = name;
    existing.teacher = teacher;
    try {
      await saveClass(existing);
    } catch (e) {
      console.error('Error updating class:', e);
      alert('Error updating class. Please try again.');
      return;
    }
  } else {
    const classObj = { id: Date.now(), name, teacher, code, created_at: new Date().toISOString() };
    try {
      const saved = await saveClass(classObj);
      classes.push(saved);
      currentClassId = saved.id;
      if (!classCounters[currentClassId]) {
        classCounters[currentClassId] = 0;
        await saveClassCounter(currentClassId, 0);
      }
    } catch (e) {
      console.error('Error creating class:', e);
      alert('Error creating class. Please try again.');
      return;
    }
  }

  localStorage.setItem('currentClassId', String(currentClassId));
  renderClasses();
  renderLearners();
  renderAssessments();
  renderAnalytics();
  updateGlobalButtons();
}

function switchToClassId(id) {
  if (!id) return;
  currentClassId = Number(id);
  localStorage.setItem('currentClassId', String(currentClassId));
  renderClasses();
  renderLearners();
  renderAssessments();
  hideEnterMarksCard();
  renderAnalytics();
  updateGlobalButtons();
}

async function deleteCurrentClass() {
  const cls = getCurrentClass();
  if (!cls) return;
  if (!confirm(`Delete class "${cls.name}" [${cls.code}]? This will remove all its learners, assessments, and marks. This cannot be undone.`)) return;

  const classId = cls.id;
  const assessIds = assessments.filter(a => a.class_id === classId).map(a => a.id);
  const learnerIds = learners.filter(l => l.class_id === classId).map(l => l.id);

  try {
    if (assessIds.length > 0) {
      await deleteMultiple('assessments', 'id', assessIds);
    }
    if (learnerIds.length > 0) {
      await deleteMultiple('learners', 'id', learnerIds);
    }
    await deleteMultiple('class_counters', 'class_id', [classId]);
    await deleteMultiple('classes', 'id', [classId]);

    assessments = assessments.filter(a => a.class_id !== classId);
    learners = learners.filter(l => l.class_id !== classId);
    Object.keys(marks).forEach(key => {
      const assessId = key.split('-')[0];
      if (assessIds.includes(assessId) || assessIds.map(String).includes(assessId)) {
        delete marks[key];
      }
    });
    delete classCounters[classId];
    classes = classes.filter(c => c.id !== classId);
    learnerIds.forEach(id => delete individualReports[id]);
    currentClassId = classes.length ? classes[0].id : null;
    localStorage.setItem('currentClassId', String(currentClassId));
    renderClasses();
    renderLearners();
    renderAssessments();
    hideEnterMarksCard();
    renderAnalytics();
    updateGlobalButtons();
  } catch (e) {
    console.error('Error deleting class:', e);
    alert('Error deleting class. Please try again.');
  }
}

// ========== LEARNER MANAGEMENT ==========

function renderLearners() {
  const list = getClassLearners();
  populateReportLearnerSelect();
  if (!currentClassId) {
    $('learnersTableWrap').innerHTML = '<div class="empty-state">Create or select a class first.</div>';
    updateButtons();
    return;
  }
  applySearchAndSort(list);
}

function applySearchAndSort(baseList) {
  const query = ($('searchBox').value || '').trim().toLowerCase();
  const sortBy = $('sortBy').value;
  let list = baseList.slice();
  if (query) {
    list = list.filter(l => l.name.toLowerCase().includes(query) || l.id.toLowerCase().includes(query));
  }
  list.sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'id') return a.id.localeCompare(b.id);
    if (sortBy === 'joined') return new Date(a.joined || 0) - new Date(b.joined || 0);
    return 0;
  });
  renderLearnersTable(list);
}

function renderLearnersTable(list) {
  if (list.length === 0) {
    $('learnersTableWrap').innerHTML = '<div class="empty-state">No learners found.</div>';
    updateButtons();
    return;
  }
  const rows = list.map(l => `
    <tr>
      <td><input type="checkbox" class="learner-checkbox" value="${l.id}"></td>
      <td>${l.id}</td>
      <td>${escapeHtml(l.name)}</td>
      <td>${l.email ? escapeHtml(l.email) : '—'}</td>
      <td>${l.joined || '—'}</td>
      <td><button class="action-btn" onclick="editLearner('${l.id}')">Edit</button> <button class="action-btn danger" onclick="deleteLearner('${l.id}')">Delete</button></td>
    </tr>
  `).join('');

  $('learnersTableWrap').innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead><tr><th class="checkbox-cell"><input type="checkbox" id="selectAll"></th><th>ID</th><th>Name</th><th>Email</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const sel = $('selectAll');
  if (sel) {
    sel.addEventListener('change', (e) => {
      $$('.learner-checkbox').forEach(cb => cb.checked = e.target.checked);
      updateButtons();
    });
  }
  $$('.learner-checkbox').forEach(cb => cb.addEventListener('change', updateButtons));
  updateButtons();
}

function updateButtons() {
  const checkedBoxes = $$('.learner-checkbox:checked');
  $('deleteSelectedBtn').disabled = checkedBoxes.length === 0;
  $('editSelectedBtn').disabled = checkedBoxes.length !== 1;
  $('exportLearnersCsvBtn').disabled = getClassLearners().length === 0;
}

function updateGlobalButtons() {
  updateButtons();
}

async function addLearner() {
  clearErr('formErr');
  if (!currentClassId) {
    showErr('formErr', 'Please create or select a class first.');
    return;
  }
  const name = $('learnerName').value.trim();
  const email = $('email').value.trim();
  const joined = $('dateEnrolled').value;
  if (!name) {
    showErr('formErr', 'Please enter the learner\'s full name.');
    return;
  }
  const id = getNextLearnerId();
  const learner = { id, class_id: currentClassId, name, email, joined: joined || new Date().toISOString().slice(0, 10) };

  try {
    await saveLearner(learner);
    learners.push(learner);
    classCounters[currentClassId] = (classCounters[currentClassId] || 0) + 1;
    await saveClassCounter(currentClassId, classCounters[currentClassId]);
    $('learnerName').value = '';
    $('email').value = '';
    $('dateEnrolled').value = '';
    updateNextIdPreview();
    renderLearners();
    renderAnalytics();
    updateGlobalButtons();
    flashSuccess('addSuccess', `Learner ${name} added with ID ${id}.`);
  } catch (e) {
    console.error('Error adding learner:', e);
    showErr('formErr', 'Error adding learner: ' + e.message);
  }
}

function editLearner(id) {
  const learner = learners.find(l => l.id === id && l.class_id === currentClassId);
  if (!learner) return;
  editingLearnerId = id;
  $('editStudentId').value = learner.id;
  $('editLearnerName').value = learner.name;
  $('editEmail').value = learner.email || '';
  $('editComment').value = learner.comment || '';
  $('editModal').classList.add('show');
}

function editSelectedLearner() {
  const checked = $$('.learner-checkbox:checked');
  if (checked.length !== 1) return;
  editLearner(checked[0].value);
}

async function saveLearnerEdit() {
  const learner = learners.find(l => l.id === editingLearnerId);
  if (!learner) { closeEditModal(); return; }
  const name = $('editLearnerName').value.trim();
  if (!name) {
    alert('Name cannot be empty.');
    return;
  }
  learner.name = name;
  learner.email = $('editEmail').value.trim();
  learner.comment = $('editComment').value.trim();
  try {
    await saveLearner(learner);
    closeEditModal();
    renderLearners();
  } catch (e) {
    console.error('Error updating learner:', e);
    alert('Error updating learner. Please try again.');
  }
}

function closeEditModal() {
  $('editModal').classList.remove('show');
  editingLearnerId = null;
}

async function deleteLearner(id) {
  const learner = learners.find(l => l.id === id);
  if (!learner) return;
  if (!confirm(`Delete learner ${learner.name} (${id})? Their marks in all assessments will also be removed.`)) return;

  try {
    await deleteLearnerRecords([id]);
    learners = learners.filter(l => l.id !== id);
    Object.keys(marks).forEach(key => {
      if (key.endsWith(`-${id}`)) delete marks[key];
    });
    delete individualReports[id];
    if (currentReportLearnerId === id) selectReportLearner('');
    renderLearners();
    renderAssessments();
    if (currentMarksAssessmentId) renderMarksSummary(currentMarksAssessmentId);
    renderAnalytics();
    updateGlobalButtons();
  } catch (e) {
    console.error('Error deleting learner:', e);
    alert('Error deleting learner. Please try again.');
  }
}

async function deleteSelectedLearners() {
  const checked = Array.from($$('.learner-checkbox:checked')).map(cb => cb.value);
  if (checked.length === 0) return;
  if (!confirm(`Delete ${checked.length} selected learner(s)? Their marks will also be removed.`)) return;

  try {
    await deleteLearnerRecords(checked);
    learners = learners.filter(l => !checked.includes(l.id));
    Object.keys(marks).forEach(key => {
      const learnerId = key.split('-')[1];
      if (checked.includes(learnerId)) delete marks[key];
    });
    checked.forEach(id => delete individualReports[id]);
    if (checked.includes(currentReportLearnerId)) selectReportLearner('');
    renderLearners();
    renderAssessments();
    if (currentMarksAssessmentId) renderMarksSummary(currentMarksAssessmentId);
    renderAnalytics();
    updateGlobalButtons();
  } catch (e) {
    console.error('Error deleting selected learners:', e);
    alert('Error deleting selected learners. Please try again.');
  }
}

function exportLearnersCsv() {
  const list = getClassLearners();
  if (list.length === 0) return;
  const cls = getCurrentClass();
  let csv = 'Student ID,Full Name,Email,Date Enrolled\n';
  list.forEach(l => {
    csv += `${l.id},"${(l.name || '').replace(/"/g, '""')}",${l.email || ''},${l.joined || ''}\n`;
  });
  downloadFile(csv, `${cls ? cls.code : 'class'}_learners.csv`, 'text/csv');
}

// ========== ASSESSMENTS ==========

async function createAssessment() {
  clearErr('assessmentErr');
  if (!currentClassId) {
    showErr('assessmentErr', 'Please create or select a class first.');
    return;
  }
  const title = $('assessmentTitle').value.trim();
  const type = $('assessmentType').value;
  const total = Number($('totalMarks').value);
  const weight = Number($('weight').value);
  const due = $('dueDate').value;
  const scale = $('gradeScale').value;

  if (!title) { showErr('assessmentErr', 'Please enter an assessment title.'); return; }
  if (!total || total <= 0) { showErr('assessmentErr', 'Total marks must be a positive number.'); return; }
  if (weight < 0 || weight > 100) { showErr('assessmentErr', 'Weight must be between 0 and 100.'); return; }

  const assessment = { id: String(Date.now()), class_id: currentClassId, title, type, total, weight, due, scale };

  try {
    await saveAssessment(assessment);
    assessments.push(assessment);
    $('assessmentTitle').value = '';
    $('totalMarks').value = 60;
    $('weight').value = 20;
    $('dueDate').value = '';
    renderAssessments();
    renderAnalytics();
    updateGlobalButtons();
  } catch (e) {
    console.error('Error creating assessment:', e);
    showErr('assessmentErr', 'Error creating assessment: ' + e.message);
  }
}

function renderAssessments() {
  const list = getClassAssessments();
  if (list.length === 0) {
    $('assessmentsListWrap').innerHTML = '<div class="empty-state">No assessments created yet.</div>';
    return;
  }
  const classLearners = getClassLearners();
  const html = list.map(a => {
    const marksCount = classLearners.filter(l => marks[`${a.id}-${l.id}`] !== undefined).length;
    const totalLearners = classLearners.length;
    const progress = `${marksCount}/${totalLearners}`;
    return `
      <div style="padding:12px;border:1px solid #D6DBE0;border-radius:8px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <strong>${escapeHtml(a.title)}</strong> (${a.type}) — ${a.total} marks | Weight: ${a.weight}%
            <br><small style="color:#6B7680;">Due: ${a.due || 'No date'} | Marks entered: ${progress}</small>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn small" onclick="openMarkEntry('${a.id}')">Enter Marks</button>
            <button class="btn small secondary" onclick="generateAssessmentPdf('${a.id}')">Download PDF</button>
            <button class="btn small danger" onclick="deleteAssessment('${a.id}')">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  $('assessmentsListWrap').innerHTML = html;
}

async function deleteAssessment(id) {
  const assess = assessments.find(a => a.id === id);
  if (!assess) return;
  if (!confirm(`Delete assessment "${assess.title}"? All marks for it will be removed.`)) return;

  try {
    await deleteAssessmentRecords([id]);
    assessments = assessments.filter(a => a.id !== id);
    Object.keys(marks).forEach(key => {
      if (key.startsWith(`${id}-`)) delete marks[key];
    });
    renderAssessments();
    if (currentMarksAssessmentId === id) hideEnterMarksCard();
    renderAnalytics();
    updateGlobalButtons();
  } catch (e) {
    console.error('Error deleting assessment:', e);
    alert('Error deleting assessment. Please try again.');
  }
}

function openMarkEntry(assessId) {
  const assess = assessments.find(a => a.id === assessId);
  if (!assess) return;
  currentMarksAssessmentId = assessId;
  $('enterMarksCard').style.display = 'block';
  $('marksAssessmentTitle').textContent = `${assess.title} (out of ${assess.total})`;
  renderMarksLearnerSelect();
  $('marksObtained').value = '';
  clearErr('markErr');
  renderMarksSummary(assessId);
  $('enterMarksCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideEnterMarksCard() {
  currentMarksAssessmentId = null;
  $('enterMarksCard').style.display = 'none';
}

function renderMarksLearnerSelect() {
  const sel = $('marksLearner');
  const list = getClassLearners();
  sel.innerHTML = '<option value="">-- Select a learner --</option>' + list.map(l =>
    `<option value="${l.id}">${escapeHtml(l.name)} (${l.id})</option>`
  ).join('');
}

async function saveMark() {
  clearErr('markErr');
  const assessId = currentMarksAssessmentId;
  const assess = assessments.find(a => a.id === assessId);
  if (!assess) return;
  const learnerId = $('marksLearner').value;
  const markVal = Number($('marksObtained').value);
  if (!learnerId) { showErr('markErr', 'Please select a learner.'); return; }
  if ($('marksObtained').value === '' || isNaN(markVal) || markVal < 0) {
    showErr('markErr', 'Please enter a valid mark.');
    return;
  }
  if (markVal > assess.total) {
    showErr('markErr', `Mark cannot exceed the total of ${assess.total}.`);
    return;
  }

  try {
    await saveMarkRecord(assessId, learnerId, markVal);
    marks[`${assessId}-${learnerId}`] = markVal;
    $('marksObtained').value = '';
    $('marksLearner').value = '';
    renderMarksSummary(assessId);
    renderAssessments();
    renderAnalytics();
    updateGlobalButtons();
    flashSuccess('markSuccess', 'Mark saved.');
  } catch (e) {
    console.error('Error saving mark:', e);
    showErr('markErr', 'Error saving mark: ' + e.message);
  }
}

async function deleteMark(assessId, learnerId) {
  if (!supabaseReady) return;
  try {
    const { error } = await supabaseClient
      .from('marks')
      .delete()
      .eq('assessment_id', assessId)
      .eq('learner_id', learnerId);
    if (error) throw error;
    delete marks[`${assessId}-${learnerId}`];
    renderMarksSummary(assessId);
    renderAssessments();
    renderAnalytics();
    updateGlobalButtons();
  } catch (e) {
    console.error('Error deleting mark:', e);
    alert('Error deleting mark. Please try again.');
  }
}

function renderMarksSummary(assessId) {
  const assess = assessments.find(a => a.id === assessId);
  if (!assess) return;
  const classLearners = getClassLearners();
  const learnersWithMarks = classLearners.filter(l => marks[`${assessId}-${l.id}`] !== undefined).map(l => ({
    ...l,
    mark: marks[`${assessId}-${l.id}`]
  }));
  const markPcts = learnersWithMarks.map(l => (l.mark / assess.total) * 100);
  const avg = markPcts.length ? (markPcts.reduce((a, b) => a + b, 0) / markPcts.length).toFixed(1) : 0;
  const html = learnersWithMarks.map(l => {
    const pct = ((l.mark / assess.total) * 100).toFixed(1);
    const band = bandFor(pct, assess.scale);
    const out3 = scoreOutOf3(l.mark, assess.total);
    return `
      <tr>
        <td>${escapeHtml(l.name)}</td>
        <td>${l.mark} / ${assess.total}</td>
        <td>${pct}%</td>
        <td>${out3} / 3</td>
        <td><span class="grade-pill" style="background:${band.color}">${band.label}</span></td>
        <td><button class="action-btn danger" onclick="deleteMark('${assessId}','${l.id}')">Delete</button></td>
      </tr>
    `;
  }).join('');
  $('marksSummaryWrap').innerHTML = learnersWithMarks.length > 0 ?
    `<div class="table-wrapper"><table><thead><tr><th>Name</th><th>Marks</th><th>%</th><th>Score /3</th><th>Grade</th><th></th></tr></thead><tbody>${html}</tbody></table></div><p style="color:#6B7680;margin-top:10px;">Average: ${avg}%</p>` :
    '<div class="empty-state">No marks entered yet.</div>';

  const hasMarks = learnersWithMarks.length > 0;
  $('downloadAssessmentPdfBtn').disabled = !hasMarks;
  $('printAssessmentBtn').disabled = !hasMarks;
}

// ========== ANALYTICS ==========

function computeOverallScores() {
  const classLearners = getClassLearners();
  const classAssessments = getClassAssessments();
  const results = [];
  classLearners.forEach(l => {
    let weightedSum = 0;
    let weightTotal = 0;
    classAssessments.forEach(a => {
      const m = marks[`${a.id}-${l.id}`];
      if (m !== undefined) {
        const pct = (m / a.total) * 100;
        weightedSum += pct * a.weight;
        weightTotal += a.weight;
      }
    });
    if (weightTotal > 0) {
      results.push({ id: l.id, name: l.name, overall: weightedSum / weightTotal });
    }
  });
  return results;
}

function renderAnalytics() {
  const scores = computeOverallScores();
  const values = scores.map(s => s.overall);
  const count = values.length;
  const avg = count ? values.reduce((a, b) => a + b, 0) / count : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const median = count ? (count % 2 === 1 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2) : 0;
  const high = count ? Math.max(...values) : 0;
  const low = count ? Math.min(...values) : 0;
  const variance = count ? values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / count : 0;
  const stdDev = Math.sqrt(variance);

  $('statCount').textContent = getClassLearners().length;
  $('statAvg').textContent = `${avg.toFixed(1)}%`;
  $('statMedian').textContent = `${median.toFixed(1)}%`;
  $('statHigh').textContent = `${high.toFixed(1)}%`;
  $('statLow').textContent = `${low.toFixed(1)}%`;
  $('statStdDev').textContent = stdDev.toFixed(1);

  renderPerformanceChart(scores);
  renderGradeDistributionChart(scores);

  const hasData = scores.length > 0;
  $('generatePdfReport').disabled = !hasData;
  $('exportAllCsvBtn').disabled = getClassLearners().length === 0;
  $('printReport').disabled = !hasData;
}

function renderPerformanceChart(scores) {
  const ctx = document.getElementById('performanceChart').getContext('2d');
  const labels = scores.map(s => s.name);
  const data = scores.map(s => Number(s.overall.toFixed(1)));
  if (performanceChartInstance) performanceChartInstance.destroy();
  performanceChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Overall %',
        data,
        backgroundColor: NAVY,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 100 } }
    }
  });
}

function renderGradeDistributionChart(scores) {
  const ctx = document.getElementById('gradeDistributionChart').getContext('2d');
  const bands = BANDS.cbc;
  const counts = bands.map(b => 0);
  scores.forEach(s => {
    const band = bandFor(s.overall, 'cbc');
    const idx = bands.findIndex(b => b.label === band.label);
    if (idx >= 0) counts[idx]++;
  });
  if (gradeDistChartInstance) gradeDistChartInstance.destroy();
  gradeDistChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: bands.map(b => b.label),
      datasets: [{
        data: counts,
        backgroundColor: bands.map(b => b.color)
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

function exportAllCsv() {
  const classLearners = getClassLearners();
  const classAssessments = getClassAssessments();
  if (classLearners.length === 0) return;
  const cls = getCurrentClass();
  let header = ['Student ID', 'Full Name', ...classAssessments.map(a => `${a.title} (%)`), 'Overall (%)'];
  let csv = header.join(',') + '\n';
  const scores = computeOverallScores();
  classLearners.forEach(l => {
    const row = [l.id, `"${l.name.replace(/"/g, '""')}"`];
    classAssessments.forEach(a => {
      const m = marks[`${a.id}-${l.id}`];
      row.push(m !== undefined ? ((m / a.total) * 100).toFixed(1) : '');
    });
    const overallEntry = scores.find(s => s.id === l.id);
    row.push(overallEntry ? overallEntry.overall.toFixed(1) : '');
    csv += row.join(',') + '\n';
  });
  downloadFile(csv, `${cls ? cls.code : 'class'}_full_report.csv`, 'text/csv');
}

// ========== PDF GENERATION ==========

function pdfHeader(doc, title, subtitle) {
  doc.setFillColor(27, 42, 74);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(SCHOOL_NAME, 14, 12);
  doc.setFontSize(11);
  doc.text(title, 14, 20);
  if (subtitle) {
    doc.setFontSize(9);
    doc.text(subtitle, 14, 26);
  }
  doc.setTextColor(0, 0, 0);
}

function pdfFooter(doc, className) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const h = doc.internal.pageSize.getHeight();
    const w = doc.internal.pageSize.getWidth();
    doc.setFontSize(8);
    doc.setTextColor(107, 118, 128);
    doc.text(`${SCHOOL_NAME} | ${className || ''}`, 14, h - 8);
    doc.text(`Page ${i} of ${pageCount}`, w - 30, h - 8);
    doc.setTextColor(0, 0, 0);
  }
}

function generateAssessmentPdf(assessId) {
  const assess = assessments.find(a => a.id === assessId);
  if (!assess) return;
  const cls = getCurrentClass();
  const classLearners = getClassLearners();
  const rows = classLearners
    .filter(l => marks[`${assessId}-${l.id}`] !== undefined)
    .map(l => {
      const m = marks[`${assessId}-${l.id}`];
      const pct = ((m / assess.total) * 100).toFixed(1);
      const band = bandFor(pct, assess.scale);
      const out3 = scoreOutOf3(m, assess.total);
      return [l.id, l.name, `${m} / ${assess.total}`, `${pct}%`, `${out3} / 3`, band.label];
    });

  if (rows.length === 0) {
    alert('No marks have been entered for this assessment yet.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  pdfHeader(doc, `${assess.title} — Results`, cls ? `${cls.name} [${cls.code}] | Type: ${assess.type} | Total: ${assess.total} | Weight: ${assess.weight}%` : '');
  doc.autoTable({
    startY: 34,
    head: [['ID', 'Name', 'Score', '%', 'Score /3', 'Grade']],
    body: rows,
    headStyles: { fillColor: [27, 42, 74] },
    alternateRowStyles: { fillColor: [247, 249, 248] },
    styles: { fontSize: 9 }
  });
  pdfFooter(doc, cls ? cls.name : '');
  doc.save(`${cls ? cls.code : 'class'}_${assess.title.replace(/\s+/g, '_')}_results.pdf`);
}

function downloadCurrentAssessmentPdf() {
  if (currentMarksAssessmentId) generateAssessmentPdf(currentMarksAssessmentId);
}

function printCurrentAssessment() {
  if (!currentMarksAssessmentId) return;
  const assess = assessments.find(a => a.id === currentMarksAssessmentId);
  if (!assess) return;
  const content = $('marksSummaryWrap').innerHTML;
  openPrintWindow(`${assess.title} — Results`, content);
}

function printAnalyticsReport() {
  const cls = getCurrentClass();
  const scores = computeOverallScores();
  const rows = scores.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${s.overall.toFixed(1)}%</td><td>${bandFor(s.overall, 'cbc').label}</td></tr>`).join('');
  const content = `
    <p>Learners: ${getClassLearners().length}</p>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
      <thead><tr><th>Name</th><th>Overall %</th><th>Grade</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  openPrintWindow(`${cls ? cls.name : 'Class'} — Analytics Report`, content);
}

function openPrintWindow(title, innerHtml) {
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>${title}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:20px;color:#1A1A1A;}
      h1{color:#1B2A4A;font-size:18px;}
      table{width:100%;border-collapse:collapse;font-size:13px;}
      th,td{border:1px solid #ddd;padding:8px;text-align:left;}
      th{background:#1B2A4A;color:white;}
    </style>
    </head><body><h1>${title}</h1>${innerHtml}</body></html>
  `);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function generateFullPdfReport() {
  const cls = getCurrentClass();
  const classLearners = getClassLearners();
  const classAssessments = getClassAssessments();
  const scores = computeOverallScores();
  if (scores.length === 0) {
    alert('No marks recorded yet for this class.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  pdfHeader(doc, 'Class Performance Report', cls ? `${cls.name} [${cls.code}] | Teacher: ${cls.teacher || '—'}` : '');

  const values = scores.map(s => s.overall);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const median = values.length % 2 === 1 ? sorted[(values.length - 1) / 2] : (sorted[values.length / 2 - 1] + sorted[values.length / 2]) / 2;
  const high = Math.max(...values);
  const low = Math.min(...values);

  doc.setFontSize(10);
  doc.text(`Learners: ${classLearners.length}   Average: ${avg.toFixed(1)}%   Median: ${median.toFixed(1)}%   Highest: ${high.toFixed(1)}%   Lowest: ${low.toFixed(1)}%`, 14, 38);

  const rows = classLearners.map(l => {
    const entry = scores.find(s => s.id === l.id);
    const perAssess = classAssessments.map(a => {
      const m = marks[`${a.id}-${l.id}`];
      return m !== undefined ? `${((m / a.total) * 100).toFixed(0)}%` : '—';
    });
    const overall = entry ? `${entry.overall.toFixed(1)}%` : '—';
    const grade = entry ? bandFor(entry.overall, 'cbc').label : '—';
    return [l.id, l.name, ...perAssess, overall, grade];
  });

  doc.autoTable({
    startY: 44,
    head: [['ID', 'Name', ...classAssessments.map(a => a.title), 'Overall', 'Grade']],
    body: rows,
    headStyles: { fillColor: [27, 42, 74] },
    alternateRowStyles: { fillColor: [247, 249, 248] },
    styles: { fontSize: 8 }
  });
  pdfFooter(doc, cls ? cls.name : '');
  doc.save(`${cls ? cls.code : 'class'}_performance_report.pdf`);
}

// ========== DATA MANAGEMENT (Backup & Restore) ==========

function backupData() {
  const data = {
    classes,
    currentClassId,
    learners,
    assessments,
    marks,
    classCounters,
    individualReports,
    exportedAt: new Date().toISOString()
  };
  downloadFile(JSON.stringify(data, null, 2), `lms_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  flashSuccess('dataMsg', 'Backup downloaded successfully.');
}

async function restoreData(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      
      // Validate the backup file
      if (!data.classes && !data.learners && !data.assessments) {
        throw new Error('Invalid backup file: missing required data structures');
      }

      if (!confirm('This will overwrite ALL existing data in your Supabase database with the backup data. Continue?')) {
        return;
      }

      showCloudStatus('Restoring data from backup...');

      // Clear existing data from Supabase
      await supabaseClient.from('marks').delete().neq('assessment_id', '');
      await supabaseClient.from('individual_reports').delete().neq('learner_id', '');
      await supabaseClient.from('class_counters').delete().neq('class_id', 0);
      await supabaseClient.from('assessments').delete().neq('id', '');
      await supabaseClient.from('learners').delete().neq('id', '');
      await supabaseClient.from('classes').delete().neq('id', 0);

      // Restore classes
      for (const cls of data.classes || []) {
        await saveClass(cls);
      }

      // Restore learners
      for (const learner of data.learners || []) {
        await saveLearner(learner);
      }

      // Restore assessments
      for (const assessment of data.assessments || []) {
        await saveAssessment(assessment);
      }

      // Restore marks
      for (const [key, mark] of Object.entries(data.marks || {})) {
        const [assessmentId, learnerId] = key.split('-');
        await saveMarkRecord(assessmentId, learnerId, mark);
      }

      // Restore class counters
      for (const [classId, lastNumber] of Object.entries(data.classCounters || {})) {
        await saveClassCounter(Number(classId), lastNumber);
      }

      // Restore individual reports
      for (const [learnerId, subjects] of Object.entries(data.individualReports || {})) {
        await saveIndividualReport(learnerId, subjects);
      }

      // Reload all data
      await loadAllData();
      
      // Update UI
      renderClasses();
      renderLearners();
      renderAssessments();
      hideEnterMarksCard();
      renderAnalytics();
      updateGlobalButtons();
      
      showCloudStatus('Data restored successfully from backup.');
      setTimeout(() => showCloudStatus(''), 3000);
      flashSuccess('dataMsg', 'Data restored successfully from backup.');
      
    } catch (err) {
      console.error('Restore error:', err);
      alert('Could not restore from this backup file: ' + err.message);
      showCloudStatus('Restore failed: ' + err.message, true);
    }
  };
  reader.readAsText(file);
}

async function resetAllData() {
  if (!confirm('This will permanently erase ALL classes, learners, assessments, and marks from the cloud database. Continue?')) return;
  if (!confirm('Are you absolutely sure? This cannot be undone.')) return;

  try {
    showCloudStatus('Resetting all data...');
    
    await supabaseClient.from('marks').delete().neq('assessment_id', '');
    await supabaseClient.from('individual_reports').delete().neq('learner_id', '');
    await supabaseClient.from('class_counters').delete().neq('class_id', 0);
    await supabaseClient.from('assessments').delete().neq('id', '');
    await supabaseClient.from('learners').delete().neq('id', '');
    await supabaseClient.from('classes').delete().neq('id', 0);

    classes = [];
    currentClassId = null;
    learners = [];
    assessments = [];
    marks = {};
    classCounters = {};
    individualReports = {};
    currentReportLearnerId = null;
    reportSubjects = [];
    localStorage.removeItem('currentClassId');

    renderClasses();
    renderLearners();
    renderAssessments();
    hideEnterMarksCard();
    renderAnalytics();
    updateGlobalButtons();
    
    showCloudStatus('All data has been reset.');
    setTimeout(() => showCloudStatus(''), 3000);
    flashSuccess('dataMsg', 'All data has been reset.');
  } catch (e) {
    console.error('Error resetting data:', e);
    alert('Error resetting data. Please try again.');
    showCloudStatus('Reset failed: ' + e.message, true);
  }
}

// ========== INDIVIDUAL REPORT GENERATOR ==========

function populateReportLearnerSelect() {
  const sel = $('reportLearnerSelect');
  const list = getClassLearners();
  sel.innerHTML = '<option value="">-- Select a learner --</option>' +
    list.map(l => `<option value="${l.id}" ${l.id === currentReportLearnerId ? 'selected' : ''}>${escapeHtml(l.name)} (${l.id})</option>`).join('');
}

function selectReportLearner(id) {
  currentReportLearnerId = id || null;
  reportSubjects = currentReportLearnerId ? (individualReports[currentReportLearnerId] || []).slice() : [];
  lastIndividualReport = null;
  renderSubjectRows();
  $('individualReportSummaryWrap').innerHTML = '';
  $('downloadIndividualReportPdfBtn').disabled = true;
  $('printIndividualReportBtn').disabled = true;
}

async function saveReportSubjects() {
  if (!currentReportLearnerId) return;
  individualReports[currentReportLearnerId] = reportSubjects;
  try {
    await saveIndividualReport(currentReportLearnerId, reportSubjects);
  } catch (e) {
    console.error('Error saving report subjects:', e);
  }
}

function addSubjectRow() {
  if (!currentReportLearnerId) { alert('Please select a learner first.'); return; }
  reportSubjects.push({
    id: 'sub' + Date.now() + Math.random().toString(36).slice(2, 6),
    name: '', type: 'principal', marks: '', total: 100
  });
  saveReportSubjects();
  renderSubjectRows();
}

function updateSubjectField(rowId, field, value) {
  const row = reportSubjects.find(r => r.id === rowId);
  if (!row) return;
  row[field] = value;
  saveReportSubjects();
}

function removeSubjectRow(rowId) {
  reportSubjects = reportSubjects.filter(r => r.id !== rowId);
  saveReportSubjects();
  renderSubjectRows();
}

function renderSubjectRows() {
  const wrap = $('subjectRowsWrap');
  if (!currentReportLearnerId) {
    wrap.innerHTML = '<div class="empty-state">Select a learner to begin adding subjects.</div>';
    return;
  }
  if (reportSubjects.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No subjects added yet. Click "+ Add Subject" below.</div>';
    return;
  }
  wrap.innerHTML = reportSubjects.map(r => `
    <div class="grid-4" style="align-items:flex-end;margin-bottom:12px;">
      <div>
        <label>Subject</label>
        <input type="text" value="${escapeHtml(r.name)}" placeholder="e.g. History" oninput="updateSubjectField('${r.id}','name', this.value)">
      </div>
      <div>
        <label>Type</label>
        <select onchange="updateSubjectField('${r.id}','type', this.value)">
          <option value="principal" ${r.type === 'principal' ? 'selected' : ''}>Principal Subject</option>
          <option value="subsidiary" ${r.type === 'subsidiary' ? 'selected' : ''}>General Paper / Subsidiary ICT</option>
        </select>
      </div>
      <div>
        <label>Marks obtained</label>
        <input type="number" min="0" value="${r.marks}" oninput="updateSubjectField('${r.id}','marks', this.value)">
      </div>
      <div style="display:flex;gap:8px;">
        <div style="flex:1;">
          <label>Total marks</label>
          <input type="number" min="1" value="${r.total}" oninput="updateSubjectField('${r.id}','total', this.value)">
        </div>
        <button class="btn small danger" onclick="removeSubjectRow('${r.id}')" title="Remove subject">✕</button>
      </div>
    </div>
  `).join('');
}

function generateIndividualReport() {
  if (!currentReportLearnerId) { alert('Please select a learner first.'); return; }
  const learner = learners.find(l => l.id === currentReportLearnerId);
  if (!learner) return;
  const validSubjects = reportSubjects.filter(r =>
    r.name.trim() && r.marks !== '' && !isNaN(Number(r.marks)) && Number(r.total) > 0
  );
  if (validSubjects.length === 0) {
    alert('Please add at least one subject with a name, marks obtained, and total marks.');
    return;
  }

  const results = validSubjects.map(r => ({ ...r, ...computeSubjectGrade(r) }));
  const principals = results.filter(r => r.type === 'principal');
  const principalPoints = principals.reduce((sum, r) => sum + r.point, 0);
  const principalMax = principals.length * 5;

  const rowsHtml = results.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.type === 'principal' ? 'Principal' : 'GP / Subsidiary'}</td>
      <td>${r.marks} / ${r.total}</td>
      <td>${r.pct.toFixed(1)}%</td>
      <td>${r.point !== null ? r.point : '—'}</td>
      <td><span class="grade-pill" style="background:${r.grade === 'F' ? RED : GREEN}">${r.grade}</span></td>
    </tr>
  `).join('');

  $('individualReportSummaryWrap').innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Subject</th><th>Type</th><th>Marks</th><th>%</th><th>Points</th><th>Grade</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p style="color:#6B7680;margin-top:10px;">Total Principal Points: <strong style="color:${NAVY}">${principalPoints} / ${principalMax}</strong></p>
  `;

  lastIndividualReport = { learner, results, principalPoints, principalMax, date: $('reportDate').value };
  $('downloadIndividualReportPdfBtn').disabled = false;
  $('printIndividualReportBtn').disabled = false;
}

function downloadIndividualReportPdf() {
  if (!lastIndividualReport) return;
  const { learner, results, principalPoints, principalMax, date } = lastIndividualReport;
  const cls = getCurrentClass();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  pdfHeader(
    doc,
    'Individual Learner Report',
    `${cls ? `${cls.name} [${cls.code}] | ` : ''}Learner: ${learner.name} (${learner.id})${date ? ' | Date: ' + date : ''}`
  );
  const rows = results.map(r => [
    r.name,
    r.type === 'principal' ? 'Principal' : 'GP/Subsidiary',
    `${r.marks} / ${r.total}`,
    `${r.pct.toFixed(1)}%`,
    r.point !== null ? String(r.point) : '—',
    r.grade
  ]);
  doc.autoTable({
    startY: 34,
    head: [['Subject', 'Type', 'Marks', '%', 'Points', 'Grade']],
    body: rows,
    headStyles: { fillColor: [27, 42, 74] },
    alternateRowStyles: { fillColor: [247, 249, 248] },
    styles: { fontSize: 9 }
  });
  const finalY = (doc.lastAutoTable && doc.lastAutoTable.finalY) || 40;
  doc.setFontSize(10);
  doc.text(`Total Principal Points: ${principalPoints} / ${principalMax}`, 14, finalY + 10);
  pdfFooter(doc, cls ? cls.name : '');
  doc.save(`${learner.id}_${learner.name.replace(/\s+/g, '_')}_individual_report.pdf`);
}

function printIndividualReport() {
  if (!lastIndividualReport) return;
  const { learner } = lastIndividualReport;
  const content = $('individualReportSummaryWrap').innerHTML;
  openPrintWindow(`Individual Report — ${learner.name} (${learner.id})`, content);
}

// ========== TABS ==========

function switchTab(tabName) {
  $$('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  $$('.tab-content').forEach(tc => tc.style.display = 'none');
  $(`tab-${tabName}`).style.display = 'block';
  if (tabName === 'analytics') renderAnalytics();
  if (tabName === 'report') populateReportLearnerSelect();
}

// ========== INITIALIZATION ==========

function attachEventListeners() {
  $('createClassBtn').addEventListener('click', createOrSwitchClass);
  $('existingClassSelect').addEventListener('change', (e) => switchToClassId(e.target.value));
  $('deleteClassBtn').addEventListener('click', deleteCurrentClass);

  $('addLearnerBtn').addEventListener('click', addLearner);
  $('searchBox').addEventListener('input', () => renderLearners());
  $('sortBy').addEventListener('change', () => renderLearners());
  $('editSelectedBtn').addEventListener('click', editSelectedLearner);
  $('deleteSelectedBtn').addEventListener('click', deleteSelectedLearners);
  $('exportLearnersCsvBtn').addEventListener('click', exportLearnersCsv);

  $('closeEditModal').addEventListener('click', closeEditModal);
  $('saveEditBtn').addEventListener('click', saveLearnerEdit);
  $('editModal').addEventListener('click', (e) => { if (e.target.id === 'editModal') closeEditModal(); });

  $('createAssessmentBtn').addEventListener('click', createAssessment);
  $('saveMarkBtn').addEventListener('click', saveMark);
  $('downloadAssessmentPdfBtn').addEventListener('click', downloadCurrentAssessmentPdf);
  $('printAssessmentBtn').addEventListener('click', printCurrentAssessment);

  $('generatePdfReport').addEventListener('click', generateFullPdfReport);
  $('exportAllCsvBtn').addEventListener('click', exportAllCsv);
  $('printReport').addEventListener('click', printAnalyticsReport);

  $('reportLearnerSelect').addEventListener('change', (e) => selectReportLearner(e.target.value));
  $('addSubjectRowBtn').addEventListener('click', addSubjectRow);
  $('generateIndividualReportBtn').addEventListener('click', generateIndividualReport);
  $('downloadIndividualReportPdfBtn').addEventListener('click', downloadIndividualReportPdf);
  $('printIndividualReportBtn').addEventListener('click', printIndividualReport);

  $('backupBtn').addEventListener('click', backupData);
  $('restoreBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) restoreData(e.target.files[0]);
    e.target.value = '';
  });
  $('resetBtn').addEventListener('click', resetAllData);

  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
}

async function init() {
  attachEventListeners();
  const ok = initSupabase();
  if (!ok) {
    renderClasses();
    renderLearners();
    renderAssessments();
    renderAnalytics();
    updateGlobalButtons();
    return;
  }

  const loaded = await loadAllData();
  if (loaded) {
    renderClasses();
    renderLearners();
    renderAssessments();
    renderAnalytics();
    updateGlobalButtons();
  }
}

// Make functions globally accessible for onclick attributes
window.editLearner = editLearner;
window.deleteLearner = deleteLearner;
window.openMarkEntry = openMarkEntry;
window.deleteAssessment = deleteAssessment;
window.deleteMark = deleteMark;
window.addSubjectRow = addSubjectRow;
window.updateSubjectField = updateSubjectField;
window.removeSubjectRow = removeSubjectRow;
window.generateAssessmentPdf = generateAssessmentPdf;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
