(() => {
  const BACKEND_URL = "http://localhost:4000";
  const SESSION_KEY = "testi_session_id";
  let sessionId = localStorage.getItem(SESSION_KEY) || crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, sessionId);

  let scrollCount = 0;
  let clickCount = 0;
  let mouseMoveCount = 0;
  let lastFlush = Date.now();

  function flush() {
    const now = Date.now();
    if (now - lastFlush < 5000) return;
    lastFlush = now;

    const payload = {
      session_id: sessionId,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      scroll_count: scrollCount,
      click_count: clickCount,
      mouse_move_count: mouseMoveCount,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };

    chrome.runtime.sendMessage({ type: "SEND_METRICS", payload });
  }

  window.addEventListener("scroll", () => {
    scrollCount += 1;
    flush();
  }, { passive: true });

  window.addEventListener("click", () => {
    clickCount += 1;
    flush();
  }, { passive: true });

  window.addEventListener("mousemove", () => {
    mouseMoveCount += 1;
  }, { passive: true });

  // Flush once when the page unloads.
  window.addEventListener("beforeunload", () => {
    const payload = {
      session_id: sessionId,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      scroll_count: scrollCount,
      click_count: clickCount,
      mouse_move_count: mouseMoveCount,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
    chrome.runtime.sendMessage({ type: "SEND_METRICS", payload });
  });
})();
