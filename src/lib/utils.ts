import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get the correct URL for navigation based on the current context
 * @param subdomain - The user's subdomain
 * @param path - The path to navigate to (e.g., "/topic/chapter/page")
 * @param isClientSide - Whether this is being called from client-side code
 * @returns The correctly formatted URL
 */
export function getNavigationUrl(
  subdomain: string, 
  path: string, 
  isClientSide: boolean = false
): string {
  // On client-side, we can check the current hostname
  if (isClientSide && typeof window !== 'undefined') {
    const hostname = window.location.hostname
    const isMainDomain = hostname === 'localhost' || hostname === 'eduskript.org' || hostname === 'www.eduskript.org'
    const isOnSubdomain = !isMainDomain && (hostname.endsWith('.localhost') || hostname.endsWith('.eduskript.org'))
    
    return isOnSubdomain ? path : `/${subdomain}${path}`
  }
  
  // On server-side, we default to the full path with subdomain
  // This works for direct access and will be rewritten by middleware for subdomain access
  return `/${subdomain}${path}`
}

/**
 * Client-side hook to get the correct navigation URL
 * This should only be used in client components
 */
export function useNavigationUrl(subdomain: string, path: string): string {
  return getNavigationUrl(subdomain, path, true)
}
