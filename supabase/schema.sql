-- Dempo Learn database. Paste this whole file into Supabase > SQL Editor > Run.
-- Row-level security is ON for every table with no policies, so the public "anon" key
-- can read nothing. Only our server (using the secret service_role key) can read/write.

create table if not exists users (
  id bigint generated always as identity primary key,
  clerk_id text unique,                 -- filled in the first time the person signs in
  name text not null,
  email text not null unique,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  roll_no text
);

create table if not exists courses (
  id bigint generated always as identity primary key,
  name text not null,
  join_code text not null unique,
  teacher_id bigint not null references users(id)
);

create table if not exists enrollments (
  course_id bigint not null references courses(id) on delete cascade,
  student_id bigint not null references users(id) on delete cascade,
  primary key (course_id, student_id)
);

create table if not exists announcements (
  id bigint generated always as identity primary key,
  course_id bigint not null references courses(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists materials (
  id bigint generated always as identity primary key,
  course_id bigint not null references courses(id) on delete cascade,
  title text not null,
  link text not null default ''
);

create table if not exists assignments (
  id bigint generated always as identity primary key,
  course_id bigint not null references courses(id) on delete cascade,
  title text not null,
  details text not null default '',
  due timestamptz not null,
  max_points numeric not null default 10 check (max_points > 0)
);

create table if not exists submissions (
  id bigint generated always as identity primary key,
  assignment_id bigint not null references assignments(id) on delete cascade,
  student_id bigint not null references users(id) on delete cascade,
  text text not null,
  submitted_at timestamptz not null default now(),
  score numeric,
  feedback text not null default '',
  unique (assignment_id, student_id)
);

alter table users enable row level security;
alter table courses enable row level security;
alter table enrollments enable row level security;
alter table announcements enable row level security;
alter table materials enable row level security;
alter table assignments enable row level security;
alter table submissions enable row level security;
