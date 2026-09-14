import { Type } from '@earendil-works/pi-ai';

import { jsonTool } from './define';
import type { ISkillRegistry, ITool } from '../tokens';

/**
 * Create a tool to discover available skills and their summaries.
 */
export function createDiscoverSkillsTool(skillRegistry: ISkillRegistry): ITool {
  return jsonTool({
    name: 'discover_skills',
    label: 'Discover Skills',
    description:
      'Discover available agent skills with their names and descriptions',
    parameters: Type.Object({
      query: Type.Optional(
        Type.Union([
          Type.String({
            description: 'Optional search query to filter skills'
          }),
          Type.Null()
        ])
      )
    }),
    execute: async input => {
      const filtered = skillRegistry.listSkills(input.query ?? undefined);

      return {
        success: true,
        skillCount: filtered.length,
        skills: filtered
      };
    }
  });
}

/**
 * Create a tool to load skill instructions or a bundled resource.
 */
export function createLoadSkillTool(skillRegistry: ISkillRegistry): ITool {
  return jsonTool({
    name: 'load_skill',
    label: 'Load Skill',
    description:
      'Load a skill definition or a specific resource file bundled with a skill',
    parameters: Type.Object({
      name: Type.String({ description: 'The name of the skill to load' }),
      resource: Type.Optional(
        Type.Union([
          Type.String({
            description:
              'Optional resource path to load from the skill (e.g. references/REFERENCE.md)'
          }),
          Type.Null()
        ])
      )
    }),
    execute: async input => {
      const { name, resource } = input;

      if (resource) {
        const result = await skillRegistry.getSkillResource(name, resource);
        if (result.error) {
          return {
            success: false,
            ...result
          };
        }
        return {
          success: true,
          ...result
        };
      }

      const skill = skillRegistry.getSkill(name);
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${name}`
        };
      }

      return {
        success: true,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        ...(skill.resources.length > 0 && { resources: skill.resources })
      };
    }
  });
}
