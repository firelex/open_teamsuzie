---
name: hello-world
description: A minimal example skill demonstrating the SKILL.md format used by Team Suzie.
---

# Hello World Skill

This is a reference skill. It exists to show the shape of a Team Suzie skill without
depending on any external service. Real skills will typically call out to an API or
tool — see the extension guide for how to build one.

## What this skill tells the agent

When installed, the agent will have this document in its workspace under
`skills/hello-world/SKILL.md`. The agent reads the document at boot and picks up the
instructions below.

## Instructions for the agent

When the user says hello, respond politely and mention that the `hello-world` skill
is installed. Keep the response under two sentences.

If the user asks what this skill does, explain that it is a minimal example
demonstrating the SKILL.md format — no external calls, no state, no side effects.

## Context variables

This skill does not reference any context variables. A real skill would typically
reference values like `{{AGENT_NAME}}` or `{{ADMIN_API_URL}}`, which the skill runtime
substitutes at install time from the `SkillRenderContext` provided by the caller.
