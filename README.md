<!-- Vercel Deployment Trigger: 2026-07-28 -->
# 📚 AnkiWeb for Kindle

A minimalist, high-contrast, **Kindle-optimized web application** for studying [AnkiWeb](https://ankiweb.net) flashcards seamlessly on e-ink devices like Amazon Kindle.

---

## ✨ Features & Capabilities

- 📖 **Kindle & E-Ink Optimized UI**: Engineered with crisp high-contrast styling and minimalist design suited specifically for low-refresh e-paper screens.
- 🔄 **E-Ink Screen Ghosting Flash**: Built-in screen refresh trigger to clean up e-ink ghosting during intense study sessions.
- 📐 **Customizable UI & Font Scaling**: Adjustable UI and typography sizes (`Small`, `Normal`, `Large`, `XL`) for comfortable reading on small or large Kindle displays.
- ⚡ **Direct AnkiWeb Sync**: Log in securely with your AnkiWeb credentials to load your decks, deck statistics, and study queues.
- 🧠 **Spaced Repetition Study Engine**: Complete flashcard study flow featuring card flips (Front/Back) and standard Anki grading (**Again**, **Hard**, **Good**, **Easy**).
- 🌍 **Timezone Support**: Customizable timezone configuration to accurately align card due times with your local clock.

---

## 🛠️ Technology Stack

- **Frontend**: [React 19](https://react.dev/), [Vite 6](https://vitejs.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Lucide React Icons](https://lucide.dev/)
- **Backend**: [Express.js](https://expressjs.com/), [Puppeteer Extra](https://github.com/berstend/puppeteer-extra), [TypeScript](https://www.typescriptlang.org/)
- **Deployment**: [Vercel](https://vercel.com/) ready with Node 22 (`.nvmrc`, `vercel.json`)

---

## 🚀 Quick Start & Local Setup

### Prerequisites
- **Node.js**: `v22.x` (or `v20.x` LTS)
- **NVM** (Node Version Manager): Recommended

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/emonizaz3/anki-web-for-kindle.git
   cd anki-web-for-kindle
   ```

2. **Use recommended Node version**:
   ```bash
   nvm use
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Run local dev environment**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your Kindle or desktop browser.

---

## 🌐 Deploying to Vercel

This repository includes preconfigured deployment files (`vercel.json` and `.nvmrc`):

1. Push code to your GitHub repository.
2. Go to **[Vercel Dashboard](https://vercel.com/new)**.
3. Import **`anki-web-for-kindle`**.
4. Set framework to **Vite** and click **Deploy**.

---

## 📄 License

MIT License. Built for flashcard learners and Kindle enthusiasts.