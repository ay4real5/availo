import { useState } from "react";
import { apiPost } from "../api";

export default function Register({ onSuccess, onLoginClick }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: "" }));
    setServerError("");
  }

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = "Enter your full name";
    if (!form.email.trim()) errs.email = "Enter your email address";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Enter a valid email address";
    if (!form.password) errs.password = "Enter a password";
    else if (form.password.length < 8) errs.password = "Password must be at least 8 characters";
    if (form.password !== form.confirm) errs.confirm = "Passwords do not match";
    return errs;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const data = await apiPost("/api/auth/register", { name: form.name, email: form.email, password: form.password });
      onSuccess(data.user, data.token);
    } catch (err) {
      setServerError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const hasErrors = Object.keys(errors).some((k) => errors[k]);

  return (
    <div className="av-container">
      <main className="av-main">
        <div style={{ maxWidth: 440, margin: "0 auto" }}>
          <div className="av-card">

            {(hasErrors || serverError) && (
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

            <h1 className="av-heading-l">Create your account</h1>

            <form onSubmit={submit} noValidate>
              <div className={`av-form-group${errors.name ? " av-form-group--error" : ""}`}>
                <label className="av-label" htmlFor="name">Full name</label>
                {errors.name && <p className="av-error-message" id="name-error">{errors.name}</p>}
                <input id="name" className="av-input" type="text" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-describedby={errors.name ? "name-error" : undefined} />
              </div>

              <div className={`av-form-group${errors.email ? " av-form-group--error" : ""}`}>
                <label className="av-label" htmlFor="email">Email address</label>
                {errors.email && <p className="av-error-message" id="email-error">{errors.email}</p>}
                <input id="email" className="av-input" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} aria-describedby={errors.email ? "email-error" : undefined} />
              </div>

              <div className={`av-form-group${errors.password ? " av-form-group--error" : ""}`}>
                <label className="av-label" htmlFor="password">Password</label>
                <span className="av-hint">Must be at least 8 characters</span>
                {errors.password && <p className="av-error-message" id="password-error">{errors.password}</p>}
                <input id="password" className="av-input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} aria-describedby={errors.password ? "password-error" : undefined} />
              </div>

              <div className={`av-form-group${errors.confirm ? " av-form-group--error" : ""}`}>
                <label className="av-label" htmlFor="confirm">Confirm password</label>
                {errors.confirm && <p className="av-error-message" id="confirm-error">{errors.confirm}</p>}
                <input id="confirm" className="av-input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} aria-describedby={errors.confirm ? "confirm-error" : undefined} />
              </div>

              <button className="av-btn" style={{ width: "100%", justifyContent: "center" }} type="submit" disabled={loading}>
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>
          </div>

          <p className="av-body" style={{ textAlign: "center", marginTop: 18 }}>
            Already have an account?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onLoginClick(); }}>Sign in</a>
          </p>
        </div>
      </main>
    </div>
  );
}
