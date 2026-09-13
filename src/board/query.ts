import { graphql } from "./gh.ts";

export type RemoteField = {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string }[];
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
      ... on ProjectV2SingleSelectField { id name dataType options { id name } }
      ... on ProjectV2IterationField { id name dataType }
    }
  }
}`;

const ORG_QUERY = `query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { ...P } } }${PROJECT_FRAGMENT}`;
const USER_QUERY = `query($owner: String!, $number: Int!) { user(login: $owner) { projectV2(number: $number) { ...P } } }${PROJECT_FRAGMENT}`;

type ProjectPayload = {
  id: string;
  number: number;
  title: string;
  url: string;
  fields: { nodes: RemoteField[] };
};

/**
 * An owner is either an org or a user, and GitHub's GraphQL API errors rather than
 * returning null for the wrong one — so the two are queried separately instead of in
 * one document, where the losing branch's error would fail the whole request.
 */
export async function fetchProject(owner: string, number: number): Promise<RemoteProject> {
  let payload: ProjectPayload | null | undefined;
  try {
    payload = (await graphql<{ organization?: { projectV2?: ProjectPayload | null } | null }>(
      ORG_QUERY,
      { owner, number },
    )).organization?.projectV2;
  } catch {
    payload = undefined;
  }
  if (!payload) {
    payload = (await graphql<{ user?: { projectV2?: ProjectPayload | null } | null }>(
      USER_QUERY,
      { owner, number },
    )).user?.projectV2;
  }
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
