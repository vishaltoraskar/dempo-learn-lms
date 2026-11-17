// Dempo Learn — browser side. Pages are drawn from the data the server sends back.
// Pages: #/ (home), #/c/<courseId>/<tab>, #/a/<assignmentId>

const app = document.getElementById("app");
const who = document.getElementById("who");
let S = null; // everything the signed-in user can see
let flash = null; // one-time message shown on the next page draw

// ---------- small helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (t) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const userName = (id) => S.users.find((u) => u.id === id)?.name || "Unknown";
const canManage = (c) => S.me.role === "admin" || c.teacherId === S.me.id;
const mySub = (aId) => S.submissions.find((s) => s.assignmentId === aId && s.studentId === S.me.id);

async function call(path, body) {
  try {
    const token = window.Clerk?.session ? await window.Clerk.session.getToken() : "";
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  } catch (e) {
    throw new Error(e.message && !e.message.includes("fetch") ? e.message : "Couldn't reach the server. Check your connection and try again — nothing was lost.");
  }
}

// Status of an assignment for a student, in words (never colour alone).
function status(a) {
  const s = mySub(a.id);
  if (s?.score != null) return `<span class="badge ok">Graded: ${s.score}/${a.maxPoints}</span>`;
  if (s) return `<span class="badge ok">Turned in${s.at > a.due ? " (late)" : ""}</span>`;
  if (Date.now() > a.due) return `<span class="badge error">Missing — past due</span>`;
  return `<span class="badge warn">To do</span>`;
}

// Hook up every <form data-action="..."> on the page to the server.
function bindForms() {
  app.querySelectorAll("form[data-action]").forEach((f) =>
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      Object.assign(body, f.dataset); // courseId / assignmentId / submissionId from data-*
      if (body.due) body.due += ":00+05:30"; // due dates are typed in IST
      try {
        const out = await call(f.dataset.action, body);
        flash = { type: "ok", text: f.dataset.ok || "Saved." };
        if (out.added !== undefined) {
          flash.text = `Import done: ${out.added} added, ${out.alreadyEnrolled} already enrolled, ${out.errors.length} rows skipped.` +
            (out.errors.length ? "<br>" + out.errors.map(esc).join("<br>") : "");
          if (out.errors.length) flash.type = "error";
        }
        await load();
      } catch (err) {
        f.querySelector(".err")?.remove();
        f.insertAdjacentHTML("afterbegin", `<div class="msg error err" role="alert">${esc(err.message)}</div>`);
      }
    })
  );
}

// ---------- pages ----------
// Sign-in box drawn by Clerk.
function loginPage() {
  who.innerHTML = "";
  app.innerHTML = `<h1>Welcome to Dempo Learn</h1><p class="muted">Sign in with your college email.</p><div id="signin"></div>`;
  window.Clerk.mountSignIn(document.getElementById("signin"));
}

// Load Clerk's script using the public key the server gives us.
async function startClerk() {
  const { clerkPublishableKey: pk } = await call("/api/config");
  const frontendApi = atob(pk.split("_")[2]).slice(0, -1); // the key encodes Clerk's address
  await new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = `https://${frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
    s.crossOrigin = "anonymous";
    s.dataset.clerkPublishableKey = pk;
    s.onload = ok;
    s.onerror = () => fail(new Error("Couldn't load the sign-in box. Check your connection."));
    document.head.appendChild(s);
  });
  await window.Clerk.load();
  window.Clerk.addListener(({ user }) => { if (!!user !== !!S) load(); }); // signed in or out
}

// Gradebook download (needs the sign-in token, so it's fetched rather than a plain link).
async function downloadCsv(courseId) {
  try {
    const { csv, filename } = await call(`/api/export?courseId=${courseId}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = filename;
    a.click();
  } catch (e) { alert(e.message); }
}

// Admin only: list everyone and change their role.
function peopleAdmin() {
  return `<h2>People and roles</h2><p class="muted">New sign-ins start as students. Make teachers here.</p>
    <div class="table-wrap"><table><tr><th>Name</th><th>Email</th><th>Role</th></tr>
    ${S.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.id === S.me.id ? u.role
      : `<form class="row" data-action="/api/set-role" data-user-id="${u.id}" data-ok="Role changed."><select name="role" onchange="this.form.requestSubmit()">
        ${["student", "teacher", "admin"].map((r) => `<option ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}</select></form>`}</td></tr>`).join("")}
    </table></div>`;
}

function homePage() {
  const { me, courses } = S;
  const cards = courses.map((c) => `<a class="card course-card" href="#/c/${c.id}/stream">
      <strong>${esc(c.name)}</strong>
      <div class="muted">${esc(userName(c.teacherId))} · ${c.studentIds.length} students</div>
      ${me.role !== "student" ? `<div class="muted">Join code: <b>${c.joinCode}</b></div>` : ""}
    </a>`).join("");

  let todo = "";
  if (me.role === "student") {
    const open = S.assignments.filter((a) => !mySub(a.id)).sort((a, b) => a.due - b.due);
    todo = `<h2>Your to-do list</h2>` + (open.length
      ? open.map((a) => `<div class="card"><a href="#/a/${a.id}">${esc(a.title)}</a> ${status(a)}
          <div class="muted">${esc(courses.find((c) => c.id === a.courseId).name)} · due ${fmt(a.due)}</div></div>`).join("")
      : `<div class="card empty">You're all caught up. Nothing is due right now.</div>`);
  }

  const action = me.role === "student"
    ? `<h2>Join a course</h2><form class="card row" data-action="/api/join" data-ok="You joined the course.">
        <input name="joinCode" placeholder="Join code from your teacher, e.g. DBS101" required><button>Join</button></form>`
    : `<h2>Create a course</h2><form class="card row" data-action="/api/courses" data-ok="Course created. Share its join code with students.">
        <input name="name" placeholder="Course name" required>
        ${me.role === "admin" ? `<select name="teacherId">${S.users.filter((u) => u.role === "teacher").map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>` : ""}
        <button>Create</button></form>`;

  app.innerHTML = `<h1>Hello, ${esc(me.name.split(" ").slice(-2).join(" "))}</h1>
    <p class="muted">${me.role === "admin" ? "You can see every course." : "Your courses"}</p>
    <div class="grid">${cards || `<div class="card empty">${me.role === "student" ? "You're not in any course yet. Ask your teacher for a join code." : "No courses yet."}</div>`}</div>
    ${todo}${action}${me.role === "admin" ? peopleAdmin() : ""}`;
}

function coursePage(id, tab) {
  const c = S.courses.find((x) => x.id === id);
  if (!c) return (app.innerHTML = `<div class="card empty">This course doesn't exist or you're not in it. <a href="#/">Go home</a></div>`);
  const manage = canManage(c);
  const tabs = ["stream", "classwork", "people", ...(manage ? ["grades"] : [])];
  let body = "";

  if (tab === "stream") {
    const posts = S.announcements.filter((a) => a.courseId === id).sort((a, b) => b.at - a.at);
    body = (manage ? `<form class="card" data-action="/api/announcements" data-course-id="${id}" data-ok="Announcement posted.">
        <textarea name="text" placeholder="Announce something to your class" required></textarea><button>Post</button></form>` : "") +
      (posts.map((p) => `<div class="card"><div class="muted">${fmt(p.at)}</div>${esc(p.text)}</div>`).join("") ||
        `<div class="card empty">No announcements yet.</div>`);
  }

  if (tab === "classwork") {
    const mats = S.materials.filter((m) => m.courseId === id);
    const as = S.assignments.filter((a) => a.courseId === id).sort((a, b) => a.due - b.due);
    body = `<h2>Assignments</h2>` + (as.map((a) => `<div class="card"><a href="#/a/${a.id}"><strong>${esc(a.title)}</strong></a>
        ${S.me.role === "student" ? status(a) : `<span class="muted">${S.submissions.filter((s) => s.assignmentId === a.id).length}/${c.studentIds.length} turned in</span>`}
        <div class="muted">Due ${fmt(a.due)} · ${a.maxPoints} points</div></div>`).join("") ||
        `<div class="card empty">No assignments yet${manage ? " — create one below." : ". Your teacher hasn't set any work."}</div>`) +
      `<h2>Material</h2>` + (mats.map((m) => `<div class="card">📄 ${m.link ? `<a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.title)}</a>` : esc(m.title)}</div>`).join("") ||
        `<div class="card empty">No material shared yet.</div>`);
    if (manage) body += `<h2>New assignment</h2><form class="card" data-action="/api/assignments" data-course-id="${id}" data-ok="Assignment created.">
        <input name="title" placeholder="Title" required><textarea name="details" placeholder="Instructions"></textarea>
        <div class="row"><label>Due <input type="datetime-local" name="due" required></label><label>Points <input type="number" name="maxPoints" value="10" min="1"></label></div>
        <button>Create assignment</button></form>
      <h2>Add material</h2><form class="card row" data-action="/api/materials" data-course-id="${id}" data-ok="Material added.">
        <input name="title" placeholder="Title" required><input name="link" placeholder="Link (optional)"><button>Add</button></form>`;
  }

  if (tab === "people") {
    const students = S.users.filter((u) => c.studentIds.includes(u.id));
    body = `<h2>Teacher</h2><div class="card">${esc(userName(c.teacherId))}</div>
      <h2>Students (${c.studentIds.length})</h2>` +
      (manage ? `<div class="card">${students.map((s) => `${esc(s.rollNo)} — ${esc(s.name)} <span class="muted">${esc(s.email)}</span>`).join("<br>") || "No students yet."}</div>
        <h2>Bulk import students (CSV)</h2>
        <form class="card" data-action="/api/roster-import" data-course-id="${id}">
          <p class="muted">One student per line: <code>name,email,roll_no</code>. Existing emails are enrolled, not duplicated. Bad rows are skipped and listed.</p>
          <textarea name="csv" placeholder="name,email,roll_no&#10;Riya Shet,riya@dempo.edu,BCA010" required></textarea><button>Import</button></form>`
        : `<div class="card muted">${c.studentIds.length} classmates. Names are only visible to teachers.</div>`);
  }

  if (tab === "grades" && manage) {
    const as = S.assignments.filter((a) => a.courseId === id);
    const students = S.users.filter((u) => c.studentIds.includes(u.id));
    body = `<p><button onclick="downloadCsv(${id})">⬇ Download gradebook (CSV)</button></p>
      <div class="table-wrap"><table><tr><th>Student</th>${as.map((a) => `<th>${esc(a.title)}<br><span class="muted">/${a.maxPoints}</span></th>`).join("")}</tr>
      ${students.map((s) => `<tr><td>${esc(s.name)}</td>${as.map((a) => {
        const sub = S.submissions.find((x) => x.assignmentId === a.id && x.studentId === s.id);
        return `<td>${sub ? (sub.score != null ? sub.score : "Not graded") : "—"}</td>`;
      }).join("")}</tr>`).join("")}</table></div>`;
  }

  app.innerHTML = `<a href="#/">← All courses</a><h1>${esc(c.name)}</h1>
    <div class="muted">${esc(userName(c.teacherId))}${manage ? ` · Join code <b>${c.joinCode}</b>` : ""}</div>
    <nav class="tabs">${tabs.map((t) => `<a href="#/c/${id}/${t}" class="${t === tab ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</a>`).join("")}</nav>${body}`;
}

function assignmentPage(id) {
  const a = S.assignments.find((x) => x.id === id);
  if (!a) return (app.innerHTML = `<div class="card empty">Assignment not found. <a href="#/">Go home</a></div>`);
  const c = S.courses.find((x) => x.id === a.courseId);
  let body = "";

  if (S.me.role === "student") {
    const s = mySub(a.id);
    body = s ? `<h2>Your work ${status(a)}</h2><div class="card"><div class="muted">Turned in ${fmt(s.at)}</div><pre class="answer">${esc(s.text)}</pre>
        ${s.score != null ? `<strong>Grade: ${s.score}/${a.maxPoints}</strong><div>${esc(s.feedback) || "<span class='muted'>No comment.</span>"}</div>` : ""}</div>` : "";
    if (s?.score == null) body += `<form class="card" data-action="/api/submit" data-assignment-id="${a.id}" data-ok="Your work is turned in.">
        <label>${s ? "Change your answer (allowed until it is graded)" : "Your answer"}</label>
        <textarea name="text" required>${s ? esc(s.text) : ""}</textarea><button>${s ? "Resubmit" : "Turn in"}</button></form>`;
  } else {
    const subs = S.submissions.filter((s) => s.assignmentId === a.id);
    const missing = c.studentIds.filter((sid) => !subs.some((s) => s.studentId === sid));
    body = `<h2>Submissions (${subs.length}/${c.studentIds.length})</h2>` +
      (subs.map((s) => `<div class="card"><strong>${esc(userName(s.studentId))}</strong>
        ${s.at > a.due ? `<span class="badge error">Late</span>` : ""} ${s.score != null ? `<span class="badge ok">Graded ${s.score}/${a.maxPoints}</span>` : `<span class="badge warn">Needs grading</span>`}
        <div class="muted">${fmt(s.at)}</div><pre class="answer">${esc(s.text)}</pre>
        <form class="row" data-action="/api/grade" data-submission-id="${s.id}" data-ok="Grade saved.">
          <input type="number" name="score" min="0" max="${a.maxPoints}" step="0.5" placeholder="Score /${a.maxPoints}" value="${s.score ?? ""}" required>
          <input name="feedback" placeholder="Feedback for the student" value="${esc(s.feedback)}"><button>Save grade</button></form></div>`).join("") ||
        `<div class="card empty">Nobody has turned this in yet.</div>`) +
      (missing.length ? `<h2>Not turned in</h2><div class="card">${missing.map((sid) => esc(userName(sid))).join(", ")}</div>` : "");
  }

  app.innerHTML = `<a href="#/c/${c.id}/classwork">← ${esc(c.name)}</a><h1>${esc(a.title)}</h1>
    <div class="muted">Due ${fmt(a.due)} · ${a.maxPoints} points</div>
    <div class="card" style="margin-top:12px">${esc(a.details) || "<span class='muted'>No extra instructions.</span>"}</div>${body}`;
}

// ---------- router ----------
function render() {
  if (!S) return;
  who.innerHTML = `<span>${esc(S.me.name)} · ${S.me.role}</span><button class="link" id="out">Sign out</button>`;
  document.getElementById("out").onclick = () => window.Clerk.signOut();
  const [, kind, id, tab] = location.hash.split("/");
  if (kind === "c") coursePage(Number(id), tab || "stream");
  else if (kind === "a") assignmentPage(Number(id));
  else homePage();
  if (flash) { app.insertAdjacentHTML("afterbegin", `<div class="msg ${flash.type}" role="status">${flash.text}</div>`); flash = null; }
  bindForms();
}

async function load() {
  try {
    if (!window.Clerk) await startClerk();
    if (!window.Clerk.user) { S = null; return loginPage(); }
    S = await call("/api/state");
    render();
  } catch (e) {
    app.innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
}

window.addEventListener("hashchange", render);
load();
