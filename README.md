# Craftora

**Create. Discover. Play.** An independent Minecraft project discovery platform.

Craftora owns its project catalogue. It does not fetch search listings from the Modrinth API. This repository contains a static frontend and the initial Supabase backend schema.

## Stack

- Frontend: semantic HTML, CSS and JavaScript modules
- Backend: Supabase Auth, PostgreSQL, Row Level Security and Storage
- Hosting: GitHub Pages or another static host for the frontend; Supabase for managed backend services
- Database migrations: `supabase/migrations/`

## Repository layout

```text
.
├── index.html
├── assets/
│   ├── css/app.css
│   └── js/
│       ├── app.js
│       └── config.js
└── supabase/
    ├── config.toml
    └── migrations/
        └── 20261014000000_initial_craftora_schema.sql
```

## Setup

### 1. Create a dedicated Supabase project

Create a new project specifically for Craftora in the [Supabase dashboard](https://supabase.com/dashboard). Do not use an unrelated project's database. Choose a region near your expected users. Wait until the database is active.

### 2. Apply the schema

Open the new project's SQL Editor and run the contents of:

`supabase/migrations/20261014000000_initial_craftora_schema.sql`

Review the SQL before applying it. It creates profiles, projects and project versions, enables Row Level Security, sets policies, and creates storage buckets.

### 3. Configure browser access

In the Supabase project settings, copy the project URL and the **publishable key**. Edit `assets/js/config.js`:

```js
export const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YOUR_KEY";
```

A legacy anon key also works where still provided. Never put a service-role key or any secret key in frontend files or commit it to GitHub.

### 4. Test locally

Because ES modules and Supabase Auth need an HTTP origin, run a local static server from the repository root rather than opening `index.html` as a `file://` URL. For example, if Python is installed:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`. Configure the same URL in Supabase Auth's allowed redirect/site URL settings as needed.

### 5. Deploy the frontend

In GitHub, open **Settings → Pages** and configure deployment from the `main` branch and `/(root)`. Once Pages publishes the site, add its HTTPS URL to Supabase Auth's allowed site/redirect URLs. The frontend can be hosted on GitHub Pages; the database and auth run in Supabase.

## Current capabilities

- Responsive independent Craftora UI
- Search and category filters against Craftora's own database
- Email/password sign-up and sign-in
- Creator project metadata submissions
- New submissions enter the moderation queue as `pending`
- Row Level Security protects unpublished projects and creator-owned records
- Database foundations for project versions and controlled file storage

## Not implemented yet

- Admin moderation dashboard / role management
- Project detail pages and version downloads
- File upload UI, malware scanning, and download counters
- Rate limiting, abuse reports, audit logging and email verification UX
- Production testing, automated tests and a deployment pipeline

Project file uploads are deliberately not exposed in the frontend yet. Do not accept arbitrary executable files publicly until file validation, scanning, quotas and moderation are in place.

## Security notes

- The frontend only uses a publishable key; RLS is required and enabled.
- A new submission is pending by default. Public catalogue queries only show published projects.
- There is no admin-publishing interface in this starter. Publishing should be done only through a future protected moderator workflow.
- Never trust user-supplied metadata or external URLs; validate and moderate before public release.
- This project is independent and is not affiliated with Mojang, Microsoft or Modrinth.
