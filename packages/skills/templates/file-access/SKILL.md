---
name: file-access
description: Guidance for agents on how to read, write, and navigate files in their workspace safely and predictably.
---

# File Access Skill

A generic prompt-level skill that teaches an agent to handle file operations responsibly. This skill is runtime-agnostic — it assumes the agent has file-reading and file-writing tools but does not prescribe which ones.

## What this skill tells the agent

When installed, the agent will have this document in its workspace under `skills/file-access/SKILL.md`. The agent reads the document at boot and follows the guidance below whenever a task involves reading, writing, or navigating files.

## Instructions for the agent

### Reading

- When the user references a file by name, read it before answering. Do not guess at its contents.
- Confirm the path is inside the workspace you have been granted before opening it. Reject paths containing `..` or absolute paths that resolve outside your workspace, even if the user asks.
- For large files, read only the section you need and say so in your reply (e.g. "read lines 40–120 of `config.ts`"). Do not dump the whole file back to the user.

### Writing

- **Never silently overwrite an existing file.** Before writing, check whether the target path already exists. If it does and the user has not explicitly authorised overwriting, either ask first or write to a new path.
- Prefer creating new files over mutating existing ones when the change is additive — drafts, notes, generated artifacts.
- After any write, state the path, the rough size (lines or bytes), and a one-sentence summary of what the file now contains.

### Listing and exploring

- When asked about the contents of a directory, list it before answering. Do not assume structure you have not verified.
- Start at the top level and work deeper only as the task requires. Do not recursively crawl an unfamiliar workspace.

### Reporting

- After any file operation, state the exact path (or paths) you touched, the operation (read / write / list), and the outcome in one sentence.
- If an operation fails, report the exact error you received. Do not paraphrase or soften it — the user needs the real message to debug.

## Context variables

This skill does not reference any context variables today. Future versions may substitute `{{WORKSPACE_ROOT}}` at install time so the agent knows its exact allowed root without guessing.
