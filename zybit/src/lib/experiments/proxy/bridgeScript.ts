/**
 * PostHog visitor-ID bridge.
 *
 * The proxy assigns every visitor a stable `_zybit_vid` cookie and logs
 * `experiment_assignment` events keyed by that ID. Conversion events,
 * however, arrive via the customer's PostHog and carry PostHog's own
 * session/distinct IDs — which never match the Zybit visitor ID, so the
 * outcome-computation join undercounts conversions.
 *
 * This script bridges the gap: it registers the server-known Zybit visitor
 * ID as a PostHog super-property (`zybit_vid`), so every subsequent PostHog
 * event carries it. `deriveSessionId` in the PostHog mapping prefers
 * `zybit_vid`, making the conversion join match with no SQL change.
 *
 * The proxy already knows the visitor ID server-side, so the script does
 * not parse cookies client-side. It polls briefly for `window.posthog`
 * (PostHog may load async) and gives up after ~6s rather than polling
 * forever.
 */

const SCRIPT_MARKER = 'data-zybit-bridge';

/** Serialize a value as a safe JS string literal inside an inline <script>. */
function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Build the inline bridge `<script>` tag for a given Zybit visitor ID.
 * Returns a single self-contained tag with no external dependencies.
 */
export function buildBridgeScript(visitorId: string): string {
  const v = jsStringLiteral(visitorId);
  const js =
    `(function(){var v=${v},n=0;` +
    `function r(){try{` +
    `if(window.posthog&&typeof window.posthog.register==='function'){window.posthog.register({zybit_vid:v});return;}` +
    `}catch(e){}` +
    `if(++n<20){setTimeout(r,300);}}r();})();`;
  return `<script ${SCRIPT_MARKER}>${js}</script>`;
}

/**
 * Inject the bridge script into an HTML document. Inserts before `</head>`
 * when present, else before `</body>`, else prepends. Idempotent: if the
 * marker is already present the HTML is returned unchanged. Never throws —
 * on any failure the original HTML is returned so the proxy stays fail-open.
 */
export function injectBridgeScript(html: string, visitorId: string): string {
  try {
    if (html.includes(SCRIPT_MARKER)) return html;
    const tag = buildBridgeScript(visitorId);

    const headClose = html.search(/<\/head\s*>/i);
    if (headClose !== -1) {
      return html.slice(0, headClose) + tag + html.slice(headClose);
    }
    const bodyClose = html.search(/<\/body\s*>/i);
    if (bodyClose !== -1) {
      return html.slice(0, bodyClose) + tag + html.slice(bodyClose);
    }
    return tag + html;
  } catch {
    return html;
  }
}
