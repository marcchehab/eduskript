# Copilot Instructions for Eduskript Platform

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview
This is a multi-tenant education platform built with Next.js, TypeScript, Prisma, and NextAuth. The platform allows teachers to create and manage educational content using markdown with versioning support.

## Key Architecture Principles
- **Multi-tenant**: Each teacher has their own content namespace
- **Markdown-first**: All content is stored as markdown and rendered on-demand
- **Versioning**: Full version control for all content changes
- **Hybrid rendering**: SSG with ISR for performance
- **Modular design**: Clean separation of concerns

## Tech Stack Guidelines
- Use TypeScript with strict typing
- Leverage Next.js App Router
- Use Prisma for database operations
- Implement NextAuth for authentication
- Use Remark/Rehype for markdown processing
- Implement a modern split-view markdown editor (CodeMirror 6)
- Use Tailwind CSS for styling

## Database Schema Patterns
- Multi-tenant design with tenant isolation
- Versioning through dedicated version tables
- Soft deletes for content recovery
- Audit trails for all changes

## Security Best Practices
- Implement proper authentication and authorization
- Use middleware for tenant isolation
- Validate all user inputs
- Secure API endpoints

## Performance Considerations
- Use ISR for content regeneration
- Implement proper caching strategies
- Optimize database queries
- Use proper loading states

## Code Organization
- Feature-based folder structure
- Shared utilities in `/lib`
- Reusable components in `/components`
- Type definitions in `/types`
- Database schema in `/prisma`
