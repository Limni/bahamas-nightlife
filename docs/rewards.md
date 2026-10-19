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

## Phase 2: rewards at opted-in bars (proposed)

### Data
- `rewards`: `venue_id`, `title` ("Free rum punch"), `description`, `cost` (points), `is_active`, optional `starts_at` / `ends_at`, `per_member_limit` (e.g. 1 a night), `daily_limit`, `sort`.
  - Admins manage all rewards; venue managers manage their own venues' rewards. Opting in is having at least one active reward; an admin approves a venue's first reward.
- `redemptions`: `reward_id`, `venue_id`, `user_id`, `code` (6 characters, unambiguous alphabet), `status` (`pending` / `used` / `expired` / `cancelled`), `created_at`, `expires_at` (+15 min), `used_at`, `confirmed_by`.
- A `redeem` ledger row, negative, linked to the redemption (`redemption_id unique`).

### Flow
1. **Request.** A member opens a participating spot's page, sees **Rewards here**, and taps **Redeem** at the bar. `redeem_reward(p_reward)` (security definer) then:
   - checks the balance, the limits and that points are on;
   - creates a `pending` redemption with a code;
   - inserts the negative ledger row straight away, so the points are held and the same balance can't be spent twice.
2. **Confirm.** The member shows a full-screen code (with a QR and a live countdown, so a screenshot is easy to spot). Staff confirm it in one of two ways:
   - **Recommended for most bars:** a venue PIN. Staff type the bar's 4–6 digit PIN on the member's phone. Only a hash is stored, in a column on `venues` set from `/manage`. No staff accounts needed.
   - **Bars with a manager account:** `/manage` → **Redeem a code** → enter the code → `confirm_redemption(p_code)`, which only works for that manager's venues.
3. **Expiry.** A pending redemption that isn't confirmed by `expires_at` becomes `expired`, and its ledger row is deleted (a refund). Housekeeping on read or the existing pg_cron job handles it. The member can also cancel while it's pending.

### Venue side
- Managers see counts per reward and per week in `/manage`, not who redeemed. Admins see everything.
- A monthly summary per venue (redemptions, by reward) supports the partnership conversation. The same data could later drive sponsored or featured placement.

### Abuse and fairness
- The 4-minute stay already stops drive-by check-ins. Before rewards have real value, consider:
  - a weekly cap on check-in points;
  - a minimum account age (or a first confirmed check-in) before redeeming;
  - flagging accounts with many check-ins at distant spots in a short time.
- GPS can be spoofed. Redemptions are protected because staff confirm them in person, so rewards should stay modest (a drink or a discount, not cash).
- **Terms page:** points have no cash value, can't be transferred, may expire (decide on a policy, e.g. 12 months without activity), and the programme can change. Link it from **My points** and the reward screen.

### Open questions for the owner
- Should points expire?
- Should the public see a monthly "top members" board, by first name and opt-in only (like Community wins)?
- Who funds rewards (the bar alone, or co-funded as part of a sponsorship package)?
- Do check-ins at a spot that's running an event earn a bonus? This is simple to add: `check_in()` can look up `isEventLive` on the SQL side.
