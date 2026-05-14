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
    flowState: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    developer: {
      findUnique: vi.fn(async () => ({ sentryWebhookToken: null })),
      update: vi.fn(async () => ({})),
    },
    githubAppInstallation: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock('../../../src/api/middleware/projectContext.js', () => ({
  resolveProjectContext: vi.fn(async () => ({ projectId: 'proj-test' })),
  PROJECT_HEADER: 'x-mur-project-id',
}));

vi.mock('../../../src/services/flowState.service.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/services/flowState.service.js')>(
    '../../../src/services/flowState.service.js',
  );
  return { ...real, setFlowState: vi.fn(async () => ({ updatedAt: new Date() })) };
});

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
    githubAppSlug: 'usemur-test',
    githubAppClientSecret: 'test-secret-for-state-hmac',
  },
}));

// installCofounderFlowForDeveloper now enforces "off until required
// tool is connected" via loadDeveloperConnections. The install-test
// harness asserts the gate-flip / stub-config behavior assuming tools
// ARE connected; mock a permissive set so the precondition passes for
// every flow in the registry. The route-handler tests in
// src/api/routes/installs.routes.test.ts exercise the refusal branch
// directly.
vi.mock('../../../src/services/integrations/connectionState.js', () => ({
  loadDeveloperConnections: vi.fn(async () => ({
    slugs: new Set(['github', 'sentry', 'stripe', 'linear']),
  })),
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

export interface InstallEndpointTestOptions {
  /**
   * When true, the install endpoint MUST NOT flip the FlowState
   * `enabled` gate — used by welcome-flow / churn-flow, which hold
   * the gate off until the founder completes setup (subject + body
   * + reply-to verification). The response still returns 201 and a
   * `setupInstructions` payload describing the next step.
   */
  holdsGate?: boolean;
}

export function runInstallEndpointTest(
  registrySlug: string,
  options: InstallEndpointTestOptions = {},
): void {
  const normalized = normalizeSlug(registrySlug);
  const holdsGate = options.holdsGate === true;

  describe(`install endpoint: ${registrySlug}`, () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      holdsGate
        ? 'returns 201 with email-flow setupInstructions and does NOT flip the gate'
        : 'returns 201 and flips the FlowState enabled gate',
      async () => {
        const res = await request(buildApp())
          .post('/api/flows/install')
          .send({ slug: registrySlug, actingAgent: 'claude-code' });

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.install.flow.flowType).toBe('cofounder');
        expect(res.body.install.flow.slug).toBe(normalized);
        if (holdsGate) {
          // The ENABLED gate must stay off — but a stub CONFIG row is
          // written so the install surfaces in the dashboard list.
          assertNoEnabledFlip();
          assertStubConfigWritten(normalized);
          expect(res.body.setupInstructions?.kind).toBe('email-flow');
          expect(res.body.setupInstructions?.needsFounderSetup).toBe(true);
        } else {
          expect(setFlowState).toHaveBeenCalledWith('proj-test', normalized, 'enabled', true);
        }
      },
    );

    it('accepts the bare slug form', async () => {
      const res = await request(buildApp()).post('/api/flows/install').send({ slug: normalized });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      if (holdsGate) {
        assertNoEnabledFlip();
      } else {
        expect(setFlowState).toHaveBeenCalledWith('proj-test', normalized, 'enabled', true);
      }
    });
  });
}

function assertNoEnabledFlip(): void {
  const calls = (setFlowState as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  for (const call of calls) {
    expect(call[2]).not.toBe('enabled');
  }
}

function assertStubConfigWritten(slug: string): void {
  expect(setFlowState).toHaveBeenCalledWith(
    'proj-test',
    slug,
    'config',
    expect.objectContaining({
      status: 'SETUP',
      pausedReason: 'agent-install-pending-founder-setup',
    }),
  );
}
