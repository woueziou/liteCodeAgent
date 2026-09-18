import { graphql } from "./gh.ts";

export type RemoteField = {
  id: string;
  name: string;
  dataType: string;
  /**
   * `true` when this field's value is derived from the issue/PR itself (e.g. `Priority`,
   * `Start date`, `Target date` on a board seeded from an issue-forms template) rather than
   * being a plain project-level custom field. Confirmed via live schema introspection:
   * present on `ProjectV2Field` and `ProjectV2SingleSelectField`, and `null` on
   * `ProjectV2IterationField`. This is the one case `DERIVED_DATATYPES` cannot catch —
   * a field like `Priority` reports `dataType: "SINGLE_SELECT"` with zero options,
   * indistinguishable from a genuine custom single-select by dataType alone.
   */
  isIssueField?: boolean | null;
  /**
   * color and description are carried because updating a single-select means resending
   * the whole option list: anything not echoed back would be silently reset.
   */
  options?: { id: string; name: string; color?: string; description?: string }[];
};

/**
 * `dataType` values GitHub derives from the issue/PR itself rather than storing as a plain
 * custom field value. `updateProjectV2Field`/`createProjectV2Field` reject these outright
 * ("Only custom fields can be updated. Fields derived from issues or pull requests must be
 * updated through their respective APIs.") — so a name collision with one of these must be
 * treated as unfixable by this pipeline, not attempted and left to fail mid-apply.
 *
 * This set alone is NOT sufficient: an issue-derived field that happens to be
 * SINGLE_SELECT-shaped (e.g. `Priority`) reports a `dataType` identical to a genuine custom
 * field and has zero entries here to catch it. That case is caught separately via
 * `RemoteField.isIssueField` (see `planBoard`) — the two checks are complementary, not
 * redundant: every field caught here reports `isIssueField: false`, so this set still earns
 * its keep for the fields it does catch.
 */
export const DERIVED_DATATYPES = new Set([
  "ASSIGNEES",
  "LABELS",
  "LINKED_PULL_REQUESTS",
  "MILESTONE",
  "REPOSITORY",
  "REVIEWERS",
  "TITLE",
  "TRACKED_BY",
  "TRACKS",
  "PARENT_ISSUE",
  "SUB_ISSUES_PROGRESS",
  "CREATED",
  "UPDATED",
  "CLOSED",
]);

export type RemoteProject = {
  id: string;
  number: number;
  title: string;
  url: string;
  fields: RemoteField[];
};

const PROJECT_FRAGMENT = `
fragment P on ProjectV2 {
  id number title url
  fields(first: 50) {
    nodes {
      ... on ProjectV2Field { id name dataType isIssueField }
      ... on ProjectV2SingleSelectField { id name dataType isIssueField options { id name color description } }
      ... on ProjectV2IterationField { id name dataType }
    }
  }
}`;

const OWNER_QUERY = `query($owner: String!, $number: Int!) {
  repositoryOwner(login: $owner) {
    __typename
    ... on Organization { projectV2(number: $number) { ...P } }
    ... on User { projectV2(number: $number) { ...P } }
  }
}${PROJECT_FRAGMENT}`;

type ProjectPayload = {
  id: string;
  number: number;
  title: string;
  url: string;
  fields: { nodes: RemoteField[] };
};

/**
 * An owner is either an org or a user. Querying `organization` and `user` as two separate
 * documents — the previous approach — costs two requests for every user-owned board, one
 * of which is guaranteed to fail, which is a fast way to trip GitHub's secondary rate
 * limit. `repositoryOwner` resolves either kind in a single request, and the inline
 * fragments pick the right branch without the losing one erroring.
 */
export async function fetchProject(owner: string, number: number): Promise<RemoteProject> {
  const data = await graphql<{
    repositoryOwner?: { __typename: string; projectV2?: ProjectPayload | null } | null;
  }>(OWNER_QUERY, { owner, number });

  const ownerNode = data.repositoryOwner;
  if (!ownerNode) throw new Error(`No GitHub owner '${owner}' found`);

  const payload = ownerNode.projectV2;
  if (!payload) throw new Error(`No GitHub Project #${number} found for owner '${owner}'`);

  return {
    id: payload.id,
    number: payload.number,
    title: payload.title,
    url: payload.url,
    fields: payload.fields.nodes.filter((f) => f && f.id),
  };
}

const ITEMS_STATUS_QUERY = `
query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content { ... on Issue { number } ... on PullRequest { number } }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
          }
        }
      }
    }
  }
}`;

export type BoardItem = { id: string; issue: number | null; status: string | null };

export async function fetchItems(projectId: string): Promise<BoardItem[]> {
  const items: BoardItem[] = [];
  let cursor: string | undefined;
  do {
    const data = await graphql<{
      node: {
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          nodes: {
            id: string;
            content: { number?: number } | null;
            fieldValueByName: { name?: string } | null;
          }[];
        };
      };
    }>(ITEMS_STATUS_QUERY, cursor ? { projectId, cursor } : { projectId });

    for (const n of data.node.items.nodes) {
      items.push({ id: n.id, issue: n.content?.number ?? null, status: n.fieldValueByName?.name ?? null });
    }
    cursor = data.node.items.pageInfo.hasNextPage ? data.node.items.pageInfo.endCursor : undefined;
  } while (cursor);
  return items;
}

const OPTION_USAGE_QUERY = `
query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content { ... on Issue { number } ... on PullRequest { number } }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

/** field name -> option name -> how many items currently hold it. */
export type OptionUsage = Map<string, Map<string, number>>;

/** item id -> the single-select value it holds for each field, plus its issue number. */
export type ItemFieldValues = Map<string, { issue: number | null; values: Map<string, string> }>;

/**
 * Every single-select value of every item, in one paginated pass, keyed by item id.
 *
 * Keyed by *item*, not aggregated into counts, because the two things that need this ask
 * different questions of the same data: "may this option be deleted" only needs totals,
 * but "did this run destroy anything" needs identities — a count is blind to one item
 * losing its value while another gains one.
 */
export async function fetchSingleSelectValues(projectId: string): Promise<ItemFieldValues> {
  const byItem: ItemFieldValues = new Map();
  let cursor: string | undefined;
  do {
    const data = await graphql<{
      node: {
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          nodes: {
            id: string;
            content: { number?: number } | null;
            fieldValues: { nodes: ({ name?: string; field?: { name?: string } } | null)[] };
          }[];
        };
      };
    }>(OPTION_USAGE_QUERY, cursor ? { projectId, cursor } : { projectId });

    for (const item of data.node.items.nodes) {
      const values = new Map<string, string>();
      for (const value of item.fieldValues.nodes) {
        const field = value?.field?.name;
        const option = value?.name;
        if (field && option) values.set(field, option);
      }
      byItem.set(item.id, { issue: item.content?.number ?? null, values });
    }
    cursor = data.node.items.pageInfo.hasNextPage ? data.node.items.pageInfo.endCursor : undefined;
  } while (cursor);
  return byItem;
}

export function optionUsage(byItem: ItemFieldValues): OptionUsage {
  const usage: OptionUsage = new Map();
  for (const { values } of byItem.values()) {
    for (const [field, option] of values) {
      const perField = usage.get(field) ?? new Map<string, number>();
      perField.set(option, (perField.get(option) ?? 0) + 1);
      usage.set(field, perField);
    }
  }
  return usage;
}

/**
 * Counts, for every single-select field at once, how many items hold each option. This is
 * what makes deleting an option a decidable question rather than a guess: an option no
 * item holds can go without asking, one that is in use cannot.
 */
export async function fetchOptionUsage(projectId: string): Promise<OptionUsage> {
  return optionUsage(await fetchSingleSelectValues(projectId));
}
