"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AddMemberBody, Role } from "@sourcemark/contract";
import { useAuth, useOrgApi } from "@/lib/auth";
import type { Member } from "@/lib/types";
import { ErrorNote, Loading } from "@/components/ui";

export default function TeamPage() {
  const { orgId, can } = useAuth();
  const orgApi = useOrgApi();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>(["CREATOR"]);
  const [formError, setFormError] = useState<string>();
  const q = useQuery({ queryKey: ["members", orgId], queryFn: () => orgApi<{ members: Member[] }>("/") });
  const done = () => qc.invalidateQueries({ queryKey: ["members"] });
  const add = useMutation({ mutationFn: (body: object) => orgApi("/members", { body }), onSuccess: () => { setEmail(""); void done(); } });
  const update = useMutation({ mutationFn: (v: { id: string; roles: Role[] }) => orgApi(`/members/${v.id}`, { method: "PATCH", body: { roles: v.roles } }), onSuccess: done });
  const toggle = (list: Role[], r: Role) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);

  if (!can("ADMIN")) return <p>Admins only.</p>;
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Team</h1>
      <form className="card space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const parsed = AddMemberBody.safeParse({ email, roles });
        if (!parsed.success) return setFormError(parsed.error.issues[0].message);
        setFormError(undefined); add.mutate(parsed.data);
      }}>
        <div className="flex flex-wrap items-center gap-3">
          <input className="input w-64" placeholder="Email (must have signed in once)" value={email} onChange={(e) => setEmail(e.target.value)} />
          {Role.options.map((r) => <label key={r} className="text-sm"><input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles(toggle(roles, r))} /> {r}</label>)}
          <button className="btn-primary">Add member</button>
        </div>
        {formError && <p className="text-sm text-red-700">{formError}</p>}
        <ErrorNote error={add.error} />
      </form>
      {q.isLoading ? <Loading /> : (
        <ul className="card divide-y divide-slate-100 p-0">
          {q.data?.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
              <span className="w-64">{m.name ?? m.email}</span>
              {Role.options.map((r) => (
                <label key={r}><input type="checkbox" checked={m.roles.includes(r)} disabled={update.isPending}
                  onChange={() => { const next = toggle(m.roles, r); if (next.length) update.mutate({ id: m.id, roles: next }); }} /> {r}</label>
              ))}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={update.error ?? q.error} />
    </section>
  );
}
