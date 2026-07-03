export default function Landing({ onSignup, onLogin }) {
  return (
    <div className="av-container">
      <main className="av-main">
        <div style={{ maxWidth: 640 }}>
          <span className="av-eyebrow">Driving test cancellations</span>
          <h1 className="av-heading-xl">Find an earlier driving test — without the constant refreshing</h1>
          <p className="av-body-l">
            Availo checks for cancellations at your test centre around the clock and lets
            you know the moment one earlier than yours appears. One less thing to worry about.
          </p>

          <div className="av-note">
            <p className="av-body" style={{ margin: 0 }}>
              <strong>Free to use.</strong> We do the watching, so you don't have to keep
              checking the DVSA site yourself.
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
              <p className="av-step__title">We watch, so you don't have to</p>
              <p className="av-body" style={{ marginBottom: 0 }}>Availo checks for cancellations at your chosen centre continuously.</p>
            </div>
          </div>
          <div className="av-step">
            <div className="av-step__number">3</div>
            <div className="av-step__content">
              <p className="av-step__title">Get an instant alert</p>
              <p className="av-body" style={{ marginBottom: 0 }}>The moment a slot earlier than your current test appears, we let you know right away.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
