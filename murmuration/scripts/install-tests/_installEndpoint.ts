// Shared install-endpoint test runner — exercises the actual
// `POST /api/flows/install` route end-to-end via supertest with
// mocked prisma + flowState. Each per-flow install test calls
// `runInstallEndpointTest(<slug>)` so the test isn't a tautology
// (the previous shape just asserted YAML.status === 'shipping',
// which the registry-coherence test already does).
//
// What this proves per flow:
//   1. The slug parses through the registry's normalizeSlug.
//   2. POST /api/flows/install with the slug returns 201.
//   3. The cofounder branch fires `setFlowState(projectId, slug,
//      'enabled', true)` — i.e. the gate the handler reads is
//      actually flipped.
//
// What this does NOT prove (deeper coverage tracked as follow-on):
//   - Handler runs to completion against a synthetic project.
//   - First-artifact emission.
//   - End-to-end OAuth grant + webhook firing.
//
// Those need per-handler test harnesses with prisma fixtures and
// external-service mocks. The unit tests next to each handler
// (e.g. competitorScan.handler.test.ts) cover handler behavior
// directly. This file's contract is the install ↔ gate ↔ slug
// triangle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../src/db/client.js', () => ({
  default: {
    flow: { findFirst: vi.fn() },
    userFlowInstall: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    project: { findMany: vi.fn(async () => []) },
    flowState: { findMany: vi.fn(async () => []) },
    developer: {
      findUnique: vi.fn(async () => ({ sentryWebhookToken: null })),
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock('../../../src/api/middleware/projectContext.js', () => ({
  resolveProjectContext: vi.fn(async () => ({ projectId: 'proj-test', fellBackToPrimary: true })),
  PROJECT_HEADER: 'x-mur-project-id',
}));

vi.mock('../../../src/services/flowState.service.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/services/flowState.service.js')>(
    '../../../src/services/flowState.service.js',
  );
  return { ...real, setFlowState: vi.fn(async () => ({ updatedAt: new Date() })) };
});

vi.mock('../../../src/services/projects.service.js', () => ({
  getOrCreatePrimaryProject: vi.fn(async () => ({ id: 'proj-primary' })),
}));

vi.mock('../../../src/api/middleware/auth.js', () => ({
  developerAuth: (req: { developerId: string }, _res: unknown, next: () => void) => {
    req.developerId = 'dev-1';
    next();
  },
  tryResolveDeveloperFromToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/config/index.js', () => ({
  config: {
    publicBaseUrl: 'https://test.usemur.dev',
    githubAppEnabled: false,
  },
}));

const { default: installsRouter } = await import('../../../src/api/routes/installs.routes.js');
const { errorHandler } = await import('../../../src/api/middleware/errorHandler.js');
const { setFlowState } = await import('../../../src/services/flowState.service.js');
const { normalizeSlug } = await import('../../../src/services/flowState.service.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', installsRouter);
  app.use(errorHandler);
  return app;
}

export function runInstallEndpointTest(registrySlug: string): void {
  const normalized = normalizeSlug(registrySlug);

  describe(`install endpoint: ${registrySlug}`, () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns 201 and flips the FlowState enabled gate', async () => {
      const res = await request(buildApp())
        .post('/api/flows/install')
        .send({ slug: registrySlug, actingAgent: 'claude-code' });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.install.flow.flowType).toBe('cofounder');
      expect(res.body.install.flow.slug).toBe(normalized);
      expect(setFlowState).toHaveBeenCalledWith('proj-primary', normalized, 'enabled', true);
    });

    it('accepts the bare slug form', async () => {
      const res = await request(buildApp()).post('/api/flows/install').send({ slug: normalized });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(setFlowState).toHaveBeenCalledWith('proj-primary', normalized, 'enabled', true);
    });
  });
}
