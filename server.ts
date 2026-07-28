import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { v4 as uuidv4 } from "uuid";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";

puppeteer.use(StealthPlugin());

const PORT = 3000;

// Simple in-memory session store
const sessions: Record<string, { browser: any; page: any }> = {};

async function startServer() {
  const app = express();
  app.use(express.json());

  // Allow CORS for Vercel frontend
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-session-id, x-timezone");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // POST /api/login
  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }

    try {
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        (window as any).__name = (f: any) => f;
      });
      
      const timezone = req.headers["x-timezone"] as string || "UTC";
      await page.emulateTimezone(timezone).catch((err: any) => {
        console.warn("Could not emulate timezone on login:", timezone, err);
      });
      
      await page.goto("https://ankiweb.net/account/login", { waitUntil: "networkidle2" });
      
      // Wait for login form
      await page.waitForSelector('input[type="text"][autocomplete="username"]', { timeout: 10000 });
      await page.type('input[type="text"][autocomplete="username"]', email);
      await page.type('input[type="password"]', password);
      
      // Click submit (it might be disabled until input is typed, so let's use the button text or btn class)
      await page.click('button.btn-primary');
      
      // Wait for navigation to decks
      await page.waitForNavigation({ waitUntil: "networkidle2" });
      
      // Check if we reached decks
      const url = page.url();
      if (!url.includes("decks")) {
        await browser.close();
        res.status(401).json({ error: "Login failed. Check credentials." });
        return;
      }

      const sessionId = uuidv4();
      sessions[sessionId] = { browser, page };
      
      res.json({ success: true, sessionId });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/decks
  app.get("/api/decks", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const session = sessions[sessionId];
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const { page } = session;
      const timezone = req.headers["x-timezone"] as string || "UTC";
      let timezoneChanged = false;
      if ((session as any).lastTimezone !== timezone) {
        await page.emulateTimezone(timezone).catch((err: any) => {
          console.warn("Could not emulate timezone on decks scrape:", timezone, err);
        });
        (session as any).lastTimezone = timezone;
        timezoneChanged = true;
      }

      if (!page.url().includes("decks") || timezoneChanged) {
        await page.goto("https://ankiweb.net/decks/", { waitUntil: "networkidle2" });
      }

      // Scrape decks
      const decks = await page.evaluate(() => {
        function __name(f: any) { return f; }
        const rows = document.querySelectorAll('.container .row');
        const results: any[] = [];
        rows.forEach(row => {
          const btn = row.querySelector('.btn-link.pl-0, a[href*="/study/"], button');
          if (btn) {
            const name = btn.textContent?.trim() || "";
            if (name && !name.toLowerCase().includes("log out") && !name.toLowerCase().includes("decks") && !name.toLowerCase().includes("search")) {
              const allText = row.textContent || "";
              const parts = allText.split(/\s+/).map(p => p.trim()).filter(p => p !== "");
              const numbers = parts.filter(p => /^\d+$/.test(p));
              
              const findInRow = (selectors: string[]) => {
                for (const s of selectors) {
                  try {
                    const el = row.querySelector(s);
                    if (el) return el;
                  } catch (e) {}
                }
                return null;
              };

              const newEl = findInRow(['.text-info', '.text-primary', '.new-count', '[class*="text-info"]', '[class*="text-primary"]', '[class*="new"]']);
              const learnEl = findInRow(['.text-danger', '.text-warning', '.learn-count', '[class*="text-danger"]', '[class*="text-warning"]', '[class*="learn"]']);
              const reviewEl = findInRow(['.text-success', '.review-count', '.due-count', '[class*="text-success"]', '[class*="review"]', '[class*="due"]']);

              let newCount = newEl ? parseInt(newEl.textContent || "0", 10) : 0;
              let learnCount = learnEl ? parseInt(learnEl.textContent || "0", 10) : 0;
              let reviewCount = reviewEl ? parseInt(reviewEl.textContent || "0", 10) : 0;

              if (!newEl && !learnEl && !reviewEl && numbers.length >= 1) {
                // Check elements inside row for colors or text
                const cellEls = Array.from(row.querySelectorAll('td, span, div, a, b, font'));
                for (const cell of cellEls) {
                  const text = cell.textContent?.trim() || "";
                  if (!/^\d+$/.test(text) || text.length > 5) continue;
                  const num = parseInt(text, 10);
                  if (isNaN(num)) continue;

                  const cls = (cell.className || "").toLowerCase();
                  const style = window.getComputedStyle(cell);
                  const color = style.color || "";
                  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

                  if (cls.includes('info') || cls.includes('primary') || cls.includes('blue') || (rgbMatch && parseInt(rgbMatch[3]) > 130 && parseInt(rgbMatch[1]) < 140)) {
                    newCount = num;
                  } else if (cls.includes('danger') || cls.includes('warning') || cls.includes('red') || (rgbMatch && parseInt(rgbMatch[1]) > 150 && parseInt(rgbMatch[3]) < 120)) {
                    learnCount = num;
                  } else if (cls.includes('success') || cls.includes('green') || (rgbMatch && parseInt(rgbMatch[2]) > 120 && parseInt(rgbMatch[1]) < 140)) {
                    reviewCount = num;
                  }
                }

                if (newCount === 0 && learnCount === 0 && reviewCount === 0) {
                  if (numbers.length >= 3) {
                    const idx = numbers.length - 3;
                    newCount = parseInt(numbers[idx], 10) || 0;
                    learnCount = parseInt(numbers[idx+1], 10) || 0;
                    reviewCount = parseInt(numbers[idx+2], 10) || 0;
                  } else if (numbers.length === 2) {
                    newCount = parseInt(numbers[0], 10) || 0;
                    learnCount = 0;
                    reviewCount = parseInt(numbers[1], 10) || 0;
                  } else if (numbers.length === 1) {
                    newCount = parseInt(numbers[0], 10) || 0;
                  }
                }
              }

              results.push({
                name: name,
                id: name,
                newCards: newCount,
                learnCards: learnCount,
                reviewCards: reviewCount,
                dueCards: newCount + learnCount + reviewCount,
                totalCards: 0
              });
            }
          }
        });
        return results;
      });

      res.json(decks);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/study/start
  app.post("/api/study/start", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const { deckId } = req.body;
    const session = sessions[sessionId];
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const { page } = session;
      const timezone = req.headers["x-timezone"] as string || "UTC";
      let timezoneChanged = false;
      if ((session as any).lastTimezone !== timezone) {
        await page.emulateTimezone(timezone).catch((err: any) => {
          console.warn("Could not emulate timezone on study start:", timezone, err);
        });
        (session as any).lastTimezone = timezone;
        timezoneChanged = true;
      }

      if (!page.url().includes("decks") || timezoneChanged) {
        await page.goto("https://ankiweb.net/decks/", { waitUntil: "networkidle2" });
      }

      // Wait for SvelteKit hydration
      await new Promise(r => setTimeout(r, 2500));

      // Click the deck by name using native click with fallbacks and retries
      let clicked = false;
      const clickTarget = async () => {
        return await page.evaluate((targetName: string) => {
          function __name(f: any) { return f; }
          // Attempt 1: Strict class match or specific links
          const deckBtns = Array.from(document.querySelectorAll('.container .row .btn-link.pl-0, a, button'));
          for (const btn of deckBtns) {
            if ((btn.textContent?.trim() || "") === targetName) {
              (btn as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, deckId);
      };

      clicked = await clickTarget();

      if (!clicked) {
        res.status(404).json({ error: "Deck not found" });
        return;
      }

      // Wait for URL to change away from /decks/ to ensure navigation has started
      let urlChanged = false;
      for (let i = 0; i < 4; i++) {
        const currentUrl = page.url();
        if (!currentUrl.includes('/decks') && !currentUrl.endsWith('/decks/')) {
          urlChanged = true;
          break;
        }
        if (i > 0) {
          console.log(`Still on /decks/, retrying deck click (attempt ${i + 1})...`);
          await clickTarget();
        }
        await new Promise(r => setTimeout(r, 1500));
      }

      // There might be a "Study Now" button on the intermediary screen
      let clickedStudy = await page.evaluate(() => {
        function __name(f: any) { return f; }
        const btns = Array.from(document.querySelectorAll('button, a, input'));
        for (const btn of btns) {
          const t = (btn.textContent || (btn as HTMLInputElement).value || "").toLowerCase();
          if (t.includes('study now') || t === 'study' || t.includes('学習') || t.includes('学習を開始')) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      // Wait for either the card container (#qa) or the finished page to render
      await page.waitForFunction(() => {
        function __name(f: any) { return f; }
        const qa = document.querySelector('#qa');
        if (qa) return true;
        const txt = (document.body.innerText || "").toLowerCase();
        if (txt.includes("congratulations") || txt.includes("congrats") || txt.includes("finished") || txt.includes("おめでとう") || txt.includes("終了") || window.location.pathname.endsWith('/decks') || window.location.pathname.endsWith('/decks/')) {
          return true;
        }
        return false;
      }, { timeout: 8000 }).catch(() => {});

      await new Promise(r => setTimeout(r, 1200));

      // Now we should be on the study page or finished. Get the card.
      const card = await extractCardText(page, sessionId);
      res.json(card);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/study/reveal
  app.post("/api/study/reveal", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const session = sessions[sessionId];
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const { page } = session;
      const timezone = req.headers["x-timezone"] as string || "UTC";
      await page.emulateTimezone(timezone).catch((err: any) => {
        console.warn("Could not emulate timezone on study reveal:", timezone, err);
      });
      
      // Target "Show Answer" specifically by selector first, fallback to all buttons, then to final selector fallback
      const clickedShowAnswer = await page.evaluate(() => {
        function __name(f: any) { return f; }
        // Target show answer by selector first
        const ansBtn = document.querySelector('#ansbut, #ansbuta, .btn-primary, button.btn-lg') as HTMLElement;
        if (ansBtn) {
          const text = (ansBtn.textContent || "").toLowerCase();
          if (text.includes('show answer') || text.includes('解答') || text === 'show' || text.includes('answer')) {
            ansBtn.click();
            return true;
          }
        }

        // Search all buttons as fallback
        const allBtns = Array.from(document.querySelectorAll('button, a, input'));
        for (const btn of allBtns) {
          const t = (btn.textContent || (btn as HTMLInputElement).value || "").toLowerCase();
          if (t.includes('show answer') || t.includes('解答') || t === 'show' || t.includes('answer')) {
            (btn as HTMLElement).click();
            return true;
          }
        }

        // Final selector fallback
        const fallbackBtn = document.querySelector('button.btn-primary, button.btn-lg, #ansbut, #ansbuta') as HTMLElement;
        if (fallbackBtn) {
          fallbackBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);
      
      // Wait a tiny bit for UI update
      await new Promise(r => setTimeout(r, 600));

      const card = await extractCardText(page, sessionId);
      if (card && (card as any).debugHtml) {
        console.log("=== SCRAPED DECK BUTTON DIAGNOSTICS (REVEAL) ===");
        console.log("Page URL:", page.url());
        console.log("Raw Button HTML:\n", (card as any).debugHtml);
        console.log("Parsed Buttons:\n", JSON.stringify(card.rateButtons, null, 2));
        console.log("=================================================");
      }
      res.json(card);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/study/rate
  app.post("/api/study/rate", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const { rating } = req.body; // 1=Again, 2=Hard, 3=Good, 4=Easy
    const session = sessions[sessionId];
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const { page } = session;
      const timezone = req.headers["x-timezone"] as string || "UTC";
      await page.emulateTimezone(timezone).catch((err: any) => {
        console.warn("Could not emulate timezone on study rate:", timezone, err);
      });

      // Try clicking the rating button directly first (Method 1: Precise selector or text match)
      const ratingMap: Record<number, string> = {
        1: "Again",
        2: "Hard",
        3: "Good",
        4: "Easy"
      };
      const btnText = ratingMap[rating] || "Good";

      // Try matching by precise rating button text or by index inside page.evaluate
      const clickedRating = await page.evaluate((btnTextLower: string, ratingIdx: number) => {
        function __name(f: any) { return f; }
        // Try matching by precise rating button text
        const allBtns = Array.from(document.querySelectorAll('button, a, input'));
        for (const btn of allBtns) {
          const t = (btn.textContent || (btn as HTMLInputElement).value || "").toLowerCase();
          if (t === btnTextLower || t.includes(btnTextLower)) {
            (btn as HTMLElement).click();
            return true;
          }
        }

        // Try matching by index under #ansbut container
        const ansBut = document.querySelector('#ansbut');
        if (ansBut) {
          const ansBtns = Array.from(ansBut.querySelectorAll('button'));
          if (ansBtns.length >= ratingIdx) {
            ansBtns[ratingIdx - 1].click();
            return true;
          } else if (ansBtns.length > 0) {
            ansBtns[ansBtns.length - 1].click();
            return true;
          }
        }
        return false;
      }, btnText.toLowerCase(), rating).catch(() => false);

      // If we didn't find the buttons visually to click, fall back to pressing the number shortcut
      if (!clickedRating) {
        console.log(`Rating button not clicked visually, using keyboard shortcut ${rating}...`);
        const keyStr = rating.toString();
        await page.keyboard.press(keyStr);
        await new Promise(r => setTimeout(r, 200));
      }

      // Wait a moment for new card to load
      await new Promise(r => setTimeout(r, 1200));
      
      const card = await extractCardText(page, sessionId);
      if (card && (card as any).debugHtml) {
        console.log("=== SCRAPED DECK BUTTON DIAGNOSTICS (RATE) ===");
        console.log("Page URL:", page.url());
        console.log("Raw Button HTML:\n", (card as any).debugHtml);
        console.log("Parsed Buttons:\n", JSON.stringify(card.rateButtons, null, 2));
        console.log("================================================");
      }
      res.json(card);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/study/action
  app.post("/api/study/action", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const { action, value } = req.body;
    const session = sessions[sessionId];
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const { page } = session;
      const timezone = req.headers["x-timezone"] as string || "UTC";
      await page.emulateTimezone(timezone).catch((err: any) => {
        console.warn("Could not emulate timezone on study action:", timezone, err);
      });

      if (action === "undo") {
        const clickedUndo = await page.evaluate(() => {
          function __name(f: any) { return f; }
          const allBtns = Array.from(document.querySelectorAll('button, a, span, div'));
          for (const btn of allBtns) {
            const text = (btn.textContent || "").toLowerCase();
            if (text.trim() === "undo" || text.includes("元に戻す")) {
              (btn as HTMLElement).click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (!clickedUndo) {
          await page.keyboard.down('Control');
          await page.keyboard.press('z');
          await page.keyboard.up('Control');
        }

        await new Promise(r => setTimeout(r, 1200));
        const card = await extractCardText(page, sessionId);
        res.json({ success: true, card });
        return;
      }

      // For mark, flag, suspend, open more options first
      await page.evaluate(() => {
        function __name(f: any) { return f; }
        const allElements = Array.from(document.querySelectorAll('button, a, [role="button"], [class*="more"], [class*="options"]'));
        for (const el of allElements) {
          const text = (el.textContent || "").toLowerCase();
          const id = (el.id || "").toLowerCase();
          const cls = (el.className || "").toLowerCase();
          if (text.includes("more") || text.includes("options") || id.includes("more") || id.includes("options") || cls.includes("more-btn")) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      }).catch(() => {});

      await new Promise(r => setTimeout(r, 600));

      await page.evaluate((act: string, val: string) => {
        function __name(f: any) { return f; }
        const items = Array.from(document.querySelectorAll('button, a, [role="menuitem"], .dropdown-item, .menu-item, span'));
        if (act === "mark") {
          for (const item of items) {
            const text = (item.textContent || "").toLowerCase();
            if (text.includes("mark note") || text.trim() === "mark" || text.includes("マーク")) {
              (item as HTMLElement).click();
              return true;
            }
          }
        } else if (act === "suspend_card" || act === "suspend_note") {
          const keyword = act === "suspend_card" ? "suspend card" : "suspend note";
          const jpKeyword = act === "suspend_card" ? "カードを保留" : "ノートを保留";
          for (const item of items) {
            const text = (item.textContent || "").toLowerCase();
            if (text.includes(keyword) || text.includes(jpKeyword) || (act === "suspend_card" && text.includes("カードの保留")) || (act === "suspend_note" && text.includes("ノートの保留"))) {
              (item as HTMLElement).click();
              return true;
            }
          }
        } else if (act === "flag") {
          for (const item of items) {
            const text = (item.textContent || "").toLowerCase();
            if (val === "none" && (text.includes("clear flag") || text.includes("フラグをクリア"))) {
              (item as HTMLElement).click();
              return true;
            } else if (text.includes(val.toLowerCase())) {
              (item as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      }, action, value || "").catch(() => {});

      await page.click('body').catch(() => {});
      await new Promise(r => setTimeout(r, 1200));

      const card = await extractCardText(page, sessionId);
      res.json({ success: true, card });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/proxy-media
  app.get("/api/proxy-media", async (req, res) => {
    const { url, sessionId } = req.query;
    if (!url || !sessionId) {
      res.status(400).send("Missing parameters");
      return;
    }

    const session = sessions[sessionId as string];
    if (!session) {
      res.status(401).send("Unauthorized");
      return;
    }

    try {
      const { page } = session;
      const cookies = await page.cookies();
      const cookieString = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

      const response = await fetch(url as string, {
        headers: {
          "Cookie": cookieString,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error("Proxy media failed:", e);
      res.status(500).send("Error proxying media");
    }
  });

  async function extractCardText(page: any, sessionId: string) {
    try {
      return await page.evaluate(async (sessId: string) => {
        function __name(f: any) { return f; }
        const qa = document.querySelector('#qa');
        if (!qa) {
          const txt = (document.body.innerText || "").toLowerCase();
          const hasCongrats = txt.includes("congratulations") || txt.includes("congrats") || txt.includes("finished") || txt.includes("おめでとう") || txt.includes("終了") || txt.includes("学習は今のところ終了しました") || txt.includes("no more due cards") || txt.includes("all caught up") || location.href.includes("/decks") || location.href.endsWith("/decks/");
          if (hasCongrats) {
            return { front: "", back: null, finished: true, starred: false, flagColor: null, rateButtons: [], counts: { newCards: 0, learnCards: 0, reviewCards: 0 } };
          }
          return { 
             front: "DEBUG INFO (Please share this text!):\nURL: " + location.href + "\n\n" + (document.body.innerText || "").substring(0, 1500), 
             back: null, 
             finished: false,
             starred: false,
             flagColor: null,
             rateButtons: [],
             counts: { newCards: 0, learnCards: 0, reviewCards: 0 }
             };
        }
        
        // Remove all audio-related elements entirely from the card view
        const audios = Array.from(qa.querySelectorAll('audio, [class*="sound"], [class*="replay"], [id*="sound"], [id*="replay"], [onclick*="play"], [href*=".mp3"], [href*=".wav"]'));
        audios.forEach((el: any) => el.remove());

        // Rewrite all image URLs to go through our proxy with session cookies
        const imgs = Array.from(qa.querySelectorAll('img'));
        for (const img of imgs) {
          const src = img.src; // This is the browser resolved absolute URL!
          if (src && !src.startsWith('data:')) {
            img.setAttribute('src', `/api/proxy-media?url=${encodeURIComponent(src)}&sessionId=${sessId}`);
          }
        }

        let html = qa.innerHTML;
        // Remove style tags
        html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        // Wipe any residual raw [sound:...] texts
        html = html.replace(/\[sound:[^\]]+\]/gi, '');
        
        const showAnswerVisible = Array.from(document.querySelectorAll('button, a, input, [role="button"]')).some(el => {
          const t = (el.textContent || (el as HTMLInputElement).value || "").toLowerCase();
          return t.includes('show answer') || t.includes('解答') || t === 'show' || t.includes('answer');
        });
        const hasAnswerButtons = !showAnswerVisible;
        const parts = html.split(/<hr\s+id=["']?answer["']?[^>]*>/i);
        
        let front = parts[0].trim();
        let back: string | null = null;
        
        if (parts.length > 1) {
          front = parts[0].trim();
          back = parts[1].trim();
        } else if (hasAnswerButtons) {
          // If no <hr id="answer"> is found but the rating buttons are visible, try splitting by any <hr>
          const anyHrSplit = html.split(/<hr[^>]*>/i);
          if (anyHrSplit.length > 1) {
            front = anyHrSplit[0].trim();
            back = anyHrSplit.slice(1).join('<hr>').trim();
          } else {
            // Otherwise, treat whole page as front and force back to be empty string so buttons are shown
            front = html.trim();
            back = "";
          }
        }

        // Scrape metadata
        let starred = false;
        
        // 1. Standard Anki behavior: when a card is marked, Anki adds 'marked' class to #qa, .card, or body
        const isMarkedClass = document.querySelector('#qa.marked, #qa .marked, body.marked, .card.marked, .is-marked, .starred, .is-starred');
        if (isMarkedClass) starred = true;

        // 2. Active or filled star elements in AnkiWeb UI
        if (!starred) {
          const activeStar = document.querySelector('.star.active, .star.filled, .star-icon.active, [class*="star"].active, [class*="star"].filled, [class*="star"].is-active, [class*="star"][aria-pressed="true"], [class*="star"][data-state="on"], .star-active');
          if (activeStar) starred = true;
        }

        // 3. Menu or page text indicating card is currently marked (e.g. "Unmark Note")
        if (!starred) {
          const pageText = (document.body.innerText || "").toLowerCase();
          if (pageText.includes("unmark note") || pageText.includes("unstar note") || pageText.includes("マーク解除") || pageText.includes("★ marked")) {
            starred = true;
          }
        }

        // 4. Filled yellow/gold star SVG
        if (!starred) {
          const starSvgs = Array.from(document.querySelectorAll('svg')).filter(svg => {
            const htmlStr = svg.innerHTML.toLowerCase();
            const classStr = (svg.getAttribute('class') || '').toLowerCase();
            const idStr = (svg.getAttribute('id') || '').toLowerCase();
            return htmlStr.includes('star') || classStr.includes('star') || idStr.includes('star');
          });
          
          for (const svg of starSvgs) {
            const fill = (svg.getAttribute('fill') || svg.style.fill || '').toLowerCase();
            const color = (svg.style.color || '').toLowerCase();
            const parentCls = (svg.parentElement?.getAttribute('class') || '').toLowerCase();
            if ((fill && fill !== 'none' && fill !== 'transparent' && fill !== 'currentColor') || 
                color.includes('yellow') || color.includes('gold') ||
                parentCls.includes('active') || parentCls.includes('marked') || parentCls.includes('filled')) {
              starred = true;
              break;
            }
          }
        }

        let flagColor: string | null = null;
        const flagEl = document.querySelector('[class*="flag-1"], [class*="flag-2"], [class*="flag-3"], [class*="flag-4"], [class*="flag-5"], [class*="flag-6"], [class*="flag-7"], [class*="flag1"], [class*="flag2"], [class*="flag3"], [class*="flag4"], [class*="flag5"], [class*="flag6"], [class*="flag7"]');
        if (flagEl) {
          const cls = (flagEl.getAttribute('class') || '').toLowerCase();
          if (cls.includes('flag-1') || cls.includes('flag1') || cls.includes('red')) flagColor = 'red';
          else if (cls.includes('flag-2') || cls.includes('flag2') || cls.includes('orange')) flagColor = 'orange';
          else if (cls.includes('flag-3') || cls.includes('flag3') || cls.includes('green')) flagColor = 'green';
          else if (cls.includes('flag-4') || cls.includes('flag4') || cls.includes('blue')) flagColor = 'blue';
          else if (cls.includes('flag-5') || cls.includes('flag5') || cls.includes('pink')) flagColor = 'pink';
          else if (cls.includes('flag-6') || cls.includes('flag6') || cls.includes('turquoise')) flagColor = 'turquoise';
          else if (cls.includes('flag-7') || cls.includes('flag7') || cls.includes('purple')) flagColor = 'purple';
        }

        if (!flagColor) {
          const flagSvgs = Array.from(document.querySelectorAll('svg')).filter(svg => {
            const htmlStr = svg.innerHTML.toLowerCase();
            const classStr = (svg.getAttribute('class') || '').toLowerCase();
            const idStr = (svg.getAttribute('id') || '').toLowerCase();
            return htmlStr.includes('flag') || classStr.includes('flag') || idStr.includes('flag');
          });
          for (const flagSvg of flagSvgs) {
            const color = (flagSvg.getAttribute('fill') || flagSvg.getAttribute('stroke') || flagSvg.style.color || flagSvg.style.fill || '').toLowerCase();
            if (color.includes('red') || color.includes('#eb5757') || color.includes('235, 87, 87')) { flagColor = 'red'; break; }
            else if (color.includes('orange') || color.includes('#f2994a') || color.includes('242, 153, 74')) { flagColor = 'orange'; break; }
            else if (color.includes('green') || color.includes('#27ae60') || color.includes('39, 174, 96')) { flagColor = 'green'; break; }
            else if (color.includes('blue') || color.includes('#2f80ed') || color.includes('47, 128, 237')) { flagColor = 'blue'; break; }
            else if (color.includes('pink') || color.includes('#ec4899') || color.includes('236, 72, 153')) { flagColor = 'pink'; break; }
            else if (color.includes('turquoise') || color.includes('#06b6d4') || color.includes('6, 182, 212')) { flagColor = 'turquoise'; break; }
            else if (color.includes('purple') || color.includes('#a855f7') || color.includes('168, 85, 247')) { flagColor = 'purple'; break; }
          }
        }

        const rateButtons: any[] = [];
        const ansBut = document.querySelector('#ansbut');
        
        // Define our ultra-robust interval detection regex
        const intervalRegex = /((?:<|<=|≤|less than\s*)?\d+(?:\.\d+)?\s*(?:mo|min|mins|minute|minutes|day|days|month|months|year|years|sec|secs|second|seconds|hour|hours|week|weeks|分|日|月|年|秒|週|週間|ヶ月|箇月|時間|hr|hrs|wk|wks|m|d|y|s|h|w))(?:\b|\s|$|<)/i;

        if (ansBut) {
          const btns = ansBut.querySelectorAll('button');
          btns.forEach((btn, idx) => {
            const container = btn.closest('td, th, .nobr, div, li') || btn.parentElement || btn;
            const text = btn.textContent || "";
            const containerText = container.textContent || text;
            const nameMatches = text.match(/(again|hard|good|easy|もう一度|もう一回|やり直し|普通|正解|簡単|難しい|難い|難|良好|良|容易|易しい|易)/i) || containerText.match(/(again|hard|good|easy|もう一度|もう一回|やり直し|普通|正解|簡単|難しい|難い|難|良好|良|容易|易しい|易)/i);
            let name = nameMatches ? nameMatches[0] : (idx === 0 ? "Again" : idx === 1 ? "Hard" : idx === 2 ? "Good" : "Easy");
            
            if (/^(again|hard|good|easy)$/i.test(name)) {
              name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            }

            // Robustly extract interval
            let interval = "";
            
            // 1. Try regex extraction first on containerText then text
            const intervalMatch = containerText.match(intervalRegex) || text.match(intervalRegex);
            if (intervalMatch) {
              interval = intervalMatch[1];
            }

            // 2. Try to find an explicit small/span/font/div that represents the time
            if (!interval) {
              const timeEl = container.querySelector('.time, [class*="time"], small, font, span, div') || btn.querySelector('.time, [class*="time"], small, font, span, div');
              if (timeEl && timeEl.textContent) {
                const tText = timeEl.textContent.trim();
                if (tText && tText.toLowerCase() !== name.toLowerCase() && tText.length < 15) {
                  interval = tText;
                }
              }
            }

            // 3. Try examining child nodes of container
            if (!interval && container.childNodes.length > 1) {
              const nodes = Array.from(container.childNodes);
              for (const node of nodes) {
                if (node !== btn) {
                  const nodeText = (node.textContent || node.nodeValue || "").trim();
                  if (nodeText && nodeText.toLowerCase() !== name.toLowerCase() && nodeText.length < 15) {
                    const match = nodeText.match(intervalRegex);
                    if (match) {
                      interval = match[1];
                      break;
                    } else if (!/(again|hard|good|easy|解答|show answer)/i.test(nodeText) && nodeText.length < 12) {
                      interval = nodeText;
                      break;
                    }
                  }
                }
              }
            }

            // 4. Fallback: Parse from splitting
            if (!interval) {
              const parts = containerText.split(/[\s\n\r]+/).map(p => p.trim()).filter(Boolean);
              for (const part of parts) {
                const partLower = part.toLowerCase();
                const nameLower = name.toLowerCase();
                if (partLower !== nameLower && !nameLower.includes(partLower) && !partLower.includes(nameLower) && part.length < 15) {
                  if (/\d/.test(part)) {
                    interval = part;
                    break;
                  }
                }
              }
            }
            
            rateButtons.push({
              index: idx + 1,
              name: name.trim(),
              interval: interval.trim()
            });
          });
        }

        if (rateButtons.length === 0) {
          const btns = Array.from(document.querySelectorAll('button'));
          let bIdx = 1;
          btns.forEach(btn => {
            const container = btn.closest('td, th, .nobr, div, li') || btn.parentElement || btn;
            const text = btn.textContent || "";
            const containerText = container.textContent || text;
            const hasKeyword = /(again|hard|good|easy|もう一度|もう一回|やり直し|普通|正解|簡単|難しい|難い|難|良好|良|容易|易しい|易)/i.test(containerText);
            const hasInterval = intervalRegex.test(containerText);
            
            if (hasKeyword || hasInterval) {
              const nameMatches = text.match(/(again|hard|good|easy|もう一度|もう一回|やり直し|普通|正解|簡単|難しい|難い|難|良好|良|容易|易しい|易)/i) || containerText.match(/(again|hard|good|easy|もう一度|もう一回|やり直し|普通|正解|簡単|難しい|難い|難|良好|良|容易|易しい|易)/i);
              let name = nameMatches ? nameMatches[0] : (bIdx === 1 ? "Again" : bIdx === 2 ? "Hard" : bIdx === 3 ? "Good" : "Easy");
              if (/^(again|hard|good|easy)$/i.test(name)) {
                name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
              }
              
              let interval = "";
              
              // 1. Try regex extraction first
              const intervalMatch = containerText.match(intervalRegex) || text.match(intervalRegex);
              if (intervalMatch) {
                interval = intervalMatch[1];
              }

              // 2. Try to find an explicit small/span/font/div that represents the time
              if (!interval) {
                const timeEl = container.querySelector('.time, [class*="time"], small, font, span, div') || btn.querySelector('.time, [class*="time"], small, font, span, div');
                if (timeEl && timeEl.textContent) {
                  const tText = timeEl.textContent.trim();
                  if (tText && tText.toLowerCase() !== name.toLowerCase() && tText.length < 15) {
                    interval = tText;
                  }
                }
              }

              // 3. Try examining child nodes
              if (!interval && container.childNodes.length > 1) {
                const nodes = Array.from(container.childNodes);
                for (const node of nodes) {
                  if (node !== btn) {
                    const nodeText = (node.textContent || node.nodeValue || "").trim();
                    if (nodeText && nodeText.toLowerCase() !== name.toLowerCase() && nodeText.length < 15) {
                      const match = nodeText.match(intervalRegex);
                      if (match) {
                        interval = match[1];
                        break;
                      } else if (!/(again|hard|good|easy|解答|show answer)/i.test(nodeText) && nodeText.length < 12) {
                        interval = nodeText;
                        break;
                      }
                    }
                  }
                }
              }

              // 4. Fallback: Parse from splitting
              if (!interval) {
                const parts = containerText.split(/[\s\n\r]+/).map(p => p.trim()).filter(Boolean);
                for (const part of parts) {
                  const partLower = part.toLowerCase();
                  const nameLower = name.toLowerCase();
                  if (partLower !== nameLower && !nameLower.includes(partLower) && !partLower.includes(nameLower) && part.length < 15) {
                    if (/\d/.test(part)) {
                      interval = part;
                      break;
                    }
                  }
                }
              }

              rateButtons.push({
                index: bIdx++,
                name: name.trim(),
                interval: interval.trim()
              });
            }
          });
        }
        
        const debugHtml = ansBut ? ansBut.outerHTML : Array.from(document.querySelectorAll('button')).map(b => b.outerHTML).slice(0, 8).join('\n');
        
        let counts = { newCards: 0, learnCards: 0, reviewCards: 0 };
        try {
          const getCleanInt = (el: any) => {
            if (!el) return null;
            const val = parseInt(el.textContent?.replace(/[^\d]/g, '') || "", 10);
            return isNaN(val) ? null : val;
          };

          // Exclude elements inside the card content itself (#qa)
          const isInsideCard = (el: HTMLElement) => {
            return el.closest('#qa');
          };

          // To find counts, we look at all span/b/strong/div/p/a elements outside #qa
          const els = Array.from(document.querySelectorAll('span, b, strong, div, p, a, font')).filter(el => !isInsideCard(el as HTMLElement));

          // Strategy 1: Look for elements with specific Anki classes or color-coded classes outside #qa
          // excluding the top header/navigation area (elements in top 15% of the viewport)
          const findOutsideHeader = (selectors: string[]) => {
            for (const sel of selectors) {
              try {
                const elements = Array.from(document.querySelectorAll(sel)).filter(el => !isInsideCard(el as HTMLElement));
                for (const item of elements) {
                  const rect = item.getBoundingClientRect();
                  if (rect.top < window.innerHeight * 0.15) {
                    continue; // Skip header elements
                  }
                  return item;
                }
              } catch (e) {}
            }
            return null;
          };

          const infoEl = findOutsideHeader(['.text-info', '.text-primary', '.new-count', '[class*="text-info"]', '[class*="text-primary"]', '[class*="new"]']);
          const dangerEl = findOutsideHeader(['.text-danger', '.text-warning', '.learn-count', '[class*="text-danger"]', '[class*="text-warning"]', '[class*="learn"]']);
          const successEl = findOutsideHeader(['.text-success', '.review-count', '.due-count', '[class*="text-success"]', '[class*="review"]', '[class*="due"]']);

          if (infoEl) counts.newCards = getCleanInt(infoEl) ?? 0;
          if (dangerEl) counts.learnCards = getCleanInt(dangerEl) ?? 0;
          if (successEl) counts.reviewCards = getCleanInt(successEl) ?? 0;

          // Strategy 2: Look for elements by computed CSS colors
          if (counts.newCards === 0 && counts.learnCards === 0 && counts.reviewCards === 0) {
            for (const el of els) {
              const text = el.textContent?.trim() || "";
              if (!/^\d+$/.test(text) || text.length > 5) continue;
              const num = parseInt(text, 10);
              if (isNaN(num)) continue;

              const style = window.getComputedStyle(el);
              const color = style.color || "";

              // Parse RGB colors
              const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
              if (rgbMatch) {
                const r = parseInt(rgbMatch[1], 10);
                const g = parseInt(rgbMatch[2], 10);
                const b = parseInt(rgbMatch[3], 10);

                // Blueish / Cyan / Sky
                if (b > 130 && r < 140) {
                  counts.newCards = num;
                }
                // Reddish / Orange / Yellow
                else if (r > 150 && b < 120) {
                  counts.learnCards = num;
                }
                // Greenish
                else if (g > 120 && r < 140 && b < 140) {
                  counts.reviewCards = num;
                }
              }
            }
          }

          // Strategy 3: Horizontal alignment in lower half of screen (layout-based fallback)
          if (counts.newCards === 0 && counts.learnCards === 0 && counts.reviewCards === 0) {
            const numericBottomEls = els.filter(el => {
              const txt = el.textContent?.trim() || "";
              if (!/^\d+$/.test(txt) || txt.length > 5) return false;
              
              // Leaf elements only
              if (el.children.length > 0) {
                const hasNumericChild = Array.from(el.children).some(child => /^\d+$/.test(child.textContent?.trim() || ""));
                if (hasNumericChild) return false;
              }
              
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return false;
              if (rect.top < window.innerHeight * 0.5) return false; // must be in bottom half
              return true;
            });

            // Sort them left-to-right
            numericBottomEls.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
            
            if (numericBottomEls.length >= 3) {
              let bestGroup: any[] = [];
              let minDiff = Infinity;
              
              for (let i = 0; i <= numericBottomEls.length - 3; i++) {
                const group = [numericBottomEls[i], numericBottomEls[i+1], numericBottomEls[i+2]];
                const tops = group.map(el => el.getBoundingClientRect().top);
                const maxTop = Math.max(...tops);
                const minTop = Math.min(...tops);
                const diff = maxTop - minTop;
                
                if (diff < minDiff) {
                  minDiff = diff;
                  bestGroup = group;
                }
              }

              if (bestGroup.length === 3 && minDiff < 30) {
                for (const item of bestGroup) {
                  const txt = item.textContent?.trim() || "";
                  const num = parseInt(txt, 10) || 0;
                  const cls = (item.className || "").toLowerCase();
                  const style = window.getComputedStyle(item);
                  const color = style.color || "";
                  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

                  if (cls.includes('info') || cls.includes('primary') || cls.includes('blue') || (rgbMatch && parseInt(rgbMatch[3]) > 130 && parseInt(rgbMatch[1]) < 140)) {
                    counts.newCards = num;
                  } else if (cls.includes('danger') || cls.includes('warning') || cls.includes('red') || (rgbMatch && parseInt(rgbMatch[1]) > 150 && parseInt(rgbMatch[3]) < 120)) {
                    counts.learnCards = num;
                  } else if (cls.includes('success') || cls.includes('green') || (rgbMatch && parseInt(rgbMatch[2]) > 120 && parseInt(rgbMatch[1]) < 140)) {
                    counts.reviewCards = num;
                  }
                }

                if (counts.newCards === 0 && counts.learnCards === 0 && counts.reviewCards === 0) {
                  counts.newCards = parseInt(bestGroup[0].textContent || "0", 10);
                  counts.learnCards = parseInt(bestGroup[1].textContent || "0", 10);
                  counts.reviewCards = parseInt(bestGroup[2].textContent || "0", 10);
                }
              }
            }
          }

          // Strategy 4: Fallback to searching the innerText of the whole page using regex patterns
          if (counts.newCards === 0 && counts.learnCards === 0 && counts.reviewCards === 0) {
            const pageText = document.body.innerText || "";
            const newM = pageText.match(/(?:new|新規):\s*(\d+)/i);
            const learnM = pageText.match(/(?:learn|学習|途中):\s*(\d+)/i);
            const reviewM = pageText.match(/(?:review|due|復習|期限):\s*(\d+)/i);
            if (newM) counts.newCards = parseInt(newM[1], 10);
            if (learnM) counts.learnCards = parseInt(learnM[1], 10);
            if (reviewM) counts.reviewCards = parseInt(reviewM[1], 10);
          }

          let cardType: "new" | "learn" | "review" | null = null;
          try {
            const checkIsActive = (el: Element | null) => {
              if (!el) return false;
              const htmlEl = el as HTMLElement;
              const cls = (el.className || "").toLowerCase();
              const parentCls = (el.parentElement?.className || "").toLowerCase();
              const tag = el.tagName.toLowerCase();
              const parentTag = el.parentElement?.tagName.toLowerCase();
              const style = window.getComputedStyle(htmlEl);
              
              if (cls.includes('active') || cls.includes('current') || cls.includes('selected') || cls.includes('bold') || cls.includes('underline') ||
                  parentCls.includes('active') || parentCls.includes('current') || parentCls.includes('selected') || parentCls.includes('bold')) {
                return true;
              }
              if (tag === 'b' || tag === 'strong' || tag === 'u' || parentTag === 'b' || parentTag === 'strong' || parentTag === 'u') {
                return true;
              }
              if (style.textDecoration.includes('underline') || style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) {
                return true;
              }
              return false;
            };

            if (checkIsActive(dangerEl)) {
              cardType = "learn";
            } else if (checkIsActive(successEl)) {
              cardType = "review";
            } else if (checkIsActive(infoEl)) {
              cardType = "new";
            }
          } catch (e) {}

          if (!cardType) {
            if (counts.learnCards > 0) cardType = "learn";
            else if (counts.reviewCards > 0) cardType = "review";
            else if (counts.newCards > 0) cardType = "new";
            else cardType = "new";
          }

          return { front, back, finished: false, starred, flagColor, rateButtons, debugHtml, counts, cardType };
        } catch (e) {
          console.error("Error scraping counts:", e);
        }

        return { front, back, finished: false, starred, flagColor, rateButtons, debugHtml, counts, cardType: "new" };
      }, sessionId);
    } catch (e: any) {
       return { front: "Error reading card: " + e.message, back: null, finished: false, starred: false, flagColor: null, rateButtons: [], counts: { newCards: 0, learnCards: 0, reviewCards: 0 } };
    }
  }

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
