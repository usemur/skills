import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const FLOWS_DIR = join(REPO_ROOT, 'skill-pack', 'registry', 'flows');

export type FlowStatus = 'shipping' | 'building' | 'roadmap' | 'deprecated';

export interface RequiredCodeEntry {
  service: string;
  exports: string[];
}

export interface FlowYaml {
  slug: string;
  display_name?: string;
  category?: string;
  recommended?: boolean;
  status?: FlowStatus;
  install_test?: string;
  required_code?: RequiredCodeEntry[];
  wraps_tool?: string | null;
  mcp?: { endpoint?: string | null; http?: string | null };
  pricing?: Record<string, unknown>;
  detection?: Record<string, unknown>;
  reason_template?: string;
  alternatives?: string[];
  self_host_alternative?: string | null;
}

export function loadFlow(basename: string): FlowYaml {
  const path = join(FLOWS_DIR, basename);
  const raw = readFileSync(path, 'utf8');
  return parseYaml(raw) as FlowYaml;
}

export function listFlowFiles(): string[] {
  return readdirSync(FLOWS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
}

export function loadAllFlows(): Array<{ file: string; flow: FlowYaml }> {
  return listFlowFiles().map((file) => ({ file, flow: loadFlow(file) }));
}

/**
 * Resolve a dotted export path against an imported module. Supports:
 *   - top-level exports: "welcomeFlowHandler" → mod.welcomeFlowHandler
 *   - dotted method paths: "stripe.charges.list" → mod.stripe.charges.list
 *
 * Returns `{ found: false, reason }` when any segment along the path
 * is missing, so the failure message can name the exact stop point.
 */
export function resolveExport(
  mod: Record<string, unknown>,
  name: string,
): { found: boolean; reason?: string } {
  const parts = name.split('.');
  let node: unknown = mod;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (node === null || typeof node !== 'object' || !(seg in (node as object))) {
      const traversed = parts.slice(0, i).join('.') || '<module>';
      return { found: false, reason: `missing "${seg}" on ${traversed}` };
    }
    node = (node as Record<string, unknown>)[seg];
  }
  return { found: true };
}
