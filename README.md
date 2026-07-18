# Memory API Server

This project is a dedicated **Memory API Server** for the Bouc.io ecosystem. It is designed to manage and retrieve memories for AI agents, providing a persistent knowledge base across assignments. It mimics the stack and configuration of the `chatbot-api-server` but is tailored for memory management with `pgvector` support.

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

## Getting Started

### 1. Installation

Clone the repository and install dependencies:

```bash
cd application/examples/chatbot-example/memory-api-server
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

## API Usage

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
