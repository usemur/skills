// cli-to-connector.mjs — single source of truth mapping the `tool`
// key from cli-scans.mjs / scan-cli.jsonl to the Composio connector
// slug exposed by `GET /api/connections/apps`. Used by the digest
// install hand-off (skill-pack/prompts/install.md) to surface
// "you have <tool> authed locally but not connected to Mur — connect?"
// with one-tap deep-links.
//
// Keep in sync with src/services/composio.service.ts SUPPORTED_APPS:
// when a new connector ships there, add the matching CLI detection
// in cli-scans.mjs BUILTIN_SCANS and a row here.

export const CLI_TO_CONNECTOR = {
  // CLI tool name → Composio connector slug.
  //
  // gh maps to 'github' for downstream filtering — the digest install
  // hand-off DROPS github entries because the native Murmur Cofounder
  // GitHub App handles GitHub, not Composio. Including the row here
  // makes the filter explicit at the call site.
  gh: 'github',
  stripe: 'stripe',
  vercel: 'vercel',
  // sentry-cli detection lives in cli-scans.mjs; the 'sentry'
  // Composio slug isn't in SUPPORTED_APPS yet (V2 staging — see
  // composio.service.ts:117). When it lands, uncomment:
  //   'sentry-cli': 'sentry',
  //
  // Linear has no first-party CLI — surfaced via app-sweeper.mjs
  // (Linear.app desktop) instead. Same for Notion. Not in this map.
};

export function cliToConnector(tool) {
  return CLI_TO_CONNECTOR[tool] ?? null;
}
