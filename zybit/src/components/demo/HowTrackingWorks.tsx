/**
 * "How both versions are measured" panel on the demo cockpit. Plain-language
 * framing of the bridge model — both versions measured from the customer's
 * existing PostHog, no re-instrumentation — for a PM/founder demo audience.
 * Server component — no state.
 */

export default function HowTrackingWorks() {
  return (
    <div className="brut-card p-5">
      <div className="brut-label mb-2">How both versions are measured</div>
      <p className="text-[13px] leading-relaxed text-[#111] mb-3">
        Zybit measures the control and the variant from your{" "}
        <strong>existing PostHog</strong> — no new tracking code, no second project. Each visitor is
        tagged once with the version they saw, that tag rides along on every event they fire, and at
        results time Zybit maps each conversion back to its version.
      </p>
      <ol className="m-0 list-none p-0 space-y-1.5">
        {[
          "Visitor arrives → Zybit assigns a version and tags them",
          "The tag travels with every PostHog event they trigger",
          "Results match each conversion to the version that visitor saw",
        ].map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[12px] leading-snug text-[#111]">
            <span className="mono-text shrink-0 text-[10px] font-bold text-[#6B6B6B] mt-0.5">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
