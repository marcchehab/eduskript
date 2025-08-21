# Eduskript - Modern Education Platform

A comprehensive, multi-tenant education platform built with Next.js, TypeScript, Prisma, and NextAuth. Eduskript allows teachers to create and manage educational content using markdown with advanced features like versioning, LaTeX math, and syntax highlighting.

## MVP

- [x] persistent file hosting
- [ ] subdomain routing and custom domain routing
   - [x] change structure vocabulary to the following: a user has a "webpage" that they can describe in their settings (change that). on this webpage, they have several "collections" (current called "scripts", so rename that) that have "chapters" which contain "pages". 
   - [ ] subdomain dns and www not smooth
   - [ ] custom domain appends subdomain, e.g. https://www.teachingmaterials.io/subdomaintry
   - [ ] test speed improvements
   - [ ] imlement creative cloud api to add domain
   - [ ] remove "isActive" from custom domains
- [ ] sign up for teachers using email verification
- [ ] transfer old components

## Preference
- [ ] student/class handling
   - [ ] crypto logic
   - [ ] sign up invite
   - [ ] data service
- [ ] infrastructure for paid components
