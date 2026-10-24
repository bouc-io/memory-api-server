# Memory API Server

Memory backend for the **bouc.io AI assistant platform**. Stores and retrieves the durable memories
that give the assistant continuity across conversations, using `pgvector` for semantic search.

Part of the [bouc.io AI platform](../../../documentation/getting-started/README.md#ai-assistant-platform).

## Role in the platform

`agent-api-server` calls this service on two paths: it retrieves relevant memories before a run
(tiered retrieval, critical memories first, then semantic vector search fills the remaining slots),
and after a run `memory-distiller` stores newly distilled memories here.

Memories carry a category (`persona`, `preference`, `fact`, `instruction`, `context`) and an
importance level (`critical` > `high` > `medium` > `low`). Every operation is scoped to the
`preferred_username` claim of the caller's JWT.

## API overview

### Health Check
-   `GET /health`: Returns `{ status: 'ok' }`

### Authentication

All API endpoints (except `/health`) require authentication via a JWT Bearer token.
The `Authorization` header must be present:

`Authorization: Bearer <token>`

The server extracts the `preferred_username` claim from the token and uses it as the `userId` to scope all operations.

### Memories

-   **List Memories**: `GET /v1/memories`
    -   Query Params: `category`, `importance`, `tags` (comma-separated), `search` (text), `limit`, `offset`.
-   **Get Memory**: `GET /v1/memories/:id`
-   **Create Memory**: `POST /v1/memories`
    ```json
    {
      "content": "User prefers concise answers.",
      "category": "preference",
      "importance": "high",
      "tags": ["style", "communication"]
    }
    ```
-   **Update Memory**: `PATCH /v1/memories/:id`
-   **Delete Memory**: `DELETE /v1/memories/:id`
-   **Semantic Search**: `POST /v1/memories/search`
    ```json
    {
      "query": "What communication style does the user like?",
      "limit": 5,
      "min_relevance": 0.7
    }
    ```

### Statistics
-   **Get Stats**: `GET /v1/memories/stats` (Counts by category, importance, etc.)

## Stack & Technologies

-   **Runtime**: Node.js (v22.12+)
-   **Language**: TypeScript
-   **Framework**: Express.js
-   **Database**: PostgreSQL
-   **ORM**: Prisma
-   **Vector Search**: `pgvector` (PostgreSQL extension)
-   **Container**: Docker

## Features

-   **Memory Management**: CRUD operations tailored for AI memories (Persona, Facts, Preferences, etc.).
-   **Semantic Search**: Built-in vector search to find relevant memories based on context embeddings.
-   **Metadata**: Flexible metadata support (JSON) for tracking sources and context.
-   **Analytics**: Tracks access counts and relevance scores.
-   **Dockerized**: Ready for containerized deployment.

## Prerequisites

-   Node.js (v22.12 or later)
-   PostgreSQL database with `vector` extension enabled.
-   `npm` or `yarn`

## Local development

### 1. Installation

Clone the repository and install dependencies:

```bash
cd memory-api-server
npm install
```

### 2. Environment Setup

Copy `.env.example` (or use the provided `.env`) and configure your database connection:

```bash
DATABASE_URL="postgresql://admin:admin@localhost:5432/memorydb"
PORT=3000
```

> **Note**: Ensure your PostgreSQL database has the `vector` extension installed:
> `CREATE EXTENSION IF NOT EXISTS vector;`

### 3. Database Migration

Push the Prisma schema to your database, then generate the client (neither `db push` nor
`migrate dev` generates it any more):

```bash
npm run db:push
# or for migration history:
npm run db:migrate

npm run db:generate   # Prisma client → src/generated/prisma (gitignored)
```

### Prisma

Prisma ORM 7, with the `prisma-client` generator and CommonJS output. A few rules to keep in mind:

- **Connection settings live in `prisma.config.ts`, not in the schema.** It loads `.env` itself
  and reads `DATABASE_URL`.
- **The app connects through the `pg` driver adapter (`@prisma/adapter-pg`)**, created in
  `src/services/prisma.service.ts`. Import `PrismaClient`, `Prisma`, enums and model types from
  `src/generated/prisma/client`, never from `@prisma/client`.
- **Vector search stays in raw SQL.** The `embedding` column is `Unsupported("vector")`, so every
  pgvector read and write goes through `$queryRaw` / `$executeRaw` with `::vector` casts.
- **Upgrade `prisma`, `@prisma/client` and `@prisma/adapter-pg` together.** They are pinned to the
  same exact version because they are released in lockstep. Check the result with
  `npm ls prisma @prisma/client @prisma/adapter-pg pg`.

### 4. Running the Server

**Development Mode:**
```bash
npm run dev
```

**Production Build:**
```bash
npm run build
npm start
```

### 5. Docker Build

```bash
docker build -t memory-api-server .
```

## Environment variables

See `.env.example` for the full reference. The ones that matter most:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres DSN; the database must have the `vector` extension |
| `PORT` | Listen port, `3000` by default |
| `EMBEDDING_MODEL` | Embedding model pulled in Ollama. Cluster and production use `nomic-embed-text` (768 dimensions) |
| `OLLAMA_URL` | Ollama endpoint used for embeddings and summarization |
| `SUMMARIZATION_MODEL` | Model used to compress long memories |

Switching `EMBEDDING_MODEL` invalidates every stored vector. Run `npm run migrate:re-embed`
afterwards to re-embed all memories with the new model.

## Project Structure

```
src/
├── controllers/    # API Logic (Memory, Assignment, Collections)
├── routes/         # Express Routes
├── services/       # Prisma & Vector Services
├── index.ts        # Entry point
prisma/
└── schema.prisma   # Database Schema
```

## Prompts

All LLM-facing prompt text lives in `prompts/*.md`, one file per unit, never inline in code.
A build step compiles them into the committed `src/prompts/generated.ts`, which doubles as
the promptset lock: it carries every per-unit hash plus the set hash.

Editing a prompt:

1. Edit the `.md` file under `prompts/`.
2. Bump `version` in its frontmatter, and `prompts/promptset.json` if the change is
   meaningful.
3. `npm run prompts:build` to regenerate `src/prompts/generated.ts`.
4. `npx vitest run -u src/prompts` to refresh the committed golden renders.
5. Commit the markdown, the regenerated module and the golden diff together. The golden
   diff is the reviewable part: it shows the before and after of the text the model
   receives, including the ripple when a shared fragment changes.

`npm run prompts:check` fails when `generated.ts` no longer matches the markdown. The same
assertion runs as a unit test, so CI catches a forgotten regenerate.

Read-only inspection of a running deployment, gated to bouc.io staff roles:

```bash
GET /v1/memories/prompts                 # inventory: id, version, hash
GET /v1/memories/prompts/{{id}}            # template as authored
GET /v1/memories/prompts/{{id}}/rendered   # composed text the model receives
GET /v1/memories/promptset               # version + hash for this deployment
```

Full design, including the inventory and the known divergences preserved on purpose:
[PROMPT_MANAGEMENT.md](../../agent/agent-api-server/PROMPT_MANAGEMENT.md)

## Quality Gates

```bash
npm run lint          # ESLint (flat config)
npm run lint:fix      # auto-fix what is mechanically fixable
npm run format:check  # prettier, check only
npm run format        # prettier, write
npm run build         # prisma generate + tsc
npm test              # vitest, unit tests only
npm run test:ci       # vitest + coverage, writes junit.xml and coverage/
```

CI runs `lint` and `unit-test` from the shared `bouc-io/ci-templates` project.

- **Lint uses a warning ratchet.** ESLint *errors* always fail the build. Warnings are
  capped by `max_warnings` in `.gitlab-ci.yml`, currently **16** (12 no-explicit-any, 4 no-unused-vars). When you
  clean some up, lower the number. Never raise it, and never silence a rule repo-wide to
  get green.
- **Formatting is enforced.** `format:check` gates, using prettier defaults with no config
  file. The generated Prisma client is excluded via `.prettierignore` (and from ESLint and
  coverage).

Two things to know before you ever run a bulk reformat here:

- **Prettier needs two passes.** It breaks some method chains across lines on the first
  pass and collapses them back on the second, so a single
  `npm run format` can leave `format:check` failing.
- **Prettier can wrap a statement out from under an `eslint-disable-next-line`.** That is
  why the suppressions in this repo use block `/* eslint-disable rule */ ... /* eslint-enable rule */`
  pairs, which survive re-wrapping. Keep them that way.

## License

[Elastic License 2.0](./LICENSE) — source-available; not OSI open source.
