import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BlueprintProposal } from './blueprint'

interface BlueprintState {
  byWorkspace: Record<string, BlueprintProposal[]>
  put: (workspace: string, proposal: BlueprintProposal) => void
  remove: (workspace: string, id: string) => void
}

export const EMPTY_BLUEPRINTS: BlueprintProposal[] = []

export const useBlueprintStore = create<BlueprintState>()(persist(set => ({
  byWorkspace: {},
  put: (workspace, proposal) => set(state => {
    const list = state.byWorkspace[workspace] ?? []
    const index = list.findIndex(entry => entry.id === proposal.id)
    const next = index === -1 ? [...list, proposal] : list.map(entry => entry.id === proposal.id ? proposal : entry)
    return { byWorkspace: { ...state.byWorkspace, [workspace]: next } }
  }),
  remove: (workspace, id) => set(state => ({
    byWorkspace: { ...state.byWorkspace, [workspace]: (state.byWorkspace[workspace] ?? []).filter(entry => entry.id !== id) },
  })),
}), { name: 'almanac-domain-blueprints-v1' }))
