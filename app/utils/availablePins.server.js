// Pin eligibility uses purchase availability, including continue-selling variants.
export async function availablePins(prisma, shop, products) {
  let pins = products;
  if (typeof pins === "string") {
    try { pins = JSON.parse(pins); } catch { return []; }
  }
  if (!Array.isArray(pins) || !pins.length) return [];
  const eligible = await prisma.product.findMany({
    where: { shop, id: { in: pins.map(pin => pin.id) },
      status: { equals: "active", mode: "insensitive" },
      variants: { some: { available: true } },
    },
    select: { id: true },
  });
  const ids = new Set(eligible.map(product => product.id));
  return pins.filter(pin => ids.has(pin.id));
}
