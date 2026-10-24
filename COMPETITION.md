# Who already does this, and our counter

Checked 2026-10-24. Each row: what exists, how Handled is different, and what to say if a judge raises it.

| Feature | Already in market | Our counter |
|---|---|---|
| AI that phones businesses for you | **Pine AI** calls companies to negotiate bills, cancel subscriptions and fight medical bills ($25M Series A, Dec 2025). **Google "Ask for Me"** calls local shops for prices (Search Labs experiment since Jan 2025). | Their calls are one-off chores. Handled's call is one step inside a case: the glass quote lands in the insurance packet, the booking lands on the calendar, and the follow-up fires on day 3. We don't compete on bills; Pine owns that. |
| Street cleaning alerts | **SpotAngels** detects where you parked and alerts you before sweeping in SF. | We don't sell alerts. "Don't get swept" is one playbook. The new part is what happens after a ticket: Handled pulls the citation from City data, checks it against the block's schedule for the minute it was written, and only drafts a protest when City data supports it. |
| Parking ticket protests, cancellations, "robot lawyer" | **DoNotPay** built its name on parking tickets, then took an FTC order (finalized Jan 2025, $193,000) for claiming more than its AI could deliver. | That is the failure mode we designed against. Every rule cites its source and says verified or unverified. Legal points are information with who to confirm with. The person presses the final submit. Our sweeping check agreed with 25 of 25 real City tickets from this week, so it won't push protests the City would reject (`npm run eval`). |
| Subscriptions and bill negotiation | **Rocket Money**, **Pine AI**. | Not featured. It stays in the gallery as a simple flow; we don't pitch it. |
| Immigrant checklists | **MyChek** (a Gemini-built checklist app with USCIS case tracking). USCIS's own address-change tools. | A checklist tells you what to do. Handled computes your dates from your arrival and move-in, prepares each form, remembers your visa and employer for every later case, and keeps going after week one (layoff, lease, car). |
| Tenant letters | **JustFix** (NYC tenant letters and complaints). Static SF deposit-interest calculator pages. | SF-specific and end to end. It takes the building's year from Assessor data, applies the Rent Board rate in effect on each due date, subtracts the Rent Board fee share the landlord may keep, sends the demand, and escalates on day 14. Calculators stop at a number. |
| City reporting | **SF311** app and site (official). | We don't replace 311. Before you report, Handled shows how many neighbors already reported and the City's median time to close. Then it watches the 311 data until your case closes. |
| General agents | ChatGPT agent, Operator, Gemini, Apple Intelligence. | General agents don't know SF's rules, don't keep a case open for 60 days, and don't fire an escalation on their own. Handled's playbooks are declarative and testable, so a deadline is computed by the engine, not guessed by a model. |

## What no one we found does

- Turns one voice note into every deadline a layoff starts: final pay, COBRA, Covered California, EDD, option window, visa grace period.
- Computes SF deposit interest year by year from verified Rent Board rates, with the fee deduction, and pursues it.
- Checks a parking ticket against the City's own sweeping schedule for that block.
- Works in Spanish and Portuguese on the user's side while writing to landlords, HR and the City in English.
- Gives back an anonymous report of which City steps still have no online path.

## Objections a judge may raise

- **"Isn't this just Pine?"** Pine fights companies. Handled handles the City: rules, deadlines, forms and public data. A call is one tool among seven.
- **"How do you know the numbers are right?"** Each rule file has a source URL and a verified date. The deposit math uses the Rent Board's published rule ("rate in effect when the payment is due"). The eval runs routing in three languages and checks the sweeping rule against real tickets.
- **"Is this legal advice?"** No. Information with sources, who to confirm with, and the person submits.
- **"Why would people keep using it?"** Obligations recur: deposit interest every year, sweeping every week, tickets, leases, jobs. Memory means it gets faster each time.
- **"Who pays?"** Free mode costs $0. The paid layer is the things that save money: protests, demands, and calls.
