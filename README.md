# Dempo Learn — simple LMS

A small learning platform for a college: teachers set work, students turn it in, teachers grade it.

## Run it
Needs Node.js 18+. No packages to install.

```
npm start
```
Then open http://localhost:5600 and pick a demo user (no passwords — demo mode).

## What it does
| LMS job | How |
|---|---|
| Roster & enrolment | Join codes for students; bulk CSV import (`name,email,roll_no`) on a course's People tab |
| Content delivery | Material links on the Classwork tab |
| Assignment lifecycle | Due dates, turn in, late flag, resubmit until graded |
| Assessment & grading | Score + feedback per submission; gradebook table |
| Communication | Announcements on the Stream tab |
| Roles & permissions | Student / teacher / admin, checked on the server for every action |
| Records & reporting | Gradebook CSV download |

## Files
- `server.js` — the whole backend (built-in Node modules only). Data saved to `data.json`.
- `public/` — the web page (`index.html`, `app.js`, `style.css`). Colours are tokens at the top of `style.css`.

Delete `data.json` and restart to reset the demo data.

## Not included (on purpose, to keep it simple)
Real passwords/login, file uploads, exams with timers, email notifications.
