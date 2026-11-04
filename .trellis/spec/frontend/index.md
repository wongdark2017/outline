# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Forms, theme styling; independent appearance and trusted script lifecycle | Forms + theme + customizations populated |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state; recoverable email sign-in and immediate resend/local expiry | Email sign-in documented; other topics to fill |
| [Quality Guidelines](./quality-guidelines.md) | Testing scope; translation and CSRF scenarios | Testing + translation populated |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

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
