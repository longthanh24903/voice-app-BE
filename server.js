import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import { ProxyRotator } from "./src/proxyRotator.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FORWARD_SECRET = process.env.FORWARD_SECRET || "";

// Middleware
app.use(
  cors({
    origin: true, // Allow all origins, or specify: ['http://localhost:4000', 'http://localhost:5173']
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-forward-secret"],
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize proxy rotator with empty list (proxies will be added via API)
const proxyRotator = new ProxyRotator([]);

console.log(`[Server] Started with ${proxyRotator.getProxyCount()} proxies`);
console.log(`[Server] Proxies must be added via POST /api/proxies endpoint`);
console.log(
  `[Server] Forward secret: ${
    FORWARD_SECRET ? "Configured" : "Not configured (public access allowed)"
  }`
);

/**
 * Middleware to check secret header
 */
function checkSecret(req, res, next) {
  if (!FORWARD_SECRET) {
    // No secret configured, allow all requests
    return next();
  }

  const providedSecret = req.headers["x-forward-secret"];
  if (providedSecret !== FORWARD_SECRET) {
    console.warn(`[Server] Unauthorized request from ${req.ip}`);
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing x-forward-secret header",
    });
  }

  next();
}

/**
 * Create proxy agent from proxy config
 */
function createProxyAgent(proxy, targetUrl) {
  const proxyUrl = proxy.auth
    ? `http://${proxy.auth.username}:${proxy.auth.password}@${proxy.host}:${proxy.port}`
    : `http://${proxy.host}:${proxy.port}`;

  return targetUrl.startsWith("https://")
    ? new HttpsProxyAgent(proxyUrl)
    : new HttpProxyAgent(proxyUrl);
}

/**
 * Make request through proxy with retry logic
 * Retries until success or all proxies exhausted
 */
async function makeProxyRequest(url, method, headers, body) {
  let lastError = null;
  let attempt = 0;
  proxyRotator.resetFailedProxies();

  // Check if proxies are available
  if (proxyRotator.getProxyCount() === 0) {
    throw new Error(
      "No proxies configured. Please add proxies via POST /api/proxies endpoint"
    );
  }

  const totalProxies = proxyRotator.getProxyCount();
  const maxAttempts = totalProxies * 2; // Safety limit: try at most 2x total proxies

  while (true) {
    attempt++;

    // Safety check to prevent infinite loop
    if (attempt > maxAttempts) {
      console.error(
        `[ProxyRequest] Max attempts (${maxAttempts}) reached. Stopping retry.`
      );
      throw new Error(
        `Request failed after ${maxAttempts} attempts. Last error: ${lastError?.message}`
      );
    }

    const selected = proxyRotator.getRandomProxy();

    if (!selected || !selected.proxy) {
      // Check if we still have proxies available (not failed and not all used today)
      const remaining = proxyRotator.getRemainingProxiesCount();
      const failed = proxyRotator.failedProxies.size;

      if (remaining === 0 && failed < totalProxies) {
        // All proxies used today but not all failed - wait for reset or use fallback
        console.log(
          `[ProxyRequest] All proxies used today. Waiting for reset...`
        );
        // Reset will happen automatically on next getRandomProxy call
        // But for now, try to use any available proxy
        proxyRotator.resetFailedProxies();
        continue;
      }

      if (failed >= totalProxies) {
        // All proxies failed in this request
        console.error(`[ProxyRequest] All ${totalProxies} proxies failed.`);
        throw new Error(
          `All proxies failed. Last error: ${lastError?.message}`
        );
      }

      throw new Error(
        "No proxies available. Please check your proxy configuration."
      );
    }

    const { proxy: currentProxy, index: proxyIndex } = selected;
    const proxyString = proxyRotator.formatProxy(currentProxy);

    const remaining = proxyRotator.getRemainingProxiesCount();
    const daysRemaining = proxyRotator.getDaysRemainingInPeriod();
    console.log(
      `[ProxyRequest] Attempt ${attempt} - Using proxy: ${proxyString} (${remaining} remaining in 2-day period, ${daysRemaining} day(s) left)`
    );

    try {
      const agent = createProxyAgent(currentProxy, url);

      // Filter out problematic headers
      const filteredHeaders = { ...headers };
      delete filteredHeaders["host"];
      delete filteredHeaders["Host"];

      // Detect if response should be binary (audio, images, etc.)
      const isBinaryRequest =
        url.includes("/text-to-speech/") ||
        filteredHeaders["Accept"]?.includes("audio/") ||
        filteredHeaders["accept"]?.includes("audio/");

      const config = {
        method: method || "GET",
        url: url,
        headers: filteredHeaders,
        httpAgent: agent,
        httpsAgent: agent,
        timeout: 30000, // 30 seconds
        validateStatus: () => true, // Accept all status codes
        responseType: isBinaryRequest ? "arraybuffer" : "json", // Use arraybuffer for binary, json for text
      };

      // Add body for POST, PUT, PATCH
      if (body && ["POST", "PUT", "PATCH"].includes(method?.toUpperCase())) {
        config.data = body;
      }

      const response = await axios(config);

      console.log(
        `[ProxyRequest] Success - Proxy: ${proxyString}, Status: ${response.status}, Attempt: ${attempt}`
      );

      // Mark proxy as successfully used today (only if request was successful)
      // Note: We accept all status codes (validateStatus: () => true), so check status here
      if (response.status >= 200 && response.status < 300) {
        proxyRotator.markUsedToday(proxyIndex);
      } else {
        // Non-2xx status codes are treated as failures for proxy rotation
        proxyRotator.markFailed(proxyIndex);
        throw new Error(`Request failed with status ${response.status}`);
      }

      // Handle response body based on responseType
      let responseBody = response.data;

      if (isBinaryRequest) {
        // For binary responses, convert to Buffer
        if (Buffer.isBuffer(response.data)) {
          responseBody = response.data;
        } else if (response.data instanceof ArrayBuffer) {
          responseBody = Buffer.from(response.data);
        } else if (response.data instanceof Uint8Array) {
          responseBody = Buffer.from(response.data);
        } else {
          // Fallback: try to convert to Buffer
          responseBody = Buffer.from(response.data);
        }
      } else {
        // For JSON/text responses, keep as is (axios already parsed JSON)
        responseBody = response.data;
      }

      return {
        success: true,
        status: response.status,
        headers: response.headers,
        body: responseBody,
        proxyUsed: proxyRotator.formatProxy(currentProxy), // Include proxy info for logging
      };
    } catch (error) {
      lastError = error;
      
      // Only mark as failed if we have a valid proxy index
      if (proxyIndex !== null && proxyIndex !== undefined) {
        proxyRotator.markFailed(proxyIndex);
      }

      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.error(
        `[ProxyRequest] Failed - Proxy: ${proxyString}, Error: ${errorMessage}`
      );
      console.log(
        `[ProxyRequest] Retrying with different proxy... (${attempt}/${maxAttempts} attempts)`
      );

      // Continue to next iteration to try another proxy
      continue;
    }
  }
}

/**
 * POST /api/proxy-request
 */
app.post("/api/proxy-request", checkSecret, async (req, res) => {
  try {
    const { url, method, headers, body } = req.body;

    // Validation
    if (!url) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing required field: url",
      });
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return res.status(400).json({
        error: "Bad Request",
        message: "URL must start with http:// or https://",
      });
    }

    console.log(`[Server] New request: ${method || "GET"} ${url}`);

    const result = await makeProxyRequest(url, method, headers, body);

    // Return original response
    res.status(result.status);

    // Add proxy info to response header for frontend logging
    // This will be set in makeProxyRequest function
    if (result.proxyUsed) {
      res.setHeader("x-proxy-used", result.proxyUsed);
    }

    // Set response headers
    Object.keys(result.headers).forEach((key) => {
      // Skip certain headers that shouldn't be forwarded
      const skipHeaders = [
        "content-encoding",
        "transfer-encoding",
        "connection",
        "content-length",
      ];
      if (!skipHeaders.includes(key.toLowerCase())) {
        try {
          res.setHeader(key, result.headers[key]);
        } catch (e) {
          // Skip invalid headers
          console.warn(`[Server] Skipping invalid header: ${key}`);
        }
      }
    });

    // Send response body (handle both JSON and other formats)
    const contentType =
      result.headers["content-type"] || result.headers["Content-Type"] || "";

    // Check if body is Buffer (binary) or object/string (JSON/text)
    if (Buffer.isBuffer(result.body)) {
      // Binary response (audio, images, etc.)
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.send(result.body);
    } else if (
      contentType.includes("application/json") ||
      (typeof result.body === "object" && result.body !== null && !Buffer.isBuffer(result.body))
    ) {
      // JSON response (but not Buffer)
      res.json(result.body);
    } else if (result.body !== null && result.body !== undefined) {
      // Text or other format (but not null/undefined)
      res.send(result.body);
    } else {
      // Empty body
      res.end();
    }
  } catch (error) {
    console.error(`[Server] Error processing request:`, error.message);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
});

/**
 * Parse proxy string from various formats
 * Supports: ip:port:user:pass or http://user:pass@ip:port
 */
function parseProxy(proxyString) {
  proxyString = proxyString.trim();
  if (!proxyString) return null;

  let proxy = {
    host: '',
    port: '',
    auth: null
  };

  // Format: http://user:pass@ip:port
  if (proxyString.startsWith('http://') || proxyString.startsWith('https://')) {
    try {
      const url = new URL(proxyString);
      proxy.host = url.hostname;
      proxy.port = url.port || (proxyString.startsWith('https') ? '443' : '80');
      
      if (url.username && url.password) {
        proxy.auth = {
          username: url.username,
          password: url.password
        };
      }
    } catch (e) {
      console.error(`[Server] Invalid URL format: ${proxyString}`, e.message);
      return null;
    }
  } 
  // Format: ip:port:user:pass
  else {
    const parts = proxyString.split(':');
    if (parts.length >= 2) {
      proxy.host = parts[0];
      proxy.port = parts[1];
      
      if (parts.length >= 4) {
        proxy.auth = {
          username: parts[2],
          password: parts.slice(3).join(':') // Handle passwords with colons
        };
      }
    } else {
      console.error(`[Server] Invalid format: ${proxyString}`);
      return null;
    }
  }

  return proxy.host && proxy.port ? proxy : null;
}

/**
 * POST /api/proxies - Update proxy list from frontend
 */
app.post("/api/proxies", checkSecret, async (req, res) => {
  try {
    const { proxies: proxyStrings } = req.body;

    if (!proxyStrings || typeof proxyStrings !== 'string') {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing or invalid 'proxies' field. Expected string with newline-separated proxies.",
      });
    }

    // Parse proxy strings
    const lines = proxyStrings.split(/\r?\n/);
    const parsedProxies = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      const parsed = parseProxy(trimmed);
      if (parsed) {
        parsedProxies.push(parsed);
      } else {
        console.warn(`[Server] Skipping invalid proxy: ${trimmed}`);
      }
    }

    if (parsedProxies.length === 0) {
      return res.status(400).json({
        error: "Bad Request",
        message: "No valid proxies found in request",
      });
    }

    // Update proxy rotator with new proxies
    proxyRotator.updateProxies(parsedProxies);

    console.log(`[Server] Updated proxy list: ${parsedProxies.length} proxies loaded`);

    res.json({
      success: true,
      message: `Successfully updated ${parsedProxies.length} proxies`,
      count: parsedProxies.length,
    });
  } catch (error) {
    console.error(`[Server] Error updating proxies:`, error.message);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
});

/**
 * GET /api/proxies - Get current proxy list (without sensitive info)
 */
app.get("/api/proxies", checkSecret, (req, res) => {
  try {
    const count = proxyRotator.getProxyCount();
    res.json({
      success: true,
      count: count,
      message: count > 0 ? `${count} proxies configured` : "No proxies configured",
    });
  } catch (error) {
    console.error(`[Server] Error getting proxies:`, error.message);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
});

/**
 * GET /health
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    proxies: proxyRotator.getProxyCount(),
    uptime: process.uptime(),
  });
});

app.get("/ping", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.type("text").send("ok");
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  console.log(
    `[Server] Proxy endpoint: http://localhost:${PORT}/api/proxy-request`
  );
});
