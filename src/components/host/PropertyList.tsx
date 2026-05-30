import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Loader from '../shared/Loader'

interface ApartmentSummary {
  id: string
  name: string
  neighborhood: string | null
  is_visible: boolean | null
  created_at: string
}

export default function PropertyList() {
  const navigate = useNavigate()
  const [apts, setApts] = useState<ApartmentSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data } = await supabase
        .from('apartments')
        .select('id, name, neighborhood, is_visible, created_at')
        .eq('host_id', user.id)
        .order('created_at')
      const rows = data ?? []
      if (rows.length === 0) { setLoading(false); navigate('/onboarding'); return }
      setApts(rows)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Loader />

  return (
    <div className="max-w-2xl">
      <h1 className="text-[17px] font-serif font-light text-[#1a1a1a] mb-4">My properties</h1>

      <div className="grid grid-cols-1 gap-3">
        {apts.map(apt => (
          <div key={apt.id} className="bg-white border border-[#ddd8ce] rounded-[10px] p-4 flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[13px] font-semibold text-[#1a1a1a]">{apt.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  apt.is_visible
                    ? 'bg-[#e4f0da] text-[#2a5c0a]'
                    : 'bg-[#f0ede6] text-[#888]'
                }`}>
                  {apt.is_visible ? 'Live' : 'Draft'}
                </span>
              </div>
              {apt.neighborhood && (
                <div className="text-[11px] text-[#888]">{apt.neighborhood}</div>
              )}
            </div>
            <Link
              to={`/dashboard/property/${apt.id}`}
              className="bg-[#1a1a1a] text-white px-3 py-1.5 rounded-[7px] text-xs font-semibold hover:opacity-80 transition-opacity shrink-0"
            >
              Edit
            </Link>
          </div>
        ))}
      </div>

      <div className="border border-dashed border-[#ccc] rounded-[10px] p-4 mt-3 flex items-center justify-center cursor-pointer hover:bg-white/60 transition-colors">
        <span className="text-[12px] text-[#aaa]">+ Add another property · coming soon</span>
      </div>
    </div>
  )
}
