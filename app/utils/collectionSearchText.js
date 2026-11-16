const searchText=value=>String(value??'').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim();

// Compare search text without changing the collection's saved title or ID.
export const collectionTitleMatchesSearch=(title,query)=>searchText(title).includes(searchText(query));
