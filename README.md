# Buddy AI - Smart SvelteKit AI Tutor

An interactive, AI-powered tutoring application built with SvelteKit. Buddy AI combines intelligent conversational tutoring with gamified learning mechanics to keep students engaged.

## Features

- **Context-Aware AI Tutor:** A dedicated `/tutor` chat interface with persistent history across client-side navigation.
  - **Hint & Explain Modes:** The tutor starts in "Hint" mode to guide students. If a student struggles (3+ exchanges), it auto-escalates to "Explain" mode to break down concepts further.
  - **Rich Responses:** Full Markdown and KaTeX (LaTeX) support for math and science topics.
- **Interactive Lessons:** Quizzes with shuffled answers, real-time feedback, and an embedded "Buddy" panel that explains incorrect answers on the spot.
- **Content Generation:** Admin tools to automatically generate structured lessons from YouTube videos.

## Gamified Student Mechanics

To keep students motivated, Buddy AI implements a full suite of gamification systems:

- **❤️ Hearts (Lives System):**
  - Students need hearts to start lessons. If hearts reach 0, lessons are gated by a full-screen overlay.
  - **Passive Regen:** +1 heart automatically regenerates every 30 minutes.
  - **Purchase:** Students can buy 1 heart for 5 coins.
  - **UI Indicators:** A pulsing red hearts pill and warning banners alert the student when they are out of lives.
- **⭐ XP & Ranks:**
  - Earning XP progresses students through five tiers: **Bronze (0) ➔ Silver (600) ➔ Gold (1200) ➔ Platinum (2000) ➔ Diamond (3000)**.
  - Partial XP is awarded based on lesson performance.
  - Real-time toast notifications celebrate rank-ups.
- **🪙 Coins:** Earned by completing lessons. Used as an in-game currency to refill hearts.
- **🔥 Streaks:** Tracks daily engagement and consistency.
- **🔔 Toast System:** A custom, top-anchored slide-down toast system (capped at 3 simultaneous notifications) instantly notifies users of XP gains, heart losses, rank ups, and streak updates.

## Technology Stack

- **Frontend Core:** Svelte 5 (Runes: `$state`, `$derived`, `$effect`) & SvelteKit.
- **Styling:** Tailwind CSS v4 & daisyUI.
- **Database:** SQLite (via `better-sqlite3`) and Drizzle ORM.
- **AI Integration:** Vercel AI SDK (`@ai-sdk/svelte`) using `DefaultChatTransport` for streaming responses.
- **Deployment:** Preconfigured for Railway with persistent volume storage and S3-compatible Object Storage.

---

## Local Development

```sh
npm install
npm run dev
```

Checks:

```sh
npm run check
npm run build
```

## Railway Deployment

This repository is now preconfigured for Railway via `railway.json`.

### Required Railway Services

1. Web Service (this repo)
2. Volume mounted to `/data` (for persistent SQLite)
3. Railway Object Storage Bucket (S3-compatible)

### Deploy Steps

1. Create a new Railway project and deploy this repository as a Web Service.
2. Add a Volume to the service and mount it at `/data`.
3. Set `DATABASE_URL=/data/sqlite.db` on the Web Service.
4. Add the rest of the environment variables listed below.
5. Create an Object Storage bucket in Railway and copy bucket credentials into the app variables.
6. Redeploy the service.
7. On first boot, schema bootstrap runs automatically via `npm run db:push` before server start.

### Required Environment Variables

Use `.env.example` as the source of truth. At minimum, set:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
RUN_DB_PUSH_ON_START=true

DATABASE_URL=/data/sqlite.db
ADMIN_SECRET=replace-with-a-strong-secret

OPENAI_API_KEY=...
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_MODEL=nvidia/nemotron-3-super-120b-a12b
NVIDIA_ASR_API_KEY=...
NVIDIA_EMBED_API_KEY=...

BUCKET=...
REGION=auto
ENDPOINT=https://storage.railway.app
ACCESS_KEY_ID=...
SECRET_ACCESS_KEY=...
```

### Notes

1. The app is configured with `@sveltejs/adapter-node` and starts with `node build/index.js`.
2. Railway sets `PORT`; host binding is forced to `0.0.0.0` in `railway.json`.
3. Startup uses `scripts/railway-start.mjs` to run schema push automatically unless you set `RUN_DB_PUSH_ON_START=false`.
