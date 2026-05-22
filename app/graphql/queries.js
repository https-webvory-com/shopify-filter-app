export const GET_THEME = `#graphql
  query ThemeList {
    themes(first: 10) {
      edges {
        node {
          id
          name
          role
          createdAt
          updatedAt
          themeStoreId
          prefix
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
      }
    }
  }`;

export const GET_THEME_SETTINGS = `#graphql
  query ThemeAsset($themeId: ID!) {
    theme(id: $themeId) {
      id
      name
      role
      files(filenames: ["config/settings_data.json"], first: 1) {
        nodes {
          body {
            ... on OnlineStoreThemeFileBodyText {
              content
            }
          }
        }
      }
    }
  }`;