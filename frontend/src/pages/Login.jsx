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
      const data = await apiPost("/api/auth/login", { email: form.email, password: form.password });
      onSuccess(data.user, data.token);
    } catch (err) {
      setServerError("Email or password is incorrect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="govuk-width-container">
      <main className="govuk-main-wrapper">
        <div style={{ maxWidth: 500 }}>

          {(Object.values(errors).some(Boolean) || serverError) && (
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

          <h1 className="govuk-heading-l">Sign in to Availo</h1>

          <form onSubmit={submit} noValidate>
            <div className={`govuk-form-group${errors.email ? " govuk-form-group--error" : ""}`}>
              <label className="govuk-label" htmlFor="email">Email address</label>
              {errors.email && <p className="govuk-error-message">{errors.email}</p>}
              <input id="email" className={`govuk-input${errors.email ? " govuk-input--error" : ""}`} type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>

            <div className={`govuk-form-group${errors.password ? " govuk-form-group--error" : ""}`}>
              <label className="govuk-label" htmlFor="password">Password</label>
              {errors.password && <p className="govuk-error-message">{errors.password}</p>}
              <input id="password" className={`govuk-input${errors.password ? " govuk-input--error" : ""}`} type="password" autoComplete="current-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
            </div>

            <button className="govuk-button" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="govuk-body">
            Don't have an account?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onRegisterClick(); }}>Create a free account</a>
          </p>
        </div>
      </main>
    </div>
  );
}
