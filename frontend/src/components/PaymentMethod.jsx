import { useEffect, useState } from "react";
import { getPaymentMethod, savePaymentMethod, deletePaymentMethod } from "../api";

const BRAND_LABEL = { visa: "Visa", mastercard: "Mastercard", amex: "American Express" };

export default function PaymentMethod({ token }) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ number: "", exp_month: "", exp_year: "", cvc: "", name: "" });

  async function load() {
    try {
      const data = await getPaymentMethod(token);
      setCard(data);
      setEditing(!data);
    } catch {
      setCard(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await savePaymentMethod(
        {
          number: form.number.replace(/\s+/g, ""),
          exp_month: Number(form.exp_month),
          exp_year: Number(form.exp_year),
          cvc: form.cvc,
          name: form.name || null,
        },
        token,
      );
      setForm({ number: "", exp_month: "", exp_year: "", cvc: "", name: "" });
      setEditing(false);
      await load();
    } catch (err) {
      setError(err.message || "Could not save card. Check the details and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this saved card? Auto-booking will stop working until you add a new one.")) return;
    await deletePaymentMethod(token);
    setCard(null);
    setEditing(true);
  }

  if (loading) return <p className="govuk-body">Loading payment details…</p>;

  return (
    <div style={{ marginTop: 40 }}>
      <h2 className="govuk-heading-m">Payment card</h2>
      <p className="govuk-body-s" style={{ color: "#505a5f" }}>
        Used only to secure a slot when auto-booking is on. We store a secure token — never your full card number.
      </p>

      {error && (
        <div className="govuk-error-summary" role="alert">
          <h2 className="govuk-error-summary__title">There is a problem</h2>
          <ul className="govuk-error-summary__list"><li>{error}</li></ul>
        </div>
      )}

      {card && !editing ? (
        <>
          <dl className="govuk-summary-list">
            <div className="govuk-summary-list__row">
              <dt className="govuk-summary-list__key">Card</dt>
              <dd className="govuk-summary-list__value">
                {BRAND_LABEL[card.card_brand] || card.card_brand} ending {card.card_last4}
              </dd>
            </div>
            <div className="govuk-summary-list__row">
              <dt className="govuk-summary-list__key">Expires</dt>
              <dd className="govuk-summary-list__value">{card.card_exp}</dd>
            </div>
          </dl>
          <button className="govuk-button govuk-button--secondary" onClick={() => setEditing(true)}>Replace card</button>{" "}
          <button className="govuk-button govuk-button--warning" onClick={remove}>Remove card</button>
        </>
      ) : (
        <form onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
          <div className="govuk-form-group">
            <label className="govuk-label" htmlFor="card_name">Name on card</label>
            <input id="card_name" className="govuk-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="govuk-form-group">
            <label className="govuk-label" htmlFor="card_number">Card number</label>
            <input
              id="card_number"
              className="govuk-input"
              inputMode="numeric"
              placeholder="4242 4242 4242 4242"
              value={form.number}
              onChange={(e) => set("number", e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div className="govuk-form-group">
              <label className="govuk-label" htmlFor="exp_month">Expiry month</label>
              <input id="exp_month" className="govuk-input govuk-input--width-3" inputMode="numeric" placeholder="MM" value={form.exp_month} onChange={(e) => set("exp_month", e.target.value)} />
            </div>
            <div className="govuk-form-group">
              <label className="govuk-label" htmlFor="exp_year">Expiry year</label>
              <input id="exp_year" className="govuk-input govuk-input--width-4" inputMode="numeric" placeholder="YYYY" value={form.exp_year} onChange={(e) => set("exp_year", e.target.value)} />
            </div>
            <div className="govuk-form-group">
              <label className="govuk-label" htmlFor="cvc">CVC</label>
              <input id="cvc" className="govuk-input govuk-input--width-3" inputMode="numeric" placeholder="123" value={form.cvc} onChange={(e) => set("cvc", e.target.value)} />
            </div>
          </div>
          <button className="govuk-button" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save card"}
          </button>
          {card && (
            <>{" "}<button type="button" className="govuk-button govuk-button--secondary" onClick={() => setEditing(false)}>Cancel</button></>
          )}
        </form>
      )}
    </div>
  );
}
