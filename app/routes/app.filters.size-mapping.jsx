import { useFetcher, useLoaderData } from 'react-router';
import { authenticate } from '../shopify.server.js';
import prisma from '../db.server.js';
import { enqueueSizeMappingRebuild, normalizedSizeSource } from '../services/sizeMapping.server.js';

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const mappings = await prisma.sizeNumericMapping.findMany({ where: { shop: session.shop }, orderBy: { sourceValue: 'asc' } });
  const [total, flagged, unclassified] = await Promise.all([
    prisma.variant.count({ where: { product: { shop: session.shop, status: 'active' } } }),
    prisma.variant.count({ where: { product: { shop: session.shop, status: 'active' }, sizeMappingFlag: { not: null } } }),
    prisma.variant.count({ where: { product: { shop: session.shop, status: 'active' }, sizeUsNumeric: null, sizeMappingFlag: null } }),
  ]);
  return { mappings, total, flagged, unclassified };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const actionType = String(form.get('intent') || 'save');
  try {
    if (actionType === 'delete') {
      const id = String(form.get('id') || '');
      if (!id) throw Error('Mapping ID is required');
      await prisma.sizeNumericMapping.deleteMany({ where: { id, shop: session.shop } });
    } else if (actionType === 'save') {
      const sourceValue = normalizedSizeSource(form.get('sourceValue'));
      const numeric = Number(form.get('sizeUsNumeric'));
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 40) throw Error('US numeric size must be from 0 to 40');
      await prisma.sizeNumericMapping.upsert({ where: { shop_sourceValue: { shop: session.shop, sourceValue } },
        create: { shop: session.shop, sourceValue, sizeUsNumeric: numeric }, update: { sizeUsNumeric: numeric } });
    } else throw Error('Unknown action');
    await enqueueSizeMappingRebuild(session.shop);
    return { ok: true, message: 'Mapping saved. Existing variants are updating in the background.' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export default function SizeMapping() {
  const { mappings, total, flagged, unclassified } = useLoaderData();
  const fetcher = useFetcher();
  return <s-page heading="US numeric size mapping">
    <ui-title-bar title="US numeric size mapping" />
    <s-section>
      <p>{total} active variants; {flagged} need size review; {unclassified} have neither a numeric size nor a review flag. Numeric sizes such as 16 are automatic. Map letter sizes only when they mean the same US numeric size for this store.</p>
      {fetcher.data?.message && <p role="status">{fetcher.data.message}</p>}
      <fetcher.Form method="post" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <input type="hidden" name="intent" value="save" />
        <label>Shopify size label <input name="sourceValue" maxLength={100} required placeholder="e.g. XL" /></label>
        <label>US numeric size <input name="sizeUsNumeric" type="number" min="0" max="40" step="1" required /></label>
        <button type="submit" disabled={fetcher.state !== 'idle'}>Save mapping</button>
      </fetcher.Form>
    </s-section>
    <s-section heading="Saved mappings">
      {mappings.length === 0 ? <p>No custom numeric mappings yet.</p> : <table style={{ width: '100%', textAlign: 'left' }}>
        <thead><tr><th>Size label</th><th>US numeric size</th><th>Action</th></tr></thead>
        <tbody>{mappings.map(mapping => <tr key={mapping.id}>
          <td>{mapping.sourceValue}</td><td>{mapping.sizeUsNumeric}</td>
          <td><fetcher.Form method="post"><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={mapping.id} />
            <button type="submit" disabled={fetcher.state !== 'idle'}>Delete</button></fetcher.Form></td>
        </tr>)}</tbody>
      </table>}
    </s-section>
  </s-page>;
}
