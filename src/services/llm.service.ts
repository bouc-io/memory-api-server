import axios from "axios";
import https from "https";
import { createComponentLogger } from "../lib/logger";

const logger = createComponentLogger("llm-service");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const SUMMARIZATION_MODEL =
  process.env.SUMMARIZATION_MODEL || "qwen3.5:4b";
const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  message: { content: string };
  done: boolean;
}

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS }),
  timeout: 60000,
});

/**
 * Send a chat request to Ollama and return the assistant's text response.
 */
export async function chat(
  messages: OllamaChatMessage[],
  opts: { temperature?: number; max_tokens?: number } = {},
): Promise<string> {
  const body = {
    model: SUMMARIZATION_MODEL,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.3,
      num_predict: opts.max_tokens ?? 256,
    },
  };

  const response = await axiosInstance.post<OllamaChatResponse>(
    `${OLLAMA_URL}/api/chat`,
    body,
  );

  const content = response.data.message?.content?.trim();
  if (!content) {
    logger.warn({ model: SUMMARIZATION_MODEL }, "LLM returned empty response");
    return "";
  }
  return content;
}
