import prisma from "../db.server";

/**
 * Auto-seed FilterSetting records for every unique product option name found in the shop.
 * Called after every sync so new options (Color, Size, etc.) appear in admin automatically.
 */
async function autoSeedOptionFilters(shop) {
  const products = await prisma.product.findMany({
    where: { shop },
    select: { options: true },
  });

  const seen = new Set();
  for (const p of products) {
    for (const opt of p.options || []) {
      if (opt.name) seen.add(opt.name);
    }
  }

  if (seen.size === 0) return;

  const lastSetting = await prisma.filterSetting.findFirst({
    where: { shop },
    orderBy: { order: "desc" },
  });
  let nextOrder = (lastSetting?.order ?? 5) + 1;

  for (const optName of seen) {
    const existing = await prisma.filterSetting.findFirst({
      where: { shop, type: "option", key: optName },
    });
    if (!existing) {
      await prisma.filterSetting.create({
        data: { shop, type: "option", key: optName, label: optName, order: nextOrder++, isEnabled: true },
      });
      console.log(`CFP: Auto-seeded option filter: ${optName}`);
    }
  }
}

/**
 * Sync all products, variants, collections, and metafields for a shop from Shopify to PostgreSQL.
 * @param {string} shop - The shop domain
 * @param {object} admin - The authenticated Shopify Admin API client
 */
export async function syncProducts(shop, admin) {
  console.log(`CFP: Starting full product sync for ${shop}...`);

  // 1. Get active metafield filter configurations to know which metafields to fetch
  const metafieldSettings = await prisma.filterSetting.findMany({
    where: { shop, type: "metafield" },
  });

  const metafieldIdentifiers = metafieldSettings
    .filter(s => s.key && s.key.includes("."))
    .map(s => {
      const [namespace, key] = s.key.split(".");
      return { namespace, key };
    });

  // Construct query dynamically based on whether there are metafield filters
  const metafieldQueryPart = metafieldIdentifiers.length > 0
    ? `metafields(identifiers: $metafieldIdentifiers) {
        id
        namespace
        key
        value
        type
      }`
    : "";

  const query = `#graphql
    query getProducts($cursor: String ${metafieldIdentifiers.length > 0 ? ", $metafieldIdentifiers: [HasMetafieldsIdentifier!]!" : ""}) {
      products(first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
          vendor
          productType
          tags
          totalInventory
          status
          images(first: 5) {
            nodes {
              url
            }
          }
          options {
            name
            values
          }
          collections(first: 100) {
            nodes {
              id
              title
              handle
            }
          }
          variants(first: 100) {
            nodes {
              id
              price
              compareAtPrice
              inventoryQuantity
              availableForSale
              image {
                url
              }
              selectedOptions {
                name
                value
              }
            }
          }
          ${metafieldQueryPart}
        }
      }
    }
  `;

  let hasNextPage = true;
  let cursor = null;
  const allFetchedProductIds = [];

  while (hasNextPage) {
    const variables = { cursor };
    if (metafieldIdentifiers.length > 0) {
      variables.metafieldIdentifiers = metafieldIdentifiers;
    }

    const response = await admin.graphql(query, { variables });
    const responseJson = await response.json();

    if (responseJson.errors) {
      console.error("CFP: GraphQL Errors during sync", responseJson.errors);
      throw new Error("Failed to fetch products from Shopify GraphQL API");
    }

    const productsData = responseJson.data?.products;
    if (!productsData) break;

    const products = productsData.nodes;
    hasNextPage = productsData.pageInfo.hasNextPage;
    cursor = productsData.pageInfo.endCursor;

    for (const product of products) {
      allFetchedProductIds.push(product.id);

      const optionsList = product.options.map(opt => ({
        name: opt.name,
        values: opt.values,
      }));

      // Calculate min and max price across all variants
      const prices = product.variants.nodes.map(v => parseFloat(v.price));
      const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
      const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

      // Extract image URLs
      const imageUrls = product.images.nodes.map(img => img.url);

      // Perform upsert inside database transaction or sequentially
      await prisma.$transaction(async (tx) => {
        // 1. Upsert Product
        await tx.product.upsert({
          where: { id: product.id },
          update: {
            title: product.title,
            handle: product.handle,
            vendor: product.vendor,
            productType: product.productType,
            priceMin: priceMin,
            priceMax: priceMax,
            tags: product.tags,
            images: imageUrls,
            options: optionsList,
            status: product.status.toLowerCase(),
            updatedAt: new Date(),
          },
          create: {
            id: product.id,
            shop,
            title: product.title,
            handle: product.handle,
            vendor: product.vendor,
            productType: product.productType,
            priceMin: priceMin,
            priceMax: priceMax,
            tags: product.tags,
            images: imageUrls,
            options: optionsList,
            status: product.status.toLowerCase(),
          },
        });

        // 2. Delete existing relations/variants/metafields to prevent orphaned records
        await tx.variant.deleteMany({ where: { productId: product.id } });
        await tx.productCollection.deleteMany({ where: { productId: product.id } });
        await tx.productMetafield.deleteMany({ where: { productId: product.id } });

        // 3. Create Variants with option mapping
        for (const variant of product.variants.nodes) {
          let option1 = null;
          let option2 = null;
          let option3 = null;

          variant.selectedOptions.forEach(selOpt => {
            const optIndex = optionsList.findIndex(o => o.name === selOpt.name);
            if (optIndex === 0) option1 = selOpt.value;
            else if (optIndex === 1) option2 = selOpt.value;
            else if (optIndex === 2) option3 = selOpt.value;
          });

          // Use Shopify's availableForSale as the single source of truth.
          // Shopify internally handles all location logic (App warehouses, 3PLs, etc.)
          // availableForSale: false = Sold out on storefront, true = In stock on storefront
          const available = variant.availableForSale === true;
          const inventory = variant.inventoryQuantity || 0;

          await tx.variant.create({
            data: {
              id: variant.id,
              productId: product.id,
              price: parseFloat(variant.price),
              compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
              available: available,
              inventory: inventory,
              imageUrl: variant.image?.url || null,
              option1,
              option2,
              option3,
            },
          });
        }

        // 4. Create Collections & ProductCollection mappings
        for (const collection of product.collections.nodes) {
          // Upsert the collection first
          await tx.collection.upsert({
            where: { id: collection.id },
            update: {
              title: collection.title,
              handle: collection.handle,
            },
            create: {
              id: collection.id,
              shop,
              title: collection.title,
              handle: collection.handle,
            },
          });

          // Link product to collection
          await tx.productCollection.create({
            data: {
              productId: product.id,
              collectionId: collection.id,
            },
          });
        }

        // 5. Create Metafields
        if (product.metafields) {
          for (const metafield of product.metafields) {
            if (metafield && metafield.value) {
              await tx.productMetafield.create({
                data: {
                  id: metafield.id,
                  productId: product.id,
                  namespace: metafield.namespace,
                  key: metafield.key,
                  value: metafield.value,
                  type: metafield.type,
                },
              });
            }
          }
        }
      });
    }
  }

  // 6. Delete products from DB that are no longer on Shopify (were deleted)
  const deletedProductsCount = await prisma.product.deleteMany({
    where: {
      shop,
      id: { notIn: allFetchedProductIds },
    },
  });

  // 7. Auto-seed FilterSetting records for every unique product option found
  await autoSeedOptionFilters(shop);

  console.log(`CFP: Product sync complete. Synced ${allFetchedProductIds.length} products. Deleted ${deletedProductsCount.count} obsolete records.`);
  return allFetchedProductIds.length;
}

/**
 * Sync a single product from Shopify to PostgreSQL.
 * Useful for real-time webhooks (create/update).
 * @param {string} shop - The shop domain
 * @param {object} admin - The authenticated Shopify Admin API client
 * @param {string} productId - The Shopify Product GID
 */
export async function syncSingleProduct(shop, admin, productId) {
  console.log(`CFP: Syncing single product ${productId} for ${shop}...`);

  // 1. Get active metafield filter configurations to know which metafields to fetch
  const metafieldSettings = await prisma.filterSetting.findMany({
    where: { shop, type: "metafield" },
  });

  const metafieldIdentifiers = metafieldSettings
    .filter(s => s.key && s.key.includes("."))
    .map(s => {
      const [namespace, key] = s.key.split(".");
      return { namespace, key };
    });

  const metafieldQueryPart = metafieldIdentifiers.length > 0
    ? `metafields(identifiers: $metafieldIdentifiers) {
        id
        namespace
        key
        value
        type
      }`
    : "";

  const query = `#graphql
    query getProduct($id: ID! ${metafieldIdentifiers.length > 0 ? ", $metafieldIdentifiers: [HasMetafieldsIdentifier!]!" : ""}) {
      product(id: $id) {
        id
        title
        handle
        vendor
        productType
        tags
        status
        images(first: 5) {
          nodes {
            url
          }
        }
        options {
          name
          values
        }
        collections(first: 100) {
          nodes {
            id
            title
            handle
          }
        }
        variants(first: 100) {
          nodes {
            id
            price
            compareAtPrice
            inventoryQuantity
            availableForSale
            image {
              url
            }
            selectedOptions {
              name
              value
            }
          }
        }
        ${metafieldQueryPart}
      }
    }
  `;

  const variables = { id: productId };
  if (metafieldIdentifiers.length > 0) {
    variables.metafieldIdentifiers = metafieldIdentifiers;
  }

  const response = await admin.graphql(query, { variables });
  const responseJson = await response.json();

  if (responseJson.errors) {
    console.error(`CFP: GraphQL Errors syncing product ${productId}:`, responseJson.errors);
    throw new Error(`Failed to fetch product ${productId} from Shopify`);
  }

  const product = responseJson.data?.product;
  if (!product) {
    console.warn(`CFP: Product ${productId} not found on Shopify. Deleting from DB.`);
    await prisma.product.deleteMany({ where: { id: productId } });
    return null;
  }

  const optionsList = product.options.map(opt => ({
    name: opt.name,
    values: opt.values,
  }));

  const prices = product.variants.nodes.map(v => parseFloat(v.price));
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  const imageUrls = product.images.nodes.map(img => img.url);

  await prisma.$transaction(async (tx) => {
    // 1. Upsert Product
    await tx.product.upsert({
      where: { id: product.id },
      update: {
        title: product.title,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.productType,
        priceMin: priceMin,
        priceMax: priceMax,
        tags: product.tags,
        images: imageUrls,
        options: optionsList,
        status: product.status.toLowerCase(),
        updatedAt: new Date(),
      },
      create: {
        id: product.id,
        shop,
        title: product.title,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.productType,
        priceMin: priceMin,
        priceMax: priceMax,
        tags: product.tags,
        images: imageUrls,
        options: optionsList,
        status: product.status.toLowerCase(),
      },
    });

    // 2. Delete existing relations
    await tx.variant.deleteMany({ where: { productId: product.id } });
    await tx.productCollection.deleteMany({ where: { productId: product.id } });
    await tx.productMetafield.deleteMany({ where: { productId: product.id } });

    // 3. Create Variants
    for (const variant of product.variants.nodes) {
      let option1 = null;
      let option2 = null;
      let option3 = null;

      variant.selectedOptions.forEach(selOpt => {
        const optIndex = optionsList.findIndex(o => o.name === selOpt.name);
        if (optIndex === 0) option1 = selOpt.value;
        else if (optIndex === 1) option2 = selOpt.value;
        else if (optIndex === 2) option3 = selOpt.value;
      });

      // Use Shopify's availableForSale as the single source of truth.
      // Shopify internally handles all location logic (App warehouses, 3PLs, etc.)
      const available = variant.availableForSale === true;
      const inventory = variant.inventoryQuantity || 0;

      await tx.variant.create({
        data: {
          id: variant.id,
          productId: product.id,
          price: parseFloat(variant.price),
          compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
          available: available,
          inventory: inventory,
          imageUrl: variant.image?.url || null,
          option1,
          option2,
          option3,
        },
      });
    }

    // 4. Create Collections
    for (const collection of product.collections.nodes) {
      await tx.collection.upsert({
        where: { id: collection.id },
        update: {
          title: collection.title,
          handle: collection.handle,
        },
        create: {
          id: collection.id,
          shop,
          title: collection.title,
          handle: collection.handle,
        },
      });

      await tx.productCollection.create({
        data: {
          productId: product.id,
          collectionId: collection.id,
        },
      });
    }

    // 5. Create Metafields
    if (product.metafields) {
      for (const metafield of product.metafields) {
        if (metafield && metafield.value) {
          await tx.productMetafield.create({
            data: {
              id: metafield.id,
              productId: product.id,
              namespace: metafield.namespace,
              key: metafield.key,
              value: metafield.value,
              type: metafield.type,
            },
          });
        }
      }
    }
  });

  // Auto-seed any new option filter types discovered from this product
  await autoSeedOptionFilters(shop);

  console.log(`CFP: Sync complete for single product ${productId}.`);
  return product;
}
