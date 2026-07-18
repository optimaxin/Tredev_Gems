import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PlusCircle, Trash } from "@phosphor-icons/react";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";

const EMPTY = { name: "", email: "", password: "", phone: "" };

export default function AdminTeam() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [perms, setPerms] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [selPerms, setSelPerms] = useState([]);
  const [showForm, setShowForm] = useState(false);

  const refresh = () => {
    api.get("/admin/users?role=staff").then((r) => setUsers(r.data));
    api.get("/admin/users?role=owner").then((r) => setUsers((prev) => [...r.data, ...prev]));
    api.get("/admin/users/permissions").then((r) => setPerms(r.data.permissions));
  };
  useEffect(() => { refresh(); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/admin/staff", { ...form, password: form.password || undefined, permissions: selPerms });
      const via = data.invite_sent ? "WhatsApp" : "mock (logged)";
      toast.success(`Staff added · invite via ${via}. Temp password: ${data.temp_password}`);
      setShowForm(false); setForm(EMPTY); setSelPerms([]); refresh();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  const updatePerms = async (uid, newPerms) => {
    await api.patch(`/admin/users/${uid}`, { permissions: newPerms });
    toast.success("Permissions updated"); refresh();
  };

  const promoteOwner = async (uid) => {
    if (!confirm("Promote to OWNER? Owner has full access including managing other users.")) return;
    await api.patch(`/admin/users/${uid}`, { role: "owner" });
    toast.success("Promoted to owner"); refresh();
  };

  const remove = async (uid) => {
    if (!confirm("Revoke staff access?")) return;
    await api.delete(`/admin/staff/${uid}`);
    toast.success("Access revoked"); refresh();
  };

  const staffOnly = users
    .filter((u) => u.role === "staff" || u.role === "owner")
    .filter((u) => matchesQuery(query, [u.name, u.email, u.phone]));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">People</div>
          <h1 className="font-display text-4xl text-ink mt-1">Team</h1>
        </div>
        <button onClick={() => setShowForm(!showForm)} data-testid="admin-team-new" className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest inline-flex items-center gap-2">
          <PlusCircle size={14} weight="duotone" /> Add staff
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="gold-line-strong bg-ivory p-6 mb-8 grid md:grid-cols-2 gap-4">
          {[["name", "Full name"], ["email", "Email"], ["password", "Temp password (blank = auto-generate)"], ["phone", "Phone (for WhatsApp invite)"]].map(([k, l]) => (
            <label key={k} className="block">
              <div className="text-xs text-ink-muted mb-1">{l}</div>
              <input required={k === "name" || k === "email"} type={k === "email" ? "email" : "text"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full gold-line px-3 py-2 outline-none focus:border-maroon" />
            </label>
          ))}
          <div className="md:col-span-2">
            <div className="text-xs text-ink-muted mb-2">Grant permissions</div>
            <div className="flex flex-wrap gap-2">
              {perms.map((p) => (
                <label key={p} className={`px-3 py-1.5 border cursor-pointer text-xs ${selPerms.includes(p) ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft"}`}>
                  <input type="checkbox" className="hidden" checked={selPerms.includes(p)} onChange={() => setSelPerms(selPerms.includes(p) ? selPerms.filter((x) => x !== p) : [...selPerms, p])} />
                  {p}
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 flex gap-3">
            <button className="brand-gradient text-ivory px-5 py-3 text-xs uppercase tracking-widest">Create staff</button>
            <button type="button" onClick={() => setShowForm(false)} className="border border-gold/40 px-5 py-3 text-xs uppercase tracking-widest">Cancel</button>
          </div>
        </form>
      )}

      <SearchBar value={query} onChange={setQuery} placeholder="Search team by name or email…" testId="team-search" className="mb-4 max-w-md" />
      <div className="space-y-3">
        {staffOnly.length === 0 && <div className="gold-line p-10 text-center text-ink-muted">{query ? `No team members match “${query}”.` : "No staff yet."}</div>}
        {staffOnly.map((u) => (
          <div key={u.user_id} className="gold-line bg-ivory p-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-serifd text-lg">{u.name}</div>
                <div className="text-xs text-ink-muted">{u.email} · <span className="uppercase tracking-widest text-[10px] font-mono">{u.role}</span></div>
              </div>
              {u.role === "staff" && (
                <div className="flex gap-3 text-xs">
                  <button onClick={() => promoteOwner(u.user_id)} className="text-maroon underline">Promote to owner</button>
                  <button onClick={() => remove(u.user_id)} className="text-revoked inline-flex items-center gap-1"><Trash size={12} /> Revoke</button>
                </div>
              )}
            </div>
            {u.role === "staff" && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">Permissions</div>
                <div className="flex flex-wrap gap-2">
                  {perms.map((p) => {
                    const has = (u.permissions || []).includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() => updatePerms(u.user_id, has ? u.permissions.filter((x) => x !== p) : [...(u.permissions || []), p])}
                        className={`px-3 py-1 text-xs border ${has ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
