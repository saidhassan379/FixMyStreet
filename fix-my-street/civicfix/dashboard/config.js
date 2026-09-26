// Same-origin by default — the backend serves this dashboard at /admin (see server.js),
// so on Replit you usually don't need to change this at all.
window.CIVICFIX_API_BASE = window.CIVICFIX_API_BASE || (window.location.origin + "/api");
