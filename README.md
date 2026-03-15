# AI Demo App

SvelteKit + Drizzle + SQLite + AI tutor workflows with Railway object storage for lesson media.

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
