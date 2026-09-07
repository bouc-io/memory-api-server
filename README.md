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

-   **Runtime**: Node.js (v20+)
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

-   Node.js (v20 or later)
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

Push the Prisma schema to your database:

```bash
npm run db:push
# or for migration history:
npm run db:migrate
```

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

## Quality Gates

```bash
npm run lint          # ESLint (flat config)
npm run lint:fix      # auto-fix what is mechanically fixable
npm run format:check  # prettier, check only
npm run format        # prettier, write
npm run build         # tsc
npm test              # vitest, unit tests only
npm run test:ci       # vitest + coverage, writes junit.xml and coverage/
```

CI runs `lint` and `unit-test` from the shared `bouc-io/ci-templates` project.

- **Lint uses a warning ratchet.** ESLint *errors* always fail the build. Warnings are
  capped by `max_warnings` in `.gitlab-ci.yml`, currently **16** (12 no-explicit-any, 4 no-unused-vars). When you
  clean some up, lower the number. Never raise it, and never silence a rule repo-wide to
  get green.
- **Formatting is enforced.** `format:check` gates, using prettier defaults with no config
  file.

Two things to know before you ever run a bulk reformat here:

- **Prettier needs two passes.** It breaks some method chains across lines on the first
  pass and collapses them back on the second, so a single
  `npm run format` can leave `format:check` failing.
- **Prettier can wrap a statement out from under an `eslint-disable-next-line`.** That is
  why the suppressions in this repo use block `/* eslint-disable rule */ ... /* eslint-enable rule */`
  pairs, which survive re-wrapping. Keep them that way.

## License

[Elastic License 2.0](./LICENSE) — source-available; not OSI open source.
