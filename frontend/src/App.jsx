import { useEffect, useState } from "react";
import "./govuk.css";
import Landing from "./pages/Landing";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Preferences from "./pages/Preferences";
import UserDashboard from "./pages/UserDashboard";
import Dashboard from "./components/Dashboard";
import { apiGet } from "./api";

const TOKEN_KEY = "availo_token";

function GovHeader({ user, page, onSignOut, onAdminClick }) {
  return (
    <header className="govuk-header">
      <div className="govuk-width-container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <a className="govuk-header__logotype" href="#" onClick={(e) => { e.preventDefault(); window.location.hash = ""; }}>
            <svg className="govuk-header__logotype-crown" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 97" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M25 30.2c3.5 1.5 7.7-.2 9.1-3.7 1.5-3.6-.2-7.8-3.9-9.2-3.6-1.4-7.6.3-9.1 3.9-1.4 3.5.3 7.5 3.9 9zM9 39.5c3.6 1.5 7.8-.2 9.2-3.7 1.5-3.6-.3-7.8-3.9-9.1-3.6-1.5-7.6.2-9.1 3.8-1.4 3.5.3 7.5 3.8 9zM4.4 57.2c3.5 1.5 7.7-.2 9.1-3.8 1.5-3.6-.2-7.7-3.9-9.1-3.5-1.5-7.6.3-9.1 3.8-1.4 3.5.3 7.6 3.9 9.1zm38.3-21.4c3.5 1.5 7.7-.2 9.1-3.8 1.5-3.6-.2-7.7-3.9-9.1-3.6-1.5-7.6.3-9.1 3.8-1.3 3.6.4 7.7 3.9 9.1zm64.4-5.6c-3.6 1.5-7.8-.2-9.1-3.7-1.5-3.6.2-7.8 3.8-9.2 3.6-1.4 7.7.3 9.2 3.9 1.3 3.5-.4 7.5-3.9 9zm15.9 9.3c-3.6 1.5-7.7-.2-9.1-3.7-1.5-3.6.2-7.8 3.7-9.1 3.6-1.5 7.7.2 9.2 3.8 1.5 3.5-.3 7.5-3.8 9zm4.7 17.7c-3.6 1.5-7.8-.2-9.2-3.8-1.5-3.6.2-7.7 3.9-9.1 3.6-1.5 7.7.3 9.2 3.8 1.3 3.5-.4 7.6-3.9 9.1zM89.3 35.8c-3.6 1.5-7.8-.2-9.2-3.8-1.4-3.6.2-7.7 3.9-9.1 3.6-1.5 7.7.3 9.2 3.8 1.4 3.6-.3 7.7-3.9 9.1zM69.7 17.7l8.9 4.7V9.3l-8.9 2.8c-.2-.3-.5-.6-.9-.9L72.4 0H59.6l3.5 11.2c-.3.3-.6.5-.9.9l-8.8-2.8v13.1l8.8-4.7c.3.3.6.7.9.9l-5 15.4v.1l-3.2 9.7-3.2-9.7v-.1l-5-15.4c.4-.2.7-.6 1-.9zm-2.5 29.5-3.1 10H.8l20.1-25.2 10.5 7.1 16.5-9.5-5.2 17.6h9.3l-5.1-17.6 16.4 9.5 10.5-7.1 20.1 25.2H75.1l-3.1-10h-4.8z"/>
            </svg>
            <span className="govuk-header__product-name">Availo</span>
          </a>
          <nav className="govuk-header__nav">
            {user && <a href="#" onClick={(e) => { e.preventDefault(); onAdminClick(); }}>Admin</a>}
          </nav>
        </div>
      </div>
    </header>
  );
}

function PhaseBanner() {
  return (
    <div className="govuk-phase-banner">
      <div className="govuk-width-container">
        <p>
          <strong className="govuk-phase-banner__tag">Beta</strong>
          This is a new service — your <a href="#">feedback</a> will help us improve it.
        </p>
      </div>
    </div>
  );
}

function GovFooter() {
  return (
    <footer className="govuk-footer">
      <div className="govuk-width-container">
        <p>Built by Availo. Not affiliated with DVSA or GOV.UK.</p>
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

  if (booting) {
    return (
      <>
        <GovHeader />
        <PhaseBanner />
        <div className="govuk-width-container">
          <main className="govuk-main-wrapper">
            <p className="govuk-body">Loading…</p>
          </main>
        </div>
      </>
    );
  }

  if (showAdmin) {
    return (
      <>
        <GovHeader user={user} page="admin" onSignOut={handleSignOut} onAdminClick={() => setShowAdmin(false)} />
        <PhaseBanner />
        <Dashboard />
        <GovFooter />
      </>
    );
  }

  return (
    <>
      <GovHeader user={user} page={page} onSignOut={handleSignOut} onAdminClick={() => setShowAdmin(true)} />
      <PhaseBanner />

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

      <GovFooter />
    </>
  );
}
