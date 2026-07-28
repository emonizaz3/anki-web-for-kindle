const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The block between `// Wait for URL change or Study Now button` and `// POST /api/study/rate`
const regex = /      \/\/ Wait for URL change or Study Now button[\s\S]*?\/\/ POST \/api\/study\/rate/;

const replacement = `      // Wait for URL change or Study Now button
      await page.waitForFunction(() => {
        if (!window.location.pathname.endsWith('/decks') && !window.location.pathname.endsWith('/decks/')) return true;
        const els = Array.from(document.querySelectorAll('button, a'));
        return els.some(b => (b.textContent || "").toLowerCase().includes('study now'));
      }, { timeout: 6000 }).catch(() => {});

      await new Promise(r => setTimeout(r, 1000));
      const htmlAfterDeck = await page.content();
      
      // There might be a "Study Now" button
      const allBtns = await page.$$('button, a, input');
      let clickedStudy = false;
      for (const btn of allBtns) {
        const t = await page.evaluate((el: Element) => (el.textContent || (el as HTMLInputElement).value || "").toLowerCase(), btn);
        if (t.includes('study now') || t === 'study' || t.includes('学習')) {
          await btn.click();
          clickedStudy = true;
          break;
        }
      }

      if (clickedStudy) {
        // Wait for the card to render
        await page.waitForFunction(() => document.querySelector('#qa') !== null, { timeout: 4000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
      }

      try {
        await page.waitForSelector('#qa', { timeout: 2000 });
      } catch (e) {
        // Ignore timeout
      }

      // Now we should be on the study page. Get the card.
      const card = await extractCardText(page);
      if (card.front.startsWith("DEBUG")) {
         card.front = "HTML AFTER DECK CLICK:\\n" + htmlAfterDeck.substring(0, 800) + "\\n\\n" + card.front;
      }
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
      
      const allBtns = await page.$$('button, a, input');
      let clickedShowAnswer = false;
      for (const btn of allBtns) {
        const t = await page.evaluate((el: Element) => (el.textContent || (el as HTMLInputElement).value || "").toLowerCase(), btn);
        if (t.includes('show answer') || t.includes('解答') || t === 'show') {
          await btn.click();
          clickedShowAnswer = true;
          break;
        }
      }

      if (!clickedShowAnswer) {
         clickedShowAnswer = await page.evaluate(() => {
            const btn = document.querySelector('button.btn-primary, button.btn-lg, #ansbut, #ansbuta');
            if (btn) {
               (btn as HTMLElement).click();
               return true;
            }
            return false;
         });
      }
      
      if (clickedShowAnswer) {
        // Wait a tiny bit for UI update
        await new Promise(r => setTimeout(r, 500));
      }

      const card = await extractCardText(page);
      res.json(card);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/study/rate`;

code = code.replace(regex, replacement);
fs.writeFileSync('server.ts', code);
console.log("Patched server.ts handlers successfully!");
