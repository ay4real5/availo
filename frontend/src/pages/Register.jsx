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
    <div className="govuk-width-container">
      <main className="govuk-main-wrapper">
        <div style={{ maxWidth: 500 }}>

          {(hasErrors || serverError) && (
            <div className="govuk-error-summary" role="alert">
              <h2 className="govuk-error-summary__title">There is a problem</h2>
              <ul className="govuk-error-summary__list">
                {Object.entries(errors).filter(([, v]) => v).map(([k, v]) => (
                  <li key={k}><a href={`#${k}`}>{v}</a></li>
                ))}
                {serverError && <li>{serverError}</li>}
              </ul>
            </div>
          )}

          <h1 className="govuk-heading-l">Create your account</h1>

          <form onSubmit={submit} noValidate>
            <div className={`govuk-form-group${errors.name ? " govuk-form-group--error" : ""}`}>
              <label className="govuk-label" htmlFor="name">Full name</label>
              {errors.name && <p className="govuk-error-message" id="name-error">{errors.name}</p>}
              <input id="name" className={`govuk-input${errors.name ? " govuk-input--error" : ""}`} type="text" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-describedby={errors.name ? "name-error" : undefined} />
            </div>

            <div className={`govuk-form-group${errors.email ? " govuk-form-group--error" : ""}`}>
              <label className="govuk-label" htmlFor="email">Email address</label>
              {errors.email && <p className="govuk-error-message" id="email-error">{errors.email}</p>}
              <input id="email" className={`govuk-input${errors.email ? " govuk-input--error" : ""}`} type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} aria-describedby={errors.email ? "email-error" : undefined} />
            </div>

            <div className={`govuk-form-group${errors.password ? " govuk-form-group--error" : ""}`}>
              <label className="govuk-label" htmlFor="password">Password</label>
              <span className="govuk-hint">Must be at least 8 characters</span>
              {errors.password && <p className="govuk-error-message" id="password-error">{errors.password}</p>}
              <input id="password" className={`govuk-input${errors.password ? " govuk-input--error" : ""}`} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} aria-describedby={errors.password ? "password-error" : undefined} />
            </div>

            <div className={`govuk-form-group${errors.confirm ? " govuk-form-group--error" : ""}`}>
              <label className="govuk-label" htmlFor="confirm">Confirm password</label>
              {errors.confirm && <p className="govuk-error-message" id="confirm-error">{errors.confirm}</p>}
              <input id="confirm" className={`govuk-input${errors.confirm ? " govuk-input--error" : ""}`} type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} aria-describedby={errors.confirm ? "confirm-error" : undefined} />
            </div>

            <button className="govuk-button" type="submit" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="govuk-body">
            Already have an account?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onLoginClick(); }}>Sign in</a>
          </p>
        </div>
      </main>
    </div>
  );
}
