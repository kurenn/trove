/* Favorites.tsx — hearted models with empty state. */

import { Icon } from "../components/Icons";
import { ModelResults } from "../components/cards";
import { useDataset } from "../data/dataset";
import { useApp } from "../lib/store";
import type { Model } from "../data/types";

export function FavoritesScreen() {
  const nav = useApp((s) => s.nav);
  const fav = useApp((s) => s.fav);
  const onFav = useApp((s) => s.toggleFav);
  const S = useDataset();
  const models = S.MODELS.filter((m) => fav.includes(m.id));
  const onOpen = (m: Model) => nav({ name: "model", id: m.id });
  return (
    <div className="content-inner fade-in">
      <div className="page-head"><div><h1 className="page-title">Favorites</h1><p className="page-sub">{models.length} saved models</p></div></div>
      {models.length
        ? <ModelResults models={models} view="grid" onOpen={onOpen} fav={fav} onFav={onFav} />
        : <div className="empty"><Icon name="heart" size={36} style={{ opacity: 0.4 }} /><p style={{ marginTop: 12, fontWeight: 600 }}>No favorites yet</p><p style={{ fontSize: 13 }}>Tap the heart on any model to save it here.</p></div>}
    </div>
  );
}
