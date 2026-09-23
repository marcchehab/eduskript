import { permanentRedirect } from 'next/navigation'

// The privacy policy is German-only (see /datenschutz); /privacy is kept as an
// alias because English UI links and older consent screens point here.
export default function PrivacyPage() {
  permanentRedirect('/datenschutz')
}
