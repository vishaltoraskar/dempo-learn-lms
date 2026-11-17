// Local demo database — used ONLY when Supabase/Clerk keys are not set (on your own computer).
// It copies the small part of the Supabase client that handler.js uses (from, select, eq, neq,
// in, order, insert, update, upsert), but keeps the data in data/local-db.json.
// Delete data/local-db.json to start again with fresh sample data.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "local-db.json");
let db = null;

function load() {
  if (db) return db;
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
  else { db = seed(); save(); }
  return db;
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// Default column values, same as supabase/schema.sql.
const DEFAULTS = {
  users: () => ({ clerk_id: null, role: "student", roll_no: null }),
  announcements: () => ({ created_at: new Date().toISOString() }),
  materials: () => ({ link: "" }),
  assignments: () => ({ details: "", max_points: 10 }),
  submissions: () => ({ submitted_at: new Date().toISOString(), score: null, feedback: "" }),
};
// Columns that must be unique, same as supabase/schema.sql.
const UNIQUE = {
  users: [["email"]],
  courses: [["join_code"]],
  enrollments: [["course_id", "student_id"]],
  submissions: [["assignment_id", "student_id"]],
};
const sameOn = (cols, a, b) => cols.every((c) => a[c] === b[c]);

class Query {
  constructor(table) { this.table = table; this.op = "select"; this.filters = []; }
  select() { return this; } // rows are always returned
  eq(col, v) { this.filters.push((r) => r[col] === v); return this; }
  neq(col, v) { this.filters.push((r) => r[col] !== v); return this; }
  in(col, vs) { this.filters.push((r) => vs.includes(r[col])); return this; }
  order(col) { this.orderBy = col; return this; }
  insert(rows) { this.op = "insert"; this.rows = [].concat(rows); return this; }
  upsert(rows) { this.op = "upsert"; this.rows = [].concat(rows); return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }

  // "await query" ends up here, and gives back { data, error } like Supabase does.
  then(resolve, reject) {
    let result;
    try { result = { data: this.run(), error: null }; } catch (e) { result = { data: null, error: { message: e.message } }; }
    return Promise.resolve(result).then(resolve, reject);
  }

  run() {
    const d = load();
    const rows = d[this.table];
    const match = (r) => this.filters.every((f) => f(r));
    const copy = (r) => ({ ...r });

    if (this.op === "select") {
      const out = rows.filter(match).map(copy);
      const o = this.orderBy;
      if (o) out.sort((a, b) => (a[o] > b[o] ? 1 : a[o] < b[o] ? -1 : 0));
      return out;
    }
    if (this.op === "update") {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, this.patch));
      save();
      return hit.map(copy);
    }
    // insert / upsert
    const out = [];
    for (const row of this.rows) {
      const full = { ...(DEFAULTS[this.table]?.() || {}), ...row };
      const clash = (UNIQUE[this.table] || []).find((cols) => rows.some((r) => sameOn(cols, r, full)));
      if (clash) {
        if (this.op === "upsert") continue; // already there: ignore
        throw new Error(`duplicate value for ${clash.join(", ")} in ${this.table}`);
      }
      if (this.table !== "enrollments") full.id = ++d.nextId[this.table];
      rows.push(full);
      out.push(copy(full));
    }
    save();
    return out;
  }
}

module.exports = { from: (table) => new Query(table) };

// ---------- Sample data so the app has something to show ----------
function seed() {
  const day = 24 * 60 * 60 * 1000;
  const at = (days) => new Date(Date.now() + days * day).toISOString();
  const users = [
    { id: 1, name: "College Admin", email: "admin@dempo.demo", role: "admin" },
    { id: 2, name: "Anita Naik", email: "anita.naik@dempo.demo", role: "teacher" },
    { id: 3, name: "Rohan Kamat", email: "rohan.kamat@dempo.demo", role: "teacher" },
    { id: 4, name: "Priya Desai", email: "priya.desai@dempo.demo", role: "student", roll_no: "BCA23001" },
    { id: 5, name: "Arjun Gaonkar", email: "arjun.gaonkar@dempo.demo", role: "student", roll_no: "BCA23002" },
    { id: 6, name: "Sneha Fernandes", email: "sneha.fernandes@dempo.demo", role: "student", roll_no: "BCA23003" },
    { id: 7, name: "Fatima Shaikh", email: "fatima.shaikh@dempo.demo", role: "student", roll_no: "BCOM23001" },
    { id: 8, name: "Joel Dsouza", email: "joel.dsouza@dempo.demo", role: "student", roll_no: "BCOM23002" },
  ].map((u) => ({ clerk_id: null, roll_no: null, ...u }));

  return {
    nextId: { users: 8, courses: 2, announcements: 3, materials: 3, assignments: 3, submissions: 3 },
    users,
    courses: [
      { id: 1, name: "BCA Sem 3 — Data Structures", join_code: "DS3BCA", teacher_id: 2 },
      { id: 2, name: "B.Com Sem 1 — Business Communication", join_code: "BC1COM", teacher_id: 3 },
    ],
    enrollments: [
      { course_id: 1, student_id: 4 }, { course_id: 1, student_id: 5 }, { course_id: 1, student_id: 6 },
      { course_id: 2, student_id: 7 }, { course_id: 2, student_id: 8 }, { course_id: 2, student_id: 4 },
    ],
    announcements: [
      { id: 1, course_id: 1, text: "Welcome to Data Structures! Unit 1 notes are on the Classwork tab.", created_at: at(-6) },
      { id: 2, course_id: 1, text: "Lab on Friday moves to Room 204.", created_at: at(-1) },
      { id: 3, course_id: 2, text: "Please bring a printed copy of your cover letter draft on Monday.", created_at: at(-2) },
    ],
    materials: [
      { id: 1, course_id: 1, title: "Unit 1 — Arrays and linked lists (reading)", link: "https://en.wikipedia.org/wiki/Linked_list" },
      { id: 2, course_id: 1, title: "Unit 2 — Stacks and queues (reading)", link: "https://en.wikipedia.org/wiki/Stack_(abstract_data_type)" },
      { id: 3, course_id: 2, title: "How to write a formal letter", link: "https://en.wikipedia.org/wiki/Letter_(message)" },
    ],
    assignments: [
      { id: 1, course_id: 1, title: "Linked list worksheet", details: "Explain how to insert a node in the middle of a singly linked list.", due: at(-2), max_points: 10 },
      { id: 2, course_id: 1, title: "Stack using an array", details: "Write push and pop in any language and explain the overflow case.", due: at(5), max_points: 20 },
      { id: 3, course_id: 2, title: "Cover letter draft", details: "Write a one-page cover letter for an internship.", due: at(3), max_points: 10 },
    ],
    submissions: [
      { id: 1, assignment_id: 1, student_id: 4, text: "Find the node before the position, point the new node at its next, then point it at the new node.", submitted_at: at(-3), score: 9, feedback: "Clear and correct. Add a diagram next time." },
      { id: 2, assignment_id: 1, student_id: 5, text: "Make a new node and change the next pointers.", submitted_at: at(-1), score: null, feedback: "" },
      { id: 3, assignment_id: 3, student_id: 7, text: "Dear Sir/Madam, I am writing to apply for…", submitted_at: at(-1), score: null, feedback: "" },
    ],
  };
}
