# Zybit + PostHog: from zero to a live flow graph

**Audience:** A product/founder team that has not yet installed PostHog.
**Outcome:** A connected, verified Zybit account showing your real flow
graph, typically inside 30 minutes of effort.
**Cost:** PostHog free tier (1M events/month, no credit card). Zybit pilot
on top.

This document is the literal walkthrough — what to click, what to paste,
what each screen should look like, and how Zybit tells you whether what
you connected is actually usable.

---

## What Zybit needs from your analytics

Two things, and that is the whole list:

1. **Path / URL on every page view.** So we know which page the user
   was on.
2. **A stable session id across page views.** So we know the visit to
   `/` and the next visit to `/pricing` were the same person, in order.

PostHog's default install captures both automatically. You will not write
any custom tracking code to make Zybit work.

We do **not** need: form fields, button labels, custom events, user
emails, or anything sensitive. The flow graph is built entirely from
*what page* and *which session* — nothing else.

---

## Step 1 — Create a PostHog account (5 min)

1. Go to **https://posthog.com/signup**.
2. Pick **PostHog Cloud (US)** or **(EU)** — whichever matches your
   compliance posture. EU stores data inside the EU. Either is fine for
   Zybit; we read via API and don't care where the source lives.
3. Verify your email; PostHog creates a default project for you.
4. On the project's home screen, note two things you'll need later:
   - The **host URL** in your browser address bar (`https://us.posthog.com`
     for US, `https://eu.posthog.com` for EU).
   - The **project id** — small number visible under *Settings → Project
     details* (e.g. `12345`).

> ✅ At the end of step 1 you have a PostHog account that knows nothing
> yet. That's expected.

---

## Step 2 — Install the snippet on your site (10 min)

PostHog gives you the snippet during onboarding and also at
**Settings → Project → Snippet**. It is two lines of JavaScript plus a
`<script>` tag — paste it inside your `<head>`, exactly as PostHog shows
it. The token in the snippet (`phc_...`) is the **project write key**;
it is meant to be public.

### If your site is plain HTML / SSR (Next.js, Rails, Django, etc.)
Paste the snippet directly into `<head>`. Deploy. Done.

### If you use a tag manager (Google Tag Manager, Segment)
Drop the snippet into a custom HTML tag and trigger it on every page.

### If your site is a React/Vue/Next.js SPA
Use PostHog's official SDK package:
```
npm install posthog-js
```
Then initialise it once in your top-level component:
```js
import posthog from 'posthog-js';
if (typeof window !== 'undefined') {
  posthog.init('phc_YOUR_KEY', {
    api_host: 'https://us.posthog.com',
    capture_pageview: true,
  });
}
```
The `capture_pageview: true` default is what we rely on — keep it on.

> ✅ At the end of step 2, ship the change. Open your site in a fresh
> incognito window and click around two or three pages.

---

## Step 3 — Confirm events are flowing into PostHog (2 min)

This is the "hello world" moment.

1. Open your PostHog project.
2. Go to **Activity → Live events** (in the left sidebar).
3. Within ~30 seconds of clicking around your site, you should see
   `$pageview` events arriving, each with a `$current_url` and a
   `distinct_id`.

If nothing is arriving:
- Check that the snippet is in `<head>` on every page (view-source).
- Check that you didn't put it inside an *Adblocker-detected* code path.
- Check the browser console for CSP errors mentioning `posthog.com`.

> ✅ Once you see `$pageview` events in Live events, PostHog is set up.

---

## Step 4 — Create a Personal API Key (2 min)

Zybit reads your events through PostHog's REST API. The Personal API
Key is a read-only credential separate from the public project key in
the snippet.

1. Click your avatar (top right) → **My settings**.
2. Open **Personal API keys** in the left rail.
3. Click **+ Create personal API key**.
4. **Label:** `zybit-pilot` (or whatever helps you remember it).
5. **Scopes:** select read access. The minimum scopes Zybit needs are
   *Read events* and *Read query*. If your PostHog interface only shows
   coarse-grained "Read-only" — that's fine, pick it.
6. Click **Create**. The key (`phx_...`) is shown **once** — copy it
   into a password manager immediately.

> ⚠️ Treat this key the same way you treat your database password.
> Anyone with it can read your PostHog events.

---

## Step 5 — Connect Zybit and verify (5 min)

1. Sign into Zybit using the magic link the founder sent you.
2. **Onboarding step 1 — Site URL.** Enter the URL of the product
   you instrumented. Continue.
3. **Onboarding step 2 — Connect your analytics.** Pick the *PostHog*
   tab and paste in:
   - **Host URL** from step 1 (e.g. `https://us.posthog.com`)
   - **Project ID** (e.g. `12345`)
   - **Personal API Key** from step 4 (`phx_...`)
   Click **Connect & verify**.

Zybit immediately runs a **pre-flight check** against your PostHog data
in the last 7 days and shows you one of three verdicts:

| Verdict | Meaning | Continue? |
|---|---|---|
| ✅ **Connected — N sessions across M routes** | You're set. Pre-flight saw enough signal for the flow graph to be useful today. | Continue |
| ⚠️ **Connected — but signal is thin** | The connection works; you simply do not have enough traffic in the window yet. The graph will fill in as visits accumulate. Common on day 1 for low-traffic sites. | Continue anyway — re-check in a few days |
| 🛑 **Connected — but cannot build a flow graph** | A blocker (no path on events, no session id) is in the way. The diagnostic message tells you which one. | Fix and re-check |

If you see 🛑, the most common cause is a non-default PostHog SDK
configuration that suppressed pageview capture. Confirm
`capture_pageview` is on, push the change, and click **Re-check**.

4. **Onboarding step 3 — Revenue framing (skippable).** Tells Zybit
   roughly what a conversion is worth so findings get a dollar estimate
   instead of a severity label. Skip if you don't want to share — you
   can fill it in later from settings.
5. Zybit drops you into `/app/flow` — your flow graph view.

---

## What to expect on day 1 vs. week 2

Zybit's flow graph fills in as your traffic accumulates. PostHog will
keep streaming events to us continuously after the connection is made;
Zybit syncs them on a 30-minute cron.

| Weekly sessions on your site | Pre-flight verdict | When findings appear |
|---|---|---|
| Under 100 | empty / thin | 2–3 weeks |
| 100–500 | thin | about a week |
| 500–2,000 | thin then ready within 2–3 days | within ~5 days |
| 2,000+ | ready immediately | the same day |

The pre-flight check exists so you know up front which row you are in
and are not waiting in the dark.

---

## What if I already use Segment instead?

PostHog is the smoothest path because it gives us both pageviews and
session reconstruction by default. Segment also works — pick the
*Segment* tab in step 2 and Zybit gives you a webhook URL to add as a
destination in your Segment workspace. The pre-flight check runs the
same way.

We do not currently support GA4-only setups for the flow graph (GA4
returns aggregate counts only — there is no session-level data to
reconstruct journeys from). If GA4 is all you have today, PostHog free
tier is a 30-minute fix.

---

## FAQ

**Do I have to keep paying for PostHog?**
No. PostHog's free tier is real (1M events/month). Most pilots fit
comfortably in it. If you outgrow it, Zybit can keep reading at the
paid tier or you can route events through Segment instead.

**Will this collect personal data on my users?**
Only what PostHog collects by default — IP, user agent, pageview URLs.
Zybit reads page paths and session ids; we explicitly do not pull
identify properties, emails, or form contents into our findings
pipeline. If your privacy stance requires it, configure PostHog with
[opt-in tracking](https://posthog.com/docs/privacy/gdpr-compliance) or
[IP anonymisation](https://posthog.com/docs/integrate/client/js#ip-anonymization)
before installing the snippet; Zybit works with both.

**What happens if I rotate the API key?**
Sync will start failing. Zybit's connector circuit breaker will mark
the integration *degraded* after three consecutive failures and
*disconnected* after five, and email the operator. Re-paste the new
key in **Zybit → Settings → Integrations** to resume.

**Can I disconnect Zybit at any time?**
Yes. *Settings → Integrations → Remove*. We stop reading immediately;
your PostHog account is unaffected.

**Do I need to install Zybit's proxy or any code change for the pilot?**
No. The pilot is read-only — we are showing you your product's flow
graph and ranked findings. There is no script, no SDK, no DNS change.
The proxy is only relevant if and when you later decide to deploy a
fix through Zybit; until then, settings → proxy stays untouched.

---

## Troubleshooting cheatsheet

| Symptom | Likely cause | Fix |
|---|---|---|
| Pre-flight 🛑 *"No events"* | Snippet not actually firing on the live site | View-source on a deployed page; check for `posthog.init` in the bundle |
| Pre-flight 🛑 *"Session id missing"* | SPA SDK initialised without default config | Confirm `capture_pageview: true` and no custom `bootstrap` overrides |
| Pre-flight 🛑 *"Path missing"* | Custom event mapping in PostHog stripped `$current_url` | Send a default event and confirm it carries `$current_url` |
| Pre-flight ⚠️ *"Low sessions"* | Low traffic in the window | Wait; the graph populates as visits arrive |
| Pre-flight ⚠️ *"Single route"* | Only your landing page is seeing pageviews | Confirm the snippet is in `<head>` on **every** page, not just `/` |
| "Failed to fetch" on Connect step | Wrong host URL or wrong region | EU users must use `https://eu.posthog.com`, US users `https://us.posthog.com` |

---

## Done. What does the founder do next?

Once your verdict is ✅ or ⚠️ and you are in `/app/flow`, the founder
will check the **operator dashboard** to confirm the sync ran. From
there, the first findings email lands automatically once enough data
accumulates — usually within the time-to-graph estimate above.
