import swaggerJSDoc from 'swagger-jsdoc';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string };

/**
 * OpenAPI spec built from @openapi JSDoc blocks on the route files.
 * Served at /api-docs in non-production (see index.ts).
 */
export const openApiSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'memory-api-server',
      version: pkg.version,
      description: 'pgvector-backed memory retrieval service for the bouc.io AI assistant platform.',
      license: { name: 'Elastic-2.0', url: 'https://www.elastic.co/licensing/elastic-license' },
    },
    servers: [{ url: '/', description: 'Current host' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js'],
});
