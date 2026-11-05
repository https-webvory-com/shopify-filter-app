const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function readOrderPage(admin, query, cursor, wait = pause) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await admin.graphql(query, { variables: { cursor } });
      if (response.ok === false) throw Error(`Shopify orders HTTP ${response.status}`);
      const json = await response.json();
      if (json.errors?.length) {
        const codes = json.errors.map(error => error.extensions?.code || 'GRAPHQL_ERROR');
        const error = Error(`Shopify orders GraphQL ${codes.join(',')}`);
        error.retryable = codes.every(code => ['THROTTLED', 'MAX_COST_EXCEEDED', 'INTERNAL_SERVER_ERROR'].includes(code));
        throw error;
      }
      if (!Array.isArray(json.data?.orders?.nodes) || typeof json.data.orders.pageInfo?.hasNextPage !== 'boolean')
        throw Error('Incomplete Shopify orders page');
      return json.data.orders;
    } catch (error) {
      const retryable = error.retryable || /HTTP (429|500|502|503|504)|throttl|timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message);
      if (!retryable || attempt === 4) throw error;
      await wait(Math.min(30000, 2000 * 2 ** attempt));
    }
  }
}

export function validateOrderScanCount(processed, lastCompleted) {
  if (!Number.isInteger(processed) || processed < 0) throw Error('Invalid order scan count');
  if (lastCompleted > 0 && processed < Math.floor(lastCompleted * 0.98))
    throw Error(`Historical order scan incomplete: ${processed} versus ${lastCompleted} last completed`);
}
