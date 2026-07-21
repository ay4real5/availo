# Design note — watching multiple test centres (2–3 nearby)

Status: **partially built (2026-07-16).** The safety foundation — the shared refresh
budget (item 3) — is DONE, so multiple watched tabs already stay within one centre's
request budget. Still deferred: per-tab centre matching + a curated "my centres" list
(items 2 & 4), because doing them coherently needs a backend centres list (otherwise a
secondary centre gets on-screen alerts but no phone/email alert, since the backend alert
path gates on the single saved `prefs.centre`). Also untested: DVSA's booking flow is a
single server-side session (`execution=...`), so two live booking tabs may clobber each
other — verify before promising simultaneous multi-tab watching.
Priority: **after** turning on alerts (push/email) — see "Why alerts first" below.

## Built so far
- **Shared refresh budget** (`background.js` `watch-tick`): across ALL watched tabs, only
  one page reloads per interval (round-robin, prefers a visible tab), so N tabs never
  mean N× the requests. Local re-scans still run for every tab each tick.
- **Centre-mismatch warning** (popup): if a watched tab's own centre
  (`AvailoResolve.pageCentre`) differs from the centre being matched, the popup and
  "Check this page" say so loudly — the missing safety that let Ayr get watched silently
  under a Chorley config.

## The constraint that shapes the whole design
Availo must never make DVSA **search/navigate** to a centre on its own — that's
"automated searching", which the boundary and the UK 2024 regulations forbid (see
`CLAUDE.md`). Availo only reads the page the user already has open. And there's a
physics limit underneath: **every watched centre = more page refreshes = more CAPTCHA
risk**, and a CAPTCHA stops watching. So the design goal is *cover more centres without
spending more of the safe request budget* — not "refresh more".

## The approach: per-tab, shared gentle budget, priority-weighted
1. **One tab per centre.** The user opens each nearby centre in its own DVSA tab (they
   navigate — allowed) and watches each. The extension already supports watching several
   tabs at once (per-`tabId` watch state; the alarm loops every watch; alerts are keyed
   per tab). The only code gap today is matching: a watched tab currently only alerts for
   the single saved centre, so a second centre's tab stays silent.
2. **Match on the tab's own centre.** Each watched tab should alert for **whichever centre
   that tab is showing** (read from `#chosen-test-centre h1` via `AvailoResolve.pageCentre`)
   for any date earlier than the user's current test date. The user curates centres simply
   by which tabs they watch. (Implementation seed: in `watch-content.js startWatching`,
   use `pageCentre(document)` as the watched centre instead of the single saved one.)
3. **Shared gentle budget (the key to not getting blocked).** Do NOT let each tab refresh
   on its own cadence — N tabs would be N× the load = N× the block risk. Instead **stagger
   refreshes so the total rate stays ≈ one centre's worth** (e.g. with 3 tabs, each centre
   is refreshed ~3× less often). Implement in `background.js`: the `watch-tick` handler
   already loops `allWatches()`; give them a combined budget (only one tab due to refresh
   per shared interval, round-robin) rather than each hitting its own `nextRefreshAt`.
4. **Priority weighting (optional, high value).** Let the user rank the centres; spend more
   of the budget on the #1 choice (refreshed more often) and less on the backups. Maximises
   catch-chance per safe request.

## The honest trade-off (state it in the UI)
With a fixed *safe* refresh rate you either check **one centre often** or **several less
often**. Spreading across centres raises the odds of *some* earlier slot but lowers how
fast you catch *a specific* one. Watching many centres fast is exactly the bot pattern
that gets accounts cancelled — staying gentle is the feature.

## Platform note
Multi-centre is realistically a **desktop** feature: phones suspend background tabs, so on
a phone it's single-centre + alerts. Don't promise reliable multi-tab watching on mobile.

## Nice UX (when built)
Settings → "My centres": pick 2–3, drag to rank. The popup shows a checklist —
*"Watching: Ayr ✓ · Chorley ✓ · Kilmarnock — open this centre in a tab to watch it too"* —
guiding the user to open the right tabs, then watches them on the shared budget and, on a
hit, says **which** centre.

## Why alerts first (my recommendation)
Reliable **phone push + email** alerts help *every* user (single- or multi-centre) — they
stop having to babysit a screen. Multi-centre adds friction (several tabs, a laptop that
stays awake) and only helps desktop users flexible on location. So: do alerts (the parked
Render `VAPID_*` / `RESEND_*` keys) first; multi-centre is a strong second.
