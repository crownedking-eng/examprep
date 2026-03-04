// ─────────────────────────────────────────────────────────────────────────────
//  ExamPrep — app.js
//
//  Data is loaded at runtime from:
//    data/manifest.json          → subject list + year file paths
//    data/{subject}/{year}.json  → semester/section/question data
//
//  Raw JSON uses:   question / reference / correctAnswer ("A"–"D") / sectionB[]
//  App internally uses: text / ref / correct (0–3) / sectionB { caseStudy, questions }
//  normaliseYear() converts between the two on load.
// ─────────────────────────────────────────────────────────────────────────────

// ─── RUNTIME STORE ───────────────────────────────────────────────────────────
// Populated after manifest + year files are fetched.
// Shape mirrors the old hardcoded DATA object so all render functions are unchanged.
const DATA = { subjects: [] };

// Cache of already-fetched year payloads keyed by "subjectId/yearId"
const YEAR_CACHE = {};

// ─── THEME ────────────────────────────────────────────────────────────────────
const THEME_KEY = "examprep_theme";

function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  // Update every toggle button currently in the DOM
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.textContent  = theme === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    btn.setAttribute("title",      theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  });
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}

// Apply persisted theme immediately (before first render, avoids flash)
applyTheme(getStoredTheme());



// ─── NORMALISATION ────────────────────────────────────────────────────────────
// Converts one raw JSON file (as parsed object) into the internal format.
//
// Raw → internal field mappings:
//   sectionA item:  question        → text
//   sectionA item:  reference       → ref
//   sectionA item:  correctAnswer   → correct  ("A"/"B"/"C"/"D" → 0/1/2/3)
//   sectionA option: strip "A. " / "B. " prefix
//   sectionB:       array []        → object { caseStudy, questions }
//   sectionB item:  question        → text
//   sectionB answer: reference      → ref
//
function normaliseYear(raw) {
  const letterToIndex = { A: 0, B: 1, C: 2, D: 3 };

  // Strip "A. " / "B. " / "C. " / "D. " prefix from option strings
  function stripPrefix(opt) {
    return String(opt).replace(/^[A-D]\.\s*/i, "");
  }

  // Normalise a single MCQ question object
  function normQuestion(q) {
    return {
      ...q,
      text:    q.question      ?? q.text    ?? "",
      options: (q.options || []).map(stripPrefix),
      correct: q.correctAnswer !== undefined
        ? (letterToIndex[q.correctAnswer.toUpperCase()] ?? 0)
        : (q.correct ?? 0),
      ref: q.reference ?? q.ref ?? "",
      // Remove raw keys so render layer never sees them
      question: undefined, reference: undefined, correctAnswer: undefined,
    };
  }

  // Normalise one sectionA item (single | case-group)
  function normSectionAItem(item) {
    if (item.type === "single")     return normQuestion(item);
    if (item.type === "case-group") return { ...item, questions: (item.questions || []).map(normQuestion) };
    return item;
  }

  // Normalise a single written sub-question entry
  function normSubQuestion(item) {
    return {
      label:       item.label       ?? null,
      text:        item.question    ?? item.text ?? "",
      marks:       item.marks       ?? null,
      commandWord: item.commandWord ?? null,
      answer: {
        introduction:         item.answer?.introduction         ?? "",
        mainPoints:           item.answer?.mainPoints           ?? [],
        conclusion:           item.answer?.conclusion           ?? "",
        otherPossibleAnswers: item.answer?.otherPossibleAnswers ?? null,
        ref:                  item.answer?.reference            ?? item.answer?.ref ?? "",
      },
    };
  }

  // Normalise sectionB.
  //
  // GROUPED format (new):  { format:"grouped", questions:[{ label, totalMarks, caseStudy?, subQuestions:[] }] }
  //   → preserves grouped structure for Q1–Q4 selector + sub-question rendering
  //
  // FLAT / legacy format:  array of { question, marks, caseStudy?, commandWord?, answer }
  //   → { format:"flat", caseStudy, questions:[{ text, marks, … }] }
  //
  function normSectionB(rawB) {
    if (!rawB) return null;

    // Grouped format
    if (!Array.isArray(rawB) && rawB.format === "grouped") {
      return {
        format: "grouped",
        questions: (rawB.questions || []).map((q) => ({
          label:        q.label      ?? "",
          totalMarks:   q.totalMarks ?? null,
          caseStudy:    q.caseStudy  ?? null,
          subQuestions: (q.subQuestions || []).map(normSubQuestion),
        })),
      };
    }

    // Flat / legacy format
    if (Array.isArray(rawB)) {
      return {
        format:    "flat",
        caseStudy: rawB[0]?.caseStudy ?? null,
        questions: rawB.map(normSubQuestion),
      };
    }

    return rawB; // already normalised
  }

  const semesters = (raw.semesters || []).map((sem) => ({
    semester: sem.semester,
    sectionA: (sem.sectionA || []).map(normSectionAItem),
    sectionB: normSectionB(sem.sectionB),
  }));

  return { semesters };
}

// ─── LOADING UI ───────────────────────────────────────────────────────────────
function showLoading(message = "Loading\u2026") {
  document.getElementById("app").innerHTML = `
    <div class="loading-screen">
      <div class="loading-spinner"></div>
      <p class="loading-msg">${message}</p>
    </div>`;
}

function showError(message) {
  document.getElementById("app").innerHTML = `
    <div class="loading-screen">
      <p class="error-icon">\u26a0\ufe0f</p>
      <p class="loading-msg">${message}</p>
      <button class="btn-primary" style="margin-top:20px;max-width:220px"
              onclick="location.reload()">Retry</button>
    </div>`;
}

// ─── DATA LOADING ─────────────────────────────────────────────────────────────

async function loadManifest() {
  const res = await fetch("data/manifest.json");
  if (!res.ok) throw new Error(`Could not load manifest (HTTP ${res.status})`);
  const manifest = await res.json();

  DATA.subjects = manifest.subjects.map((s) => ({
    id:    s.id,
    title: s.title,
    code:  s.code,
    icon:  s.icon,
    years: s.years.map((y) => ({
      id:        y.id,
      label:     y.label,
      file:      y.file,
      semesters: null,   // null = not yet fetched
    })),
  }));
}

async function loadYear(subjectId, yearId) {
  const cacheKey = `${subjectId}/${yearId}`;
  if (YEAR_CACHE[cacheKey]) return;

  const subject = DATA.subjects.find((s) => s.id === subjectId);
  const year    = subject?.years.find((y) => y.id === yearId);
  if (!year) throw new Error(`Year "${yearId}" not found in subject "${subjectId}"`);

  const res = await fetch(`data/${year.file}`);
  if (!res.ok) throw new Error(`Could not load ${year.file} (HTTP ${res.status})`);

  const raw        = await res.json();
  const normalised = normaliseYear(raw);
  year.semesters   = normalised.semesters;
  YEAR_CACHE[cacheKey] = true;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function flattenSectionA(sectionA) {
  const flat = [];
  (sectionA || []).forEach((item) => {
    if (item.type === "single") {
      flat.push({ item, q: item });
    } else if (item.type === "case-group") {
      (item.questions || []).forEach((q) => flat.push({ item, q }));
    }
  });
  return flat;
}

function getSemester() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  if (!year) return null;
  return year.semesters?.[state.semesterIndex ?? 0] ?? null;
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const STATE_KEY     = "examprep_state";
const STATE_VERSION = 3;   // bump whenever state shape changes; wipes stale localStorage

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY));
    if (!raw || raw._v !== STATE_VERSION) return { _v: STATE_VERSION };
    return raw;
  } catch { return { _v: STATE_VERSION }; }
}

function saveState(patch) {
  const s = { ...loadState(), ...patch, _v: STATE_VERSION };
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
  return s;
}

let state = loadState();

// ─── ROUTER ───────────────────────────────────────────────────────────────────
const screens = {
  subjects:          renderSubjects,
  years:             renderYears,
  semesters:         renderSemesters,
  sections:          renderSections,
  mcq:               renderMCQ,
  "written-questions": renderWrittenQuestions,
  written:           renderWritten,
};

function go(screen, patch = {}) {
  state = saveState({ screen, ...patch });
  render();
}

// goYear — fetches year data, then skips the semester selector when there is only one semester
async function goYear(yearId) {
  state = saveState({ screen: "semesters", yearId, semesterIndex: undefined, qIndex: 0 });
  showLoading("Loading exam data\u2026");
  try {
    await loadYear(state.subjectId, yearId);
    const subject = DATA.subjects.find((s) => s.id === state.subjectId);
    const year    = subject?.years.find((y) => y.id === yearId);
    if (year?.semesters?.length === 1) {
      // Only one semester — skip the selector and land directly on sections
      state = saveState({ screen: "sections", semesterIndex: 0 });
    }
    render();
  } catch (e) {
    showError(`Failed to load year data.<br><small>${e.message}</small>`);
  }
}

function render() {
  const fn = screens[state.screen] || renderSubjects;
  document.getElementById("app").innerHTML = fn();
  bindEvents();
}


// ─── THEME TOGGLE HTML ────────────────────────────────────────────────────────
function themeToggleBtn() {
  const theme = document.documentElement.getAttribute("data-theme") || "light";
  const icon  = theme === "dark" ? "☀️" : "🌙";
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return `<button class="theme-toggle" aria-label="${label}" title="${label}">${icon}</button>`;
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
function renderBottomNav() {
  const scr        = state.screen;
  const hasContext = !!(state.subjectId && state.yearId);

  // Resolve the "Current" tab's label and destination
  let currentIcon   = "📚";
  let currentLabel  = "Current";
  let currentTarget = "";          // empty = disabled
  let currentActive = false;

  if (scr === "mcq") {
    currentLabel  = "Section A";
    currentTarget = "sections";
    currentActive = true;
  } else if (scr === "written" || scr === "written-questions") {
    currentLabel  = "Section B";
    currentTarget = "sections";
    currentActive = true;
  } else if (scr === "sections") {
    currentLabel  = "Sections";
    currentTarget = "sections";
    currentActive = true;
  } else if (scr === "semesters") {
    currentLabel  = "Semesters";
    currentTarget = "semesters";
    currentActive = true;
  }

  const homeActive    = scr === "subjects" || scr === "years";
  const currentDisabled = !hasContext || !currentTarget;

  return `
    <nav class="bottom-nav" aria-label="Main navigation">
      <button class="nav-item${homeActive ? " active" : ""}" data-nav="home"
              aria-label="Home">
        <span class="nav-icon" aria-hidden="true">🏠</span>
        <span class="nav-label">Home</span>
      </button>
      <button class="nav-item${currentActive ? " active" : ""}${currentDisabled ? " nav-disabled" : ""}"
              data-nav="current" data-target="${currentTarget}"
              ${currentDisabled ? "disabled" : ""}
              aria-label="${currentLabel}">
        <span class="nav-icon" aria-hidden="true">${currentIcon}</span>
        <span class="nav-label">${currentLabel}</span>
      </button>
      <button class="nav-item nav-disabled" disabled aria-label="Bookmarks (coming soon)">
        <span class="nav-icon" aria-hidden="true">🔖</span>
        <span class="nav-label">Bookmarks</span>
      </button>
      <button class="nav-item nav-disabled" disabled aria-label="Settings (coming soon)">
        <span class="nav-icon" aria-hidden="true">⚙️</span>
        <span class="nav-label">Settings</span>
      </button>
    </nav>`;
}

// ─── SCREENS ──────────────────────────────────────────────────────────────────

function renderSubjects() {
  const cards = DATA.subjects
    .map((s) => `
      <button class="card subject-card" data-subject="${s.id}">
        <span class="card-icon">${s.icon}</span>
        <span class="card-title">${s.title}</span>
        <span class="card-code">${s.code}</span>
      </button>`)
    .join("");

  return `
    <header class="top-bar">
      <div class="logo">ExamPrep</div>
      <div class="tagline">Study smarter. Pass with confidence.</div>
      ${themeToggleBtn()}
    </header>
    <main class="screen">
      <h1 class="screen-title">Choose a Subject</h1>
      <div class="card-grid">${cards}</div>
    </main>
    ${renderBottomNav()}`;
}

function renderYears() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const cards = subject.years
    .map((y) => `
      <button class="card year-card" data-year="${y.id}">
        <span class="card-year-label">${y.label}</span>
        <span class="card-year-sub">Academic Year</span>
      </button>`)
    .join("");

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="subjects">← Back</button>
      <div class="logo">ExamPrep</div>
      ${themeToggleBtn()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title}</p>
      <h1 class="screen-title">Select Academic Year</h1>
      <div class="card-grid">${cards}</div>
    </main>
    ${renderBottomNav()}`;
}

function renderSemesters() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  if (!subject || !year || !year.semesters) return renderSubjects();

  const cards = year.semesters
    .map((sem, i) => `
      <button class="card year-card" data-semester="${i}">
        <span class="card-year-label">${sem.semester}</span>
        <span class="card-year-sub">${year.label}</span>
      </button>`)
    .join("");

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="years">← Back</button>
      <div class="logo">ExamPrep</div>
      ${themeToggleBtn()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label}</p>
      <h1 class="screen-title">Select a Semester</h1>
      <div class="card-grid">${cards}</div>
    </main>
    ${renderBottomNav()}`;
}

function renderSections() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  const sem     = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const totalA = flattenSectionA(sem.sectionA).length;
  // For grouped format, count total sub-questions; for flat, count questions directly
  const sectionB = sem.sectionB;
  const totalB = sectionB?.format === "grouped"
    ? (sectionB.questions || []).reduce((sum, q) => sum + (q.subQuestions?.length ?? 0), 0)
    : (sectionB?.questions?.length ?? 0);
  const totalBParent = sectionB?.format === "grouped" ? (sectionB.questions || []).length : totalB;

  // If this year has only one semester the selector was skipped — go back to years directly
  const backScreen = (year.semesters?.length === 1) ? "years" : "semesters";

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="${backScreen}">← Back</button>
      <div class="logo">ExamPrep</div>
      ${themeToggleBtn()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester}</p>
      <h1 class="screen-title">Select a Section</h1>
      <div class="card-grid">
        <button class="card section-card" data-section="A">
          <span class="section-badge">A</span>
          <span class="card-title">Section A</span>
          <span class="card-sub">Multiple Choice · ${totalA} Questions</span>
        </button>
        <button class="card section-card" data-section="B">
          <span class="section-badge">B</span>
          <span class="card-title">Section B</span>
          <span class="card-sub">Written · ${totalBParent} Question${totalBParent !== 1 ? "s" : ""} · ${totalB} sub-questions</span>
        </button>
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ── MCQ ───────────────────────────────────────────────────────────────────────
function renderMCQ() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  const sem     = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const flat       = flattenSectionA(sem.sectionA);
  const globalIdx  = Math.min(state.qIndex || 0, flat.length - 1);
  const { item, q } = flat[globalIdx];
  const total      = flat.length;
  const answered   = state.selectedOption !== undefined;

  const caseBlock = item.type === "case-group"
    ? `<div class="case-static">
         <div class="case-static-title">📄 ${item.caseStudy.title}</div>
         <div class="case-static-body">${item.caseStudy.fullText
           .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
       </div>`
    : "";

  const opts = (q.options || []).map((opt, i) => {
    let cls = "option-btn";
    if (answered) {
      if (i === q.correct)                               cls += " correct";
      else if (i === state.selectedOption)               cls += " wrong";
      else                                               cls += " dimmed";
    }
    return `<button class="${cls}" data-option="${i}" ${answered ? "disabled" : ""}>${opt}</button>`;
  }).join("");

  const feedback = answered
    ? `<div class="feedback-box">
         <div class="feedback-label">${state.selectedOption === q.correct ? "✅ Correct!" : "❌ Incorrect"}</div>
         <p class="feedback-exp">${q.explanation ?? ""}</p>
         <p class="feedback-ref">📖 ${q.ref ?? ""}</p>
       </div>`
    : "";

  const nextLabel = globalIdx + 1 < total ? "Next Question \u2192" : "Finish";

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="sections">← Back</button>
      <div class="logo">ExamPrep</div>
      ${themeToggleBtn()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Section A</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((globalIdx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${globalIdx + 1} of ${total}</p>
      ${caseBlock}
      <div class="card question-card">
        <p class="q-text">${q.text ?? ""}</p>
        <div class="options-grid">${opts}</div>
        ${feedback}
        ${answered ? `<button class="btn-primary next-btn">${nextLabel}</button>` : ""}
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ── WRITTEN QUESTION SELECTOR (grouped format: Q1–Q4 picker) ─────────────────
function renderWrittenQuestions() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  const sem     = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const grouped = sem.sectionB?.questions ?? [];

  const cards = grouped.map((q, i) => {
    const subCount = q.subQuestions?.length ?? 0;
    const hasCase  = !!q.caseStudy;
    return `
      <button class="card section-card written-q-card" data-written-q="${i}">
        <span class="section-icon">📝</span>
        <span class="section-label">${q.label}</span>
        <span class="section-sub">${subCount} sub-question${subCount !== 1 ? "s" : ""}${hasCase ? " · Case study" : ""}${q.totalMarks ? " · " + q.totalMarks + " marks" : ""}</span>
      </button>`;
  }).join("");

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="sections">← Back</button>
      <div class="logo">ExamPrep</div>
      ${themeToggleBtn()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Section B</p>
      <h2 class="screen-title">Section B — Written Questions</h2>
      <p class="screen-sub">Select a question to begin</p>
      <div class="card-grid">${cards}</div>
    </main>
    ${renderBottomNav()}`;
}

// ── WRITTEN (sub-question view) ───────────────────────────────────────────────
function renderWritten() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  const sem     = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const sectionB   = sem.sectionB;
  const isGrouped  = sectionB?.format === "grouped";
  const showAnswer = state.answerRevealed;
  const rating     = state.selfRating;

  let q, cs, backScreen, backLabel, subQuestions, subQIdx, parentLabel, totalSubs;

  if (isGrouped) {
    // Grouped: state.qIndex = parent question index, state.subQIndex = sub-question index
    const parentIdx = state.qIndex ?? 0;
    const parent    = sectionB.questions[parentIdx];
    subQuestions    = parent?.subQuestions ?? [];
    subQIdx         = Math.min(state.subQIndex ?? 0, subQuestions.length - 1);
    q               = subQuestions[subQIdx];
    cs              = parent?.caseStudy ?? null;
    backScreen      = "written-questions";
    backLabel       = "← Back to Questions";
    parentLabel     = parent?.label ?? "";
    totalSubs       = subQuestions.length;
  } else {
    // Flat/legacy: state.qIndex = question index
    const questions = sectionB?.questions ?? [];
    subQIdx         = Math.min(state.qIndex ?? 0, questions.length - 1);
    q               = questions[subQIdx];
    cs              = sectionB?.caseStudy ?? null;
    backScreen      = "sections";
    backLabel       = "← Back";
    totalSubs       = questions.length;
  }

  const caseBlock = cs
    ? `<details class="case-study-details" ${state.caseOpen ? "open" : ""}>
         <summary class="case-summary">📄 ${cs.title}</summary>
         <div class="case-body">${cs.fullText
           .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
       </details>`
    : "";

  const keyFactsBlock = cs?.keyFacts?.length
    ? `<details class="case-study-details keyfacts-details" ${state.keyFactsOpen ? "open" : ""}>
         <summary class="case-summary keyfacts-summary">🔑 Key Facts (Exam-Relevant Extracts)</summary>
         <ul class="keyfacts-list">
           ${cs.keyFacts.map((f) => `<li>${f}</li>`).join("")}
         </ul>
       </details>`
    : "";

  // Sub-question tab strip (shows a, b, c, d… tabs when in grouped mode)
  const tabStrip = isGrouped && totalSubs > 1
    ? `<div class="sub-q-tabs">
        ${subQuestions.map((sq, i) => `
          <button class="sub-q-tab ${i === subQIdx ? "active" : ""}" data-subq="${i}">
            ${sq.label ? sq.label.toUpperCase() : i + 1}
          </button>`).join("")}
       </div>`
    : "";

  const mainPts = (q?.answer?.mainPoints ?? []).map((p) => `
    <div class="answer-point">
      <strong>${p.heading}</strong>
      <p>${p.detail}</p>
    </div>`).join("");

  const otherAnswers = q?.answer?.otherPossibleAnswers && q.answer.otherPossibleAnswers !== "N/A"
    ? `<div class="answer-section other-answers">
         <h4>Other Possible Answers</h4>
         <p>${q.answer.otherPossibleAnswers}</p>
       </div>`
    : "";

  const answerBlock = showAnswer
    ? `<div class="answer-block">
        ${q?.commandWord
          ? `<p class="command-word-label">Command Word: <strong>${q.commandWord}</strong></p>` : ""}
        ${q?.answer?.introduction
          ? `<div class="answer-section"><h4>Introduction</h4><p>${q.answer.introduction}</p></div>` : ""}
        <div class="answer-section"><h4>Main Points</h4>${mainPts}</div>
        ${q?.answer?.conclusion
          ? `<div class="answer-section"><h4>Conclusion</h4><p>${q.answer.conclusion}</p></div>` : ""}
        ${otherAnswers}
        ${q?.answer?.ref
          ? `<p class="feedback-ref">📖 ${q.answer.ref}</p>` : ""}
        <div class="rating-area">
          <p class="rating-prompt">How well did you know this?</p>
          <div class="rating-btns">
            <button class="rating-btn ${rating === "confident" ? "active-confident" : ""}" data-rating="confident">✅ Confident</button>
            <button class="rating-btn ${rating === "almost"    ? "active-almost"    : ""}" data-rating="almost">🟡 Almost</button>
            <button class="rating-btn ${rating === "revise"    ? "active-revise"    : ""}" data-rating="revise">🔴 Revise</button>
          </div>
        </div>
      </div>`
    : "";

  const breadcrumbSuffix = isGrouped && parentLabel ? ` · ${parentLabel}` : "";

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="${backScreen}">${backLabel}</button>
      <div class="logo">ExamPrep</div>
      ${themeToggleBtn()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Section B${breadcrumbSuffix}</p>
      ${caseBlock}
      ${keyFactsBlock}
      ${tabStrip}
      <div class="card question-card">
        <div class="q-marks-row">
          <span class="q-marks">[${q?.marks ?? "?"} marks]</span>
        </div>
        <p class="q-text">${q?.text ?? ""}</p>
        ${!showAnswer ? `<button class="btn-primary reveal-btn">Reveal Structured Answer</button>` : ""}
        ${answerBlock}
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function bindEvents() {
  const app = document.getElementById("app");

  // Theme toggle
  app.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", toggleTheme);
  });

  // Bottom nav
  app.querySelectorAll("[data-nav]").forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener("click", () => {
      const nav    = btn.dataset.nav;
      const target = btn.dataset.target;
      if (nav === "home") {
        go("subjects");
      } else if (nav === "current" && target) {
        go(target);
      }
    });
  });

  // Subject select
  app.querySelectorAll("[data-subject]").forEach((el) => {
    el.addEventListener("click", () =>
      go("years", { subjectId: el.dataset.subject, yearId: undefined, qIndex: 0 })
    );
  });

  // Year select — async: fetch then navigate
  app.querySelectorAll("[data-year]").forEach((el) => {
    el.addEventListener("click", () => goYear(el.dataset.year));
  });

  // Semester select
  app.querySelectorAll("[data-semester]").forEach((el) => {
    el.addEventListener("click", () =>
      go("sections", { semesterIndex: parseInt(el.dataset.semester), qIndex: 0 })
    );
  });

  // Section select
  app.querySelectorAll("[data-section]").forEach((el) => {
    el.addEventListener("click", () => {
      const section = el.dataset.section;
      if (section === "A") {
        go("mcq", { section, qIndex: 0, selectedOption: undefined });
        return;
      }
      // Section B: go to question selector if grouped, otherwise straight to written
      const sem = getSemester();
      const isGrouped = sem?.sectionB?.format === "grouped";
      go(isGrouped ? "written-questions" : "written", {
        section,
        qIndex: 0,
        subQIndex: 0,
        selectedOption: undefined,
        answerRevealed: false,
        selfRating: undefined,
        caseOpen: false,
        keyFactsOpen: false,
      });
    });
  });

  // Back buttons
  app.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => go(el.dataset.goto));
  });

  // Written question selector cards (grouped format: Q1, Q2, Q3, Q4)
  app.querySelectorAll("[data-written-q]").forEach((el) => {
    el.addEventListener("click", () => {
      go("written", {
        qIndex:        parseInt(el.dataset.writtenQ),
        subQIndex:     0,
        answerRevealed: false,
        selfRating:    undefined,
        caseOpen:      false,
        keyFactsOpen:  false,
      });
    });
  });

  // Sub-question tabs (a, b, c, d…)
  app.querySelectorAll("[data-subq]").forEach((el) => {
    el.addEventListener("click", () => {
      go("written", {
        subQIndex:     parseInt(el.dataset.subq),
        answerRevealed: false,
        selfRating:    undefined,
        caseOpen:      state.caseOpen,
        keyFactsOpen:  state.keyFactsOpen,
      });
    });
  });

  // MCQ option select
  app.querySelectorAll("[data-option]").forEach((el) => {
    el.addEventListener("click", () => {
      state = saveState({ selectedOption: parseInt(el.dataset.option) });
      render();
    });
  });

  // MCQ next / finish
  const nextBtn = app.querySelector(".next-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const flat    = flattenSectionA(getSemester()?.sectionA);
      const nextIdx = (state.qIndex || 0) + 1;
      if (nextIdx < flat.length) {
        go("mcq", { qIndex: nextIdx, selectedOption: undefined });
      } else {
        go("sections");
      }
    });
  }

  // Reveal answer (Section B)
  const revealBtn = app.querySelector(".reveal-btn");
  if (revealBtn) {
    revealBtn.addEventListener("click", () => {
      state = saveState({ answerRevealed: true });
      render();
    });
  }

  // Self-rating
  app.querySelectorAll("[data-rating]").forEach((el) => {
    el.addEventListener("click", () => {
      state = saveState({ selfRating: el.dataset.rating });
      render();
    });
  });

  // Case study toggle
  const caseDetails = app.querySelector(".case-study-details:not(.keyfacts-details)");
  if (caseDetails) {
    caseDetails.addEventListener("toggle", () => {
      state = saveState({ caseOpen: caseDetails.open });
    });
  }

  // Key facts toggle
  const keyFactsDetails = app.querySelector(".keyfacts-details");
  if (keyFactsDetails) {
    keyFactsDetails.addEventListener("toggle", () => {
      state = saveState({ keyFactsOpen: keyFactsDetails.open });
    });
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  showLoading("Starting up\u2026");

  try {
    await loadManifest();
  } catch (e) {
    showError(
      `Could not load subject list.<br><small>${e.message}</small><br><br>` +
      `<small>If running locally, serve via a local server (e.g. <code>npx serve .</code>) ` +
      `rather than opening index.html directly.</small>`
    );
    return;
  }

  // Restore year data if state references one
  if (state.subjectId && state.yearId) {
    try {
      await loadYear(state.subjectId, state.yearId);
    } catch {
      // Year file missing or renamed — reset to subjects gracefully
      state = saveState({ screen: "subjects", yearId: undefined, semesterIndex: undefined });
    }
  }

  if (!state.screen) state = saveState({ screen: "subjects" });

  // Guard: if state restored into "written" but current year uses grouped Section B,
  // redirect to the question selector so the user doesn't land mid-session incorrectly.
  if (state.screen === "written" || state.screen === "written-questions") {
    const subj = DATA.subjects.find((s) => s.id === state.subjectId);
    const yr   = subj?.years.find((y) => y.id === state.yearId);
    const sem  = yr?.semesters?.[state.semesterIndex ?? 0];
    const isGrouped = sem?.sectionB?.format === "grouped";
    if (isGrouped && state.screen !== "written-questions" && state.qIndex === undefined) {
      state = saveState({ screen: "written-questions" });
    }
  }

  render();
});
