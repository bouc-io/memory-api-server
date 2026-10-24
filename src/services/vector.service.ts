import axios, { AxiosInstance, AxiosError } from "axios";
import https from "https";
import { createComponentLogger } from "../lib/logger";
import {
  fetchEmbeddingAssignmentConfig,
  EmbeddingProviderConfig,
} from "./embeddingAssignmentClient";

const logger = createComponentLogger("vector-service");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "nomic-embed-text";
const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

// Ollama /api/embed response structure
interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

export class VectorService {
  private static instance: VectorService;
  private static initializationPromise: Promise<void> | null = null;
  private ready: boolean = false;
  private readonly modelName: string;
  private readonly baseUrl: string;
  private readonly expectedDimension: number;
  private readonly axiosInstance: AxiosInstance;

  private constructor() {
    this.modelName = EMBEDDING_MODEL;
    this.baseUrl = OLLAMA_URL;

    // Dimension map for known embedding models
    const dimensionMap: Record<string, number> = {
      "bge-m3": 1024,
      "bge-m3:567m": 1024,
      "bge-m3:latest": 1024,
      "nomic-embed-text": 768,
      "nomic-embed-text:latest": 768,
      "all-minilm": 384,
      "all-minilm:latest": 384,
    };

    this.expectedDimension = dimensionMap[this.modelName] || 1024;

    // Configure axios with HTTPS agent for self-signed certificates
    this.axiosInstance = axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS,
      }),
    });
  }

  /**
   * Singleton accessor - returns initialized instance
   */
  static getInstance(): VectorService {
    if (!VectorService.instance) {
      VectorService.instance = new VectorService();
    }
    return VectorService.instance;
  }

  /**
   * Initialize the embedding service by verifying Ollama connectivity.
   * MUST be called during application startup before accepting requests.
   * Safe to call multiple times (idempotent).
   */
  static async initialize(): Promise<void> {
    const instance = VectorService.getInstance();

    // Prevent concurrent initialization
    if (VectorService.initializationPromise) {
      return VectorService.initializationPromise;
    }

    VectorService.initializationPromise = (async () => {
      if (instance.ready) {
        logger.info("VectorService already initialized");
        return;
      }

      const startTime = Date.now();
      logger.info(
        { model: instance.modelName, ollama_url: instance.baseUrl },
        "Verifying Ollama embedding connectivity...",
      );

      try {
        // Validate connectivity with a lightweight test embedding
        const testEmbedding = await instance.doEmbed("test");
        const elapsed = Date.now() - startTime;

        // Update expected dimension from actual response if it differs
        if (testEmbedding.length !== instance.expectedDimension) {
          logger.warn(
            {
              expected: instance.expectedDimension,
              actual: testEmbedding.length,
              model: instance.modelName,
            },
            "Embedding dimension differs from expected — using actual dimension from model",
          );
          // Override the expected dimension with the real one
          (instance as any).expectedDimension = testEmbedding.length;
        }

        instance.ready = true;
        logger.info(
          {
            model: instance.modelName,
            dimension: instance.expectedDimension,
            ollama_url: instance.baseUrl,
            elapsed_ms: elapsed,
          },
          "Ollama embedding service verified successfully",
        );
      } catch (error) {
        const elapsed = Date.now() - startTime;
        logger.error(
          {
            model: instance.modelName,
            ollama_url: instance.baseUrl,
            elapsed_ms: elapsed,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to verify Ollama embedding service",
        );

        // Clear initialization promise to allow retry
        VectorService.initializationPromise = null;
        throw new Error(`Failed to initialize VectorService: ${error}`, {
          cause: error,
        });
      }
    })();

    return VectorService.initializationPromise;
  }

  /**
   * Check if the service is ready to generate embeddings
   */
  static isReady(): boolean {
    const instance = VectorService.getInstance();
    return instance.ready;
  }

  /**
   * Generate embedding vector for text.
   *
   * If `accessToken` is provided, attempts to fetch the `memory_embedding` assignment
   * from admin-api-server and routes to the configured provider. Falls back to the
   * env-var Ollama path on any failure or when no assignment is configured.
   *
   * Without `accessToken`, always uses the env-var Ollama path.
   *
   * @throws Error if env-var service not initialized (call initialize() first) and
   *         no dynamic assignment is available.
   */
  static async generateEmbedding(
    text: string,
    accessToken?: string,
  ): Promise<number[]> {
    const instance = VectorService.getInstance();
    const startTime = Date.now();

    // Try dynamic assignment path first
    if (accessToken) {
      const config = await fetchEmbeddingAssignmentConfig(accessToken);
      if (config) {
        try {
          const embedding = await VectorService.generateEmbeddingFromConfig(
            text,
            config,
          );
          logger.debug(
            {
              text_length: text.length,
              elapsed_ms: Date.now() - startTime,
              dimension: embedding.length,
              provider: config.provider,
              model: config.model,
            },
            "Generated embedding via assignment config",
          );
          return embedding;
        } catch (error) {
          logger.warn(
            {
              provider: config.provider,
              model: config.model,
              error: error instanceof Error ? error.message : String(error),
            },
            "Dynamic embedding failed — falling back to env-var Ollama",
          );
          // Fall through to env-var path
        }
      }
    }

    // Env-var Ollama fallback
    if (!instance.ready) {
      throw new Error(
        "VectorService not initialized. Call VectorService.initialize() during application startup.",
      );
    }

    try {
      const embedding = await instance.doEmbedWithRetry(text);
      const elapsed = Date.now() - startTime;

      // Validate dimension
      if (embedding.length !== instance.expectedDimension) {
        logger.error(
          {
            expected: instance.expectedDimension,
            actual: embedding.length,
            model: instance.modelName,
          },
          "Embedding dimension mismatch",
        );
        throw new Error(
          `Expected ${instance.expectedDimension} dimensions, got ${embedding.length}`,
        );
      }

      logger.debug(
        {
          text_length: text.length,
          elapsed_ms: elapsed,
          dimension: embedding.length,
        },
        "Generated embedding (env-var Ollama)",
      );

      return embedding;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.error(
        {
          text_length: text.length,
          elapsed_ms: elapsed,
          error: error instanceof Error ? error.message : String(error),
        },
        "Embedding generation failed",
      );
      throw error;
    }
  }

  /**
   * Generate an embedding using a dynamically resolved provider config.
   * Routes by provider type:
   *  - ollama / boucio / (default): POST {api_endpoint}/api/embed  (Ollama format)
   *  - openai / azure / custom:     POST {api_endpoint}/embeddings  (OpenAI format)
   */
  private static async generateEmbeddingFromConfig(
    text: string,
    config: EmbeddingProviderConfig,
  ): Promise<number[]> {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: !(process.env.ALLOW_SELF_SIGNED_CERTS === "true"),
    });

    const UNSUPPORTED_EMBEDDING_PROVIDERS = ["anthropic", "google"];
    if (UNSUPPORTED_EMBEDDING_PROVIDERS.includes(config.provider)) {
      logger.warn(
        { provider: config.provider, model: config.model },
        `Provider '${config.provider}' does not support embeddings — falling back to env-var Ollama. ` +
          `Configure a boucio, ollama, openai, or custom provider for memory_embedding instead.`,
      );
      throw new Error(
        `Provider '${config.provider}' does not support embeddings`,
      );
    }

    const isOllamaStyle =
      ["ollama", "boucio"].includes(config.provider) || !config.provider;

    if (isOllamaStyle) {
      // boucio provider intentionally has no api_endpoint — falls back to OLLAMA_URL env var,
      // matching the same pattern used by BoucioClient in other services.
      const baseUrl = config.api_endpoint || OLLAMA_URL;
      const url = `${baseUrl}/api/embed`;
      const headers: Record<string, string> = {};
      if (config.api_key) headers["Authorization"] = `Bearer ${config.api_key}`;

      const response = await axios.post<{ embeddings: number[][] }>(
        url,
        { model: config.model, input: text },
        { httpsAgent, headers, timeout: 30000 },
      );

      const embeddings = response.data?.embeddings;
      if (!embeddings || !embeddings[0]) {
        throw new Error("Ollama-style /api/embed returned empty embeddings");
      }
      return embeddings[0];
    } else {
      // OpenAI-compatible format
      const url = `${config.api_endpoint}/embeddings`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.api_key) headers["Authorization"] = `Bearer ${config.api_key}`;

      const response = await axios.post<{
        data: Array<{ embedding: number[] }>;
      }>(
        url,
        { model: config.model, input: text },
        { httpsAgent, headers, timeout: 30000 },
      );

      const embedding = response.data?.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error("OpenAI-style /embeddings returned empty data");
      }
      return embedding;
    }
  }

  /**
   * Get model metadata for health checks and debugging
   */
  static getMetadata(): {
    model: string;
    dimension: number;
    ready: boolean;
  } {
    const instance = VectorService.getInstance();
    return {
      model: instance.modelName,
      dimension: instance.expectedDimension,
      ready: instance.ready,
    };
  }

  /**
   * Call Ollama /api/embed endpoint (single attempt, no retry)
   */
  private async doEmbed(text: string): Promise<number[]> {
    const response = await this.axiosInstance.post<OllamaEmbedResponse>(
      `${this.baseUrl}/api/embed`,
      {
        model: this.modelName,
        input: text,
      },
    );

    const data = response.data;
    if (!data.embeddings || !data.embeddings[0]) {
      throw new Error("Ollama /api/embed returned empty embeddings");
    }

    return data.embeddings[0];
  }

  /**
   * Call Ollama /api/embed with retry logic (exponential backoff)
   */
  private async doEmbedWithRetry(text: string): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.doEmbed(text);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRetryable(error) || attempt === MAX_RETRIES) {
          break;
        }

        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { attempt, maxRetries: MAX_RETRIES, delay: delayMs },
          "Embedding request failed, retrying",
        );
        await this.delay(delayMs);
      }
    }

    throw lastError || new Error("Unknown embedding error");
  }

  /**
   * Check if an error is retryable (network errors or 5xx)
   */
  private isRetryable(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (!axiosError.response) return true; // Network error
      const status = axiosError.response.status;
      return status >= 500 && status < 600;
    }
    return false;
  }

  /**
   * Delay helper for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
