import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ShieldCheck, Trash } from "@phosphor-icons/react";
import SearchBar, { matchesQuery } from "@/components/gemora/SearchBar";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const load = () => api.get(`/admin/users${role ? `?role=${role}` : ""}`).then((r) => setUsers(r.data));
  useEffect(() => { load(); }, [role]);

  const shown = users.filter((u) => matchesQuery(query, [u.name, u.email, u.phone, u.role]));

  const del = async (u) => {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/users/${u.user_id}`);
      toast.success("User deleted"); load();
    } catch (e) { toast.error(e.response?.data?.detail); }
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-gold-soft">Members</div>
      <h1 className="font-display text-4xl text-ink mt-1 mb-6">Users</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search users by name, email or phone…" testId="users-search" className="mb-4 max-w-md" />
      <div className="flex gap-2 mb-4 flex-wrap">
        {["", "customer", "staff", "owner"].map((r) => (
          <button key={r || "all"} onClick={() => setRole(r)} className={`text-xs px-3 py-1.5 border ${role === r ? "bg-maroon text-ivory border-maroon" : "border-gold/40 text-ink-soft hover:border-maroon"}`}>
            {r || "All"}
          </button>
        ))}
      </div>
      <div className="gold-line bg-ivory overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr>{["Name", "Email", "Phone", "Role", "Joined", ""].map((h) => <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-widest text-ink-muted">{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.user_id} className="border-t border-gold/20">
                <td className="px-4 py-3 font-serifd">{u.name}</td>
                <td className="px-4 py-3 text-ink-soft">{u.email}</td>
                <td className="px-4 py-3 font-mono text-xs">{u.phone || "—"} {u.phone_verified && <ShieldCheck size={12} weight="duotone" className="inline text-verified" />}</td>
                <td className="px-4 py-3 uppercase tracking-widest text-xs">{u.role}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-muted">{u.created_at?.slice(0, 10)}</td>
                <td className="px-4 py-3">
                  {u.role !== "owner" && (
                    <button onClick={() => del(u)} data-testid={`admin-user-delete-${u.user_id}`} className="text-xs text-revoked inline-flex items-center gap-1 hover:underline">
                      <Trash size={12} /> Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-muted">{query ? `No users match “${query}”.` : "No users."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
