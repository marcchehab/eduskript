import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'

interface UpgradePromptProps {
  feature: string
}

export function UpgradePrompt({ feature }: UpgradePromptProps) {
  return (
    <Card className="max-w-lg mx-auto mt-12">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <Lock className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Upgrade Required</h2>
        <p className="text-muted-foreground">
          Your current plan doesn&apos;t include {feature}. Upgrade to continue.
        </p>
        <Button asChild>
          <Link href="/dashboard/billing">View Plans</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
