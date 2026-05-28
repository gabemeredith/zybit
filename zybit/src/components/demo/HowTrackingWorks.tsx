/**
 * "How tracking works" panel. Surfaces the proxy-bridge model on the
 * demo cockpit so a viewer can immediately see how both buckets are
 * measured from a single PostHog project. Server component — no state.
 */

const INK = "#111";
const MUTED = "#6B6B6B";

export default function HowTrackingWorks() {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(0,0,0,0.05)",
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: MUTED,
          marginBottom: 8,
        }}
      >
        How both variants are tracked
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: INK, lineHeight: 1.55 }}>
        One PostHog project sees both buckets. The Zybit proxy stamps a sticky
        <code style={mono}>_zybit_vid</code> cookie and picks the bucket, then
        injects a bridge into <strong>control and variant HTML</strong> that
        registers <code style={mono}>posthog.register({"{ zybit_vid }"})</code>.
        Every PostHog event carries it as a super-property; the assignment log
        joins to conversions on that key.
      </p>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: INK, lineHeight: 1.55 }}>
        <li>Proxy sets <code style={mono}>_zybit_vid</code> + bucket cookie</li>
        <li>Proxy logs assignment server-side, keyed by <code style={mono}>zybit_vid</code></li>
        <li>Bridge script registers <code style={mono}>zybit_vid</code> on PostHog</li>
        <li>Outcome compute joins assignments ↔ PostHog events on the shared id</li>
      </ol>
    </div>
  );
}

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  background: "rgba(0,0,0,0.04)",
  padding: "1px 4px",
  borderRadius: 4,
};
