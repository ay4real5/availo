import { useState } from "react";
import { apiPost } from "../api";

export default function Login({ onSuccess, onRegisterClick }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: "" }));
    setServerError("");
  }

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.email) errs.email = "Enter your email address";
    if (!form.password) errs.password = "Enter your password";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const data = await apiPost("/api/auth/login", { email: form.email.trim().toLowerCase(), password: form.password.trim() });
      onSuccess(data.user, data.token);
    } catch (err) {
      const msg = err?.message || "";
      if (/invalid_credentials|incorrect/i.test(msg)) {
        setServerError("Email or password is incorrect");
      } else if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        setServerError("Could not reach the server. It may be waking up — wait ~30s and try again.");
      } else {
        setServerError(msg || "Sign in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="av-container">
      <main className="av-main">
        <div style={{ maxWidth: 440, margin: "0 auto" }}>
          <div className="av-card">

            {(Object.values(errors).some(Boolean) || serverError) && (
              <div className="av-error-summary" role="alert">
                <h2 className="av-error-summary__title">There is a problem</h2>
                <ul className="av-error-summary__list">
                  {Object.entries(errors).filter(([, v]) => v).map(([k, v]) => (
                    <li key={k}><a href={`#${k}`}>{v}</a></li>
                  ))}
                  {serverError && <li>{serverError}</li>}
                </ul>
              </div>
            )}

            <h1 className="av-heading-l">Welcome back</h1>

            <form onSubmit={submit} noValidate>
              <div className={`av-form-group${errors.email ? " av-form-group--error" : ""}`}>
                <label className="av-label" htmlFor="email">Email address</label>
                {errors.email && <p className="av-error-message">{errors.email}</p>}
                <input id="email" className="av-input" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </div>

              <div className={`av-form-group${errors.password ? " av-form-group--error" : ""}`}>
                <label className="av-label" htmlFor="password">Password</label>
                {errors.password && <p className="av-error-message">{errors.password}</p>}
                <input id="password" className="av-input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </div>

              <button className="av-btn" style={{ width: "100%", justifyContent: "center" }} type="submit" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>

          <p className="av-body" style={{ textAlign: "center", marginTop: 18 }}>
            Don't have an account?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onRegisterClick(); }}>Create a free account</a>
          </p>
        </div>
      </main>
    </div>
  );
}
