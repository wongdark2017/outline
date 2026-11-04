# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | API resource layout, policies, presenters, commands, plugin APIs | Populated (API) |
| [Database Guidelines](./database-guidelines.md) | ORM, preference persistence, import retention; additive repair of applied schemas | Scenarios populated |
| [Error Handling](./error-handling.md) | Email sign-in proof, attempt lifecycle, permanent unlimited sending and safe errors | Email sign-in populated |
| [Quality Guidelines](./quality-guidelines.md) | API routes, auth, previews; private appearance assets and immutable script consent | Populated |
| [Logging Guidelines](./logging-guidelines.md) | Logger API, levels, structured extra, production-only redaction; email scenario | Populated |

---

> **Branch-only scenarios:** the "Email sign-in" / "Permanent unlimited email sending" scenario sections in this layer describe code on the paused `feat/email-code-signin-*` branches. That code is not on `main`; ignore those sections unless working on that feature.

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
