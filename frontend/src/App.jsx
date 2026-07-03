import { useEffect, useState } from "react";
import "./availo.css";
import Landing from "./pages/Landing";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Preferences from "./pages/Preferences";
import UserDashboard from "./pages/UserDashboard";
import Dashboard from "./components/Dashboard";
import { apiGet } from "./api";

const TOKEN_KEY = "availo_token";

function Mark() {
  return (
    <span className="av-wordmark__mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="2.5" fill="#fff" />
        <path d="M6.5 12a5.5 5.5 0 0 1 11 0" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M3.5 12a8.5 8.5 0 0 1 17 0" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
      </svg>
    </span>
  );
}

function AvHeader({ user, onLogoClick, onSignOut, onAdminClick }) {
  return (
    <header className="av-header">
      <div className="av-container av-header__inner">
        <a
          className="av-wordmark"
          href="#"
          onClick={(e) => { e.preventDefault(); onLogoClick(); }}
        >
          <Mark />
          <span className="av-wordmark__name">Availo</span>
        </a>
        <nav className="av-header__nav" style={{ display: "flex", gap: 18, alignItems: "center" }}>
          {user && (
            <a href="#" onClick={(e) => { e.preventDefault(); onAdminClick(); }}>Admin</a>
          )}
        </nav>
      </div>
    </header>
  );
}

function StatusStrip() {
  return (
    <div className="av-status-strip">
      <div className="av-container">
        <span className="av-tag av-tag--warning">Beta</span>
        We're actively improving Availo — <a href="#">tell us what you think</a>.
      </div>
    </div>
  );
}

function AvFooter() {
  return (
    <footer className="av-footer">
      <div className="av-container">
        <p style={{ margin: 0 }}>Availo helps you find an earlier driving test. Not affiliated with DVSA or GOV.UK.</p>
      </div>
    </footer>
  );
}

export default function App() {
  const [page, setPage] = useState("landing");
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const [prefs, setPrefs] = useState(null);
  const [booting, setBooting] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    if (!token) { setBooting(false); return; }
    async function restore() {
      try {
        const u = await apiGet("/api/auth/me", token);
        setUser(u);
        const p = await apiGet("/api/auth/preferences", token);
        setPrefs(p);
        setPage("dashboard");
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      } finally {
        setBooting(false);
      }
    }
    restore();
  }, []);

  function handleAuthSuccess(u, t) {
    setUser(u);
    setToken(t);
    localStorage.setItem(TOKEN_KEY, t);
    setPage("preferences");
  }

  function handlePrefsSaved(p) {
    setPrefs(p);
    setPage("dashboard");
  }

  function handleSignOut() {
    setUser(null);
    setToken(null);
    setPrefs(null);
    localStorage.removeItem(TOKEN_KEY);
    setPage("landing");
    setShowAdmin(false);
  }

  function handleLogoClick() {
    setShowAdmin(false);
    setPage(user ? "dashboard" : "landing");
  }

  if (booting) {
    return (
      <>
        <AvHeader onLogoClick={handleLogoClick} />
        <StatusStrip />
        <div className="av-container">
          <main className="av-main">
            <p className="av-body">Loading…</p>
          </main>
        </div>
      </>
    );
  }

  if (showAdmin) {
    return (
      <>
        <AvHeader user={user} onLogoClick={handleLogoClick} onSignOut={handleSignOut} onAdminClick={() => setShowAdmin(false)} />
        <StatusStrip />
        <Dashboard />
        <AvFooter />
      </>
    );
  }

  return (
    <>
      <AvHeader user={user} onLogoClick={handleLogoClick} onSignOut={handleSignOut} onAdminClick={() => setShowAdmin(true)} />
      <StatusStrip />

      {page === "landing" && (
        <Landing onSignup={() => setPage("register")} onLogin={() => setPage("login")} />
      )}

      {page === "register" && (
        <Register
          onSuccess={handleAuthSuccess}
          onLoginClick={() => setPage("login")}
        />
      )}

      {page === "login" && (
        <Login
          onSuccess={handleAuthSuccess}
          onRegisterClick={() => setPage("register")}
        />
      )}

      {page === "preferences" && (
        <Preferences
          token={token}
          existingPrefs={prefs}
          onSaved={handlePrefsSaved}
        />
      )}

      {page === "dashboard" && user && (
        <UserDashboard
          user={user}
          token={token}
          prefs={prefs}
          onChangePrefs={() => setPage("preferences")}
          onSignOut={handleSignOut}
        />
      )}

      <AvFooter />
    </>
  );
}
