/**
 * embeddingAssignmentClient (memory-api-server)
 *
 * Fetches the resolved embedding provider assignment for the 'memory_embedding'
 * use-case from admin-api-server's config endpoint. The endpoint applies the
 * org → global override chain based on the caller's JWT org claim.
 *
 * Returns null on any failure so the caller can fall back to the env-var
 * Ollama path (OLLAMA_URL + EMBEDDING_MODEL).
 */

import axios from 'axios';
import https from 'https';
import { createComponentLogger } from '../lib/logger';

const log = createComponentLogger('embedding-assignment-client');

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === 'true';

export interface EmbeddingProviderConfig {
    provider: string;       // 'ollama' | 'boucio' | 'openai' | 'azure' | 'custom' | ...
    api_endpoint: string;
    api_key: string | null;
    model: string;
}

/**
 * Fetch the embedding assignment config for the 'memory_embedding' use-case.
 * Uses the caller's Bearer token so the admin API resolves the correct org assignment.
 *
 * @returns EmbeddingProviderConfig if an assignment is found, null otherwise
 *          (fallback to env-var Ollama)
 */
export async function fetchEmbeddingAssignmentConfig(
    accessToken?: string
): Promise<EmbeddingProviderConfig | null> {
    const adminUrl = process.env.ADMIN_API_URL;
    if (!adminUrl) {
        log.debug('ADMIN_API_URL not set — skipping embedding assignment fetch, using env-var Ollama fallback');
        return null;
    }

    if (!accessToken) {
        log.debug('No access token provided — skipping embedding assignment fetch, using env-var Ollama fallback');
        return null;
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS });

    try {
        const response = await axios.get(
            `${adminUrl}/v1/config/llm-assignment/memory_embedding`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                httpsAgent,
                timeout: 5000,
            }
        );

        // The admin API returns:
        //   { model, enable_reasoning, provider: { id, name, provider, api_endpoint, api_key } }
        const raw = response.data;
        const providerInfo = raw.provider;
        if (!providerInfo) {
            log.debug('memory_embedding assignment has no provider configured — using env-var Ollama fallback');
            return null;
        }

        const config: EmbeddingProviderConfig = {
            provider: providerInfo.provider,
            api_endpoint: providerInfo.api_endpoint ?? '',
            api_key: providerInfo.api_key ?? null,
            model: raw.model ?? '',
        };

        log.debug(
            { provider: config.provider, model: config.model },
            'Embedding assignment config fetched'
        );
        return config;
    } catch (err: any) {
        // 404 = no assignment configured for this org → normal fallback
        if (err?.response?.status === 404) {
            log.debug('No memory_embedding assignment found — using env-var Ollama fallback');
        } else {
            log.warn(
                { err: err?.message },
                'Failed to fetch memory_embedding assignment config — using env-var Ollama fallback'
            );
        }
        return null;
    }
}
