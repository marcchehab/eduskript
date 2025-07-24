'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface CustomDomainHandlerProps {
  children: React.ReactNode
}

export function CustomDomainHandler({ children }: CustomDomainHandlerProps) {
  const [isChecking, setIsChecking] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  
  // Debug mode - can be enabled via URL parameter
  const isDebugMode = typeof window !== 'undefined' && 
    new URLSearchParams(window.location.search).has('debug_custom_domain')

  useEffect(() => {
    const checkCustomDomain = async () => {
      try {
        const hostname = window.location.hostname
        
        // Skip check for localhost and known main domains (unless in debug mode)
        if (!isDebugMode && (hostname === 'localhost' || 
            hostname === 'eduskript.org' || 
            hostname === 'www.eduskript.org' ||
            hostname.endsWith('.localhost'))) {
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

        // Check if this hostname is a custom domain
        const response = await fetch(`/api/public/resolve-domain?domain=${encodeURIComponent(hostname)}`)
        const data = await response.json()

        if (data.isCustomDomain && data.subdomain) {
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
  }, [pathname, router])

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