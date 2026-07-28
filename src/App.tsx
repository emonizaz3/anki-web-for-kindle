import React, { useState, useEffect } from "react";

type Deck = {
  id: string;
  name: string;
  newCards: number;
  learnCards: number;
  reviewCards: number;
  dueCards: number;
  totalCards: number;
};

type ViewState = 
  | { name: "LOGIN" }
  | { name: "DASHBOARD" }
  | { name: "DECK"; deck: Deck }
  | { name: "STUDY"; deck: Deck; card: any; remaining: number }
  | { name: "FINISHED"; deck: Deck };

const CLOUD_RUN_BACKEND = "https://ais-dev-hrjixr7pgyykvqipfmixsp-166051209427.asia-east1.run.app";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || CLOUD_RUN_BACKEND).replace(/\/$/, "");

async function safeFetchJson(url: string, options?: RequestInit) {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  let res: Response;
  try {
    res = await fetch(fullUrl, options);
  } catch (err) {
    throw new Error(`Cannot connect to AnkiWeb backend server. If running on Vercel, set VITE_API_BASE_URL in Environment Variables. If running locally, run 'npm run dev'.`);
  }

  if (res.status === 401) {
    return { ok: false, status: 401, data: { error: "Unauthorized" } };
  }

  const text = await res.text();
  if (!text || !text.trim()) {
    throw new Error(`Backend server returned empty response (Status ${res.status}). Make sure server.ts is running.`);
  }

  try {
    const data = JSON.parse(text);
    return { ok: res.ok, status: res.status, data };
  } catch {
    if (res.status === 404) {
      throw new Error(`API Endpoint not found (404). Please run 'git push' to deploy the new serverless API to Vercel.`);
    }
    throw new Error(`Server Error (${res.status}): ${text.slice(0, 120)}`);
  }
}

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem("ankiweb_session"));
  const [view, setView] = useState<ViewState>(() => {
    return localStorage.getItem("ankiweb_session") ? { name: "DASHBOARD" } : { name: "LOGIN" };
  });
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(false);
  const [flashState, setFlashState] = useState<"none" | "black" | "white">("none");
  const [showSettings, setShowSettings] = useState(false);
  const [uiSize, setUiSize] = useState<"small" | "normal" | "large" | "xl">(() => {
    return (localStorage.getItem("ankiweb_ui_size") as any) || "normal";
  });
  const [textSize, setTextSize] = useState<"small" | "normal" | "large" | "xl">(() => {
    return (localStorage.getItem("ankiweb_text_size") as any) || "normal";
  });
  const [timezone, setTimezone] = useState<string>(() => {
    return localStorage.getItem("ankiweb_timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  });

  const changeUiSize = (size: "small" | "normal" | "large" | "xl") => {
    setUiSize(size);
    localStorage.setItem("ankiweb_ui_size", size);
  };

  const changeTextSize = (size: "small" | "normal" | "large" | "xl") => {
    setTextSize(size);
    localStorage.setItem("ankiweb_text_size", size);
  };

  const triggerRefresh = () => {
    setFlashState("black");
    setTimeout(() => {
      setFlashState("white");
      setTimeout(() => {
        setFlashState("none");
      }, 250);
    }, 250);
  };

  useEffect(() => {
    if (view.name === "DASHBOARD" && sessionId) {
      fetchDecks();
    }
  }, [view.name, sessionId]);

  const hasValidCounts = (c: any) => c && (c.newCards > 0 || c.learnCards > 0 || c.reviewCards > 0);

  const fetchDecks = async () => {
    setLoading(true);
    try {
      const { ok, status, data } = await safeFetchJson("/api/decks", {
        headers: { 
          "x-session-id": sessionId!,
          "x-timezone": timezone
        }
      });
      if (status === 401) {
        localStorage.removeItem("ankiweb_session");
        setSessionId(null);
        setView({ name: "LOGIN" });
        return;
      }
      if (Array.isArray(data)) {
        setDecks(data);
      } else {
        setDecks([]);
        if (data && data.error) {
          console.error("Error fetching decks:", data.error);
        }
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const startStudy = async (deck: Deck) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/study/start`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-session-id": sessionId!,
          "x-timezone": timezone
        },
        body: JSON.stringify({ deckId: deck.id })
      });
      const data = await res.json();
      if (!data.finished) {
        const updatedDeck = hasValidCounts(data.counts) ? {
          ...deck,
          newCards: data.counts.newCards,
          learnCards: data.counts.learnCards,
          reviewCards: data.counts.reviewCards,
          dueCards: data.counts.newCards + data.counts.learnCards + data.counts.reviewCards,
        } : deck;
        setDecks(prev => prev.map(d => d.id === deck.id ? updatedDeck : d));
        setView({ name: "STUDY", deck: updatedDeck, card: data, remaining: updatedDeck.dueCards });
      } else {
        setView({ name: "FINISHED", deck });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async (deck: Deck) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/study/reveal`, {
        method: "POST",
        headers: { 
          "x-session-id": sessionId!,
          "x-timezone": timezone
        },
      });
      const data = await res.json();
      const updatedDeck = hasValidCounts(data.counts) ? {
        ...deck,
        newCards: data.counts.newCards,
        learnCards: data.counts.learnCards,
        reviewCards: data.counts.reviewCards,
        dueCards: data.counts.newCards + data.counts.learnCards + data.counts.reviewCards,
      } : deck;
      setDecks(prev => prev.map(d => d.id === deck.id ? updatedDeck : d));
      setView({ name: "STUDY", deck: updatedDeck, card: data, remaining: updatedDeck.dueCards });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (grade: number, deck: Deck) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/study/rate`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-session-id": sessionId!,
          "x-timezone": timezone
        },
        body: JSON.stringify({ rating: grade + 1 }), // 1=Again, 2=Hard, 3=Good, 4=Easy
      });
      const data = await res.json();
      if (!data.finished) {
        const updatedDeck = hasValidCounts(data.counts) ? {
          ...deck,
          newCards: data.counts.newCards,
          learnCards: data.counts.learnCards,
          reviewCards: data.counts.reviewCards,
          dueCards: data.counts.newCards + data.counts.learnCards + data.counts.reviewCards,
        } : deck;
        setDecks(prev => prev.map(d => d.id === deck.id ? updatedDeck : d));
        setView({ name: "STUDY", deck: updatedDeck, card: data, remaining: updatedDeck.dueCards }); // remaining is approx
      } else {
        setView({ name: "FINISHED", deck });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: string, value?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/study/action`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-session-id": sessionId!,
          "x-timezone": timezone
        },
        body: JSON.stringify({ action, value }),
      });
      const data = await res.json();
      if (data.success && data.card) {
        if (!data.card.finished) {
          setView(prev => {
            if (prev.name === "STUDY") {
              const updatedDeck = hasValidCounts(data.card.counts) ? {
                ...prev.deck,
                newCards: data.card.counts.newCards,
                learnCards: data.card.counts.learnCards,
                reviewCards: data.card.counts.reviewCards,
                dueCards: data.card.counts.newCards + data.card.counts.learnCards + data.card.counts.reviewCards,
              } : prev.deck;
              setDecks(decksPrev => decksPrev.map(d => d.id === prev.deck.id ? updatedDeck : d));
              return { ...prev, deck: updatedDeck, card: data.card };
            }
            return prev;
          });
        } else {
          setView(prev => {
            if (prev.name === "STUDY") {
              return { name: "FINISHED", deck: prev.deck };
            }
            return prev;
          });
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`w-full h-screen bg-white text-black font-serif flex flex-col select-none overflow-hidden ui-${uiSize}`}>
      <nav className="h-16 border-b-2 border-black flex items-center justify-between px-4 md:px-8 font-sans uppercase tracking-widest text-sm font-bold shrink-0">
        <div className="flex items-center gap-6">
          {(view.name !== "LOGIN" && view.name !== "DASHBOARD") && (
            <span className="cursor-pointer hover:underline" onClick={() => setView({ name: "DASHBOARD" })}>
              ← Home
            </span>
          )}
          {(view.name === "LOGIN" || view.name === "DASHBOARD") && (
            <span>Kindle Anki</span>
          )}
          {view.name !== "DASHBOARD" && view.name !== "LOGIN" && (
            <>
              <span className="opacity-40 hidden md:inline">|</span>
              <span className="hidden md:inline">Kindle Anki</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {sessionId && (
            <button 
              onClick={async () => {
                setLoading(true);
                try {
                  await fetchDecks();
                  triggerRefresh();
                } catch (err) {
                  console.error(err);
                } finally {
                  setLoading(false);
                }
              }}
              className="border-2 border-black bg-white text-black font-sans px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0"
              style={{ minHeight: "38px" }}
              id="kindle-sync-btn"
            >
              ☁ Sync
            </button>
          )}
          <button 
            onClick={() => setShowSettings(true)}
            className="border-2 border-black bg-white text-black font-sans px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0"
            style={{ minHeight: "38px" }}
            id="kindle-settings-btn"
          >
            ⚙ Settings
          </button>
          <button 
            onClick={triggerRefresh}
            className="border-2 border-black bg-white text-black font-sans px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0"
            style={{ minHeight: "38px" }}
            id="kindle-refresh-btn"
          >
            ↻ Refresh Screen
          </button>
        </div>
      </nav>

      <main className="flex-grow flex flex-col overflow-hidden">
        {loading && (
          <div className="flex-1 flex items-center justify-center text-3xl font-bold italic absolute inset-0 bg-white/80 z-50">
            Loading...
          </div>
        )}

        {view.name === "LOGIN" && (
          <Login timezone={timezone} onLogin={(sid) => { setSessionId(sid); setView({ name: "DASHBOARD" }); }} />
        )}

        {view.name === "DASHBOARD" && !loading && (
          <Dashboard decks={decks} onSelectDeck={(deck) => setView({ name: "DECK", deck })} />
        )}

        {view.name === "DECK" && (
          <DeckMenu 
            deck={view.deck} 
            onStudy={() => startStudy(view.deck)}
          />
        )}

        {view.name === "STUDY" && (
          <StudySession 
            deck={view.deck} 
            card={view.card} 
            onReveal={() => handleReveal(view.deck)}
            onReview={(grade) => handleReview(grade, view.deck)} 
            onAction={handleAction}
            textSize={textSize}
          />
        )}

        {view.name === "FINISHED" && (
          <div className="flex-grow flex flex-col items-center justify-center text-center h-full p-8">
            <h2 className="text-6xl font-bold mb-6">You're all caught up!</h2>
            <p className="mb-12 text-2xl font-sans tracking-widest uppercase opacity-60">No more due cards in this deck.</p>
            <button className="border-2 border-black px-12 py-6 text-2xl font-bold uppercase tracking-widest hover:bg-black hover:text-white" onClick={() => setView({ name: "DASHBOARD" })}>
              Back to Decks
            </button>
          </div>
        )}
      </main>

      <div className="h-6 bg-black text-white flex items-center justify-center shrink-0">
        <span className="text-[10px] font-sans font-bold uppercase tracking-[0.3em]">Kindle Web Browser Interface</span>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-white z-[999] flex flex-col p-6 md:p-12 overflow-y-auto">
          <div className="w-full max-w-2xl mx-auto flex-grow flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-8">
                <h2 className="text-4xl font-bold uppercase tracking-widest font-sans">Settings</h2>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="border-2 border-black bg-black text-white px-6 py-2 text-sm font-bold uppercase tracking-widest hover:bg-white hover:text-black active:invert"
                >
                  ✕ Close
                </button>
              </div>

              {/* UI Size configuration */}
              <div className="mb-8">
                <h3 className="text-2xl font-bold uppercase tracking-widest font-sans mb-4">System UI Size</h3>
                <div className="grid grid-cols-4 gap-2">
                  {(["small", "normal", "large", "xl"] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => changeUiSize(size)}
                      className={`border-2 border-black py-4 font-bold uppercase tracking-wider text-sm ${
                        uiSize === size ? "bg-black text-white" : "bg-white text-black"
                      }`}
                    >
                      {size === "xl" ? "Extra L" : size}
                    </button>
                  ))}
                </div>
                <p className="text-xs opacity-60 mt-2">Adjusts the text size and spacings of menus, navigation, and buttons.</p>
              </div>

              {/* Card Text Size configuration */}
              <div className="mb-8">
                <h3 className="text-2xl font-bold uppercase tracking-widest font-sans mb-4">Anki Card Text Size</h3>
                <div className="grid grid-cols-4 gap-2">
                  {(["small", "normal", "large", "xl"] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => changeTextSize(size)}
                      className={`border-2 border-black py-4 font-bold uppercase tracking-wider text-sm ${
                        textSize === size ? "bg-black text-white" : "bg-white text-black"
                      }`}
                    >
                      {size === "xl" ? "Extra L" : size}
                    </button>
                  ))}
                </div>
                <p className="text-xs opacity-60 mt-2">Adjusts the text size specifically for the card content (front/back).</p>
              </div>

              {/* Timezone configuration */}
              <div className="mb-8">
                <h3 className="text-2xl font-bold uppercase tracking-widest font-sans mb-4">Emulated Timezone</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => {
                      setTimezone(e.target.value);
                      localStorage.setItem("ankiweb_timezone", e.target.value);
                    }}
                    className="flex-grow border-2 border-black p-3 text-lg outline-none font-sans"
                    placeholder="e.g. America/Los_Angeles"
                  />
                  <button
                    onClick={() => {
                      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
                      setTimezone(tz);
                      localStorage.setItem("ankiweb_timezone", tz);
                    }}
                    className="border-2 border-black bg-black text-white px-4 py-2 font-bold uppercase hover:bg-white hover:text-black active:invert shrink-0 text-xs"
                  >
                    Auto Detect
                  </button>
                </div>
                <p className="text-xs opacity-60 mt-2">
                  Used to emulate your local timezone on AnkiWeb so card roll-overs and study schedules align correctly with your local time.
                </p>
              </div>
            </div>

            {/* Logout/Footer section */}
            <div className="border-t-2 border-black pt-8 mt-8 flex flex-col gap-4">
              {sessionId && (
                <button
                  onClick={() => {
                    localStorage.removeItem("ankiweb_session");
                    setSessionId(null);
                    setView({ name: "LOGIN" });
                    setShowSettings(false);
                    triggerRefresh();
                  }}
                  className="w-full border-2 border-red-600 bg-white text-red-600 hover:bg-red-600 hover:text-white py-4 text-xl font-bold uppercase tracking-widest active:invert"
                >
                  Log Out / Switch Account
                </button>
              )}
              <button
                onClick={() => setShowSettings(false)}
                className="w-full bg-black text-white py-4 text-xl font-bold uppercase tracking-widest hover:bg-white hover:text-black active:invert border-2 border-black"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {flashState !== "none" && (
        <div 
          id="kindle-flash-overlay"
          className={`fixed inset-0 z-[99999] transition-none ${
            flashState === "black" ? "bg-black" : "bg-white"
          }`}
        />
      )}
    </div>
  );
}

function Login({ timezone, onLogin }: { timezone: string; onLogin: (sid: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setError("");
    try {
      const { ok, data } = await safeFetchJson("/api/login", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-timezone": timezone
        },
        body: JSON.stringify({ email, password })
      });
      if (ok && data.sessionId) {
        localStorage.setItem("ankiweb_session", data.sessionId);
        onLogin(data.sessionId);
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className="flex-grow flex flex-col items-center justify-center p-8 w-full max-w-2xl mx-auto h-full">
      <h2 className="text-4xl font-bold mb-8 uppercase tracking-widest font-sans border-b-2 border-black pb-2 w-full text-center">AnkiWeb Login</h2>
      <form onSubmit={handleSubmit} className="w-full space-y-8">
        {error && <div className="p-4 border-2 border-black font-bold uppercase">{error}</div>}
        <div>
          <label className="block font-bold mb-2 uppercase tracking-widest font-sans text-xl">Email</label>
          <input 
            type="email" 
            className="border-2 border-black p-6 w-full text-2xl outline-none focus:bg-gray-100 font-sans" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block font-bold mb-2 uppercase tracking-widest font-sans text-xl">Password</label>
          <input 
            type="password"
            className="border-2 border-black p-6 w-full text-2xl outline-none focus:bg-gray-100 font-sans" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loggingIn} className="w-full bg-black text-white border-2 border-black py-4 text-xl font-bold uppercase tracking-widest hover:bg-white hover:text-black disabled:opacity-50">
          {loggingIn ? "Logging in (may take ~10s)..." : "Login"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ decks = [], onSelectDeck }: { decks: Deck[]; onSelectDeck: (d: Deck) => void }) {
  const safeDecks = Array.isArray(decks) ? decks : [];
  return (
    <div className="flex-grow flex flex-col items-center p-8 overflow-y-auto w-full max-w-4xl mx-auto h-full">
      <h2 className="text-4xl font-bold mb-8 uppercase tracking-widest font-sans border-b-2 border-black pb-2 w-full text-center">Your Decks</h2>
      <div className="w-full space-y-4 mb-12">
        {safeDecks.length === 0 && <p className="text-xl text-center italic">No decks found on AnkiWeb.</p>}
        {safeDecks.map((deck, idx) => (
          <div 
            key={idx} 
            className="border-2 border-black p-6 flex flex-col md:flex-row justify-between items-start md:items-center cursor-pointer hover:bg-black hover:text-white group gap-4"
            onClick={() => onSelectDeck(deck)}
          >
            <div>
              <h3 className="text-3xl font-bold">{deck.name}</h3>
              <div className="flex gap-2 text-xs mt-2 font-sans font-bold uppercase tracking-wider">
                <span className="border border-black px-2 py-0.5 bg-black text-white group-hover:bg-white group-hover:text-black transition-none">
                  {deck.newCards || 0} New
                </span>
                <span className="border border-black px-2 py-0.5 bg-gray-100 text-black">
                  {deck.learnCards || 0} Learn
                </span>
                <span className="border border-black px-2 py-0.5 bg-white text-black">
                  {deck.reviewCards || 0} Due
                </span>
              </div>
            </div>
            <div className="text-right font-sans shrink-0">
              <div className="text-sm font-bold uppercase tracking-widest">Select &rarr;</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeckMenu({ deck, onStudy }: { deck: Deck; onStudy: () => void }) {
  return (
    <div className="flex-grow flex flex-col items-center justify-center p-8 text-center h-full">
      <h2 className="text-6xl font-bold mb-4">{deck.name}</h2>
      
      {/* Visual e-ink styled card counts inside deck view */}
      <div className="flex gap-4 text-sm font-sans font-bold uppercase tracking-wider mb-10">
        <span className="border-2 border-black px-4 py-1.5 bg-black text-white">
          {deck.newCards || 0} New
        </span>
        <span className="border-2 border-black px-4 py-1.5 bg-gray-100 text-black">
          {deck.learnCards || 0} Learn
        </span>
        <span className="border-2 border-black px-4 py-1.5 bg-white text-black">
          {deck.reviewCards || 0} Due
        </span>
      </div>

      <div className="flex flex-col gap-6 w-full max-w-md mx-auto mt-4">
        <button className="border-2 border-black py-6 text-3xl font-bold uppercase tracking-widest hover:bg-black hover:text-white" onClick={onStudy}>
          Study Now
        </button>
      </div>
    </div>
  );
}

function getFallbackInterval(btnName: string, index: number) {
  const name = (btnName || "").toLowerCase();
  if (name.includes("again") || name.includes("もう一度") || name.includes("やり直し")) return "< 10m";
  if (name.includes("hard") || name.includes("難しい")) return "1d";
  if (name.includes("good") || name.includes("普通") || name.includes("正解") || name.includes("良")) return "3d";
  if (name.includes("easy") || name.includes("簡単") || name.includes("易")) return "4d";
  if (index === 1) return "< 10m";
  if (index === 2) return "1d";
  if (index === 3) return "3d";
  if (index === 4) return "4d";
  return "";
}

function StudySession({ 
  deck, 
  card, 
  onReveal, 
  onReview, 
  onAction, 
  textSize 
}: { 
  deck: Deck; 
  card: any; 
  onReveal: () => void; 
  onReview: (grade: number) => void; 
  onAction: (action: string, value?: string) => void; 
  textSize: "small" | "normal" | "large" | "xl" 
}) {
  const textSizesMap = {
    small: 28,
    normal: 44,
    large: 60,
    xl: 76,
  };
  const sizePx = textSizesMap[textSize] || 44;

  const counts = {
    newCards: card.counts?.newCards ?? deck.newCards ?? 0,
    learnCards: card.counts?.learnCards ?? deck.learnCards ?? 0,
    reviewCards: card.counts?.reviewCards ?? deck.reviewCards ?? 0,
  };

  let activeCategory: "new" | "learn" | "review" = "new";
  if (card.cardType) {
    const ct = String(card.cardType).toLowerCase();
    if (ct === "learn" || ct === "learning") activeCategory = "learn";
    else if (ct === "review" || ct === "due") activeCategory = "review";
    else if (ct === "new") activeCategory = "new";
  } else if (counts.learnCards > 0) {
    activeCategory = "learn";
  } else if (counts.reviewCards > 0) {
    activeCategory = "review";
  } else if (counts.newCards > 0) {
    activeCategory = "new";
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Kindle E-ink Study Actions Toolbar */}
      <div className="border-b-2 border-black bg-white py-2 px-4 flex flex-wrap gap-2 items-center justify-between font-sans shrink-0">
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={() => onAction("mark")} 
            className={`border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0 ${card.starred ? 'bg-black text-white' : 'bg-white text-black'}`}
            style={{ minHeight: "34px" }}
          >
            ★ {card.starred ? "Starred" : "Star Note"}
          </button>
          
          <div className="relative group">
            <button 
              className="border-2 border-black bg-white text-black px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0"
              style={{ minHeight: "34px" }}
            >
              ⚑ Flag {card.flagColor ? `(${card.flagColor})` : ""} &darr;
            </button>
            <div className="absolute left-0 mt-1 hidden group-hover:flex flex-col bg-white border-2 border-black z-50 p-1 w-40 divide-y divide-black/10 shadow-md">
              {["red", "orange", "green", "blue", "pink", "turquoise", "purple", "none"].map(color => (
                <button
                  key={color}
                  onClick={() => onAction("flag", color)}
                  className="w-full text-left px-3 py-2 text-xs font-bold uppercase hover:bg-black hover:text-white bg-white text-black active:invert transition-none"
                >
                  {color === "none" ? "Clear Flag" : `${color} ■`}
                </button>
              ))}
            </div>
          </div>
          
          <button 
            onClick={() => onAction("suspend_card")} 
            className="border-2 border-black bg-white text-black px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0"
            style={{ minHeight: "34px" }}
          >
            ⊘ Suspend Card
          </button>
          <button 
            onClick={() => onAction("suspend_note")} 
            className="border-2 border-black bg-white text-black px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0"
            style={{ minHeight: "34px" }}
          >
            ⊘ Suspend Note
          </button>
        </div>
        
        <div>
          <button 
            onClick={() => onAction("undo")} 
            className="border-2 border-black bg-white text-black px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-black hover:text-white active:invert transition-none select-none shrink-0"
            style={{ minHeight: "34px" }}
          >
            ↶ Undo last
          </button>
        </div>
      </div>

      {/* Card Counts Sub-Bar */}
      <div className="border-b-2 border-black bg-gray-100 py-2 px-4 flex flex-wrap items-center justify-between font-sans text-xs shrink-0 select-none gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold uppercase tracking-wider text-black/60">Deck:</span>
          <span className="font-bold text-sm">{deck.name}</span>
        </div>
        <div className="flex gap-2 font-bold uppercase tracking-wider items-center">
          <span className={`border-2 border-black px-2.5 py-1 text-xs transition-all flex items-center gap-1 ${
            activeCategory === "new"
              ? "bg-black text-white ring-2 ring-black font-black scale-105 shadow-md"
              : "bg-white text-black opacity-60"
          }`}>
            {activeCategory === "new" && <span className="text-sm">►</span>}
            {counts.newCards} New
          </span>
          <span className={`border-2 border-black px-2.5 py-1 text-xs transition-all flex items-center gap-1 ${
            activeCategory === "learn"
              ? "bg-black text-white ring-2 ring-black font-black scale-105 shadow-md"
              : "bg-white text-black opacity-60"
          }`}>
            {activeCategory === "learn" && <span className="text-sm">►</span>}
            {counts.learnCards} Learn
          </span>
          <span className={`border-2 border-black px-2.5 py-1 text-xs transition-all flex items-center gap-1 ${
            activeCategory === "review"
              ? "bg-black text-white ring-2 ring-black font-black scale-105 shadow-md"
              : "bg-white text-black opacity-60"
          }`}>
            {activeCategory === "review" && <span className="text-sm">►</span>}
            {counts.reviewCards} Due
          </span>
        </div>
      </div>

      <div className="flex-grow flex flex-col items-center justify-start py-6 px-4 md:px-12 overflow-y-auto w-full">
        <div className="text-center w-full max-w-3xl relative border-2 border-black p-6 md:p-12 bg-white flex flex-col justify-center min-h-[350px] my-auto overflow-hidden break-words max-w-full">
          {/* Star indicator shown top-left */}
          <div 
            className="absolute top-4 left-4 flex items-center gap-1 cursor-pointer select-none text-black hover:scale-110 active:scale-95 z-10" 
            onClick={() => onAction("mark")}
          >
            <span className="text-4xl" title="Starred note">
              {card.starred ? "★" : "☆"}
            </span>
          </div>

          {/* Flag indicator shown top-right */}
          {card.flagColor && (
            <div 
              className="absolute top-4 right-4 flex items-center gap-1 select-none font-sans text-xs font-bold uppercase tracking-widest z-10"
            >
              <span 
                style={{
                  color: card.flagColor === "none" ? "inherit" : card.flagColor,
                }}
                className="border border-black px-2 py-0.5 bg-white shadow-sm"
                title={`Flag: ${card.flagColor}`}
              >
                {card.flagColor.toUpperCase()} ■
              </span>
            </div>
          )}

          {card.front && card.front.startsWith("DEBUG") ? (
            <pre className="text-sm text-left overflow-auto whitespace-pre-wrap max-h-[60vh] bg-gray-100 p-4 border border-black">{card.front}</pre>
          ) : (
            <div className="mb-8 card mobile overflow-x-auto max-w-full" style={{ fontSize: `${sizePx}px` }} dangerouslySetInnerHTML={{ __html: card.front }}></div>
          )}
          {card.back !== null && card.back !== "" && (
            <>
              <div className="w-full max-w-xl h-[2px] bg-black mx-auto mb-12 shrink-0"></div>
              <div className="text-center w-full">
                <div className="mb-6 card mobile overflow-x-auto max-w-full" style={{ fontSize: `${sizePx}px` }} dangerouslySetInnerHTML={{ __html: card.back }}></div>
              </div>
            </>
          )}
        </div>
      </div>

      {card.back === null ? (
        <footer className="h-32 border-t-2 border-black bg-white flex shrink-0">
          <div 
            className="flex-1 flex flex-col items-center justify-center hover:bg-black hover:text-white cursor-pointer active:invert"
            onClick={onReveal}
          >
            <span className="text-3xl font-bold uppercase tracking-widest font-sans">Show Answer</span>
          </div>
        </footer>
      ) : (
        <footer className="grid grid-cols-4 h-32 border-t-2 border-black bg-white shrink-0">
          {card.rateButtons && card.rateButtons.length > 0 ? (
            card.rateButtons.map((btn: any) => {
              const displayInterval = (btn.interval && btn.interval.trim() !== "") 
                ? btn.interval 
                : getFallbackInterval(btn.name, btn.index);
              return (
                <div 
                  key={btn.index} 
                  className="flex flex-col items-center justify-center border-r border-black last:border-r-0 hover:bg-black hover:text-white cursor-pointer active:invert" 
                  onClick={() => onReview(btn.index - 1)}
                >
                  <span className="text-xl md:text-2xl font-bold">{btn.name}</span>
                  {displayInterval && (
                    <span className="font-sans text-xs uppercase opacity-60 tracking-wider mt-1">{displayInterval}</span>
                  )}
                </div>
              );
            })
          ) : (
            <>
              <div className="flex flex-col items-center justify-center border-r border-black hover:bg-black hover:text-white cursor-pointer active:invert" onClick={() => onReview(0)}>
                <span className="text-xl md:text-2xl font-bold">Again</span>
                <span className="font-sans text-xs uppercase opacity-60 tracking-wider mt-1">&lt; 1 min</span>
              </div>
              <div className="flex flex-col items-center justify-center border-r border-black hover:bg-black hover:text-white cursor-pointer active:invert" onClick={() => onReview(1)}>
                <span className="text-xl md:text-2xl font-bold">Hard</span>
                <span className="font-sans text-xs uppercase opacity-60 tracking-wider mt-1">1d</span>
              </div>
              <div className="flex flex-col items-center justify-center border-r border-black hover:bg-black hover:text-white cursor-pointer active:invert" onClick={() => onReview(2)}>
                <span className="text-xl md:text-2xl font-bold">Good</span>
                <span className="font-sans text-xs uppercase opacity-60 tracking-wider mt-1">3d</span>
              </div>
              <div className="flex flex-col items-center justify-center hover:bg-black hover:text-white cursor-pointer active:invert" onClick={() => onReview(3)}>
                <span className="text-xl md:text-2xl font-bold">Easy</span>
                <span className="font-sans text-xs uppercase opacity-60 tracking-wider mt-1">4d</span>
              </div>
            </>
          )}
        </footer>
      )}
    </div>
  );
}

