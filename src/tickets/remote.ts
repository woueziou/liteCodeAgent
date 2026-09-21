/**
 * One paginated read of everything the board holds for the issues tickets point at.
 *
 * Deliberately a single query for the whole board rather than one per ticket: the diff
 * that decides which `item-edit` calls are actually needed costs the same one request
 * whether a sync touches one ticket or twenty, and skipping a no-op edit is the cheapest
 * GitHub call there is.
 */

import { graphql } from "../gh.ts";

const ITEMS_QUERY = `
query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on Issue {
              number
              state
              title
              body
              labels(first: 10) { nodes { name } }
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name field { ... on ProjectV2SingleSelectField { name } }
              }
              ... on ProjectV2ItemFieldTextValue {
                text field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

export type RemoteItem = {
  itemId: string;
  issue: number;
  state: string | null;
  /** Field name -> its current value, as a string, for every field kind we write. */
  fields: Map<string, string>;
  /**
   * Only populated for hydration (materialising a local file for a board item that has
   * none yet) — `planTicketPull`/`applyTicketSync` never read these, they only reconcile
   * `fields`.
   */
  title: string | null;
  body: string | null;
  labels: string[];
};

type ValueNode = {
  name?: string;
  text?: string;
  date?: string;
  field?: { name?: string };
} | null;

/** Keyed by issue number — the only handle a ticket file carries. */
export async function fetchTicketItems(projectId: string): Promise<Map<number, RemoteItem>> {
  const byIssue = new Map<number, RemoteItem>();
  let cursor: string | undefined;
  do {
    const data = await graphql<{
      node: {
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          nodes: {
            id: string;
            content: {
              number?: number;
              state?: string;
              title?: string;
              body?: string;
              labels?: { nodes: { name: string }[] };
            } | null;
            fieldValues: { nodes: ValueNode[] };
          }[];
        };
      };
    }>(ITEMS_QUERY, cursor ? { projectId, cursor } : { projectId });

    for (const item of data.node.items.nodes) {
      const issue = item.content?.number;
      if (issue === undefined) continue;
      const fields = new Map<string, string>();
      for (const value of item.fieldValues.nodes) {
        const field = value?.field?.name;
        const held = value?.name ?? value?.text ?? value?.date;
        if (field && held) fields.set(field, held);
      }
      byIssue.set(issue, {
        itemId: item.id,
        issue,
        state: item.content?.state ?? null,
        fields,
        title: item.content?.title ?? null,
        body: item.content?.body ?? null,
        labels: item.content?.labels?.nodes.map((n) => n.name) ?? [],
      });
    }
    cursor = data.node.items.pageInfo.hasNextPage ? data.node.items.pageInfo.endCursor : undefined;
  } while (cursor);
  return byIssue;
}
