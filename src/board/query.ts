import { graphql } from "./gh.ts";

export type RemoteField = {
  id: string;
  name: string;
  dataType: string;
  /**
   * color and description are carried because updating a single-select means resending
   * the whole option list: anything not echoed back would be silently reset.
   */
  options?: { id: string; name: string; color?: string; description?: string }[];
};

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
      ... on ProjectV2Field { id name dataType }
      ... on ProjectV2SingleSelectField { id name dataType options { id name color description } }
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
