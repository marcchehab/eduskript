# Eduskript - Modern Education Platform

A comprehensive, multi-tenant education platform built with Next.js, TypeScript, Prisma, and NextAuth. Eduskript allows teachers to create and manage educational content using markdown with advanced features like versioning, LaTeX math, and syntax highlighting.

## 🚀 Features

### Core Features
- **Multi-tenant Architecture**: Each teacher gets their own content namespace and optional subdomain
- **Markdown-First Content**: Write and store all content in markdown format
- **Real-time Processing**: Transform markdown on-the-fly with Remark/Rehype plugins
- **Version Control**: Full version history for all content with easy rollback
- **WYSIWYG Editor**: Modern split-view markdown editor with live preview (CodeMirror 6)

### Content Management
- **Scripts**: Organize content into educational scripts
- **Chapters**: Group related pages into chapters
- **Pages**: Individual content pages with markdown support
- **Math Support**: LaTeX math rendering with KaTeX
- **Code Highlighting**: Syntax highlighting for code blocks
- **Image Upload**: Built-in image upload capabilities

### Technical Features
- **Hybrid Rendering**: SSG with ISR for optimal performance
- **Authentication**: Secure authentication with NextAuth.js
- **Database**: PostgreSQL with Prisma ORM
- **Self-Hostable**: Deploy on CleverCloud or any Node.js hosting
- **Modern UI**: Beautiful, responsive design with Tailwind CSS
- **Dark Mode**: Full dark mode support
- **TypeScript**: Fully typed codebase for better development experience

## 🛠️ Tech Stack

- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript
- **Database**: SQLite (dev) / PostgreSQL (prod) with Prisma ORM
- **Authentication**: NextAuth.js
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI primitives
- **Markdown Processing**: Unified, Remark, Rehype
- **Math Rendering**: KaTeX
- **Code Highlighting**: Highlight.js
- **File Upload**: Custom implementation
- **State Management**: Zustand (for client state)

## 📋 Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm
- SQLite (for local development) or PostgreSQL (for production)

## 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Eduskript
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Update `.env.local` with your database URL and other configurations:
   ```
   # For local development (SQLite)
   DATABASE_URL="file:./prisma/dev.db"
   
   # For production (PostgreSQL)
   # DATABASE_URL="postgresql://username:password@localhost:5432/Eduskript"
   
   NEXTAUTH_SECRET="your-secret-key"
   NEXTAUTH_URL="http://localhost:3000"
   ```

4. **Set up the database**
   ```bash
   # For local development (uses SQLite - no setup required)
   pnpm prisma db push
   pnpm prisma generate
   ```

5. **Start the development server**
   ```bash
   pnpm dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   ├── auth/              # Authentication pages
│   ├── dashboard/         # Dashboard pages
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── ui/               # Base UI components
│   ├── dashboard/        # Dashboard-specific components
│   └── editor/           # Editor components (future)
├── lib/                  # Utility libraries
│   ├── auth.ts           # NextAuth configuration
│   ├── prisma.ts         # Prisma client
│   ├── markdown.ts       # Markdown processing
│   └── utils.ts          # General utilities
├── types/                # TypeScript type definitions
└── middleware.ts         # Next.js middleware
```

## 🗃️ Database Schema

The platform uses a multi-tenant database design:

- **Users**: Teacher accounts with optional subdomains
- **Scripts**: Top-level content containers
- **Chapters**: Sections within scripts
- **Pages**: Individual content pages
- **PageVersions**: Version history for pages

## 🔒 Authentication

- Email/password authentication
- OAuth providers (GitHub, Google) - configurable
- Session management with NextAuth.js
- Secure password hashing with bcrypt

## 🎨 UI/UX

- Modern, clean interface built with Tailwind CSS
- Fully responsive design
- Dark mode support
- Accessible components using Radix UI
- Consistent design system

## 🚀 Deployment

### CleverCloud (Recommended)

The easiest way to deploy Eduskript is on CleverCloud with managed services:

1. **Follow the deployment guide**
   ```bash
   # See DEPLOYMENT.md for complete instructions
   ```

2. **One-click PostgreSQL**
   - Managed database with automated backups
   - Auto-scaling and high availability
   - Zero maintenance required

3. **Environment variables**
   - Copy from `.env.clevercloud` template
   - Configure in CleverCloud console

### Manual Hosting

1. **Build the application**
   ```bash
   pnpm build
   ```
   ```

2. **Start the production server**
   ```bash
   npm start
   ```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `NEXTAUTH_SECRET` | NextAuth secret key | Yes |
| `NEXTAUTH_URL` | Base URL for authentication | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | No |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | No |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | No |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | No |

### Database Migration

To update the database schema:

```bash
pnpm prisma migrate dev --name migration-name
pnpm prisma generate
```

## 🛣️ Roadmap

### Phase 1 (Current)
- ✅ Multi-tenant architecture
- ✅ Basic content management
- ✅ Authentication system
- ✅ Markdown processing
- 🔄 WYSIWYG editor integration

### Phase 2 (Planned)
- Student accounts and progress tracking
- Advanced editor features (tables, diagrams)
- Content sharing and collaboration
- Analytics and reporting
- Mobile app

### Phase 3 (Future)
- Live streaming integration
- Interactive exercises
- Gradebook functionality
- Plugin system
- Advanced theming

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📚 [Documentation](docs/)
- 🐛 [Issue Tracker](issues/)
- 💬 [Discussions](discussions/)

## 🙏 Acknowledgments

- Next.js team for the amazing framework
- Vercel for hosting and deployment tools
- Prisma for the excellent ORM
- The open-source community for all the great libraries

---

Built with ❤️ for educators everywhere.
