export function matchesRuleFilters(rule, filters, matchType = "all") {
  const matches = ({ field, operator, value }) => {
    if (field === "Active") {
      const active = value === true || value === "true";
      return operator === "equals"
        ? rule.status === active
        : rule.status !== active;
    }
    const values =
      field === "Collections"
        ? rule.collections || []
        : field === "Search Queries"
          ? rule.searchQueries || []
          : field === "Item name"
            ? [rule.name || ""]
            : [];
    const needle = String(value ?? "").toLowerCase();
    const haystack = values.map((item) => String(item).toLowerCase());
    switch (operator) {
      case "contains":
        return haystack.join(" ").includes(needle);
      case "does not contains":
        return !haystack.join(" ").includes(needle);
      case "equals":
        return haystack.includes(needle);
      case "does not equal":
        return !haystack.includes(needle);
      case "starts with":
        return haystack.some((item) => item.startsWith(needle));
      case "ends with":
        return haystack.some((item) => item.endsWith(needle));
      default:
        return true;
    }
  };
  return (
    filters.length === 0 ||
    (matchType === "any" ? filters.some(matches) : filters.every(matches))
  );
}
