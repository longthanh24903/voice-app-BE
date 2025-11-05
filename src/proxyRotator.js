/**
 * Proxy Rotator - Manages proxy selection and rotation
 */
export class ProxyRotator {
  constructor(proxies) {
    this.proxies = proxies || [];
    this.failedProxies = new Set(); // Track failed proxies for current request
    this.usedProxiesToday = new Set(); // Track proxies used in current 2-day period (by index)
    this.periodStartDate = this.getCurrentDate(); // Track when current 2-day period started
  }

  /**
   * Get current date string (YYYY-MM-DD) for day tracking
   */
  getCurrentDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * Get number of days since period start
   */
  getDaysSincePeriodStart() {
    const start = new Date(this.periodStartDate);
    const today = new Date(this.getCurrentDate());
    const diffTime = Math.abs(today - start);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Check if we need to reset 2-day period usage (after 2 days or all proxies used)
   */
  checkAndResetDailyUsage() {
    const today = this.getCurrentDate();
    const daysElapsed = this.getDaysSincePeriodStart();
    
    // If 2 days have passed since period start, reset everything
    if (daysElapsed >= 2) {
      console.log(`[ProxyRotator] 2-day period completed (${daysElapsed} days). Resetting proxy usage.`);
      this.usedProxiesToday.clear();
      this.periodStartDate = today;
      return;
    }

    // If all proxies have been used in current period, reset for new cycle
    if (this.usedProxiesToday.size >= this.proxies.length) {
      console.log(`[ProxyRotator] All ${this.proxies.length} proxies have been used in current 2-day period. Resetting for new cycle.`);
      this.usedProxiesToday.clear();
    }
  }

  /**
   * Get a random proxy from available proxies (not used in current 2-day period and not failed)
   * Note: This does NOT mark proxy as used - that should be done after successful request
   */
  getRandomProxy() {
    if (this.proxies.length === 0) {
      return null;
    }

    // Check if we need to reset 2-day period usage
    this.checkAndResetDailyUsage();

    // Filter out:
    // 1. Proxies already used in current 2-day period (successful requests)
    // 2. Proxies that failed in current request
    const availableProxies = this.proxies
      .map((proxy, index) => ({ proxy, index }))
      .filter(({ index }) => 
        !this.usedProxiesToday.has(index) && 
        !this.failedProxies.has(index)
      );

    // If no available proxies (all used in period or all failed), check if we can reset
    if (availableProxies.length === 0) {
      // If all proxies used in current period, they should be reset by checkAndResetDailyUsage
      // But if still empty after reset, try to get any proxy that's not failed
      const fallbackProxies = this.proxies
        .map((proxy, index) => ({ proxy, index }))
        .filter(({ index }) => !this.failedProxies.has(index));
      
      if (fallbackProxies.length === 0) {
        // All proxies failed in current request
        return null;
      }

      // Use fallback (proxies that were used in period but not failed)
      // This happens when all proxies used but we need to retry
      const randomIndex = Math.floor(Math.random() * fallbackProxies.length);
      const selected = fallbackProxies[randomIndex];
      
      return {
        proxy: selected.proxy,
        index: selected.index
      };
    }

    // Select random proxy from available ones
    const randomIndex = Math.floor(Math.random() * availableProxies.length);
    const selected = availableProxies[randomIndex];

    // Note: Don't mark as used here - mark only after successful request
    return {
      proxy: selected.proxy,
      index: selected.index
    };
  }

  /**
   * Mark a proxy as successfully used in current 2-day period (call after successful request)
   */
  markUsedToday(proxyIndex) {
    if (proxyIndex !== null && proxyIndex !== undefined) {
      this.usedProxiesToday.add(proxyIndex);
    }
  }

  /**
   * Mark a proxy as failed
   */
  markFailed(proxyIndex) {
    if (proxyIndex !== null && proxyIndex !== undefined) {
      this.failedProxies.add(proxyIndex);
    }
  }

  /**
   * Reset failed proxies (for new request cycle)
   */
  resetFailedProxies() {
    this.failedProxies.clear();
  }

  /**
   * Get count of proxies used in current 2-day period
   */
  getUsedProxiesCount() {
    this.checkAndResetDailyUsage();
    return this.usedProxiesToday.size;
  }

  /**
   * Get remaining proxies available in current 2-day period
   */
  getRemainingProxiesCount() {
    this.checkAndResetDailyUsage();
    const total = this.proxies.length;
    const used = this.usedProxiesToday.size;
    return Math.max(0, total - used);
  }

  /**
   * Get days remaining in current period
   */
  getDaysRemainingInPeriod() {
    const daysElapsed = this.getDaysSincePeriodStart();
    return Math.max(0, 2 - daysElapsed);
  }

  /**
   * Get proxy count
   */
  getProxyCount() {
    return this.proxies.length;
  }

  /**
   * Format proxy string for logging
   */
  formatProxy(proxy) {
    if (!proxy) return 'None';
    const authStr = proxy.auth 
      ? `${proxy.auth.username}:${proxy.auth.password}@` 
      : '';
    return `${authStr}${proxy.host}:${proxy.port}`;
  }
}

