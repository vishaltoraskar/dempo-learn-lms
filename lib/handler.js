// Dempo Learn — all the server logic (the "API").
// Used by server.js on your computer, and by api/index.js on Vercel.
// Data lives in Supabase. Sign-in is done by Clerk. The user's ROLE lives in our own
// Supabase "users" table, never in Clerk.

const { createClient } = require("@supabase/supabase-js");
const { verifyToken, createClerkClient } = require("@clerk/backend");

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing setting ${name}. Add it to .env.local (or Vercel > Settings > Environment Variables).`);
  return v;
};

let sb, clerk;
function clients() {
  if (!sb) {
    // The service_role key is secret: it is only ever used here, on the server.
    sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    clerk = createClerkClient({ secretKey: env("CLERK_SECRET_KEY") });
  }
  return { sb, clerk };
}

// Run a Supabase query and throw if it failed.
async function q(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const deny = (msg) => { throw new HttpError(403, msg); };
const bad = (msg) => { throw new HttpError(400, msg); };

const adminEmails = () => (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);

// ---------- Who is calling? ----------
// The browser sends Clerk's session token. We check it with Clerk, then find (or create)
// the matching row in our users table.
async function currentUser(req) {
  const { sb, clerk } = clients();
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "Please sign in first.");
  let clerkId;
  try {
    clerkId = (await verifyToken(token, { secretKey: env("CLERK_SECRET_KEY") })).sub;
  } catch {
    throw new HttpError(401, "Your sign-in has expired. Please sign in again.");
  }

  let [me] = await q(sb.from("users").select("*").eq("clerk_id", clerkId));
  if (!me) {
    // First visit: get their email from Clerk.
    const cu = await clerk.users.getUser(clerkId);
    const email = (cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) || cu.emailAddresses[0]).emailAddress.toLowerCase();
    const name = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || email.split("@")[0];
    [me] = await q(sb.from("users").select("*").eq("email", email));
    if (me) {
      // A teacher already imported this student by email — link the account.
      [me] = await q(sb.from("users").update({ clerk_id: clerkId }).eq("id", me.id).select());
    } else {
      [me] = await q(sb.from("users").insert({ clerk_id: clerkId, email, name, role: "student" }).select());
    }
  }
  // Emails listed in ADMIN_EMAILS (a secret setting, not in the code) are always admins.
  if (me.role !== "admin" && adminEmails().includes(me.email)) {
    [me] = await q(sb.from("users").update({ role: "admin" }).eq("id", me.id).select());
  }
  return me;
}

// ---------- Loading a course and checking permission ----------
async function courseWithStudents(courseId) {
  const { sb } = clients();
  const [c] = await q(sb.from("courses").select("*").eq("id", Number(courseId) || 0));
  if (!c) throw new HttpError(404, "Course not found.");
  const enr = await q(sb.from("enrollments").select("student_id").eq("course_id", c.id));
  c.studentIds = enr.map((e) => e.student_id);
  return c;
}
const canManage = (u, c) => u.role === "admin" || c.teacher_id === u.id;

// ---------- Everything the signed-in user may see ----------
async function stateFor(me) {
  const { sb } = clients();
  let courses;
  if (me.role === "admin") courses = await q(sb.from("courses").select("*"));
  else if (me.role === "teacher") courses = await q(sb.from("courses").select("*").eq("teacher_id", me.id));
  else {
    const mine = await q(sb.from("enrollments").select("course_id").eq("student_id", me.id));
    courses = await q(sb.from("courses").select("*").in("id", mine.map((e) => e.course_id)));
  }
  const ids = courses.map((c) => c.id);
  const [enr, ann, mats, asg] = await Promise.all([
    q(sb.from("enrollments").select("*").in("course_id", ids)),
    q(sb.from("announcements").select("*").in("course_id", ids)),
    q(sb.from("materials").select("*").in("course_id", ids)),
    q(sb.from("assignments").select("*").in("course_id", ids)),
  ]);
  let subQuery = sb.from("submissions").select("*").in("assignment_id", asg.map((a) => a.id));
  if (me.role === "student") subQuery = subQuery.eq("student_id", me.id); // only your own work
  const subs = await q(subQuery);

  // Students see staff names and themselves; staff also see students in their courses; admin sees all.
  let users;
  if (me.role === "admin") users = await q(sb.from("users").select("*"));
  else {
    const staff = await q(sb.from("users").select("*").neq("role", "student"));
    const studentIds = me.role === "student" ? [me.id] : [...new Set(enr.map((e) => e.student_id))];
    users = staff.concat(await q(sb.from("users").select("*").in("id", studentIds)));
  }

  const t = (d) => new Date(d).getTime();
  return {
    me: { id: me.id, name: me.name, email: me.email, role: me.role },
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, rollNo: u.roll_no })),
    courses: courses.map((c) => ({
      id: c.id, name: c.name, joinCode: c.join_code, teacherId: c.teacher_id,
      studentIds: enr.filter((e) => e.course_id === c.id).map((e) => e.student_id),
    })),
    announcements: ann.map((a) => ({ id: a.id, courseId: a.course_id, text: a.text, at: t(a.created_at) })),
    materials: mats.map((m) => ({ id: m.id, courseId: m.course_id, title: m.title, link: m.link })),
    assignments: asg.map((a) => ({ id: a.id, courseId: a.course_id, title: a.title, details: a.details, due: t(a.due), maxPoints: Number(a.max_points) })),
    submissions: subs.map((s) => ({
      id: s.id, assignmentId: s.assignment_id, studentId: s.student_id, text: s.text,
      at: t(s.submitted_at), score: s.score == null ? null : Number(s.score), feedback: s.feedback,
    })),
  };
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// ---------- Routes ----------
async function route(method, path, query, b, req) {
  const { sb } = clients();

  // The browser needs Clerk's PUBLIC key to show the sign-in box. (Safe to share.)
  if (path === "/api/config") return { clerkPublishableKey: env("CLERK_PUBLISHABLE_KEY") };

  const me = await currentUser(req);
  if (path === "/api/state") return stateFor(me);

  if (path === "/api/export") {
    const c = await courseWithStudents(query.get("courseId"));
    if (!canManage(me, c)) deny("Only the course teacher or an admin can export marks.");
    const as = await q(sb.from("assignments").select("*").eq("course_id", c.id).order("due"));
    const subs = await q(sb.from("submissions").select("*").in("assignment_id", as.map((a) => a.id)));
    const students = await q(sb.from("users").select("*").in("id", c.studentIds).order("roll_no"));
    const rows = [["Roll No", "Name", "Email", ...as.map((a) => `${a.title} (/${a.max_points})`), "Total"]];
    for (const s of students) {
      let total = 0;
      const marks = as.map((a) => {
        const sub = subs.find((x) => x.assignment_id === a.id && x.student_id === s.id);
        if (sub && sub.score != null) { total += Number(sub.score); return sub.score; }
        return sub ? "Not graded" : "Not turned in";
      });
      rows.push([s.roll_no, s.name, s.email, ...marks, total]);
    }
    return { csv: rows.map((r) => r.map(csvCell).join(",")).join("\n"), filename: `${c.join_code}-gradebook.csv` };
  }

  if (method !== "POST") throw new HttpError(404, "Not found.");

  switch (path) {
    case "/api/courses": {
      if (me.role === "student") deny("Students cannot create courses.");
      if (!b.name?.trim()) bad("Please give the course a name.");
      const teacherId = me.role === "admin" ? Number(b.teacherId) || me.id : me.id;
      const joinCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      await q(sb.from("courses").insert({ name: b.name.trim(), join_code: joinCode, teacher_id: teacherId }));
      break;
    }
    case "/api/join": {
      if (me.role !== "student") deny("Only students join with a code.");
      const [c] = await q(sb.from("courses").select("id").eq("join_code", String(b.joinCode || "").trim().toUpperCase()));
      if (!c) throw new HttpError(404, "That code didn't match any course. Check it with your teacher.");
      await q(sb.from("enrollments").upsert({ course_id: c.id, student_id: me.id }, { ignoreDuplicates: true }));
      break;
    }
    case "/api/roster-import": {
      // CSV columns: name,email,roll_no. Good rows are added; bad rows are reported, not fatal.
      const c = await courseWithStudents(b.courseId);
      if (!canManage(me, c)) deny("Only the course teacher or an admin can import a roster.");
      const lines = String(b.csv || "").split(/\r?\n/).map((l) => l.trim());
      const report = { added: 0, alreadyEnrolled: 0, errors: [] };
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || (i === 0 && line.toLowerCase().startsWith("name"))) continue;
        const [name, rawEmail, rollNo] = line.split(",").map((x) => (x || "").trim());
        const email = (rawEmail || "").toLowerCase();
        if (!name || !/^\S+@\S+\.\S+$/.test(email) || !rollNo) {
          report.errors.push(`Line ${i + 1}: needs name, a valid email and roll_no — "${line}"`);
          continue;
        }
        let [s] = await q(sb.from("users").select("*").eq("email", email));
        if (s && s.role !== "student") { report.errors.push(`Line ${i + 1}: ${email} belongs to a staff account`); continue; }
        if (!s) [s] = await q(sb.from("users").insert({ name, email, role: "student", roll_no: rollNo }).select());
        if (c.studentIds.includes(s.id)) { report.alreadyEnrolled++; continue; }
        await q(sb.from("enrollments").insert({ course_id: c.id, student_id: s.id }));
        c.studentIds.push(s.id);
        report.added++;
      }
      return report;
    }
    case "/api/announcements": {
      const c = await courseWithStudents(b.courseId);
      if (!canManage(me, c)) deny("Only the course teacher can post announcements.");
      if (!b.text?.trim()) bad("Announcement is empty.");
      await q(sb.from("announcements").insert({ course_id: c.id, text: b.text.trim() }));
      break;
    }
    case "/api/materials": {
      const c = await courseWithStudents(b.courseId);
      if (!canManage(me, c)) deny("Only the course teacher can add material.");
      if (!b.title?.trim()) bad("Please give the material a title.");
      const link = (b.link || "").trim();
      if (link && !/^https?:\/\//i.test(link)) bad("Links must start with http:// or https://");
      await q(sb.from("materials").insert({ course_id: c.id, title: b.title.trim(), link }));
      break;
    }
    case "/api/assignments": {
      const c = await courseWithStudents(b.courseId);
      if (!canManage(me, c)) deny("Only the course teacher can set assignments.");
      const due = new Date(b.due);
      if (!b.title?.trim() || isNaN(due)) bad("Assignment needs a title and a due date.");
      await q(sb.from("assignments").insert({
        course_id: c.id, title: b.title.trim(), details: (b.details || "").trim(),
        due: due.toISOString(), max_points: Number(b.maxPoints) || 10,
      }));
      break;
    }
    case "/api/submit": {
      const [a] = await q(sb.from("assignments").select("*").eq("id", Number(b.assignmentId) || 0));
      const c = a && (await courseWithStudents(a.course_id));
      if (!c || me.role !== "student" || !c.studentIds.includes(me.id)) deny("You are not enrolled in this course.");
      if (!b.text?.trim()) bad("Your answer is empty.");
      const [existing] = await q(sb.from("submissions").select("*").eq("assignment_id", a.id).eq("student_id", me.id));
      if (existing?.score != null) bad("This work is already graded, so it can't be changed.");
      const row = { text: b.text.trim(), submitted_at: new Date().toISOString() };
      if (existing) await q(sb.from("submissions").update(row).eq("id", existing.id)); // resubmit
      else await q(sb.from("submissions").insert({ ...row, assignment_id: a.id, student_id: me.id }));
      break;
    }
    case "/api/grade": {
      const [s] = await q(sb.from("submissions").select("*").eq("id", Number(b.submissionId) || 0));
      const [a] = s ? await q(sb.from("assignments").select("*").eq("id", s.assignment_id)) : [];
      const c = a && (await courseWithStudents(a.course_id));
      if (!c || !canManage(me, c)) deny("Only the course teacher can grade.");
      const score = Number(b.score);
      if (b.score === "" || isNaN(score) || score < 0 || score > Number(a.max_points)) bad(`Score must be between 0 and ${a.max_points}.`);
      await q(sb.from("submissions").update({ score, feedback: (b.feedback || "").trim() }).eq("id", s.id));
      break;
    }
    case "/api/set-role": {
      if (me.role !== "admin") deny("Only an admin can change roles.");
      if (!["student", "teacher", "admin"].includes(b.role)) bad("Unknown role.");
      if (Number(b.userId) === me.id) bad("You can't change your own role.");
      await q(sb.from("users").update({ role: b.role }).eq("id", Number(b.userId)));
      break;
    }
    default:
      throw new HttpError(404, "Not found.");
  }
  return { ok: true };
}

// ---------- Node request handler ----------
async function readBody(req) {
  if ("body" in req) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; // Vercel
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  // On Vercel, vercel.json sends /api/anything to /api/index?route=anything
  const path = url.searchParams.get("route") ? "/api/" + url.searchParams.get("route") : url.pathname;
  const sendJson = (status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    sendJson(200, await route(req.method, path, url.searchParams, body, req));
  } catch (e) {
    if (e.status) return sendJson(e.status, { error: e.message });
    console.error(e);
    sendJson(500, { error: e.message.startsWith("Missing setting") ? e.message : "Something went wrong on our side. Please try again." });
  }
};
