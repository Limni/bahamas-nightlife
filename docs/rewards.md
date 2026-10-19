# Points and rewards

Members earn points on Nassau Nights and, later, spend them on rewards at bars that opt in.

## Phase 1: earning (built)

- **Check-ins.** Earned on a spot's page with **Check in** (`components/CheckIn.tsx`, `check_in()` in `schema.sql`).
  - One point per spot per night by default; the night runs 6 AM to 6 AM Nassau time (`points_night()`). Up to 5 spots a night.
  - The first tap starts the check-in. A second fix, at least 4 minutes later and still inside the spot's geofence, confirms it and awards the point. The confirmation is automatic while the page stays open; otherwise the member taps **Finish** when they come back.
  - The geofence is the spot's activity radius plus up to 30 m of GPS slack, and the fix must be accurate to 100 m or better (the same rules as `report_presence()`).
  - Coordinates are never stored. Check-ins are linked to the account, but only the member and admins can read them. Anonymous live activity (`presence`) is untouched.
- **Applied suggestions.** When an admin marks a signed-in member's suggestion **Done** in the Inbox, the member earns points.
  - Defaults: 5 for an update, closure or event tip, and 10 for a new spot. The admin can pick 0, 3, 5, 10 or 15 per suggestion.
  - Moving the suggestion out of Done takes the points back. Anonymous suggestions earn nothing.
- **Ledger.** `points_ledger` has one row per change (`check_in`, `update`, `adjust`, `redeem`), so a balance is a sum.
  - Admins correct balances with signed adjustments plus a note the member sees (`admin_adjust_points()`).
  - Rows survive a deleted spot or suggestion.
- **Settings and screens:** `/admin/points` sets the amounts, shows the top members and the latest awards, and has the on/off switch. Members see their balance and history on `/account` (**My points**).

## Phase 2: rewards at partner bars (built)

Each partner venue has a **sponsorship deal**. An admin turns it on; from then on the venue sets its own rewards and point costs.

- **Partner.** Spot editor → **Rewards** (admins) → **Reward partner** (`reward_partners`). The deal has optional start and end dates, an **Active** switch to pause it, and private deal notes. `is_reward_partner(venue)` is true while the deal is active, today is inside its dates and the spot is published.
- **Rewards.** The same panel, for admins and the venue's **managers** (only while it's a partner): a title, optional details, a cost in points, an optional limit per member per night, on/off, an order, and how many were redeemed in the last 30 days. Members see them under **Rewards here** on the spot's page and **Where to use your points** in My points.
- **Staff.** A role on `venue_managers` (`manager` / `staff`), set under **Managers & staff** on the spot or under the member's **Venues they manage or staff**. Staff only get `/manage/redeem` (bartenders don't edit the listing). Managers get it next to their editors, and admins can open it for any partner.
- **Redeeming.**
  1. **The member's code.** The member taps **Show my code** (My points, or Rewards here). `create_redeem_code()` makes an 8-character code from A–Z and 2–9, valid for 5 minutes and usable once; a new one replaces any unused code.
     - It appears as a QR of `https://<site>/manage/redeem?code=…`, so a phone's own camera app also works, plus the code typed out. The screen stays awake while it's open.
  2. **Scanning.** Staff scan it in **Redeem** (`qr-scanner`, lazy-loaded, using 90% of the frame) or type the code. `redeem_lookup()` returns the member's display name, their balance, and the rewards with how many were used tonight; their id never leaves the database.
  3. **Redeeming.** Staff tap **Redeem** and confirm, and `redeem_confirm()` does the rest:
     - it re-checks everything under a lock per member, so two bars can't spend the same balance;
     - it writes the redemption and a negative `redeem` ledger row, and marks the code used.
  4. **The member's screen.** It polls `redeem_code_status()` and switches to **Redeemed!**
- **Undo.** `void_redemption()` refunds by deleting the ledger row and marking the redemption undone. The venue's staff can undo for 12 hours (the **Last 12 hours** list); admins can undo any time (Admin → Points → Recent redemptions).
- **Admin → Points** lists the partners (with their reward counts and whether they're taking points today) and the recent redemptions, and links to the scanner.

## Still open

- **Abuse.** The 4-minute stay stops drive-by check-ins, and staff confirmation in person protects redemptions. If rewards grow valuable, consider:
  - a weekly cap on check-in points;
  - a minimum account age before redeeming;
  - flagging accounts with many far-apart check-ins.
- **Terms page:** points have no cash value, can't be transferred, may expire, and the programme can change. Link it from My points and the code screen.
- **Partner reporting:** a monthly summary per venue (redemptions per reward) for the sponsorship conversation. The data is already in `redemptions`; it needs a page or a CSV export.
- **Questions for the owner:**
  - Should points expire?
  - Should there be a public top-members board (first names, opt-in)?
  - Should check-ins during an event earn a bonus?
