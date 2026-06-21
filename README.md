# desktop-companion-fluffy

A desktop companion AI — **Fluffy**, a Live2D bunny girl who lives on your PC. Transparent overlay, voice chat, push-to-talk, and awareness of your time, open windows, and what you're listening to.

Repo: [github.com/christossolonos-bit/desktop-companion-fluffy](https://github.com/christossolonos-bit/desktop-companion-fluffy)

## Features

- Live2D avatar overlay (Cubism 3/4 models)
- Chat with Fluffy via **Ollama** (local LLM)
- **XTTS** voice with a reference speaker clip
- **Whisper** push-to-talk speech input
- Proactive speech — she can choose to speak on her own
- Real **screen context** (active window + open windows)
- Real **media context** (Spotify, YouTube, VLC, etc. from window titles)
- Click-through mode for desktop use

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.com/) with the configured model
- Python 3.11+ for XTTS and Whisper
- A Live2D Cubism model you have rights to use
- Windows (screen/media context features)

## Setup

```bash
npm install
npm run setup
npm run setup:xtts
npm run setup:whisper
```

## Run

```bash
npm run app
```

Other commands: `npm run dev`, `npm run app:stop`, `npm run app:restart`, `npm run build`

## Licensing note

If you distribute this app publicly and let users load arbitrary Live2D models, Live2D may classify it as an [Expandable Application](https://www.live2d.com/en/sdk/license/expandable/) requiring a separate publication license. Personal use with your own models is generally fine.

## Tech stack

- Electron, Vite, PixiJS, pixi-live2d-display
- Ollama, Coqui XTTS, faster-whisper
