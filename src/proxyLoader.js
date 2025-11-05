import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      console.error(`[ProxyLoader] Invalid URL format: ${proxyString}`, e.message);
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
      console.error(`[ProxyLoader] Invalid format: ${proxyString}`);
      return null;
    }
  }

  return proxy.host && proxy.port ? proxy : null;
}

/**
 * Load proxies from file
 */
export function loadProxies(proxyFile) {
  const proxyFilePath = path.resolve(proxyFile);
  
  console.log(`[ProxyLoader] Loading proxies from: ${proxyFilePath}`);
  
  if (!fs.existsSync(proxyFilePath)) {
    console.warn(`[ProxyLoader] Proxy file not found: ${proxyFilePath}`);
    return [];
  }

  try {
    const content = fs.readFileSync(proxyFilePath, 'utf-8');
    const lines = content.split('\n');
    
    const proxies = [];
    for (const line of lines) {
      const parsed = parseProxy(line);
      if (parsed) {
        proxies.push(parsed);
      }
    }

    console.log(`[ProxyLoader] Loaded ${proxies.length} valid proxies`);
    return proxies;
  } catch (error) {
    console.error(`[ProxyLoader] Error reading proxy file:`, error.message);
    return [];
  }
}

