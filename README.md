# Handled

A personal agent for the obligations nobody explains. You capture a photo, a forwarded email or a voice note, in your own language. Handled routes it to a playbook, extracts the facts, plans deadlines from cited rules, acts once you approve (email, SMS, phone call, prepared form, calendar), and follows up on its own.

Built for the Puentes hackathon ("Personal Agents for San Francisco"): people who just moved here, and everyone else the city hands paperwork to.

- **Yours:** every fact you give is remembered (Settings, "What Handled knows about you"), so no playbook asks twice. One "tell Handled about you" voice note fills your profile and opens the cases that apply to you.
- **Your language:** you talk to it in Spanish, Portuguese, Chinese, Filipino and more; it writes to landlords, HR and the City in English and shows you what each draft says.
- **Free to run:** without paid providers it drafts everything and hands the last tap to your phone (mail app, messages, dialer with the call script). Without an Anthropic key it routes by keywords and asks with a form.
- **Eat well near you:** tell it your age, height, weight, training, goal, allergies and health conditions (smart-scale body fat and muscle mass are optional). It works out your calories, protein and each nutrient from cited NIH and National Academies sources, explains them in five plain lines in your language (including how to take them, like iron with vitamin C and away from coffee), and builds a day of meals from what is on sale this week within your walking distance. Like or swap any food and it remembers. Meal times go on your calendar; the grocery list goes to your phone.
- **Gives back:** "Fix it on my block" checks live 311 data before you report, then watches the City's own records until the case closes. An anonymous civic report shows where people still need a human because there is no online path.

See [DEMO.md](DEMO.md) for the stage script and [COMPETITION.md](COMPETITION.md) for who else does what.

## Evidence

`npm run eval` (results in [eval/latest.json](eval/latest.json), also shown in Settings):
- Routing in keyword mode across English, Spanish and Portuguese captures: 28/28.
- Sweeping check against real street-cleaning tickets the City wrote in the last 10 days: 25/25 agree.

`npm run demo-check` runs every stage flow end to end against live City data.

## Run

```
npm install
cp .env.example .env        # add keys
cp profiles/jordan.json profile.json   # optional: your own profile
npm start                   # http://localhost:3000
npm test                    # engine tests, no keys needed
npm run check-datasf -- "1000 Guerrero St"
npm run demo-check          # stage flows against live City data
npm run eval                # routing and rule accuracy
node scripts/food-check.ts "1000 Guerrero St"   # live stores and grocery deals
```

Requires Node 24 (built-in SQLite, runs TypeScript directly, no build step).

## Keys

Every key is optional. Nothing here costs money unless you add a key.

| Feature | Env | Without it (free) |
|---|---|---|
| Agent, photo reading, drafting | `ANTHROPIC_API_KEY` | Keyword routing (English, Spanish, Portuguese) and a form for missing fields |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Opens your mail app with the email filled in |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Opens your messages app; in-app notices still work |
| Calls | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` | Opens the dialer with the script; your notes become the outcome |

Deploy free on Render with `render.yaml` (SQLite resets when the free instance restarts, which is fine for a demo).

Calls are polled from Vapi (`GET /call/{id}`), so no public tunnel is needed. When a call ends, Claude reads the transcript and writes the outcome (price, booking, reference numbers) back to the case and the calendar.

## How it fits together

- `playbooks/*.yaml`: one file per flow (triggers, required fields, rules, compute steps, actions with `needs_approval` and deadline formulas like `termination_date + 60 days`, follow-ups with escalation).
- `rules/*.json`: one rule per file with the plain-English rule, parameters, source URL, `status` (`verified` or `unverified`), `last_verified` and who to confirm with.
- `server/engine.ts`: turns a playbook and case fields into deadlines, reminders and proposed actions.
- `server/agent.ts`: Claude tool loop (route, set fields, DataSF lookups, compute, ask the user, plan, revise drafts).
- `server/scheduler.ts`: fires reminders and check-ins every minute; Settings has fast-forward for the demo.
- `/calendar.ics`: subscribe a phone calendar to see every deadline.
- `POST /api/inbound`: forwarded email or a notetaker webhook becomes a case.

## Data sources checked on 2026-10-24

- SF Rent Board current rates page: deposit interest 5.2% (2024-25), 5.0% (2025-26), 4.2% (2026-27); allowable increase 1.7%, 1.4%, 1.6%.
- DataSF moved to `data.sf.gov`. Datasets: addresses `3mea-di5p` (gives `cnn`, parcel and coordinates), Assessor `wv5m-vpq2`, street sweeping `yhqp-riqs`, parking signs and street space permits `sftu-nd43`, 311 cases `vw6y-z8j6` (updated the same day).

Food and nutrition:
- Targets: Mifflin-St Jeor or Katch-McArdle (with body fat), activity factors, and Dietary Reference Intakes in `rules/nutrition_energy.json` and `rules/nutrition_dri.json`; condition changes (anemia, diabetes, high blood pressure, cholesterol, celiac, kidney disease, pregnancy, breastfeeding, lactose, osteoporosis, IBS, eating disorder history) in `rules/nutrition_conditions.json`, each with its own source. Kidney disease gets no protein or potassium target, and an eating disorder history gets no calorie numbers.
- Foods: `nutrition/foods.json`, per-serving values rounded from USDA FoodData Central.
- Stores and farmers markets: OpenStreetMap (Overpass), cached for a week. Deals: this week's store flyers for the ZIP code from Flipp's public search. No logins, nothing bought.
- CalFresh, Market Match and the SF-Marin Food Bank: `rules/sf_food_help.json`. Handled links to the application; you submit it.

All other rules are marked `unverified`, and the agent says so. Check each `source_url` before the demo and update `status` and `last_verified`.

## Adding a playbook

Copy a standard playbook such as `playbooks/repair_request.yaml`, change the triggers, fields and actions, and run `npm test`. The last test plans every playbook end to end.
