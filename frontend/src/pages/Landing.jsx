export default function Landing({ onSignup, onLogin }) {
  return (
    <div className="av-container">
      <main className="av-main">
        <div style={{ maxWidth: 640 }}>
          <span className="av-eyebrow">Driving test cancellations</span>
          <h1 className="av-heading-xl">Find an earlier driving test — without the constant refreshing</h1>
          <p className="av-body-l">
            Availo's browser extension watches the DVSA "change your test" page while you have it open,
            and alerts you the instant an earlier slot appears — then fills your details so you're one
            click from booking.
          </p>

          <div className="av-note">
            <p className="av-body" style={{ margin: 0 }}>
              <strong>Free, and you stay in control.</strong> Availo never books or holds a slot on its
              own — you always make the booking yourself, on the DVSA site.
            </p>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "28px 0 48px" }}>
            <button className="av-btn av-btn--lg" onClick={onSignup}>
              Create a free account
            </button>
            <button className="av-btn av-btn--secondary av-btn--lg" onClick={onLogin}>
              Sign in
            </button>
          </div>

          <h2 className="av-heading-m">How it works</h2>

          <div className="av-step">
            <div className="av-step__number">1</div>
            <div className="av-step__content">
              <p className="av-step__title">Create an account</p>
              <p className="av-body" style={{ marginBottom: 0 }}>Enter your email and choose your test centre and current test date.</p>
            </div>
          </div>
          <div className="av-step">
            <div className="av-step__number">2</div>
            <div className="av-step__content">
              <p className="av-step__title">Install the extension &amp; open DVSA</p>
              <p className="av-body" style={{ marginBottom: 0 }}>Add the Availo browser extension, then open the real DVSA "change your test" page. It watches that page for you.</p>
            </div>
          </div>
          <div className="av-step">
            <div className="av-step__number">3</div>
            <div className="av-step__content">
              <p className="av-step__title">Get alerted &amp; book it yourself</p>
              <p className="av-body" style={{ marginBottom: 0 }}>The instant an earlier slot appears, we alert you (on-screen, by email, or on your phone) and highlight it — you click to book.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
