// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type NextAuth from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      subdomain?: string | null
      title?: string | null
    }
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
    subdomain?: string | null
    title?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    subdomain?: string | null
    title?: string | null
  }
}
