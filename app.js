// ─── DATA ────────────────────────────────────────────────────────────────────
const DATA = {
  subjects: [
    {
      id: "entrepreneurship",
      title: "Entrepreneurship",
      code: "SBU 408D",
      icon: "🚀",
      years: [
        {
          id: "2023-2024",
          label: "2023 / 2024",
          sectionA: {
            questions: [
              {
                id: "a1",
                text: "When was the connection between risk and entrepreneurship established?",
                options: [
                  "Before the Middle Ages",
                  "In the 17th century",
                  "In the 18th century",
                  "During the 19th century",
                ],
                correct: 1,
                explanation:
                  "The connection between risk and entrepreneurship was established in the 17th century, when the entrepreneur entered into a contract with the government to manage large projects for a fixed price.",
                ref: "Unit 1, Session 1, 1.1 - The Evolution of Entrepreneur and Entrepreneurship.",
              },
              {
                id: "a2",
                text: "What distinguishes novice entrepreneurs from others? They ______.",
                options: [
                  "Have vocational qualifications",
                  "Have prior experience as business founders",
                  "Currently own minority or majority equity in a business",
                  "Only own businesses that are new",
                ],
                correct: 2,
                explanation:
                  "Novice entrepreneurs are individuals with no prior business ownership experience who currently own a minority or majority equity stake in a business that is new, purchased, or inherited.",
                ref: "Unit 1, Session 1, 1.3 - Types of Entrepreneurs.",
              },
            ],
          },
          sectionB: {
            caseStudy: {
              title: "Case Study: College – The Ideal Place to Launch a Business",
              body: `For growing numbers of students, college is not just a time of learning and growing into young adulthood — it is fast becoming a place for building a business. More than 2,300 colleges offer courses in entrepreneurship to over 400,000 students.

While studying at University of Cape Coast, Ama Bediako worked in internships at "Abrontentan Ltd," which offered her a marketing position upon graduation. Ama turned down the offer to focus on EagleEye Ltd — an online magazine showcasing discoveries, inventions, and new businesses — that she had started with classmates Araba Aikins and Konadu Yiadom.

EagleEye Ltd is now profitable, and the founders were named to Inc. magazine's "30 Under 30 Coolest Young Entrepreneurs." However, unanticipated problems arose, including profit-sharing disputes with a dormant partner. The team is also seeking GHC 100,000 from private investors to fuel growth without giving up equity too early.`,
            },
            questions: [
              {
                id: "b1",
                text: "Discuss four types/categories of business information that a small enterprise should process to enhance the survival of their businesses.",
                marks: 16,
                answer: {
                  introduction:
                    "Small enterprises need various types of information to make informed decisions and ensure long-term survival in competitive markets.",
                  mainPoints: [
                    {
                      heading: "Market Information",
                      detail:
                        "Data on market size, growth, consumer spending power, needs, and behaviour. This helps in new product development, marketing planning, and identifying opportunities.",
                    },
                    {
                      heading: "Competitor Information",
                      detail:
                        "Information about competitors' locations, activities, and performance. This is vital for strategic positioning and responding to competitive threats.",
                    },
                    {
                      heading: "Supplier Information",
                      detail:
                        "Data on supplier cost, reliability, quality, and delivery speed. This ensures smooth production and effective planning for raw material needs.",
                    },
                    {
                      heading: "Production Information",
                      detail:
                        "Internal data on production efficiency, cost, wastage, and quality. This helps ensure the business can deliver the volume and quality promised to customers.",
                    },
                  ],
                  conclusion:
                    "Processing these information types helps small enterprises reduce risk and make better strategic decisions, turning information into a key competitive asset.",
                  ref: "Unit 4, Session 3, 3.2 - Types of Business Information.",
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const STATE_KEY = "examprep_state";

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(patch) {
  const s = { ...loadState(), ...patch };
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
  return s;
}

let state = loadState();

// ─── ROUTER ───────────────────────────────────────────────────────────────────
const screens = {
  subjects: renderSubjects,
  years: renderYears,
  sections: renderSections,
  mcq: renderMCQ,
  written: renderWritten,
};

function go(screen, patch = {}) {
  state = saveState({ screen, ...patch });
  render();
}

function render() {
  const fn = screens[state.screen] || renderSubjects;
  document.getElementById("app").innerHTML = fn();
  bindEvents();
}

// ─── SCREENS ──────────────────────────────────────────────────────────────────

function renderSubjects() {
  const cards = DATA.subjects
    .map(
      (s) => `
    <button class="card subject-card" data-subject="${s.id}">
      <span class="card-icon">${s.icon}</span>
      <span class="card-title">${s.title}</span>
      <span class="card-code">${s.code}</span>
    </button>`
    )
    .join("");

  return `
    <header class="top-bar">
      <div class="logo">ExamPrep</div>
      <div class="tagline">Study smarter. Pass with confidence.</div>
    </header>
    <main class="screen">
      <h1 class="screen-title">Choose a Subject</h1>
      <div class="card-grid">${cards}</div>
    </main>`;
}

function renderYears() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  if (!subject) return renderSubjects();

  const cards = subject.years
    .map(
      (y) => `
    <button class="card year-card" data-year="${y.id}">
      <span class="card-year-label">${y.label}</span>
      <span class="card-year-sub">Academic Year</span>
    </button>`
    )
    .join("");

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="subjects">← Back</button>
      <div class="logo">ExamPrep</div>
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title}</p>
      <h1 class="screen-title">Select Academic Year</h1>
      <div class="card-grid">${cards}</div>
    </main>`;
}

function renderSections() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  if (!subject || !year) return renderSubjects();

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="years">← Back</button>
      <div class="logo">ExamPrep</div>
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label}</p>
      <h1 class="screen-title">Select a Section</h1>
      <div class="card-grid">
        <button class="card section-card" data-section="A">
          <span class="section-badge">A</span>
          <span class="card-title">Section A</span>
          <span class="card-sub">Multiple Choice · ${year.sectionA.questions.length} Questions</span>
        </button>
        <button class="card section-card" data-section="B">
          <span class="section-badge">B</span>
          <span class="card-title">Section B</span>
          <span class="card-sub">Written · ${year.sectionB.questions.length} Question${year.sectionB.questions.length > 1 ? "s" : ""}</span>
        </button>
      </div>
    </main>`;
}

function renderMCQ() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  if (!subject || !year) return renderSubjects();

  const questions = year.sectionA.questions;
  const idx = Math.min(state.qIndex || 0, questions.length - 1);
  const q = questions[idx];
  const answered = state.selectedOption !== undefined;
  const total = questions.length;

  const opts = q.options
    .map((opt, i) => {
      let cls = "option-btn";
      if (answered) {
        if (i === q.correct) cls += " correct";
        else if (i === state.selectedOption && i !== q.correct) cls += " wrong";
        else cls += " dimmed";
      }
      return `<button class="${cls}" data-option="${i}" ${answered ? "disabled" : ""}>${opt}</button>`;
    })
    .join("");

  const feedback = answered
    ? `<div class="feedback-box">
        <div class="feedback-label">${state.selectedOption === q.correct ? "✅ Correct!" : "❌ Incorrect"}</div>
        <p class="feedback-exp">${q.explanation}</p>
        <p class="feedback-ref">📖 ${q.ref}</p>
       </div>`
    : "";

  const nextLabel = idx + 1 < total ? "Next Question →" : "Finish";

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="sections">← Back</button>
      <div class="logo">ExamPrep</div>
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · Section A</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div>
      </div>
      <p class="q-counter">Question ${idx + 1} of ${total}</p>
      <div class="card question-card">
        <p class="q-text">${q.text}</p>
        <div class="options-grid">${opts}</div>
        ${feedback}
        ${answered ? `<button class="btn-primary next-btn">${nextLabel}</button>` : ""}
      </div>
    </main>`;
}

function renderWritten() {
  const subject = DATA.subjects.find((s) => s.id === state.subjectId);
  const year = subject?.years.find((y) => y.id === state.yearId);
  if (!subject || !year) return renderSubjects();

  const questions = year.sectionB.questions;
  const idx = Math.min(state.qIndex || 0, questions.length - 1);
  const q = questions[idx];
  const cs = year.sectionB.caseStudy;
  const showAnswer = state.answerRevealed;
  const rating = state.selfRating;

  const mainPts = q.answer.mainPoints
    .map(
      (p) => `<div class="answer-point">
      <strong>${p.heading}</strong>
      <p>${p.detail}</p>
    </div>`
    )
    .join("");

  const answerBlock = showAnswer
    ? `<div class="answer-block">
        <div class="answer-section">
          <h4>Introduction</h4>
          <p>${q.answer.introduction}</p>
        </div>
        <div class="answer-section">
          <h4>Main Points</h4>
          ${mainPts}
        </div>
        <div class="answer-section">
          <h4>Conclusion</h4>
          <p>${q.answer.conclusion}</p>
        </div>
        <p class="feedback-ref">📖 ${q.answer.ref}</p>
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

  return `
    <header class="top-bar">
      <button class="back-btn" data-goto="sections">← Back</button>
      <div class="logo">ExamPrep</div>
    </header>
    <main class="screen">
      <p class="breadcrumb">${subject.title} · ${year.label} · Section B</p>

      <details class="case-study-details" ${state.caseOpen ? "open" : ""}>
        <summary class="case-summary">📄 ${cs.title}</summary>
        <div class="case-body">${cs.body.replace(/\n\n/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>")}</div>
      </details>

      <div class="card question-card">
        <div class="q-marks-row">
          <span class="q-marks">[${q.marks} marks]</span>
        </div>
        <p class="q-text">${q.text}</p>

        ${!showAnswer
          ? `<button class="btn-primary reveal-btn">Reveal Structured Answer</button>`
          : ""}
        ${answerBlock}
      </div>
    </main>`;
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function bindEvents() {
  const app = document.getElementById("app");

  // Subject select
  app.querySelectorAll("[data-subject]").forEach((el) => {
    el.addEventListener("click", () =>
      go("years", { subjectId: el.dataset.subject, yearId: undefined, qIndex: 0 })
    );
  });

  // Year select
  app.querySelectorAll("[data-year]").forEach((el) => {
    el.addEventListener("click", () =>
      go("sections", { yearId: el.dataset.year, qIndex: 0 })
    );
  });

  // Section select
  app.querySelectorAll("[data-section]").forEach((el) => {
    el.addEventListener("click", () => {
      const section = el.dataset.section;
      go(section === "A" ? "mcq" : "written", {
        section,
        qIndex: 0,
        selectedOption: undefined,
        answerRevealed: false,
        selfRating: undefined,
        caseOpen: false,
      });
    });
  });

  // Back button
  app.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => go(el.dataset.goto));
  });

  // MCQ option
  app.querySelectorAll("[data-option]").forEach((el) => {
    el.addEventListener("click", () => {
      const opt = parseInt(el.dataset.option);
      state = saveState({ selectedOption: opt });
      render();
    });
  });

  // MCQ next
  const nextBtn = app.querySelector(".next-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const subject = DATA.subjects.find((s) => s.id === state.subjectId);
      const year = subject?.years.find((y) => y.id === state.yearId);
      const questions = year.sectionA.questions;
      const nextIdx = (state.qIndex || 0) + 1;
      if (nextIdx < questions.length) {
        go("mcq", { qIndex: nextIdx, selectedOption: undefined });
      } else {
        go("sections");
      }
    });
  }

  // Reveal answer
  const revealBtn = app.querySelector(".reveal-btn");
  if (revealBtn) {
    revealBtn.addEventListener("click", () => {
      state = saveState({ answerRevealed: true });
      render();
    });
  }

  // Self rating
  app.querySelectorAll("[data-rating]").forEach((el) => {
    el.addEventListener("click", () => {
      state = saveState({ selfRating: el.dataset.rating });
      render();
    });
  });

  // Case study toggle
  const details = app.querySelector(".case-study-details");
  if (details) {
    details.addEventListener("toggle", () => {
      state = saveState({ caseOpen: details.open });
    });
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  if (!state.screen) state = saveState({ screen: "subjects" });
  render();
});
