# Handled

A personal agent for the obligations nobody explains. You capture a photo, a forwarded email or a voice note. Handled routes it to a playbook, extracts the facts, plans deadlines from cited rules, acts once you approve (email, SMS, phone call, prepared form, calendar), and follows up on its own.

## Run

```
npm install
cp .env.example .env        # add keys
cp profile.example.json profile.json   # optional: your demo user
npm start                   # http://localhost:3000
npm test                    # engine tests, no keys needed
npm run check-datasf -- "1000 Guerrero St"
```

Requires Node 24 (built-in SQLite, runs TypeScript directly, no build step).

## Keys

| Feature | Env | Without it |
|---|---|---|
| Agent, extraction | `ANTHROPIC_API_KEY` | Captures fail with a logged error |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Approved emails fail visibly |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | No texts; in-app notices still work |
| Calls | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` | Approved calls fail visibly |

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
- DataSF moved to `data.sf.gov`. Datasets: addresses `3mea-di5p` (gives `cnn` and parcel), Assessor `wv5m-vpq2`, street sweeping `yhqp-riqs`, parking signs and street space permits `sftu-nd43`.

All other rules are marked `unverified`, and the agent says so. Check each `source_url` before the demo and update `status` and `last_verified`.

## Adding a playbook

Copy a standard playbook such as `playbooks/repair_request.yaml`, change the triggers, fields and actions, and run `npm test`. The last test plans every playbook end to end.
