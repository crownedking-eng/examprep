// ─────────────────────────────────────────────────────────────────────────────
//  convert.js  —  ExamPrep JSON Conversion Utility
//
//  PURPOSE
//  -------
//  Converts a raw exam JSON file (as exported from the source .txt Q&A files)
//  into the format expected by app.js.
//
//  USAGE (Node.js)
//  ---------------
//    node convert.js input.json output.json
//
//  USAGE (Browser / DevTools)
//  --------------------------
//  Paste the convertRawJSON function into the browser console, then call:
//    convertRawJSON(rawObject)   → returns converted object
//    downloadConverted(rawObject, "2022-2023.json")  → triggers download
//
//  RAW FORMAT  →  APP FORMAT MAPPINGS
//  ------------------------------------
//  sectionA[].question        → text
//  sectionA[].reference       → ref
//  sectionA[].correctAnswer   → correct  ("A"/"B"/"C"/"D" → 0/1/2/3)
//  sectionA[].options         → strip "A. " / "B. " prefix from each option
//  sectionB[]                 → { caseStudy, questions[] }
//  sectionB[].question        → text
//  sectionB[].answer.reference → answer.ref
// ─────────────────────────────────────────────────────────────────────────────

const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Strip "A. " / "B. " / "C. " / "D. " prefix from an option string.
 * Works whether the prefix is "A. ", "A) ", "A - ", etc.
 */
function stripOptionPrefix(opt) {
  return String(opt).replace(/^[A-D][\.\)\-]\s*/i, "").trim();
}

/**
 * Convert a correctAnswer letter ("A"/"B"/"C"/"D") to a 0-based index.
 * Falls back to 0 if unrecognised.
 */
function letterToIndex(letter) {
  return LETTER_TO_INDEX[(letter || "A").toUpperCase().trim()] ?? 0;
}

/**
 * Normalise a single MCQ question object.
 * Works for both sectionA singles and case-group child questions.
 */
function normQuestion(q) {
  return {
    type:        q.type,                                    // preserve on single items
    text:        q.question        ?? q.text        ?? "",
    options:     (q.options || []).map(stripOptionPrefix),
    correct:     q.correctAnswer !== undefined
                   ? letterToIndex(q.correctAnswer)
                   : (q.correct ?? 0),
    explanation: q.explanation ?? "",
    ref:         q.reference   ?? q.ref ?? "",
  };
}

/**
 * Normalise one sectionA item.
 * Handles type: "single" and type: "case-group".
 */
function normSectionAItem(item) {
  if (item.type === "single") {
    return normQuestion(item);
  }

  if (item.type === "case-group") {
    return {
      type: "case-group",
      caseStudy: {
        title:    item.caseStudy?.title    ?? "",
        fullText: item.caseStudy?.fullText ?? "",
      },
      questions: (item.questions || []).map((q) => normQuestion(q)),
    };
  }

  // Unknown type — return as-is
  return item;
}

/**
 * Normalise sectionB.
 *
 * Raw format:  array of { question, marks, caseStudy, answer }
 * App format:  { caseStudy, questions: [{ text, marks, answer }] }
 *
 * The caseStudy is taken from the first array item.
 * Each array item becomes one question entry inside questions[].
 */
function normSectionB(rawB) {
  if (!Array.isArray(rawB)) {
    // Already in internal format — return unchanged
    return rawB;
  }

  const firstItem = rawB[0] || {};

  const caseStudy = firstItem.caseStudy
    ? {
        title:    firstItem.caseStudy.title    ?? "",
        fullText: firstItem.caseStudy.fullText ?? "",
        keyFacts: firstItem.caseStudy.keyFacts ?? [],
      }
    : null;

  const questions = rawB.map((item) => ({
    text:  item.question ?? item.text ?? "",
    marks: item.marks    ?? null,
    answer: {
      introduction: item.answer?.introduction ?? "",
      mainPoints:   (item.answer?.mainPoints  ?? []).map((pt) => ({
        heading: pt.heading ?? "",
        detail:  pt.detail  ?? "",
      })),
      conclusion: item.answer?.conclusion ?? "",
      ref:        item.answer?.reference  ?? item.answer?.ref ?? "",
    },
  }));

  return { caseStudy, questions };
}

/**
 * Main conversion function.
 *
 * @param {object} raw  - Parsed raw JSON object
 * @returns {object}    - App-ready normalised object (same top-level shape)
 */
function convertRawJSON(raw) {
  const semesters = (raw.semesters || []).map((sem) => ({
    semester: sem.semester ?? "Semester I",
    sectionA: (sem.sectionA || []).map(normSectionAItem),
    sectionB: normSectionB(sem.sectionB),
  }));

  return {
    subject:      raw.subject      ?? "",
    academicYear: raw.academicYear ?? "",
    semesters,
  };
}

// ─── BROWSER HELPER ───────────────────────────────────────────────────────────

/**
 * Convert and immediately trigger a JSON file download in the browser.
 *
 * @param {object} raw       - Raw parsed JSON object
 * @param {string} filename  - Output filename, e.g. "2022-2023.json"
 */
function downloadConverted(raw, filename) {
  const converted = convertRawJSON(raw);
  const blob = new Blob(
    [JSON.stringify(converted, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename || "converted.json";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── NODE.JS CLI ──────────────────────────────────────────────────────────────

// Runs only when executed directly via: node convert.js input.json output.json
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("convert.js")) {
  const fs   = require("fs");
  const path = require("path");

  const [,, inputPath, outputPath] = process.argv;

  if (!inputPath) {
    console.error("Usage: node convert.js <input.json> [output.json]");
    process.exit(1);
  }

  const raw       = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const converted = convertRawJSON(raw);
  const outFile   = outputPath || path.basename(inputPath, ".json") + ".converted.json";

  fs.writeFileSync(outFile, JSON.stringify(converted, null, 2), "utf8");
  console.log(`✅ Converted: ${inputPath} → ${outFile}`);
}
