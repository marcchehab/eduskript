# Custom Domain Implementation Proposal for Eduskript

## Overview

This proposal outlines how to implement custom domain support for Eduskript users, allowing them to serve their educational content on their own domains (e.g., `myschool.com`) instead of just subdomains (`myschool.eduskript.org`).

## Current State

✅ **What works now:**
- Subdomain routing: `username.eduskript.org` and `username.localhost:3000`
- Database schema supports `CustomDomain` model
- Basic API endpoints for custom domain management
- Middleware detects potential custom domains but doesn't handle them

## Architecture Overview

```
Custom Domain (myschool.com)
    ↓
CleverCloud Load Balancer
    ↓
Next.js Middleware (Domain Resolution)
    ↓
Eduskript Application
    ↓
User's Content (topics, chapters, pages)
```

## Implementation Strategy

### Phase 1: DNS and CleverCloud Configuration

#### 1.1 CleverCloud Domain Setup
**For each custom domain, users need to:**

1. **Add domain to CleverCloud application:**
   ```bash
   clever domain add myschool.com
   ```

2. **Configure DNS records at Namecheap:**
   - **CNAME Record** (recommended for most cases):
     ```
     Type: CNAME
     Host: @
     Value: domain.par.clever-cloud.com
     TTL: Automatic
     ```
   
   - **A Records** (alternative approach):
     ```
     Type: A
     Host: @
     Value: 185.42.117.108
     
     Type: A
     Host: @  
     Value: 185.42.117.109
     
     Type: A
     Host: @
     Value: 46.252.181.103
     
     Type: A
     Host: @
     Value: 46.252.181.104
     ```

3. **SSL Certificate:**
   - CleverCloud will automatically generate Let's Encrypt certificates
   - For immediate coverage, users can upload existing certificates first

#### 1.2 Subdomain Support
For subdomains like `www.myschool.com`:
```
Type: CNAME
Host: www
Value: domain.par.clever-cloud.com
TTL: Automatic
```

### Phase 2: Application-Level Implementation

#### 2.1 Enhanced Middleware
Update `src/middleware.ts` to handle custom domain resolution:

```typescript
// Enhanced custom domain handling
if (!isMainDomain && !isLocalhost && !subdomain) {
  // This might be a custom domain - query database
  try {
    const response = await fetch(`${process.env.NEXTAUTH_URL}/api/public/resolve-domain?domain=${hostname}`)
    const data = await response.json()
    
    if (data.subdomain) {
      // Rewrite to subdomain path
      const url = request.nextUrl.clone()
      url.pathname = `/${data.subdomain}${pathname}`
      return NextResponse.rewrite(url)
    }
  } catch (error) {
    // Fallback to 404 or error page
    console.log('Custom domain resolution failed:', error)
  }
}
```

#### 2.2 Database Optimization
Add caching for custom domain lookups:

```typescript
// Add to resolve-domain API
const DOMAIN_CACHE = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function GET(request: NextRequest) {
  const domain = searchParams.get('domain')
  
  // Check cache first
  const cached = DOMAIN_CACHE.get(domain)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }
  
  // ... existing database lookup logic
  
  // Cache the result
  DOMAIN_CACHE.set(domain, {
    data: result,
    timestamp: Date.now()
  })
}
```

#### 2.3 User Interface Enhancements
Add custom domain management to dashboard:

1. **Domain Settings Page** (`/dashboard/settings/domains`):
   - List current domains (subdomain + custom domains)
   - Add new custom domain form
   - DNS configuration instructions
   - Domain verification status
   - SSL certificate status

2. **Setup Wizard:**
   ```
   Step 1: Enter your domain
   Step 2: Configure DNS (with copy-paste values)
   Step 3: Verify domain ownership
   Step 4: Wait for SSL certificate
   Step 5: Test and go live
   ```

### Phase 3: DNS Management Automation (Future Enhancement)

#### 3.1 Namecheap API Integration
For advanced users, provide automated DNS configuration:

```typescript
// Optional: Namecheap API integration
const NAMECHEAP_API_ENDPOINT = 'https://api.namecheap.com/xml.response'

export async function configureNamecheapDNS(domain: string, userApiKey: string) {
  // Set CNAME record automatically
  const response = await fetch(NAMECHEAP_API_ENDPOINT, {
    method: 'POST',
    body: new URLSearchParams({
      ApiUser: userApiKey,
      Command: 'namecheap.domains.dns.setHosts',
      ClientIp: '...',
      Domain: domain,
      Type: 'CNAME',
      Name: '@',
      Address: 'domain.par.clever-cloud.com'
    })
  })
}
```

## Implementation Steps

### Step 1: Update Middleware (Week 1)
- [ ] Enhance domain detection logic
- [ ] Add database lookup for custom domains
- [ ] Implement caching layer
- [ ] Test with mock custom domains

### Step 2: User Interface (Week 2) 
- [ ] Create domain management page
- [ ] Add DNS configuration instructions
- [ ] Implement domain verification
- [ ] Add domain status indicators

### Step 3: Documentation & Support (Week 3)
- [ ] Create user guide for custom domain setup
- [ ] Document Namecheap DNS configuration
- [ ] Create troubleshooting guide
- [ ] Add domain validation API endpoints

### Step 4: Testing & Optimization (Week 4)
- [ ] Test with real custom domains
- [ ] Performance testing with cached lookups
- [ ] SSL certificate verification
- [ ] Edge case handling (invalid domains, etc.)

## DNS Configuration Examples

### For Namecheap Users

#### Primary Domain (myschool.com)
```
Type: CNAME
Host: @
Value: domain.par.clever-cloud.com
TTL: Automatic
```

#### WWW Subdomain (www.myschool.com)
```
Type: CNAME  
Host: www
Value: domain.par.clever-cloud.com
TTL: Automatic
```

#### Email Preservation (if needed)
If users need to keep email working on their domain:
```
Type: MX
Host: @
Value: existing-mail-server.com
Priority: 10
```

### For Other DNS Providers
The same CNAME approach works universally:
- **Cloudflare:** DNS → Records → Add CNAME
- **GoDaddy:** DNS Management → Records → Add CNAME
- **Route53:** Hosted Zone → Create Record → CNAME

## Security Considerations

### Domain Verification
1. **TXT Record Verification:**
   ```
   Type: TXT
   Host: _eduskript-verification
   Value: eduskript-verify-abc123xyz789
   ```

2. **File Upload Verification:**
   ```
   Upload file: myschool.com/.well-known/eduskript-verification.txt
   Content: abc123xyz789
   ```

### SSL Certificate Management
- CleverCloud handles automatic Let's Encrypt certificates
- 3-day window for initial certificate generation
- Automatic renewal every 60 days
- Custom certificate upload support for immediate coverage

### Domain Validation
- Prevent domain hijacking with ownership verification
- Rate limiting on domain addition (max 5 domains per user)
- Domain transfer protection (require email confirmation)

## Cost & Pricing Considerations

### For Users
- **DNS Configuration:** Free (they manage their own DNS)
- **SSL Certificates:** Free (Let's Encrypt via CleverCloud)
- **Custom Domains:** Could be a premium feature

### For Eduskript
- **CleverCloud costs:** No additional cost for domain routing
- **Development time:** ~4 weeks implementation
- **Support overhead:** Documentation and user help

## Migration Strategy

### For Existing Users
1. **Gradual rollout:** Invite-only beta first
2. **Backward compatibility:** Subdomains continue working
3. **Migration assistance:** Help users configure DNS
4. **Fallback support:** If custom domain fails, redirect to subdomain

### For New Users
1. **Onboarding flow:** Optional custom domain setup
2. **Default experience:** Start with subdomain, upgrade later
3. **Pro feature:** Custom domains for paid plans

## Success Metrics

### Technical Metrics
- [ ] Domain resolution time < 50ms (cached)
- [ ] SSL certificate success rate > 95%
- [ ] DNS propagation time < 24 hours
- [ ] Zero downtime during domain configuration

### User Metrics  
- [ ] Domain setup completion rate > 80%
- [ ] User satisfaction score > 4.5/5
- [ ] Support tickets < 5% of custom domain users
- [ ] Domain verification success rate > 90%

## Risk Assessment

### High Risk
- **DNS propagation delays:** Users may experience 24-48h delays
  - *Mitigation:* Clear documentation about timing expectations

### Medium Risk  
- **SSL certificate failures:** Let's Encrypt rate limits or validation issues
  - *Mitigation:* Fallback certificate upload option

### Low Risk
- **Performance impact:** Additional database lookups for custom domains
  - *Mitigation:* Aggressive caching (5-minute TTL)

## Conclusion

This implementation provides a robust, scalable solution for custom domains using industry-standard practices. The phased approach allows for iterative improvement while maintaining system stability.

**Recommended next steps:**
1. Start with Phase 1 implementation (middleware updates)
2. Create user documentation and setup guides  
3. Beta test with 5-10 willing users
4. Full rollout after successful testing

The solution leverages CleverCloud's existing domain infrastructure and Namecheap's DNS management, providing a seamless experience for users while minimizing complexity for the Eduskript platform. 