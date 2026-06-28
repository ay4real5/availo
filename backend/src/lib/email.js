import { Resend } from "resend";

let _resend = null;
function getResend() {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

function getFrom() {
  return process.env.EMAIL_FROM || "Availo <onboarding@resend.dev>";
}

function fmt(iso) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function buildSlotAlertHtml({ userName, centre, slots }) {
  const slotRows = slots
    .slice(0, 5)
    .map(
      (s) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #b1b4b6;font-size:16px;">
          <strong>${fmt(s.slot_datetime)}</strong>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #b1b4b6;font-size:16px;color:#505a5f;">
          ${fmtTime(s.slot_datetime)}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #b1b4b6;">
          <a href="https://www.gov.uk/change-driving-test"
             style="background:#00703c;color:#fff;padding:6px 12px;text-decoration:none;font-weight:700;font-size:14px;">
            Book now →
          </a>
        </td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Earlier driving test slot found</title>
</head>
<body style="margin:0;padding:0;background:#f3f2f1;font-family:arial,sans-serif;color:#0b0c0c;">

  <!-- GOV.UK-style header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c0c;border-bottom:10px solid #1d70b8;">
    <tr>
      <td style="padding:15px 30px;">
        <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Availo</span>
        <span style="color:#b1b4b6;font-size:13px;margin-left:12px;">Earlier driving test finder</span>
      </td>
    </tr>
  </table>

  <!-- Green confirmation banner -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#00703c;">
    <tr>
      <td style="padding:25px 30px;">
        <p style="margin:0;color:#fff;font-size:28px;font-weight:700;line-height:1.1;">
          Earlier slot found at ${centre}
        </p>
        <p style="margin:8px 0 0;color:#d4f5e0;font-size:16px;">
          Act quickly — cancellations go fast
        </p>
      </td>
    </tr>
  </table>

  <!-- Body -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:30px;">

        <p style="font-size:16px;margin:0 0 20px;">Hi ${userName || "there"},</p>
        <p style="font-size:16px;margin:0 0 25px;">
          We found ${slots.length} earlier driving test slot${slots.length !== 1 ? "s" : ""} 
          at <strong>${centre}</strong> that ${slots.length !== 1 ? "are" : "is"} earlier than your current test date.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #0b0c0c;margin-bottom:25px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:10px 0;font-size:14px;border-bottom:2px solid #0b0c0c;">Date</th>
              <th style="text-align:left;padding:10px 0;font-size:14px;border-bottom:2px solid #0b0c0c;">Time</th>
              <th style="text-align:left;padding:10px 0;font-size:14px;border-bottom:2px solid #0b0c0c;"></th>
            </tr>
          </thead>
          <tbody>
            ${slotRows}
          </tbody>
        </table>

        ${
          slots.length > 5
            ? `<p style="font-size:14px;color:#505a5f;margin:0 0 25px;">
                + ${slots.length - 5} more slots available. Sign in to Availo to see all of them.
               </p>`
            : ""
        }

        <!-- Warning inset -->
        <table width="100%" cellpadding="0" cellspacing="0"
               style="border-left:10px solid #ffdd00;background:#fff9c4;margin-bottom:25px;">
          <tr>
            <td style="padding:15px;">
              <p style="margin:0;font-size:15px;font-weight:700;">
                ⚠ These slots may already be taken by the time you click — book immediately on the DVSA website.
              </p>
            </td>
          </tr>
        </table>

        <p style="font-size:14px;color:#505a5f;margin:0 0 5px;">
          To stop receiving these alerts, sign in to Availo and remove your alert.
        </p>
        <p style="font-size:14px;color:#505a5f;margin:0;">
          Availo is not affiliated with DVSA or GOV.UK.
        </p>

      </td>
    </tr>
  </table>

  <!-- Footer -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2f1;border-top:4px solid #1d70b8;">
    <tr>
      <td style="padding:20px 30px;">
        <p style="margin:0;font-size:13px;color:#505a5f;">
          You're receiving this because you set up an alert at <strong>Availo</strong>.
        </p>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export async function sendSlotAlert({ to, userName, centre, slots }) {
  const resend = getResend();
  if (!resend) {
    console.log(
      `[email] RESEND_API_KEY not set — would send slot alert to ${to} (${slots.length} slots at ${centre})`,
    );
    return { skipped: true };
  }

  const subject =
    slots.length === 1
      ? `Earlier driving test slot available at ${centre}`
      : `${slots.length} earlier driving test slots found at ${centre}`;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to,
      subject,
      html: buildSlotAlertHtml({ userName, centre, slots }),
    });

    if (error) {
      console.error(`[email] Resend error sending to ${to}:`, error);
      return { error };
    }

    console.log(`[email] Sent slot alert to ${to} — id=${data.id}`);
    return { id: data.id };
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
    return { error: err.message };
  }
}

export async function sendWelcomeEmail({ to, userName, centre }) {
  const resend = getResend();
  if (!resend) {
    console.log(`[email] RESEND_API_KEY not set — would send welcome to ${to}`);
    return { skipped: true };
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Welcome to Availo</title></head>
<body style="margin:0;padding:0;background:#f3f2f1;font-family:arial,sans-serif;color:#0b0c0c;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c0c;border-bottom:10px solid #1d70b8;">
    <tr><td style="padding:15px 30px;">
      <span style="color:#fff;font-size:22px;font-weight:700;">Availo</span>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:30px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 20px;">You're set up</h1>
      <p style="font-size:16px;margin:0 0 15px;">Hi ${userName || "there"},</p>
      <p style="font-size:16px;margin:0 0 15px;">
        Your alert is active. We're monitoring <strong>${centre}</strong> for cancellations 
        and will email you the moment an earlier slot appears.
      </p>
      <p style="font-size:16px;margin:0 0 25px;">You don't need to do anything — we'll be in touch as soon as we find something.</p>
      <p style="font-size:14px;color:#505a5f;margin:0;">Availo — not affiliated with DVSA or GOV.UK.</p>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to,
      subject: `Your Availo alert is active — monitoring ${centre}`,
      html,
    });
    if (error) return { error };
    console.log(`[email] Sent welcome to ${to} — id=${data.id}`);
    return { id: data.id };
  } catch (err) {
    return { error: err.message };
  }
}
