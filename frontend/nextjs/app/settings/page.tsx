"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/utils/apiFetch";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_GPTR_API_URL || "http://localhost:8000";

type SettingField = {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "number" | "select";
  options?: string[];
  tip?: string;
};

const API_KEY_FIELDS: SettingField[] = [
  { key: "APIFY_API_TOKEN", label: "Apify Token", placeholder: "apify_api_…", type: "password", tip: "Required for all job search actors" },
  { key: "APOLLO_API_KEY", label: "Apollo API Key", placeholder: "apollo_api_…", type: "password", tip: "Required for ICP discovery and email enrichment" },
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", placeholder: "sk-…", type: "password", tip: "Required for email generation" },
  { key: "INSTANTLY_API_KEY", label: "Instantly API Key", placeholder: "inst_…", type: "password", tip: "Required for sending leads to Instantly campaigns" },
];

const CAMPAIGN_FIELDS: SettingField[] = [
  { key: "INSTANTLY_CAMPAIGN_ID", label: "Instantly Campaign ID", placeholder: "65e808d0-…", tip: "The campaign to add leads to when auto-send is enabled" },
];

const SENDER_FIELDS: SettingField[] = [
  { key: "SENDER_NAME", label: "Your Name", placeholder: "Sahil Mehta" },
  { key: "SENDER_TITLE", label: "Your Title", placeholder: "Head of Partnerships" },
  { key: "SENDER_COMPANY", label: "Company", placeholder: "EMB Global" },
];

const PIPELINE_DEFAULTS: SettingField[] = [
  { key: "DEFAULT_MAX_COMPANIES", label: "Max Companies per Run", placeholder: "20", type: "number" },
  { key: "DEFAULT_MAX_ICPS", label: "Max ICPs per Company", placeholder: "5", type: "number" },
  { key: "DEFAULT_MARKET", label: "Default Market", type: "select", options: ["us", "india"], placeholder: "us" },
  { key: "DEFAULT_DATE_FILTER", label: "Default Date Range", type: "select", options: ["7d", "30d"], placeholder: "7d" },
];

function SettingRow({ field, value, onChange }: {
  field: SettingField;
  value: string;
  onChange: (val: string) => void;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="flex items-start gap-4 py-4 border-b border-brand-border last:border-b-0">
      <div className="w-52 flex-shrink-0">
        <label className="text-sm font-medium text-brand-secondary">{field.label}</label>
        {field.tip && <p className="text-xs text-slate-400 mt-0.5">{field.tip}</p>}
      </div>
      <div className="flex-1 flex items-center gap-2">
        {field.type === "select" ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-48"
          >
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <input
            type={field.type === "password" && !show ? "password" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="flex-1 px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary font-mono"
          />
        )}
        {field.type === "password" && (
          <button
            onClick={() => setShow((s) => !s)}
            className="text-slate-400 hover:text-slate-600 text-xs px-2 py-2 rounded border border-brand-border"
          >
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </div>
  );
}

function SettingsSection({ title, fields, values, onChange }: {
  title: string;
  fields: SettingField[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
}) {
  return (
    <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm mb-6">
      <div className="px-6 py-4 border-b border-brand-border bg-slate-50">
        <h2 className="text-sm font-semibold text-brand-secondary">{title}</h2>
      </div>
      <div className="px-6">
        {fields.map((field) => (
          <SettingRow
            key={field.key}
            field={field}
            value={values[field.key] || ""}
            onChange={(val) => onChange(field.key, val)}
          />
        ))}
      </div>
    </div>
  );
}

interface UserRecord {
  user_id: string;
  email: string;
  role: string;
  created_at: number;
}

function UsersSection() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadUsers() {
    try {
      const r = await apiFetch("/api/auth/users");
      const d = await r.json();
      setUsers(d.users ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    setCreating(true);
    try {
      const r = await apiFetch("/api/auth/users", {
        method: "POST",
        body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole }),
      });
      if (!r.ok) {
        const d = await r.json();
        setError(d.detail ?? "Failed to create user");
      } else {
        setSuccess(`User ${newEmail} created`);
        setNewEmail(""); setNewPassword(""); setNewRole("user");
        loadUsers();
      }
    } catch { setError("Network error"); }
    finally { setCreating(false); }
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Delete ${email}?`)) return;
    try {
      await apiFetch(`/api/auth/users/${userId}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.user_id !== userId));
    } catch { /* ignore */ }
  }

  return (
    <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm mb-6">
      <div className="px-6 py-4 border-b border-brand-border bg-slate-50">
        <h2 className="text-sm font-semibold text-brand-secondary">User Management</h2>
        <p className="text-xs text-slate-400 mt-0.5">Admin only — create and remove user accounts</p>
      </div>

      {/* Existing users */}
      <div className="px-6 py-4">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-brand-border">
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-b border-brand-border last:border-0">
                  <td className="py-2.5 text-brand-secondary">{u.email}</td>
                  <td className="py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"
                    }`}>{u.role}</span>
                  </td>
                  <td className="py-2.5 text-slate-400 text-xs">
                    {new Date(u.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(u.user_id, u.email)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add user form */}
      <div className="px-6 py-4 border-t border-brand-border bg-slate-50">
        <p className="text-xs font-semibold text-slate-500 mb-3">Add New User</p>
        <form onSubmit={handleCreate} className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="text-xs text-slate-400 block mb-1">Email</label>
            <input
              type="email" required value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div className="flex-1 min-w-36">
            <label className="text-xs text-slate-400 block mb-1">Password</label>
            <input
              type="password" required value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Role</label>
            <select
              value={newRole} onChange={(e) => setNewRole(e.target.value)}
              className="px-3 py-2 border border-brand-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit" disabled={creating}
            className="px-4 py-2 bg-brand-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        {success && <p className="text-green-600 text-xs mt-2">{success}</p>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("emb_settings");
      if (stored) setValues(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function handleSave() {
    try {
      localStorage.setItem("emb_settings", JSON.stringify(values));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-brand-secondary">Settings</h1>
            <p className="text-slate-500 text-sm mt-0.5">Configure API keys, sender identity, and pipeline defaults</p>
          </div>
          <button
            onClick={handleSave}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              saved ? "bg-green-600 text-white" : "bg-brand-primary text-white hover:bg-blue-800"
            }`}
          >
            {saved ? "Saved ✓" : "Save Settings"}
          </button>
        </div>

        {user?.role === "admin" && <UsersSection />}
        <SettingsSection title="API Keys" fields={API_KEY_FIELDS} values={values} onChange={handleChange} />
        <SettingsSection title="Campaign Configuration" fields={CAMPAIGN_FIELDS} values={values} onChange={handleChange} />
        <SettingsSection title="Sender Identity" fields={SENDER_FIELDS} values={values} onChange={handleChange} />
        <SettingsSection title="Pipeline Defaults" fields={PIPELINE_DEFAULTS} values={values} onChange={handleChange} />

        {/* Actor reference */}
        <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-brand-border bg-slate-50">
            <h2 className="text-sm font-semibold text-brand-secondary">Apify Actor Reference</h2>
          </div>
          <div className="px-6 py-5 space-y-3 text-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">US Market</p>
            {[
              { name: "Greenhouse", id: "fantastic-jobs/greenhouse-jobs-api", cost: "$1.20 / 1K jobs" },
              { name: "Ashby", id: "fantastic-jobs/ashby-jobs-api", cost: "$45 / mo flat" },
              { name: "Lever", id: "jobo.world/lever-jobs-search", cost: "$0.10 / 1K jobs" },
            ].map((a) => (
              <div key={a.id} className="flex items-center justify-between py-1.5">
                <span className="font-medium text-brand-secondary">{a.name}</span>
                <div className="flex items-center gap-4">
                  <code className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">{a.id}</code>
                  <span className="text-xs text-slate-400">{a.cost}</span>
                </div>
              </div>
            ))}
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 pt-3 border-t border-brand-border">India Market</p>
            {[
              { name: "LinkedIn", id: "bebity/linkedin-jobs-scraper", cost: "$29.99/mo + usage" },
              { name: "Naukri", id: "easyapi/naukri-jobs-scraper", cost: "$0.99 / 1K jobs" },
              { name: "Indeed", id: "borderline/indeed-scraper", cost: "$5.00 / 1K jobs" },
            ].map((a) => (
              <div key={a.id} className="flex items-center justify-between py-1.5">
                <span className="font-medium text-brand-secondary">{a.name}</span>
                <div className="flex items-center gap-4">
                  <code className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">{a.id}</code>
                  <span className="text-xs text-slate-400">{a.cost}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
