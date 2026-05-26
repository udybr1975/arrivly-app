import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Building2, Calendar, QrCode, Palette, CreditCard, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ARRIVLY_CONFIG } from '../../config'
import Loader from '../shared/Loader'

interface Apartment {
  id: string
  name: string
  neighborhood: string
  created_at: string
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [apt, setApt] = useState<Apartment | null>(null)
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: hostData } = await supabase
        .from('hosts').select('trial_ends_at').eq('id', user.id).maybeSingle()

      const { data } = await supabase
        .from('apartments')
        .select('id, name, neighborhood, created_at')
        .eq('host_id', user.id)
        .order('created_at')
        .limit(1)
        .maybeSingle()

      if (!data) {
        navigate('/onboarding')
        return
      }
      setTrialEndsAt(hostData?.trial_ends_at ?? null)
      setApt(data)
      setLoading(false)
    }
    load()
  }, [navigate])

  if (loading || !apt) return <Loader />

  const trialRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : ARRIVLY_CONFIG.trialDays
  const trialActive = trialRemaining > 0
  const guestUrl = `${ARRIVLY_CONFIG.appUrl}/guest?apt=${apt.id}`

  const actions = [
    { to: '/dashboard/property', icon: Building2, label: 'Edit Property', desc: 'Update details, amenities & info' },
    { to: '/dashboard/bookings', icon: Calendar, label: 'Bookings', desc: 'View and manage bookings' },
    { to: '/dashboard/qr', icon: QrCode, label: 'QR Code', desc: 'Get the QR for your guests' },
    { to: '/dashboard/branding', icon: Palette, label: 'Branding', desc: 'Customise colours & style' },
    { to: '/dashboard/billing', icon: CreditCard, label: 'Billing', desc: trialActive ? `${trialRemaining} trial days left` : 'Trial ended' },
  ]

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-0.5">{apt.name}</h1>
        <p className="text-gray-400">{apt.neighborhood}</p>
      </div>

      {/* Trial banner */}
      {trialActive ? (
        <div className="flex items-center justify-between bg-white/10 border border-white/20 rounded-xl px-4 py-3 mb-6">
          <span className="text-sm">
            <span className="font-medium">Free trial</span>
            <span className="text-gray-400"> · {trialRemaining} {trialRemaining === 1 ? 'day' : 'days'} remaining</span>
          </span>
          <Link to="/dashboard/billing" className="text-sm font-medium hover:underline">Upgrade →</Link>
        </div>
      ) : (
        <div className="flex items-center justify-between bg-amber-500/15 border border-amber-500/30 rounded-xl px-4 py-3 mb-6">
          <span className="text-sm text-amber-200 font-medium">Your free trial has ended</span>
          <Link to="/dashboard/billing" className="text-sm font-semibold text-amber-200 hover:underline">Add payment →</Link>
        </div>
      )}

      {/* Guest page URL */}
      <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-8">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 mb-0.5">Guest page URL</p>
          <p className="text-sm font-mono text-gray-300 truncate">{guestUrl}</p>
        </div>
        <a
          href={`/guest?apt=${apt.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 text-gray-400 hover:text-white transition-colors shrink-0"
          title="Preview guest page"
        >
          <ExternalLink size={16} />
        </a>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        {actions.map(({ to, icon: Icon, label, desc }) => (
          <Link
            key={to}
            to={to}
            className="group bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 hover:border-white/20 transition-colors"
          >
            <Icon size={18} className="mb-3 text-gray-400 group-hover:text-white transition-colors" />
            <p className="font-semibold text-sm mb-0.5">{label}</p>
            <p className="text-xs text-gray-500">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
