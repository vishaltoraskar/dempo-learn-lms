# Dempo Learn — simple LMS

A small learning platform for a college: teachers set work, students turn it in, teachers grade it.

**Stack:** plain HTML/JS front end · Node.js API · **Supabase** (database) · **Clerk** (sign-in) · **Vercel** (hosting) · **GitHub** (code).

## What it does
| LMS job | How |
|---|---|
| Roster & enrolment | Join codes for students; bulk CSV import (`name,email,roll_no`) on a course's People tab |
| Content delivery | Material links on the Classwork tab |
| Assignment lifecycle | Due dates (IST), turn in, late flag, resubmit until graded |
| Assessment & grading | Score + feedback per submission; gradebook table |
| Communication | Announcements on the Stream tab |
| Roles & permissions | Student / teacher / admin, stored in our database and checked on the server for every action |
| Records & reporting | Gradebook CSV download |

## Setup (one time)

1. **Supabase** — create a project at supabase.com. Open *SQL Editor*, paste all of `supabase/schema.sql`, click *Run*.
   From *Project Settings → API* copy the **Project URL** and the **service_role** key.
2. **Clerk** — create an application at clerk.com (enable Email sign-in). From *API Keys* copy the
   **Publishable key** and **Secret key**.
3. Copy `.env.example` to `.env.local` and paste those four values in. Put your own email in `ADMIN_EMAILS`.
   Never commit `.env.local` and never paste keys into chats.

## Run locally
Needs Node.js 20.12+.
```
npm install
npm start
```
Open http://localhost:5600 and sign in. The email in `ADMIN_EMAILS` becomes admin; everyone else starts as a
student. The admin makes teachers on the home page under *People and roles*.

## Deploy
1. Push this folder to a GitHub repository.
2. In Vercel: *Add New → Project → Import* the repo (framework preset: **Other**, no build command).
3. In *Settings → Environment Variables* add the same five values as `.env.local`, then redeploy.
4. Clerk development keys work on the `*.vercel.app` address. For a custom domain, create Clerk production keys.

## Files
- `lib/handler.js` — all server logic and permission checks.
- `server.js` — runs it on your computer. `api/index.js` + `vercel.json` — run it on Vercel.
- `public/` — the web page. Colours are tokens at the top of `style.css`.
- `supabase/schema.sql` — database tables. Row-level security is on with no policies, so only the server can read data.

## Not included (on purpose, to keep it simple)
File uploads, timed exams, email notifications.
