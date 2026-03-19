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
const STATE_VERSION = 5;   // bump whenever state shape changes; wipes stale localStorage

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
  mcqScore:          renderMCQScore,
  mcqReview:         renderMCQReview,
  "written-questions":   renderWrittenQuestions,
  written:              renderWritten,
  practiceConfig:       renderPracticeConfig,
  practiceSession:      renderPracticeSession,
  practiceScore:        renderPracticeScore,
  practiceReview:       renderPracticeReview,
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


// ─── TOP-BAR RIGHT BUTTONS ───────────────────────────────────────────────────
function themeToggleBtn() {
  const theme = document.documentElement.getAttribute("data-theme") || "light";
  const icon  = theme === "dark" ? "☀️" : "🌙";
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return `<button class="theme-toggle" aria-label="${label}" title="${label}">${icon}</button>`;
}

// Returns the cluster of icon buttons that sit at the right end of every top-bar.
// showSearch — pass false on screens where no subject is loaded yet.
function topBarRight(showSearch) {
  const searchBtn = (showSearch !== false && state.subjectId)
    ? `<button class="search-icon-btn" id="open-search-btn" aria-label="Search questions" title="Search questions">🔍</button>`
    : "";
  return `<div class="top-bar-right">${searchBtn}${themeToggleBtn()}</div>`;
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

  if (scr === "mcq" || scr === "mcqScore" || scr === "mcqReview") {
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
  } else if (scr === "practiceConfig" || scr === "practiceSession" || scr === "practiceScore" || scr === "practiceReview") {
    currentLabel  = "Practice";
    currentTarget = "practiceConfig";
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

// ─── MCQ SESSION HELPERS ─────────────────────────────────────────────────────

// Called when the user selects an option in the live quiz.
// Records the answer into state.mcqAnswers[].
function recordMCQAnswer(globalIdx, selected, isCorrect) {
  const answers = [...(state.mcqAnswers ?? [])];
  answers[globalIdx] = { qIndex: globalIdx, selected, correct: isCorrect };
  state = saveState({ mcqAnswers: answers, mcqSessionActive: true });
}

// Calculate score object from state.mcqAnswers and total question count.
function calcScore(answers, total) {
  const correct    = (answers ?? []).filter((a) => a?.correct).length;
  const answered   = (answers ?? []).filter((a) => a !== undefined).length;
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { correct, total, answered, percentage };
}

// Start a fresh MCQ session (Retry or first start).
function startMCQSession() {
  state = saveState({
    screen:           "mcq",
    qIndex:           0,
    selectedOption:   undefined,
    mcqAnswers:       [],
    mcqSessionActive: true,
    mcqCompleted:     false,
    mcqScore:         null,
  });
  render();
}

// Finish the quiz: compute score, persist, go to score screen.
function finishMCQSession() {
  const sem   = getSemester();
  const flat  = flattenSectionA(sem?.sectionA);
  const score = calcScore(state.mcqAnswers, flat.length);
  state = saveState({
    screen:           "mcqScore",
    mcqSessionActive: false,
    mcqCompleted:     true,
    mcqScore:         score,
    selectedOption:   undefined,
  });
  render();
}

// ─── CONFIRMATION DIALOG ──────────────────────────────────────────────────────
// Injects a modal overlay into #app without re-rendering the whole page.
// onConfirm is called when the user clicks "Leave".
function showConfirmDialog(message, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-dialog" role="alertdialog" aria-modal="true"
         aria-labelledby="confirm-msg">
      <p id="confirm-msg" class="confirm-message">${message}</p>
      <div class="confirm-actions">
        <button class="btn-secondary confirm-stay" style="flex:1">Stay</button>
        <button class="btn-danger confirm-leave" style="flex:1">Leave</button>
      </div>
    </div>`;

  document.getElementById("app").appendChild(overlay);

  overlay.querySelector(".confirm-stay").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".confirm-leave").addEventListener("click", () => {
    overlay.remove();
    onConfirm();
  });
  // Dismiss on backdrop click
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  // Trap focus on Stay by default
  overlay.querySelector(".confirm-stay").focus();
}

// Guard helper — if a session is active, show the confirm dialog;
// otherwise call proceed() immediately.
function guardMCQLeave(proceed) {
  if (state.mcqSessionActive) {
    showConfirmDialog(
      "You have an ongoing quiz. Are you sure you want to leave?<br>Your progress will be lost.",
      () => {
        state = saveState({ mcqSessionActive: false, mcqAnswers: [], mcqScore: null });
        proceed();
      }
    );
  } else {
    proceed();
  }
}

// ─── PRACTICE & SEARCH HELPERS ──────────────────────────────────────────────

// Fisher-Yates shuffle (returns a new array).
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Collect every MCQ question from every loaded year of a subject.
// Each item: { q, item, yearLabel, semesterLabel, yearId, semesterIdx }
function buildMCQPool(subjectId) {
  const subject = DATA.subjects.find((s) => s.id === subjectId);
  if (!subject) return [];
  const pool = [];
  for (const year of subject.years) {
    if (!year.semesters) continue;
    year.semesters.forEach((sem, si) => {
      flattenSectionA(sem.sectionA).forEach(({ item, q }) => {
        pool.push({ q, item, yearLabel: year.label, semesterLabel: sem.semester, yearId: year.id, semesterIdx: si });
      });
    });
  }
  return pool;
}

// Collect every written sub-question from every loaded year of a subject.
// Each item: { q, parentLabel, caseStudy, yearLabel, semesterLabel, yearId, semesterIdx }
function buildWrittenPool(subjectId) {
  const subject = DATA.subjects.find((s) => s.id === subjectId);
  if (!subject) return [];
  const pool = [];
  for (const year of subject.years) {
    if (!year.semesters) continue;
    year.semesters.forEach((sem, si) => {
      const sB = sem.sectionB;
      if (!sB) return;
      if (sB.format === "grouped") {
        sB.questions.forEach((parent) => {
          (parent.subQuestions || []).forEach((q) => {
            pool.push({ q, parentLabel: parent.label, caseStudy: parent.caseStudy ?? null,
              yearLabel: year.label, semesterLabel: sem.semester, yearId: year.id, semesterIdx: si });
          });
        });
      } else {
        (sB.questions || []).forEach((q) => {
          pool.push({ q, parentLabel: null, caseStudy: sB.caseStudy ?? null,
            yearLabel: year.label, semesterLabel: sem.semester, yearId: year.id, semesterIdx: si });
        });
      }
    });
  }
  return pool;
}

// Search across all loaded MCQ + written questions for a subject.
// Returns array of { type:"mcq"|"written", entry, score } sorted by relevance.
// Load ALL year files for a subject (for practice mode or search).
// Shows a loading UI; calls onDone() when complete.
async function loadAllYears(subjectId, onDone) {
  const subject = DATA.subjects.find((s) => s.id === subjectId);
  if (!subject) { onDone(); return; }
  showLoading("Loading all exam data\u2026");
  try {
    await Promise.all(subject.years.map((y) => loadYear(subjectId, y.id)));
    onDone();
  } catch (e) {
    showError(`Failed to load data.<br><small>${e.message}</small>`);
  }
}

// ─── SEARCH HELPERS ─────────────────────────────────────────────────────────
// Searches all *already-loaded* year data for the current subject.
// Returns [{type, entry, score}] sorted by relevance, highest first.
function searchQuestions(subjectId, query) {
  const raw = (query || "").trim();
  if (!raw) return [];
  const normalized = raw.toLowerCase();
  const terms = normalized.split(/\s+/).filter((t) => t.length >= 1);
  if (!terms.length) return [];

  function scoreField(text, weight) {
    if (!text) return 0;
    const t = text.toLowerCase();
    let sc = 0;
    if (t.includes(normalized)) sc += 100;           // exact phrase bonus
    for (const term of terms) {
      const re = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (re.test(t)) sc += 10;                      // word-boundary match
      else if (t.includes(term)) sc += 2;            // substring match
    }
    return sc * weight;
  }

  const results = [];
  buildMCQPool(subjectId).forEach((entry) => {
    const sc = scoreField(entry.q.text, 3) + scoreField(entry.q.ref, 1) + scoreField(entry.q.explanation, 1);
    if (sc > 0) results.push({ type: "mcq", entry, score: sc });
  });
  buildWrittenPool(subjectId).forEach((entry) => {
    const sc = scoreField(entry.q.text, 3) + scoreField(entry.q.answer?.introduction, 1)
             + scoreField(entry.q.answer?.ref, 1) + scoreField(entry.parentLabel, 1);
    if (sc > 0) results.push({ type: "written", entry, score: sc });
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ─── SEARCH OVERLAY ──────────────────────────────────────────────────────────
// Injects a full-screen search overlay into #app without touching any screen.
// All DOM updates happen in-place — render() is NEVER called during typing.
// On open, all year data for the current subject is loaded silently so that
// every question is searchable regardless of which screen the user is on.
function showSearchOverlay() {
  // Remove any existing overlay first
  document.getElementById("search-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "search-overlay";
  overlay.className = "search-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Search questions");
  overlay.innerHTML = `
    <div class="search-panel">
      <div class="search-panel-header">
        <div class="search-input-wrap">
          <span class="search-input-icon" aria-hidden="true">🔍</span>
          <input class="search-panel-input" id="search-panel-input"
                 type="search" placeholder="Search questions…"
                 autocomplete="off" spellcheck="false" disabled />
        </div>
        <button class="search-close-btn" aria-label="Close search">✕</button>
      </div>
      <div class="search-panel-meta" id="search-meta">Loading exam data…</div>
      <div class="search-panel-results" id="search-results"></div>
    </div>`;

  document.getElementById("app").appendChild(overlay);

  const input    = overlay.querySelector("#search-panel-input");
  const meta     = overlay.querySelector("#search-meta");
  const results  = overlay.querySelector("#search-results");
  const closeBtn = overlay.querySelector(".search-close-btn");

  function closeOverlay() { overlay.remove(); }

  // Close on backdrop click
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
  closeBtn.addEventListener("click", closeOverlay);
  // Close on Escape
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });

  // Build and inject result HTML, bind click handlers — never calls render()
  function updateResults(query) {
    const MAX  = 50;
    const hits = query.length >= 1 ? searchQuestions(state.subjectId, query) : [];
    const shown = hits.slice(0, MAX);

    // Meta line
    if (!query) {
      meta.textContent = "Type to search across all exam questions.";
    } else if (!hits.length) {
      meta.innerHTML = `No results for \u201c<strong>${query}</strong>\u201d`;
    } else if (hits.length > MAX) {
      meta.textContent = `Showing top ${MAX} of ${hits.length} results`;
    } else {
      meta.textContent = `${hits.length} result${hits.length !== 1 ? "s" : ""}`;
    }

    // Result rows
    results.innerHTML = shown.map(({ type, entry }) => {
      const text  = (entry.q?.text ?? "").slice(0, 140);
      const trail = (entry.q?.text?.length ?? 0) > 140 ? "\u2026" : "";
      const badge = type === "mcq"
        ? `<span class="sr-type-badge sr-badge-mcq">MCQ</span>`
        : `<span class="sr-type-badge sr-badge-written">Written</span>`;
      return `
        <div class="sr-item" data-sr-type="${type}"
             data-sr-year="${entry.yearId}" data-sr-sem="${entry.semesterIdx}"
             tabindex="0" role="button">
          <div class="sr-item-top">${badge}<span class="sr-meta">${entry.yearLabel} \u00b7 ${entry.semesterLabel}</span></div>
          <p class="sr-text">${text}${trail}</p>
        </div>`;
    }).join("");

    // Bind click + keyboard on each result row
    results.querySelectorAll(".sr-item").forEach((el) => {
      const activate = async () => {
        const yearId = el.dataset.srYear;
        const semIdx = parseInt(el.dataset.srSem);
        const type   = el.dataset.srType;
        if (!yearId) return;
        closeOverlay();
        showLoading("Loading\u2026");
        try {
          await loadYear(state.subjectId, yearId);
          const patch = {
            yearId,
            semesterIndex:    semIdx,
            qIndex:           0,
            subQIndex:        0,
            selectedOption:   undefined,
            answerRevealed:   false,
            mcqAnswers:       [],
            mcqSessionActive: type === "mcq",
            mcqCompleted:     false,
            mcqScore:         null,
          };
          if (type === "mcq") {
            go("mcq", patch);
          } else {
            const subj = DATA.subjects.find((s) => s.id === state.subjectId);
            const yr   = subj?.years.find((y) => y.id === yearId);
            const sem  = yr?.semesters?.[semIdx];
            go(sem?.sectionB?.format === "grouped" ? "written-questions" : "written", patch);
          }
        } catch (e) {
          showError(`Failed to load.<br><small>${e.message}</small>`);
        }
      };
      el.addEventListener("click", activate);
      el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") activate(); });
    });
  }

  // Debounced input handler
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => updateResults(input.value.trim()), 200);
  });

  // Load all year data for the subject, then enable the input and focus it.
  // loadAllYears uses YEAR_CACHE so already-fetched years cost nothing.
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) {
    // No subject selected — shouldn't normally happen since the button is
    // hidden on the subjects screen, but handle it gracefully.
    meta.textContent = "Select a subject first to search its questions.";
    input.disabled = false;
    requestAnimationFrame(() => input.focus());
    return;
  }

  // Use Promise.all directly (same logic as loadAllYears but without the
  // full-page loading overlay, since the search panel is already showing).
  Promise.all(subject.years.map((y) => loadYear(subject.id, y.id)))
    .then(() => {
      input.disabled = false;
      input.placeholder = "Search questions…";
      // If the overlay was closed before loading finished, do nothing.
      if (!document.getElementById("search-overlay")) return;
      updateResults("");
      requestAnimationFrame(() => { input.focus(); });
    })
    .catch((err) => {
      if (!document.getElementById("search-overlay")) return;
      meta.textContent = `Could not load data: ${err.message}`;
    });
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
      ${topBarRight(false)}
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
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title}</p>
      <h1 class="screen-title">Select Academic Year</h1>
      <div class="card-grid">
        ${cards}
        <button class="card practice-mode-card" data-action="go-practice">
          <span class="card-icon">🎯</span>
          <span class="card-title">Practice Mode</span>
          <span class="card-code">All Years · Random Questions</span>
        </button>
      </div>
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
      ${topBarRight()}
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
      ${topBarRight()}
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

  const flat      = flattenSectionA(sem.sectionA);
  const globalIdx = Math.min(state.qIndex || 0, flat.length - 1);
  const { item, q } = flat[globalIdx];
  const total     = flat.length;
  const answered  = state.selectedOption !== undefined;

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
      if (i === q.correct)               cls += " correct";
      else if (i === state.selectedOption) cls += " wrong";
      else                               cls += " dimmed";
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

  const isLast    = globalIdx + 1 >= total;
  const nextLabel = isLast ? "Finish \u2714" : "Next Question \u2192";
  const answeredCount = (state.mcqAnswers ?? []).filter((a) => a !== undefined).length;

  return `
    <header class="top-bar">
      <button class="back-btn mcq-guard-back" data-goto="sections">\u2190 Back</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} \u00b7 ${year.label} \u00b7 ${sem.semester} \u00b7 Section A</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((globalIdx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${globalIdx + 1} of ${total}
        ${answeredCount > 0 ? `<span class="q-answered-badge">${answeredCount} answered</span>` : ""}
      </p>
      ${caseBlock}
      <div class="card question-card">
        <p class="q-text">${q.text ?? ""}</p>
        <div class="options-grid">${opts}</div>
        ${feedback}
        ${answered ? `<button class="btn-primary next-btn" data-is-last="${isLast}">${nextLabel}</button>` : ""}
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ── MCQ SCORE SCREEN ──────────────────────────────────────────────────────────
function renderMCQScore() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  const sem     = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const flat  = flattenSectionA(sem.sectionA);
  const score = state.mcqScore ?? calcScore(state.mcqAnswers, flat.length);
  const pct   = score.percentage;

  const tier =
    pct >= 80 ? { emoji: "\uD83C\uDFC6", cls: "score-tier-gold",  label: "Excellent!"      } :
    pct >= 60 ? { emoji: "\u2705",       cls: "score-tier-green", label: "Good job!"        } :
    pct >= 40 ? { emoji: "\uD83D\uDCDA", cls: "score-tier-amber", label: "Keep studying"    } :
                { emoji: "\uD83D\uDCAA", cls: "score-tier-red",   label: "Don\u2019t give up!" };

  const reviewRows = flat.map(({ q }, i) => {
    const ans  = (state.mcqAnswers ?? [])[i];
    const isOk = ans?.correct ?? false;
    const icon = ans === undefined ? "\u25CB" : (isOk ? "\u2705" : "\u274C");
    const cls  = ans === undefined ? "skipped" : (isOk ? "correct" : "incorrect");
    const text = (q.text ?? "").length > 72 ? q.text.slice(0, 69) + "\u2026" : (q.text ?? "");
    return `
      <div class="question-review-item" data-review-jump="${i}">
        <div class="question-indicator ${cls}">${icon}</div>
        <span class="review-q-text">${i + 1}. ${text}</span>
      </div>`;
  }).join("");

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="sections">\u2190 Done</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} \u00b7 ${year.label} \u00b7 ${sem.semester} \u00b7 Section A</p>
      <div class="score-card ${tier.cls}">
        <div class="score-emoji">${tier.emoji}</div>
        <div class="score-number">${score.correct}<span class="score-denom">/${score.total}</span></div>
        <div class="score-percentage">${pct}%</div>
        <div class="score-label">${tier.label}</div>
      </div>
      <div class="score-actions">
        <button class="btn-primary" id="btn-review-answers">\uD83D\uDCCB Review Answers</button>
        <button class="btn-secondary" id="btn-retry-section">\uD83D\uDD04 Retry Section</button>
      </div>
      <h3 class="review-list-title">Question Breakdown</h3>
      <div class="question-review-list">${reviewRows}</div>
    </main>
    ${renderBottomNav()}`;
}

// ── MCQ REVIEW SCREEN ─────────────────────────────────────────────────────────
function renderMCQReview() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year    = subject?.years.find((y) => y.id === state.yearId);
  const sem     = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const flat      = flattenSectionA(sem.sectionA);
  const globalIdx = Math.min(state.qIndex || 0, flat.length - 1);
  const { item, q } = flat[globalIdx];
  const total     = flat.length;
  const ans       = (state.mcqAnswers ?? [])[globalIdx];
  const selected  = ans?.selected;
  const isCorrect = ans?.correct ?? false;

  const caseBlock = item.type === "case-group"
    ? `<div class="case-static">
         <div class="case-static-title">📄 ${item.caseStudy.title}</div>
         <div class="case-static-body">${item.caseStudy.fullText
           .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
       </div>`
    : "";

  const opts = (q.options || []).map((opt, i) => {
    let cls = "option-btn";
    if (i === q.correct)     cls += " correct";
    else if (i === selected) cls += " wrong";
    else                     cls += " dimmed";
    return `<button class="${cls}" disabled>${opt}</button>`;
  }).join("");

  const feedback = `
    <div class="feedback-box">
      <div class="feedback-label">${isCorrect ? "\u2705 You got this right" : "\u274C You got this wrong"}</div>
      <p class="feedback-exp">${q.explanation ?? ""}</p>
      <p class="feedback-ref">\uD83D\uDCDA ${q.ref ?? ""}</p>
    </div>`;

  const hasPrev = globalIdx > 0;
  const hasNext = globalIdx + 1 < total;

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="mcqScore">\u2190 Score</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} \u00b7 ${year.label} \u00b7 ${sem.semester} \u00b7 Section A \u00b7 Review</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((globalIdx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${globalIdx + 1} of ${total}
        <span class="review-mode-badge">Review</span>
      </p>
      ${caseBlock}
      <div class="card question-card">
        <p class="q-text">${q.text ?? ""}</p>
        <div class="options-grid">${opts}</div>
        ${feedback}
        <div class="review-nav">
          <button class="btn-secondary review-prev-btn" ${hasPrev ? "" : "disabled"}>\u2190 Prev</button>
          <button class="btn-primary  review-next-btn"  ${hasNext ? "" : "disabled"}>Next \u2192</button>
        </div>
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
      ${topBarRight()}
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
      ${topBarRight()}
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


// ─── PRACTICE MODE SCREENS ───────────────────────────────────────────────────

function renderPracticeConfig() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const cfg      = state.practiceCfg ?? {};
  const selType  = cfg.type    ?? "mcq";
  const selCount = cfg.count   ?? 20;

  function typeBtn(val, label, icon) {
    const active = selType === val;
    return `<button class="practice-opt-btn${active ? " active" : ""}" data-practice-type="${val}">
      <span>${icon}</span><span>${label}</span>
    </button>`;
  }
  function countBtn(val) {
    const active = selCount === val;
    return `<button class="practice-count-btn${active ? " active" : ""}" data-practice-count="${val}">${val === 0 ? "All" : val}</button>`;
  }

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="years">\u2190 Back</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title}</p>
      <h1 class="screen-title">Practice Mode</h1>
      <p class="screen-sub">Random questions from all academic years</p>

      <div class="practice-section">
        <h3 class="practice-section-title">Question Type</h3>
        <div class="practice-opts">
          ${typeBtn("mcq",     "Section A (MCQ)",    "📝")}
          ${typeBtn("written", "Section B (Written)", "✍️")}
          ${typeBtn("both",    "Both Sections",       "📚")}
        </div>
      </div>

      <div class="practice-section">
        <h3 class="practice-section-title">Number of Questions</h3>
        <div class="practice-counts">
          ${[10, 20, 30, 0].map(countBtn).join("")}
        </div>
      </div>

      <button class="btn-primary" id="btn-start-practice" style="margin-top:8px">
        Start Practice Session 🎯
      </button>
    </main>
    ${renderBottomNav()}`;
}

function renderPracticeSession() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const pool    = state.practicePool ?? [];
  const idx     = Math.min(state.practiceIndex ?? 0, pool.length - 1);
  const total   = pool.length;
  if (!pool.length) return renderPracticeConfig();

  const entry   = pool[idx];
  const pType   = entry.pType;   // "mcq" or "written"

  const answered     = state.practiceSelectedOpt !== undefined;
  const showAnswer   = state.practiceAnswerShown ?? false;
  const answeredCount = (state.practiceAnswers ?? []).filter((a) => a !== undefined).length;
  const isLast       = idx + 1 >= total;

  // ── MCQ ──────────────────────────────────────────────────────────────────
  let contentBlock = "";
  if (pType === "mcq") {
    const { q, item } = entry;
    const opts = (q.options || []).map((opt, i) => {
      let cls = "option-btn";
      if (answered) {
        if (i === q.correct)                   cls += " correct";
        else if (i === state.practiceSelectedOpt) cls += " wrong";
        else                                   cls += " dimmed";
      }
      return `<button class="${cls}" data-prac-option="${i}" ${answered ? "disabled" : ""}>${opt}</button>`;
    }).join("");

    const caseBlock = item?.type === "case-group"
      ? `<div class="case-static">
           <div class="case-static-title">📄 ${item.caseStudy.title}</div>
           <div class="case-static-body">${(item.caseStudy.fullText ?? "")
             .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
         </div>` : "";

    const feedback = answered
      ? `<div class="feedback-box">
           <div class="feedback-label">${state.practiceSelectedOpt === q.correct ? "✅ Correct!" : "❌ Incorrect"}</div>
           <p class="feedback-exp">${q.explanation ?? ""}</p>
           <p class="feedback-ref">📖 ${q.ref ?? ""}</p>
         </div>` : "";

    contentBlock = `
      ${caseBlock}
      <div class="card question-card">
        <p class="practice-source-badge">${entry.yearLabel} · ${entry.semesterLabel}</p>
        <p class="q-text">${q.text ?? ""}</p>
        <div class="options-grid">${opts}</div>
        ${feedback}
        ${answered ? `<button class="btn-primary prac-next-btn" data-is-last="${isLast}">
          ${isLast ? "Finish \u2714" : "Next \u2192"}
        </button>` : ""}
      </div>`;

  // ── WRITTEN ───────────────────────────────────────────────────────────────
  } else {
    const { q, caseStudy, parentLabel } = entry;
    const mainPts = (q?.answer?.mainPoints ?? []).map((p) => `
      <div class="answer-point">
        <strong>${p.heading}</strong><p>${p.detail}</p>
      </div>`).join("");

    const answerBlock = showAnswer
      ? `<div class="answer-block">
          ${q?.commandWord ? `<p class="command-word-label">Command Word: <strong>${q.commandWord}</strong></p>` : ""}
          ${q?.answer?.introduction ? `<div class="answer-section"><h4>Introduction</h4><p>${q.answer.introduction}</p></div>` : ""}
          <div class="answer-section"><h4>Main Points</h4>${mainPts}</div>
          ${q?.answer?.conclusion ? `<div class="answer-section"><h4>Conclusion</h4><p>${q.answer.conclusion}</p></div>` : ""}
          ${q?.answer?.ref ? `<p class="feedback-ref">📖 ${q.answer.ref}</p>` : ""}
          <button class="btn-primary prac-next-btn" data-is-last="${isLast}" style="margin-top:16px">
            ${isLast ? "Finish \u2714" : "Next Question \u2192"}
          </button>
        </div>` : "";

    contentBlock = `
      <div class="card question-card">
        <p class="practice-source-badge">${entry.yearLabel} · ${entry.semesterLabel}${parentLabel ? " · " + parentLabel : ""}</p>
        ${q?.marks ? `<div class="q-marks-row"><span class="q-marks">[${q.marks} marks]</span></div>` : ""}
        <p class="q-text">${q?.text ?? ""}</p>
        ${!showAnswer ? `<button class="btn-primary prac-reveal-btn">Reveal Answer</button>` : answerBlock}
      </div>`;
  }

  return `
    <header class="top-bar">
      <button class="back-btn mcq-guard-back" data-goto="practiceConfig">\u2190 Exit</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · Practice Mode</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${idx + 1} of ${total}
        ${answeredCount > 0 ? `<span class="q-answered-badge">${answeredCount} answered</span>` : ""}
      </p>
      ${contentBlock}
    </main>
    ${renderBottomNav()}`;
}

function renderPracticeScore() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const pool         = state.practicePool ?? [];
  const answers      = state.practiceAnswers ?? [];
  const mcqItems     = pool.filter((e) => e.pType === "mcq");
  const writtenItems = pool.filter((e) => e.pType === "written");

  // MCQ score — only over MCQ slots in the pool
  const mcqAnswers = answers.filter((_, i) => pool[i]?.pType === "mcq");
  const score      = calcScore(mcqAnswers, mcqItems.length);
  const pct        = score.percentage;

  const tier =
    pct >= 80 ? { emoji: "\uD83C\uDFC6", cls: "score-tier-gold",  label: "Excellent!"       } :
    pct >= 60 ? { emoji: "\u2705",       cls: "score-tier-green", label: "Good job!"         } :
    pct >= 40 ? { emoji: "\uD83D\uDCDA", cls: "score-tier-amber", label: "Keep studying"     } :
                { emoji: "\uD83D\uDCAA", cls: "score-tier-red",   label: "Don\u2019t give up!" };

  const scoreBlock = mcqItems.length > 0
    ? `<div class="score-card ${tier.cls}">
        <div class="score-emoji">${tier.emoji}</div>
        <div class="score-number">${score.correct}<span class="score-denom">/${score.total}</span></div>
        <div class="score-percentage">${pct}%</div>
        <div class="score-label">${tier.label}</div>
      </div>`
    : `<div class="score-card score-tier-green">
        <div class="score-emoji">\u2705</div>
        <div class="score-number">${writtenItems.length}</div>
        <div class="score-percentage">Written Questions</div>
        <div class="score-label">Practice complete!</div>
      </div>`;

  // Per-question breakdown rows (all types)
  const reviewRows = pool.map((entry, i) => {
    const ans    = answers[i];
    if (entry.pType === "mcq") {
      const isOk = ans?.correct ?? false;
      const icon = ans === undefined ? "\u25CB" : (isOk ? "\u2705" : "\u274C");
      const cls  = ans === undefined ? "skipped" : (isOk ? "correct" : "incorrect");
      const text = (entry.q?.text ?? "").length > 72 ? entry.q.text.slice(0, 69) + "\u2026" : (entry.q?.text ?? "");
      return `
        <div class="question-review-item" data-prac-review-jump="${i}">
          <div class="question-indicator ${cls}">${icon}</div>
          <div class="review-item-body">
            <span class="review-q-text">${i + 1}. ${text}</span>
            <span class="practice-source-badge" style="margin-top:4px;display:inline-block">${entry.yearLabel} \u00b7 ${entry.semesterLabel}</span>
          </div>
        </div>`;
    } else {
      const text = (entry.q?.text ?? "").length > 72 ? entry.q.text.slice(0, 69) + "\u2026" : (entry.q?.text ?? "");
      return `
        <div class="question-review-item" data-prac-review-jump="${i}">
          <div class="question-indicator skipped">\u270D\uFE0F</div>
          <div class="review-item-body">
            <span class="review-q-text">${i + 1}. ${text}</span>
            <span class="practice-source-badge" style="margin-top:4px;display:inline-block">${entry.yearLabel} \u00b7 ${entry.semesterLabel}</span>
          </div>
        </div>`;
    }
  }).join("");

  const hasReviewable = pool.length > 0;

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="practiceConfig">\u2190 Done</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} \u00b7 Practice Mode \u00b7 Results</p>
      ${scoreBlock}
      <div class="score-actions">
        ${hasReviewable ? `<button class="btn-primary" id="btn-prac-review">\uD83D\uDCCB Review Answers</button>` : ""}
        <button class="btn-secondary" id="btn-practice-again">\uD83D\uDD04 Practice Again</button>
      </div>
      <h3 class="review-list-title">Question Breakdown</h3>
      <div class="question-review-list">${reviewRows}</div>
    </main>
    ${renderBottomNav()}`;
}

// ── PRACTICE REVIEW SCREEN ────────────────────────────────────────────────────
function renderPracticeReview() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const pool  = state.practicePool ?? [];
  const idx   = Math.min(state.practiceReviewIdx ?? 0, pool.length - 1);
  const total = pool.length;
  if (!pool.length) return renderPracticeScore();

  const entry    = pool[idx];
  const answers  = state.practiceAnswers ?? [];
  const hasPrev  = idx > 0;
  const hasNext  = idx + 1 < total;

  let contentBlock = "";

  if (entry.pType === "mcq") {
    const { q, item } = entry;
    const ans      = answers[idx];
    const selected = ans?.selected;
    const isOk     = ans?.correct ?? false;

    const caseBlock = item?.type === "case-group"
      ? `<div class="case-static">
           <div class="case-static-title">\uD83D\uDCC4 ${item.caseStudy.title}</div>
           <div class="case-static-body">${(item.caseStudy.fullText ?? "")
             .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
         </div>` : "";

    const opts = (q.options || []).map((opt, i) => {
      let cls = "option-btn";
      if (i === q.correct)     cls += " correct";
      else if (i === selected) cls += " wrong";
      else                     cls += " dimmed";
      return `<button class="${cls}" disabled>${opt}</button>`;
    }).join("");

    const feedback = `
      <div class="feedback-box">
        <div class="feedback-label">${isOk ? "\u2705 Correct" : ans === undefined ? "\u25CB Not answered" : "\u274C Incorrect"}</div>
        <p class="feedback-exp">${q.explanation ?? ""}</p>
        <p class="feedback-ref">\uD83D\uDCDA ${q.ref ?? ""}</p>
      </div>`;

    contentBlock = `
      ${caseBlock}
      <div class="card question-card">
        <p class="practice-source-badge">${entry.yearLabel} \u00b7 ${entry.semesterLabel}</p>
        <p class="q-text">${q.text ?? ""}</p>
        <div class="options-grid">${opts}</div>
        ${feedback}
      </div>`;

  } else {
    // Written review — always show answer
    const { q, parentLabel } = entry;
    const mainPts = (q?.answer?.mainPoints ?? []).map((p) => `
      <div class="answer-point"><strong>${p.heading}</strong><p>${p.detail}</p></div>`).join("");

    contentBlock = `
      <div class="card question-card">
        <p class="practice-source-badge">${entry.yearLabel} \u00b7 ${entry.semesterLabel}${parentLabel ? " \u00b7 " + parentLabel : ""}</p>
        ${q?.marks ? `<div class="q-marks-row"><span class="q-marks">[${q.marks} marks]</span></div>` : ""}
        <p class="q-text">${q?.text ?? ""}</p>
        <div class="answer-block">
          ${q?.commandWord ? `<p class="command-word-label">Command Word: <strong>${q.commandWord}</strong></p>` : ""}
          ${q?.answer?.introduction ? `<div class="answer-section"><h4>Introduction</h4><p>${q.answer.introduction}</p></div>` : ""}
          <div class="answer-section"><h4>Main Points</h4>${mainPts}</div>
          ${q?.answer?.conclusion ? `<div class="answer-section"><h4>Conclusion</h4><p>${q.answer.conclusion}</p></div>` : ""}
          ${q?.answer?.ref ? `<p class="feedback-ref">\uD83D\uDCDA ${q.answer.ref}</p>` : ""}
        </div>
      </div>`;
  }

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="practiceScore">\u2190 Score</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} \u00b7 Practice Mode \u00b7 Review</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${idx + 1} of ${total}
        <span class="review-mode-badge">Review</span>
      </p>
      ${contentBlock}
      <div class="review-nav">
        <button class="btn-secondary prac-rev-prev" ${hasPrev ? "" : "disabled"}>\u2190 Prev</button>
        <button class="btn-primary  prac-rev-next"  ${hasNext ? "" : "disabled"}>Next \u2192</button>
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

  // Search icon button — opens the overlay
  const openSearchBtn = app.querySelector("#open-search-btn");
  if (openSearchBtn) {
    openSearchBtn.addEventListener("click", showSearchOverlay);
  }

  // Bottom nav — Home guards against active MCQ session
  app.querySelectorAll("[data-nav]").forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener("click", () => {
      const nav    = btn.dataset.nav;
      const target = btn.dataset.target;
      if (nav === "home") {
        guardMCQLeave(() => go("subjects"));
      } else if (nav === "current" && target) {
        go(target);
      }
    });
  });

  // Generic data-action buttons (practice, etc.)
  app.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => {
      const action = el.dataset.action;
      if (action === "go-practice") {
        loadAllYears(state.subjectId, () => {
          go("practiceConfig", { practiceCfg: { type: "mcq", count: 20 } });
        });
      }
    });
  });

  // Practice config: type selector
  app.querySelectorAll("[data-practice-type]").forEach((el) => {
    el.addEventListener("click", () => {
      const cfg = { ...(state.practiceCfg ?? {}), type: el.dataset.practiceType };
      state = saveState({ practiceCfg: cfg });
      render();
    });
  });

  // Practice config: count selector
  app.querySelectorAll("[data-practice-count]").forEach((el) => {
    el.addEventListener("click", () => {
      const cfg = { ...(state.practiceCfg ?? {}), count: parseInt(el.dataset.practiceCount) };
      state = saveState({ practiceCfg: cfg });
      render();
    });
  });

  // Practice config: start button
  const btnStartPractice = app.querySelector("#btn-start-practice");
  if (btnStartPractice) {
    btnStartPractice.addEventListener("click", () => {
      const cfg      = state.practiceCfg ?? { type: "mcq", count: 20 };
      const type     = cfg.type ?? "mcq";
      const count    = cfg.count ?? 20;

      // Build pool based on type
      let pool = [];
      if (type === "mcq" || type === "both") {
        buildMCQPool(state.subjectId).forEach((e) => pool.push({ ...e, pType: "mcq" }));
      }
      if (type === "written" || type === "both") {
        buildWrittenPool(state.subjectId).forEach((e) => pool.push({ ...e, pType: "written" }));
      }

      pool = shuffleArray(pool);
      if (count > 0) pool = pool.slice(0, count);

      if (!pool.length) {
        showConfirmDialog("No questions available for the selected options. Try loading more year data.", () => {});
        return;
      }

      state = saveState({
        screen:               "practiceSession",
        practicePool:         pool,
        practiceIndex:        0,
        practiceAnswers:      [],
        practiceSelectedOpt:  undefined,
        practiceAnswerShown:  false,
        mcqSessionActive:     true,   // re-use guard for practice too
      });
      render();
    });
  }

  // Practice session: MCQ option select
  app.querySelectorAll("[data-prac-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const selected = parseInt(el.dataset.pracOption);
      const pool     = state.practicePool ?? [];
      const idx      = state.practiceIndex ?? 0;
      const entry    = pool[idx];
      const isOk     = selected === entry?.q?.correct;
      const answers  = [...(state.practiceAnswers ?? [])];
      answers[idx]   = { selected, correct: isOk };
      state = saveState({ practiceSelectedOpt: selected, practiceAnswers: answers });
      render();
    });
  });

  // Practice session: reveal written answer
  const pracRevealBtn = app.querySelector(".prac-reveal-btn");
  if (pracRevealBtn) {
    pracRevealBtn.addEventListener("click", () => {
      state = saveState({ practiceAnswerShown: true });
      render();
    });
  }

  // Practice session: next / finish
  const pracNextBtn = app.querySelector(".prac-next-btn");
  if (pracNextBtn) {
    pracNextBtn.addEventListener("click", () => {
      const isLast = pracNextBtn.dataset.isLast === "true";
      if (isLast) {
        state = saveState({
          screen: "practiceScore",
          mcqSessionActive: false,
        });
        render();
      } else {
        const nextIdx = (state.practiceIndex ?? 0) + 1;
        state = saveState({
          practiceIndex:       nextIdx,
          practiceSelectedOpt: undefined,
          practiceAnswerShown: false,
        });
        render();
      }
    });
  }

  // Practice score: Review Answers button
  const btnPracReview = app.querySelector("#btn-prac-review");
  if (btnPracReview) {
    btnPracReview.addEventListener("click", () =>
      go("practiceReview", { practiceReviewIdx: 0 })
    );
  }

  // Practice score: click a breakdown row → jump into review at that index
  app.querySelectorAll("[data-prac-review-jump]").forEach((el) => {
    el.addEventListener("click", () =>
      go("practiceReview", { practiceReviewIdx: parseInt(el.dataset.pracReviewJump) })
    );
  });

  // Practice review: Prev / Next
  const pracRevPrev = app.querySelector(".prac-rev-prev");
  if (pracRevPrev) {
    pracRevPrev.addEventListener("click", () =>
      go("practiceReview", { practiceReviewIdx: Math.max(0, (state.practiceReviewIdx ?? 0) - 1) })
    );
  }
  const pracRevNext = app.querySelector(".prac-rev-next");
  if (pracRevNext) {
    pracRevNext.addEventListener("click", () => {
      const total = (state.practicePool ?? []).length;
      go("practiceReview", { practiceReviewIdx: Math.min(total - 1, (state.practiceReviewIdx ?? 0) + 1) });
    });
  }

  // Practice score: practice again
  const btnPracticeAgain = app.querySelector("#btn-practice-again");
  if (btnPracticeAgain) {
    btnPracticeAgain.addEventListener("click", () => {
      go("practiceConfig");
    });
  }


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
        // Clear any previous session before starting fresh
        state = saveState({
          mcqAnswers: [], mcqSessionActive: true,
          mcqCompleted: false, mcqScore: null,
          selectedOption: undefined,
        });
        go("mcq", { section, qIndex: 0, selectedOption: undefined,
          mcqAnswers: [], mcqSessionActive: true,
          mcqCompleted: false, mcqScore: null });
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

  // Back buttons (generic) — skip MCQ guard-back which has its own handler above
  app.querySelectorAll("[data-goto]").forEach((el) => {
    if (el.classList.contains("mcq-guard-back")) return;
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

  // MCQ option select — records answer into state.mcqAnswers
  app.querySelectorAll("[data-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const selected = parseInt(el.dataset.option);
      const sem      = getSemester();
      const flat     = flattenSectionA(sem?.sectionA);
      const idx      = state.qIndex || 0;
      const { q }    = flat[idx] ?? {};
      const isOk     = selected === q?.correct;
      recordMCQAnswer(idx, selected, isOk);
      state = saveState({ selectedOption: selected });
      render();
    });
  });

  // MCQ next / finish
  const nextBtn = app.querySelector(".next-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const isLast = nextBtn.dataset.isLast === "true";
      if (isLast) {
        finishMCQSession();
      } else {
        const nextIdx = (state.qIndex || 0) + 1;
        go("mcq", { qIndex: nextIdx, selectedOption: undefined });
      }
    });
  }

  // Guard: MCQ back button (top-bar) — intercept if session active
  const mcqGuardBack = app.querySelector(".mcq-guard-back");
  if (mcqGuardBack) {
    mcqGuardBack.addEventListener("click", (e) => {
      e.stopImmediatePropagation();   // prevent the generic [data-goto] handler below
      guardMCQLeave(() => go(mcqGuardBack.dataset.goto));
    });
  }

  // Score screen: Review Answers button
  const btnReview = app.querySelector("#btn-review-answers");
  if (btnReview) {
    btnReview.addEventListener("click", () =>
      go("mcqReview", { qIndex: 0 })
    );
  }

  // Score screen: Retry Section button
  const btnRetry = app.querySelector("#btn-retry-section");
  if (btnRetry) {
    btnRetry.addEventListener("click", () => startMCQSession());
  }

  // Score screen: click a review-row to jump straight into review at that question
  app.querySelectorAll("[data-review-jump]").forEach((el) => {
    el.addEventListener("click", () =>
      go("mcqReview", { qIndex: parseInt(el.dataset.reviewJump) })
    );
  });

  // Review screen: Prev / Next navigation
  const prevBtn = app.querySelector(".review-prev-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      go("mcqReview", { qIndex: Math.max(0, (state.qIndex || 0) - 1) });
    });
  }
  const revNextBtn = app.querySelector(".review-next-btn");
  if (revNextBtn) {
    revNextBtn.addEventListener("click", () => {
      const sem   = getSemester();
      const total = flattenSectionA(sem?.sectionA).length;
      go("mcqReview", { qIndex: Math.min(total - 1, (state.qIndex || 0) + 1) });
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

  // ── Service Worker registration (PWA) ─────────────────────────────────────
  // Registered after first render so it never delays the initial paint.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { scope: "./" })
      .catch((err) => console.warn("SW registration failed:", err));
  }
});