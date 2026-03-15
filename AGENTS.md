# Project Guidelines

## Code Style
- **Svelte 5 Runes Only**: Strictly use Svelte 5 patterns (`$state`, `$derived`, `$props`, `$effect`). Do not use Svelte 4 `export let` or `$:`.
- **Strict TypeScript**: Used across all Svelte components (`<script lang="ts">`) and server files (`+server.ts`, `+page.server.ts`).
- **Styling**: Strictly utilize Tailwind CSS v4 and daisyUI component classes. Avoid custom CSS files unless fundamentally necessary.
- **Form Controls**: Always ensure semantic HTML/accessible inputs, providing matching `id` and `for` tags for inputs and labels.

## Architecture & Integration
- **State Management & DB Sync**: 
  Frontend state (e.g., `user.svelte.ts`) is deeply reactive and handled client-side. Important changes are optimistically mutated in the UI state and pushed to the database via `Drizzle-ORM`/SQLite through API routes (e.g., `/api/user/sync/+server.ts`).
- **Database**:
  We use `better-sqlite3` and `drizzle-orm`. Schema alterations must occur within `src/lib/server/db/schema.ts`. Railway deployment mounts volumes for production SQLite datastores.
- **AI Ecosystem**:
  This project utilizes Vercel's AI SDK configured exclusively for Svelte 5 endpoints. Use native SDK classes (`Chat` initialized with `DefaultChatTransport` via `@ai-sdk/svelte`) rather than legacy `useChat` destructured hooks. Backends respond using `.toUIMessageStreamResponse()`.
- **Deployment Environment**:
  The repository is configured to compile via `@sveltejs/adapter-node` to run properly on Railway. Ensure the Svelte process always listens to `HOST=0.0.0.0` when in production.

## Build and Workflow Commands
- `npm run dev` — Starts the local dev server.
- `npm run check` — Runs `svelte-check` and catches TS interface/markup parse errors. Execute this after making intensive template modifications to ensure zero panics.

## Svelte MCP Tooling
You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

### Available MCP Tools:

#### 1. list-sections
Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

#### 2. get-documentation
Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

#### 3. svelte-autofixer
Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

#### 4. playground-link
Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Troubleshooting
- **Web Research**: If you are stuck on library implementation or API changes (e.g., changes to `@ai-sdk/svelte` or other modern package versions), remember to actively use your **web fetch and search tools** to grab the latest official documentation or examples from the internet before making assumptions.
