# Demo script (about 2.5 minutes)

The kickoff asked for agents that offload the work this city puts on people, that real people would use, and that give something back to how the city works. Live, working, with a GitHub link and a 2-minute backup video.

One persona the whole time: **Valentina**, who came through Puentes two years ago from Montevideo. She's an engineer on an O-1, rents in the Mission, drives, and speaks Spanish. Settings, Valentina, "Start with no cases" checked.

## 0:00 Open (10 s)

"San Francisco hands everyone paperwork with deadlines nobody explains: tickets, deposits, layoffs, break-ins. Pine fights companies. SpotAngels watches your car. Handled handles the City."

## 0:10 The call (50 s)

Valentina taps Voice and says in Spanish:

> "Anoche me rompieron el vidrio del auto en Valencia y 20. No se llevaron nada."

- The case appears in Spanish: SFPD report prepared, insurance packet, and a call to the glass shop, each waiting for her tap.
- Approve the call. A phone on stage rings; ask a Flai judge to answer if the organizers agree, otherwise a teammate. The agent says it's an AI calling for Valentina, asks price and earliest slot, and won't go over $400 or take card details.
- When it hangs up, the price and slot land on the case and the calendar, and she gets the summary in Spanish.

## 1:00 The money (30 s)

Gallery, Deposit interest, Try with a sample.
- "Your landlord owes you **$408**": $4,000 x 5.2% due Nov 1 2024 plus $4,000 x 5.0% due Nov 1 2025, at the Rent Board rate in effect on each due date.
- City Assessor data, live: built 1907, 21 units, so the landlord may keep up to $29.50 a year of Rent Board fees. **At least $349.**
- Approve the demand email.

## 1:30 The ticket (25 s)

"SF wrote 33,739 street-cleaning tickets in the last 30 days, about $105 each." (DataSF, queried today.)
- Parking ticket sample, real citation 2007036990. Handled pulls it from City data and checks the block's sweeping schedule for the minute it was written.
- This one matches, so Handled says so instead of filing a protest that would lose. That's the DoNotPay failure mode we designed against. 25 of 25 real tickets agree (Settings, "How well it works").
- "Don't get swept": the next sweep on her block is Monday 7am, so she gets a text Sunday evening.

## Optional, 25 s: Eat well near you

Gallery, Eat well near you, Try with a sample (or say it: "¿Cuántas calorías necesito y qué debo comer?").
- "About 1,610 calories a day, 121 g protein." Five plain lines in Spanish: what she burns, the goal, protein split across meals, and iron with vitamin C, away from coffee, because she is anemic.
- Today's meals, with what's on sale this week and how many minutes' walk it is (live flyer and map data). "Paired for absorption: lentils with red pepper."
- Tap Swap on a food; the plan changes and Handled remembers. Approve meal times: 21 go on the calendar.
- Run it once before going on stage so the store list is cached; the free map server is sometimes slow.

## 1:55 It follows up on its own (15 s)

Settings, +15 days. The landlord check-in fires, the case escalates, and the second notice is ready to approve.

## 2:10 Give back (15 s)

"Fix it on my block": a broken streetlight. Live 311 data shows how many neighbors already reported it and the City's median hours to close. Handled watches City data until the case closes. The anonymous civic report shows which City steps still have no online path.

## 2:25 Close (5 s)

"Every action waits for your tap. In your language. Free to run."

## Before going on stage

1. `npm run demo-check` (runs every stage flow against live City data in about 10 seconds) and `npm run eval`.
2. Keys in `.env`: Anthropic for the Spanish voice note and the call, plus Vapi. Without Vapi the call card opens the dialer with the script; use that as the fallback.
3. Chrome for voice. If the room is noisy, tap Type and paste the Spanish line.
4. Record the backup video at **3:30**, not later.

See [COMPETITION.md](COMPETITION.md) for who else does what and the answers to likely questions.
