const res = await fetch("http://localhost:4000/api/slots/report-centre", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-scraper-key": "test-key",
    "x-rpm": "200",
    "x-visited-trap": "true",
    "x-proxy-used": "proxy-quarantine",
    "x-ip-used": "1.2.3.4",
  },
  body: JSON.stringify({
    test_centre: "Bolton",
    slots: ["2026-10-01T09:00:00.000Z"],
  }),
});
const data = await res.json();
console.log(JSON.stringify(data));
