export default function Landing({ onSignup, onLogin }) {
  return (
    <>
      <div className="govuk-width-container">
        <main className="govuk-main-wrapper">
          <div style={{ maxWidth: 640 }}>
            <span className="govuk-caption-xl">Driving test cancellations</span>
            <h1 className="govuk-heading-xl">Find an earlier driving test — automatically</h1>
            <p className="govuk-body-l">
              Availo checks the DVSA booking system every few minutes for cancellations that match your test centre. The moment one appears, we alert you instantly.
            </p>

            <div className="govuk-inset-text">
              <p className="govuk-body">
                <strong>Free to use.</strong> We check automatically so you don't have to keep refreshing the DVSA site.
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 40 }}>
              <button className="govuk-button govuk-button--start" onClick={onSignup}>
                Create a free account
                <svg width="17.5" height="19" viewBox="0 0 33 40" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="M0 0h13l20 20-20 20H0l20-20z" />
                </svg>
              </button>
              <button className="govuk-button govuk-button--secondary" onClick={onLogin}>
                Sign in
              </button>
            </div>

            <h2 className="govuk-heading-m">How it works</h2>

            <div className="availo-step">
              <div className="availo-step__number">1</div>
              <div className="availo-step__content">
                <p className="govuk-body"><strong>Create an account</strong><br />Enter your email and choose your test centre and current test date.</p>
              </div>
            </div>
            <div className="availo-step">
              <div className="availo-step__number">2</div>
              <div className="availo-step__content">
                <p className="govuk-body"><strong>We monitor for you</strong><br />Availo checks for cancellations at your chosen centre every few minutes, 24/7.</p>
              </div>
            </div>
            <div className="availo-step">
              <div className="availo-step__number">3</div>
              <div className="availo-step__content">
                <p className="govuk-body"><strong>Get an instant alert</strong><br />The moment a slot earlier than your current test appears, we email you straightaway.</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
