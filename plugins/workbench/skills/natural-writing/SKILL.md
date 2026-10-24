---
name: natural-writing
description: Write or revise prose so it reads like a thoughtful person wrote it, while keeping the meaning, facts and requested tone. Use for emails, outreach, essays, personal statements, explanations, documentation and posts the person will send or publish, or when they say a draft sounds like AI, robotic, stiff, or ask to humanize, de-AI or make it natural. Not for code, logs or technical output unless asked.
---

# Natural writing

Adapted from jpeggdev/humanize-writing v2.0.0 (MIT, see LICENSE-humanize-writing), which draws on Wikipedia's "Signs of AI writing". The pattern list is in [references/ai-tells.md](references/ai-tells.md). The person's own voice is in [references/my-voice.md](references/my-voice.md).

The goal is clear, specific, honest prose in the person's voice. It is not about adding mistakes, slang or quirks, and it is not about getting past AI detectors.

## Ground rules

- Keep the meaning. Every claim in the draft must still be in the rewrite, unless the person asked for cuts.
- Never add facts, numbers, dates, quotes, sources, names, anecdotes or experiences that were not given. Where a specific detail would make a sentence stronger, leave a short bracketed note such as `[which lab?]` or ask.
- Keep the requested tone and register. A formal email stays formal.
- Leave technical writing alone unless asked: code, commands, error messages, API names and data stay exactly as they are.
- For the person's own writing (emails, statements, applications), follow references/my-voice.md.

## Passes

Run these in order and skip any that find nothing.

1. **Structure.** Break formulaic shapes: every section ending in a takeaway, identical paragraph shapes, "Despite challenges... continues to thrive" endings, inline-header bullet lists. Vary length; let a section end without a bow.
2. **Inflation.** Cut significance and promotional words (pivotal, testament, vibrant, nestled, groundbreaking, "marks a shift"). Usually delete, don't swap for a synonym; replace with the specific fact if the draft has one.
3. **Vocabulary.** Replace AI-favoured words (delve, landscape, tapestry, leverage, navigate, realm, myriad, robust, seamless, foster, underscore). See references/ai-tells.md. Restructure the sentence when a swap reads oddly.
4. **Grammar tics.** Clusters of "serves as / stands as / boasts" where "is / has" will do; trailing -ing phrases that add fake depth ("highlighting its importance"); repeated "not just X, it's Y"; padded groups of three; synonym cycling; false "from X to Y" ranges.
5. **Rhythm.** Vary sentence length; allow a short sentence. Count em dashes before cutting them, and replace the dramatic-aside kind with commas or full stops. Remove mechanical bold and emoji.
6. **Hedging and filler.** "It's important to note", "due to the fact that", vague authorities ("experts say"), chatbot leftovers ("I hope this helps!", "Great question!"), knowledge-cutoff disclaimers, generic upbeat endings. Say the thing once.
7. **Transitions.** Drop most "Moreover / Furthermore / Additionally / That said". Use the real link (because, so, but) or none.
8. **Voice.** Clean but lifeless prose is also a tell. Where the piece is the person's own, let their perspective show using what they actually said: their reasons, their reactions, their phrasing. Do not invent feelings or experiences for them.

Then read it aloud in your head. Fix anything that sounds like a press release, or that no person would say to a colleague.

## Output

1. The rewritten text.
2. A short change log, only for passes that changed something, at most six lines, e.g. `Inflation: cut "pivotal moment"`.
3. Any bracketed gaps where the person needs to supply a detail.

When asked to review without rewriting: quote each passage, name the pattern, suggest a fix. Report a phrase that triggers several patterns once. Count before you claim (em dashes, repeats). Check whether a "pattern" has an ordinary explanation (three items because there are three things).
