import redis from "./redis.server";

/**
 * Basic Redis Rate Limiter to protect the direct APIs
 * @param {Request} request 
 * @param {number} limit Max requests per window
 * @param {number} windowSec Time window in seconds
 * @returns {Promise<boolean>} True if allowed, false if rate limited
 */
export async function rateLimit(request, limit = 150, windowSec = 60) {
  try {
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown-ip";
    // We also namespace by shop to prevent one shop's users from affecting another
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || "unknown-shop";
    
    // Key format: ratelimit:myshop.myshopify.com:192.168.1.1
    const key = `ratelimit:${shop}:${ip}`;
    
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSec);
    }
    
    return current <= limit;
  } catch (error) {
    console.error("CFP Rate Limiter Error (Failing Open):", error);
    return true; // Fail open so we don't break the storefront if Redis is down
  }
}
