// Public host settings accept the Orbit prefix while legacy consumers keep working.
// Internal process credentials and role flags are deliberately not aliases.
const settingNames = [
  'ADMIN_SETTINGS_PASSWORD', 'ADMIN_SETTINGS_PASSWORD_ENABLED', 'APP_DIR',
  'BASE_PATH', 'CAPABILITY_SOURCE', 'CROSS_SITE_MOUNT',
  'DEBUG_ROUTES_ENABLED', 'DEBUG_WEBPACK_CACHE', 'DEFAULT_USER_ID',
  'DOCUMENT_FONT', 'DOCUMENT_FONT_FAMILY',
  'ELECTRON_CDP_PORT', 'ELECTRON_SERVER_URL', 'REQUIRE_MOUNT_USER_ID',
  'RUNTIME_PORT', 'SERVER_ROOT', 'SPLIT_RUNTIME', 'TRUST_PROXY', 'WEBSOCKET_TICKET_TTL_SECONDS',
];

function applyOrbitEnvironment(environment = process.env) {
  const updates = {};
  for (const name of settingNames) {
    const value = environment[`ORBIT_${name}`];
    if (value !== undefined) {
      environment[`WEBPILOT_${name}`] = value;
      updates[`WEBPILOT_${name}`] = value;
    }
  }
  // Business configuration is loaded from app_config. Do not let provider SDKs
  // silently fall back to obsolete keys inherited from a launcher or old .env.
  const providerKey = /^(?:OPENAI(?:_COMPATIBLE(?:_\d+)?)?|OPENROUTER|ANTHROPIC|MINIMAX|DEEPSEEK|AZURE_OPENAI|OLLAMA|LMSTUDIO|LLAMA_CPP|GOOGLE_GENERATIVE_AI|ALIBABA|CEREBRAS|COHERE|DEEPINFRA|FIREWORKS|GROQ|HUGGINGFACE|MISTRAL|PERPLEXITY|TOGETHERAI|VERCEL|XAI)_(?:API_KEY|BASE_URL|EXTRA_REQUEST_PARAMETERS)$/;
  for (const key of Object.keys(environment)) {
    if (/^AI_(?!EMBED_TOKEN_SECRET$)|^AGENT_|^CHAT_|^BROWSER_(?!CHAT_(?:PREVIEW_WS_PORT|NOVNC_URL)$|TAB_GROUP_CDP_PORT$)|^CODEX_(?!HOME$)|^GOOGLE_MAPS_|^(?:HEADLESS_BROWSER|ELECTRON_EMBEDDED_BROWSER|OFFICE_GENERATION_MODE|PLAYWRIGHT_TRACE|GOOGLE_API_KEY|VERCEL_AI_GATEWAY_API_KEY)$/.test(key)
      || /^GLINER_(?:RUNTIME_MODE|SERVICE_URL|SERVICE_API_KEY|MODEL|PII_MODEL|CHINESE_NER_MODEL|DEVICE|BATCH_SIZE|ENTITY_LABELS)$/.test(key)
      || providerKey.test(key)) delete environment[key];
  }
  return updates;
}

module.exports = { applyOrbitEnvironment };
