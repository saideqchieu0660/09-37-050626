let isTripped = false;
let failureCount = 0;
let penaltyTier = 0;
let cooldownTimer: NodeJS.Timeout | NodeJS.Timer | null = null;
const lastRequestTimes = new Map<string, number>();

const MAX_FAILURES = 3;

function getCooldownTime() {
  if (penaltyTier === 1) return 5000;
  if (penaltyTier === 2) return 15000;
  return 30000;
}

function handleFailure() {
  failureCount++;
  if (failureCount >= MAX_FAILURES) {
    isTripped = true;
    penaltyTier++;
    const cooldownTime = getCooldownTime();
    
    if (cooldownTimer) {
      clearTimeout(cooldownTimer as any);
    }
    
    console.warn(`Circuit Breaker tripped! Blocking requests for ${cooldownTime / 1000} seconds. Tier: ${penaltyTier}`);
    cooldownTimer = setTimeout(() => {
      isTripped = false;
      failureCount = 0;
      console.log('Circuit Breaker reset: System operational again.');
    }, cooldownTime);
  }
}

function resetCircuitBreaker() {
  failureCount = 0;
  penaltyTier = 0;
  isTripped = false;
}

export async function safeRequest(url: string, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const endpointBase = url.split('?')[0];
  const lastTime = lastRequestTimes.get(endpointBase) || 0;
  
  if (now - lastTime < 200) {
    console.warn('SPAM PREVENTED: Blocked rapid request to', url);
    throw new Error('Thao tác quá nhanh. Vui lòng chậm lại một chút.');
  }
  lastRequestTimes.set(endpointBase, now);

  if (isTripped) {
    console.error('CRITICAL WARNING: Circuit Breaker is active. Outbound request blocked.', url);
    const time = getCooldownTime() / 1000;
    
    // Dispatch global error for UI display
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent('global-api-error', { 
        detail: { message: `Circuit Breaker active. Thử lại sau ${time}s.`, path: url } 
      }));
    }
    
    throw new Error(`Hệ thống đang bảo trì tự động. Vui lòng thử lại sau ${time} giây.`);
  }

  try {
    const response = await fetch(url, options);
    
    if (response.status >= 500 || response.status === 404) {
      handleFailure();
    } else {
      resetCircuitBreaker();
    }
    
    if (!response.ok) {
      // Clone response to safely read JSON without impacting consumer text/json
      let errorData;
      try {
        const clonedResponse = response.clone();
        errorData = await clonedResponse.json();
      } catch (e) {
        errorData = { message: `HTTP Error ${response.status}: ${response.statusText}`, path: url };
      }
      
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent('global-api-error', { 
          detail: { 
            message: errorData.message || 'Lỗi không xác định từ máy chủ', 
            path: errorData.path || url,
            stack: errorData.stack 
          } 
        }));
      }
    }
    
    return response;
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      handleFailure();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent('global-api-error', { 
          detail: { message: error.message || 'Không thể kết nối đến máy chủ', path: url } 
        }));
      }
    }
    throw error;
  }
}
