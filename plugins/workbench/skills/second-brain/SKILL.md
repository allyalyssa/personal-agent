---
name: second-brain
description: Conventions for the person's local Markdown second brain - what to record, where it goes, how notes link and supersede each other, and how to retrieve and cite them. Use when recording a decision, lesson, task outcome, workflow, research finding or open question, when the person asks what was decided or learned before, or when organizing or cleaning up notes.
---

# Second brain

A folder of Markdown notes (default `<home>/repos/second-brain`, see `/brain path`). It is a normal Obsidian-compatible vault: YAML frontmatter, `[[wikilinks]]`, one note per subject.

## Layout

| Folder | Type | Holds |
| --- | --- | --- |
| `profile/` | preference | How the person likes to work. Active preference notes are loaded into every session's system prompt. |
| `projects/` | project | One note per project: purpose, status, stack, conventions, links |
| `decisions/` | decision | `YYYY-MM-DD-slug.md`: decision, rationale, alternatives rejected |
| `lessons/` | lesson | Technical discoveries, fixes, troubleshooting history |
| `workflows/` | workflow | Repeatable procedures |
| `research/` | research | Findings with sources and confidence |
| `questions/` | question | Open problems; set `status: resolved` when answered |
| `sessions/` | session | `YYYY-MM-DD-slug.md`: outcome of a meaningful task: what changed, verified results, remaining work |
| `concepts/` | concept | Ideas that link several notes |

Folders starting with `_` (`_templates`, `_backups`, `_exports`, `_trash`) are skipped by search. `index.md` is rebuilt automatically.

## Frontmatter

```yaml
---
title: Use Welch's t-test for the ERP comparison
type: decision
project: visual-wm-vi-eeg
tags: [eeg, statistics]
status: active          # active | superseded | resolved | archived
created: 2026-10-19
updated: 2026-10-19
summary: Unequal variances between groups; Welch over Student's t
links: ["[[projects/visual-wm-vi-eeg]]"]
supersedes: "[[decisions/2026-09-02-students-t-test]]"
---
```

## Recording

Use `mcp__workbench__brain_record` (load it with ToolSearch). It writes the frontmatter, updates an existing note with the same title instead of duplicating it, marks a superseded note, rebuilds the index, and refuses text that looks like a credential.

Record:
- decisions with their reasons, and what they replaced;
- verified task outcomes, with remaining work;
- lessons that would save time next time;
- research findings with sources and confidence;
- open questions.

Don't record: secrets, keys, passwords, account numbers; health, financial or other sensitive personal details; other people's private information; temporary details (branch names, ports, one-off paths); anything unverified presented as fact.

At the end of a meaningful task, write one `session` note and update the project note. Keep entries short.

## Retrieving

`mcp__workbench__brain_search` with `query` (optionally `type`, `project`), or `path` to read a note with its backlinks. The plugin also attaches up to a few matching notes to new prompts. When you rely on a note, cite its path. If a note conflicts with what the person says now, follow the person and offer to update the note.

## Commands for the person

`/brain search`, `/brain show`, `/brain recent`, `/brain edit`, `/brain delete` (keeps a copy in `_trash`), `/brain export`, `/brain backup`, `/brain rebuild`.
