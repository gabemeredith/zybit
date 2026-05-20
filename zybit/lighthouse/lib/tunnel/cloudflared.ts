/**
 * Cloudflared quick-tunnel wrapper.
 *
 * Spawns `cloudflared tunnel --url http://localhost:<port>`, scrapes the
 * assigned `https://<slug>.trycloudflare.com` URL from stderr, returns
 * it. The caller is responsible for calling `.close()` when done.
 *
 * Why this exists: when the snapshot fetcher's SPA-shell fallback kicks
 * in, it asks Browserless (a cloud service) to render the page. Cloud
 * Browserless can't reach `cal-com.lighthouse.local:4001` on your
 * laptop, so we expose a public URL via a tunnel for the duration of
 * the run.
 *
 * Requires the `cloudflared` binary on PATH. Install:
 *   brew install cloudflared              (macOS)
 *   https://github.com/cloudflare/cloudflared/releases  (other)
 *
 * NOT used by the acmebank smoke scenario (it doesn't trigger Browserless
 * — see runScenario). Wired up for the user-fed OSS-site path.
 */

import { spawn, type ChildProcess } from 'node:child_process';

const TRYCLOUDFLARE_RE = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i;
const URL_WAIT_TIMEOUT_MS = 20_000;

export interface Tunnel {
  publicUrl: string;
  close(): Promise<void>;
}

export interface SpawnTunnelOpts {
  localPort: number;
  /** Override default 20s wait for the tunnel URL line. */
  urlWaitMs?: number;
}

export async function spawnTunnel(opts: SpawnTunnelOpts): Promise<Tunnel> {
  const child = spawn(
    'cloudflared',
    ['tunnel', '--url', `http://localhost:${opts.localPort}`, '--no-autoupdate'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const publicUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`cloudflared did not emit a tunnel URL within ${opts.urlWaitMs ?? URL_WAIT_TIMEOUT_MS}ms`));
    }, opts.urlWaitMs ?? URL_WAIT_TIMEOUT_MS);

    const onData = (buf: Buffer): void => {
      const text = buf.toString('utf8');
      const m = TRYCLOUDFLARE_RE.exec(text);
      if (m) {
        cleanup();
        resolve(m[1]);
      }
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`cloudflared exited early with code ${code ?? 'null'}`));
    };

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });

  return {
    publicUrl,
    close: () => closeChild(child),
  };
}

async function closeChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  return new Promise((resolve) => {
    const done = (): void => resolve();
    child.once('exit', done);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 2_000);
  });
}
