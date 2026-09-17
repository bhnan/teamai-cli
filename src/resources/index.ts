import { ResourceHandler } from './base.js';
import { SkillsHandler } from './skills.js';
import { RulesHandler } from './rules.js';
import { DocsHandler } from './docs.js';
import { WikiHandler } from './wiki.js';
import { EnvHandler } from './env.js';
import { AgentsHandler } from './agents.js';
import { HooksHandler } from './hooks.js';
import { McpHandler } from './mcp.js';
import type { ResourceType } from '../types.js';

const handlers: Record<ResourceType, ResourceHandler> = {
  skills: new SkillsHandler(),
  rules: new RulesHandler(),
  docs: new DocsHandler(),
  wiki: new WikiHandler(),
  env: new EnvHandler(),
  agents: new AgentsHandler(),
  hooks: new HooksHandler(),
  mcp: new McpHandler(),
};

export function getHandler(type: ResourceType): ResourceHandler {
  return handlers[type];
}

export function getAllHandlers(): ResourceHandler[] {
  return Object.values(handlers);
}

export { SkillsHandler, RulesHandler, DocsHandler, WikiHandler, EnvHandler, AgentsHandler, HooksHandler, McpHandler };
