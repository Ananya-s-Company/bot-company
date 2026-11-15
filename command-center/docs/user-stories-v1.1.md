# Command Center v1: User Stories (draft for PMBot review)
Author: BABot · Source: PMBot PRD (Nov 15, 2026) · Version: v1.1 BASELINE (approved by PMBot Nov 15, 2026; open questions resolved, see §10)

## 0. Scope recap
- Single user: Ananya (owner), behind a login. Bots post content through a channel ArchitectBot will choose (API, webhook, or similar). In this doc that channel is called the "bot posting interface".
- Goal (north-star acceptance): within 30 seconds of logging in, Ananya can see every idea, its stage, and every item waiting on him.
- Out of scope: public access, payments, multiple human users, self-serve sign-up.
- Personas: **Owner** (Ananya, human, the only reader/approver). **Bot poster** (any team bot posting updates, decisions, proposals, and idea data).

## 1. Priority order
| Pri | Epic | Stories |
|---|---|---|
| P0 | E0 Access and foundation | CC-01, CC-02 |
| P1 | E1 Ideas board | CC-10 to CC-16 |
| P2 | E2 Daily updates feed | CC-20 to CC-22 |
| P3 | E3 Decisions inbox | CC-30 to CC-34 |
| P4 | E4 Proposal pages | CC-40 to CC-41 |
| P5 | E5 Demo views | CC-50 to CC-51 |
| P6 | E6 Real-time and mobile | CC-60 to CC-62 |
| P1 (cross-cutting) | E7 Bot posting interface | CC-70 to CC-72 |

E0 comes first because nothing else is usable without it. E7 is listed as P1 because the board, feed and inbox are empty without it. ScrumMasterBot may want to slice it alongside each epic.

---

## E0 Access and foundation

### CC-01 Owner login (P0)
As the Owner, I want to sign in to a private site so that only I can see the company's ideas and decisions.
- **AC1** Given I'm not signed in, when I open any Command Center URL, then I'm redirected to the login page and no idea, update, or decision data is returned.
- **AC2** Given valid credentials, when I sign in, then I land on the Home/Ideas board within 3 seconds on broadband.
- **AC3** Given invalid credentials, when I submit, then I see a generic "Sign-in failed" message that doesn't reveal whether the username or the password was wrong.
- **AC3a** Given a hosted deployment, when the correct password is entered, then I must also enter a valid authenticator-app (TOTP) code before access is granted. A local-only run may allow password-only login (config flag, off by default for hosted).
- **AC3b** Given 2FA setup, then I receive one-time recovery codes. Each code works once and is invalidated after use.
- **AC4** Given 5 failed attempts within 15 minutes, when I try again, then further attempts are blocked for 15 minutes.
- **AC5** Given I'm signed in, when I'm idle for 12 hours, then I must sign in again.
- **AC5a** Given any session, when 7 days have passed since sign-in, then re-login (including 2FA) is forced regardless of activity.
- **AC6** Given I'm signed in, when I click Sign out, then my session ends and Back doesn't show cached data.
- **AC7** Given I've forgotten my password, then there's no email reset flow. The password is reset only via an admin command run on the host machine, and 2FA recovery codes restore 2FA access.
- Business rules: BR-01 there's exactly one human account and no sign-up page. BR-02 bot credentials can't be used to log into the UI. BR-19 2FA is mandatory before any hosted (non-local) deployment.
- Edge cases: an expired session mid-action (approving a decision) keeps the unsaved note and asks me to re-authenticate. Lost authenticator plus all recovery codes used: only the host admin command can reset it.

### CC-02 Home "what needs me" summary (P0)
As the Owner, I want a summary strip at the top of Home so that I meet the 30-second goal.
- **AC1** Given I'm on Home, then I see counts for: total ideas by stage, pending decisions, ideas rated Red, and updates since my last visit.
- **AC2** Given pending decisions > 0, when I click the count, then I go to the Decisions inbox filtered to Pending.
- **AC3** Given there are no pending decisions, then the strip says "Nothing needs you right now".
- Business rule: BR-03 "since my last visit" = since my previous session's last activity.

---

## E1 Ideas board

### CC-10 View ideas board (P1)
As the Owner, I want to see every idea as a card so that I know the state of the portfolio at a glance.
- **AC1** Given ideas exist, when I open the board, then each card shows: name, stage, owning lead bot, risk rating (Green/Amber/Red), startup cost (CAD), payback (weeks), sales per week needed, next step, and last-updated time.
- **AC2** Given a field has no value yet, then the card shows "Pending" for it (never blank or 0). Example: FinancialsBot hasn't posted numbers yet.
- **AC3** Given the board loads, then the cards are grouped or columned by stage in this order: Idea, Researching, Proposal, Approved, Building, Live, Killed.
- **AC4** Killed ideas are collapsed or hidden by default, with a toggle to show them.
- Data: see §9 Idea entity.

### CC-11 Seed the 7 initial ideas (P1)
As the Owner, I want the board pre-loaded with the current 7 ideas so that it's useful on day one.
- **AC1** Given a fresh deployment, then exactly these 7 ideas exist, at stage "Idea" unless the owning lead has said otherwise: PM/engineer templates · Newcomer-to-Canada toolkits · MBA case prep kits · Engineering/PM interview guides · PM micro-tool or browser extension · AI prompt packs · Newcomer content and affiliate hub.
- **AC2** Their risk and financial fields show "Pending" until RiskBot and FinancialsBot post values.
- **AC3** Seeding is idempotent: re-running it doesn't create duplicates.
- **AC4** Seed owners: PMBot owns PM/engineer templates, MBA case prep kits, Engineering/PM interview guides, and the PM micro-tool or extension. MarketingStrategyBot owns Newcomer-to-Canada toolkits, AI prompt packs, and the Newcomer content and affiliate hub.

### CC-12 Risk rating display (P1)
- **AC1** Given RiskBot has posted a rating, then the card shows a Green, Amber, or Red badge. Colour isn't the only signal: the badge also carries a text label.
- **AC2** Given the rating changed, then the card shows the previous rating and when it changed, on hover or in details.
- BR-04 Among bots, only RiskBot can set or change the risk rating. (The Owner can also edit it, per CC-16.)

### CC-13 Financial metrics display (P1)
- **AC1** Startup cost is shown as CAD with 2 decimals (for example "CA$45.00"), payback as whole weeks, and sales per week needed as an integer.
- **AC2** Given payback can't be computed (for example, no revenue model yet), then it shows "n/a" with FinancialsBot's reason in a tooltip.
- BR-05 Among bots, only FinancialsBot can set the financial fields. (The Owner can also edit them, per CC-16.)
- BR-06 Startup cost must be ≥ 0. Payback and sales per week must be ≥ 0 or null.

### CC-14 Stage changes (P1)
As the Owner, I want stage changes to be controlled and recorded so that the board reflects real decisions.
- **AC1** Given a bot posts a stage change, then it's saved with who, when, and the from and to stages, and appears in the idea's history and the updates feed.
- **AC2** Given a move into **Approved** or **Building**, then the change is accepted only if there's an Approved decision linked to that idea (see E3). Otherwise it's rejected with an error. (Confirmed by PMBot.) An Owner edit into these stages also requires a linked approved decision, or the Owner creates and approves one in the same action.
- **AC3** Given an idea moves to Killed, then a kill reason is required.
- **AC4** Given an idea is Killed, then it can be revived to any earlier stage only through an Owner action or an approved decision.
- BR-07 Stages are a fixed list. Forward moves can skip stages (Idea to Proposal), except into Approved and Building (AC2).

### CC-16 Owner edits any field, audited (P1)
As the Owner, I want to edit any idea field directly so that I can correct or override bot data.
- **AC1** Given I'm on an idea, when I edit any field (name, stage, owner, risk, financials, next step), then the change is saved immediately.
- **AC2** Then the audit history records the old value, the new value, the time, and the label "edited by Ananya", and the card shows that label next to the field until the next change.
- **AC3** Given I edit a field a bot owns, then that bot can read the change through the bot posting interface.
- BR-20 Owner edits are always allowed (subject to CC-14 AC2 for Approved and Building) and always audited.

### CC-15 Filter and sort the board (P1, could slip to P2)
- **AC1** I can filter by stage, risk rating, and owning lead, and sort by last updated, startup cost, or payback.
- **AC2** My filter choice persists for my session.

---

## E2 Daily updates feed

### CC-20 View updates feed (P2)
As the Owner, I want a reverse-chronological feed of team updates so that I can see daily progress.
- **AC1** Each entry shows the team or bot name, a timestamp in America/Toronto with the zone label, the update text, and the linked idea(s) if any.
- **AC2** New entries since my last visit are visually marked.
- **AC3** I can filter by team, by idea, and by date range.
- **AC4** The feed paginates or lazy-loads after 50 entries.

### CC-21 Missing daily update indicator (P2)
- **AC1** Given a team with active work hasn't posted by the 6:00 PM America/Toronto daily cutoff (ahead of MasterBot's 7 PM summary to Ananya), then the feed and Home show "No update from <team> today".
- BR-08 "Active" teams are configured by an admin setting, not inferred.

### CC-22 Update content rules (P2)
- BR-09 Text up to 2,000 characters, with plain text or basic markdown (no raw HTML; it must be sanitized).
- BR-10 Updates are append-only. A correction is a new update that references the original. Nothing is edited in place.
- Edge cases: duplicate posts within 60 seconds with identical text are de-duplicated. Updates referencing a non-existent idea are accepted but unlinked, with a warning returned to the bot.

---

## E3 Decisions inbox

### CC-30 Decision request creation (P3)
As a Bot poster, I want to submit an item for Ananya's approval so that nothing gated happens without him.
- **AC1** A decision request has: type (Spend / Publish / Sign-up / Release / Other), title, requesting bot, linked idea (optional), summary, amount in CAD (required when type = Spend), deadline (optional), and attachments or links (optional).
- **AC2** Given type = Spend and the amount is missing or ≤ 0, then the request is rejected.
- **AC3** New requests start in **Pending**.

### CC-31 View decisions inbox (P3)
- **AC1** I see Pending items first, sorted by deadline (soonest first), then by created date.
- **AC2** Items past their deadline are flagged "Overdue".
- **AC3** I can switch to Approved, Rejected, or All.

### CC-32 Approve or reject with note (P3)
As the Owner, I want to approve or reject each item with a note so that the team knows what to do.
- **AC1** Given a Pending item, when I click Approve or Reject, then I must confirm. A note is mandatory on Reject (Reject is disabled until a note is entered) and optional on Approve.
- **AC2** Then the item's status, my note, and the timestamp are saved, and the requesting bot can read the outcome through the bot posting interface.
- **AC3** Given an item is already decided, then Approve and Reject are disabled. A change of mind requires a new request. (Decisions are immutable for audit.)
- **AC4** Given two browser tabs, when I decide in one, then the other updates to show the item as decided and doesn't allow a second decision.

### CC-33 Decision audit trail (P3)
- **AC1** Every decision keeps an immutable record: who requested it, who decided, the outcome, the note, and the timestamps.
- BR-11 Only the Owner can decide. Bots can only create and read.

### CC-34 Withdraw request (P3, could)
- **AC1** The requesting bot can withdraw a Pending request, and it shows as Withdrawn.

---

## E4 Proposal pages

### CC-40 Proposal page per idea (P4)
- **AC1** Given an idea has a proposal, then its card has a "View proposal" link that opens a dedicated page.
- **AC2** The page shows the idea header (name, stage, risk, financials), the proposal body (markdown), the author bot, the last-updated time, and linked decisions.
- **AC3** Given no proposal yet, then the link shows "No proposal yet" and is disabled.

### CC-41 Proposal versions (P4)
- **AC1** Each bot update to a proposal creates a new version. I can see the version list and view older versions.
- BR-12 Among bots, only the owning lead bot (or PMBot) can post or edit an idea's proposal. (The Owner can also edit it, per CC-16.)

---

## E5 Demo views

### CC-50 Click-through demo per idea (P5)
As the Owner, I want to click through a demo of what's being built so that I can judge progress without technical setup.
- **AC1** Given an idea in Building or Live has one or more demos, then its card and proposal page show "View demo".
- **AC2** A demo is a sequence of screens (images or an embedded prototype) with next and previous navigation and a caption per screen.
- **AC3** Demos open inside the Command Center and need no separate login.

### CC-51 Demo content safety (P5)
- BR-13 Embedded prototypes load only from an allow-list of hosts that ArchitectBot approves. No arbitrary third-party scripts.
- Edge case: a broken or missing demo asset shows a placeholder, not a crashed page.

---

## E6 Real-time and mobile

### CC-60 Live updates without refresh (P6)
- **AC1** Given the board, feed, or inbox is open, when a bot posts a change, then it appears within 5 seconds without a page reload.
- **AC2** New items are briefly highlighted.
- **AC3** Given the connection drops, then a "Reconnecting…" indicator shows, and on reconnect the view catches up with no missing or duplicated items.

### CC-61 Mobile-friendly layout (P6)
- **AC1** At 375 px width, the board, feed, inbox, proposal, and demo pages are fully usable with no horizontal scrolling. Approve and Reject buttons are at least 44×44 px.
- **AC2** The 30-second goal holds on a phone. (QABot to time it on a mid-range device.)

### CC-62 Performance baseline (P6)
- **AC1** With 50 ideas and 1,000 updates, Home renders in under 2 seconds on 4G.

---

## E7 Bot posting interface (mechanism decided by ArchitectBot)

### CC-70 Authenticated bot posting (P1)
As a Bot poster, I want a simple authenticated way to post so that the site stays current without Ananya.
- **AC1** Each bot has its own credential. Posts are attributed to that bot and can't be spoofed as another bot.
- **AC2** Bots can create updates, create decision requests, and set fields they own (BR-04, BR-05, BR-12). Ownership is enforced server-side.
- **AC3** A post without valid credentials is rejected and logged.
- **AC4** Invalid payloads return a clear error that names the failing field.

### CC-71 Credential revocation (P1)
- **AC1** The Owner can revoke one bot's credential without affecting the others.

### CC-72 Read decisions back (P1)
- **AC1** A bot can read the status and note of the decisions it requested.

---

## 8. Cross-cutting business rules
- BR-14 All times are stored in UTC and displayed in America/Toronto with a zone label.
- BR-15 Currency is CAD only in v1.
- BR-16 Nothing is deleted from the UI in v1. Ideas are Killed, not removed, which preserves history.
- BR-17 The site must not trigger any external action (spend, publish, sign-up). Approvals are records that bots then act on.
- BR-18 All user-supplied content (bot posts) is sanitized before rendering.

## 9. Data requirements (logical)
- **Idea**: id, name, stage, owning_lead_bot, risk_rating {G/A/R/null}, risk_note, startup_cost_cad, payback_weeks, sales_per_week_needed, next_step, kill_reason, created_at, updated_at.
- **StageChange**: idea_id, from, to, by_bot, decision_id?, at.
- **Update**: id, bot, team, text, idea_ids[], references_update_id?, at.
- **Decision**: id, type, title, summary, amount_cad?, idea_id?, requested_by, deadline?, status {Pending/Approved/Rejected/Withdrawn}, owner_note, decided_at, links[].
- **Proposal / ProposalVersion**: idea_id, version, body_md, author_bot, at.
- **Demo / DemoScreen**: idea_id, title, order, asset_url_or_embed, caption.
- **BotCredential**: bot_name, status, created_at, revoked_at.

## 10. Resolved questions (PMBot, Nov 15, 2026)
- OQ-1 Login: password plus TOTP 2FA with recovery codes. 2FA is required before hosting, and password-only is OK for local runs. See CC-01 AC3a/AC3b and BR-19.
- OQ-2 Session: 12 hours idle timeout, with a forced re-login every 7 days. See CC-01 AC5/AC5a.
- OQ-3 Password reset: host admin command plus recovery codes, with no email flow. See CC-01 AC7.
- OQ-4 Seed owners: see CC-11 AC4.
- OQ-5 Moves into Approved or Building require a linked approved decision. See CC-14 AC2.
- OQ-6 Daily cutoff: 6:00 PM Toronto. See CC-21.
- OQ-7 Note mandatory on Reject, optional on Approve. See CC-32 AC1.
- OQ-8 The Owner can edit any field, audited as "edited by Ananya". BR-04, BR-05 and BR-12 restrict bots only. See CC-16.
- OQ-9 Notifications outside the site are out of v1. See §12.

## 11. Requirements traceability matrix (PRD to stories; test cases to be filled by QABot)
| PRD item | Stories | Test cases |
|---|---|---|
| Login, Ananya only | CC-01, CC-70, CC-71 | TBD (QABot) |
| <30 s to see ideas, status, needs | CC-02, CC-10, CC-61 AC2 | TBD |
| 1 Ideas board + fields + 7 seeds | CC-10 to CC-16 | TBD |
| 2 Daily updates feed | CC-20 to CC-22 | TBD |
| 3 Decisions inbox | CC-30 to CC-34, CC-72 | TBD |
| 4 Proposal page per idea | CC-40, CC-41 | TBD |
| 5 Click-through demos | CC-50, CC-51 | TBD |
| 6 Real-time + mobile | CC-60 to CC-62 | TBD |
| Bots post updates simply | CC-70 to CC-72 | TBD |
| Out of scope: public, payments, multi-user | BR-01, BR-15, BR-17 | Negative tests TBD |

## 12. v2 candidates (out of v1 scope)
- V2-01 Notifications outside the site (email or push) when a decision is pending or overdue.

## Change log
- v1.0 (Nov 15, 2026): initial draft, 33 stories, 9 open questions.
- v1.1 (Nov 15, 2026): PMBot answers folded in. Added CC-16 (Owner edits, audited), CC-01 2FA/session/reset criteria, seed owners, 6 PM cutoff, Reject note rule, BR-19 and BR-20, and the v2 backlog. Baseline.
