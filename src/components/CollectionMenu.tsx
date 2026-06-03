/* CollectionMenu.tsx — add/remove a model to user-defined collections, and
   create a new one inline. Used on the model detail page. */

import { useState } from "react";
import { Icon, Tag } from "./Icons";
import { useDataset } from "../data/dataset";
import { useApp } from "../lib/store";
import type { Collection, Model } from "../data/types";

export function CollectionMenu({ model }: { model: Model }) {
  const S = useDataset();
  const addToCollection = useApp((s) => s.addToCollection);
  const removeFromCollection = useApp((s) => s.removeFromCollection);
  const createCollection = useApp((s) => s.createCollection);
  const toast = useApp((s) => s.toast);

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // Only user-defined collections (explicit membership) can be edited here.
  const userColls = S.COLLECTIONS.filter((c) => c.members !== undefined);
  const isMember = (c: Collection) => !!c.members?.includes(model.id);
  const memberOf = userColls.filter(isMember);

  const toggle = async (c: Collection) => {
    try {
      if (isMember(c)) { await removeFromCollection(c.id, model.id); toast(`Removed from “${c.name}”`); }
      else { await addToCollection(c.id, model.id); toast(`Added to “${c.name}”`); }
    } catch (e) { toast(String(e)); }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    try {
      const id = await createCollection(name);
      if (id) { await addToCollection(id, model.id); toast(`Added to “${name}”`); }
    } catch (e) { toast(String(e)); }
  };

  return (
    <div>
      {memberOf.length > 0 && (
        <div className="card-tags" style={{ gap: 7, marginBottom: 11 }}>
          {memberOf.map((c) => (
            <Tag key={c.id} onClick={() => toggle(c)}>{c.name} <Icon name="x" size={12} style={{ verticalAlign: "-1px" }} /></Tag>
          ))}
        </div>
      )}

      <div className="collmenu">
        <button className="btn" style={{ width: "100%" }} onClick={() => setOpen((o) => !o)}>
          <Icon name="plus" size={16} /> Add to collection
        </button>
        {open && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
            <div className="collmenu-pop">
              {userColls.map((c) => (
                <button key={c.id} className={"collmenu-item" + (isMember(c) ? " is-member" : "")} onClick={() => toggle(c)}>
                  <Icon name={isMember(c) ? "check" : "layers"} size={16} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span className="faint" style={{ fontSize: 11.5 }}>{c.count ?? 0}</span>
                </button>
              ))}
              {userColls.length > 0 && <div className="collmenu-sep" />}
              <div style={{ display: "flex", gap: 7, padding: "2px 4px 4px" }}>
                <input
                  className="input" value={newName} placeholder="New collection…"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createAndAdd(); }}
                  style={{ flex: 1, height: 36, fontSize: 13 }}
                  aria-label="New collection name"
                />
                <button className="btn btn-primary btn-sm" disabled={!newName.trim()} onClick={createAndAdd}><Icon name="plus" size={15} /></button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
