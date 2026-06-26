import prisma from "../db.server";
import meiliClient from "./meiliClient.server";

/**
 * Format products and push to Meilisearch index.
 * Expects products to have variants, collections, and metafields included.
 */
export async function formatAndPushToMeili(products) {
  if (!products || products.length === 0) return;

  const documents = products.map((p) => {
    // Determine overall availability
    const available = p.variants ? p.variants.some((v) => v.available) : false;

    // Format options as option_Name: [values]
    const formattedOptions = {};
    if (p.options) {
      p.options.forEach((opt) => {
        const values = Array.isArray(opt.values) ? opt.values : [opt.values];
        formattedOptions[`option_${opt.name}`] = values;
      });
    }

    // Format metafields as metafield_namespace_key: value
    const formattedMetafields = {};
    if (p.metafields) {
      p.metafields.forEach((m) => {
        formattedMetafields[`metafield_${m.namespace}.${m.key}`] = m.value;
      });
    }

    return {
      id: p.id.split("/").pop(),
      shop: p.shop,
      title: p.title,
      vendor: p.vendor,
      productType: p.productType,
      priceMin: parseFloat(p.priceMin),
      priceMax: parseFloat(p.priceMax),
      tags: p.tags || [],
      collections: p.collections ? p.collections.map((c) => c.collectionId) : [],
      available,
      createdAt: p.createdAt ? p.createdAt.getTime() : Date.now(),
      ...formattedOptions,
      ...formattedMetafields,
    };
  });

  try {
    const index = meiliClient.index("products");
    const task = await index.addDocuments(documents);
    console.log(`CFP: Pushed ${documents.length} products to Meilisearch (Task ID: ${task.taskUid})`);
  } catch (error) {
    console.error("CFP: Failed to push to Meilisearch", error);
  }
}

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
        data: {
          shop,
          type: "option",
          key: optName,
          label: optName,
          order: nextOrder++,
          isEnabled: true,
        },
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
  console.log(`CFP: Initializing background product sync for ${shop}...`);

  // Create a pending sync job
  const job = await prisma.syncJob.create({
    data: {
      shop,
      status: "IN_PROGRESS",
    },
  });

  // Start background processing without awaiting it
  processSyncChunk(job.id, shop, admin).catch((err) => {
    console.error(`CFP: Background sync failed for ${shop}`, err);
  });

  return { jobId: job.id, message: "Sync started in background" };
}

async function processSyncChunk(jobId, shop, admin) {
  let job = await prisma.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "IN_PROGRESS") return;

  const metafieldSettings = await prisma.filterSetting.findMany({
    where: { shop, type: "metafield" },
  });

  const metafieldIdentifiers = metafieldSettings
    .filter((s) => s.key && s.key.includes("."))
    .map((s) => {
      const [namespace, key] = s.key.split(".");
      return { namespace, key };
    });

  const metafieldQueryPart =
    metafieldIdentifiers.length > 0
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
          images(first: 250) {
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
              sku
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
  let cursor = job.cursor;
  
  // We process in a while loop but we save state every chunk
  while (hasNextPage) {
    try {
      const variables = { cursor };
      if (metafieldIdentifiers.length > 0) {
        variables.metafieldIdentifiers = metafieldIdentifiers;
      }

      const response = await admin.graphql(query, { variables });
      const responseJson = await response.json();

      if (responseJson.errors) {
        throw new Error("GraphQL Errors: " + JSON.stringify(responseJson.errors));
      }

      const productsData = responseJson.data?.products;
      if (!productsData || productsData.nodes.length === 0) break;
      const products = productsData.nodes;
      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;

      // Smart Upsert for each product
      for (const product of products) {
        await smartUpsertProduct(shop, product, prisma);
      }

      // Fetch the newly updated products from DB and push to Meilisearch
      const productIds = products.map((p) => p.id.split("/").pop());
      const dbProducts = await prisma.product.findMany({
        where: { id: { in: productIds.map(id => `gid://shopify/Product/${id}`) } },
        include: {
          variants: true,
          collections: { select: { collectionId: true } },
          metafields: true,
        },
      });

      if (dbProducts.length > 0) {
        await formatAndPushToMeili(dbProducts);
      }

      // Update Job State
      job = await prisma.syncJob.update({
        where: { id: jobId },
        data: {
          cursor: cursor,
          productsProcessed: { increment: products.length },
          status: hasNextPage ? "IN_PROGRESS" : "COMPLETED",
        },
      });

      console.log(`CFP: SyncJob ${jobId} processed ${job.productsProcessed} products so far.`);
      
      // Small delay to yield event loop
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (err) {
      console.error(`CFP: Error processing chunk for job ${jobId}`, err);
      await prisma.syncJob.update({
        where: { id: jobId },
        data: { status: "FAILED" },
      });
      break;
    }
  }

  if (!hasNextPage) {
    await autoSeedOptionFilters(shop);
    console.log(`CFP: Background sync complete for ${shop}. Job ID: ${jobId}`);
  }
}

// Function for smart upserting
export async function smartUpsertProduct(shop, product, prismaClient) {
  const optionsList = product.options.map((opt) => ({
    name: opt.name,
    values: opt.values,
  }));

  const prices = product.variants.nodes.map((v) => parseFloat(v.price));
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  const imageUrls = product.images.nodes.map((img) => img.url);

  await prismaClient.$transaction(async (tx) => {
    // Upsert the core Product
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

    // Smart Sync Variants
    const existingVariants = await tx.variant.findMany({
      where: { productId: product.id },
      select: { id: true },
    });
    const incomingVariantIds = product.variants.nodes.map(v => v.id);
    const variantsToDelete = existingVariants.filter(ev => !incomingVariantIds.includes(ev.id)).map(v => v.id);
    
    if (variantsToDelete.length > 0) {
      await tx.variant.deleteMany({ where: { id: { in: variantsToDelete } } });
    }

    for (const variant of product.variants.nodes) {
      let option1 = null, option2 = null, option3 = null;
      variant.selectedOptions.forEach((selOpt) => {
        const optIndex = optionsList.findIndex((o) => o.name === selOpt.name);
        if (optIndex === 0) option1 = selOpt.value;
        else if (optIndex === 1) option2 = selOpt.value;
        else if (optIndex === 2) option3 = selOpt.value;
      });

      const available = variant.availableForSale === true;
      const inventory = variant.inventoryQuantity || 0;

      await tx.variant.upsert({
        where: { id: variant.id },
        update: {
          sku: variant.sku || null,
          price: parseFloat(variant.price),
          compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
          available: available,
          inventory: inventory,
          imageUrl: variant.image?.url || null,
          option1, option2, option3,
        },
        create: {
          id: variant.id,
          productId: product.id,
          sku: variant.sku || null,
          price: parseFloat(variant.price),
          compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
          available: available,
          inventory: inventory,
          imageUrl: variant.image?.url || null,
          option1, option2, option3,
        }
      });
    }

    // Smart Sync Collections
    const existingCollections = await tx.productCollection.findMany({
      where: { productId: product.id },
      select: { collectionId: true }
    });
    const incomingCollectionIds = product.collections.nodes.map(c => c.id);
    const collectionsToDelete = existingCollections.filter(ec => !incomingCollectionIds.includes(ec.collectionId)).map(c => c.collectionId);

    if (collectionsToDelete.length > 0) {
      await tx.productCollection.deleteMany({
        where: { productId: product.id, collectionId: { in: collectionsToDelete } }
      });
    }

    for (const collection of product.collections.nodes) {
      await tx.collection.upsert({
        where: { id: collection.id },
        update: { title: collection.title, handle: collection.handle },
        create: { id: collection.id, shop, title: collection.title, handle: collection.handle },
      });

      if (!existingCollections.some(ec => ec.collectionId === collection.id)) {
        await tx.productCollection.create({
          data: { productId: product.id, collectionId: collection.id }
        });
      }
    }

    // Smart Sync Metafields
    if (product.metafields) {
      const existingMetafields = await tx.productMetafield.findMany({
        where: { productId: product.id },
        select: { id: true }
      });
      const validMetafields = product.metafields.filter(m => m && m.value);
      const incomingMetafieldIds = validMetafields.map(m => m.id);
      const metafieldsToDelete = existingMetafields.filter(em => !incomingMetafieldIds.includes(em.id)).map(m => m.id);

      if (metafieldsToDelete.length > 0) {
        await tx.productMetafield.deleteMany({ where: { id: { in: metafieldsToDelete } } });
      }

      for (const metafield of validMetafields) {
        await tx.productMetafield.upsert({
          where: { id: metafield.id },
          update: { value: metafield.value, type: metafield.type, namespace: metafield.namespace, key: metafield.key },
          create: { id: metafield.id, productId: product.id, namespace: metafield.namespace, key: metafield.key, value: metafield.value, type: metafield.type }
        });
      }
    }
  });
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

  const metafieldSettings = await prisma.filterSetting.findMany({
    where: { shop, type: "metafield" },
  });

  const metafieldIdentifiers = metafieldSettings
    .filter((s) => s.key && s.key.includes("."))
    .map((s) => {
      const [namespace, key] = s.key.split(".");
      return { namespace, key };
    });

  const metafieldQueryPart =
    metafieldIdentifiers.length > 0
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
        images(first: 250) {
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
            sku
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

  await smartUpsertProduct(shop, product, prisma);
  
  await autoSeedOptionFilters(shop);

  const dbProduct = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: true,
      collections: { select: { collectionId: true } },
      metafields: true,
    },
  });

  if (dbProduct) {
    await formatAndPushToMeili([dbProduct]);
  }

  console.log(`CFP: Sync complete for single product ${productId}.`);
  return dbProduct.id;
}
