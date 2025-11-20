'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface CustomDomainHandlerProps {
  children: React.ReactNode
}

// Browser-side cache for custom domain mappings
const domainCache = new Map<string, { subdomain: string; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 60 * 1000 // 5 hours
const STORAGE_KEY = 'eduskript_domain_cache'

type CachedDomainInfo = { subdomain: string; timestamp: number }

function loadCacheFromStorage(): void {
  if (typeof window === 'undefined') return
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      Object.entries(data).forEach(([hostname, info]) => {
        // Only load if not expired
        if (Date.now() - (info as CachedDomainInfo).timestamp < CACHE_DURATION) {
          domainCache.set(hostname, info as CachedDomainInfo)
        }
      })
    }
  } catch (error) {
    console.warn('Failed to load domain cache from localStorage:', error)
  }
}

function saveCacheToStorage(): void {
  if (typeof window === 'undefined') return
  
  try {
    const data: Record<string, CachedDomainInfo> = {}
    domainCache.forEach((info, hostname) => {
      // Only save non-expired entries
      if (Date.now() - info.timestamp < CACHE_DURATION) {
        data[hostname] = info
      }
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('Failed to save domain cache to localStorage:', error)
  }
}

function getCachedDomain(hostname: string): string | null {
  const cached = domainCache.get(hostname)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.subdomain
  }
  return null
}

function setCachedDomain(hostname: string, subdomain: string): void {
  domainCache.set(hostname, { subdomain, timestamp: Date.now() })
  saveCacheToStorage()
}

export function CustomDomainHandler({ children }: CustomDomainHandlerProps) {
  const [isChecking, setIsChecking] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  
  // Debug mode - can be enabled via URL parameter
  const isDebugMode = typeof window !== 'undefined' && 
    new URLSearchParams(window.location.search).has('debug_custom_domain')

  useEffect(() => {
    // Load cache from localStorage on mount
    loadCacheFromStorage()
    
    const checkCustomDomain = async () => {
      try {
        const hostname = window.location.hostname

        // Skip check for localhost and known main domains (unless in debug mode)
        if (!isDebugMode && (hostname === 'localhost' ||
            hostname === 'eduskript.org' ||
            hostname === 'www.eduskript.org')) {
          setIsChecking(false)
          return
        }

        // Check if this is a native subdomain (e.g., eduadmin.eduskript.org)
        // The proxy middleware handles the rewriting for these, so no client-side redirect needed
        if (!isDebugMode && hostname.endsWith('.eduskript.org')) {
          setIsChecking(false)
          return
        }

        // Skip localhost subdomains (e.g., eduadmin.localhost) for development
        // The proxy middleware handles the rewriting for these, so no client-side redirect needed
        if (!isDebugMode && hostname.endsWith('.localhost')) {
          setIsChecking(false)
          return
        }
        
        // In debug mode, simulate a custom domain
        if (isDebugMode && hostname === 'localhost') {
          const mockData = { isCustomDomain: true, subdomain: 'subdomaintry' }
          
          const subdomainPrefix = `/${mockData.subdomain}`
          
          if (!pathname.startsWith(subdomainPrefix)) {
            const expectedPath = `${subdomainPrefix}${pathname}`
            router.replace(expectedPath)
            return
          }
          
          setIsChecking(false)
          return
        }

        // Check cache first (now includes localStorage)
        const cachedSubdomain = getCachedDomain(hostname)
        if (cachedSubdomain) {
          const subdomainPrefix = `/${cachedSubdomain}`
          
          if (!pathname.startsWith(subdomainPrefix)) {
            const expectedPath = `${subdomainPrefix}${pathname}`
            router.replace(expectedPath)
            return
          }
          
          setIsChecking(false)
          return
        }

        // Check if this hostname is a custom domain via API
        const response = await fetch(`/api/public/resolve-domain?domain=${encodeURIComponent(hostname)}`)
        const data = await response.json()

        if (data.isCustomDomain && data.subdomain) {
          // Cache the result (saves to localStorage)
          setCachedDomain(hostname, data.subdomain)
          
          // Check if we're already on the correct subdomain path
          const subdomainPrefix = `/${data.subdomain}`
          
          // If we're not already under the subdomain path, redirect
          if (!pathname.startsWith(subdomainPrefix)) {
            const expectedPath = `${subdomainPrefix}${pathname}`
            router.replace(expectedPath)
            return
          }
        }

      } catch (error) {
        console.error('Error checking custom domain:', error)
      } finally {
        setIsChecking(false)
      }
    }

    checkCustomDomain()
  }, [pathname, router, isDebugMode])

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
} 