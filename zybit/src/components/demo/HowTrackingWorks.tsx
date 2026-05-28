/**
 * "How both versions are measured" panel on the demo cockpit. Plain-language
 * framing of the bridge model — both versions measured from the customer's
 * existing PostHog, no re-instrumentation — for a PM/founder demo audience.
 * Server component — no state.
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
        How both versions are measured
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: INK, lineHeight: 1.55 }}>
        Zybit measures the control and the variant from your{" "}
        <strong>existing PostHog</strong> — no new tracking code, no second
        project. Each visitor is tagged once with the version they saw, that tag
        rides along on every event they fire, and at results time Zybit maps each
        conversion back to its version.
      </p>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: INK, lineHeight: 1.55 }}>
        <li>Visitor arrives → Zybit assigns a version and tags them</li>
        <li>The tag travels with every PostHog event they trigger</li>
        <li>Results match each conversion to the version that visitor saw</li>
      </ol>
    </div>
  );
}
