---
name: personal-profile
description: Build or update an editable profile of how the person works, writes and decides, and optionally an advisory agent from it. Use only when the person asks to teach Claude their style, "make an agent like me", update their profile or voice, or calibrate drafts that don't sound like them. Never start this on your own.
---

# Personal profile

A short, reviewable version of HumanCompiler's interview (Gerstep/HumanCompiler, MIT). HumanCompiler itself is not installed: it needs Bun and runs scripts relative to the working directory, and its full eight-phase interview is far longer than most needs.

## 1. Start from what exists

Read before asking anything:
- `profile/` notes in the second brain (`mcp__workbench__brain_search` with `type: "preference"`), and the project notes relevant to the request;
- the natural-writing skill's `references/my-voice.md`;
- any samples the person gives you (emails, essays, messages). Samples beat self-description.

## 2. Ask only what is missing

Use HumanCompiler's areas as a checklist, and skip any area that's already covered or doesn't matter for what the person wants:

1. Role and current goals
2. Communication (register by audience, phrases they use, what they never say)
3. Decisions (how they weigh speed against certainty, when they ask for help)
4. Domain expertise (where they're expert, where they're learning)
5. Work patterns (planning style, how they like updates)
6. Edge cases (how they handle disagreement, bad news, pressure)
7. Artifact check: compare what they said with the samples, and ask about mismatches without judging
8. Calibration: draft something, ask what's off

Ask at most five questions per sitting, one at a time, each tied to a concrete example ("Here's how I'd open an email to a professor. What would you change?"). Stop when the answers stop changing the profile.

## 3. Write it where they can see it

- Writing voice: edit `references/my-voice.md` in the natural-writing skill (rules and short real examples).
- Everything else: `brain_record` with `type: "preference"`, one note per area, a one-line summary, and `confidence: high | medium | low` in the body for each claim, based on evidence.
- Show the person each change, as a diff or a short list, and ask before saving anything sensitive. Don't store health, financial, family or other private details.

## 4. Optional advisory agent

Only if asked. Draft `~/.claude/agents/<name>-advisor.md` (a user-level agent with `permissionMode: plan` and read-only tools) whose prompt quotes the profile notes by path rather than copying them. Show the draft and write it only after the person approves. Say plainly that it approximates their stated preferences and examples; it does not reproduce their judgment or personality.
