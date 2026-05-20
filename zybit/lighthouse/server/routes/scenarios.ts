import type { IncomingMessage, ServerResponse } from 'node:http';
import { listScenarios } from '../../lib/scenarios';
import { requireAuth } from '../auth';

export function getScenarios(req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;
  const scenarios = listScenarios().map((s) => ({
    id: s.id,
    name: s.name,
    defaultSessions: s.defaultSessions,
    siteSlug: s.siteManifest.slug,
    bucket: s.siteManifest.bucket,
    baseUrl: s.siteManifest.baseUrl,
  }));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ scenarios }));
}
