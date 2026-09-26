const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid confusion

function generateTrackingCode() {
  let code = 'CF-';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

module.exports = { generateTrackingCode };
