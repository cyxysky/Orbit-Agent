import { configurationRequestSchema } from './settings-schema';
import type { CapabilityManifest } from '@cjfclonedeep/capability-sdk';
import { extensionRuntimeSkill } from '@cjfclonedeep/capability-sdk/extensions';

export { configurationRequestSchema };
export const configurationCapabilityManifest: CapabilityManifest = {
  schemaVersion: 1, id: 'com.orbit.self-bootstrap', name: 'Self bootstrap', version: '1.0.0',
  description: 'Manage configuration and isolated executable extensions through one tool. Choose domain=configuration or domain=extensions, then supply its schema-valid request. Requires administrator identity and deployment self-bootstrap permission.',
  permissions: ['configuration:read', 'configuration:write'],
  skills: [{
    id: 'orbit.self-bootstrap', title: 'Self bootstrap and configuration', summary: 'Manage validated configuration and isolated extensions through selfBootstrap.',
    activation: [{ toolName: 'selfBootstrap' }],
    content: [
      '# Self bootstrap and configuration',
      'Use one tool: selfBootstrap({domain:"configuration",request:{action:"query",domain:"catalog"}}) or selfBootstrap({domain:"extensions",request:{action:"list"}}). Requests below are nested under request; they are not top-level tool arguments.',
      'Query the catalog to discover field keys, types, defaults and deployment permissions. Use offset/limit or keys/prefix for focused queries.',
      'Query runtime, preferences, model or integration to read current settings. Secret values are masked. Leave a saved secret empty to preserve it.',
      'Use set with the relevant domain and values for a requested change. Runtime values are a key/value patch. Preferences belong to the current user. Model accepts a provider configuration patch. Integration accepts its driver record.',
      'For model changes, use {providers:{"<provider id>":{displayName,enabled,apiKey,baseURL,models,defaultModel,modelCapabilities,media}},provider,providerOrder,mediaSelections,removedProviders}. Supply only changed fields. modelProviders lists available ids, forms describe provider/model/media fields. modelCapabilities maps model ids to imageInput/maxContextTokens. media maps image/video/speech to their driver, models and generation settings. removedProviders deletes custom compatible providers only.',
      'For integrations, values is {id?,category,driverId,name,configuration,clearFields?,enabled}. Use integrationDrivers to discover configuration fields. Omit stored secret fields or send an empty secret to preserve it. clearFields explicitly clears listed integration fields.',
      'Global values require administrator identity. Model writes and all registration require ORBIT_SELF_BOOTSTRAP_ENABLED=true. Deployment grants, identity and database settings are outside this registry.',
      'Register fields with a lowercase namespace and keys prefixed PLUGIN_<UPPERCASE_NAMESPACE>_. Supply label, description, tab, group, control and defaultValue. Registration persists the schema and publishes it to open settings pages and runtime consumers.',
      'Registered fields are data. Existing consumers can read them with runtimeSetting(key), capability manifests or this tool. A new executable capability needs its implementation. Query after saving to verify the effective value. Never use a host tool to bypass a denied configuration change.',
      'For executable extensions use domain=extensions. Apply the following SDK lifecycle instructions to the nested request:',
      extensionRuntimeSkill.content,
    ].join('\n'),
  }],
};
