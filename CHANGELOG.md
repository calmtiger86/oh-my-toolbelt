# Changelog

All notable changes to Oh My Toolbelt are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Installs update when `version` in `.claude-plugin/plugin.json` goes up.

## [0.1.0] - 2026-10-24

The first public release. Tested by hand on macOS with Claude Code 2.1.309 and 2.1.310, in the terminal and in the desktop app's Code tab; the automatic tests also run on Linux and Windows.

### Added

- **The toolbelt**, a row above the prompt: information on the left, buttons on the right, fitted to the window by display width; what does not fit goes into `…`. `◂` folds it into a single `▸` and keeps it folded.
- **Clock and date** in 12- or 24-hour form, in your computer's time zone, UTC or that of one of 53 cities, with optional seconds and the date in your language's order.
- **Weather** for one of 63 cities from Open-Meteo, off until you pick a city.
- **Pomodoro**, shared by your sessions: focus rounds (and breaks, when Pomodoro auto break is on), a progress bar, a notification when a round ends and an optional sound on macOS (six sounds).
- **Your buttons**: saved prompts to fill or send, slash commands and skills, in sets you can switch, each with an optional icon and letter key.
- **Attach** (system file picker to `@` mentions), **Voice** (`/voice` on and off), **Light / Dark** (theme pair), **Hide** (covers the conversation) and **Export** (Markdown, HTML, plain text, and PDF in the terminal through a browser you pick).
- **The panel** with six tabs: Prompts (every prompt you sent, with jump, find, turn details and, in the desktop app, the answer in place), Notes, Clipboard (copies made by dragging, kept in memory; off by default), Status (this session, every tool, every setting), Tools (layout, buttons, sets, icons) and Guide (a step-by-step tour).
- **`/toolbelt`** (and `/tb`, when no other mod has it) commands for the panel's tabs, prompt jumps, the pomodoro, export, the curtain, the weather and hiding the toolbelt.
- **Desktop app support**: the same toolbelt and panel, settings kept by the toolbelt where Claude Code lists none and copied into `/config` from the next terminal session.
- **English, Korean and Japanese** for every word on screen, the guide and the README.
