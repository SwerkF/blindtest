import BoosterPanel from "@/components/booster/BoosterPanel"
import CollectionGrid from "@/components/booster/CollectionGrid"
import DropRates from "@/components/booster/DropRates"

/** "Collection" tab of my profile: packs to open, drop rates and my vinyls. */
export default function CollectionTab() {
  return (
    <div className="flex flex-col gap-6">
      <BoosterPanel />
      <DropRates />
      <div>
        <h2 className="text-xs text-muted font-medium uppercase tracking-wider mb-3">Ma collection</h2>
        <CollectionGrid userId={null} emptyText="Ta collection est vide : ouvre ton premier booster !" />
      </div>
    </div>
  )
}
