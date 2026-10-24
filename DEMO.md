# Demo master plan

The kickoff asked for three things: agents that take work off people's plates, that real people would use every week, and that give something back to how the city works. It also asked for a live demo in production, a GitHub link and a 2-minute backup video. Every beat below maps to one of those.

## The argument in one breath

San Francisco hands everyone rules, deadlines and paperwork that nobody explains, and a third of the city was born somewhere else. Handled is the one place you send all of it: a photo, an email or a voice note in your own language. It works out what you owe, what you're owed and what to do, does the work once you tap approve, and keeps following up. It knows the City's rules, reads the City's own data, and gets faster every time because it remembers you.

**Line to repeat:** "Pine fights companies. SpotAngels watches your car. Handled handles the City, and what you eat this week."

## Why people need it (say two of these, not all)

Every number here has a source you can show if a judge asks.

| Point | Number | Source |
|---|---|---|
| The city runs on paperwork in English, and a lot of people don't | 34.2% of San Franciscans are foreign-born; 43.4% speak a language other than English at home | [Census QuickFacts](https://census.gov/quickfacts/fact/table/sanfranciscocitycalifornia,US/PST045219), 2019-2023 ACS |
| Small fines add up | Over 1.2 million SF parking tickets in 2024; 33,739 street-cleaning tickets in the last 30 days alone, about $105 each (about $3.5 million a month) | [ABC7](https://abc7news.com/post/where-are-top-spots-san-francisco-most-get-parking-ticket/16038735/); DataSF citations `ab4h-6ztd`, queried 2026-10-24 |
| Money people are owed and never claim | SF landlords owe deposit interest every year; Valentina is owed $408 on a $4,000 deposit | SF Rent Board rates, verified 2026-10-24 (`rules/sf_deposit_interest.json`) |
| Eating well is hard even with a job | 28% of lower-income SF adults were food insecure in 2024; 67% of SF-Marin Food Bank participants work | [SF-Marin Food Bank, CHIS 2024](https://www.nbcbayarea.com/news/local/food-insecurity-bay-area/4047203/), [Hunger Report 2025](https://www.sfmfoodbank.org/wp-content/uploads/2025/10/hunger-report_2025_web.pdf) |
| Help exists but people don't use it | California has long ranked near the bottom of US states for CalFresh enrollment of eligible people (57% in FFY 2011, the latest statewide figure we found) | [ABC7](https://abc7news.com/archive/9001949) |

## Why it's everyday, not emergency

Most "help" apps get opened once, in a crisis. Handled has something every week:

- **Every day:** meals planned around your body and what's on sale near you; meal times on your calendar.
- **Every week:** street sweeping on your block (a text the evening before), new grocery deals, a check-in on the plan.
- **Every month or so:** a ticket, a bill, a notice from the landlord, a 311 problem on your street.
- **Every year:** deposit interest, the rent increase check, the lease.
- **Life events:** you got laid off, your car was broken into, you just moved here.

And it compounds: every answer is remembered, so the second case asks fewer questions than the first, and star ratings teach it which recipes you like.

## Run of show (2:40)

One persona the whole time: **Valentina**, Puentes alum from Montevideo, two years in SF, engineer on an O-1, rents in the Mission, drives, speaks Spanish, anemic, lifts three times a week. Settings, Valentina, "Start with no cases" checked.

Keep a running total in your head and say it at the end: money found, tickets avoided, hours saved.

### 0:00 Hook (15 s)

"Raise your hand if San Francisco has ever sent you something you didn't understand. A ticket, a lease clause, a notice. A third of this city was born somewhere else. This is Valentina; she came through Puentes. Watch her week."

### 0:15 Monday: what to eat (45 s), the everyday hook

She taps Voice: **"¿Cuántas calorías necesito y qué debo comer?"** (works in keyword mode; her body facts come from her profile).
- Headline: about 1,590 calories and 118 g of protein a day. Five plain lines in Spanish: what she burns, how to lose a little fat, protein split across meals, and iron with vitamin C and away from coffee, because she's anemic. Point at "Confirm with your doctor" and the source link: information, not advice.
- Each meal is a top-rated recipe sized to her day (breakfast about 400 kcal, lunch about 560). Tap 5 stars on one: "It learns what she likes and still tries something new."
- What's on sale this week at stores she can walk to (live flyer and map data).
- Approve meal times: 21 go on her calendar. Grocery list to her phone.
- Say: "That's not a calorie counter. It starts from her body and her block."

### 1:00 Tuesday: money she's owed (25 s)

Gallery, Deposit interest, Try with a sample.
- "Your landlord owes you **$408**": $4,000 x 5.2% due Nov 1 2024 plus $4,000 x 5.0% due Nov 1 2025, at the Rent Board rate in effect on each due date.
- City Assessor data, live: built 1907, 21 units, so the landlord may keep up to $29.50 a year of Rent Board fees. **At least $349.** Approve the demand email.

### 1:25 Wednesday: the ticket (25 s)

"SF wrote 33,739 street-cleaning tickets in the last 30 days."
- Real citation 2007036990. Handled pulls it from City data and checks the block's sweeping schedule for the minute it was written. It matches, so Handled tells her not to waste a protest. "DoNotPay got fined by the FTC for overpromising. We'd rather be right: 25 of 25 real tickets agree."
- "Don't get swept": next sweep on her block is Monday 7am, so she gets a text Sunday evening. "That's the $105 she doesn't pay."

### 1:50 Thursday: the call (25 s), only if the Vapi key works

Voice, Spanish: "Anoche me rompieron el vidrio del auto en Valencia y 20."
- Police report and insurance packet prepared; approve the call to the glass shop. A phone on stage rings (a Flai judge answers if organizers agree). The agent says it's an AI calling for Valentina, asks price and earliest slot, won't go over $400 or take card details. Price and slot land on the case.
- Without Vapi: skip this beat and use the time for the follow-up below.

### 2:15 It follows up on its own (10 s)

Settings, +15 days. The landlord check-in fires and the second notice is ready to approve. "She didn't have to remember."

### 2:25 Give back and close (15 s)

"Fix it on my block": a broken streetlight; live 311 data shows how many neighbors already reported it. The anonymous civic report shows which City steps still have no online path. "That's data the City doesn't have today."

Close: **"$349 found, a $105 ticket avoided, a week of meals planned. Every action waited for her tap, in her language, free to run. Handled handles the City."**

## What each judge will listen for

- **Circleback** (meeting notes, action items, automations): one capture becomes action items, deadlines and follow-ups that fire on their own. Mention `POST /api/inbound`: a notetaker can forward a summary and it becomes a case.
- **Flai** (AI phone agents): the call states it's an AI, has a budget cap, refuses card details, and turns the transcript into structured fields.
- **Vercel**: live URL, GitHub link, no build step.
- **Bloom** (consumer): the everyday loop. Meals and sweeping alerts bring her back weekly; the helper character and star ratings make it personal.
- **Delphi** (digital minds): it remembers her. "What Handled knows about you" in Settings, and fewer questions every time.

## If a judge pushes back

- **"Isn't this just ChatGPT?"** ChatGPT doesn't know SF's sweeping schedule, can't pull your citation, and won't text you on Sunday. The rules and dates come from files with sources and from City data, not from a model guessing.
- **"Is this medical or legal advice?"** No. Information with sources, who to confirm with, and you press the final button. Kidney disease gets no protein target; an eating disorder history gets no calorie numbers.
- **"Why would I keep using it?"** Meals every day, sweeping every week, deposit interest every year.
- **"Who pays?"** Free mode costs $0. A paid tier could add the things that cost money to run: calls, auto-sent email.

## Fix before stage (in this order)

1. **Recipes lost the "near you" link.** Since the recipe commit, meals show a recipe but the shopping list no longer matches this week's deals (demo-check showed "on sale: none"). Match recipe ingredient lines to the deals so each recipe shows what's on sale nearby. About 20 minutes.
2. **The iron story got thinner.** Recipes carry calories, protein and fiber but no iron, so the coverage bars show only three nutrients and the "lentils with red pepper" pairing is gone. Keep the iron line in the explanation, and if time allows add an iron-rich side when iron is a priority.
3. **Warm the store cache.** The free OpenStreetMap server fails often (it did on the last check). Open Eat well once on the demo laptop so stores are cached for a week.
4. **Keys.** Anthropic (voice notes in free-form Spanish) and Vapi (the call) have never run with real keys. Test the call three times or cut beat 1:50.
5. **Production URL.** Deploy with `render.yaml` and put the link on the slide with the GitHub link. If Render is slow, demo from the laptop and say the deploy link is in the README.
6. **Backup video now.** The 3:30 slot has passed. Record the run of show once, 2 minutes, today.
7. Right before going on: `npm run demo-check`, then Settings, Valentina, "Start with no cases".
