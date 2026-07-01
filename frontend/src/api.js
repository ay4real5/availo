import axios from "axios";

export async function apiPost(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

export async function apiGet(path, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

export async function apiDelete(path, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { method: "DELETE", headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

// ── Authenticated user helpers ───────────────────────────────────────────────
export const getPaymentMethod = (token) => apiGet("/api/auth/payment-method", token);
export const savePaymentMethod = (card, token) => apiPost("/api/auth/payment-method", card, token);
export const deletePaymentMethod = (token) => apiDelete("/api/auth/payment-method", token);
export const getMyBookings = (token) => apiGet("/api/auth/my-bookings", token);
export const getMyWatchSessions = (token) => apiGet("/api/watch/sessions", token);
export const getMyWatchAlerts = (token) => apiGet("/api/watch/alerts", token);

// ── Admin token (for the protected admin dashboard surface) ──────────────────
const ADMIN_TOKEN_KEY = "availo_admin_token";
export const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY) || "";
export const setAdminToken = (t) => {
  if (t) localStorage.setItem(ADMIN_TOKEN_KEY, t);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
};
export const clearAdminToken = () => localStorage.removeItem(ADMIN_TOKEN_KEY);

const api = axios.create({
  baseURL: "/api",
});

// Attach the admin token to every admin API request when present.
api.interceptors.request.use((config) => {
  const t = getAdminToken();
  if (t) config.headers["x-admin-token"] = t;
  return config;
});

export const health = () => api.get("/health");

export const runScraper = (centre = "Bolton") =>
  api.get("/admin/scrape", { params: { centre } }).then((r) => r.data);

export const getSessions = (params = {}) => api.get("/sessions", { params }).then((r) => r.data);
export const getSummary = () => api.get("/sessions/analytics/summary").then((r) => r.data);
export const flagSession = (id) => api.put(`/sessions/${id}/flag`).then((r) => r.data);

export const getSlots = (params = {}) => api.get("/slots", { params }).then((r) => r.data);
export const getQuarantine = (params = {}) => api.get("/notifications/quarantine", { params }).then((r) => r.data);
export const releaseSlot = (id, reason) => api.post(`/notifications/quarantine/${id}/release`, { reason }).then((r) => r.data);
export const rejectSlot = (id, reason) => api.post(`/notifications/quarantine/${id}/reject`, { reason }).then((r) => r.data);

export const getNotifications = (params = {}) => api.get("/notifications/queue", { params }).then((r) => r.data);
export const sendPending = () => api.post("/notifications/send-pending").then((r) => r.data);

export const getAudit = (params = {}) => api.get("/audit", { params }).then((r) => r.data);

export const getJobs = () => api.get("/scraper/jobs").then((r) => r.data);

export const getControl = () => api.get("/control").then((r) => r.data);
export const setControl = (paused, actor = "dashboard") =>
  api.post("/control", { paused, actor }).then((r) => r.data);

export const runRule = (payload) => api.post("/rules/run", payload).then((r) => r.data);

export const createUser = (email, currentTestDate) =>
  api.post("/users", { email, current_test_date: currentTestDate }).then((r) => r.data);

export default api;
