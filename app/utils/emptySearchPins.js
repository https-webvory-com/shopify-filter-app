export const isEmptySearchPin=rule=>!rule?.applyToAll&&Array.isArray(rule?.searchQueries)&&rule.searchQueries.length===1&&rule.searchQueries[0]==='';
