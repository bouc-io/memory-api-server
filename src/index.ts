// Initialize OpenTelemetry FIRST (patches http/express before they load). No-op
// unless OTEL is configured. See lib/tracing.ts.
import "./lib/tracing";
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { logger, createComponentLogger } from "./lib/logger";
import { VectorService } from "./services/vector.service";
import { openApiSpec } from "./lib/swagger";
import { register as metricsRegister } from "./lib/promMetrics";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

// Routes
import memoryRoutes from "./routes/memory.routes";
import assignmentRoutes from "./routes/assignment.routes";
// import collectionRoutes from './routes/collection.routes';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;
// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Interactive API docs. Served in every environment: exposure is gated at the edge
// (Istio + oauth2-proxy), not by NODE_ENV, and neither path is routed externally.
// /openapi.json is read in-mesh by apidocs-api-server, which aggregates every
// service's spec at api.<domain>/v1/api-docs.
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// Prometheus metrics (scraped via the chart's prometheus.io/scrape annotation)
app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

// Health Check - Enhanced
app.get("/health", (req: Request, res: Response) => {
  const vectorMeta = VectorService.getMetadata();

  if (!vectorMeta.ready) {
    res.status(503).json({
      status: "unhealthy",
      reason: "Embedding model not initialized",
      model: vectorMeta.model,
    });
    return;
  }

  res.status(200).json({
    status: "ok",
    embedding_model: vectorMeta.model,
    embedding_dimension: vectorMeta.dimension,
  });
});

// API Routes
app.use("/v1/memories", memoryRoutes);
app.use("/v1/assignments", assignmentRoutes);

// 404 + global error handler (must be after all routes)
app.use(notFoundHandler);
app.use(errorHandler);

const VECTOR_RETRY_INTERVAL_MS = 30_000;

async function tryInitializeVectorService(): Promise<void> {
  try {
    const initStart = Date.now();
    await VectorService.initialize();
    logger.info(
      {
        duration_ms: Date.now() - initStart,
        embedding_model: VectorService.getMetadata().model,
        embedding_dimension: VectorService.getMetadata().dimension,
        component: "startup",
      },
      "VectorService initialized successfully",
    );
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        retry_in_ms: VECTOR_RETRY_INTERVAL_MS,
        component: "startup",
      },
      "Ollama unavailable — serving in degraded mode, retrying",
    );
    setTimeout(tryInitializeVectorService, VECTOR_RETRY_INTERVAL_MS);
  }
}

// Application Startup
async function startServer() {
  logger.info("Initializing application...");

  // Start accepting requests immediately — degraded mode until Ollama is ready
  app.listen(port, () => {
    logger.info(
      { port, component: "startup" },
      `Server is running at http://localhost:${port}`,
    );
  });

  await tryInitializeVectorService();
}

// Start the application
startServer();
