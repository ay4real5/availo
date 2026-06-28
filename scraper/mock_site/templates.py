"""HTML templates for the mock DVSA site."""
from __future__ import annotations


def _base(title: str, body: str, extra_head: str = "") -> str:
    return f"""<!DOCTYPE html>
<html lang="en" class="govuk-template">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{title} - Book your driving test - GOV.UK</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/govuk-frontend@5.4.0/dist/govuk/govuk-frontend.min.css">
  <style>
    .govuk-template {{ background-color: #f3f2f1; }}
    .app-header-logo {{ height: 30px; }}
    .slot-card {{ border: 2px solid #b1b4b6; padding: 15px; margin-bottom: 10px; border-radius: 4px; }}
    .slot-card:hover {{ border-color: #1d70b8; background: #e8f4fa; cursor: pointer; }}
    .slot-card.selected {{ border-color: #00703c; background: #e3f4e3; }}
    .queue-progress {{ font-size: 48px; font-weight: bold; color: #1d70b8; text-align: center; padding: 30px; }}
    .queue-bar {{ height: 12px; background: #b1b4b6; border-radius: 6px; overflow: hidden; margin: 20px 0; }}
    .queue-bar-fill {{ height: 100%; background: #1d70b8; transition: width 1s ease; }}
    .status-box {{ padding: 20px; border-left: 5px solid #1d70b8; background: #e8f4fa; margin-bottom: 20px; }}
    .confirmation-panel {{ background: #00703c; color: white; padding: 30px; text-align: center; border-radius: 4px; margin-bottom: 30px; }}
    .confirmation-panel h1 {{ color: white; }}
    .mock-warning {{ background: #fff7bf; border-left: 5px solid #ffdd00; padding: 10px 15px; margin-bottom: 20px; font-size: 14px; }}
  </style>
  {extra_head}
</head>
<body class="govuk-template__body">
  <script>document.body.className = ((document.body.className) ? document.body.className + ' js-enabled' : 'js-enabled');</script>
  <a href="#main-content" class="govuk-skip-link" data-module="govuk-skip-link">Skip to main content</a>

  <header class="govuk-header" role="banner" data-module="govuk-header">
    <div class="govuk-header__container govuk-width-container">
      <div class="govuk-header__logo">
        <a href="/" class="govuk-header__link govuk-header__link--homepage">
          <svg focusable="false" role="img" class="govuk-header__logotype" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 148 30" height="30" width="148" aria-label="GOV.UK">
            <title>GOV.UK</title>
            <path d="M22.6 10.4c-1 .4-2 .8-3.1 1.1 .9 1.2 2 2.5 3.1 3.7 1.3-1.1 2.3-2.4 2.9-3.8-1-.3-2-.7-2.9-1zm-3.6.7c-1 .3-2.1.5-3.2.6 .7 1.2 1.7 2.4 2.8 3.6 1.1-1.1 2-2.3 2.7-3.5-1-.2-1.6-.5-2.3-.7zm-4.3.4c-1.1 0-2.2-.1-3.3-.3 .5 1.2 1.3 2.4 2.3 3.6 .9-.9 1.9-2 2.5-3.1-.5 0-1-.1-1.5-.2zm-4.4-.7c-1.1-.3-2.1-.8-3-1.3 .3 1.4 1 2.7 1.9 3.9 .7-.6 1.5-1.4 2.1-2.2-.3-.1-.7-.3-1-.4zm16.4 4.6c-.8 1.5-2 2.9-3.5 4.1 1.2.3 2.4.4 3.6.4-.1-1.5-.2-3-.1-4.5zm-21.1.1c0 1.5.1 3 .4 4.4 1.1-.1 2.3-.3 3.4-.6-1.4-1.2-2.7-2.5-3.8-3.8zm10.6 7.4c-1.3-.8-2.6-1.7-3.8-2.8-.9 1.5-1.4 3.1-1.5 4.7 1.7.3 3.5.5 5.3.4v-2.3zm4.5 0v2.4c1.8 0 3.6-.2 5.3-.5-.2-1.7-.7-3.2-1.5-4.7-1.2 1-2.5 2-3.8 2.8zM12 21.1c-1.5-1.5-2.7-3.2-3.6-5.1-.6.4-1.1.9-1.6 1.4C8 19.1 9.9 20.5 12 21.1zm7.9 0c2.1-.6 4-2 5.2-3.7-.5-.5-1-.9-1.6-1.4-.9 1.9-2.1 3.6-3.6 5.1zM1.4 7.8C.5 9.3 0 11 0 12.8c0 2.4.8 4.7 2.3 6.5L1.4 7.8zm22.9 0l-1 11.5c1.5-1.8 2.3-4.1 2.3-6.5-.1-1.8-.6-3.5-1.3-5zm-11.5 1c0-2.2-1.8-4-4-4S4.8 6.6 4.8 8.8s1.8 4 4 4 4-1.8 4-4zm9.4 0c0-2.2-1.8-4-4-4s-4 1.8-4 4 1.8 4 4 4 4-1.8 4-4z" fill="currentColor"></path>
          </svg>
          <span class="govuk-header__logotype-text">GOV.UK</span>
        </a>
      </div>
      <div class="govuk-header__content">
        <a href="/" class="govuk-header__link govuk-header__service-name">Book your driving test</a>
      </div>
    </div>
  </header>

  <div class="govuk-width-container">
    <main class="govuk-main-wrapper" id="main-content" role="main">
      <div class="mock-warning">
        ⚠️ <strong>MOCK SITE</strong> — This is a simulated DVSA booking site for development and testing. No real bookings are made.
      </div>
      {body}
    </main>
  </div>

  <footer class="govuk-footer">
    <div class="govuk-width-container">
      <div class="govuk-footer__meta">
        <div class="govuk-footer__meta-item govuk-footer__meta-item--grow">
          <ul class="govuk-footer__inline-list">
            <li class="govuk-footer__inline-list-item"><a class="govuk-footer__link" href="/analytics">Site analytics (mock)</a></li>
          </ul>
          <svg aria-hidden="true" focusable="false" class="govuk-footer__licence-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 483.2 195.7" height="17" width="41"><path fill="currentColor" d="M421.5 142.8V.1l-50.7 32.3v161.1h112.4v-50.7zm-122.3-9.6A47.12 47.12 0 0 1 221 97.8c0-26 21.1-47.1 47.1-47.1 16.7 0 31.4 8.7 39.7 21.8l42.7-27.2A97.63 97.63 0 0 0 268.1 0c-36.5 0-68.3 20.1-85.1 49.7A98 98 0 0 0 97.8 0C43.9 0 0 43.9 0 97.8s43.9 97.8 97.8 97.8c36.5 0 68.3-20.1 85.1-49.7a97.76 97.76 0 0 0 149.6 25.4l19.4 22.2h3v-87.8h-80l24.3 27.5zM97.8 145c-26 0-47.1-21.1-47.1-47.1s21.1-47.1 47.1-47.1 47.2 21 47.2 47S123.8 145 97.8 145"/></svg>
          <span class="govuk-footer__licence-description">All content is available under the <a class="govuk-footer__link" href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" rel="license">Open Government Licence v3.0</a>, except where otherwise stated</span>
        </div>
        <div class="govuk-footer__meta-item"><a class="govuk-footer__link govuk-footer__copyright-logo" href="https://www.nationalarchives.gov.uk/information-management/re-using-public-sector-information/uk-government-licensing-framework/crown-copyright/">© Crown copyright</a></div>
      </div>
    </div>
  </footer>
  <script src="https://cdn.jsdelivr.net/npm/govuk-frontend@5.4.0/dist/govuk/govuk-frontend.min.js"></script>
  <script>window.GOVUKFrontend.initAll()</script>
</body>
</html>"""


def page_home() -> str:
    body = """
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <h1 class="govuk-heading-xl">Book your official driving test</h1>
        <p class="govuk-body-l">Use this service to book, change or cancel your car driving test.</p>

        <div class="govuk-inset-text">
          You need your <strong>UK driving licence number</strong> and a <strong>payment card</strong>.
        </div>

        <p class="govuk-body">The test costs <strong>£62</strong> for a weekday test.</p>

        <ul class="govuk-list govuk-list--bullet">
          <li>You must give at least 3 clear working days' notice to cancel or change</li>
          <li>You can book up to 6 months in advance</li>
          <li>Tests are available at over 200 test centres across Great Britain</li>
        </ul>

        <a href="/queue" role="button" draggable="false" class="govuk-button govuk-button--start" data-module="govuk-button">
          Start now
          <svg class="govuk-button__start-icon" xmlns="http://www.w3.org/2000/svg" width="17.5" height="19" viewBox="0 0 33 40" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M0 0h13l20 20-20 20H0l20-20z"/>
          </svg>
        </a>

        <h2 class="govuk-heading-m">Before you start</h2>
        <p class="govuk-body">You also need your theory test pass certificate number if your theory test pass is more than 2 years old.</p>

        <details class="govuk-details">
          <summary class="govuk-details__summary">
            <span class="govuk-details__summary-text">What happens if the site is busy</span>
          </summary>
          <div class="govuk-details__text">
            <p>If many people are using this service at once, you may have to wait in a queue before you can book. You will be shown your position in the queue and roughly how long you will wait.</p>
          </div>
        </details>
      </div>

      <div class="govuk-grid-column-one-third">
        <div class="govuk-panel govuk-panel--confirmation" style="background:#1d70b8;margin-top:0">
          <h2 class="govuk-panel__title" style="font-size:1.2rem">Opening hours</h2>
          <div class="govuk-panel__body" style="font-size:0.9rem">
            Mon–Sat: 6am – 9:30pm<br>
            Sun: 11am – 5:30pm<br>
            Bank holidays: closed
          </div>
        </div>
      </div>
    </div>"""
    return _base("Book your driving test", body)


def page_queue(position: int, token: str, estimated_seconds: int) -> str:
    percent = max(5, 100 - int((position / max(position, 1)) * 100)) if position > 0 else 100
    status_msg = "You are next in the queue." if position == 1 else f"There are {position} people ahead of you."
    if position == 0:
        status_msg = "You are being redirected to sign in..."

    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <h1 class="govuk-heading-xl">You are in the queue</h1>

        <div class="status-box">
          <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-1">Queue position</p>
          <div class="queue-progress" id="position-display">{"Next" if position <= 1 else position}</div>
          <div class="queue-bar"><div class="queue-bar-fill" id="queue-bar" style="width:{percent}%"></div></div>
          <p class="govuk-body" id="status-msg">{status_msg}</p>
          <p class="govuk-body govuk-!-font-size-16">Estimated wait: <strong id="est-wait">{estimated_seconds}</strong> seconds</p>
        </div>

        <div class="govuk-warning-text">
          <span class="govuk-warning-text__icon" aria-hidden="true">!</span>
          <strong class="govuk-warning-text__text">
            <span class="govuk-visually-hidden">Warning</span>
            Do not close or refresh this page — you will lose your place in the queue.
          </strong>
        </div>

        <p class="govuk-body">This page will automatically move you forward when it is your turn.</p>
      </div>
    </div>

    <script>
      const token = "{token}";
      let position = {position};
      let pollInterval = 2000;

      function poll() {{
        fetch("/queue/status?token=" + token)
          .then(r => r.json())
          .then(data => {{
            position = data.position;
            const total = {max(position, 1)};
            const pct = position === 0 ? 100 : Math.max(5, 100 - Math.round((position / total) * 100));
            document.getElementById("position-display").textContent = position <= 1 && position > 0 ? "Next" : (position === 0 ? "✓" : position);
            document.getElementById("queue-bar").style.width = pct + "%";
            document.getElementById("est-wait").textContent = Math.round(position * 1.5);

            if (data.allowed || position === 0) {{
              document.getElementById("status-msg").textContent = "Your turn! Taking you to sign in...";
              document.getElementById("position-display").textContent = "✓";
              document.getElementById("queue-bar").style.background = "#00703c";
              setTimeout(() => {{ window.location.href = "/login?token=" + token; }}, 1200);
            }} else {{
              document.getElementById("status-msg").textContent = position === 1 ? "You are next in the queue." : "There are " + position + " people ahead of you.";
              setTimeout(poll, pollInterval);
            }}
          }})
          .catch(() => setTimeout(poll, 4000));
      }}

      {("setTimeout(poll, 2000);" if position > 0 else "setTimeout(() => { window.location.href = '/login?token=' + token; }, 800);")}
    </script>"""
    return _base("Waiting room", body)


def page_login(token: str, error: str = "") -> str:
    error_html = f"""
    <div class="govuk-error-summary" data-module="govuk-error-summary">
      <div role="alert">
        <h2 class="govuk-error-summary__title">There is a problem</h2>
        <div class="govuk-error-summary__body">
          <ul class="govuk-list govuk-error-summary__list">
            <li><a href="#licence">{error}</a></li>
          </ul>
        </div>
      </div>
    </div>""" if error else ""

    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <h1 class="govuk-heading-xl">Enter your details</h1>
        {error_html}
        <form method="POST" action="/login" novalidate>
          <input type="hidden" name="queue_token" value="{token}">

          <div class="govuk-form-group {'govuk-form-group--error' if error else ''}">
            <label class="govuk-label govuk-label--m" for="licence">
              UK driving licence number
            </label>
            <div id="licence-hint" class="govuk-hint">
              For example, MORGA657054SM9IJ — 16 characters, on the front of your licence
            </div>
            {'<p id="licence-error" class="govuk-error-message"><span class="govuk-visually-hidden">Error:</span> ' + error + '</p>' if error else ''}
            <input class="govuk-input {'govuk-input--error' if error else ''}" id="licence" name="license_number" type="text" spellcheck="false" autocomplete="off" aria-describedby="licence-hint{'licence-error' if error else ''}">
          </div>

          <div class="govuk-form-group">
            <label class="govuk-label govuk-label--m" for="dob">
              Date of birth
            </label>
            <div class="govuk-hint">For example, 31 3 1980</div>
            <div class="govuk-date-input" id="dob">
              <div class="govuk-date-input__item">
                <div class="govuk-form-group">
                  <label class="govuk-label" for="dob-day">Day</label>
                  <input class="govuk-input govuk-date-input__input govuk-input--width-2" id="dob-day" name="dob_day" type="text" inputmode="numeric">
                </div>
              </div>
              <div class="govuk-date-input__item">
                <div class="govuk-form-group">
                  <label class="govuk-label" for="dob-month">Month</label>
                  <input class="govuk-input govuk-date-input__input govuk-input--width-2" id="dob-month" name="dob_month" type="text" inputmode="numeric">
                </div>
              </div>
              <div class="govuk-date-input__item">
                <div class="govuk-form-group">
                  <label class="govuk-label" for="dob-year">Year</label>
                  <input class="govuk-input govuk-date-input__input govuk-input--width-4" id="dob-year" name="dob_year" type="text" inputmode="numeric">
                </div>
              </div>
            </div>
          </div>

          <button type="submit" class="govuk-button" data-module="govuk-button">Continue</button>
        </form>
      </div>
    </div>"""
    return _base("Sign in", body)


def page_search(session_token: str, error: str = "") -> str:
    centres = [
        "Bolton", "Birmingham (Kingstanding)", "Bristol (Brislington)", "Cardiff (Llanishen)",
        "Edinburgh (Currie)", "Glasgow (Shieldhall)", "Leeds (Gipton)", "Liverpool (Walton)",
        "London (Belvedere)", "London (Chiswick)", "Manchester (Didsbury)", "Newcastle upon Tyne (Gosforth)",
        "Nottingham (Chilwell)", "Sheffield (Middlewood)", "Southampton (Hedge End)",
    ]
    options = "\n".join(f'<option value="{c}">{c}</option>' for c in centres)
    error_html = f"""
    <div class="govuk-error-summary" data-module="govuk-error-summary">
      <div role="alert">
        <h2 class="govuk-error-summary__title">There is a problem</h2>
        <div class="govuk-error-summary__body"><ul class="govuk-list govuk-error-summary__list"><li>{error}</li></ul></div>
      </div>
    </div>""" if error else ""

    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <h1 class="govuk-heading-xl">Find available test dates</h1>
        {error_html}
        <form method="POST" action="/search-results" novalidate>
          <input type="hidden" name="session_token" value="{session_token}">

          <div class="govuk-form-group">
            <label class="govuk-label govuk-label--m" for="centre">Test centre</label>
            <div class="govuk-hint">Choose a test centre near you</div>
            <select class="govuk-select" id="centre" name="centre">
              <option value="">Select a centre</option>
              {options}
            </select>
          </div>

          <div class="govuk-form-group">
            <label class="govuk-label govuk-label--m" for="from_date">Earliest date</label>
            <div class="govuk-hint">For example, 2025-08-01</div>
            <input class="govuk-input govuk-input--width-10" id="from_date" name="from_date" type="date">
          </div>

          <div class="govuk-form-group">
            <label class="govuk-label govuk-label--m" for="to_date">Latest date</label>
            <input class="govuk-input govuk-input--width-10" id="to_date" name="to_date" type="date">
          </div>

          <button type="submit" class="govuk-button">Search</button>
        </form>
      </div>
    </div>"""
    return _base("Find a test date", body)


def page_results(slots: list, centre: str, session_token: str) -> str:
    if not slots:
        slots_html = """
        <div class="govuk-inset-text">
          No tests are available at this centre in your selected date range.
          <a href="/search" class="govuk-link">Try different dates or a different centre</a>.
        </div>"""
    else:
        cards = ""
        for s in slots[:20]:
            dt = s["datetime"]
            try:
                from datetime import datetime as _dt
                parsed = _dt.fromisoformat(dt.replace("Z", "+00:00"))
                friendly = parsed.strftime("%A %d %B %Y at %I:%M %p")
            except Exception:
                friendly = dt
            cards += f"""
            <div class="slot-card">
              <form method="POST" action="/book-confirm">
                <input type="hidden" name="session_token" value="{session_token}">
                <input type="hidden" name="slot_id" value="{s['id']}">
                <input type="hidden" name="slot_datetime" value="{dt}">
                <input type="hidden" name="centre" value="{centre}">
                <div class="govuk-grid-row">
                  <div class="govuk-grid-column-two-thirds">
                    <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-1">{friendly}</p>
                    <p class="govuk-body-s govuk-!-margin-bottom-0 govuk-!-color-secondary">{centre}</p>
                  </div>
                  <div class="govuk-grid-column-one-third" style="text-align:right;padding-top:8px">
                    <button type="submit" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0">Select</button>
                  </div>
                </div>
              </form>
            </div>"""
        slots_html = f"""
        <p class="govuk-body">Found <strong>{len(slots)}</strong> available test{"s" if len(slots) != 1 else ""} at <strong>{centre}</strong>.</p>
        {cards}
        {"<p class='govuk-body govuk-!-font-size-16'>Showing first 20 results. <a href='/search' class='govuk-link'>Search again</a> to narrow down.</p>" if len(slots) > 20 else ""}"""

    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-full">
        <a href="/search" class="govuk-back-link">Back</a>
        <h1 class="govuk-heading-xl">Available tests at {centre}</h1>
        {slots_html}
      </div>
    </div>"""
    return _base("Available tests", body)


def page_book_confirm(slot_id: str, slot_datetime: str, centre: str, session_token: str) -> str:
    try:
        from datetime import datetime as _dt
        parsed = _dt.fromisoformat(slot_datetime.replace("Z", "+00:00"))
        friendly = parsed.strftime("%A %d %B %Y at %I:%M %p")
    except Exception:
        friendly = slot_datetime

    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <a href="javascript:history.back()" class="govuk-back-link">Back</a>
        <h1 class="govuk-heading-xl">Confirm your test booking</h1>

        <dl class="govuk-summary-list">
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Test centre</dt>
            <dd class="govuk-summary-list__value">{centre}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Date and time</dt>
            <dd class="govuk-summary-list__value">{friendly}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Test fee</dt>
            <dd class="govuk-summary-list__value">£62.00</dd>
          </div>
        </dl>

        <div class="govuk-warning-text">
          <span class="govuk-warning-text__icon" aria-hidden="true">!</span>
          <strong class="govuk-warning-text__text">
            <span class="govuk-visually-hidden">Warning</span>
            You have 10 minutes to complete payment before this slot is released.
          </strong>
        </div>

        <form method="POST" action="/payment-page">
          <input type="hidden" name="session_token" value="{session_token}">
          <input type="hidden" name="slot_id" value="{slot_id}">
          <input type="hidden" name="slot_datetime" value="{slot_datetime}">
          <input type="hidden" name="centre" value="{centre}">
          <button type="submit" class="govuk-button">Continue to payment</button>
        </form>
      </div>
    </div>"""
    return _base("Confirm your booking", body)


def page_payment(booking_ref: str, slot_datetime: str, centre: str, session_token: str) -> str:
    try:
        from datetime import datetime as _dt
        parsed = _dt.fromisoformat(slot_datetime.replace("Z", "+00:00"))
        friendly = parsed.strftime("%A %d %B %Y at %I:%M %p")
    except Exception:
        friendly = slot_datetime

    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <h1 class="govuk-heading-xl">Pay for your test</h1>

        <div class="govuk-inset-text">
          Booking <strong>{booking_ref}</strong> — {centre} — {friendly}
        </div>

        <form method="POST" action="/payment-submit">
          <input type="hidden" name="session_token" value="{session_token}">
          <input type="hidden" name="booking_reference" value="{booking_ref}">

          <div class="govuk-form-group">
            <label class="govuk-label govuk-label--m" for="card-number">Card number</label>
            <input class="govuk-input govuk-input--width-20" id="card-number" name="card_number" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456">
          </div>

          <div class="govuk-grid-row">
            <div class="govuk-grid-column-one-half">
              <div class="govuk-form-group">
                <label class="govuk-label govuk-label--m" for="expiry">Expiry date</label>
                <div class="govuk-hint">For example, 06/27</div>
                <input class="govuk-input govuk-input--width-5" id="expiry" name="expiry" type="text" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY">
              </div>
            </div>
            <div class="govuk-grid-column-one-half">
              <div class="govuk-form-group">
                <label class="govuk-label govuk-label--m" for="cvv">Security code</label>
                <div class="govuk-hint">The last 3 digits on the back of the card</div>
                <input class="govuk-input govuk-input--width-4" id="cvv" name="cvv" type="text" inputmode="numeric" autocomplete="cc-csc" placeholder="123">
              </div>
            </div>
          </div>

          <div class="govuk-form-group">
            <label class="govuk-label govuk-label--m" for="name-on-card">Name on card</label>
            <input class="govuk-input" id="name-on-card" name="name_on_card" type="text" autocomplete="cc-name">
          </div>

          <p class="govuk-body govuk-!-font-size-16">Payment of <strong>£62.00</strong> will be taken immediately.</p>

          <button type="submit" class="govuk-button">Pay £62.00</button>
        </form>
      </div>

      <div class="govuk-grid-column-one-third">
        <div style="border:1px solid #b1b4b6;padding:15px;margin-top:10px">
          <h2 class="govuk-heading-s">Your booking summary</h2>
          <p class="govuk-body-s"><strong>Centre:</strong> {centre}</p>
          <p class="govuk-body-s"><strong>Date:</strong> {friendly}</p>
          <p class="govuk-body-s govuk-!-margin-bottom-0"><strong>Fee:</strong> £62.00</p>
        </div>
      </div>
    </div>"""
    return _base("Pay for your driving test", body)


def page_confirmation(booking: dict) -> str:
    try:
        from datetime import datetime as _dt
        parsed = _dt.fromisoformat(booking["datetime"].replace("Z", "+00:00"))
        friendly = parsed.strftime("%A %d %B %Y at %I:%M %p")
    except Exception:
        friendly = booking.get("datetime", "")

    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <div class="confirmation-panel">
          <h1 class="govuk-panel__title">Booking confirmed</h1>
          <div class="govuk-panel__body">
            Your booking reference<br>
            <strong style="font-size:28px;letter-spacing:2px">{booking["booking_reference"]}</strong>
          </div>
        </div>

        <p class="govuk-body">We have sent your confirmation to the email address you used to register.</p>

        <h2 class="govuk-heading-m">What you booked</h2>
        <dl class="govuk-summary-list">
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Test centre</dt>
            <dd class="govuk-summary-list__value">{booking["centre"]}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Date and time</dt>
            <dd class="govuk-summary-list__value">{friendly}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Booking reference</dt>
            <dd class="govuk-summary-list__value">{booking["booking_reference"]}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Amount paid</dt>
            <dd class="govuk-summary-list__value">£62.00</dd>
          </div>
        </dl>

        <h2 class="govuk-heading-m">What happens next</h2>
        <ul class="govuk-list govuk-list--bullet">
          <li>You will receive a confirmation email with your booking details</li>
          <li>Make sure you bring your driving licence on the day</li>
          <li>Arrive 15 minutes before your test</li>
          <li>You can change or cancel up to 3 clear working days before your test</li>
        </ul>

        <p class="govuk-body">
          <a href="/" class="govuk-link">Book another test</a>
        </p>
      </div>
    </div>"""
    return _base("Booking confirmed", body)


def page_error(title: str, message: str, back_url: str = "/") -> str:
    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-two-thirds">
        <h1 class="govuk-heading-xl">{title}</h1>
        <p class="govuk-body">{message}</p>
        <a href="{back_url}" class="govuk-button">Go back</a>
      </div>
    </div>"""
    return _base(title, body)


def page_analytics(stats: dict, flagged_ips: list, sessions_count: int, queue_length: int) -> str:
    rows = "\n".join(
        f"<tr class='govuk-table__row'><td class='govuk-table__cell'>{k.replace('_',' ').title()}</td><td class='govuk-table__cell govuk-!-font-weight-bold'>{v}</td></tr>"
        for k, v in stats.items()
    )
    body = f"""
    <div class="govuk-grid-row">
      <div class="govuk-grid-column-full">
        <h1 class="govuk-heading-xl">Mock site analytics</h1>
        <div class="govuk-grid-row">
          <div class="govuk-grid-column-one-half">
            <table class="govuk-table">
              <caption class="govuk-table__caption govuk-table__caption--m">Request counts</caption>
              <tbody class="govuk-table__body">{rows}</tbody>
            </table>
          </div>
          <div class="govuk-grid-column-one-half">
            <table class="govuk-table">
              <caption class="govuk-table__caption govuk-table__caption--m">Live state</caption>
              <tbody class="govuk-table__body">
                <tr class="govuk-table__row"><td class="govuk-table__cell">Active sessions</td><td class="govuk-table__cell govuk-!-font-weight-bold">{sessions_count}</td></tr>
                <tr class="govuk-table__row"><td class="govuk-table__cell">Queue length</td><td class="govuk-table__cell govuk-!-font-weight-bold">{queue_length}</td></tr>
                <tr class="govuk-table__row"><td class="govuk-table__cell">Flagged IPs</td><td class="govuk-table__cell govuk-!-font-weight-bold">{len(flagged_ips)}</td></tr>
              </tbody>
            </table>
            {"<p class='govuk-body-s'>Flagged: " + ", ".join(flagged_ips[:10]) + "</p>" if flagged_ips else ""}
          </div>
        </div>
        <p class="govuk-body"><a href="/" class="govuk-link">Back to home</a></p>
      </div>
    </div>"""
    return _base("Analytics", body)
