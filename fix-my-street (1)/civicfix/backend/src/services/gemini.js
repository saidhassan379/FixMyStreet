/**
 * Gemini classification service.
 * Sends the uploaded photo (+ optional citizen description) to Gemini and
 * asks for a strict JSON classification we can trust in the pipeline.
 */
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const VALID_CATEGORIES = [
  'pothole',
  'broken_streetlight',
  'damaged_sidewalk',
  'blocked_accessibility_ramp',
  'damaged_sign',
  'overflowing_garbage_bin',
  'road_obstruction',
  'unknown',
];

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

let genAI = null;
function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

function mimeFromPath(path) {
  const ext = path.split('.').pop().toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}

const SYSTEM_PROMPT = `You are an infrastructure-issue classifier for a city 311-style reporting system called CivicFix.
You will be given a photo taken by a citizen (and optionally a short text description) of a public infrastructure problem.

Classify it into EXACTLY ONE of these categories:
- pothole
- broken_streetlight
- damaged_sidewalk
- blocked_accessibility_ramp
- damaged_sign
- overflowing_garbage_bin
- road_obstruction
- unknown  (use this ONLY if the photo genuinely does not show a recognizable infrastructure issue from the list)

Also assess:
- severity: one of low, medium, high, critical (how urgent/dangerous the issue is)
- safety_risk: true/false — true if this could directly injure a pedestrian or driver soon (e.g. deep pothole in a traffic lane, exposed wiring, collapsed ramp)
- safety_risk_reason: one short sentence explaining the safety_risk decision (empty string if false and no concern)
- confidence: your confidence in the category, from 0.0 to 1.0
- short_summary: a neutral one-sentence description of what is visibly wrong, suitable to show a municipal worker

Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "category": "one_of_the_categories_above",
  "confidence": 0.0,
  "severity": "low|medium|high|critical",
  "safety_risk": false,
  "safety_risk_reason": "",
  "short_summary": ""
}`;

/**
 * @param {string} photoPath absolute or relative filesystem path to the uploaded image
 * @param {string} [userDescription] optional citizen-provided description, used as extra context
 * @returns {Promise<{category, confidence, severity, safety_risk, safety_risk_reason, short_summary, raw}>}
 */
async function classifyPhoto(photoPath, userDescription) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  const imageBytes = fs.readFileSync(photoPath);
  const imagePart = {
    inlineData: {
      data: imageBytes.toString('base64'),
      mimeType: mimeFromPath(photoPath),
    },
  };

  const contextText = userDescription
    ? `Citizen-provided description: "${userDescription}"`
    : 'No citizen description was provided.';

  const result = await model.generateContent([
    SYSTEM_PROMPT,
    contextText,
    imagePart,
  ]);

  const text = result.response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Fallback: try to salvage JSON from a noisy response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error(`Gemini returned non-JSON response: ${text.slice(0, 300)}`);
    }
  }

  const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'unknown';
  const severity = VALID_SEVERITIES.includes(parsed.severity) ? parsed.severity : 'medium';
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  return {
    category,
    confidence,
    severity,
    safety_risk: Boolean(parsed.safety_risk),
    safety_risk_reason: parsed.safety_risk_reason || '',
    short_summary: parsed.short_summary || '',
    raw: parsed,
  };
}

module.exports = { classifyPhoto, VALID_CATEGORIES, VALID_SEVERITIES };
