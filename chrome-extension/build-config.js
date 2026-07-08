// Build flag + dev-only constants. In the source tree AVAILO_PACKAGED is `false`
// (dev build, load-unpacked), keeping developer affordances like the local
// "Practice run" and the localhost fixture origins. The store packager (build.mjs)
// overwrites this file so packaged builds are `true` with no localhost anywhere.
// Loaded before popup.js in popup.html.
const AVAILO_PACKAGED = false;
const AVAILO_PRACTICE_URL = "http://localhost:5555/login.html";
const AVAILO_DEV_HOST_MATCH = "localhost:8000|localhost:5555";
