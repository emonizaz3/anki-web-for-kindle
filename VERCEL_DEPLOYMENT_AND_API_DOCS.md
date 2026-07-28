# AnkiWeb for Kindle - API Documentation & Vercel Deployment Guide

## 1. Why `POST /api/login` Fails with 500 Internal Server Error on Vercel

When deploying this application to **Vercel**, you will encounter a `500 Internal Server Error` on `/api/login` due to two fundamental architectural differences between serverless environments (Vercel) and traditional Node.js servers:

### A. Stateless Serverless Execution vs. Stateful In-Memory Puppeteer Sessions
* **Current Server Architecture**: The backend uses **Puppeteer** (a headless Chrome browser) to log into AnkiWeb on behalf of the user, keeping an active headless browser tab in memory (`sessions[sessionId] = { browser, page }`).
* **Vercel Serverless Function Limit**: Vercel executes API endpoints as short-lived, stateless Serverless Lambda Functions. Once an API route returns a response, the lambda process freezes or terminates. Any active browser instance or page object in `sessions` is immediately lost or destroyed. On the next request (`/api/decks`), a different serverless instance is invoked, causing `sessions[sessionId]` to be `undefined`.

### B. Missing Native Chromium Binaries in Vercel Lambda
* Standard `puppeteer` attempts to launch a full local Chromium binary via `puppeteer.launch()`.
* Vercel's standard Node.js serverless execution environment does **not** include standard Chrome / Chromium desktop dependencies required by `puppeteer`. Calling `puppeteer.launch()` without `puppeteer-core` and `@sparticuz/chromium` causes an unhandled runtime exception, returning a `500 Internal Server Error`.

---

## 2. How to Deploy Successfully

### Option A: Deploy as a Container / Long-Running Node Server (Recommended ⭐)
Because this app relies on active Puppeteer browser sessions and real-time page interaction, hosting on a long-running server environment is the most straightforward and stable solution:
* **Google Cloud Run**
* **Railway.app**
* **Render.com**
* **Fly.io**
* **AWS App Runner / EC2 / DigitalOcean Droplet**

#### Dockerfile Example for Cloud Run / Railway / Render:
```dockerfile
FROM node:20-slim

# Install Chrome dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
ENV PORT=3000
CMD ["npm", "start"]
```

### Option B: Modifying for Vercel Serverless Architecture
If you must deploy to Vercel, you need to adapt the code for stateless serverless functions:
1. Replace `puppeteer` with `puppeteer-core` and `@sparticuz/chromium`.
2. Store login cookies (AnkiWeb session cookies) in an external database or encrypted cookie instead of holding an active browser instance in `sessions`.
3. Re-hydrate the browser page on each request using stored cookies.

---

## 3. Complete API Documentation

Base URL: `https://<YOUR-DOMAIN>/api`

### Common Headers
* `Content-Type`: `application/json`
* `x-session-id`: `<SESSION_UUID>` (Required for all authenticated endpoints)
* `x-timezone`: `<IANA_TIMEZONE>` (e.g. `America/New_York`, `UTC`, `Asia/Tokyo`. Defaults to `UTC`)

---

### Endpoints

#### 1. Login
* **URL**: `POST /api/login`
* **Headers**: `x-timezone` (optional)
* **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "yourpassword"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "sessionId": "e2c38f1a-7b3d-4c8e-9f0a-1b2c3d4e5f6a"
  }
  ```
* **Error Response**:
  * `400 Bad Request`: `{"error": "Email and password required"}`
  * `401 Unauthorized`: `{"error": "Login failed. Check credentials."}`
  * `500 Internal Server Error`: `{"error": "<description>"}`

---

#### 2. Get Decks
* **URL**: `GET /api/decks`
* **Headers**: `x-session-id: <SESSION_UUID>`, `x-timezone` (optional)
* **Success Response (200 OK)**:
  ```json
  [
    {
      "name": "Japanese Vocabulary",
      "id": "Japanese Vocabulary",
      "newCards": 10,
      "learnCards": 5,
      "reviewCards": 20,
      "dueCards": 35,
      "totalCards": 0
    }
  ]
  ```
* **Error Response**:
  * `401 Unauthorized`: `{"error": "Unauthorized"}` (Session expired or invalid)

---

#### 3. Start Studying a Deck
* **URL**: `POST /api/study/start`
* **Headers**: `x-session-id: <SESSION_UUID>`, `x-timezone` (optional)
* **Request Body**:
  ```json
  {
    "deckId": "Japanese Vocabulary"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "front": "<div>Front side content HTML</div>",
    "back": null,
    "finished": false,
    "starred": false,
    "flagColor": null,
    "rateButtons": [],
    "counts": {
      "newCards": 10,
      "learnCards": 5,
      "reviewCards": 20
    },
    "cardType": "new"
  }
  ```
* **Note**: When all cards in the deck are complete, `finished: true` will be returned.

---

#### 4. Reveal Card Back
* **URL**: `POST /api/study/reveal`
* **Headers**: `x-session-id: <SESSION_UUID>`
* **Success Response (200 OK)**:
  ```json
  {
    "front": "<div>Front side content HTML</div>",
    "back": "<div>Back side answer HTML</div>",
    "finished": false,
    "starred": false,
    "flagColor": null,
    "rateButtons": [
      { "id": "1", "label": "Again", "interval": "1m", "ease": 1 },
      { "id": "2", "label": "Hard", "interval": "6m", "ease": 2 },
      { "id": "3", "label": "Good", "interval": "10m", "ease": 3 },
      { "id": "4", "label": "Easy", "interval": "4d", "ease": 4 }
    ],
    "counts": {
      "newCards": 10,
      "learnCards": 5,
      "reviewCards": 20
    },
    "cardType": "new"
  }
  ```

---

#### 5. Answer Card Rate (Again / Hard / Good / Easy)
* **URL**: `POST /api/study/answer`
* **Headers**: `x-session-id: <SESSION_UUID>`
* **Request Body**:
  ```json
  {
    "ease": 3
  }
  ```
* **Description**: `ease` corresponds to button ratings (1 = Again, 2 = Hard, 3 = Good, 4 = Easy).
* **Success Response (200 OK)**: Returns the next card object (same format as `/api/study/start`).

---

#### 6. Perform Card Action (Mark Note / Flag Card)
* **URL**: `POST /api/study/action`
* **Headers**: `x-session-id: <SESSION_UUID>`
* **Request Body**:
  ```json
  {
    "action": "mark",
    "flagIndex": 1
  }
  ```
* **Description**:
  * `action`: `"mark"` (toggles Star / Mark) or `"flag"` (toggles flag color 0 to 7).
  * `flagIndex` (optional): `0` (None), `1` (Red), `2` (Orange), `3` (Green), `4` (Blue), `5` (Pink), `6` (Turquoise), `7` (Purple).
* **Success Response (200 OK)**: Returns updated card object with `starred` and `flagColor`.

---

#### 7. Fetch Current Card State
* **URL**: `POST /api/study/card`
* **Headers**: `x-session-id: <SESSION_UUID>`
* **Success Response (200 OK)**: Returns current card object without changing card progress.

---

#### 8. Logout
* **URL**: `POST /api/logout`
* **Headers**: `x-session-id: <SESSION_UUID>`
* **Success Response (200 OK)**:
  ```json
  {
    "success": true
  }
  ```
* **Description**: Closes the headless browser instance and removes session from server memory.

---

## 4. Multi-User Capabilities

### Question: "If I host this app, can it handle multiple users?"
**Yes, it supports multiple simultaneous users**, with the following details:

1. **Session Isolation**:
   * Every user who logs in receives a unique `sessionId` (UUIDv4).
   * Each `sessionId` spawns an isolated browser page in Puppeteer (`sessions[sessionId] = { browser, page }`).
   * Users do not see or interfere with each other's AnkiWeb sessions or decks.

2. **Resource Considerations for Hosting**:
   * Each open browser session uses roughly 50MB – 100MB of RAM.
   * On a server with 1GB RAM, it can comfortably host ~10–15 concurrent active study sessions.
   * On a server with 4GB RAM, it can host 50+ concurrent users.
   * If memory limit is reached, standard Puppeteer browser pages can be configured to auto-close after inactivity timeout.

---

## 5. AnkiWeb Target Domains & Under-the-Hood Interacted Endpoints

### AnkiWeb Target Domain
* **Primary Domain**: `https://ankiweb.net`

### How the Server Interacts with AnkiWeb
AnkiWeb does not provide an official public REST API. Instead, our backend Node.js server uses Puppeteer browser automation to navigate and interact directly with `https://ankiweb.net`.

Below is the complete reference of all AnkiWeb URLs, DOM selectors, and JavaScript functions utilized by the server:

#### A. Authentication
* **Target URL**: `https://ankiweb.net/account/login`
* **DOM Selectors**:
  * `#email` — Input field for user email
  * `#password` — Input field for user password
  * `input[type="submit"]`, `button[type="submit"]` — Form submission
* **Validation**: Confirms successful login by verifying navigation to `https://ankiweb.net/decks`.

#### B. Decks Dashboard
* **Target URL**: `https://ankiweb.net/decks`
* **Scraped DOM Elements**:
  * Deck Links / Buttons: `.deck-name`, `.deckname`, `button.deck`, `a.deck`
  * Card Counts:
    * New Cards: `.text-primary`, `.text-info`, `span.new-count`
    * Learn Cards: `.text-danger`, `span.learn-count`
    * Review / Due Cards: `.text-success`, `span.review-count`

#### C. Study Interface & Flashcards
* **Target URL**: `https://ankiweb.net/study/`
* **Card Content Container**: `#qa` (contains card front question and back answer HTML)
* **Show Answer Action**:
  * Clicks `#ansbtn` or evaluates AnkiWeb client function `study.drawAnswer()` / `showAnswer()`
* **Rating / Answering Cards**:
  * Buttons: `#ease1` (Again - 1), `#ease2` (Hard - 2), `#ease3` (Good - 3), `#ease4` (Easy - 4)
  * JS Evaluation: `study.drawAnswer(ease)` or `study.answerCard(ease)`

#### D. Note Marking & Flagging
* **Mark / Star Note**:
  * Trigger: Dispatches `Ctrl+K` key combination or executes `study.toggleMark()`
  * DOM Detection: `#qa.marked`, `.card.marked`, `.star.active`
* **Flag Note**:
  * Trigger: Dispatches `Ctrl+1` (Red), `Ctrl+2` (Orange), `Ctrl+3` (Green), `Ctrl+4` (Blue), `Ctrl+5` (Pink), `Ctrl+6` (Turquoise), `Ctrl+7` (Purple), or `Ctrl+0` (Clear Flag), or evaluates `study.setFlag(flagIndex)`
  * DOM Detection: `[class*="flag-1"]` through `[class*="flag-7"]`

