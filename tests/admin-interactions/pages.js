(async () => {
  const results = [];
  for (const route of window.auditRoutes) {
    const url = route.path.replace(":id", "new");
    const result = await window.auditMount(url);
    results.push({ ...result, errors: [...window.auditErrors] });
  }
  window.auditLoadResults = results;
  return results;
})();
