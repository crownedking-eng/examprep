// ─────────────────────────────────────────────────────────────────────────────
//  ExamPrep — app.js
//
//  Data is loaded at runtime from:
//    data/manifest.json          → subject list + year file paths
//    data/{file}                 → semester/section/question data (exams)
//    data/{quizFile}             → quiz data (optional, from manifest)
//
//  Raw JSON uses:   question / reference / correctAnswer ("A"–"D") / sectionB[]
//  App internally uses: text / ref / correct (0–3) / sectionB { caseStudy, questions }
//  normaliseYear() converts between the two on load.
// ─────────────────────────────────────────────────────────────────────────────

// ─── RUNTIME STORE ───────────────────────────────────────────────────────────
const DATA = { subjects: [] };
const YEAR_CACHE = {};

// ─── THEME ────────────────────────────────────────────────────────────────────
const THEME_KEY = "examprep_theme";

function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    btn.setAttribute("title", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  });
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}

applyTheme(getStoredTheme());

// ─── NORMALISATION ────────────────────────────────────────────────────────────
function normaliseYear(raw) {
  const letterToIndex = { A: 0, B: 1, C: 2, D: 3 };

  function stripPrefix(opt) {
    return String(opt).replace(/^[A-D]\.\s*/i, "");
  }

  function normQuestion(q) {
    return {
      ...q,
      text: q.question ?? q.text ?? "",
      options: (q.options || []).map(stripPrefix),
      correct: q.correctAnswer !== undefined
        ? (letterToIndex[q.correctAnswer.toUpperCase()] ?? 0)
        : (q.correct ?? 0),
      ref: q.reference ?? q.ref ?? "",
      question: undefined, reference: undefined, correctAnswer: undefined,
    };
  }

  function normSectionAItem(item) {
    if (item.type === "single") return normQuestion(item);
    if (item.type === "case-group") return { ...item, questions: (item.questions || []).map(normQuestion) };
    return item;
  }

  function normSubQuestion(item) {
    return {
      label: item.label ?? null,
      text: item.question ?? item.text ?? "",
      marks: item.marks ?? null,
      commandWord: item.commandWord ?? null,
      answer: {
        introduction: item.answer?.introduction ?? "",
        mainPoints: item.answer?.mainPoints ?? [],
        conclusion: item.answer?.conclusion ?? "",
        otherPossibleAnswers: item.answer?.otherPossibleAnswers ?? null,
        ref: item.answer?.reference ?? item.answer?.ref ?? "",
      },
    };
  }

  function normSectionB(rawB) {
    if (!rawB) return null;
    if (!Array.isArray(rawB) && rawB.format === "grouped") {
      return {
        format: "grouped",
        questions: (rawB.questions || []).map((q) => ({
          label: q.label ?? "",
          totalMarks: q.totalMarks ?? null,
          caseStudy: q.caseStudy ?? null,
          subQuestions: (q.subQuestions || []).map(normSubQuestion),
        })),
      };
    }
    if (Array.isArray(rawB)) {
      return {
        format: "flat",
        caseStudy: rawB[0]?.caseStudy ?? null,
        questions: rawB.map(normSubQuestion),
      };
    }
    return rawB;
  }

  const semesters = (raw.semesters || []).map((sem) => ({
    semester: sem.semester,
    sectionA: (sem.sectionA || []).map(normSectionAItem),
    sectionB: normSectionB(sem.sectionB),
    quiz: normQuiz(sem.quiz, normQuestion),   // normQuiz is now module-level
  }));

  return { semesters };
}

// ─── QUIZ NORMALISER (module-level so loadYear can call it) ──────────────────
// Defined outside normaliseYear so loadYear can call it when merging the
// separately-fetched quiz file. Has its own inline normalisation logic
// (mirrors normQuestion) to avoid closure dependency issues.
function normQuiz(rawQ, normFn) {
  if (!rawQ) return null;
  const letterToIdx = { A: 0, B: 1, C: 2, D: 3 };
  function normaliseQ(q) {
    return {
      ...q,
      text:    q.question ?? q.text ?? "",
      options: (q.options || []).map((o) => String(o).replace(/^[A-D]\.\s*/i, "")),
      correct: q.correctAnswer !== undefined
        ? (letterToIdx[String(q.correctAnswer).toUpperCase()] ?? 0)
        : (q.correct ?? 0),
      ref: q.reference ?? q.ref ?? "",
      question: undefined, reference: undefined, correctAnswer: undefined,
    };
  }
  const fn = normFn ?? normaliseQ;
  return {
    title:          rawQ.title          ?? "Mid-Semester Quiz",
    description:    rawQ.description    ?? "",
    totalQuestions: rawQ.totalQuestions ?? (rawQ.questions?.length ?? 0),
    questions:      (rawQ.questions || []).map(fn),
  };
}

// ─── LOADING UI ───────────────────────────────────────────────────────────────
function showLoading(message = "Loading…") {
  document.getElementById("app").innerHTML = `
    <div class="loading-screen">
      <div class="loading-spinner"></div>
      <p class="loading-msg">${message}</p>
    </div>`;
}

function showError(message) {
  document.getElementById("app").innerHTML = `
    <div class="loading-screen">
      <p class="error-icon">⚠️</p>
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
    id: s.id,
    title: s.title,
    code: s.code,
    icon: s.icon,
    years: s.years.map((y) => ({
      id: y.id,
      label: y.label,
      file: y.file,
      quizFile: y.quizFile || null,
      semesters: null,
    })),
  }));
}

async function loadYear(subjectId, yearId) {
  const cacheKey = `${subjectId}/${yearId}`;
  if (YEAR_CACHE[cacheKey]) return;

  const subject = DATA.subjects.find((s) => s.id === subjectId);
  const year = subject?.years.find((y) => y.id === yearId);
  if (!year) throw new Error(`Year "${yearId}" not found in subject "${subjectId}"`);

  // Load exam data (required)
  const res = await fetch(`data/${year.file}`);
  if (!res.ok) throw new Error(`Could not load ${year.file} (HTTP ${res.status})`);

  const raw = await res.json();
  const normalised = normaliseYear(raw);
  year.semesters = normalised.semesters;

  // Load quiz data from manifest-specified path (optional)
  if (year.quizFile) {
    try {
      const quizRes = await fetch(`data/${year.quizFile}`);
      if (quizRes.ok) {
        const quizRaw = await quizRes.json();
        quizRaw.semesters?.forEach((quizSem, i) => {
          if (quizSem?.quiz && normalised.semesters[i]) {
            normalised.semesters[i].quiz = normQuiz(quizSem.quiz);
          }
        });
      } else {
        console.warn(`Quiz file not found: data/${year.quizFile}`);
      }
    } catch (e) {
      console.warn(`Failed to load quiz: ${e.message}`);
    }
  }

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
  const year = subject?.years.find((y) => y.id === state.yearId);
  if (!year) return null;
  return year.semesters?.[state.semesterIndex ?? 0] ?? null;
}

function getQuiz() {
  const sem = getSemester();
  return sem?.quiz ?? null;
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const STATE_KEY = "examprep_state";
const STATE_VERSION = 8;

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY));
    if (!raw || raw._v !== STATE_VERSION) return { _v: STATE_VERSION };
    if (raw.stats?.sessions) {
      let migrated = false;
      raw.stats.sessions = raw.stats.sessions.map((s) => {
        if (s.completed === undefined) {
          migrated = true;
          return { ...s, completed: true, abandoned: false, questionsAttempted: s.totalQuestions };
        }
        return s;
      });
      if (migrated) {
        raw.stats.aggregates = null;
        localStorage.setItem(STATE_KEY, JSON.stringify(raw));
      }
    }
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
  subjects: renderSubjects,
  years: renderYears,
  semesters: renderSemesters,
  sections: renderSections,
  mcq: renderMCQ,
  mcqScore: renderMCQScore,
  mcqReview: renderMCQReview,
  "written-questions": renderWrittenQuestions,
  written: renderWritten,
  practiceConfig: renderPracticeConfig,
  practiceSession: renderPracticeSession,
  practiceScore: renderPracticeScore,
  practiceReview: renderPracticeReview,
  bookmarks: renderBookmarks,
  bookmarkView: renderBookmarkView,
  stats: renderStatsDashboard,
  quiz: renderQuiz,
  quizScore: renderQuizScore,
  quizReview: renderQuizReview,
};

function go(screen, patch = {}) {
  state = saveState({ screen, ...patch });
  render();
}

async function goYear(yearId) {
  state = saveState({ screen: "semesters", yearId, semesterIndex: undefined, qIndex: 0 });
  showLoading("Loading exam data…");
  try {
    await loadYear(state.subjectId, yearId);
    const subject = DATA.subjects.find((s) => s.id === state.subjectId);
    const year = subject?.years.find((y) => y.id === yearId);
    if (year?.semesters?.length === 1) {
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
  const icon = theme === "dark" ? "☀️" : "🌙";
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return `<button class="theme-toggle" aria-label="${label}" title="${label}">${icon}</button>`;
}

function topBarRight(showSearch) {
  const searchBtn = (showSearch !== false && state.subjectId)
    ? `<button class="search-icon-btn" id="open-search-btn" aria-label="Search questions" title="Search questions">🔍</button>`
    : "";
  return `<div class="top-bar-right">${searchBtn}${themeToggleBtn()}</div>`;
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
function renderBottomNav() {
  const scr = state.screen;
  const hasContext = !!(state.subjectId && state.yearId);

  let currentLabel = "Current";
  let currentTarget = "";
  let currentActive = false;

  if (scr === "mcq" || scr === "mcqScore" || scr === "mcqReview") {
    currentLabel = "Section A"; currentTarget = "sections"; currentActive = true;
  } else if (scr === "quiz" || scr === "quizScore" || scr === "quizReview") {
    currentLabel = "Quiz"; currentTarget = "sections"; currentActive = true;
  } else if (scr === "written" || scr === "written-questions") {
    currentLabel = "Section B"; currentTarget = "sections"; currentActive = true;
  } else if (scr === "sections") {
    currentLabel = "Sections"; currentTarget = "sections"; currentActive = true;
  } else if (scr === "semesters") {
    currentLabel = "Semesters"; currentTarget = "semesters"; currentActive = true;
  } else if (scr === "practiceConfig" || scr === "practiceSession" ||
    scr === "practiceScore" || scr === "practiceReview") {
    currentLabel = "Practice"; currentTarget = "practiceConfig"; currentActive = true;
  }

  const homeActive = scr === "subjects" || scr === "years";
  const currentDisabled = !hasContext || !currentTarget;
  const bookmarksActive = scr === "bookmarks";
  const bmCount = (state.bookmarks ?? []).length;
  const bmBadge = bmCount > 0 ? `<span class="bm-nav-count">${bmCount}</span>` : "";

  return `
    <nav class="bottom-nav" aria-label="Main navigation">
      <button class="nav-item${homeActive ? " active" : ""}" data-nav="home" aria-label="Home">
        <span class="nav-icon" aria-hidden="true">🏠</span>
        <span class="nav-label">Home</span>
      </button>
      <button class="nav-item${currentActive ? " active" : ""}${currentDisabled ? " nav-disabled" : ""}"
              data-nav="current" data-target="${currentTarget}"
              ${currentDisabled ? "disabled" : ""}
              aria-label="${currentLabel}">
        <span class="nav-icon" aria-hidden="true">📚</span>
        <span class="nav-label">${currentLabel}</span>
      </button>
      <button class="nav-item${bookmarksActive ? " active" : ""}"
              data-nav="bookmarks" aria-label="Bookmarks">
        <span class="nav-icon" aria-hidden="true">🔖</span>
        <span class="nav-label">Saved${bmBadge}</span>
      </button>
      <button class="nav-item${scr === "stats" ? " active" : ""}"
              data-nav="stats" aria-label="Statistics">
        <span class="nav-icon" aria-hidden="true">📊</span>
        <span class="nav-label">Stats</span>
      </button>
    </nav>`;
}

// ─── MCQ SESSION HELPERS ─────────────────────────────────────────────────────
function recordMCQAnswer(globalIdx, selected, isCorrect) {
  const answers = [...(state.mcqAnswers ?? [])];
  answers[globalIdx] = { qIndex: globalIdx, selected, correct: isCorrect };
  state = saveState({ mcqAnswers: answers, mcqSessionActive: true });
}

function calcScore(answers, total) {
  const correct = (answers ?? []).filter((a) => a?.correct).length;
  const answered = (answers ?? []).filter((a) => a !== undefined).length;
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { correct, total, answered, percentage };
}

function startMCQSession() {
  state = saveState({
    screen: "mcq",
    qIndex: 0,
    selectedOption: undefined,
    mcqAnswers: [],
    mcqSessionActive: true,
    mcqCompleted: false,
    mcqScore: null,
  });
  render();
}

function finishMCQSession() {
  const subj = DATA.subjects.find((s) => s.id === state.subjectId);
  const yr = subj?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  const flat = flattenSectionA(sem?.sectionA);
  const score = calcScore(state.mcqAnswers, flat.length);

  const session = {
    id: makeSessionId(),
    timestamp: Date.now(),
    type: "section",
    subjectId: state.subjectId ?? "",
    subjectTitle: subj?.title ?? "",
    yearId: state.yearId ?? "",
    yearLabel: yr?.label ?? "",
    semesterLabel: sem?.semester ?? "",
    totalQuestions: score.total,
    correctAnswers: score.correct,
    score: score.percentage,
    completed: true,
    abandoned: false,
    questionsAttempted: score.answered,
  };

  const updatedStats = addSessionToStats(state.stats, session);

  state = saveState({
    screen: "mcqScore",
    mcqSessionActive: false,
    mcqCompleted: true,
    mcqScore: score,
    selectedOption: undefined,
    stats: updatedStats,
  });
  render();
}

// ─── QUIZ SESSION HELPERS ────────────────────────────────────────────────────
function recordQuizAnswer(globalIdx, selected, isCorrect) {
  const answers = [...(state.quizAnswers ?? [])];
  answers[globalIdx] = { qIndex: globalIdx, selected, correct: isCorrect };
  state = saveState({ quizAnswers: answers, quizSessionActive: true });
}

function startQuizSession() {
  state = saveState({
    screen: "quiz",
    qIndex: 0,
    selectedOption: undefined,
    quizAnswers: [],
    quizSessionActive: true,
    quizCompleted: false,
    quizScore: null,
  });
  render();
}

function finishQuizSession() {
  const subj = DATA.subjects.find((s) => s.id === state.subjectId);
  const yr = subj?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  const quiz = getQuiz();
  if (!quiz) return;

  const score = calcScore(state.quizAnswers, quiz.questions.length);

  const session = {
    id: makeSessionId(),
    timestamp: Date.now(),
    type: "quiz",
    subjectId: state.subjectId ?? "",
    subjectTitle: subj?.title ?? "",
    yearId: state.yearId ?? "",
    yearLabel: yr?.label ?? "",
    semesterLabel: sem?.semester ?? "",
    totalQuestions: score.total,
    correctAnswers: score.correct,
    score: score.percentage,
    completed: true,
    abandoned: false,
    questionsAttempted: score.answered,
  };

  const updatedQuizStats = addSessionToStats(state.quizStats ?? emptyStats(), session);

  state = saveState({
    screen: "quizScore",
    quizSessionActive: false,
    quizCompleted: true,
    quizScore: score,
    selectedOption: undefined,
    quizStats: updatedQuizStats,
  });
  render();
}

// ─── CONFIRMATION DIALOG ──────────────────────────────────────────────────────
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
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector(".confirm-stay").focus();
}

function guardMCQLeave(proceed) {
  if (state.mcqSessionActive) {
    showConfirmDialog(
      "You have an ongoing quiz. Are you sure you want to leave?<br>Your progress will be lost.",
      () => {
        const answers = state.mcqAnswers ?? [];
        const answered = answers.filter((a) => a !== undefined).length;
        if (answered > 0) {
          const subj = DATA.subjects.find((s) => s.id === state.subjectId);
          const yr = subj?.years.find((y) => y.id === state.yearId);
          const sem = getSemester();
          const flat = flattenSectionA(sem?.sectionA ?? []);
          const correct = answers.filter((a) => a?.correct).length;
          const abandonedSession = {
            id: makeSessionId(),
            timestamp: Date.now(),
            type: "section",
            subjectId: state.subjectId ?? "",
            subjectTitle: subj?.title ?? "",
            yearId: state.yearId ?? "",
            yearLabel: yr?.label ?? "",
            semesterLabel: sem?.semester ?? "",
            totalQuestions: flat.length,
            correctAnswers: correct,
            score: flat.length > 0 ? Math.round((correct / flat.length) * 100) : 0,
            completed: false,
            abandoned: true,
            questionsAttempted: answered,
          };
          const updatedStats = addSessionToStats(state.stats, abandonedSession);
          state = saveState({
            mcqSessionActive: false,
            mcqAnswers: [],
            mcqScore: null,
            stats: updatedStats,
          });
        } else {
          state = saveState({ mcqSessionActive: false, mcqAnswers: [], mcqScore: null });
        }
        proceed();
      }
    );
  } else {
    proceed();
  }
}

function guardQuizLeave(proceed) {
  if (state.quizSessionActive) {
    showConfirmDialog(
      "You have an ongoing quiz. Are you sure you want to leave?<br>Your progress will be lost.",
      () => {
        const answers = state.quizAnswers ?? [];
        const answered = answers.filter((a) => a !== undefined).length;
        if (answered > 0) {
          const subj = DATA.subjects.find((s) => s.id === state.subjectId);
          const yr = subj?.years.find((y) => y.id === state.yearId);
          const sem = getSemester();
          const quiz = getQuiz();
          const total = quiz?.questions?.length ?? 0;
          const correct = answers.filter((a) => a?.correct).length;
          const abandonedSession = {
            id: makeSessionId(),
            timestamp: Date.now(),
            type: "quiz",
            subjectId: state.subjectId ?? "",
            subjectTitle: subj?.title ?? "",
            yearId: state.yearId ?? "",
            yearLabel: yr?.label ?? "",
            semesterLabel: sem?.semester ?? "",
            totalQuestions: total,
            correctAnswers: correct,
            score: total > 0 ? Math.round((correct / total) * 100) : 0,
            completed: false,
            abandoned: true,
            questionsAttempted: answered,
          };
          const updatedQuizStats = addSessionToStats(state.quizStats ?? emptyStats(), abandonedSession);
          state = saveState({
            quizSessionActive: false,
            quizAnswers: [],
            quizScore: null,
            quizStats: updatedQuizStats,
          });
        } else {
          state = saveState({ quizSessionActive: false, quizAnswers: [], quizScore: null });
        }
        proceed();
      }
    );
  } else {
    proceed();
  }
}

// ─── STATS HELPERS ──────────────────────────────────────────────────────────
function emptyStats() {
  return { sessions: [], aggregates: null };
}

function makeSessionId() {
  return "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

function addSessionToStats(statsIn, session) {
  const sessions = [session, ...(statsIn?.sessions ?? [])].slice(0, 200);
  return { sessions, aggregates: calcAggregates(sessions) };
}

function calcAggregates(sessions) {
  // Guard: ensure every session has the numeric fields we reduce over.
  // Old records saved before the completed/questionsAttempted fields were
  // added may be missing them; treat them as completed with full questions.
  const safe = sessions.map((r) => ({
    ...r,
    totalQuestions:     Number(r.totalQuestions)  || 0,
    correctAnswers:     Number(r.correctAnswers)   || 0,
    score:              Number(r.score)            || 0,
    completed:          r.completed  !== false,
    abandoned:          r.abandoned  === true,
  }));

  const totalSessions = safe.length;
  const completed = safe.filter((r) => r.completed);
  const abandoned  = safe.filter((r) => r.abandoned);

  const totalQuestions  = safe.reduce((s, r) => s + r.totalQuestions, 0);
  const totalCorrect    = safe.reduce((s, r) => s + r.correctAnswers, 0);
  const overallAverage  = totalQuestions > 0
    ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  const compQ    = completed.reduce((s, r) => s + r.totalQuestions, 0);
  const compCorr = completed.reduce((s, r) => s + r.correctAnswers, 0);
  const completedAverage = compQ > 0 ? Math.round((compCorr / compQ) * 100) : 0;

  const bySubject = {};
  completed.forEach((r) => {
    if (!r.subjectId) return;
    if (!bySubject[r.subjectId]) {
      bySubject[r.subjectId] = {
        subjectId: r.subjectId, subjectTitle: r.subjectTitle ?? "",
        sessions: 0, questions: 0, correct: 0, average: 0, abandonedCount: 0,
      };
    }
    const b = bySubject[r.subjectId];
    b.sessions++;
    b.questions += r.totalQuestions;
    b.correct   += r.correctAnswers;
    b.average    = b.questions > 0 ? Math.round((b.correct / b.questions) * 100) : 0;
  });
  abandoned.forEach((r) => {
    if (!r.subjectId) return;
    if (!bySubject[r.subjectId]) {
      bySubject[r.subjectId] = {
        subjectId: r.subjectId, subjectTitle: r.subjectTitle ?? "",
        sessions: 0, questions: 0, correct: 0, average: 0, abandonedCount: 0,
      };
    }
    bySubject[r.subjectId].abandonedCount++;
  });

  const byDay = [];
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    const d    = new Date(now - i * 86400000);
    const dStr = d.toISOString().slice(0, 10);
    const dayC = completed.filter(
      (r) => new Date(r.timestamp).toISOString().slice(0, 10) === dStr
    );
    const dTot  = dayC.reduce((s, r) => s + r.totalQuestions, 0);
    const dCorr = dayC.reduce((s, r) => s + r.correctAnswers, 0);
    byDay.push({
      date:      dStr,
      count:     dayC.length,
      abandoned: abandoned.filter(
        (r) => new Date(r.timestamp).toISOString().slice(0, 10) === dStr
      ).length,
      average: dTot > 0 ? Math.round((dCorr / dTot) * 100) : 0,
    });
  }

  return {
    totalSessions,
    completedSessions:      completed.length,
    abandonedSessions:      abandoned.length,
    totalQuestionsAnswered: totalQuestions,
    totalCorrect,
    overallAverage,
    completedAverage,
    bySubject,
    byDay,
  };
}

function formatSessionDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const yes = new Date(now); yes.setDate(yes.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yes.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function scoreColorCls(pct) {
  if (pct >= 80) return "green";
  if (pct >= 60) return "amber";
  return "red";
}

// ─── BOOKMARK HELPERS ────────────────────────────────────────────────────────
function makeBookmarkId(params) {
  const { subjectId, yearId, semesterIndex, type, flatIdx, parentIdx, subQIdx } = params;
  if (type === "mcq") {
    return `${subjectId}|${yearId}|${semesterIndex}|mcq|${flatIdx}`;
  }
  return `${subjectId}|${yearId}|${semesterIndex}|written|${parentIdx ?? 0}|${subQIdx ?? 0}`;
}

function isBookmarked(bmId) {
  return (state.bookmarks ?? []).some((b) => b.id === bmId);
}

function toggleBookmark(bmData) {
  const current = [...(state.bookmarks ?? [])];
  const idx = current.findIndex((b) => b.id === bmData.id);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.unshift({ ...bmData, timestamp: Date.now() });
  }
  state = saveState({ bookmarks: current });
  return current;
}

async function navigateToBookmark(bm) {
  showLoading("Loading…");
  try {
    await loadYear(bm.subjectId, bm.yearId);
  } catch (e) {
    showError(`Could not load year data.<br><small>${e.message}</small>`);
    return;
  }
  go("bookmarkView", {
    subjectId: bm.subjectId,
    yearId: bm.yearId,
    semesterIndex: bm.semesterIndex ?? 0,
    bmType: bm.type,
    bmFlatIdx: bm.flatIdx ?? 0,
    bmParentIdx: bm.parentIdx ?? 0,
    bmSubQIdx: bm.subQIdx ?? 0,
  });
}

function bookmarkBtn(bmId, qText) {
  const active = isBookmarked(bmId);
  const label = active ? "Remove bookmark" : "Bookmark this question";
  const icon = active ? "★" : "☆";
  return `<button class="bm-btn${active ? " bm-active" : ""}"
    data-bm-id="${bmId.replace(/"/g, "&quot;")}"
    data-bm-text="${(qText ?? "").slice(0, 80).replace(/"/g, "&quot;")}"
    aria-label="${label}" title="${label}">${icon}</button>`;
}

// ─── PRACTICE & SEARCH HELPERS ──────────────────────────────────────────────
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

function buildQuizPool(subjectId) {
  const subject = DATA.subjects.find((s) => s.id === subjectId);
  if (!subject) return [];
  const pool = [];
  for (const year of subject.years) {
    if (!year.semesters) continue;
    year.semesters.forEach((sem, si) => {
      if (!sem.quiz?.questions?.length) return;
      sem.quiz.questions.forEach((q, qi) => {
        pool.push({
          q,
          item: { type: "single" },
          yearLabel: year.label,
          semesterLabel: sem.semester,
          yearId: year.id,
          semesterIdx: si,
          quizIdx: qi,
        });
      });
    });
  }
  return pool;
}

async function loadAllYears(subjectId, onDone) {
  const subject = DATA.subjects.find((s) => s.id === subjectId);
  if (!subject) { onDone(); return; }
  showLoading("Loading all exam data…");
  try {
    await Promise.all(subject.years.map((y) => loadYear(subjectId, y.id)));
    onDone();
  } catch (e) {
    showError(`Failed to load data.<br><small>${e.message}</small>`);
  }
}

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
    if (t.includes(normalized)) sc += 100;
    for (const term of terms) {
      const re = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (re.test(t)) sc += 10;
      else if (t.includes(term)) sc += 2;
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
function showSearchOverlay() {
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

  const input = overlay.querySelector("#search-panel-input");
  const meta = overlay.querySelector("#search-meta");
  const results = overlay.querySelector("#search-results");
  const closeBtn = overlay.querySelector(".search-close-btn");

  function closeOverlay() { overlay.remove(); }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
  closeBtn.addEventListener("click", closeOverlay);
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });

  function updateResults(query) {
    const MAX = 50;
    const hits = query.length >= 1 ? searchQuestions(state.subjectId, query) : [];
    const shown = hits.slice(0, MAX);

    if (!query) {
      meta.textContent = "Type to search across all exam questions.";
    } else if (!hits.length) {
      meta.innerHTML = `No results for “<strong>${query}</strong>”`;
    } else if (hits.length > MAX) {
      meta.textContent = `Showing top ${MAX} of ${hits.length} results`;
    } else {
      meta.textContent = `${hits.length} result${hits.length !== 1 ? "s" : ""}`;
    }

    results.innerHTML = shown.map(({ type, entry }) => {
      const text = (entry.q?.text ?? "").slice(0, 140);
      const trail = (entry.q?.text?.length ?? 0) > 140 ? "…" : "";
      const badge = type === "mcq"
        ? `<span class="sr-type-badge sr-badge-mcq">MCQ</span>`
        : `<span class="sr-type-badge sr-badge-written">Written</span>`;
      return `
        <div class="sr-item" data-sr-type="${type}"
             data-sr-year="${entry.yearId}" data-sr-sem="${entry.semesterIdx}"
             tabindex="0" role="button">
          <div class="sr-item-top">${badge}<span class="sr-meta">${entry.yearLabel} · ${entry.semesterLabel}</span></div>
          <p class="sr-text">${text}${trail}</p>
        </div>`;
    }).join("");

    results.querySelectorAll(".sr-item").forEach((el) => {
      const activate = async () => {
        const yearId = el.dataset.srYear;
        const semIdx = parseInt(el.dataset.srSem);
        const type = el.dataset.srType;
        if (!yearId) return;
        closeOverlay();
        showLoading("Loading…");
        try {
          await loadYear(state.subjectId, yearId);
          const patch = {
            yearId,
            semesterIndex: semIdx,
            qIndex: 0,
            subQIndex: 0,
            selectedOption: undefined,
            answerRevealed: false,
            mcqAnswers: [],
            mcqSessionActive: type === "mcq",
            mcqCompleted: false,
            mcqScore: null,
          };
          if (type === "mcq") {
            go("mcq", patch);
          } else {
            const subj = DATA.subjects.find((s) => s.id === state.subjectId);
            const yr = subj?.years.find((y) => y.id === yearId);
            const sem = yr?.semesters?.[semIdx];
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

  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => updateResults(input.value.trim()), 200);
  });

  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) {
    meta.textContent = "Select a subject first to search its questions.";
    input.disabled = false;
    requestAnimationFrame(() => input.focus());
    return;
  }

  Promise.all(subject.years.map((y) => loadYear(subject.id, y.id)))
    .then(() => {
      input.disabled = false;
      input.placeholder = "Search questions…";
      if (!document.getElementById("search-overlay")) return;
      updateResults("");
      requestAnimationFrame(() => { input.focus(); });
    })
    .catch((err) => {
      if (!document.getElementById("search-overlay")) return;
      meta.textContent = `Could not load data: ${err.message}`;
    });
}

// ─── MARKDOWN TABLE RENDERER ────────────────────────────────────────────────
function renderMarkdownTables(text) {
  if (!text || !text.includes("|")) return text;

  const lines = text.split("\n");
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const isTableLine = (l) => /\|/.test(l) && l.trim().length > 1;
    const isSepLine = (l) => /^\s*\|[\s\-:|]+\|\s*$/.test(l);

    if (isTableLine(line)) {
      const block = [];
      while (i < lines.length && isTableLine(lines[i])) {
        block.push(lines[i]);
        i++;
      }

      if (block.length < 3 || !isSepLine(block[1])) {
        output.push(block.join("\n"));
        continue;
      }

      function rowCells(row) {
        const parts = row.split("|");
        const trimmed = parts.slice(
          parts[0].trim() === "" ? 1 : 0,
          parts[parts.length - 1].trim() === "" ? -1 : undefined
        );
        return trimmed.map((c) => c.trim());
      }

      const headerCells = rowCells(block[0]);
      const dataRows = block.slice(2).map(rowCells);
      const cols = headerCells.length;
      if (cols === 0 || dataRows.some((r) => r.length === 0)) {
        output.push(block.join("\n"));
        continue;
      }

      const colIsNumeric = headerCells.map((_, ci) =>
        dataRows.every((r) => r[ci] !== undefined && r[ci] !== "" && !isNaN(Number(r[ci])))
      );

      const thCells = headerCells.map((h, ci) =>
        `<th style="text-align:${colIsNumeric[ci] ? "right" : "left"}">${h}</th>`
      ).join("");

      const tdRows = dataRows.map((row) => {
        const cells = headerCells.map((_, ci) => {
          const val = row[ci] ?? "";
          return `<td style="text-align:${colIsNumeric[ci] ? "right" : "left"}">${val}</td>`;
        }).join("");
        return `<tr>${cells}</tr>`;
      }).join("");

      output.push(
        `<div class="table-wrapper"><table class="q-table"><thead><tr>${thCells}<tr></thead><tbody>${tdRows}</tbody></table></div>`
      );
      continue;
    }

    output.push(line);
    i++;
  }

  return output.join("\n");
}

function renderQText(raw) {
  if (!raw) return "";
  const withTables = renderMarkdownTables(raw);
  return withTables
    .split(/\n\n+/)
    .map((chunk) => {
      if (chunk.trimStart().startsWith("<div class=\"table-wrapper\">")) return chunk;
      const inner = chunk.replace(/\n/g, " ").trim();
      return inner ? `<p class="q-text-para">${inner}</p>` : "";
    })
    .filter(Boolean)
    .join("");
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
  const year = subject?.years.find((y) => y.id === state.yearId);
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
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const totalA = flattenSectionA(sem.sectionA).length;
  const sectionB = sem.sectionB;
  const totalB = sectionB?.format === "grouped"
    ? (sectionB.questions || []).reduce((sum, q) => sum + (q.subQuestions?.length ?? 0), 0)
    : (sectionB?.questions?.length ?? 0);
  const totalBParent = sectionB?.format === "grouped" ? (sectionB.questions || []).length : totalB;

  const quiz = getQuiz();
  const quizCount = quiz?.questions?.length ?? 0;
  const quizEnabled = quizCount > 0;
  const quizTitle = quiz?.title ?? "Mid-Semester Quiz";
  const quizCardCls = quizEnabled ? "card section-card" : "card section-card section-card--disabled";
  const quizDisabledAttr = quizEnabled ? "" : "disabled aria-disabled=\"true\"";
  const quizSub = quizEnabled
    ? `Multiple Choice · ${quizCount} Questions`
    : "No quiz data available";

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
        <button class="${quizCardCls}" data-section="quiz" ${quizDisabledAttr}>
          <span class="section-badge">Q</span>
          <span class="card-title">${quizTitle}</span>
          <span class="card-sub">${quizSub}</span>
        </button>
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ── MCQ ───────────────────────────────────────────────────────────────────────
function renderMCQ() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const flat = flattenSectionA(sem.sectionA);
  const globalIdx = Math.min(state.qIndex || 0, flat.length - 1);
  const { item, q } = flat[globalIdx];
  const total = flat.length;
  const answered = state.selectedOption !== undefined;

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
      if (i === q.correct) cls += " correct";
      else if (i === state.selectedOption) cls += " wrong";
      else cls += " dimmed";
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

  const isLast = globalIdx + 1 >= total;
  const nextLabel = isLast ? "Finish ✔" : "Next Question →";
  const answeredCount = (state.mcqAnswers ?? []).filter((a) => a !== undefined).length;

  return `
    <header class="top-bar">
      <button class="back-btn mcq-guard-back" data-goto="sections">← Back</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Section A</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((globalIdx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${globalIdx + 1} of ${total}
        ${answeredCount > 0 ? `<span class="q-answered-badge">${answeredCount} answered</span>` : ""}
      </p>
      ${caseBlock}
      <div class="card question-card">
        <div class="q-card-header">
          <p class="q-text">${q.text ?? ""}</p>
          ${bookmarkBtn(makeBookmarkId({ subjectId: state.subjectId, yearId: state.yearId, semesterIndex: state.semesterIndex ?? 0, type: "mcq", flatIdx: globalIdx }), q.text)}
        </div>
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
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const flat = flattenSectionA(sem.sectionA);
  const score = state.mcqScore ?? calcScore(state.mcqAnswers, flat.length);
  const pct = score.percentage;

  const tier = pct >= 80 ? { emoji: "🏆", cls: "score-tier-gold", label: "Excellent!" } :
    pct >= 60 ? { emoji: "✅", cls: "score-tier-green", label: "Good job!" } :
      pct >= 40 ? { emoji: "📚", cls: "score-tier-amber", label: "Keep studying" } :
        { emoji: "💪", cls: "score-tier-red", label: "Don't give up!" };

  const reviewRows = flat.map(({ q }, i) => {
    const ans = (state.mcqAnswers ?? [])[i];
    const isOk = ans?.correct ?? false;
    const icon = ans === undefined ? "○" : (isOk ? "✅" : "❌");
    const cls = ans === undefined ? "skipped" : (isOk ? "correct" : "incorrect");
    const text = (q.text ?? "").length > 72 ? q.text.slice(0, 69) + "…" : (q.text ?? "");
    return `
      <div class="question-review-item" data-review-jump="${i}">
        <div class="question-indicator ${cls}">${icon}</div>
        <span class="review-q-text">${i + 1}. ${text}</span>
      </div>`;
  }).join("");

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="sections">← Done</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Section A</p>
      <div class="score-card ${tier.cls}">
        <div class="score-emoji">${tier.emoji}</div>
        <div class="score-number">${score.correct}<span class="score-denom">/${score.total}</span></div>
        <div class="score-percentage">${pct}%</div>
        <div class="score-label">${tier.label}</div>
      </div>
      <div class="score-actions">
        <button class="btn-primary" id="btn-review-answers">📋 Review Answers</button>
        <button class="btn-secondary" id="btn-retry-section">🔄 Retry Section</button>
      </div>
      <h3 class="review-list-title">Question Breakdown</h3>
      <div class="question-review-list">${reviewRows}</div>
    </main>
    ${renderBottomNav()}`;
}

// ── MCQ REVIEW SCREEN ─────────────────────────────────────────────────────────
function renderMCQReview() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const flat = flattenSectionA(sem.sectionA);
  const globalIdx = Math.min(state.qIndex || 0, flat.length - 1);
  const { item, q } = flat[globalIdx];
  const total = flat.length;
  const ans = (state.mcqAnswers ?? [])[globalIdx];
  const selected = ans?.selected;
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
    if (i === q.correct) cls += " correct";
    else if (i === selected) cls += " wrong";
    else cls += " dimmed";
    return `<button class="${cls}" disabled>${opt}</button>`;
  }).join("");

  const feedback = `
    <div class="feedback-box">
      <div class="feedback-label">${isCorrect ? "✅ You got this right" : "❌ You got this wrong"}</div>
      <p class="feedback-exp">${q.explanation ?? ""}</p>
      <p class="feedback-ref">📖 ${q.ref ?? ""}</p>
    </div>`;

  const hasPrev = globalIdx > 0;
  const hasNext = globalIdx + 1 < total;

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="mcqScore">← Score</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Section A · Review</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((globalIdx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${globalIdx + 1} of ${total}
        <span class="review-mode-badge">Review</span>
      </p>
      ${caseBlock}
      <div class="card question-card">
        <div class="q-card-header">
          <p class="q-text">${q.text ?? ""}</p>
          ${bookmarkBtn(makeBookmarkId({ subjectId: state.subjectId, yearId: state.yearId, semesterIndex: state.semesterIndex ?? 0, type: "mcq", flatIdx: globalIdx }), q.text)}
        </div>
        <div class="options-grid">${opts}</div>
        ${feedback}
        <div class="review-nav">
          <button class="btn-secondary review-prev-btn" ${hasPrev ? "" : "disabled"}>← Prev</button>
          <button class="btn-primary review-next-btn" ${hasNext ? "" : "disabled"}>Next →</button>
        </div>
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ── WRITTEN QUESTION SELECTOR ─────────────────────────────────────────────────
function renderWrittenQuestions() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const grouped = sem.sectionB?.questions ?? [];

  const cards = grouped.map((q, i) => {
    const subCount = q.subQuestions?.length ?? 0;
    const hasCase = !!q.caseStudy;
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
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  if (!subject || !year || !sem) return renderSubjects();

  const sectionB = sem.sectionB;
  const isGrouped = sectionB?.format === "grouped";
  const showAnswer = state.answerRevealed;
  const rating = state.selfRating;

  let q, cs, backScreen, backLabel, subQuestions, subQIdx, parentLabel, totalSubs;

  if (isGrouped) {
    const parentIdx = state.qIndex ?? 0;
    const parent = sectionB.questions[parentIdx];
    subQuestions = parent?.subQuestions ?? [];
    subQIdx = Math.min(state.subQIndex ?? 0, subQuestions.length - 1);
    q = subQuestions[subQIdx];
    cs = parent?.caseStudy ?? null;
    backScreen = "written-questions";
    backLabel = "← Back to Questions";
    parentLabel = parent?.label ?? "";
    totalSubs = subQuestions.length;
  } else {
    const questions = sectionB?.questions ?? [];
    subQIdx = Math.min(state.qIndex ?? 0, questions.length - 1);
    q = questions[subQIdx];
    cs = sectionB?.caseStudy ?? null;
    backScreen = "sections";
    backLabel = "← Back";
    totalSubs = questions.length;
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
            <button class="rating-btn ${rating === "almost" ? "active-almost" : ""}" data-rating="almost">🟡 Almost</button>
            <button class="rating-btn ${rating === "revise" ? "active-revise" : ""}" data-rating="revise">🔴 Revise</button>
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
        <div class="q-card-header">
          <div>
            <div class="q-marks-row">
              <span class="q-marks">[${q?.marks ?? "?"} marks]</span>
            </div>
            <div class="q-text">${renderQText(q?.text ?? "")}</div>
          </div>
          ${bookmarkBtn(makeBookmarkId({ subjectId: state.subjectId, yearId: state.yearId, semesterIndex: state.semesterIndex ?? 0, type: "written", parentIdx: isGrouped ? (state.qIndex ?? 0) : 0, subQIdx: subQIdx }), q?.text)}
        </div>
        ${!showAnswer ? `<button class="btn-primary reveal-btn">Reveal Structured Answer</button>` : ""}
        ${answerBlock}
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ── QUIZ ──────────────────────────────────────────────────────────────────────
function renderQuiz() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  const quiz = getQuiz();
  if (!subject || !year || !sem || !quiz) return renderSubjects();

  const questions = quiz.questions;
  const globalIdx = Math.min(state.qIndex || 0, questions.length - 1);
  const q = questions[globalIdx];
  const total = questions.length;
  const answered = state.selectedOption !== undefined;

  const opts = (q.options || []).map((opt, i) => {
    let cls = "option-btn";
    if (answered) {
      if (i === q.correct) cls += " correct";
      else if (i === state.selectedOption) cls += " wrong";
      else cls += " dimmed";
    }
    return `<button class="${cls}" data-quiz-option="${i}" ${answered ? "disabled" : ""}>${opt}</button>`;
  }).join("");

  const feedback = answered
    ? `<div class="feedback-box">
         <div class="feedback-label">${state.selectedOption === q.correct ? "✅ Correct!" : "❌ Incorrect"}</div>
         <p class="feedback-exp">${q.explanation ?? ""}</p>
         <p class="feedback-ref">📖 ${q.ref ?? ""}</p>
       </div>`
    : "";

  const isLast = globalIdx + 1 >= total;
  const nextLabel = isLast ? "Finish ✔" : "Next Question →";
  const answeredCount = (state.quizAnswers ?? []).filter((a) => a !== undefined).length;

  return `
    <header class="top-bar">
      <button class="back-btn quiz-guard-back" data-goto="sections">← Back</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Quiz</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((globalIdx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${globalIdx + 1} of ${total}
        ${answeredCount > 0 ? `<span class="q-answered-badge">${answeredCount} answered</span>` : ""}
      </p>
      <div class="card question-card">
        <div class="q-card-header">
          <p class="q-text">${q.text ?? ""}</p>
          ${bookmarkBtn(makeBookmarkId({ subjectId: state.subjectId, yearId: state.yearId, semesterIndex: state.semesterIndex ?? 0, type: "mcq", flatIdx: globalIdx }), q.text)}
        </div>
        <div class="options-grid">${opts}</div>
        ${feedback}
        ${answered ? `<button class="btn-primary quiz-next-btn" data-is-last="${isLast}">${nextLabel}</button>` : ""}
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ── QUIZ SCORE SCREEN ─────────────────────────────────────────────────────────
function renderQuizScore() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  const quiz = getQuiz();
  if (!subject || !year || !sem || !quiz) return renderSubjects();

  const questions = quiz.questions;
  const score = state.quizScore ?? calcScore(state.quizAnswers, questions.length);
  const pct = score.percentage;

  const tier = pct >= 80 ? { emoji: "🏆", cls: "score-tier-gold", label: "Excellent!" } :
    pct >= 60 ? { emoji: "✅", cls: "score-tier-green", label: "Good job!" } :
      pct >= 40 ? { emoji: "📚", cls: "score-tier-amber", label: "Keep studying" } :
        { emoji: "💪", cls: "score-tier-red", label: "Don't give up!" };

  const reviewRows = questions.map((q, i) => {
    const ans = (state.quizAnswers ?? [])[i];
    const isOk = ans?.correct ?? false;
    const icon = ans === undefined ? "○" : (isOk ? "✅" : "❌");
    const cls = ans === undefined ? "skipped" : (isOk ? "correct" : "incorrect");
    const text = (q.text ?? "").length > 72 ? q.text.slice(0, 69) + "…" : (q.text ?? "");
    return `
      <div class="question-review-item" data-quiz-review-jump="${i}">
        <div class="question-indicator ${cls}">${icon}</div>
        <span class="review-q-text">${i + 1}. ${text}</span>
      </div>`;
  }).join("");

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="sections">← Done</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Quiz</p>
      <div class="score-card ${tier.cls}">
        <div class="score-emoji">${tier.emoji}</div>
        <div class="score-number">${score.correct}<span class="score-denom">/${score.total}</span></div>
        <div class="score-percentage">${pct}%</div>
        <div class="score-label">${tier.label}</div>
      </div>
      <div class="score-actions">
        <button class="btn-primary" id="btn-quiz-review-answers">📋 Review Answers</button>
        <button class="btn-secondary" id="btn-quiz-retry">🔄 Retry Quiz</button>
      </div>
      <h3 class="review-list-title">Question Breakdown</h3>
      <div class="question-review-list">${reviewRows}</div>
    </main>
    ${renderBottomNav()}`;
}

// ── QUIZ REVIEW SCREEN ────────────────────────────────────────────────────────
function renderQuizReview() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  const sem = getSemester();
  const quiz = getQuiz();
  if (!subject || !year || !sem || !quiz) return renderSubjects();

  const questions = quiz.questions;
  const globalIdx = Math.min(state.qIndex || 0, questions.length - 1);
  const q = questions[globalIdx];
  const total = questions.length;
  const ans = (state.quizAnswers ?? [])[globalIdx];
  const selected = ans?.selected;
  const isCorrect = ans?.correct ?? false;

  const opts = (q.options || []).map((opt, i) => {
    let cls = "option-btn";
    if (i === q.correct) cls += " correct";
    else if (i === selected) cls += " wrong";
    else cls += " dimmed";
    return `<button class="${cls}" disabled>${opt}</button>`;
  }).join("");

  const feedback = `
    <div class="feedback-box">
      <div class="feedback-label">${isCorrect ? "✅ You got this right" : "❌ You got this wrong"}</div>
      <p class="feedback-exp">${q.explanation ?? ""}</p>
      <p class="feedback-ref">?? ${q.ref ?? ""}</p>
    </div>`;

  const hasPrev = globalIdx > 0;
  const hasNext = globalIdx + 1 < total;

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="quizScore">← Score</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · ${sem.semester} · Quiz · Review</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((globalIdx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${globalIdx + 1} of ${total}
        <span class="review-mode-badge">Review</span>
      </p>
      <div class="card question-card">
        <div class="q-card-header">
          <p class="q-text">${q.text ?? ""}</p>
          ${bookmarkBtn(makeBookmarkId({ subjectId: state.subjectId, yearId: state.yearId, semesterIndex: state.semesterIndex ?? 0, type: "mcq", flatIdx: globalIdx }), q.text)}
        </div>
        <div class="options-grid">${opts}</div>
        ${feedback}
        <div class="review-nav">
          <button class="btn-secondary quiz-review-prev-btn" ${hasPrev ? "" : "disabled"}>← Prev</button>
          <button class="btn-primary quiz-review-next-btn" ${hasNext ? "" : "disabled"}>Next →</button>
        </div>
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ─── PRACTICE MODE SCREENS ───────────────────────────────────────────────────
function renderPracticeConfig() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const cfg = state.practiceCfg ?? {};
  const selType = cfg.type ?? "mcq";
  const selCount = cfg.count ?? 20;

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
      <button class="back-btn" data-goto="years">← Back</button>
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
          ${typeBtn("mcq",     "Section A (MCQ)",         "📝")}
          ${typeBtn("written", "Section B (Written)",     "✍️")}
          ${typeBtn("quiz",    "Mid-Semester Quiz",       "🎯")}
          ${typeBtn("both",    "Section A + B (Mixed)",   "📚")}
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

  const pool = state.practicePool ?? [];
  const idx = Math.min(state.practiceIndex ?? 0, pool.length - 1);
  const total = pool.length;
  if (!pool.length) return renderPracticeConfig();

  const entry = pool[idx];
  const pType = entry.pType;

  const answered = state.practiceSelectedOpt !== undefined;
  const showAnswer = state.practiceAnswerShown ?? false;
  const answeredCount = (state.practiceAnswers ?? []).filter((a) => a !== undefined).length;
  const isLast = idx + 1 >= total;

  let contentBlock = "";
  if (pType === "mcq") {
    const { q, item } = entry;
    const opts = (q.options || []).map((opt, i) => {
      let cls = "option-btn";
      if (answered) {
        if (i === q.correct) cls += " correct";
        else if (i === state.practiceSelectedOpt) cls += " wrong";
        else cls += " dimmed";
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
          ${isLast ? "Finish ✔" : "Next →"}
        </button>` : ""}
      </div>`;
  } else {
    const { q, parentLabel } = entry;
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
            ${isLast ? "Finish ✔" : "Next Question →"}
          </button>
        </div>` : "";

    contentBlock = `
      <div class="card question-card">
        <p class="practice-source-badge">${entry.yearLabel} · ${entry.semesterLabel}${parentLabel ? " · " + parentLabel : ""}</p>
        ${q?.marks ? `<div class="q-marks-row"><span class="q-marks">[${q.marks} marks]</span></div>` : ""}
        <div class="q-text">${renderQText(q?.text ?? "")}</div>
        ${!showAnswer ? `<button class="btn-primary prac-reveal-btn">Reveal Answer</button>` : answerBlock}
      </div>`;
  }

  return `
    <header class="top-bar">
      <button class="back-btn mcq-guard-back" data-goto="practiceConfig">← Exit</button>
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

  const pool = state.practicePool ?? [];
  const answers = state.practiceAnswers ?? [];
  const mcqItems = pool.filter((e) => e.pType === "mcq");
  const writtenItems = pool.filter((e) => e.pType === "written");

  const mcqAnswers = answers.filter((_, i) => pool[i]?.pType === "mcq");
  const score = calcScore(mcqAnswers, mcqItems.length);
  const pct = score.percentage;

  const tier = pct >= 80 ? { emoji: "🏆", cls: "score-tier-gold", label: "Excellent!" } :
    pct >= 60 ? { emoji: "✅", cls: "score-tier-green", label: "Good job!" } :
      pct >= 40 ? { emoji: "📚", cls: "score-tier-amber", label: "Keep studying" } :
        { emoji: "💪", cls: "score-tier-red", label: "Don't give up!" };

  const scoreBlock = mcqItems.length > 0
    ? `<div class="score-card ${tier.cls}">
        <div class="score-emoji">${tier.emoji}</div>
        <div class="score-number">${score.correct}<span class="score-denom">/${score.total}</span></div>
        <div class="score-percentage">${pct}%</div>
        <div class="score-label">${tier.label}</div>
      </div>`
    : `<div class="score-card score-tier-green">
        <div class="score-emoji">✅</div>
        <div class="score-number">${writtenItems.length}</div>
        <div class="score-percentage">Written Questions</div>
        <div class="score-label">Practice complete!</div>
      </div>`;

  const reviewRows = pool.map((entry, i) => {
    const ans = answers[i];
    if (entry.pType === "mcq") {
      const isOk = ans?.correct ?? false;
      const icon = ans === undefined ? "○" : (isOk ? "✅" : "❌");
      const cls = ans === undefined ? "skipped" : (isOk ? "correct" : "incorrect");
      const text = (entry.q?.text ?? "").length > 72 ? entry.q.text.slice(0, 69) + "…" : (entry.q?.text ?? "");
      return `
        <div class="question-review-item" data-prac-review-jump="${i}">
          <div class="question-indicator ${cls}">${icon}</div>
          <div class="review-item-body">
            <span class="review-q-text">${i + 1}. ${text}</span>
            <span class="practice-source-badge" style="margin-top:4px;display:inline-block">${entry.yearLabel} · ${entry.semesterLabel}</span>
          </div>
        </div>`;
    } else {
      const text = (entry.q?.text ?? "").length > 72 ? entry.q.text.slice(0, 69) + "…" : (entry.q?.text ?? "");
      return `
        <div class="question-review-item" data-prac-review-jump="${i}">
          <div class="question-indicator skipped">✍️</div>
          <div class="review-item-body">
            <span class="review-q-text">${i + 1}. ${text}</span>
            <span class="practice-source-badge" style="margin-top:4px;display:inline-block">${entry.yearLabel} · ${entry.semesterLabel}</span>
          </div>
        </div>`;
    }
  }).join("");

  const hasReviewable = pool.length > 0;

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="practiceConfig">← Done</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · Practice Mode · Results</p>
      ${scoreBlock}
      <div class="score-actions">
        ${hasReviewable ? `<button class="btn-primary" id="btn-prac-review">📋 Review Answers</button>` : ""}
        <button class="btn-secondary" id="btn-practice-again">🔄 Practice Again</button>
      </div>
      <h3 class="review-list-title">Question Breakdown</h3>
      <div class="question-review-list">${reviewRows}</div>
    </main>
    ${renderBottomNav()}`;
}

function renderPracticeReview() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const pool = state.practicePool ?? [];
  const idx = Math.min(state.practiceReviewIdx ?? 0, pool.length - 1);
  const total = pool.length;
  if (!pool.length) return renderPracticeScore();

  const entry = pool[idx];
  const answers = state.practiceAnswers ?? [];
  const hasPrev = idx > 0;
  const hasNext = idx + 1 < total;

  let contentBlock = "";

  if (entry.pType === "mcq") {
    const { q, item } = entry;
    const ans = answers[idx];
    const selected = ans?.selected;
    const isOk = ans?.correct ?? false;

    const caseBlock = item?.type === "case-group"
      ? `<div class="case-static">
           <div class="case-static-title">📄 ${item.caseStudy.title}</div>
           <div class="case-static-body">${(item.caseStudy.fullText ?? "")
        .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
         </div>` : "";

    const opts = (q.options || []).map((opt, i) => {
      let cls = "option-btn";
      if (i === q.correct) cls += " correct";
      else if (i === selected) cls += " wrong";
      else cls += " dimmed";
      return `<button class="${cls}" disabled>${opt}</button>`;
    }).join("");

    const feedback = `
      <div class="feedback-box">
        <div class="feedback-label">${isOk ? "✅ Correct" : ans === undefined ? "○ Not answered" : "❌ Incorrect"}</div>
        <p class="feedback-exp">${q.explanation ?? ""}</p>
        <p class="feedback-ref">📖 ${q.ref ?? ""}</p>
      </div>`;

    contentBlock = `
      ${caseBlock}
      <div class="card question-card">
        <p class="practice-source-badge">${entry.yearLabel} · ${entry.semesterLabel}</p>
        <p class="q-text">${q.text ?? ""}</p>
        <div class="options-grid">${opts}</div>
        ${feedback}
      </div>`;
  } else {
    const { q, parentLabel } = entry;
    const mainPts = (q?.answer?.mainPoints ?? []).map((p) => `
      <div class="answer-point"><strong>${p.heading}</strong><p>${p.detail}</p></div>`).join("");

    contentBlock = `
      <div class="card question-card">
        <p class="practice-source-badge">${entry.yearLabel} · ${entry.semesterLabel}${parentLabel ? " · " + parentLabel : ""}</p>
        ${q?.marks ? `<div class="q-marks-row"><span class="q-marks">[${q.marks} marks]</span></div>` : ""}
        <div class="q-text">${renderQText(q?.text ?? "")}</div>
        <div class="answer-block">
          ${q?.commandWord ? `<p class="command-word-label">Command Word: <strong>${q.commandWord}</strong></p>` : ""}
          ${q?.answer?.introduction ? `<div class="answer-section"><h4>Introduction</h4><p>${q.answer.introduction}</p></div>` : ""}
          <div class="answer-section"><h4>Main Points</h4>${mainPts}</div>
          ${q?.answer?.conclusion ? `<div class="answer-section"><h4>Conclusion</h4><p>${q.answer.conclusion}</p></div>` : ""}
          ${q?.answer?.ref ? `<p class="feedback-ref">📖 ${q.answer.ref}</p>` : ""}
        </div>
      </div>`;
  }

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="practiceScore">← Score</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight()}
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · Practice Mode · Review</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${idx + 1} of ${total}
        <span class="review-mode-badge">Review</span>
      </p>
      ${contentBlock}
      <div class="review-nav">
        <button class="btn-secondary prac-rev-prev" ${hasPrev ? "" : "disabled"}>← Prev</button>
        <button class="btn-primary prac-rev-next" ${hasNext ? "" : "disabled"}>Next →</button>
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ─── BOOKMARKS SCREEN ────────────────────────────────────────────────────────
function renderBookmarks() {
  const bookmarks = state.bookmarks ?? [];

  const groups = {};
  bookmarks.forEach((bm) => {
    if (!groups[bm.subjectId]) groups[bm.subjectId] = [];
    groups[bm.subjectId].push(bm);
  });

  const subjectOrder = DATA.subjects.map((s) => s.id);
  let listHTML = "";

  if (!bookmarks.length) {
    listHTML = `
      <div class="bm-empty">
        <div class="bm-empty-icon">🔖</div>
        <p class="bm-empty-title">No bookmarks yet</p>
        <p class="bm-empty-sub">Tap ☆ on any question while studying to save it here.</p>
      </div>`;
  } else {
    const orderedKeys = [
      ...subjectOrder.filter((id) => groups[id]),
      ...Object.keys(groups).filter((id) => !subjectOrder.includes(id)),
    ];

    orderedKeys.forEach((subjectId) => {
      const subj = DATA.subjects.find((s) => s.id === subjectId);
      const title = subj?.title ?? subjectId;
      const icon = subj?.icon ?? "📚";
      const items = groups[subjectId];

      const cards = items.map((bm) => {
        const typeLabel = bm.type === "mcq" ? "MCQ" : "Written";
        const typeCls = bm.type === "mcq" ? "bm-badge-mcq" : "bm-badge-written";
        const preview = bm.preview ?? "(no preview)";
        const meta = `${bm.yearLabel} · ${bm.semesterLabel}`;
        const dateStr = bm.timestamp
          ? new Date(bm.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : "";
        return `
          <div class="bm-item" data-bm-nav="${bm.id}">
            <div class="bm-item-main">
              <div class="bm-item-top">
                <span class="bm-type-badge ${typeCls}">${typeLabel}</span>
                <span class="bm-item-meta">${meta}</span>
                ${dateStr ? `<span class="bm-item-date">${dateStr}</span>` : ""}
              </div>
              <p class="bm-item-preview">${preview}</p>
            </div>
            <button class="bm-delete-btn" data-bm-delete="${bm.id}"
                    aria-label="Remove bookmark" title="Remove bookmark">✕</button>
          </div>`;
      }).join("");

      listHTML += `
        <div class="bm-group">
          <div class="bm-group-header">
            <span class="bm-group-icon">${icon}</span>
            <span class="bm-group-title">${title}</span>
            <span class="bm-group-count">${items.length}</span>
          </div>
          <div class="bm-group-items">${cards}</div>
        </div>`;
    });
  }

  const clearBtn = bookmarks.length > 0
    ? `<button class="btn-danger bm-clear-btn" id="btn-bm-clear-all">🗑 Clear All</button>`
    : "";

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="subjects">← Back</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight(false)}
    </header>
    <main class="screen">
      <h1 class="screen-title">Bookmarks
        ${bookmarks.length > 0 ? `<span class="bm-total-count">${bookmarks.length}</span>` : ""}
      </h1>
      ${clearBtn}
      <div class="bm-list">${listHTML}</div>
    </main>
    ${renderBottomNav()}`;
}

// ─── STATS DASHBOARD ────────────────────────────────────────────────────────
function renderStatsDashboard() {
  const examStats  = state.stats      ?? emptyStats();
  const quizStats  = state.quizStats  ?? emptyStats();

  const examSessions = examStats.sessions  ?? [];
  const quizSessions = quizStats.sessions  ?? [];
  const hasAnyData   = examSessions.length > 0 || quizSessions.length > 0;

  // ── Early return: no data yet ─────────────────────────────────────────────
  if (!hasAnyData) {
    return `
      <header class="top-bar">
        <button class="back-btn" data-goto="subjects">← Back</button>
        <div class="logo">ExamPrep</div>
        ${topBarRight(false)}
      </header>
      <main class="screen">
        <h1 class="screen-title">Statistics</h1>
        <div class="stats-empty">
          <div class="stats-empty-icon">📈</div>
          <p class="stats-empty-title">No data yet</p>
          <p class="stats-empty-sub">Complete a Section A quiz, a Mid-Semester Quiz, or a Practice session to start tracking your progress.</p>
        </div>
      </main>
      ${renderBottomNav()}`;
  }

  const activeTab = state.statsTab ?? "general";

  // ── helpers ──────────────────────────────────────────────────────────────
  function tabBtn(val, label) {
    const active = activeTab === val;
    return `<button class="stats-tab-btn${active ? " active" : ""}"
      data-stats-tab="${val}">${label}</button>`;
  }

  function sessionRows(list, limit) {
    return list.slice(0, limit).map((r) => {
      const isAbandoned = r.abandoned === true;
      const cls         = isAbandoned ? "amber" : scoreColorCls(r.score);
      const dateStr     = formatSessionDate(r.timestamp);
      const icon        = r.type === "practice" ? "🎯" : r.type === "quiz" ? "🏅" : "📝";
      const desc        = r.type === "practice"
        ? `Practice · ${r.subjectTitle}`
        : `${r.subjectTitle}${r.semesterLabel ? " · " + r.semesterLabel : ""}`;
      const badge   = isAbandoned
        ? `<span class="session-abandoned-badge">Abandoned · ${r.questionsAttempted ?? "?"} answered</span>`
        : "";
      const scoreEl = isAbandoned
        ? `<div class="session-score score-amber">—</div>`
        : `<div class="session-score score-${cls}">${r.score}%</div>`;
      return `
        <div class="session-row${isAbandoned ? " session-row-abandoned" : ""}">
          <div class="session-left">
            <div class="session-date">${icon} ${dateStr}</div>
            <div class="session-desc">${desc}</div>
            ${badge}
          </div>
          ${scoreEl}
        </div>`;
    }).join("");
  }

  function summaryGrid(agg) {
    const cls = scoreColorCls(agg.completedAverage);
    return `
      <div class="stats-grid stats-grid-2x2">
        <div class="stat-card">
          <div class="stat-value">${agg.completedSessions}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value score-${cls}">${agg.completedAverage}%</div>
          <div class="stat-label">Avg Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${agg.totalQuestionsAnswered}</div>
          <div class="stat-label">Questions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value${agg.abandonedSessions > 0 ? " score-amber" : ""}">${agg.abandonedSessions}</div>
          <div class="stat-label">Abandoned</div>
        </div>
      </div>`;
  }

  function trendChart(agg) {
    const activeDays = agg.byDay.filter((d) => d.count > 0).slice(-14);
    if (activeDays.length < 2) return "";
    const bars = activeDays.map((d) => {
      const h   = Math.max(4, Math.round((d.average / 100) * 120));
      const cls = scoreColorCls(d.average);
      const lbl = d.date.slice(5);
      return `
        <div class="bar-col" title="${lbl}: ${d.average}% (${d.count} session${d.count !== 1 ? "s" : ""})">
          <div class="bar-score">${d.average}%</div>
          <div class="bar bar-${cls}" style="height:${h}px"></div>
          <div class="bar-label">${lbl}</div>
        </div>`;
    }).join("");
    return `
      <div class="chart-card">
        <div class="chart-title">Score Trend — Recent Sessions</div>
        <div class="bar-chart">${bars}</div>
      </div>`;
  }

  function subjectBreakdown(agg) {
    const rows = Object.values(agg.bySubject).map((s) => {
      const cls  = scoreColorCls(s.average);
      const subj = DATA.subjects.find((d) => d.id === s.subjectId);
      const icon = subj?.icon ?? "📚";
      return `
        <div class="subj-row">
          <div class="subj-icon">${icon}</div>
          <div class="subj-info">
            <div class="subj-header">
              <span class="subj-name">${s.subjectTitle}</span>
              <span class="subj-score score-${cls}">${s.average}%</span>
            </div>
            <div class="subj-meta">${s.sessions} session${s.sessions !== 1 ? "s" : ""} · ${s.questions} questions</div>
            <div class="progress-bar-bg" style="margin-top:6px">
              <div class="progress-bar-fill pf-${cls}" style="width:${s.average}%"></div>
            </div>
          </div>
        </div>`;
    }).join("");
    if (!rows) return "";
    return `
      <div class="stats-section">
        <div class="stats-section-title">By Subject</div>
        <div class="stats-card subj-list">${rows}</div>
      </div>`;
  }

  function emptyPanel(msg) {
    return `<div class="stats-tab-empty">
      <div class="stats-empty-icon" style="font-size:2rem;opacity:0.4">📭</div>
      <p class="stats-empty-sub">${msg}</p>
    </div>`;
  }

  // ── Tab panel content ─────────────────────────────────────────────────────
  const tabBar = `
    <div class="stats-tab-bar">
      ${tabBtn("general",  "General")}
      ${tabBtn("quiz",     "Mid-Sem Quiz")}
      ${tabBtn("exam",     "End-Of-Sem Exam")}
    </div>`;

  let panelHTML = "";

  if (activeTab === "general") {
    // All sessions merged for overview
    const allSessions = [...examSessions, ...quizSessions]
      .sort((a, b) => b.timestamp - a.timestamp);
    const allAgg = calcAggregates(allSessions);
    if (!allSessions.length) {
      panelHTML = emptyPanel("Complete any quiz or exam session to see your overall progress here.");
    } else {
      panelHTML = summaryGrid(allAgg) + trendChart(allAgg) + subjectBreakdown(allAgg) + `
        <div class="stats-section">
          <div class="stats-section-title">Recent Activity</div>
          <div class="stats-card">${sessionRows(allSessions, 10)}</div>
        </div>`;
    }
  } else if (activeTab === "quiz") {
    const agg = quizStats.aggregates ?? calcAggregates(quizSessions);
    if (!quizSessions.length) {
      panelHTML = emptyPanel("No Mid-Semester Quiz sessions yet. Complete a quiz or practise using the Quiz question type.");
    } else {
      panelHTML = summaryGrid(agg) + trendChart(agg) + subjectBreakdown(agg) + `
        <div class="stats-section">
          <div class="stats-section-title">Quiz Sessions</div>
          <div class="stats-card">${sessionRows(quizSessions, 10)}</div>
        </div>`;
    }
  } else {
    // "exam" — section A exams and practice (non-quiz)
    const examAgg = examStats.aggregates ?? calcAggregates(examSessions);
    if (!examSessions.length) {
      panelHTML = emptyPanel("No End-of-Semester Exam sessions yet. Complete a Section A session or a practice session.");
    } else {
      panelHTML = summaryGrid(examAgg) + trendChart(examAgg) + subjectBreakdown(examAgg) + `
        <div class="stats-section">
          <div class="stats-section-title">Exam Sessions</div>
          <div class="stats-card">${sessionRows(examSessions, 10)}</div>
        </div>`;
    }
  }

  const footer = `
    <div class="stats-footer">
      <button class="reset-stats-btn" id="btn-reset-stats">Reset Statistics</button>
    </div>`;

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="subjects">← Back</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight(false)}
    </header>
    <main class="screen">
      <h1 class="screen-title">Statistics</h1>
      ${tabBar}
      ${panelHTML}
      ${footer}
    </main>
    ${renderBottomNav()}`;
}

// ── BOOKMARK VIEW (read-only) ───────────────────────────────────────────────
function renderBookmarkView() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  if (!subject || !year) return renderBookmarks();

  const sem = year.semesters?.[state.semesterIndex ?? 0];
  if (!sem) return renderBookmarks();

  const bmType = state.bmType ?? "mcq";
  const breadcrumb = `${subject.title} · ${year.label} · ${sem.semester}`;

  if (bmType === "mcq") {
    const flat = flattenSectionA(sem.sectionA);
    const idx = Math.min(state.bmFlatIdx ?? 0, flat.length - 1);
    if (!flat.length) return renderBookmarks();

    const { item, q } = flat[idx];

    const caseBlock = item.type === "case-group"
      ? `<div class="case-static">
           <div class="case-static-title">📄 ${item.caseStudy.title}</div>
           <div class="case-static-body">${(item.caseStudy.fullText ?? "")
        .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
         </div>`
      : "";

    const opts = (q.options || []).map((opt, i) => {
      const cls = i === q.correct ? "option-btn correct" : "option-btn dimmed";
      return `<button class="${cls}" disabled>${opt}</button>`;
    }).join("");

    const infoBlock = `
      <div class="bv-info-block">
        <span class="bv-correct-label">✅ Correct answer highlighted</span>
        ${q.explanation ? `<p class="feedback-exp bv-explanation">${q.explanation}</p>` : ""}
        ${q.ref ? `<p class="feedback-ref">📖 ${q.ref}</p>` : ""}
      </div>`;

    return `
      <header class="top-bar">
        <button class="back-btn" data-goto="bookmarks">← Bookmarks</button>
        <div class="logo">ExamPrep</div>
        ${topBarRight(false)}
      </header>
      <main class="screen">
        <p class="breadcrumb">${breadcrumb} · Section A</p>
        <div class="bv-mode-badge">Bookmark · Read Only</div>
        ${caseBlock}
        <div class="card question-card">
          <p class="q-text">${q.text ?? ""}</p>
          <div class="options-grid">${opts}</div>
          ${infoBlock}
        </div>
      </main>
      ${renderBottomNav()}`;
  }

  const sectionB = sem.sectionB;
  if (!sectionB) return renderBookmarks();

  const isGrouped = sectionB.format === "grouped";
  let q, cs, parentLabel;

  if (isGrouped) {
    const parent = sectionB.questions[state.bmParentIdx ?? 0];
    if (!parent) return renderBookmarks();
    const subs = parent.subQuestions ?? [];
    const subIdx = Math.min(state.bmSubQIdx ?? 0, subs.length - 1);
    q = subs[subIdx];
    cs = parent.caseStudy ?? null;
    parentLabel = parent.label ?? "";
  } else {
    const questions = sectionB.questions ?? [];
    q = questions[Math.min(state.bmSubQIdx ?? 0, questions.length - 1)];
    cs = sectionB.caseStudy ?? null;
    parentLabel = "";
  }

  if (!q) return renderBookmarks();

  const caseBlock = cs
    ? `<details class="case-study-details" open>
         <summary class="case-summary">📄 ${cs.title}</summary>
         <div class="case-body">${(cs.fullText ?? "")
      .replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
       </details>`
    : "";

  const keyFactsBlock = cs?.keyFacts?.length
    ? `<details class="case-study-details keyfacts-details" open>
         <summary class="case-summary keyfacts-summary">🔑 Key Facts</summary>
         <ul class="keyfacts-list">${cs.keyFacts.map((f) => `<li>${f}</li>`).join("")}</ul>
       </details>`
    : "";

  const mainPts = (q.answer?.mainPoints ?? []).map((p) => `
    <div class="answer-point">
      <strong>${p.heading}</strong>
      <p>${p.detail}</p>
    </div>`).join("");

  const otherAnswers = q.answer?.otherPossibleAnswers && q.answer.otherPossibleAnswers !== "N/A"
    ? `<div class="answer-section other-answers">
         <h4>Other Possible Answers</h4>
         <p>${q.answer.otherPossibleAnswers}</p>
       </div>` : "";

  const answerBlock = `
    <div class="answer-block">
      ${q.commandWord ? `<p class="command-word-label">Command Word: <strong>${q.commandWord}</strong></p>` : ""}
      ${q.answer?.introduction ? `<div class="answer-section"><h4>Introduction</h4><p>${q.answer.introduction}</p></div>` : ""}
      <div class="answer-section"><h4>Main Points</h4>${mainPts}</div>
      ${q.answer?.conclusion ? `<div class="answer-section"><h4>Conclusion</h4><p>${q.answer.conclusion}</p></div>` : ""}
      ${otherAnswers}
      ${q.answer?.ref ? `<p class="feedback-ref">📖 ${q.answer.ref}</p>` : ""}
    </div>`;

  const bcSuffix = parentLabel ? ` · ${parentLabel}` : "";

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="bookmarks">← Bookmarks</button>
      <div class="logo">ExamPrep</div>
      ${topBarRight(false)}
    </header>
    <main class="screen">
      <p class="breadcrumb">${breadcrumb} · Section B${bcSuffix}</p>
      <div class="bv-mode-badge">Bookmark · Read Only</div>
      ${caseBlock}
      ${keyFactsBlock}
      <div class="card question-card">
        ${q.marks ? `<div class="q-marks-row"><span class="q-marks">[${q.marks} marks]</span></div>` : ""}
        <div class="q-text">${renderQText(q.text ?? "")}</div>
        ${answerBlock}
      </div>
    </main>
    ${renderBottomNav()}`;
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function bindEvents() {
  const app = document.getElementById("app");

  app.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", toggleTheme);
  });

  const openSearchBtn = app.querySelector("#open-search-btn");
  if (openSearchBtn) {
    openSearchBtn.addEventListener("click", showSearchOverlay);
  }

  app.querySelectorAll("[data-nav]").forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      const target = btn.dataset.target;
      if (nav === "home") {
        guardMCQLeave(() => go("subjects"));
      } else if (nav === "current" && target) {
        go(target);
      } else if (nav === "bookmarks") {
        go("bookmarks");
      } else if (nav === "stats") {
        go("stats");
      }
    });
  });

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

  app.querySelectorAll("[data-practice-type]").forEach((el) => {
    el.addEventListener("click", () => {
      const cfg = { ...(state.practiceCfg ?? {}), type: el.dataset.practiceType };
      state = saveState({ practiceCfg: cfg });
      render();
    });
  });

  app.querySelectorAll("[data-practice-count]").forEach((el) => {
    el.addEventListener("click", () => {
      const cfg = { ...(state.practiceCfg ?? {}), count: parseInt(el.dataset.practiceCount) };
      state = saveState({ practiceCfg: cfg });
      render();
    });
  });

  const btnStartPractice = app.querySelector("#btn-start-practice");
  if (btnStartPractice) {
    btnStartPractice.addEventListener("click", () => {
      const cfg = state.practiceCfg ?? { type: "mcq", count: 20 };
      const type = cfg.type ?? "mcq";
      const count = cfg.count ?? 20;

      let pool = [];
      if (type === "mcq" || type === "both") {
        buildMCQPool(state.subjectId).forEach((e) => pool.push({ ...e, pType: "mcq" }));
      }
      if (type === "written" || type === "both") {
        buildWrittenPool(state.subjectId).forEach((e) => pool.push({ ...e, pType: "written" }));
      }
      if (type === "quiz") {
        buildQuizPool(state.subjectId).forEach((e) => pool.push({ ...e, pType: "mcq" }));
      }

      pool = shuffleArray(pool);
      if (count > 0) pool = pool.slice(0, count);

      if (!pool.length) {
        showConfirmDialog("No questions available for the selected options. Try loading more year data.", () => { });
        return;
      }

      state = saveState({
        screen: "practiceSession",
        practicePool: pool,
        practiceIndex: 0,
        practiceAnswers: [],
        practiceSelectedOpt: undefined,
        practiceAnswerShown: false,
        mcqSessionActive: true,
      });
      render();
    });
  }

  app.querySelectorAll("[data-prac-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const selected = parseInt(el.dataset.pracOption);
      const pool = state.practicePool ?? [];
      const idx = state.practiceIndex ?? 0;
      const entry = pool[idx];
      const isOk = selected === entry?.q?.correct;
      const answers = [...(state.practiceAnswers ?? [])];
      answers[idx] = { selected, correct: isOk };
      state = saveState({ practiceSelectedOpt: selected, practiceAnswers: answers });
      render();
    });
  });

  const pracRevealBtn = app.querySelector(".prac-reveal-btn");
  if (pracRevealBtn) {
    pracRevealBtn.addEventListener("click", () => {
      state = saveState({ practiceAnswerShown: true });
      render();
    });
  }

  const pracNextBtn = app.querySelector(".prac-next-btn");
  if (pracNextBtn) {
    pracNextBtn.addEventListener("click", () => {
      const isLast = pracNextBtn.dataset.isLast === "true";
      if (isLast) {
        const pool    = state.practicePool ?? [];
        const answers = state.practiceAnswers ?? [];
        const mcqQ    = pool.filter((e) => e.pType === "mcq");
        const mcqAns  = answers.filter((_, i) => pool[i]?.pType === "mcq");
        const mcqCorr = mcqAns.filter((a) => a?.correct).length;
        const subj    = DATA.subjects.find((s) => s.id === state.subjectId);
        const isQuizPractice = (state.practiceCfg?.type ?? "mcq") === "quiz";

        const practSession = {
          id:             makeSessionId(),
          timestamp:      Date.now(),
          type:           isQuizPractice ? "quiz" : "practice",
          subjectId:      state.subjectId ?? "",
          subjectTitle:   subj?.title ?? "",
          totalQuestions: mcqQ.length,
          correctAnswers: mcqCorr,
          score:          mcqQ.length > 0 ? Math.round((mcqCorr / mcqQ.length) * 100) : 0,
          completed:      true,
          abandoned:      false,
          questionsAttempted: mcqQ.length,
        };

        let savePayload = { screen: "practiceScore", mcqSessionActive: false };
        if (isQuizPractice) {
          savePayload.quizStats = addSessionToStats(state.quizStats ?? emptyStats(), practSession);
        } else {
          savePayload.stats = addSessionToStats(state.stats, practSession);
        }
        state = saveState(savePayload);
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

  const btnPracReview = app.querySelector("#btn-prac-review");
  if (btnPracReview) {
    btnPracReview.addEventListener("click", () =>
      go("practiceReview", { practiceReviewIdx: 0 })
    );
  }

  app.querySelectorAll("[data-prac-review-jump]").forEach((el) => {
    el.addEventListener("click", () =>
      go("practiceReview", { practiceReviewIdx: parseInt(el.dataset.pracReviewJump) })
    );
  });

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

  const btnPracticeAgain = app.querySelector("#btn-practice-again");
  if (btnPracticeAgain) {
    btnPracticeAgain.addEventListener("click", () => {
      go("practiceConfig");
    });
  }

  app.querySelectorAll("[data-bm-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const bmId = btn.dataset.bmId;
      const subject = DATA.subjects.find((s) => s.id === state.subjectId);
      const yr = subject?.years.find((y) => y.id === state.yearId);
      const sem = getSemester();
      const bmData = {
        id: bmId,
        subjectId: state.subjectId,
        yearId: state.yearId,
        semesterIndex: state.semesterIndex ?? 0,
        subjectTitle: subject?.title ?? "",
        yearLabel: yr?.label ?? "",
        semesterLabel: sem?.semester ?? "",
        preview: (btn.dataset.bmText ?? "").slice(0, 80),
      };
      const parts = bmId.split("|");
      bmData.type = parts[3] ?? "mcq";
      if (bmData.type === "mcq") {
        bmData.flatIdx = parseInt(parts[4] ?? "0");
      } else {
        bmData.parentIdx = parseInt(parts[4] ?? "0");
        bmData.subQIdx = parseInt(parts[5] ?? "0");
      }
      toggleBookmark(bmData);
      const nowActive = isBookmarked(bmId);
      btn.textContent = nowActive ? "★" : "☆";
      btn.classList.toggle("bm-active", nowActive);
      btn.setAttribute("aria-label", nowActive ? "Remove bookmark" : "Bookmark this question");
      btn.setAttribute("title", nowActive ? "Remove bookmark" : "Bookmark this question");
      document.querySelectorAll(".bm-nav-count").forEach((el) => {
        const cnt = (state.bookmarks ?? []).length;
        el.textContent = cnt > 0 ? cnt : "";
        el.style.display = cnt > 0 ? "" : "none";
      });
    });
  });

  app.querySelectorAll("[data-bm-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-bm-delete]")) return;
      const bmId = el.dataset.bmNav;
      const bm = (state.bookmarks ?? []).find((b) => b.id === bmId);
      if (bm) navigateToBookmark(bm);
    });
  });

  app.querySelectorAll("[data-bm-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const bmId = btn.dataset.bmDelete;
      const bookmarks = (state.bookmarks ?? []).filter((b) => b.id !== bmId);
      state = saveState({ bookmarks });
      render();
    });
  });

  const btnClearAll = app.querySelector("#btn-bm-clear-all");
  if (btnClearAll) {
    btnClearAll.addEventListener("click", () => {
      showConfirmDialog(
        "Remove all bookmarks? This cannot be undone.",
        () => {
          state = saveState({ bookmarks: [] });
          render();
        }
      );
    });
  }

  const btnResetStats = app.querySelector("#btn-reset-stats");
  if (btnResetStats) {
    btnResetStats.addEventListener("click", () => {
      showConfirmDialog(
        "Reset all statistics? This cannot be undone.",
        () => {
          state = saveState({ stats: emptyStats(), quizStats: emptyStats() });
          render();
        }
      );
    });
  }

  // Stats tab switcher
  app.querySelectorAll("[data-stats-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state = saveState({ statsTab: btn.dataset.statsTab });
      render();
    });
  });

  app.querySelectorAll("[data-subject]").forEach((el) => {
    el.addEventListener("click", () =>
      go("years", { subjectId: el.dataset.subject, yearId: undefined, qIndex: 0 })
    );
  });

  app.querySelectorAll("[data-year]").forEach((el) => {
    el.addEventListener("click", () => goYear(el.dataset.year));
  });

  app.querySelectorAll("[data-semester]").forEach((el) => {
    el.addEventListener("click", () =>
      go("sections", { semesterIndex: parseInt(el.dataset.semester), qIndex: 0 })
    );
  });

  app.querySelectorAll("[data-section]").forEach((el) => {
    el.addEventListener("click", () => {
      const section = el.dataset.section;
      if (section === "quiz") {
        const sem = getSemester();
        const quiz = getQuiz();
        if (!quiz || !quiz.questions.length) return;
        state = saveState({
          quizAnswers: [],
          quizSessionActive: true,
          quizCompleted: false,
          quizScore: null,
          selectedOption: undefined,
        });
        go("quiz", {
          qIndex: 0,
          selectedOption: undefined,
          quizAnswers: [],
          quizSessionActive: true,
          quizCompleted: false,
          quizScore: null,
        });
        return;
      }
      if (section === "A") {
        state = saveState({
          mcqAnswers: [], mcqSessionActive: true,
          mcqCompleted: false, mcqScore: null,
          selectedOption: undefined,
        });
        go("mcq", {
          section, qIndex: 0, selectedOption: undefined,
          mcqAnswers: [], mcqSessionActive: true,
          mcqCompleted: false, mcqScore: null
        });
        return;
      }
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

  app.querySelectorAll("[data-goto]").forEach((el) => {
    if (el.classList.contains("mcq-guard-back")) return;
    el.addEventListener("click", () => go(el.dataset.goto));
  });

  app.querySelectorAll("[data-written-q]").forEach((el) => {
    el.addEventListener("click", () => {
      go("written", {
        qIndex: parseInt(el.dataset.writtenQ),
        subQIndex: 0,
        answerRevealed: false,
        selfRating: undefined,
        caseOpen: false,
        keyFactsOpen: false,
      });
    });
  });

  app.querySelectorAll("[data-subq]").forEach((el) => {
    el.addEventListener("click", () => {
      go("written", {
        subQIndex: parseInt(el.dataset.subq),
        answerRevealed: false,
        selfRating: undefined,
        caseOpen: state.caseOpen,
        keyFactsOpen: state.keyFactsOpen,
      });
    });
  });

  app.querySelectorAll("[data-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const selected = parseInt(el.dataset.option);
      const sem = getSemester();
      const flat = flattenSectionA(sem?.sectionA);
      const idx = state.qIndex || 0;
      const { q } = flat[idx] ?? {};
      const isOk = selected === q?.correct;
      recordMCQAnswer(idx, selected, isOk);
      state = saveState({ selectedOption: selected });
      render();
    });
  });

  app.querySelectorAll("[data-quiz-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const selected = parseInt(el.dataset.quizOption);
      const quiz = getQuiz();
      if (!quiz) return;
      const idx = state.qIndex || 0;
      const q = quiz.questions[idx];
      const isOk = selected === q?.correct;
      recordQuizAnswer(idx, selected, isOk);
      state = saveState({ selectedOption: selected });
      render();
    });
  });

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

  const quizNextBtn = app.querySelector(".quiz-next-btn");
  if (quizNextBtn) {
    quizNextBtn.addEventListener("click", () => {
      const isLast = quizNextBtn.dataset.isLast === "true";
      if (isLast) {
        finishQuizSession();
      } else {
        const nextIdx = (state.qIndex || 0) + 1;
        go("quiz", { qIndex: nextIdx, selectedOption: undefined });
      }
    });
  }

  const mcqGuardBack = app.querySelector(".mcq-guard-back");
  if (mcqGuardBack) {
    mcqGuardBack.addEventListener("click", (e) => {
      e.stopImmediatePropagation();
      guardMCQLeave(() => go(mcqGuardBack.dataset.goto));
    });
  }

  const quizGuardBack = app.querySelector(".quiz-guard-back");
  if (quizGuardBack) {
    quizGuardBack.addEventListener("click", (e) => {
      e.stopImmediatePropagation();
      guardQuizLeave(() => go(quizGuardBack.dataset.goto));
    });
  }

  const btnReview = app.querySelector("#btn-review-answers");
  if (btnReview) {
    btnReview.addEventListener("click", () =>
      go("mcqReview", { qIndex: 0 })
    );
  }

  const btnRetry = app.querySelector("#btn-retry-section");
  if (btnRetry) {
    btnRetry.addEventListener("click", () => startMCQSession());
  }

  const btnQuizReview = app.querySelector("#btn-quiz-review-answers");
  if (btnQuizReview) {
    btnQuizReview.addEventListener("click", () => go("quizReview", { qIndex: 0 }));
  }

  const btnQuizRetry = app.querySelector("#btn-quiz-retry");
  if (btnQuizRetry) {
    btnQuizRetry.addEventListener("click", () => startQuizSession());
  }

  app.querySelectorAll("[data-review-jump]").forEach((el) => {
    el.addEventListener("click", () =>
      go("mcqReview", { qIndex: parseInt(el.dataset.reviewJump) })
    );
  });

  app.querySelectorAll("[data-quiz-review-jump]").forEach((el) => {
    el.addEventListener("click", () =>
      go("quizReview", { qIndex: parseInt(el.dataset.quizReviewJump) })
    );
  });

  const prevBtn = app.querySelector(".review-prev-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      go("mcqReview", { qIndex: Math.max(0, (state.qIndex || 0) - 1) });
    });
  }

  const revNextBtn = app.querySelector(".review-next-btn");
  if (revNextBtn) {
    revNextBtn.addEventListener("click", () => {
      const sem = getSemester();
      const total = flattenSectionA(sem?.sectionA).length;
      go("mcqReview", { qIndex: Math.min(total - 1, (state.qIndex || 0) + 1) });
    });
  }

  const quizRevPrev = app.querySelector(".quiz-review-prev-btn");
  if (quizRevPrev) {
    quizRevPrev.addEventListener("click", () => {
      go("quizReview", { qIndex: Math.max(0, (state.qIndex || 0) - 1) });
    });
  }

  const quizRevNext = app.querySelector(".quiz-review-next-btn");
  if (quizRevNext) {
    quizRevNext.addEventListener("click", () => {
      const quiz = getQuiz();
      const total = quiz?.questions?.length ?? 0;
      go("quizReview", { qIndex: Math.min(total - 1, (state.qIndex || 0) + 1) });
    });
  }

  const revealBtn = app.querySelector(".reveal-btn");
  if (revealBtn) {
    revealBtn.addEventListener("click", () => {
      state = saveState({ answerRevealed: true });
      render();
    });
  }

  app.querySelectorAll("[data-rating]").forEach((el) => {
    el.addEventListener("click", () => {
      state = saveState({ selfRating: el.dataset.rating });
      render();
    });
  });

  const caseDetails = app.querySelector(".case-study-details:not(.keyfacts-details)");
  if (caseDetails) {
    caseDetails.addEventListener("toggle", () => {
      state = saveState({ caseOpen: caseDetails.open });
    });
  }

  const keyFactsDetails = app.querySelector(".keyfacts-details");
  if (keyFactsDetails) {
    keyFactsDetails.addEventListener("toggle", () => {
      state = saveState({ keyFactsOpen: keyFactsDetails.open });
    });
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  showLoading("Starting up…");

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

  if (state.subjectId && state.yearId) {
    try {
      await loadYear(state.subjectId, state.yearId);
    } catch {
      state = saveState({ screen: "subjects", yearId: undefined, semesterIndex: undefined });
    }
  }

  if (!state.screen) state = saveState({ screen: "subjects" });

  if (state.screen === "written" || state.screen === "written-questions") {
    const subj = DATA.subjects.find((s) => s.id === state.subjectId);
    const yr = subj?.years.find((y) => y.id === state.yearId);
    const sem = yr?.semesters?.[state.semesterIndex ?? 0];
    const isGrouped = sem?.sectionB?.format === "grouped";
    if (isGrouped && state.screen !== "written-questions" && state.qIndex === undefined) {
      state = saveState({ screen: "written-questions" });
    }
  }

  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { scope: "./" })
      .catch((err) => console.warn("SW registration failed:", err));
  }
});