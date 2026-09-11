import { NotFoundContent } from '@/components/not-found-content'

// notFound() boundary inside this tenant root layout. Without it a notFound()
// from a child page or layout escapes the root layout and Next serves its bare
// client-rendered error shell (no <html lang>, no styles).
export default function NotFound() {
  return <NotFoundContent />
}
