const BACKEND_URL = "http://localhost:4000";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SEND_METRICS") {
    fetch(`${BACKEND_URL}/api/sessions/behaviour`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((res) => res.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});
