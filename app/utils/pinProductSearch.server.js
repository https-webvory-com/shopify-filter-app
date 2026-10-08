export async function pinProductSearchFilter(prisma, shop, query, searchField) {
  const text = String(query || "").trim();
  if (!text) return {};
  if (searchField === "title") return { title: { contains: text, mode: "insensitive" } };
  if (searchField === "id") {
    const numeric = text.match(/^(?:gid:\/\/shopify\/Product\/)?(\d+)$/)?.[1];
    return { AND: [{ id: { equals: numeric ? 'gid://shopify/Product/' + numeric : '__invalid_product_id__' } }] };
  }
  if (searchField !== "tags") {
    return {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { vendor: { contains: query, mode: "insensitive" } },
        { tags: { has: query } },
      ],
    };
  }

  // Resolve matching tag strings first so Prisma can retain its collection,
  // excluded-product, count and pagination filters on the product query.
  const matches = await prisma.$queryRaw`
    SELECT DISTINCT tag
    FROM "Product" p CROSS JOIN LATERAL unnest(p.tags) AS tag
    WHERE p.shop = ${shop} AND p.status = 'active'
      AND strpos(lower(tag), lower(${text})) > 0
  `;
  return { tags: { hasSome: matches.map(({ tag }) => tag) } };
}

export async function pinProductTagSuggestions(prisma, shop, query) {
  const text = String(query || '').trim().slice(0, 200);
  const matches = await prisma.$queryRaw`
    SELECT DISTINCT tag
    FROM "Product" p CROSS JOIN LATERAL unnest(p.tags) AS tag
    WHERE p.shop = ${shop} AND p.status = 'active'
      AND strpos(lower(tag), lower(${text})) > 0
    ORDER BY tag ASC LIMIT 25
  `;
  return matches.map(({ tag }) => tag);
}
