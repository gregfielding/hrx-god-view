/**
 * Mention Parsing Utilities
 * 
 * Parses mentions from plain text and resolves them to structured Mention objects.
 */

import type { Mention, MentionPrefix, MentionType } from '../../types/crossSystemMentions';
import type { MentionableEntity } from '../../types/crossSystemMentions';
import { MENTION_PREFIX_MAP } from '../../types/crossSystemMentions';

/**
 * Regex to match mention patterns: @/#/&/% followed by non-whitespace, non-punctuation characters
 * Group 1: prefix (@, #, &, %)
 * Group 2: token (until space or basic punctuation)
 */
export const MENTION_REGEX = /([@#&%!^*~])([^\s.,!?]+)/g;

/**
 * Resolver function type for resolving a mention token to an entity
 */
export type MentionResolver = (
  prefix: MentionPrefix,
  token: string,
  tenantId: string
) => Promise<Mention | null>;

/**
 * Parse mentions from text using regex
 * Returns array of { prefix, token, index } matches
 */
export function findMentionMatches(text: string): Array<{
  prefix: MentionPrefix;
  token: string;
  index: number;
  fullMatch: string;
}> {
  const matches: Array<{
    prefix: MentionPrefix;
    token: string;
    index: number;
    fullMatch: string;
  }> = [];

  let match;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const prefix = match[1] as MentionPrefix;
    const token = match[2];
    const index = match.index;
    const fullMatch = match[0];

    matches.push({ prefix, token, index, fullMatch });
  }

  return matches;
}

/**
 * Resolve a single mention token to a Mention object
 * This is a client-side resolver that searches Firestore
 */
export async function resolveMention(
  prefix: MentionPrefix,
  token: string,
  tenantId: string,
  resolvers: {
    resolveUser: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
    resolveContact: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
    resolveCompany: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
    resolveDeal: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
  }
): Promise<Mention | null> {
  const type = MENTION_PREFIX_MAP[prefix];
  let entity: MentionableEntity | null = null;

  switch (type) {
    case 'user':
      entity = await resolvers.resolveUser(token, tenantId);
      break;
    case 'contact':
      entity = await resolvers.resolveContact(token, tenantId);
      break;
    case 'company':
      entity = await resolvers.resolveCompany(token, tenantId);
      break;
    case 'deal':
      entity = await resolvers.resolveDeal(token, tenantId);
      break;
  }

  if (!entity) {
    return null;
  }

  // Build Mention object based on type
  const baseMention = {
    id: entity.id,
    label: entity.label,
    slug: entity.slug,
  };

  switch (type) {
    case 'user':
      return {
        ...baseMention,
        type: 'user',
        userId: entity.id,
      };
    case 'contact':
      return {
        ...baseMention,
        type: 'contact',
        contactId: entity.id,
      };
    case 'company':
      return {
        ...baseMention,
        type: 'company',
        companyId: entity.id,
      };
    case 'deal':
      return {
        ...baseMention,
        type: 'deal',
        dealId: entity.id,
      };
  }
}

/**
 * Parse all mentions from text and resolve them
 * Returns array of resolved Mention objects
 */
export async function parseMentions(
  text: string,
  tenantId: string,
  resolvers: {
    resolveUser: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
    resolveContact: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
    resolveCompany: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
    resolveDeal: (token: string, tenantId: string) => Promise<MentionableEntity | null>;
  }
): Promise<Mention[]> {
  const matches = findMentionMatches(text);
  const mentions: Mention[] = [];

  // Resolve each match
  for (const match of matches) {
    const mention = await resolveMention(match.prefix, match.token, tenantId, resolvers);
    if (mention) {
      // Avoid duplicates (same type + id)
      const isDuplicate = mentions.some(
        m => m.type === mention.type && m.id === mention.id
      );
      if (!isDuplicate) {
        mentions.push(mention);
      }
    }
  }

  return mentions;
}

