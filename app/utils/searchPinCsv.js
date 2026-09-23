export function searchPinScopeToCsv(rule) {
  return {
    AppliedToInstantSearch: ["instant", "both"].includes(rule.applyToSearchType)
      ? "TRUE"
      : "FALSE",
    AppliedToSearch: ["page", "search", "both"].includes(rule.applyToSearchType)
      ? "TRUE"
      : "FALSE",
    ApplyToAll: rule.applyToAll ? "TRUE" : "FALSE",
    SearchQuery: rule.searchQueries?.[0] || "",
    SearchQueries: JSON.stringify(rule.searchQueries || []),
  };
}

export function searchPinScopeFromCsv(row) {
  const isTrue = (value) =>
    String(value || "")
      .trim()
      .toUpperCase() === "TRUE";
  const instant = isTrue(row.AppliedToInstantSearch);
  const page = isTrue(row.AppliedToSearch);
  let queries;
  try {
    queries = JSON.parse(row.SearchQueries);
  } catch {
    /* Legacy CSVs have a single query. */
  }
  const searchQueries = Array.isArray(queries)
    ? queries
        .filter((query) => typeof query === "string" && query.trim())
        .map((query) => query.trim())
    : row.SearchQuery?.trim()
      ? [row.SearchQuery.trim()]
      : [];
  return {
    searchQuery: searchQueries[0] || null,
    searchQueries,
    applyToAll:
      row.ApplyToAll == null || row.ApplyToAll === ""
        ? searchQueries.length === 0
        : isTrue(row.ApplyToAll),
    applyToSearchType:
      instant && page ? "both" : instant ? "instant" : page ? "page" : "none",
  };
}
